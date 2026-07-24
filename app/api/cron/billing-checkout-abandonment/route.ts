import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { getStripe } from "../../../lib/stripeServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return NextResponse.json(data, { ...init, headers });
}

function asString(value: unknown) {
  const v = String(value ?? "").trim();
  return v || null;
}

function isValidE164(value: string) {
  return /^\+\d{10,15}$/.test(value.trim());
}

async function maybeEnqueue(params: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  company: any;
  customerId: string;
  checkoutSessionId: string;
  userId: string | null;
  planKey: string | null;
  origin: string | null;
  checkoutUrl: string | null;
}) {
  const enabled = String(process.env.BILLING_WHATSAPP_AUTOMATION_ENABLED ?? "").trim().toLowerCase() === "true";
  if (!enabled) return { ok: true as const, status: "disabled" as const };

  const { supabase, company, customerId, checkoutSessionId, userId, planKey, origin, checkoutUrl } = params;
  const companyId = String(company?.id ?? "").trim();
  if (!companyId) return { ok: true as const, status: "skipped_missing_company" as const };

  const already = String(company?.whatsapp_automation_triggered_at ?? "").trim();
  if (already) return { ok: true as const, status: "skipped_already" as const };

  const subStatus = String(company?.subscription_status ?? "").trim().toLowerCase();
  if (subStatus === "active" || subStatus === "trialing") return { ok: true as const, status: "skipped_subscription" as const };

  const phone = String(company?.phone_e164 ?? "").trim();
  if (!phone) return { ok: true as const, status: "skipped_missing_phone" as const };
  if (!isValidE164(phone)) {
    const patch: any = {
      whatsapp_automation_triggered_at: new Date().toISOString(),
      whatsapp_automation_status: "skipped_invalid_phone",
      subscription_updated_at: new Date().toISOString(),
    };
    await supabase.from("companies").update(patch).eq("id", companyId);
    return { ok: true as const, status: "skipped_invalid_phone" as const };
  }

  const email = String(company?.email ?? "").trim() || null;
  const name = String(company?.fantasy_name ?? company?.legal_name ?? "").trim();
  const firstName = name.split(/\s+/).filter(Boolean)[0] ?? null;
  const lastName = name.split(/\s+/).slice(1).filter(Boolean).join(" ") || null;
  const trialEndsAt = asString(company?.trial_ends_at);

  const { data: contactId } = await supabase.rpc("upsert_contact", {
    p_source: "billing",
    p_external_id: companyId,
    p_email: email,
    p_phone_e164: phone,
    p_first_name: firstName,
    p_last_name: lastName,
    p_consent_email: false,
    p_consent_whatsapp: false,
    p_raw: { company_id: companyId, stripe_customer_id: customerId },
  });
  if (!contactId) return { ok: true as const, status: "skipped_no_contact" as const };

  const contactRes = await supabase.from("contacts").select("consent_whatsapp").eq("id", contactId).maybeSingle();
  if (contactRes.error) return { ok: false as const, error: contactRes.error.message };
  if (!contactRes.data || (contactRes.data as any).consent_whatsapp !== true) {
    const patch: any = {
      whatsapp_automation_triggered_at: new Date().toISOString(),
      whatsapp_automation_status: "skipped_no_consent",
      subscription_updated_at: new Date().toISOString(),
    };
    await supabase.from("companies").update(patch).eq("id", companyId);
    return { ok: true as const, status: "skipped_no_consent" as const };
  }

  const payload = {
    company_id: companyId,
    user_id: userId,
    name,
    phone_e164: phone,
    checkout_session_id: checkoutSessionId,
    plan_key: planKey,
    origin,
    trial_ends_at: trialEndsAt,
    cta_url: checkoutUrl || "/ajustes?tab=planos",
  };

  const { data: outboxId } = await supabase.rpc("enqueue_bravo_event", {
    p_contact_id: contactId,
    p_event_type: "billing.checkout_abandoned",
    p_payload: payload,
  });

  const patch: any = {
    whatsapp_automation_triggered_at: new Date().toISOString(),
    whatsapp_automation_status: outboxId ? "enqueued" : "enqueue_failed",
    subscription_updated_at: new Date().toISOString(),
  };
  await supabase.from("companies").update(patch).eq("id", companyId);

  return { ok: true as const, status: outboxId ? ("enqueued" as const) : ("enqueue_failed" as const), outboxId: outboxId ?? null };
}

export async function GET() {
  const enabled = String(process.env.BILLING_WHATSAPP_AUTOMATION_ENABLED ?? "").trim().toLowerCase() === "true";
  if (!enabled) return json({ ok: true, enabled: false, scanned: 0, enqueued: 0 }, { status: 200 });

  const minutesRaw = Number(String(process.env.BILLING_CHECKOUT_ABANDONMENT_MINUTES ?? "30").trim());
  const minutes = Number.isFinite(minutesRaw) && minutesRaw > 0 ? minutesRaw : 30;
  const cutoffIso = new Date(Date.now() - minutes * 60 * 1000).toISOString();

  let supabase: ReturnType<typeof getSupabaseAdmin>;
  try {
    supabase = getSupabaseAdmin();
  } catch {
    return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
  }

  const stripe = getStripe();

  const q = await supabase
    .from("companies")
    .select(
      "id,fantasy_name,legal_name,email,phone_e164,trial_ends_at,subscription_status,whatsapp_automation_triggered_at,checkout_status,checkout_started_at,checkout_abandoned_at,checkout_url,stripe_customer_id,stripe_checkout_session_id",
    )
    .eq("checkout_status", "open")
    .is("checkout_abandoned_at", null)
    .is("whatsapp_automation_triggered_at", null)
    .lt("checkout_started_at", cutoffIso)
    .not("stripe_checkout_session_id", "is", null)
    .order("checkout_started_at", { ascending: true })
    .limit(25);

  if (q.error) return json({ ok: false, error: q.error.message }, { status: 500 });

  const rows = (q.data ?? []) as any[];
  let enqueued = 0;
  const processed: Array<{ company_id: string; session_id: string; result: string }> = [];

  for (const company of rows) {
    const companyId = String(company?.id ?? "").trim();
    const sessionId = String(company?.stripe_checkout_session_id ?? "").trim();
    if (!companyId || !sessionId) continue;
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const status = String((session as any)?.status ?? "").trim().toLowerCase();
      if (status !== "open") {
        processed.push({ company_id: companyId, session_id: sessionId, result: `skip_status_${status || "unknown"}` });
        continue;
      }
      const customerId = String((session as any)?.customer ?? "").trim() || String(company?.stripe_customer_id ?? "").trim();
      if (!customerId) {
        processed.push({ company_id: companyId, session_id: sessionId, result: "skip_no_customer" });
        continue;
      }

      const userId = asString((session as any)?.metadata?.user_id);
      const planKey = asString((session as any)?.metadata?.plan_key);
      const origin = asString((session as any)?.metadata?.origin);
      const checkoutUrl = asString(company?.checkout_url);

      const nowIso = new Date().toISOString();
      await supabase
        .from("companies")
        .update({ checkout_status: "abandoned", checkout_abandoned_at: nowIso, subscription_updated_at: nowIso } as any)
        .eq("id", companyId);

      const r = await maybeEnqueue({ supabase, company, customerId, checkoutSessionId: sessionId, userId, planKey, origin, checkoutUrl });
      processed.push({ company_id: companyId, session_id: sessionId, result: r.ok ? r.status : "error" });
      if (r.ok && r.status === "enqueued") enqueued += 1;
    } catch (err) {
      processed.push({ company_id: companyId, session_id: sessionId, result: `error:${err instanceof Error ? err.message : String(err)}` });
    }
  }

  return json({ ok: true, enabled: true, cutoff_minutes: minutes, scanned: rows.length, enqueued, processed }, { status: 200 });
}

