import { NextResponse } from "next/server";
import { getSupabaseAuthConfig } from "../../../lib/supabaseAuthConfig";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return NextResponse.json(data, { ...init, headers });
}

export async function POST(req: Request) {
  let body: { access_token?: string; password?: string } = {};
  try {
    body = (await req.json()) as { access_token?: string; password?: string };
  } catch {
    return json({ error: "invalid_json" }, { status: 400 });
  }

  const accessToken = (body.access_token ?? "").trim();
  const password = (body.password ?? "").trim();
  if (!accessToken) return json({ error: "missing_access_token" }, { status: 400 });
  if (!password) return json({ error: "missing_password" }, { status: 400 });

  let cfg;
  try {
    cfg = getSupabaseAuthConfig();
  } catch {
    return json({ error: "server_not_configured" }, { status: 500 });
  }

  const res = await fetch(`${cfg.url.replace(/\/+$/, "")}/auth/v1/user`, {
    method: "PUT",
    headers: {
      apikey: cfg.anonKey,
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ password }),
  });

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    return json({ error: "update_failed", details: text.slice(0, 800) }, { status: 400 });
  }

  return json({ ok: true }, { status: 200 });
}

