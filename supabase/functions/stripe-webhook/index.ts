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

function hexToBytes(hex: string) {
  const clean = hex.trim().toLowerCase();
  if (clean.length % 2 !== 0) throw new Error("invalid_hex");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
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

function parseStripeSignatureHeader(header: string) {
  const parts = header
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  let timestamp: string | null = null;
  const signatures: string[] = [];
  for (const p of parts) {
    const [k, v] = p.split("=").map((x) => x.trim());
    if (!k || !v) continue;
    if (k === "t") timestamp = v;
    if (k === "v1") signatures.push(v);
  }
  return { timestamp, signatures };
}

async function verifyStripeSignature(params: { payload: string; header: string; secret: string }) {
  const { payload, header, secret } = params;
  const parsed = parseStripeSignatureHeader(header);
  if (!parsed.timestamp || parsed.signatures.length === 0) return false;

  const signedPayload = `${parsed.timestamp}.${payload}`;
  const expected = await hmacSha256Hex(secret, signedPayload);

  for (const sig of parsed.signatures) {
    try {
      const a = hexToBytes(expected);
      const b = hexToBytes(sig);
      if (a.length === b.length) {
        const ok = timingSafeEqual(expected, sig);
        if (ok) return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

type StripeEvent = {
  id: string;
  type: string;
  data?: { object?: unknown };
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function extractEmailFromEventObject(obj: unknown) {
  if (!isRecord(obj)) return null;
  const customerDetails = isRecord(obj.customer_details) ? obj.customer_details : null;
  const email =
    (typeof obj.customer_email === "string" && obj.customer_email.trim()) ||
    (customerDetails && typeof customerDetails.email === "string" && customerDetails.email.trim()) ||
    null;
  return email ? email.toLowerCase() : null;
}

function extractContactIdFromMetadata(obj: unknown) {
  if (!isRecord(obj)) return null;
  const metadata = isRecord(obj.metadata) ? obj.metadata : null;
  const contactId = metadata && typeof metadata.contact_id === "string" ? metadata.contact_id.trim() : "";
  return contactId || null;
}

function extractSubscriptionStatus(obj: unknown) {
  if (!isRecord(obj)) return null;
  const status = typeof obj.status === "string" ? obj.status.trim().toLowerCase() : "";
  return status || null;
}

function isTrialOrActiveSubscriptionStatus(status: string | null) {
  return status === "trialing" || status === "active";
}

function shouldMarkFreeActive(evtType: string) {
  return evtType === "checkout.session.completed" || evtType === "customer.subscription.created" || evtType === "customer.subscription.updated";
}

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, { status: 405 });

  const webhookSecret = (Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "").trim();
  if (!webhookSecret) return json({ error: "server_not_configured" }, { status: 500 });

  const sigHeader = req.headers.get("stripe-signature") ?? "";
  if (!sigHeader) return json({ error: "missing_signature" }, { status: 400 });

  const payloadText = await req.text();
  const ok = await verifyStripeSignature({ payload: payloadText, header: sigHeader, secret: webhookSecret });
  if (!ok) return json({ error: "invalid_signature" }, { status: 400 });

  let evt: StripeEvent;
  try {
    evt = JSON.parse(payloadText) as StripeEvent;
  } catch {
    return json({ error: "invalid_json" }, { status: 400 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("PROJECT_URL") ?? "";
  const supabaseServiceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !supabaseServiceRole) {
    return json({ error: "server_not_configured" }, { status: 500 });
  }

  const obj = isRecord(evt.data) ? evt.data.object : null;
  const contactId = extractContactIdFromMetadata(obj);
  const email = extractEmailFromEventObject(obj);
  const subscriptionStatus = extractSubscriptionStatus(obj);

  const supabase = createClient(supabaseUrl, supabaseServiceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (shouldMarkFreeActive(evt.type)) {
    if (evt.type.startsWith("customer.subscription.") && !isTrialOrActiveSubscriptionStatus(subscriptionStatus)) {
      return json({ ok: true, received: evt.id, type: evt.type, ignored: true });
    }
    if (contactId) {
      await supabase.rpc("set_contact_stripe_free_active", { p_contact_id: contactId, p_active: true });
    } else if (email) {
      await supabase.rpc("set_contact_stripe_free_active_by_email", { p_email: email, p_active: true });
    }
  }

  return json({ ok: true, received: evt.id, type: evt.type });
});
