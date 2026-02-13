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

  const secret = (Deno.env.get("CONTACT_TEST_SECRET") ?? "").trim();
  const sent = (req.headers.get("x-test-secret") ?? "").trim();
  if (!secret || !sent || !timingSafeEqual(secret, sent)) return json({ error: "unauthorized" }, { status: 401 });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("PROJECT_URL") ?? "";
  const supabaseServiceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !supabaseServiceRole) return json({ error: "server_not_configured" }, { status: 500 });

  const supabase = createClient(supabaseUrl, supabaseServiceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const email = `test+race-${crypto.randomUUID()}@cmvfacil.dev`;
  const phone1 = "+5511999999999";
  const phone2 = "+5511888888888";

  const p1 = supabase.rpc("upsert_contact", {
    p_source: "race-test",
    p_external_id: null,
    p_email: email,
    p_phone_e164: phone1,
    p_first_name: "Teste",
    p_last_name: "Race",
    p_consent_email: true,
    p_consent_whatsapp: true,
    p_raw: { test: true, n: 1 },
  });
  const p2 = supabase.rpc("upsert_contact", {
    p_source: "race-test",
    p_external_id: null,
    p_email: email,
    p_phone_e164: phone2,
    p_first_name: "Teste",
    p_last_name: "Race",
    p_consent_email: true,
    p_consent_whatsapp: true,
    p_raw: { test: true, n: 2 },
  });

  const [r1, r2] = await Promise.all([p1, p2]);

  if (r1.error) return json({ error: "rpc1_failed", details: r1.error.message }, { status: 500 });
  if (r2.error) return json({ error: "rpc2_failed", details: r2.error.message }, { status: 500 });

  return json({ ok: true, email, id1: r1.data, id2: r2.data, same: r1.data === r2.data });
});

