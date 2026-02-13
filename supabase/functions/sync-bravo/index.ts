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

function backoffSeconds(attempts: number) {
  const steps = [60, 5 * 60, 15 * 60, 60 * 60, 6 * 60 * 60, 24 * 60 * 60];
  return steps[Math.min(Math.max(attempts, 0), steps.length - 1)];
}

type OutboxRow = {
  id: number;
  contact_id: string;
  event_type: string;
  payload: unknown;
  attempts: number;
  sent_count: number;
};

type MessageTemplate = {
  email_subject: string | null;
  email_body: string | null;
  whatsapp_body: string | null;
  twilio_content_sids: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

type ExtractedContact = {
  contactId: string;
  email: string | null;
  phoneE164: string | null;
  firstName: string | null;
  lastName: string | null;
  source: string | null;
  externalId: string | null;
  consentEmail: boolean | null;
  consentWhatsapp: boolean | null;
  raw: unknown;
};

function extractContact(row: OutboxRow): ExtractedContact {
  const payload = isRecord(row.payload) ? row.payload : {};
  const contact = isRecord(payload.contact) ? payload.contact : {};
  const raw = payload.raw ?? row.payload;

  const email = typeof contact.email === "string" && contact.email.trim().length ? contact.email.trim() : null;
  const phoneE164 =
    typeof contact.phone_e164 === "string" && contact.phone_e164.trim().length ? contact.phone_e164.trim() : null;
  const firstName =
    typeof contact.first_name === "string" && contact.first_name.trim().length ? contact.first_name.trim() : null;
  const lastName =
    typeof contact.last_name === "string" && contact.last_name.trim().length ? contact.last_name.trim() : null;
  const source = typeof contact.source === "string" && contact.source.trim().length ? contact.source.trim() : null;
  const externalId =
    typeof contact.external_id === "string" && contact.external_id.trim().length ? contact.external_id.trim() : null;
  const consentEmail = typeof contact.consent_email === "boolean" ? contact.consent_email : null;
  const consentWhatsapp = typeof contact.consent_whatsapp === "boolean" ? contact.consent_whatsapp : null;

  return {
    contactId: row.contact_id,
    email,
    phoneE164,
    firstName,
    lastName,
    source,
    externalId,
    consentEmail,
    consentWhatsapp,
    raw,
  };
}

function sanitizeEventName(value: string) {
  const v = value.trim().slice(0, 255);
  const cleaned = v.replace(/[^a-zA-Z0-9_-]/g, "_");
  return cleaned.length ? cleaned : "event";
}

function parseBrevoListIds(): number[] {
  const raw = (Deno.env.get("BREVO_LIST_IDS") ?? Deno.env.get("BREVO_LIST_ID") ?? "").trim();
  if (!raw) return [];
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  const ids = parts.map((p) => Number(p)).filter((n) => Number.isFinite(n) && n > 0);
  return Array.from(new Set(ids));
}

async function fetchJsonOrText(res: Response) {
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return await res.json().catch(() => ({}));
  return await res.text().catch(() => "");
}

async function brevoApiRequest(method: "GET" | "POST", path: string, body?: unknown) {
  const apiKey = (Deno.env.get("BREVO_API_KEY") ?? "").trim();
  if (!apiKey) throw new Error("BREVO_API_KEY_not_set");

  const baseUrl = (Deno.env.get("BREVO_BASE_URL") ?? "https://api.brevo.com/v3").replace(/\/+$/, "");
  const url = `${baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;

  const res = await fetch(url, {
    method,
    headers: {
      "accept": "application/json",
      "api-key": apiKey,
      ...(method === "POST" ? { "content-type": "application/json" } : {}),
    },
    ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
  });

  if (!res.ok) {
    const details = await fetchJsonOrText(res);
    throw new Error(`brevo_http_${res.status}:${typeof details === "string" ? details.slice(0, 500) : JSON.stringify(details).slice(0, 500)}`);
  }

  if (res.status === 204) return null;
  return await fetchJsonOrText(res);
}

async function brevoRequest(path: string, body: unknown) {
  await brevoApiRequest("POST", path, body);
}

async function postToBravoWebhook(body: unknown) {
  const url = Deno.env.get("BRAVO_INGEST_URL") ?? "";
  if (!url) throw new Error("BRAVO_INGEST_URL_not_set");

  const headers: Record<string, string> = { "content-type": "application/json" };
  const apiKey = Deno.env.get("BRAVO_API_KEY") ?? "";
  if (apiKey) headers["authorization"] = `Bearer ${apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`bravo_http_${res.status}:${text.slice(0, 500)}`);
  }
}

async function deliverOutbox(row: OutboxRow, template: MessageTemplate | null) {
  const provider = (Deno.env.get("BRAVO_PROVIDER") ?? "").trim().toLowerCase();
  const hasWebhook = (Deno.env.get("BRAVO_INGEST_URL") ?? "").trim().length > 0;
  const hasBrevo = (Deno.env.get("BREVO_API_KEY") ?? "").trim().length > 0;
  const emailProvider = (Deno.env.get("EMAIL_PROVIDER") ?? "brevo").trim().toLowerCase();
  const brevoMode = (Deno.env.get("BREVO_DELIVERY_MODE") ?? "events").trim().toLowerCase();

  if (provider === "twilio") {
    const c = extractContact(row);
    const body = template?.whatsapp_body?.trim() ?? "";
    const canWhatsapp = Boolean(c.phoneE164) && (c.consentWhatsapp ?? true);
    if (canWhatsapp) {
      if (!body) throw new Error("whatsapp_body_missing");
      const fromTemplate = template?.twilio_content_sids?.trim() ?? "";
      const envList = (Deno.env.get("TWILIO_CONTENT_SIDS") ?? "").trim();
      const list = parseTwilioContentSids(fromTemplate || envList);
      const chosen = pickContentSid(list, `${row.contact_id}|${row.event_type}`);
      await twilioSendWhatsApp({ toE164: c.phoneE164!, body, contentSid: chosen });
    }
    return;
  }

  if (provider === "brevo" || (!provider && hasBrevo)) {
    const c = extractContact(row);
    const envEventName = (Deno.env.get("BREVO_EVENT_NAME") ?? "").trim();
    const rawEventName = envEventName.includes("{event_type}")
      ? envEventName.replaceAll("{event_type}", row.event_type ?? "")
      : envEventName || row.event_type || "contact_upsert";
    const eventName = sanitizeEventName(rawEventName);

    const listIds = parseBrevoListIds();
    const attributes: Record<string, unknown> = {};
    if (c.firstName) attributes["FIRSTNAME"] = c.firstName;
    if (c.lastName) attributes["LASTNAME"] = c.lastName;
    if (c.phoneE164) {
      attributes["SMS"] = c.phoneE164;
      attributes["WHATSAPP"] = c.phoneE164;
    }

    await brevoRequest("/contacts", {
      email: c.email ?? undefined,
      attributes,
      listIds: listIds.length ? listIds : undefined,
      updateEnabled: true,
      ext_id: c.contactId,
    });

    if (brevoMode === "transactional") {
      const canEmail = Boolean(c.email) && (c.consentEmail ?? true);
      const subject = template?.email_subject?.trim() ?? "";
      const body = template?.email_body?.trim() ?? "";
      if (canEmail && subject && body) {
        if (emailProvider === "resend") {
          await resendSendEmail({ toEmail: c.email!, subject, body });
        } else {
          await brevoSendTransactionalEmail({
            toEmail: c.email!,
            toName: [c.firstName, c.lastName].filter(Boolean).join(" ") || undefined,
            subject,
            body,
            tag: eventName,
          });
        }
      }
      return;
    }

    await brevoRequest("/events", {
      event_name: eventName,
      identifiers: {
        ext_id: c.contactId,
        ...(c.email ? { email_id: c.email } : {}),
      },
      contact_properties: attributes,
      event_properties: {
        event_type: row.event_type,
        source: c.source,
        external_id: c.externalId,
        consent_email: c.consentEmail,
        consent_whatsapp: c.consentWhatsapp,
        raw: c.raw,
        message_template: template,
      },
    });
    return;
  }

  if (hasWebhook) {
    await postToBravoWebhook({ event_type: row.event_type, contact_id: row.contact_id, payload: row.payload });
    return;
  }

  throw new Error("no_bravo_provider_configured");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

type BrevoSender = { name?: string; email: string } | { id: number };

async function resolveBrevoSender(): Promise<BrevoSender> {
  const senderEmail = (Deno.env.get("BREVO_SENDER_EMAIL") ?? "").trim();
  const senderName = (Deno.env.get("BREVO_SENDER_NAME") ?? "").trim();
  if (senderEmail) {
    return { email: senderEmail, ...(senderName ? { name: senderName } : {}) };
  }

  const raw = await brevoApiRequest("GET", "/senders");
  const senders = (raw && typeof raw === "object" && raw !== null && Array.isArray((raw as Record<string, unknown>).senders))
    ? ((raw as Record<string, unknown>).senders as unknown[])
    : [];
  for (const s of senders) {
    if (typeof s !== "object" || s === null) continue;
    const email = typeof (s as Record<string, unknown>).email === "string" ? ((s as Record<string, unknown>).email as string).trim() : "";
    const active = Boolean((s as Record<string, unknown>).active);
    const name = typeof (s as Record<string, unknown>).name === "string" ? ((s as Record<string, unknown>).name as string).trim() : "";
    if (email && active) return { email, ...(name ? { name } : {}) };
  }

  for (const s of senders) {
    if (typeof s !== "object" || s === null) continue;
    const email = typeof (s as Record<string, unknown>).email === "string" ? ((s as Record<string, unknown>).email as string).trim() : "";
    const name = typeof (s as Record<string, unknown>).name === "string" ? ((s as Record<string, unknown>).name as string).trim() : "";
    if (email) return { email, ...(name ? { name } : {}) };
  }

  throw new Error("brevo_sender_not_configured");
}

async function brevoSendTransactionalEmail(params: {
  toEmail: string;
  toName?: string;
  subject: string;
  body: string;
  tag?: string;
}) {
  const sender = await resolveBrevoSender();
  const htmlBody = `<pre style="white-space:pre-wrap;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.4">${escapeHtml(params.body)}</pre>`;
  await brevoApiRequest("POST", "/smtp/email", {
    sender,
    to: [{ email: params.toEmail, ...(params.toName ? { name: params.toName } : {}) }],
    subject: params.subject,
    textContent: params.body,
    htmlContent: htmlBody,
    ...(params.tag ? { tags: [params.tag] } : {}),
  });
}

async function resendSendEmail(params: { toEmail: string; subject: string; body: string }) {
  const apiKey = (Deno.env.get("RESEND_API_KEY") ?? "").trim();
  const from = (Deno.env.get("RESEND_FROM") ?? "").trim();
  if (!apiKey) throw new Error("RESEND_API_KEY_not_set");
  if (!from) throw new Error("RESEND_FROM_not_set");

  const url = (Deno.env.get("RESEND_BASE_URL") ?? "https://api.resend.com").replace(/\/+$/, "") + "/emails";
  const html = `<pre style="white-space:pre-wrap;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.4">${escapeHtml(params.body)}</pre>`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "accept": "application/json",
      "authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from,
      to: [params.toEmail],
      subject: params.subject,
      text: params.body,
      html,
    }),
  });

  if (!res.ok) {
    const details = await fetchJsonOrText(res);
    throw new Error(`resend_http_${res.status}:${typeof details === "string" ? details.slice(0, 500) : JSON.stringify(details).slice(0, 500)}`);
  }
}

function base64BasicAuth(username: string, password: string) {
  return btoa(`${username}:${password}`);
}

function ensureWhatsAppPrefix(value: string) {
  const v = value.trim();
  if (!v) return v;
  if (v.toLowerCase().startsWith("whatsapp:")) return v;
  return `whatsapp:${v}`;
}

function parseTwilioContentSids(value: string) {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function hash32(value: string) {
  let h = 5381;
  for (let i = 0; i < value.length; i++) {
    h = ((h << 5) + h) ^ value.charCodeAt(i);
  }
  return h >>> 0;
}

function pickContentSid(sids: string[], stableKey: string) {
  if (!sids.length) return "";
  if (sids.length === 1) return sids[0] ?? "";
  const idx = hash32(stableKey) % sids.length;
  return sids[idx] ?? sids[0] ?? "";
}

async function twilioSendWhatsApp(params: { toE164: string; body: string; contentSid?: string }) {
  const accountSid = (Deno.env.get("TWILIO_ACCOUNT_SID") ?? "").trim();
  const authToken = (Deno.env.get("TWILIO_AUTH_TOKEN") ?? "").trim();
  const from = (Deno.env.get("TWILIO_WHATSAPP_FROM") ?? "").trim();
  if (!accountSid) throw new Error("TWILIO_ACCOUNT_SID_not_set");
  if (!authToken) throw new Error("TWILIO_AUTH_TOKEN_not_set");
  if (!from) throw new Error("TWILIO_WHATSAPP_FROM_not_set");

  const contentSid = (params.contentSid ?? "").trim() || (Deno.env.get("TWILIO_CONTENT_SID") ?? "").trim();
  const contentVar1 = (Deno.env.get("TWILIO_CONTENT_VAR_1") ?? "1").trim() || "1";

  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
  const form = new URLSearchParams();
  form.set("From", ensureWhatsAppPrefix(from));
  form.set("To", ensureWhatsAppPrefix(params.toE164));
  if (contentSid) {
    form.set("ContentSid", contentSid);
    form.set("ContentVariables", JSON.stringify({ [contentVar1]: params.body }));
  } else {
    form.set("Body", params.body);
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "authorization": `Basic ${base64BasicAuth(accountSid, authToken)}`,
      "content-type": "application/x-www-form-urlencoded",
      "accept": "application/json",
    },
    body: form.toString(),
  });

  if (!res.ok) {
    const details = await fetchJsonOrText(res);
    throw new Error(`twilio_http_${res.status}:${typeof details === "string" ? details.slice(0, 500) : JSON.stringify(details).slice(0, 500)}`);
  }
}

async function shouldRepeatFreePlanReminder(supabase: ReturnType<typeof createClient>, contactId: string) {
  const { data, error } = await supabase
    .from("contacts")
    .select("stripe_free_active")
    .eq("id", contactId)
    .maybeSingle();

  if (error) throw new Error(`contact_load_failed:${error.message}`);
  const active = Boolean((data as { stripe_free_active?: boolean } | null)?.stripe_free_active);
  return !active;
}

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, { status: 405 });

  const urlObj = new URL(req.url);
  const sentSecret = urlObj.searchParams.get("key") ?? req.headers.get("x-worker-secret") ?? "";

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("PROJECT_URL") ?? "";
  const supabaseServiceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !supabaseServiceRole) {
    return json({ error: "server_not_configured" }, { status: 500 });
  }

  const limit = Number(urlObj.searchParams.get("limit") ?? "25");
  const supabase = createClient(supabaseUrl, supabaseServiceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
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

  if (!envSecret && !appSecret) return json({ error: "server_not_configured" }, { status: 500 });

  const authorized =
    Boolean(sentSecret) &&
    ((Boolean(envSecret) && timingSafeEqual(envSecret, sentSecret)) ||
      (Boolean(appSecret) && timingSafeEqual(appSecret, sentSecret)));

  if (!authorized) return json({ error: "unauthorized" }, { status: 401 });

  const { data: claimed, error: claimError } = await supabase.rpc("claim_bravo_outbox", {
    p_limit: Number.isFinite(limit) ? Math.max(1, Math.min(100, limit)) : 25,
  });

  if (claimError) return json({ error: "claim_failed", details: claimError.message }, { status: 500 });

  const rows = (claimed ?? []) as OutboxRow[];
  const results: Array<{ id: number; ok: boolean; error?: string }> = [];

  const templateCache = new Map<string, MessageTemplate | null>();

  for (const row of rows) {
    try {
      let template = templateCache.get(row.event_type);
      if (template === undefined) {
        const { data, error } = await supabase
          .from("automation_messages")
          .select("email_subject,email_body,whatsapp_body,twilio_content_sids")
          .eq("event_type", row.event_type)
          .maybeSingle();

        if (error) throw new Error(`template_load_failed:${error.message}`);
        template = (data as MessageTemplate | null) ?? null;
        templateCache.set(row.event_type, template);
      }

      if (row.event_type === "plan.free_pending" || row.event_type === "plan.free_pending_2" || row.event_type === "plan.free_pending_3" || row.event_type === "plan.free_pending_4" || row.event_type === "plan.free_pending_5") {
        const repeat = await shouldRepeatFreePlanReminder(supabase, row.contact_id);
        if (!repeat) {
          await supabase.from("bravo_outbox").update({ status: "sent", last_error: null }).eq("id", row.id);
          results.push({ id: row.id, ok: true });
          continue;
        }

        await deliverOutbox(row, template);
        await supabase
          .from("bravo_outbox")
          .update({ status: "sent", sent_count: (row.sent_count ?? 0) + 1, last_sent_at: new Date().toISOString(), last_error: null })
          .eq("id", row.id);
      } else {
        await deliverOutbox(row, template);
        await supabase.from("bravo_outbox").update({ status: "sent", last_error: null }).eq("id", row.id);
      }
      results.push({ id: row.id, ok: true });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const nextAttemptAt = new Date(Date.now() + backoffSeconds((row.attempts ?? 0) + 1) * 1000).toISOString();
      await supabase
        .from("bravo_outbox")
        .update({
          status: "pending",
          attempts: (row.attempts ?? 0) + 1,
          last_error: message.slice(0, 500),
          next_attempt_at: nextAttemptAt,
        })
        .eq("id", row.id);
      results.push({ id: row.id, ok: false, error: message });
    }
  }

  return json({ ok: true, processed: rows.length, results });
});
