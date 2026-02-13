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

function normalizeEmail(email: unknown): string | null {
  if (typeof email !== "string") return null;
  const v = email.trim().toLowerCase();
  if (!v.length) return null;
  if (v.length > 254) return null;
  const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  return ok ? v : null;
}

function normalizePhoneE164(phone: unknown): string | null {
  if (typeof phone !== "string") return null;
  const raw = phone.trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  let normalized = "";
  if (raw.startsWith("+")) normalized = `+${digits}`;
  else if (digits.startsWith("00") && digits.length > 2) normalized = `+${digits.slice(2)}`;
  else if (digits.startsWith("55")) normalized = `+${digits}`;
  else if (digits.length === 10 || digits.length === 11) normalized = `+55${digits}`;
  else normalized = `+${digits}`;

  const len = normalized.replace(/\D/g, "").length;
  if (len < 11 || len > 15) return null;
  if (normalized.startsWith("+55")) {
    const br = normalized.replace(/\D/g, "").slice(2);
    if (!(br.length === 10 || br.length === 11)) return null;
  }
  return normalized;
}

async function bestEffortTriggerSync(supabaseUrl: string, workerSecret: string) {
  if (!workerSecret) return { attempted: false };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2500);
  try {
    const url = `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/sync-bravo`;
    await fetch(url, {
      method: "POST",
      headers: { "x-worker-secret": workerSecret },
      signal: controller.signal,
    });
    return { attempted: true };
  } catch {
    return { attempted: true };
  } finally {
    clearTimeout(timeoutId);
  }
}

type IngestBody = {
  source?: string;
  external_id?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  whatsapp?: string;
  consent_email?: boolean;
  consent_whatsapp?: boolean;
  raw?: unknown;
  event_type?: string;
};

serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, { status: 405 });
  }

  const webhookSecret = Deno.env.get("WEBHOOK_SECRET") ?? "";
  const sentSecret = req.headers.get("x-webhook-secret") ?? "";
  if (!webhookSecret || !timingSafeEqual(webhookSecret, sentSecret)) {
    return json({ error: "unauthorized" }, { status: 401 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("PROJECT_URL") ?? "";
  const supabaseServiceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !supabaseServiceRole) {
    return json({ error: "server_not_configured" }, { status: 500 });
  }

  let body: IngestBody;
  try {
    body = (await req.json()) as IngestBody;
  } catch {
    return json({ error: "invalid_json" }, { status: 400 });
  }

  const email = normalizeEmail(body.email);
  const phoneE164 = normalizePhoneE164(body.whatsapp);
  if (!email && !phoneE164) {
    return json({ error: "missing_contact" }, { status: 400 });
  }

  const source = typeof body.source === "string" && body.source.trim().length ? body.source.trim() : "bubble";
  const externalId =
    typeof body.external_id === "string" && body.external_id.trim().length ? body.external_id.trim() : null;

  const firstName = typeof body.first_name === "string" ? body.first_name : null;
  const lastName = typeof body.last_name === "string" ? body.last_name : null;
  const consentEmail = typeof body.consent_email === "boolean" ? body.consent_email : false;
  const consentWhatsapp = typeof body.consent_whatsapp === "boolean" ? body.consent_whatsapp : false;

  const raw = typeof body.raw === "object" && body.raw !== null ? body.raw : body;
  const eventType = typeof body.event_type === "string" && body.event_type.trim().length ? body.event_type.trim() : "contact.upsert";

  const supabase = createClient(supabaseUrl, supabaseServiceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: contactId, error: upsertError } = await supabase.rpc("upsert_contact", {
    p_source: source,
    p_external_id: externalId,
    p_email: email,
    p_phone_e164: phoneE164,
    p_first_name: firstName,
    p_last_name: lastName,
    p_consent_email: consentEmail,
    p_consent_whatsapp: consentWhatsapp,
    p_raw: raw,
  });

  if (upsertError || !contactId) {
    return json(
      { error: "upsert_failed", details: upsertError?.message ?? "unknown" },
      { status: 500 },
    );
  }

  const payload = {
    contact: {
      id: contactId,
      source,
      external_id: externalId,
      email,
      phone_e164: phoneE164,
      first_name: firstName,
      last_name: lastName,
      consent_email: consentEmail,
      consent_whatsapp: consentWhatsapp,
    },
    raw,
  };

  const { data: outboxId, error: outboxError } = await supabase.rpc("enqueue_bravo_event", {
    p_contact_id: contactId,
    p_event_type: eventType,
    p_payload: payload,
  });

  if (outboxError || !outboxId) {
    return json(
      { error: "enqueue_failed", details: outboxError?.message ?? "unknown" },
      { status: 500 },
    );
  }

  const startDelayMinutes = Number.parseInt((Deno.env.get("FREE_PLAN_SEQUENCE_START_DELAY_MINUTES") ?? "15").trim(), 10);
  const stepMinutes = Number.parseInt((Deno.env.get("FREE_PLAN_SEQUENCE_STEP_MINUTES") ?? "1440").trim(), 10);
  await supabase.rpc("enqueue_free_plan_pending_sequence_v2", {
    p_contact_id: contactId,
    p_payload: payload,
    p_start_delay_minutes: Number.isFinite(startDelayMinutes) ? startDelayMinutes : 15,
    p_step_minutes: Number.isFinite(stepMinutes) ? stepMinutes : 1440,
  });

  const envSecret = (Deno.env.get("WORKER_SECRET") ?? "").trim();
  const appSecret = String(
    (
      await supabase
        .rpc("get_app_secret", { p_name: "sync_worker_secret" })
        .then((r) => r.data ?? "")
        .catch(() => "")
    ),
  ).trim();
  const sync = await bestEffortTriggerSync(supabaseUrl, appSecret || envSecret);
  return json({ ok: true, contact_id: contactId, outbox_id: outboxId, sync_triggered: sync.attempted });
});
