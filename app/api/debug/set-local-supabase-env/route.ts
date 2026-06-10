import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync } from "fs";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return NextResponse.json(data, { ...init, headers });
}

function stripLineBreaks(value: string) {
  return String(value ?? "").replace(/[\r\n]+/g, "").trim();
}

function upsertEnvFile(filePath: string, vars: Record<string, string | undefined>) {
  const keys = Object.keys(vars).filter((k) => typeof k === "string" && k.trim());
  if (keys.length === 0) return;

  let existing = "";
  try {
    existing = readFileSync(filePath, "utf8");
  } catch {
    existing = "";
  }

  const lines = existing ? existing.split(/\r?\n/) : [];
  const indexByKey = new Map<string, number>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (m?.[1]) indexByKey.set(m[1], i);
  }

  const setLine = (k: string, v: string) => `${k}="${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

  for (const k of keys) {
    const v = vars[k];
    if (typeof v !== "string" || !v.trim()) continue;
    const line = setLine(k, v.trim());
    const idx = indexByKey.get(k);
    if (typeof idx === "number") lines[idx] = line;
    else lines.push(line);
  }

  const out = lines.join("\n").replace(/\n{3,}/g, "\n\n");
  writeFileSync(filePath, out.endsWith("\n") ? out : `${out}\n`, "utf8");
}

function isEnabled(req: NextRequest) {
  if (process.env.NODE_ENV === "production") return false;
  const host = String(req.headers.get("host") ?? "").toLowerCase();
  if (!host.includes("localhost") && !host.includes("127.0.0.1")) return false;
  return true;
}

export async function POST(req: NextRequest) {
  if (!isEnabled(req)) return json({ ok: false, error: "disabled" }, { status: 403 });

  let body: { supabaseUrl?: string; supabaseAnonKey?: string; supabaseServiceRoleKey?: string } = {};
  try {
    body = (await req.json()) as { supabaseUrl?: string; supabaseAnonKey?: string; supabaseServiceRoleKey?: string };
  } catch {
    return json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const supabaseUrl = stripLineBreaks(body.supabaseUrl ?? "");
  const supabaseAnonKey = stripLineBreaks(body.supabaseAnonKey ?? "");
  const supabaseServiceRoleKey = stripLineBreaks(body.supabaseServiceRoleKey ?? "");

  if (!supabaseUrl) return json({ ok: false, error: "missing_supabase_url" }, { status: 400 });
  if (!supabaseAnonKey) return json({ ok: false, error: "missing_supabase_anon_key" }, { status: 400 });

  upsertEnvFile(".env.local", {
    SUPABASE_URL: supabaseUrl,
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
    SUPABASE_ANON_KEY: supabaseAnonKey,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: supabaseAnonKey,
    ...(supabaseServiceRoleKey ? { SUPABASE_SERVICE_ROLE_KEY: supabaseServiceRoleKey } : {}),
  });

  return json({ ok: true }, { status: 200 });
}

