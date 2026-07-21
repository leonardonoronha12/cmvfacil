import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { planKeyFromPriceId, updateCompanyFromSubscription } from "../../../lib/billing";
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

function getWebhookSecret() {
  const v = String(process.env.STRIPE_WEBHOOK_SECRET ?? "").trim();
  if (!v) throw new Error("STRIPE_WEBHOOK_SECRET_not_set");
  return v;
}

function asString(value: unknown) {
  const v = String(value ?? "").trim();
  return v || null;
}

function eventCreatedIso(event: Stripe.Event) {
  const created = typeof event.created === "number" && Number.isFinite(event.created) ? event.created : 0;
  return created ? new Date(created * 1000).toISOString() : new Date().toISOString();
}

function eventCreatedMs(event: Stripe.Event) {
  const created = typeof event.created === "number" && Number.isFinite(event.created) ? event.created : 0;
  return created ? created * 1000 : Date.now();
}

function isStripeObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isValidE164(value: string) {
  return /^\+\d{10,15}$/.test(value.trim());
}

function extractCustomerId(event: Stripe.Event): string | null {
  const obj = event.data?.object as any;
  if (!obj || typeof obj !== "object") return null;
  const customer = obj.customer;
  if (typeof customer === "string" && customer.trim()) return customer.trim();
  if (customer && typeof customer === "object" && typeof customer.id === "string" && customer.id.trim()) return customer.id.trim();
  return null;
}

function extractSubscriptionId(event: Stripe.Event): string | null {
  const obj = event.data?.object as any;
  if (!obj || typeof obj !== "object") return null;
  const sub = obj.subscription;
  if (typeof sub === "string" && sub.trim()) return sub.trim();
  if (sub && typeof sub === "object" && typeof sub.id === "string" && sub.id.trim()) return sub.id.trim();
  return null;
}

async function findCompanyByCustomerId(supabase: ReturnType<typeof getSupabaseAdmin>, customerId: string) {
  const res = await supabase
    .from("companies")
    .select(
      "id,stripe_customer_id,subscription_status,subscription_plan,stripe_price_id,current_period_end,cancel_at_period_end,trial_started_at,trial_ends_at,checkout_status,checkout_url,checkout_plan,checkout_abandoned_at,billing_last_event_created_at",
    )
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  if (res.error) throw new Error(res.error.message);
  return res.data as any | null;
}

async function bumpEventMarker(params: { supabase: ReturnType<typeof getSupabaseAdmin>; companyId: string; event: Stripe.Event }) {
  const { supabase, companyId, event } = params;
  const createdIso = eventCreatedIso(event);
  const patch: any = {
    billing_last_event_id: event.id,
    billing_last_event_created_at: createdIso,
    subscription_updated_at: new Date().toISOString(),
  };
  const res = await supabase.from("companies").update(patch).eq("id", companyId);
  if (res.error) throw new Error(res.error.message);
}

async function registerWebhookEvent(params: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  event: Stripe.Event;
  companyId: string | null;
  status: string;
  errorMessage: string | null;
  payloadSummary: Record<string, unknown> | null;
}) {
  const { supabase, event, companyId, status, errorMessage, payloadSummary } = params;
  const createdAt = eventCreatedIso(event);
  const insert = await supabase
    .from("stripe_webhook_events")
    .insert({
      stripe_event_id: event.id,
      event_type: String(event.type ?? "").trim(),
      stripe_created_at: createdAt,
      company_id: companyId,
      status,
      error_message: errorMessage,
      payload_summary: payloadSummary,
    } as any)
    .select("id")
    .maybeSingle();

  if (!insert.error) return { ok: true as const, duplicate: false as const };
  const code = String((insert.error as any)?.code ?? "").trim();
  const msg = String(insert.error.message ?? "");
  if (code === "23505" || msg.toLowerCase().includes("duplicate")) return { ok: true as const, duplicate: true as const };
  return { ok: false as const, error: insert.error.message };
}

async function updateWebhookEvent(params: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  eventId: string;
  patch: Record<string, unknown>;
}) {
  const { supabase, eventId, patch } = params;
  const res = await supabase.from("stripe_webhook_events").update(patch as any).eq("stripe_event_id", eventId);
  if (res.error) throw new Error(res.error.message);
}

async function maybeEnqueueCheckoutAbandoned(params: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  companyId: string;
  customerId: string;
  userId: string | null;
  checkoutSessionId: string | null;
  planKey: string | null;
  origin: string | null;
  trialEndsAt: string | null;
  checkoutUrl: string | null;
}) {
  const enabled = String(process.env.BILLING_WHATSAPP_AUTOMATION_ENABLED ?? "").trim().toLowerCase() === "true";
  if (!enabled) return;

  const { supabase, companyId, customerId, userId, checkoutSessionId, planKey, origin, trialEndsAt, checkoutUrl } = params;
  const companyRes = await supabase
    .from("companies")
    .select("id,fantasy_name,legal_name,email,phone_e164,whatsapp_automation_triggered_at,whatsapp_automation_status,subscription_status")
    .eq("id", companyId)
    .maybeSingle();
  if (companyRes.error || !companyRes.data) return;

  const already = String((companyRes.data as any)?.whatsapp_automation_triggered_at ?? "").trim();
  if (already) return;

  const status = String((companyRes.data as any)?.subscription_status ?? "").trim().toLowerCase();
  if (status === "active" || status === "trialing") return;

  const phone = String((companyRes.data as any)?.phone_e164 ?? "").trim();
  if (!phone) return;
  if (!isValidE164(phone)) {
    const patch: any = {
      whatsapp_automation_triggered_at: new Date().toISOString(),
      whatsapp_automation_status: "skipped_invalid_phone",
      subscription_updated_at: new Date().toISOString(),
    };
    await supabase.from("companies").update(patch).eq("id", companyId);
    return;
  }

  const email = String((companyRes.data as any)?.email ?? "").trim() || null;
  const name = String((companyRes.data as any)?.fantasy_name ?? (companyRes.data as any)?.legal_name ?? "").trim();

  const firstName = name.split(/\s+/).filter(Boolean)[0] ?? null;
  const lastName = name.split(/\s+/).slice(1).filter(Boolean).join(" ") || null;

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

  if (!contactId) return;

  const contactRes = await supabase.from("contacts").select("consent_whatsapp").eq("id", contactId).maybeSingle();
  if (contactRes.error) return;
  if (!contactRes.data || (contactRes.data as any).consent_whatsapp !== true) {
    const patch: any = {
      whatsapp_automation_triggered_at: new Date().toISOString(),
      whatsapp_automation_status: "skipped_no_consent",
      subscription_updated_at: new Date().toISOString(),
    };
    await supabase.from("companies").update(patch).eq("id", companyId);
    return;
  }

  const payload = {
    contact: {
      id: contactId,
      source: "billing",
      external_id: companyId,
      email,
      phone_e164: phone,
      first_name: firstName,
      last_name: lastName,
      consent_email: false,
      consent_whatsapp: false,
    },
    raw: {
      company_id: companyId,
      user_id: userId,
      name,
      phone_e164: phone,
      stripe_customer_id: customerId,
      checkout_session_id: checkoutSessionId,
      checkout_url: checkoutUrl,
      cta_url: checkoutUrl || "/ajustes?tab=planos",
      plan_key: planKey,
      origin,
      trial_ends_at: trialEndsAt,
      event_type: "billing.checkout_abandoned",
    },
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
}

export async function POST(req: NextRequest) {
  let payload = "";
  try {
    payload = await req.text();
  } catch {
    payload = "";
  }

  const sig = String(req.headers.get("stripe-signature") ?? "").trim();
  if (!sig) return json({ ok: false, error: "missing_signature" }, { status: 400 });

  let stripe: Stripe;
  try {
    stripe = getStripe() as any;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: msg }, { status: 500 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(payload, sig, getWebhookSecret());
  } catch {
    return json({ ok: false, error: "invalid_signature" }, { status: 400 });
  }

  let supabase: ReturnType<typeof getSupabaseAdmin>;
  try {
    supabase = getSupabaseAdmin();
  } catch {
    return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
  }

  const initialInsert = await registerWebhookEvent({
    supabase,
    event,
    companyId: null,
    status: "received",
    errorMessage: null,
    payloadSummary: {
      customer_id: extractCustomerId(event),
      subscription_id: extractSubscriptionId(event),
    },
  });
  if (!initialInsert.ok) return json({ ok: false, error: initialInsert.error }, { status: 500 });
  if (initialInsert.duplicate) return json({ ok: true, duplicate: true }, { status: 200 });

  const customerId = extractCustomerId(event);
  if (!customerId) {
    await updateWebhookEvent({ supabase, eventId: event.id, patch: { status: "processed_no_customer" } });
    return json({ ok: true }, { status: 200 });
  }

  const company = await findCompanyByCustomerId(supabase, customerId);
  if (!company?.id) {
    await updateWebhookEvent({ supabase, eventId: event.id, patch: { status: "processed_no_company", payload_summary: { customer_id: customerId } } });
    return json({ ok: true }, { status: 200 });
  }

  await updateWebhookEvent({ supabase, eventId: event.id, patch: { company_id: company.id, status: "processing" } });

  const lastCreatedAt = asString(company.billing_last_event_created_at);
  const lastMs = lastCreatedAt ? Date.parse(lastCreatedAt) : NaN;
  const curMs = eventCreatedMs(event);
  if (Number.isFinite(lastMs) && curMs < lastMs) {
    await updateWebhookEvent({ supabase, eventId: event.id, patch: { status: "skipped_out_of_order" } });
    return json({ ok: true, skipped: "out_of_order" }, { status: 200 });
  }

  const type = String(event.type ?? "").trim();

  try {
    if (type === "checkout.session.expired") {
      const session = event.data.object as any;
      const sessionId = asString(session?.id);
      const origin = asString(session?.metadata?.origin);
      const planKey = asString(session?.metadata?.plan_key);
      const userId = asString(session?.metadata?.user_id);
      const patch: any = {
        stripe_customer_id: customerId,
        checkout_url: null,
        checkout_status: "expired",
        checkout_plan: null,
        checkout_abandoned_at: new Date().toISOString(),
        subscription_updated_at: new Date().toISOString(),
      };
      if (sessionId) patch.stripe_checkout_session_id = sessionId;
      const r = await supabase.from("companies").update(patch).eq("id", company.id);
      if (r.error) throw new Error(r.error.message);
      await bumpEventMarker({ supabase, companyId: company.id, event });
      await maybeEnqueueCheckoutAbandoned({
        supabase,
        companyId: company.id,
        customerId,
        userId,
        checkoutSessionId: sessionId,
        planKey,
        origin,
        trialEndsAt: asString(company.trial_ends_at),
        checkoutUrl: null,
      });
      await updateWebhookEvent({ supabase, eventId: event.id, patch: { status: "processed" } });
      return json({ ok: true }, { status: 200 });
    }

    if (type === "checkout.session.completed") {
      const session = event.data.object as any;
      const sessionId = asString(session?.id);
      const subscriptionId = extractSubscriptionId(event);
      const patch: any = {
        stripe_customer_id: customerId,
        checkout_status: "completed",
        checkout_url: null,
        checkout_plan: null,
        subscription_updated_at: new Date().toISOString(),
      };
      if (sessionId) patch.stripe_checkout_session_id = sessionId;
      if (subscriptionId) patch.stripe_subscription_id = subscriptionId;
      const r = await supabase.from("companies").update(patch).eq("id", company.id);
      if (r.error) throw new Error(r.error.message);

      if (subscriptionId) {
        const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ["items.data.price"] });
        await updateCompanyFromSubscription({ supabase, customerId, subscription: sub });
      }
      await bumpEventMarker({ supabase, companyId: company.id, event });
      await updateWebhookEvent({ supabase, eventId: event.id, patch: { status: "processed" } });
      return json({ ok: true }, { status: 200 });
    }

    if (type.startsWith("customer.subscription.")) {
      const sub = event.data.object as Stripe.Subscription;
      const cid = asString((sub as any)?.customer) ?? customerId;
      await updateCompanyFromSubscription({ supabase, customerId: cid, subscription: sub });
      await bumpEventMarker({ supabase, companyId: company.id, event });
      await updateWebhookEvent({ supabase, eventId: event.id, patch: { status: "processed" } });
      return json({ ok: true }, { status: 200 });
    }

    if (type.startsWith("invoice.")) {
      const invoice = event.data.object as any;
      const subscriptionId = asString(invoice?.subscription);
      if (subscriptionId) {
        const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ["items.data.price"] });
        const cid = asString(sub.customer) ?? customerId;
        await updateCompanyFromSubscription({ supabase, customerId: cid, subscription: sub });
      } else {
        const priceId = asString(invoice?.lines?.data?.[0]?.price?.id) ?? null;
        const planKey = planKeyFromPriceId(priceId);
        const patch: any = {
          stripe_customer_id: customerId,
          stripe_price_id: priceId,
          subscription_plan: planKey,
          subscription_updated_at: new Date().toISOString(),
        };
        const r = await supabase.from("companies").update(patch).eq("id", company.id);
        if (r.error) throw new Error(r.error.message);
      }
      await bumpEventMarker({ supabase, companyId: company.id, event });
      await updateWebhookEvent({ supabase, eventId: event.id, patch: { status: "processed" } });
      return json({ ok: true }, { status: 200 });
    }

    await bumpEventMarker({ supabase, companyId: company.id, event });
    await updateWebhookEvent({ supabase, eventId: event.id, patch: { status: "processed_ignored" } });
    return json({ ok: true }, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateWebhookEvent({ supabase, eventId: event.id, patch: { status: "failed", error_message: msg } });
    return json({ ok: false, error: "processing_failed" }, { status: 500 });
  }
}
