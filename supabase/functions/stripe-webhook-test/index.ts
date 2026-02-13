import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function timingSafeEqual(a: string, b: string) {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}

async function hmacSha256Hex(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  const bytes = new Uint8Array(sig);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Body = {
  email?: string;
  first_name?: string;
  last_name?: string;
  event_type?: "checkout.session.completed" | "customer.subscription.created" | "customer.subscription.updated";
  subscription_status?: "trialing" | "active" | "canceled" | "incomplete";
  create_contact?: boolean;
};

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, { status: 405 });

  const testSecret = (Deno.env.get("STRIPE_WEBHOOK_TEST_SECRET") ?? "").trim();
  const sentSecret = (req.headers.get("x-test-secret") ?? "").trim();
  if (!testSecret || !sentSecret || !timingSafeEqual(testSecret, sentSecret)) {
    return json({ error: "unauthorized" }, { status: 401 });
  }

  const stripeWebhookSecret = (Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "").trim();
  if (!stripeWebhookSecret) return json({ error: "stripe_webhook_not_configured" }, { status: 500 });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("PROJECT_URL") ?? "";
  const supabaseServiceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !supabaseServiceRole) return json({ error: "server_not_configured" }, { status: 500 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ error: "invalid_json" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const eventType = body.event_type ?? "checkout.session.completed";
  const subscriptionStatus = body.subscription_status ?? "trialing";

  const supabase = createClient(supabaseUrl, supabaseServiceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let contactId: string | null = null;
  if (body.create_contact) {
    const { data, error } = await supabase.rpc("upsert_contact", {
      p_source: "stripe-webhook-test",
      p_external_id: null,
      p_email: email || null,
      p_phone_e164: null,
      p_first_name: body.first_name ?? null,
      p_last_name: body.last_name ?? null,
      p_consent_email: true,
      p_consent_whatsapp: false,
      p_raw: { source: "stripe-webhook-test" },
    });
    if (error) return json({ error: "contact_upsert_failed", details: error.message }, { status: 500 });
    contactId = typeof data === "string" ? data : String(data);

    await supabase.rpc("enqueue_free_plan_pending_reminder", {
      p_contact_id: contactId,
      p_payload: { contact: { id: contactId, email }, raw: { source: "stripe-webhook-test" } },
    });
  }

  const stripeEvent = {
    id: `evt_test_${crypto.randomUUID()}`,
    type: eventType,
    data: {
      object:
        eventType.startsWith("customer.subscription.")
          ? {
              status: subscriptionStatus,
              customer_email: email || null,
              metadata: { ...(contactId ? { contact_id: contactId } : {}) },
            }
          : {
              customer_email: email || null,
              metadata: { ...(contactId ? { contact_id: contactId } : {}) },
              customer_details: { email: email || null },
            },
    },
  };

  const payloadText = JSON.stringify(stripeEvent);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = await hmacSha256Hex(stripeWebhookSecret, `${timestamp}.${payloadText}`);
  const sigHeader = `t=${timestamp},v1=${signature}`;

  const stripeWebhookUrl = `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/stripe-webhook`;
  const res = await fetch(stripeWebhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": sigHeader },
    body: payloadText,
  });
  const webhookText = await res.text().catch(() => "");

  let contactRow: unknown = null;
  let reminderRow: unknown = null;
  if (contactId) {
    const { data: c } = await supabase.from("contacts").select("id,email,stripe_free_active").eq("id", contactId).maybeSingle();
    contactRow = c ?? null;

    const { data: o } = await supabase
      .from("bravo_outbox")
      .select("id,event_type,status,next_attempt_at,sent_count,last_error")
      .eq("contact_id", contactId)
      .eq("event_type", "plan.free_pending")
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    reminderRow = o ?? null;
  }

  return json({
    ok: true,
    called: "stripe-webhook",
    status: res.status,
    response: webhookText,
    contact: contactRow,
    reminder: reminderRow,
  });
});

