import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return NextResponse.json(data, { ...init, headers });
}

function safeEqual(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function verifySvix(args: { rawBody: string; headers: Headers; secret: string }) {
  const msgId = (args.headers.get("svix-id") ?? "").trim();
  const msgTimestamp = (args.headers.get("svix-timestamp") ?? "").trim();
  const msgSignature = (args.headers.get("svix-signature") ?? "").trim();

  if (!msgId || !msgTimestamp || !msgSignature) return { ok: false as const, error: "missing_signature_headers" as const };

  const ts = Number(msgTimestamp);
  if (!Number.isFinite(ts)) return { ok: false as const, error: "invalid_signature_timestamp" as const };
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > 300) return { ok: false as const, error: "stale_signature_timestamp" as const };

  const secretRaw = String(args.secret ?? "").trim();
  const secretPart = secretRaw.startsWith("whsec_") ? secretRaw.slice("whsec_".length) : secretRaw;
  let secretBytes: Buffer;
  try {
    secretBytes = Buffer.from(secretPart, "base64");
  } catch {
    return { ok: false as const, error: "invalid_signature_secret" as const };
  }

  const signedContent = `${msgId}.${msgTimestamp}.${args.rawBody}`;
  const expected = crypto.createHmac("sha256", secretBytes).update(signedContent).digest("base64");

  const candidates = msgSignature.split(" ").map((s) => s.trim()).filter(Boolean);
  const ok = candidates.some((entry) => {
    const parts = entry.split(",");
    if (parts.length !== 2) return false;
    const version = parts[0]?.trim();
    const sig = parts[1]?.trim() ?? "";
    if (version !== "v1") return false;
    return safeEqual(sig, expected);
  });

  return ok ? { ok: true as const, id: msgId, ts } : { ok: false as const, error: "invalid_signature" as const };
}

export async function POST(req: NextRequest) {
  const secret = String(process.env.RESEND_WEBHOOK_SECRET ?? "").trim();
  if (!secret) return json({ ok: false, error: "server_not_configured" }, { status: 500 });

  const rawBody = await req.text();
  const verified = verifySvix({ rawBody, headers: req.headers, secret });
  if (!verified.ok) return json({ ok: false, error: verified.error }, { status: 401 });

  let payload: any = null;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const eventType = String(payload?.type ?? payload?.event_type ?? "").trim();
  const emailId = String(payload?.data?.email_id ?? payload?.data?.id ?? "").trim() || null;

  try {
    const supabase = getSupabaseAdmin();
    await supabase
      .from("resend_webhook_events")
      .insert({ svix_id: verified.id, svix_timestamp: verified.ts, event_type: eventType || "unknown", email_id: emailId } as any)
      .throwOnError();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.toLowerCase().includes("duplicate")) return json({ ok: true }, { status: 200 });
    console.error("resend_webhook_persist_failed", { code: msg.slice(0, 160) });
    return json({ ok: false, error: "persist_failed" }, { status: 500 });
  }

  return json({ ok: true }, { status: 200 });
}
