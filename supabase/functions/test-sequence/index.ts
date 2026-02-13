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

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, { status: 405 });

  const secret = (Deno.env.get("TEST_SEQUENCE_SECRET") ?? "").trim();
  const sent = (req.headers.get("x-test-secret") ?? "").trim();
  if (!secret || !sent || !timingSafeEqual(secret, sent)) return json({ error: "unauthorized" }, { status: 401 });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("PROJECT_URL") ?? "";
  const supabaseServiceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !supabaseServiceRole) return json({ error: "server_not_configured" }, { status: 500 });

  const supabase = createClient(supabaseUrl, supabaseServiceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const email = `test+seq-${crypto.randomUUID()}@cmvfacil.dev`;
  const { data: contactId, error: upsertError } = await supabase.rpc("upsert_contact", {
    p_source: "sequence-test",
    p_external_id: null,
    p_email: email,
    p_phone_e164: null,
    p_first_name: "Teste",
    p_last_name: "Sequencia",
    p_consent_email: true,
    p_consent_whatsapp: false,
    p_raw: { test: true, kind: "sequence" },
  });

  if (upsertError || !contactId) return json({ error: "contact_upsert_failed", details: upsertError?.message ?? "unknown" }, { status: 500 });

  const payload = {
    contact: {
      id: contactId,
      source: "sequence-test",
      external_id: null,
      email,
      phone_e164: null,
      first_name: "Teste",
      last_name: "Sequencia",
      consent_email: true,
      consent_whatsapp: false,
    },
    raw: { test: true, kind: "sequence" },
  };

  const { error: insertError } = await supabase.from("bravo_outbox").insert({
    contact_id: contactId,
    event_type: "contact_upsert",
    payload,
    status: "pending",
    next_attempt_at: new Date().toISOString(),
  });

  if (insertError) return json({ error: "outbox_insert_failed", details: insertError.message }, { status: 500 });

  const { data: rows, error: listError } = await supabase
    .from("bravo_outbox")
    .select("id,event_type,status,next_attempt_at,created_at,dedupe_key")
    .eq("contact_id", contactId)
    .order("id", { ascending: true });

  if (listError) return json({ error: "outbox_list_failed", details: listError.message }, { status: 500 });

  return json({ ok: true, contact_id: contactId, email, outbox: rows ?? [] });
});

