import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, ".env.local");
const OUT_DIR = path.join(ROOT, "tools", "bubble-obj", "out");

function nowIso() {
  return new Date().toISOString();
}

function safeEmail(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9@._+-]+/g, "_")
    .slice(0, 120);
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

function readEnv(env, name) {
  const v = env[name] ?? process.env[name];
  return typeof v === "string" ? v.trim() : "";
}

function requiredEnv(env, name) {
  const v = readEnv(env, name);
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

function createSupabaseClients() {
  const env = readDotenv(ENV_PATH);
  const url = requiredEnv(env, "SUPABASE_URL");
  const anonKey = requiredEnv(env, "SUPABASE_ANON_KEY");
  const serviceRoleKey = requiredEnv(env, "SUPABASE_SERVICE_ROLE_KEY");
  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return { admin, anon };
}

function parseLinkTokenHash(actionLink) {
  const s = String(actionLink ?? "").trim();
  if (!s) return "";
  const q = s.includes("?") ? s.split("?", 2)[1] : "";
  const params = new URLSearchParams(q);
  return String(params.get("token_hash") ?? params.get("token") ?? "").trim();
}

async function getSessionForEmail(admin, anon, email) {
  let lastErr = null;
  for (let i = 0; i < 5; i++) {
    let gen;
    try {
      gen = await admin.auth.admin.generateLink({ type: "magiclink", email });
    } catch (err) {
      lastErr = err;
      process.stderr.write(`generateLink_error:${String(err?.message ?? err)}\n`);
      continue;
    }
    if (gen?.error) {
      lastErr = gen.error;
      process.stderr.write(`generateLink_error:${String(gen.error?.message ?? gen.error)}\n`);
      continue;
    }
    const tokenHash = parseLinkTokenHash(gen?.data?.properties?.action_link);
    if (!tokenHash) {
      lastErr = new Error("missing_token_hash");
      process.stderr.write(`generateLink_error:missing_token_hash\n`);
      continue;
    }
    let v;
    try {
      v = await anon.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
    } catch (err) {
      lastErr = err;
      process.stderr.write(`verifyOtp_error:${String(err?.message ?? err)}\n`);
      continue;
    }
    if (v?.error) {
      lastErr = v.error;
      process.stderr.write(`verifyOtp_error:${String(v.error?.message ?? v.error)}\n`);
      continue;
    }
    const session = v?.data?.session || null;
    if (!session?.access_token) {
      lastErr = new Error("missing_access_token");
      process.stderr.write(`verifyOtp_error:missing_access_token\n`);
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
  const timeoutMs = Math.max(1000, Math.min(30_000, Number(init?.timeoutMs ?? 10_000)));
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

function findDivergences(validateJson) {
  const report = validateJson?.validationReport || validateJson?.report || null;
  const perType = Array.isArray(report?.perType) ? report.perType : [];
  const list = [];
  for (const x of perType) {
    const ok = Boolean(x?.ok);
    const ignored = Boolean(x?.ignored);
    if (ok || ignored) continue;
    const objectType = String(x?.objectType ?? "");
    const bubbleTotal = x?.bubble?.total ?? null;
    const bubbleError = String(x?.bubble?.error ?? "");
    const dbTotal = x?.db?.total ?? null;
    const dbError = String(x?.db?.error ?? "");
    const diff = x?.diff ?? null;
    list.push({ objectType, bubbleTotal, bubbleError, dbTotal, dbError, diff });
  }
  return list;
}

async function main() {
  const args = parseArgs(process.argv);
  const { admin, anon } = createSupabaseClients();
  const session = await getSessionForEmail(admin, anon, args.email);
  const cookie = cookieFromSession(session);
  const origin = args.site;
  const ts = Date.now();

  const statusRes = await httpJson(`${args.site}/api/bubble-obj/migration/status?ts=${ts}`, {
    method: "GET",
    headers: { cookie, origin },
    timeoutMs: 15_000,
  });

  const validateRes = await httpJson(`${args.site}/api/bubble-obj/migration/validate`, {
    method: "POST",
    headers: { cookie, origin, "content-type": "application/json" },
    body: JSON.stringify({}),
    timeoutMs: 60_000,
  });

  const statusAfterRes = await httpJson(`${args.site}/api/bubble-obj/migration/status?ts=${ts + 1}`, {
    method: "GET",
    headers: { cookie, origin },
    timeoutMs: 15_000,
  });

  const out = {
    ok: true,
    ts: nowIso(),
    site: args.site,
    email: args.email,
    status: statusRes,
    validate: validateRes,
    statusAfterValidate: statusAfterRes,
    derived: {
      migrationStatus: String(statusRes?.json?.migration?.status ?? ""),
      validationStatus: String(statusRes?.json?.migration?.validation?.status ?? ""),
      lastRunId: String(statusRes?.json?.migration?.lastRunId ?? ""),
      divergences: findDivergences(validateRes?.json),
    },
  };

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, `probe_${safeEmail(args.email)}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");

  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
}

main().catch((err) => {
  const msg = err instanceof Error ? err.stack || err.message : String(err);
  process.stderr.write(`${msg}\n`);
  process.exit(1);
});
