import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function response(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
}

function verify(raw: string, headers: Headers, secret: string) {
  const id = headers.get("svix-id")?.trim() ?? "";
  const timestamp = headers.get("svix-timestamp")?.trim() ?? "";
  const signatures = headers.get("svix-signature")?.trim() ?? "";
  const ts = Number(timestamp);
  if (!id || !timestamp || !signatures || !Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return null;
  const encoded = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const expected = crypto.createHmac("sha256", Buffer.from(encoded, "base64")).update(`${id}.${timestamp}.${raw}`).digest("base64");
  const valid = signatures.split(" ").some((item) => {
    const [version, signature] = item.split(",");
    if (version !== "v1" || !signature) return false;
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
  return valid ? { id, timestamp: ts } : null;
}

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim() ?? "";
  if (!secret) return response({ ok: false, error: "server_not_configured" }, 500);
  const raw = await req.text();
  const signature = verify(raw, req.headers, secret);
  if (!signature) return response({ ok: false, error: "invalid_signature" }, 401);

  let payload: any;
  try { payload = JSON.parse(raw); } catch { return response({ ok: false, error: "invalid_json" }, 400); }
  const eventType = String(payload?.type ?? "unknown");
  const emailId = String(payload?.data?.email_id ?? payload?.data?.id ?? "").trim() || null;
  const supabase = getSupabaseAdmin();
  const { error: eventError } = await supabase.from("resend_webhook_events").upsert({
    svix_id: signature.id,
    svix_timestamp: signature.timestamp,
    event_type: eventType,
    email_id: emailId,
    status: "processed",
    processed_at: new Date().toISOString(),
    payload_summary: { event_type: eventType, email_id: emailId },
  }, { onConflict: "svix_id", ignoreDuplicates: true });
  if (eventError) return response({ ok: false, error: "persist_failed" }, 500);

  if (emailId && ["email.sent", "email.delivered", "email.delivery_delayed", "email.bounced"].includes(eventType)) {
    const status = eventType === "email.delivery_delayed" ? "delivery_delayed" : eventType.slice(6);
    await supabase.from("legal_communication_deliveries").update({
      status,
      last_event_at: new Date().toISOString(),
      ...(status === "delivered" ? { delivered_at: new Date().toISOString() } : {}),
      ...(status === "bounced" ? { bounced_at: new Date().toISOString() } : {}),
    }).eq("resend_email_id", emailId);
  }
  return response({ ok: true });
}
