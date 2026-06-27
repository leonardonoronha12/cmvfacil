import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, ".env.local");
const OUT_DIR = path.join(ROOT, "tools", "bubble-obj", "out");

function nowIso() {
  return new Date().toISOString();
}

function readDotenv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, "utf8");
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (v.length >= 2) {
      const a = v.charCodeAt(0);
      const b = v.charCodeAt(v.length - 1);
      if ((a === 34 && b === 34) || (a === 39 && b === 39)) v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function requiredEnv(env, name) {
  const v = String(env[name] ?? "").trim();
  if (!v) throw new Error(`missing_env:${name}`);
  return v;
}

function parseArgs(argv) {
  const args = { site: "", email: "" };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--site") args.site = String(argv[i + 1] ?? "");
    if (a === "--email") args.email = String(argv[i + 1] ?? "");
  }
  args.site = String(args.site || "").trim().replace(/\/+$/g, "");
  args.email = String(args.email || "").trim().toLowerCase();
  if (!args.site) throw new Error("missing_arg:--site");
  if (!args.email) throw new Error("missing_arg:--email");
  return args;
}

function parseLinkTokenHash(actionLink) {
  const s = String(actionLink ?? "").trim();
  if (!s) return "";
  const q = s.includes("?") ? s.split("?", 2)[1] : "";
  if (!q) return "";
  const params = new URLSearchParams(q);
  return String(params.get("token_hash") ?? params.get("token") ?? "").trim();
}

async function getSessionForEmail(admin, anon, email) {
  let lastErr = null;
  for (let i = 0; i < 6; i++) {
    const gen = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (gen.error) {
      lastErr = gen.error;
      continue;
    }
    const tokenHash = parseLinkTokenHash(gen.data?.properties?.action_link);
    if (!tokenHash) {
      lastErr = new Error("missing_token_hash");
      continue;
    }
    const v = await anon.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
    if (v.error) {
      lastErr = v.error;
      continue;
    }
    const session = v.data?.session || null;
    if (!session?.access_token) {
      lastErr = new Error("missing_access_token");
      continue;
    }
    return session;
  }
  throw new Error(String(lastErr?.message ?? lastErr ?? "unable_to_get_session"));
}

function cookieFromSession(session) {
  const accessToken = String(session?.access_token ?? "").trim();
  if (!accessToken) return "";
  return `cmv_at=${accessToken}`;
}

async function httpJson(url, init) {
  const timeoutMs = Math.max(1000, Math.min(90_000, Number(init?.timeoutMs ?? 15_000)));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, cache: "no-store", signal: controller.signal });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = { _raw: text };
    }
    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const env = readDotenv(ENV_PATH);
  const url = requiredEnv(env, "SUPABASE_URL");
  const anonKey = requiredEnv(env, "SUPABASE_ANON_KEY");
  const serviceRoleKey = requiredEnv(env, "SUPABASE_SERVICE_ROLE_KEY");
  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const session = await getSessionForEmail(admin, anon, args.email);
  const cookie = cookieFromSession(session);
  const origin = args.site;
  const ts = Date.now();

  const repair = await httpJson(`${args.site}/api/bubble-obj/migration/repair-states?ts=${ts}`, {
    method: "POST",
    headers: { cookie, origin, "content-type": "application/json" },
    body: JSON.stringify({}),
    timeoutMs: 90_000,
  });

  const validate = await httpJson(`${args.site}/api/bubble-obj/migration/validate?ts=${ts + 1}`, {
    method: "POST",
    headers: { cookie, origin, "content-type": "application/json" },
    body: JSON.stringify({}),
    timeoutMs: 90_000,
  });

  const status = await httpJson(`${args.site}/api/bubble-obj/migration/status?ts=${ts + 2}`, {
    method: "GET",
    headers: { cookie, origin },
    timeoutMs: 30_000,
  });

  const out = { ok: true, ts: nowIso(), site: args.site, email: args.email, repair, validate, status };
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, `repair_probe_${args.email.replace(/[^a-z0-9@._+-]+/g, "_")}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
}

main().catch((err) => {
  const msg = err instanceof Error ? err.stack || err.message : String(err);
  process.stderr.write(`${msg}\n`);
  process.exit(1);
});

