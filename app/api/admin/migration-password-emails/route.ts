import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const AUTHORIZATION = "migration-password-authorized-96-20260909";
const CAMPAIGN_KEY = "migration-password-2026-09-09";
const CONTENT_SHA256 = crypto.createHash("sha256").update("Redefina sua senha do CMV Fácil|migration-password-v1").digest("hex");

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

function authorized(req: NextRequest) {
  return req.headers.get("x-cmv-campaign-authorization") === AUTHORIZATION || req.nextUrl.searchParams.get("authorization") === AUTHORIZATION;
}

async function sendMigrationPasswordEmail(args: { to: string; actionLink: string; idempotencyKey: string }) {
  const apiKey = String(process.env.RESEND_API_KEY ?? "").trim();
  const from = String(process.env.CMV_EMAIL_FROM || process.env.EMAIL_FROM || "").trim();
  if (!apiKey || !from) return { ok: false as const, error: "email_not_configured" };
  const subject = "Redefina sua senha do CMV Fácil";
  const text = `Olá! Sua conta e seus dados foram migrados para o novo CMV Fácil.\n\nPara acessar, defina uma nova senha no link abaixo:\n${args.actionLink}\n\nSe você não reconhece esta solicitação, ignore este e-mail.`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;line-height:1.55;color:#123b3d;max-width:620px;margin:auto"><h2 style="margin:0 0 12px">Sua conta chegou ao novo CMV Fácil</h2><p>Seus dados foram migrados e já estão disponíveis.</p><p>Para acessar o novo sistema, defina uma nova senha:</p><p style="margin:20px 0"><a href="${args.actionLink}" style="display:inline-block;background:#0ab86d;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:700">Redefinir minha senha</a></p><p style="color:#6b7280;font-size:12px">Se o botão não abrir, copie este link: ${args.actionLink}</p><p style="color:#6b7280;font-size:12px">Se você não reconhece esta solicitação, ignore este e-mail.</p></div>`;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "idempotency-key": args.idempotencyKey },
    body: JSON.stringify({ from, to: [args.to], subject, text, html, reply_to: process.env.EMAIL_REPLY_TO || "cmvfacil@gmail.com" }),
  });
  const result = await response.json().catch(() => ({})) as { id?: string; message?: string; error?: string };
  if (!response.ok || !result.id) return { ok: false as const, error: `resend_http_${response.status}:${String(result.message || result.error || "send_failed")}` };
  return { ok: true as const, id: result.id };
}

async function eligibleUsers() {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("bubble_obj_user_migration")
    .select("email,supabase_user_id,status,validation_status")
    .eq("status", "completed")
    .order("email", { ascending: true });
  if (error) throw new Error(error.message);
  const unique = new Map<string, { email: string; userId: string | null; validationStatus: string }>();
  for (const row of data ?? []) {
    const email = String((row as any).email ?? "").trim().toLowerCase();
    if (!email.includes("@") || unique.has(email)) continue;
    unique.set(email, {
      email,
      userId: String((row as any).supabase_user_id ?? "").trim() || null,
      validationStatus: String((row as any).validation_status ?? ""),
    });
  }
  return [...unique.values()];
}

async function summary() {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("legal_communication_deliveries")
    .select("status,recipient_email,resend_email_id,error_message")
    .eq("campaign_key", CAMPAIGN_KEY);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const count = (status: string) => rows.filter((row: any) => row.status === status).length;
  return {
    campaign: CAMPAIGN_KEY,
    content_sha256: CONTENT_SHA256,
    processed: rows.length,
    sent: count("sent"),
    delivered: count("delivered"),
    delivery_delayed: count("delivery_delayed"),
    bounced: count("bounced"),
    failed: count("failed"),
    pending: count("pending"),
    bruno: rows.find((row: any) => row.recipient_email === "bru.pva7@gmail.com") ?? null,
  };
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return json({ ok: false, error: "unauthorized" }, 401);
  const eligible = await eligibleUsers();
  return json({
    ok: true,
    eligible: eligible.length,
    validated: eligible.filter((row) => row.validationStatus === "validated").length,
    brunoEligible: eligible.some((row) => row.email === "bru.pva7@gmail.com"),
    ...(await summary()),
  });
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return json({ ok: false, error: "unauthorized" }, 401);
  const body = await req.json().catch(() => ({}));
  if (body?.action !== "send-authorized") return json({ ok: false, error: "invalid_action" }, 400);

  const eligible = await eligibleUsers();
  if (eligible.length !== 96 || !eligible.some((row) => row.email === "bru.pva7@gmail.com")) {
    return json({ ok: false, error: "recipient_reconciliation_failed", eligible: eligible.length }, 409);
  }

  const db = getSupabaseAdmin();
  const { error: seedError } = await db.from("legal_communication_deliveries").upsert(eligible.map((row) => ({
    campaign_key: CAMPAIGN_KEY,
    user_id: row.userId,
    recipient_email: row.email,
    content_sha256: CONTENT_SHA256,
    status: "pending",
  })), { onConflict: "campaign_key,recipient_email", ignoreDuplicates: true });
  if (seedError) return json({ ok: false, error: "seed_failed", detail: seedError.message }, 500);

  const { data: pending, error: pendingError } = await db
    .from("legal_communication_deliveries")
    .select("id,recipient_email,status,resend_email_id")
    .eq("campaign_key", CAMPAIGN_KEY)
    .eq("status", "pending")
    .is("resend_email_id", null)
    .order("created_at", { ascending: true });
  if (pendingError) return json({ ok: false, error: "pending_load_failed", detail: pendingError.message }, 500);

  const appUrl = "https://cmvfacil.app";
  const redirectTo = `${appUrl}/auth/callback?next=${encodeURIComponent("/restaurar-senha")}`;
  for (const row of pending ?? []) {
    const generated = await db.auth.admin.generateLink({ type: "recovery", email: row.recipient_email, options: { redirectTo } } as any);
    if (generated.error) {
      await db.from("legal_communication_deliveries").update({ status: "failed", error_message: `generate_link:${generated.error.message}` }).eq("id", row.id);
      continue;
    }
    const actionLink = String((generated.data as any)?.properties?.action_link ?? "").trim();
    if (!actionLink) {
      await db.from("legal_communication_deliveries").update({ status: "failed", error_message: "generate_link:missing_action_link" }).eq("id", row.id);
      continue;
    }
    const sent = await sendMigrationPasswordEmail({ to: row.recipient_email, actionLink, idempotencyKey: `${CAMPAIGN_KEY}:${row.id}` });
    if (!sent.ok) {
      const errorMessage = String(sent.error || "send_failed").includes("429") ? "resend_http_429" : String(sent.error || "send_failed").slice(0, 400);
      await db.from("legal_communication_deliveries").update({ status: "failed", error_message: errorMessage }).eq("id", row.id);
      continue;
    }
    await db.from("legal_communication_deliveries").update({ status: "sent", resend_email_id: sent.id || null, sent_at: new Date().toISOString(), last_event_at: new Date().toISOString(), error_message: null }).eq("id", row.id);
    await new Promise((resolve) => setTimeout(resolve, 650));
  }
  return json({ ok: true, requested: eligible.length, ...(await summary()) });
}
