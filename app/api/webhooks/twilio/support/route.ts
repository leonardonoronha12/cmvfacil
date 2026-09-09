import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEVELOPER_PHONE = "+5521988945647";
const clean = (value: unknown) => String(value ?? "").trim();
const xml = (message = "") => new NextResponse(
  `<?xml version="1.0" encoding="UTF-8"?><Response>${message ? `<Message>${message.replace(/[<>&'\"]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '\"': "&quot;" })[char]!)}</Message>` : ""}</Response>`,
  { status: 200, headers: { "content-type": "text/xml; charset=utf-8", "cache-control": "no-store" } },
);

async function callTwilioFunction(payload: Record<string, unknown>) {
  const supabaseUrl = clean(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL).replace(/\/+$/, "");
  const serviceRole = clean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || process.env.SERVICE_ROLE_KEY);
  if (!supabaseUrl || !serviceRole) throw new Error("support_webhook_not_configured");
  const response = await fetch(`${supabaseUrl}/functions/v1/support-whatsapp`, {
    method: "POST",
    headers: { authorization: `Bearer ${serviceRole}`, apikey: serviceRole, "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.ok !== true) throw new Error(clean(result?.error) || `support_whatsapp_${response.status}`);
  return result as Record<string, unknown>;
}

function normalizeAction(payload: string, body: string) {
  const value = `${payload} ${body}`.toLocaleLowerCase("pt-BR");
  if (value.includes("support_resolved") || value.includes("chamado solucionado")) return "resolved";
  if (value.includes("support_developer") || value.includes("enviar desenvolvedor")) return "developer";
  return "";
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const messageSid = clean(form.get("MessageSid") || form.get("SmsSid"));
    const body = clean(form.get("Body"));
    const buttonPayload = clean(form.get("ButtonPayload"));
    const originalSid = clean(form.get("OriginalRepliedMessageSid"));
    const action = normalizeAction(buttonPayload, body);
    if (!messageSid || !action) return xml();

    const verified = await callTwilioFunction({ action: "verify_incoming", messageSid });
    if (clean(verified.body) !== body) throw new Error("incoming_body_mismatch");

    const db = getSupabaseAdmin();
    let receiptQuery = db.from("support_delivery_receipts").select("ticket_id,provider_message_id").eq("provider", "twilio");
    if (originalSid) receiptQuery = receiptQuery.eq("provider_message_id", originalSid);
    else receiptQuery = receiptQuery.order("created_at", { ascending: false }).limit(1);
    const receipt = await receiptQuery.maybeSingle();
    if (receipt.error || !receipt.data?.ticket_id) return xml("Não foi possível identificar o chamado deste botão. Abra a mensagem original e tente novamente.");

    const ticketResult = await db.from("support_tickets")
      .select("id,protocol,user_id,company_id,status,message,page,raw_metadata")
      .eq("id", receipt.data.ticket_id)
      .maybeSingle();
    const ticket = ticketResult.data as Record<string, unknown> | null;
    if (ticketResult.error || !ticket) return xml("Chamado não encontrado.");
    const protocol = clean(ticket.protocol);
    const metadata = ticket.raw_metadata && typeof ticket.raw_metadata === "object" ? ticket.raw_metadata as Record<string, unknown> : {};

    if (action === "resolved") {
      if (clean(ticket.status).toLowerCase() !== "resolved") {
        const updated = await db.from("support_tickets").update({
          status: "resolved",
          raw_metadata: { ...metadata, resolvedAt: new Date().toISOString(), resolvedBy: clean(verified.from), resolvedVia: "twilio_button" },
        }).eq("id", ticket.id);
        if (updated.error) throw updated.error;
      }
      const notify = await fetch(new URL("/api/support/resolution-notify", req.url), {
        method: "POST",
        headers: { authorization: `Bearer ${clean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || process.env.SERVICE_ROLE_KEY)}`, "content-type": "application/json" },
        body: JSON.stringify({ ticketId: ticket.id }),
      });
      const notification = await notify.json().catch(() => ({}));
      if (!notify.ok || notification?.ok !== true) return xml(`Chamado ${protocol} marcado como solucionado. O aviso ao usuário ficou pendente.`);
      return xml(`Chamado ${protocol} marcado como solucionado. O usuário foi avisado no sistema e os canais de contato foram processados.`);
    }

    const variables = {
      "1": protocol,
      "2": clean(metadata.email) || "Não identificado",
      "3": clean(ticket.company_id) || "Não identificada",
      "4": clean(ticket.page) || "/",
      "5": `ENCAMINHADO AO DESENVOLVEDOR — ${clean(ticket.message)}`,
    };
    const sent = await callTwilioFunction({
      action: "send_ticket",
      to: DEVELOPER_PHONE,
      protocol: `${protocol}-developer`,
      message: clean(ticket.message),
      contentVariables: variables,
    });
    if (clean(sent.sid)) {
      await db.from("support_delivery_receipts").upsert({
        ticket_id: ticket.id,
        provider: "twilio-developer",
        provider_message_id: clean(sent.sid),
        status: clean(sent.status) || "accepted",
        evidence: { sourceMessageSid: messageSid, originalMessageSid: originalSid || null, forwardedAt: new Date().toISOString() },
      }, { onConflict: "provider,provider_message_id" });
    }
    return xml(`Chamado ${protocol} encaminhado ao desenvolvedor.`);
  } catch (error) {
    console.error("twilio_support_webhook_failed", error instanceof Error ? error.message : String(error));
    return xml("Não foi possível processar esta ação agora. Tente novamente em instantes.");
  }
}
