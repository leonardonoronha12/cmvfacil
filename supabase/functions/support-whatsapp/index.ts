import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// Approved WhatsApp Utility template with the two support quick actions.
// Keep this explicit so a generic environment variable cannot silently point
// support tickets at an unrelated marketing template.
const SUPPORT_CONTENT_SID = "HXae8d2920b28447773bd94a093e0ec614";
const SUPPORT_MENU_CONTENT_SID = "HX8297b00787c7e8465898cd821e5db22e";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function whatsapp(value: string) {
  const normalized = value.trim();
  return normalized.toLowerCase().startsWith("whatsapp:") ? normalized : `whatsapp:${normalized}`;
}

function xml(message = "") {
  const escaped = message.replace(/[<>&'\"]/g, (char) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '\"': "&quot;",
  })[char]!);
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${escaped ? `<Message>${escaped}</Message>` : ""}</Response>`, {
    status: 200,
    headers: { "content-type": "text/xml; charset=utf-8", "cache-control": "no-store" },
  });
}

function actionFrom(value: string) {
  const normalized = value.toLocaleLowerCase("pt-BR");
  if (normalized.includes("support_resolved") || normalized.includes("chamado solucionado")) return "resolved";
  if (normalized.includes("support_developer") || normalized.includes("enviar desenvolvedor")) return "developer";
  return "";
}

serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  const accountSid = (Deno.env.get("TWILIO_ACCOUNT_SID") ?? "").trim();
  const authToken = (Deno.env.get("TWILIO_AUTH_TOKEN") ?? "").trim();
  const from = (Deno.env.get("TWILIO_WHATSAPP_FROM") ?? "").trim();
  const to = (Deno.env.get("CMV_SUPPORT_WHATSAPP_TO") ?? "+5513936180830").trim();
  if (!accountSid || !authToken || !from || !to) {
    return json({ ok: false, error: "twilio_not_configured" }, 500);
  }

  // Twilio posts quick-reply clicks as form data. This branch is public because
  // Twilio cannot send a Supabase JWT, so every event is independently verified
  // against Twilio's REST API before any database change or outbound message.
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = new URLSearchParams(await req.text());
    const messageSid = String(form.get("MessageSid") || form.get("SmsSid") || "").trim();
    const originalSid = String(form.get("OriginalRepliedMessageSid") || "").trim();
    const body = String(form.get("ButtonPayload") || form.get("Body") || "").trim();
    const action = actionFrom(body);
    if (!/^SM[a-f0-9]{32}$/i.test(messageSid)) return xml();

    // The Twilio number is configured to enter through this Edge Function.
    // Ordinary messages must continue to the conversational support webhook;
    // only the legacy ticket buttons are handled locally below.
    if (!action) {
      const conversationalResponse = await fetch("https://cmvfacil.app/api/webhooks/twilio/support", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      }).catch(() => null);
      if (!conversationalResponse?.ok) {
        return xml("Não consegui iniciar o atendimento agora. Aguarde alguns segundos e envie sua mensagem novamente.");
      }
      return new Response(await conversationalResponse.text(), {
        status: 200,
        headers: { "content-type": "text/xml; charset=utf-8", "cache-control": "no-store" },
      });
    }

    const verifiedResponse = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages/${encodeURIComponent(messageSid)}.json`,
      { headers: { authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`, accept: "application/json" } },
    ).catch(() => null);
    const verified = verifiedResponse ? await verifiedResponse.json().catch(() => ({})) : {};
    if (!verifiedResponse?.ok || String(verified?.direction ?? "") !== "inbound" ||
        String(verified?.from ?? "") !== whatsapp(to) || String(verified?.to ?? "") !== whatsapp(from)) {
      return xml();
    }

    const serviceRole = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
    if (!supabaseUrl || !serviceRole || !originalSid) {
      return xml("Não foi possível identificar o chamado deste botão. Abra a mensagem original e tente novamente.");
    }
    const dbHeaders = { authorization: `Bearer ${serviceRole}`, apikey: serviceRole, "content-type": "application/json" };
    const receiptsResponse = await fetch(
      `${supabaseUrl}/rest/v1/support_delivery_receipts?provider=eq.twilio&provider_message_id=eq.${encodeURIComponent(originalSid)}&select=ticket_id&limit=1`,
      { headers: dbHeaders },
    );
    const receipts = await receiptsResponse.json().catch(() => []);
    const ticketId = String(receipts?.[0]?.ticket_id ?? "");
    if (!receiptsResponse.ok || !ticketId) return xml("Chamado não encontrado para esta mensagem.");

    const ticketResponse = await fetch(
      `${supabaseUrl}/rest/v1/support_tickets?id=eq.${encodeURIComponent(ticketId)}&select=id,protocol,company_id,status,message,page,raw_metadata&limit=1`,
      { headers: dbHeaders },
    );
    const tickets = await ticketResponse.json().catch(() => []);
    const ticket = tickets?.[0];
    if (!ticketResponse.ok || !ticket) return xml("Chamado não encontrado.");
    const protocol = String(ticket.protocol ?? "").trim();

    if (action === "resolved") {
      if (String(ticket.status ?? "").toLowerCase() !== "resolved") {
        const metadata = ticket.raw_metadata && typeof ticket.raw_metadata === "object" ? ticket.raw_metadata : {};
        const updated = await fetch(`${supabaseUrl}/rest/v1/support_tickets?id=eq.${encodeURIComponent(ticketId)}`, {
          method: "PATCH",
          headers: { ...dbHeaders, prefer: "return=minimal" },
          body: JSON.stringify({ status: "resolved", raw_metadata: { ...metadata, resolvedAt: new Date().toISOString(), resolvedBy: verified.from, resolvedVia: "twilio_button" } }),
        });
        if (!updated.ok) return xml("Não foi possível atualizar o chamado agora. Tente novamente.");
      }
      const notifyResponse = await fetch("https://cmvfacil.app/api/support/resolution-notify", {
        method: "POST",
        headers: { authorization: `Bearer ${serviceRole}`, "content-type": "application/json" },
        body: JSON.stringify({ ticketId }),
      }).catch(() => null);
      const notification = notifyResponse ? await notifyResponse.json().catch(() => ({})) : {};
      if (!notifyResponse?.ok || notification?.ok !== true) {
        return xml(`Chamado ${protocol} marcado como solucionado. O aviso ao usuário ficou pendente e será processado novamente.`);
      }
      return xml(`Chamado ${protocol} marcado como solucionado. O usuário foi avisado no sistema e os canais de contato foram processados.`);
    }

    const variables = {
      "1": protocol,
      "2": String(ticket.raw_metadata?.email ?? "Não identificado"),
      "3": String(ticket.company_id ?? "Não identificada"),
      "4": String(ticket.page ?? "/"),
      "5": `ENCAMINHADO AO DESENVOLVEDOR — ${String(ticket.message ?? "")}`,
    };
    const outbound = new URLSearchParams({
      From: whatsapp(from), To: whatsapp("+5521988945647"), ContentSid: SUPPORT_CONTENT_SID,
      ContentVariables: JSON.stringify(variables),
    });
    const sentResponse = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
      method: "POST",
      headers: { authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`, "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: outbound.toString(),
    });
    const sent = await sentResponse.json().catch(() => ({}));
    if (!sentResponse.ok || !sent?.sid) return xml("Não foi possível encaminhar ao desenvolvedor agora. Tente novamente.");
    await fetch(`${supabaseUrl}/rest/v1/support_delivery_receipts?on_conflict=provider,provider_message_id`, {
      method: "POST",
      headers: { ...dbHeaders, prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ ticket_id: ticketId, provider: "twilio-developer", provider_message_id: sent.sid, status: sent.status || "accepted", evidence: { sourceMessageSid: messageSid, originalMessageSid: originalSid, forwardedAt: new Date().toISOString() } }),
    });
    return xml(`Chamado ${protocol} encaminhado ao desenvolvedor.`);
  }

  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!supabaseUrl || !bearer) return json({ ok: false, error: "unauthorized" }, 401);
  const authCheck = await fetch(`${supabaseUrl}/auth/v1/admin/users?page=1&per_page=1`, {
    headers: { authorization: `Bearer ${bearer}`, apikey: bearer },
  }).catch(() => null);
  if (!authCheck?.ok) return json({ ok: false, error: "unauthorized" }, 401);

  const payload = await req.json().catch(() => null) as {
    action?: unknown;
    message?: unknown;
    protocol?: unknown;
    messageSid?: unknown;
    allowAnySender?: unknown;
    to?: unknown;
    contentVariables?: Record<string, unknown>;
    contentSid?: unknown;
  } | null;
  const action = String(payload?.action ?? "send_ticket").trim();
  const message = String(payload?.message ?? "").trim();
  const protocol = String(payload?.protocol ?? crypto.randomUUID()).trim();
  const contentSid = SUPPORT_CONTENT_SID;
  const contentVariables = Object.fromEntries(
    Object.entries(payload?.contentVariables ?? {}).map(([key, value]) => [key, String(value ?? "").trim()]),
  );
  if (action === "verify_incoming") {
    const messageSid = String(payload?.messageSid ?? "").trim();
    const allowAnySender = payload?.allowAnySender === true;
    if (!/^SM[a-f0-9]{32}$/i.test(messageSid)) return json({ ok: false, error: "invalid_message_sid" }, 400);
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages/${encodeURIComponent(messageSid)}.json`,
      { headers: { authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`, accept: "application/json" } },
    ).catch(() => null);
    const result = response ? await response.json().catch(() => ({})) : {};
    if (!response?.ok) return json({ ok: false, error: "twilio_verification_failed" }, 502);
    const expectedFrom = whatsapp(to);
    const expectedTo = whatsapp(from);
    if (String(result?.direction ?? "") !== "inbound" || String(result?.to ?? "") !== expectedTo || (!allowAnySender && String(result?.from ?? "") !== expectedFrom)) {
      return json({ ok: false, error: "untrusted_incoming_message" }, 403);
    }
    return json({ ok: true, body: result?.body ?? "", from: result?.from ?? "", to: result?.to ?? "" });
  }

  const form = new URLSearchParams();
  form.set("From", whatsapp(from));
  const destination = String(payload?.to ?? to).trim();
  form.set("To", whatsapp(destination));
  if (action === "send_text") {
    if (message.length < 1 || message.length > 1600) return json({ ok: false, error: "invalid_message" }, 400);
    form.set("Body", message);
  } else if (action === "send_content") {
    const requestedContentSid = String(payload?.contentSid ?? SUPPORT_MENU_CONTENT_SID).trim();
    if (!/^HX[a-f0-9]{32}$/i.test(requestedContentSid)) return json({ ok: false, error: "invalid_content_sid" }, 400);
    form.set("ContentSid", requestedContentSid);
  } else {
    if (message.length < 3 || message.length > 6000) return json({ ok: false, error: "invalid_message" }, 400);
    if (!contentSid || Object.keys(contentVariables).length !== 5) {
      return json({ ok: false, error: "invalid_template_data" }, 400);
    }
    form.set("ContentSid", contentSid);
    form.set("ContentVariables", JSON.stringify(contentVariables));
  }

  let lastDetail = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
          "Idempotency-Key": `cmv-support-${protocol}`,
        },
        body: form.toString(),
      },
    ).catch(() => null);
    const result = response ? await response.json().catch(() => ({})) : {};
    if (response?.ok) return json({ ok: true, sid: result?.sid ?? null, status: result?.status ?? null });
    lastDetail = String(result?.message ?? "network_error");
    if (response && response.status < 500) break;
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 600));
  }
  return json({ ok: false, error: "twilio_send_failed", detail: lastDetail }, 502);
});
