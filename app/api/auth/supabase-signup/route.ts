import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAuthConfig } from "../../../lib/supabaseAuthConfig";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return NextResponse.json(data, { ...init, headers });
}

export async function POST(req: Request) {
  let body: {
    email?: string;
    password?: string;
    first_name?: string;
    last_name?: string;
    cpf?: string;
    whatsapp?: string;
  } = {};

  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: "invalid_json" }, { status: 400 });
  }

  const email = (body.email ?? "").trim();
  const password = (body.password ?? "").trim();
  if (!email || !password) return json({ error: "missing_fields" }, { status: 400 });

  let cfg;
  try {
    cfg = getSupabaseAuthConfig();
  } catch {
    return json({ error: "server_not_configured" }, { status: 500 });
  }

  const supabase = createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        first_name: (body.first_name ?? "").trim() || null,
        last_name: (body.last_name ?? "").trim() || null,
        cpf: (body.cpf ?? "").trim() || null,
        whatsapp: (body.whatsapp ?? "").trim() || null,
      },
    },
  });

  if (error) {
    return json({ error: "signup_failed", details: error.message }, { status: 400 });
  }

  return json({ ok: true }, { status: 200 });
}

