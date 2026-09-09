import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// Approved WhatsApp Utility template with the two support quick actions.
// Keep this explicit so a generic environment variable cannot silently point
// support tickets at an unrelated marketing template.
const SUPPORT_CONTENT_SID = "HXae8d2920b28447773bd94a093e0ec614";

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

serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  if (!supabaseUrl || !bearer) return json({ ok: false, error: "unauthorized" }, 401);

  const authCheck = await fetch(`${supabaseUrl}/auth/v1/admin/users?page=1&per_page=1`, {
    headers: { authorization: `Bearer ${bearer}`, apikey: bearer },
  }).catch(() => null);
  if (!authCheck?.ok) return json({ ok: false, error: "unauthorized" }, 401);

  const accountSid = (Deno.env.get("TWILIO_ACCOUNT_SID") ?? "").trim();
  const authToken = (Deno.env.get("TWILIO_AUTH_TOKEN") ?? "").trim();
  const from = (Deno.env.get("TWILIO_WHATSAPP_FROM") ?? "").trim();
  const to = (Deno.env.get("CMV_SUPPORT_WHATSAPP_TO") ?? "+5513936180830").trim();
  if (!accountSid || !authToken || !from || !to) {
    return json({ ok: false, error: "twilio_not_configured" }, 500);
  }

  const payload = await req.json().catch(() => null) as {
    action?: unknown;
    message?: unknown;
    protocol?: unknown;
    messageSid?: unknown;
    to?: unknown;
    contentVariables?: Record<string, unknown>;
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
    if (!/^SM[a-f0-9]{32}$/i.test(messageSid)) return json({ ok: false, error: "invalid_message_sid" }, 400);
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages/${encodeURIComponent(messageSid)}.json`,
      { headers: { authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`, accept: "application/json" } },
    ).catch(() => null);
    const result = response ? await response.json().catch(() => ({})) : {};
    if (!response?.ok) return json({ ok: false, error: "twilio_verification_failed" }, 502);
    const expectedFrom = whatsapp(to);
    const expectedTo = whatsapp(from);
    if (String(result?.direction ?? "") !== "inbound" || String(result?.from ?? "") !== expectedFrom || String(result?.to ?? "") !== expectedTo) {
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
