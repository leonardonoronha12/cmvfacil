import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CAMPAIGN_KEY = "terms-v1-2026-09-08";
const AUTHORIZATION = "terms-v1-authorized-254-20260908";
const SUBJECT = "Atualizamos os Termos de Uso do CMV Fácil";
const TEXT = `Olá!

Atualizamos os Termos de Uso do CMV Fácil para deixar mais claras as regras de contratação, renovação e cancelamento do Plano PRO Anual.

O plano anual custa R$ 873, é pago antecipadamente e possui duração de 12 meses. Esse valor representa 25% de desconto em comparação com 12 mensalidades de R$ 97.

O plano é renovado automaticamente a cada ano. Você receberá um aviso pelo menos 30 dias antes da próxima renovação, com a data, o valor e as orientações para cancelamento.

Você pode cancelar a próxima renovação a qualquer momento. Nesse caso, nenhuma nova renovação será realizada e seu acesso continuará normalmente até o fim do período anual já pago.

Quando o direito legal de arrependimento for aplicável, ele será respeitado integralmente. Depois do prazo legal, o simples cancelamento não gera reembolso proporcional dos meses restantes. Permanecem garantidos todos os direitos previstos em lei, inclusive em casos de cobrança indevida ou falha comprovada do serviço.

Você poderá consultar a versão completa em:

https://cmvfacil.app/termos-de-uso

Se tiver alguma dúvida, fale com a gente pelo e-mail cmvfacil@gmail.com.

Equipe CMV Fácil`;

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
}

function authorized(req: NextRequest) {
  return req.headers.get("x-cmv-campaign-authorization") === AUTHORIZATION || req.nextUrl.searchParams.get("authorization") === AUTHORIZATION;
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const HTML = `<div style="font-family:Arial,sans-serif;color:#123b3d;line-height:1.6;max-width:640px">${TEXT.split("\n\n").map((p) => p === "https://cmvfacil.app/termos-de-uso" ? `<p><a href="${p}">${p}</a></p>` : `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("")}</div>`;
const CONTENT_SHA256 = crypto.createHash("sha256").update(`${SUBJECT}\n\n${TEXT}`, "utf8").digest("hex");

async function users() {
  const supabase = getSupabaseAdmin();
  const all: Array<{ id: string; email: string }> = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    for (const user of data.users) {
      const email = String(user.email ?? "").trim().toLowerCase();
      if (email.includes("@")) all.push({ id: user.id, email });
    }
    if (data.users.length < 1000) break;
  }
  const unique = new Map<string, { id: string; email: string }>();
  for (const user of all) if (!unique.has(user.email)) unique.set(user.email, user);
  return { raw: all, unique: [...unique.values()].sort((a, b) => a.email.localeCompare(b.email)) };
}

async function summary() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("legal_communication_deliveries").select("status,recipient_email,resend_email_id,error_message").eq("campaign_key", CAMPAIGN_KEY);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const count = (status: string) => rows.filter((r: any) => r.status === status).length;
  return { campaign: CAMPAIGN_KEY, content_sha256: CONTENT_SHA256, processed: rows.length, sent: count("sent"), delivered: count("delivered"), delivery_delayed: count("delivery_delayed"), bounced: count("bounced"), failed: count("failed"), pending: count("pending") };
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return json({ ok: false, error: "unauthorized" }, 401);
  if (req.nextUrl.searchParams.get("action") === "send-authorized") return sendAuthorized();
  if (req.nextUrl.searchParams.get("action") === "retry-429-authorized") return retry429Authorized();
  if (req.nextUrl.searchParams.get("action") === "probe-429-authorized") return probe429Authorized();
  const list = await users();
  return json({ ok: true, auth_emails: list.raw.length, unique_recipients: list.unique.length, duplicates: list.raw.length - list.unique.length, ...(await summary()) });
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return json({ ok: false, error: "unauthorized" }, 401);
  const body = await req.json().catch(() => ({}));
  if (body?.action !== "send-authorized") return json({ ok: false, error: "invalid_action" }, 400);
  return sendAuthorized();
}

async function sendAuthorized() {
  const list = await users();
  if (list.unique.length !== 254) return json({ ok: false, error: "recipient_count_mismatch", raw: list.raw.length, unique: list.unique.length }, 409);

  const supabase = getSupabaseAdmin();
  const { error: seedError } = await supabase.from("legal_communication_deliveries").upsert(list.unique.map((u) => ({
    campaign_key: CAMPAIGN_KEY, user_id: u.id, recipient_email: u.email, content_sha256: CONTENT_SHA256, status: "pending",
  })), { onConflict: "campaign_key,recipient_email", ignoreDuplicates: true });
  if (seedError) return json({ ok: false, error: "seed_failed", detail: seedError.message }, 500);

  const { data: pending, error: pendingError } = await supabase.from("legal_communication_deliveries").select("id,recipient_email").eq("campaign_key", CAMPAIGN_KEY).eq("status", "pending").is("resend_email_id", null);
  if (pendingError) return json({ ok: false, error: "pending_load_failed" }, 500);
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = (process.env.CMV_EMAIL_FROM || process.env.EMAIL_FROM || "").trim();
  if (!apiKey || !from) return json({ ok: false, error: "email_not_configured" }, 500);

  for (const row of pending ?? []) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "idempotency-key": `${CAMPAIGN_KEY}:${row.id}` },
        body: JSON.stringify({ from, to: [row.recipient_email], subject: SUBJECT, text: TEXT, html: HTML, reply_to: process.env.EMAIL_REPLY_TO || "cmvfacil@gmail.com" }),
      });
      const result = await res.json().catch(() => ({}));
      const emailId = String(result?.id ?? "").trim();
      if (!res.ok || !emailId) {
        await supabase.from("legal_communication_deliveries").update({ status: "failed", error_message: `resend_http_${res.status}` }).eq("id", row.id);
        continue;
      }
      await supabase.from("legal_communication_deliveries").update({ status: "sent", resend_email_id: emailId, sent_at: new Date().toISOString(), last_event_at: new Date().toISOString() }).eq("id", row.id);
    } catch {
      await supabase.from("legal_communication_deliveries").update({ status: "failed", error_message: "send_exception" }).eq("id", row.id);
    }
  }
  return json({ ok: true, ...(await summary()) });
}

async function retry429Authorized() {
  const supabase = getSupabaseAdmin();
  const { data: candidates, error } = await supabase
    .from("legal_communication_deliveries")
    .select("id,recipient_email,content_sha256")
    .eq("campaign_key", CAMPAIGN_KEY)
    .eq("status", "failed")
    .eq("error_message", "resend_http_429")
    .is("resend_email_id", null)
    .order("created_at", { ascending: true });
  if (error) return json({ ok: false, error: "retry_candidates_failed" }, 500);
  if ((candidates ?? []).length !== 55) return json({ ok: false, error: "retry_candidate_count_mismatch", count: candidates?.length ?? 0 }, 409);
  if ((candidates ?? []).some((row: any) => row.content_sha256 !== CONTENT_SHA256)) return json({ ok: false, error: "content_hash_mismatch" }, 409);

  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = (process.env.CMV_EMAIL_FROM || process.env.EMAIL_FROM || "").trim();
  if (!apiKey || !from) return json({ ok: false, error: "email_not_configured" }, 500);

  for (const candidate of candidates ?? []) {
    const { data: current } = await supabase
      .from("legal_communication_deliveries")
      .select("status,resend_email_id,error_message")
      .eq("id", candidate.id)
      .maybeSingle();
    if (!current || current.status !== "failed" || current.resend_email_id || current.error_message !== "resend_http_429") continue;

    await supabase.from("legal_communication_deliveries").update({ error_message: "retrying_429" }).eq("id", candidate.id).eq("error_message", "resend_http_429");
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "idempotency-key": `${CAMPAIGN_KEY}:${candidate.id}` },
        body: JSON.stringify({ from, to: [candidate.recipient_email], subject: SUBJECT, text: TEXT, html: HTML, reply_to: process.env.EMAIL_REPLY_TO || "cmvfacil@gmail.com" }),
      });
      const result = await res.json().catch(() => ({}));
      const emailId = String(result?.id ?? "").trim();
      if (res.ok && emailId) {
        await supabase.from("legal_communication_deliveries").update({ status: "sent", resend_email_id: emailId, sent_at: new Date().toISOString(), last_event_at: new Date().toISOString(), error_message: "recovered_from_429" }).eq("id", candidate.id).is("resend_email_id", null);
      } else {
        await supabase.from("legal_communication_deliveries").update({ status: "failed", error_message: `retry_429_http_${res.status}` }).eq("id", candidate.id).is("resend_email_id", null);
      }
    } catch {
      await supabase.from("legal_communication_deliveries").update({ status: "failed", error_message: "retry_429_exception" }).eq("id", candidate.id).is("resend_email_id", null);
    }
    await new Promise((resolve) => setTimeout(resolve, 650));
  }
  return json({ ok: true, retry_scope: 55, ...(await summary()) });
}

async function probe429Authorized() {
  const supabase = getSupabaseAdmin();
  const { data: candidate } = await supabase
    .from("legal_communication_deliveries")
    .select("id,recipient_email,content_sha256,status,resend_email_id,error_message")
    .eq("campaign_key", CAMPAIGN_KEY)
    .eq("status", "failed")
    .is("resend_email_id", null)
    .in("error_message", ["resend_http_429", "retry_429_http_429"])
    .limit(1)
    .maybeSingle();
  if (!candidate) return json({ ok: false, error: "no_probe_candidate" }, 409);
  if (candidate.content_sha256 !== CONTENT_SHA256) return json({ ok: false, error: "content_hash_mismatch" }, 409);
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = (process.env.CMV_EMAIL_FROM || process.env.EMAIL_FROM || "").trim();
  if (!apiKey || !from) return json({ ok: false, error: "email_not_configured" }, 500);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "idempotency-key": `${CAMPAIGN_KEY}:${candidate.id}` },
    body: JSON.stringify({ from, to: [candidate.recipient_email], subject: SUBJECT, text: TEXT, html: HTML, reply_to: process.env.EMAIL_REPLY_TO || "cmvfacil@gmail.com" }),
  });
  const result = await res.json().catch(() => ({}));
  const emailId = String(result?.id ?? "").trim();
  if (res.ok && emailId) {
    await supabase.from("legal_communication_deliveries").update({ status: "sent", resend_email_id: emailId, sent_at: new Date().toISOString(), last_event_at: new Date().toISOString(), error_message: "recovered_from_429" }).eq("id", candidate.id).is("resend_email_id", null);
    return json({ ok: true, accepted: true, retry_after: null, ...(await summary()) });
  }
  const retryAfter = String(res.headers.get("retry-after") ?? "").trim();
  const message = String(result?.message ?? result?.error ?? "").replace(/[^a-zA-Z0-9 _.,:-]/g, "").slice(0, 180);
  await supabase.from("legal_communication_deliveries").update({ status: "failed", error_message: `probe_http_${res.status}${retryAfter ? `_retry_after_${retryAfter}` : ""}${message ? `_${message}` : ""}` }).eq("id", candidate.id).is("resend_email_id", null);
  return json({ ok: false, accepted: false, http_status: res.status, retry_after: retryAfter || null, provider_message: message || null, ...(await summary()) }, res.status === 429 ? 429 : 422);
}
