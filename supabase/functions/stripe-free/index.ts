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

type Body = {
  email?: string;
  contact_id?: string;
  free_active?: boolean;
};

serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, { status: 405 });
  }

  const adminSecret = (Deno.env.get("ADMIN_SECRET") ?? "").trim();
  const sentSecret = (req.headers.get("x-admin-secret") ?? "").trim();
  if (!adminSecret || !sentSecret || !timingSafeEqual(adminSecret, sentSecret)) {
    return json({ error: "unauthorized" }, { status: 401 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("PROJECT_URL") ?? "";
  const supabaseServiceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !supabaseServiceRole) {
    return json({ error: "server_not_configured" }, { status: 500 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ error: "invalid_json" }, { status: 400 });
  }

  const active = typeof body.free_active === "boolean" ? body.free_active : true;
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const contactId = typeof body.contact_id === "string" ? body.contact_id.trim() : "";

  if (!email && !contactId) {
    return json({ error: "missing_identifier" }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (contactId) {
    const { data, error } = await supabase.rpc("set_contact_stripe_free_active", {
      p_contact_id: contactId,
      p_active: active,
    });
    if (error) return json({ error: "update_failed", details: error.message }, { status: 500 });
    return json({ ok: true, contact_id: data });
  }

  const { data, error } = await supabase.rpc("set_contact_stripe_free_active_by_email", {
    p_email: email,
    p_active: active,
  });
  if (error) return json({ error: "update_failed", details: error.message }, { status: 500 });
  if (!data) return json({ error: "contact_not_found" }, { status: 404 });
  return json({ ok: true, contact_id: data });
});

