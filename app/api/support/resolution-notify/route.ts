import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { sendSupportResolvedEmail } from "../../../lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const clean = (value: unknown) => String(value ?? "").trim();

export async function POST(req: NextRequest) {
  const expected = clean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || process.env.SERVICE_ROLE_KEY);
  const bearer = clean(req.headers.get("authorization")).replace(/^Bearer\s+/i, "");
  if (!expected || bearer !== expected) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const { ticketId } = await req.json().catch(() => ({ ticketId: "" })) as { ticketId?: string };
  const db = getSupabaseAdmin();
  const result = await db.from("support_tickets").select("id,protocol,user_id,company_id,status,raw_metadata").eq("id", clean(ticketId)).maybeSingle();
  if (result.error || !result.data) return NextResponse.json({ ok: false, error: "ticket_not_found" }, { status: 404 });
  const ticket = result.data as any;
  if (clean(ticket.status).toLowerCase() !== "resolved") return NextResponse.json({ ok: false, error: "ticket_not_resolved" }, { status: 409 });
  const metadata = ticket.raw_metadata && typeof ticket.raw_metadata === "object" ? ticket.raw_metadata : {};
  const previous = metadata.resolutionNotification && typeof metadata.resolutionNotification === "object" ? metadata.resolutionNotification : {};
  let email = clean(metadata.email);
  if (!email && ticket.user_id) {
    const authUser = await db.auth.admin.getUserById(ticket.user_id);
    email = clean(authUser.data.user?.email);
  }
  let phone = clean(metadata.phone);
  if (!phone && ticket.company_id) {
    const company = await db.from("companies").select("phone_e164").eq("id", ticket.company_id).maybeSingle();
    phone = clean((company.data as any)?.phone_e164);
  }
  const channels: Record<string, any> = { ...previous.channels };
  if (!channels.email?.accepted && email) {
    const sent = await sendSupportResolvedEmail({ to: email, protocol: ticket.protocol, idempotencyKey: `support-resolved-${ticket.id}` });
    channels.email = sent.ok
      ? { accepted: true, emailId: sent.id || null, recipient: email, at: new Date().toISOString() }
      : { accepted: false, recipient: email, error: sent.error, at: new Date().toISOString() };
  }
  if (!channels.whatsapp?.accepted && phone) {
    const supabaseUrl = clean(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL).replace(/\/+$/, "");
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/support-whatsapp`, { method: "POST", headers: { authorization: `Bearer ${expected}`, apikey: expected, "content-type": "application/json" }, body: JSON.stringify({ action: "send_text", to: phone, protocol: `${ticket.protocol}-resolved`, message: `O chamado ${ticket.protocol} foi solucionado pela equipe de suporte técnico do CMV Fácil. Por favor, teste novamente no sistema.` }) });
      const data = await response.json().catch(() => ({}));
      channels.whatsapp = response.ok && data?.ok ? { accepted: true, messageId: data.sid || null, status: data.status || "accepted", at: new Date().toISOString() } : { accepted: false, error: data?.detail || data?.error || `http_${response.status}`, at: new Date().toISOString() };
    } catch (error) { channels.whatsapp = { accepted: false, error: error instanceof Error ? error.message : "send_failed", at: new Date().toISOString() }; }
  }
  const resolutionNotification = { createdAt: previous.createdAt || new Date().toISOString(), chat: { available: true }, channels };
  const updated = await db.from("support_tickets").update({ raw_metadata: { ...metadata, resolutionNotification } }).eq("id", ticket.id);
  if (updated.error) return NextResponse.json({ ok: false, error: "notification_state_failed" }, { status: 500 });
  return NextResponse.json({ ok: true, protocol: ticket.protocol, chat: true, email: channels.email || { accepted: false, error: "missing_email" }, whatsapp: channels.whatsapp || { accepted: false, error: "missing_phone" } });
}
