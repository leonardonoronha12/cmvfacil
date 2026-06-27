import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, ".env.local");
const BUBBLE_DEBUG_PATH = path.join(ROOT, ".bubble-debug.local.json");
const BUBBLE_ENV_LOCAL_PATH = path.join(ROOT, ".bubble.env.local");
const OUT_PATH = path.join(ROOT, "tools", "bubble-obj", "out", "direct_run.json");
const DEFAULT_TIMEOUT_USER_MS = 120_000;
const DEFAULT_TIMEOUT_ENSURE_MS = 65_000;
const DEFAULT_TIMEOUT_STATUS_MS = 15_000;
const DEFAULT_TIMEOUT_VALIDATE_MS = 65_000;
const DEFAULT_MAX_POLL_ATTEMPTS = 20;
const DEFAULT_POLL_INTERVAL_MS = 1500;
const DEFAULT_ENSURE_PARAMS = { callBudgetMs: 15000, maxPages: 10, maxTicks: 10, processLimit: 250, maxProcessTotal: 600 };
const STAGED_ONLY_BASE_TYPES = new Set(["etiquetas", "ingredientes", "itens_lista_compras", "qtd_compra_real", "faturamentos"]);

function writeOut(obj) {
  const dir = path.dirname(OUT_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(OUT_PATH, `${JSON.stringify(obj, null, 2)}\n`, "utf8");
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

function requireEnv(env, key) {
  const v = String(env[key] || "").trim();
  if (!v) throw new Error(`missing_env:${key}`);
  return v;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function nowIso() {
  return new Date().toISOString();
}

function logEvent(ev) {
  const out = { ts: nowIso(), ...ev };
  console.log(JSON.stringify(out));
}

function parseObjectType(objectType) {
  const raw = String(objectType ?? "").trim();
  const withoutScope = raw.includes("#") ? raw.split("#", 1)[0] : raw;
  const parts = withoutScope.split("@");
  const baseType = String(parts[0] ?? "").trim();
  const companyId = String(parts[1] ?? "").trim() || null;
  return { objectType: raw, baseType, companyId };
}

function deepEqualShallowNumbers(a, b) {
  const aa = a && typeof a === "object" ? a : {};
  const bb = b && typeof b === "object" ? b : {};
  const ka = Object.keys(aa).sort();
  const kb = Object.keys(bb).sort();
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] !== kb[i]) return false;
    const va = Number(aa[ka[i]] ?? 0);
    const vb = Number(bb[kb[i]] ?? 0);
    if (va !== vb) return false;
  }
  return true;
}

function parseLinkTokenHash(actionLink) {
  const s = String(actionLink ?? "").trim();
  if (!s) return "";
  const q = s.includes("?") ? s.split("?", 2)[1] : "";
  if (!q) return "";
  const params = new URLSearchParams(q);
  return String(params.get("token_hash") ?? params.get("token") ?? "").trim();
}

function formatSupabaseErr(err) {
  if (!err) return "unknown_error";
  const msg = String(err?.message ?? "").trim();
  const status = err?.status != null ? String(err.status) : "";
  const code = err?.code != null ? String(err.code) : "";
  const more = (() => {
    try {
      const keys = Object.getOwnPropertyNames(err);
      const j = JSON.stringify(err, keys);
      return String(j ?? "").trim();
    } catch {
      return "";
    }
  })();
  return [msg || more || String(err), status ? `status=${status}` : "", code ? `code=${code}` : ""].filter(Boolean).join(" | ");
}

async function getSessionForEmail(admin, anon, email) {
  let lastGenErr = null;
  for (let i = 0; i < 5; i++) {
    const gen = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (!gen.error) {
      const hashed = String(gen.data?.properties?.hashed_token ?? "").trim();
      const tokenHash = hashed || parseLinkTokenHash(gen.data?.action_link);
      if (!tokenHash) throw new Error(`missing_token_hash_from_generate_link:${email}`);
      let lastVerifyErr = null;
      for (let j = 0; j < 5; j++) {
        const verifyPayload = { type: "magiclink", token_hash: tokenHash };
        const verified = await anon.auth.verifyOtp(verifyPayload);
        if (!verified.error && verified.data?.session) return verified.data.session;
        lastVerifyErr = verified.error;
        const st = Number(lastVerifyErr?.status ?? 0);
        const transient = st === 429 || st === 500 || st === 502 || st === 503 || st === 504;
        if (!transient) break;
        await sleep(750 * (j + 1));
      }
      if (String(lastVerifyErr?.code ?? "").trim().toLowerCase() === "otp_expired") {
        lastGenErr = lastVerifyErr;
        await sleep(750 * (i + 1));
        continue;
      }
      throw new Error(
        `verify_otp_failed:${email}:${formatSupabaseErr(lastVerifyErr) || "no_session"}:payload_keys=${Object.keys({ type: "magiclink", token_hash: tokenHash }).join(",")}`,
      );
    }
    lastGenErr = gen.error;
    await sleep(750 * (i + 1));
  }
  throw new Error(`generate_link:${email}:${formatSupabaseErr(lastGenErr)}`);
}

function toCookieFromSession(session) {
  const at = String(session?.access_token ?? "").trim();
  if (!at) throw new Error("missing_access_token");
  const rt = String(session?.refresh_token ?? "").trim();
  return rt ? `cmv_at=${at}; cmv_rt=${rt}` : `cmv_at=${at}`;
}

async function httpJson(url, { method = "GET", cookie = "", body = null, origin = "", timeoutMs = 0, stage = "" } = {}) {
  let res;
  const controller = timeoutMs && timeoutMs > 0 ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    res = await fetch(url, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        origin: origin || "http://localhost:3000",
        ...(method !== "GET" ? { "content-type": "application/json" } : {}),
      },
      body: body == null ? undefined : JSON.stringify(body),
      cache: "no-store",
      ...(controller ? { signal: controller.signal } : {}),
    });
  } catch (err) {
    if (timer) clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    const st = stage ? `${stage}:` : "";
    throw new Error(`fetch_failed:${st}${method}:${String(url ?? "")}:${msg}`);
  }
  if (timer) clearTimeout(timer);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { ok: res.ok, status: res.status, json };
}

async function authedHttpJson(admin, anon, email, url, opts, cookieRef) {
  const res1 = await httpJson(url, { ...opts, cookie: cookieRef.value });
  if (res1.status !== 401) return res1;
  const session = await getSessionForEmail(admin, anon, email);
  cookieRef.value = toCookieFromSession(session);
  return await httpJson(url, { ...opts, cookie: cookieRef.value });
}

async function countRows(sb, table, userIdCol, userId) {
  let lastErr = null;
  for (let i = 0; i < 4; i++) {
    const { count, error } = await sb.from(table).select("*", { count: "exact", head: true }).eq(userIdCol, userId);
    if (!error) return typeof count === "number" ? count : 0;
    lastErr = error;
    await sleep(500 * (i + 1));
  }
  const msg = String(lastErr?.message ?? "").trim() || JSON.stringify(lastErr);
  throw new Error(`count:${table}:${msg}`);
}

async function deleteByUserId(sb, table, userIdCol, userId) {
  let lastErr = null;
  for (let i = 0; i < 4; i++) {
    const { error } = await sb.from(table).delete().eq(userIdCol, userId);
    if (!error) return { table, deleted: null };
    lastErr = error;
    await sleep(500 * (i + 1));
  }
  const msg = String(lastErr?.message ?? "").trim() || JSON.stringify(lastErr);
  throw new Error(`delete:${table}:${msg}`);
}

async function deleteRunsForUser(sb, userId) {
  let lastErr = null;
  for (let i = 0; i < 4; i++) {
    const { error: delErr } = await sb.from("bubble_obj_import_run").delete().eq("triggered_by_supabase_user_id", userId);
    if (!delErr) return { table: "bubble_obj_import_run", deleted: null };
    lastErr = delErr;
    await sleep(500 * (i + 1));
  }
  const msg = String(lastErr?.message ?? "").trim() || JSON.stringify(lastErr);
  throw new Error(`delete:bubble_obj_import_run:${msg}`);
}

function userScopePrefix(userId) {
  return `user:${String(userId ?? "").trim()}:`;
}

async function countByIdPrefix(sb, table, idPrefix) {
  let lastErr = null;
  for (let i = 0; i < 4; i++) {
    const { count, error } = await sb.from(table).select("id", { count: "exact", head: true }).like("id", `${idPrefix}%`);
    if (!error) return typeof count === "number" ? count : 0;
    lastErr = error;
    await sleep(500 * (i + 1));
  }
  const msg = String(lastErr?.message ?? "").trim() || JSON.stringify(lastErr);
  throw new Error(`count_prefix:${table}:${msg}`);
}

async function deleteByIdPrefix(sb, table, idPrefix) {
  const before = await countByIdPrefix(sb, table, idPrefix);
  if (before === 0) return { table, deleted: 0 };
  const { error } = await sb.from(table).delete().like("id", `${idPrefix}%`);
  if (error) throw new Error(`delete_prefix:${table}:${error.message}`);
  const after = await countByIdPrefix(sb, table, idPrefix);
  return { table, deleted: Math.max(0, before - after), before, after };
}

async function deleteByExactId(sb, table, id) {
  const { count, error } = await sb.from(table).select("id", { count: "exact", head: true }).eq("id", id);
  if (error) throw new Error(`count_id:${table}:${error.message}`);
  const before = typeof count === "number" ? count : 0;
  if (!before) return { table, deleted: 0 };
  const { error: delErr } = await sb.from(table).delete().eq("id", id);
  if (delErr) throw new Error(`delete_id:${table}:${delErr.message}`);
  const { count: afterCount, error: afterErr } = await sb.from(table).select("id", { count: "exact", head: true }).eq("id", id);
  if (afterErr) throw new Error(`count_after_id:${table}:${afterErr.message}`);
  const after = typeof afterCount === "number" ? afterCount : 0;
  return { table, deleted: Math.max(0, before - after), before, after };
}

async function snapshotFinalCounts(sb, userId) {
  const out = {};
  const stateId = userScopePrefix(userId).slice(0, -1);
  const ins = await sb.from("insumos_state").select("payload").eq("id", stateId).maybeSingle();
  const insRows = Array.isArray(ins.data?.payload?.rows) ? ins.data.payload.rows : [];
  out.insumos_rows = Array.isArray(insRows) ? insRows.length : 0;

  const forn = await sb.from("fornecedores_state").select("info").eq("id", stateId).maybeSingle();
  const info = forn.data?.info && typeof forn.data.info === "object" ? forn.data.info : {};
  const uniq = new Set();
  for (const v of Object.values(info)) {
    const nome = String(v?.fornecedor ?? "").trim().toUpperCase();
    if (nome) uniq.add(nome);
  }
  out.fornecedores = uniq.size;

  out.inventarios = await countByIdPrefix(sb, "inventario", `${userScopePrefix(userId)}inventario:`);
  out.entradas = await countByIdPrefix(sb, "entradas", `${userScopePrefix(userId)}entrada:`);
  out.desperdicios = await countByIdPrefix(sb, "desperdicios", `${userScopePrefix(userId)}desperdicio:`);
  return out;
}

function summarizePerType(perTypeLive) {
  const list = Array.isArray(perTypeLive) ? perTypeLive : [];
  const migrated = [];
  const stagedOnly = [];
  const retrying = [];
  for (const it of list) {
    const objectType = String(it?.objectType ?? "").trim();
    if (!objectType) continue;
    const baseType = String(parseObjectType(objectType).baseType ?? "").trim().toLowerCase();
    const status = String(it?.status ?? "");
    const received = Number(it?.received ?? 0) || 0;
    const savedStaging = Number(it?.savedStaging ?? 0) || 0;
    const processed = Number(it?.processed ?? 0) || 0;
    const lastError = String(it?.lastError ?? "").trim();
    const row = { objectType, baseType, status, received, savedStaging, processed, lastError };
    if (status === "retrying") retrying.push(row);
    if (STAGED_ONLY_BASE_TYPES.has(baseType)) stagedOnly.push(row);
    if (!STAGED_ONLY_BASE_TYPES.has(baseType) && (received > 0 || savedStaging > 0 || processed > 0)) migrated.push(row);
  }
  return { migrated, stagedOnly, retrying };
}

function parseArgs(argv) {
  const args = {
    site: "",
    emails: [],
    reset: false,
    timeoutUserMs: DEFAULT_TIMEOUT_USER_MS,
    timeoutEnsureMs: DEFAULT_TIMEOUT_ENSURE_MS,
    timeoutStatusMs: DEFAULT_TIMEOUT_STATUS_MS,
    timeoutValidateMs: DEFAULT_TIMEOUT_VALIDATE_MS,
    maxPollAttempts: DEFAULT_MAX_POLL_ATTEMPTS,
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    ensureParams: { ...DEFAULT_ENSURE_PARAMS },
  };
  for (let i = 2; i < argv.length; i++) {
    const a = String(argv[i] ?? "");
    if (a === "--site") args.site = String(argv[i + 1] ?? "");
    if (a === "--email") args.emails.push(String(argv[i + 1] ?? ""));
    if (a === "--reset") args.reset = true;
    if (a === "--timeoutUserMs") args.timeoutUserMs = Number(argv[i + 1] ?? args.timeoutUserMs);
    if (a === "--timeoutEnsureMs") args.timeoutEnsureMs = Number(argv[i + 1] ?? args.timeoutEnsureMs);
    if (a === "--timeoutStatusMs") args.timeoutStatusMs = Number(argv[i + 1] ?? args.timeoutStatusMs);
    if (a === "--timeoutValidateMs") args.timeoutValidateMs = Number(argv[i + 1] ?? args.timeoutValidateMs);
    if (a === "--maxPollAttempts") args.maxPollAttempts = Number(argv[i + 1] ?? args.maxPollAttempts);
    if (a === "--pollIntervalMs") args.pollIntervalMs = Number(argv[i + 1] ?? args.pollIntervalMs);
    if (a === "--ensureMaxPages") args.ensureParams.maxPages = Number(argv[i + 1] ?? args.ensureParams.maxPages);
    if (a === "--ensureMaxTicks") args.ensureParams.maxTicks = Number(argv[i + 1] ?? args.ensureParams.maxTicks);
    if (a === "--ensureProcessLimit") args.ensureParams.processLimit = Number(argv[i + 1] ?? args.ensureParams.processLimit);
    if (a === "--ensureMaxProcessTotal") args.ensureParams.maxProcessTotal = Number(argv[i + 1] ?? args.ensureParams.maxProcessTotal);
    if (a === "--ensureCallBudgetMs") args.ensureParams.callBudgetMs = Number(argv[i + 1] ?? args.ensureParams.callBudgetMs);
  }
  args.site = String(args.site || "").trim().replace(/\/+$/, "");
  args.emails = args.emails.map((x) => String(x || "").trim().toLowerCase()).filter(Boolean);
  return args;
}

function findStringByKey(obj, keyRe) {
  const seen = new Set();
  const stack = [{ path: "", value: obj }];
  while (stack.length) {
    const cur = stack.pop();
    const v = cur.value;
    if (!v || typeof v !== "object") continue;
    if (seen.has(v)) continue;
    seen.add(v);
    for (const [k, val] of Object.entries(v)) {
      if (typeof val === "string" && keyRe.test(k)) {
        const s = String(val ?? "").trim();
        if (s) return s;
      }
      if (val && typeof val === "object") stack.push({ path: `${cur.path}.${k}`, value: val });
    }
  }
  return "";
}

async function main() {
  const args = parseArgs(process.argv);
  args.timeoutUserMs = Number.isFinite(args.timeoutUserMs) && args.timeoutUserMs > 0 ? Math.floor(args.timeoutUserMs) : DEFAULT_TIMEOUT_USER_MS;
  args.timeoutEnsureMs = Number.isFinite(args.timeoutEnsureMs) && args.timeoutEnsureMs > 0 ? Math.floor(args.timeoutEnsureMs) : DEFAULT_TIMEOUT_ENSURE_MS;
  args.timeoutStatusMs = Number.isFinite(args.timeoutStatusMs) && args.timeoutStatusMs > 0 ? Math.floor(args.timeoutStatusMs) : DEFAULT_TIMEOUT_STATUS_MS;
  args.timeoutValidateMs = Number.isFinite(args.timeoutValidateMs) && args.timeoutValidateMs > 0 ? Math.floor(args.timeoutValidateMs) : DEFAULT_TIMEOUT_VALIDATE_MS;
  args.maxPollAttempts = Number.isFinite(args.maxPollAttempts) && args.maxPollAttempts > 0 ? Math.floor(args.maxPollAttempts) : DEFAULT_MAX_POLL_ATTEMPTS;
  args.pollIntervalMs = Number.isFinite(args.pollIntervalMs) && args.pollIntervalMs > 0 ? Math.floor(args.pollIntervalMs) : DEFAULT_POLL_INTERVAL_MS;
  args.ensureParams.maxPages =
    Number.isFinite(args.ensureParams.maxPages) && args.ensureParams.maxPages > 0 ? Math.min(20, Math.floor(args.ensureParams.maxPages)) : DEFAULT_ENSURE_PARAMS.maxPages;
  args.ensureParams.maxTicks =
    Number.isFinite(args.ensureParams.maxTicks) && args.ensureParams.maxTicks > 0 ? Math.min(50, Math.floor(args.ensureParams.maxTicks)) : DEFAULT_ENSURE_PARAMS.maxTicks;
  args.ensureParams.processLimit =
    Number.isFinite(args.ensureParams.processLimit) && args.ensureParams.processLimit > 0
      ? Math.min(1000, Math.floor(args.ensureParams.processLimit))
      : DEFAULT_ENSURE_PARAMS.processLimit;
  args.ensureParams.maxProcessTotal =
    Number.isFinite(args.ensureParams.maxProcessTotal) && args.ensureParams.maxProcessTotal > 0
      ? Math.min(5000, Math.floor(args.ensureParams.maxProcessTotal))
      : DEFAULT_ENSURE_PARAMS.maxProcessTotal;
  args.ensureParams.callBudgetMs =
    Number.isFinite(args.ensureParams.callBudgetMs) && args.ensureParams.callBudgetMs > 0
      ? Math.min(20_000, Math.floor(args.ensureParams.callBudgetMs))
      : DEFAULT_ENSURE_PARAMS.callBudgetMs;
  const env = { ...readDotenv(ENV_PATH), ...process.env };
  const supabaseUrl = requireEnv(env, "SUPABASE_URL");
  const anonKey = requireEnv(env, "SUPABASE_ANON_KEY");
  const serviceKey = requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY");

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const anon = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const site = args.site || String(env.BUBBLE_OBJ_SITE_URL || "").trim().replace(/\/+$/, "") || "http://localhost:3000";
  const origin = (() => {
    try {
      return new URL(site).origin;
    } catch {
      return "http://localhost:3000";
    }
  })();

  if (fs.existsSync(BUBBLE_ENV_LOCAL_PATH)) {
    const envBubble = readDotenv(BUBBLE_ENV_LOCAL_PATH);
    const baseUrl = String(envBubble.BUBBLE_BASE_URL ?? "").trim();
    const token = String(envBubble.BUBBLE_API_TOKEN ?? "").trim();
    if (baseUrl && token) {
      await admin.from("bubble_global_config").upsert({ id: "global", base_url: baseUrl, api_token: token }, { onConflict: "id" });
    }
  }

  if (origin.includes("localhost") || origin.includes("127.0.0.1")) {
    try {
      const health = await httpJson(`${origin}/api/health/bubble-config`, { method: "GET", origin });
      const activeResolved = Boolean(health.ok && health.json?.ok && health.json?.active?.resolved);
      if (!activeResolved && fs.existsSync(BUBBLE_DEBUG_PATH)) {
        const raw = fs.readFileSync(BUBBLE_DEBUG_PATH, "utf8");
        let parsed = null;
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = readDotenv(BUBBLE_DEBUG_PATH);
        }
        const baseUrlDirect =
          String(parsed?.baseUrl ?? parsed?.BUBBLE_BASE_URL ?? parsed?.bubbleBaseUrl ?? parsed?.bubble_base_url ?? "").trim() ||
          String(parsed?.global?.baseUrl ?? parsed?.global?.BUBBLE_BASE_URL ?? "").trim();
        const tokenDirect =
          String(parsed?.token ?? parsed?.BUBBLE_API_TOKEN ?? parsed?.bubbleApiToken ?? parsed?.bubble_api_token ?? "").trim() ||
          String(parsed?.global?.token ?? parsed?.global?.BUBBLE_API_TOKEN ?? "").trim();

        const baseUrl =
          baseUrlDirect ||
          findStringByKey(parsed, /bubble.*(base|url)/i) ||
          findStringByKey(parsed, /(base_url|bubble_base_url)/i);
        const token =
          tokenDirect ||
          findStringByKey(parsed, /bubble.*(token|api)/i) ||
          findStringByKey(parsed, /(api_token|bubble_api_token)/i);
        const baseUrlText =
          String((raw.match(/BUBBLE_BASE_URL\s*[:=]\s*["']?([^"'\\r\\n]+)["']?/i) || [])[1] || "").trim() ||
          String((raw.match(/base[_ ]?url\s*[:=]\s*["']?([^"'\\r\\n]+)["']?/i) || [])[1] || "").trim();
        const tokenText =
          String((raw.match(/BUBBLE_API_TOKEN\s*[:=]\s*["']?([^"'\\r\\n]+)["']?/i) || [])[1] || "").trim() ||
          String((raw.match(/api[_ ]?token\s*[:=]\s*["']?([^"'\\r\\n]+)["']?/i) || [])[1] || "").trim() ||
          String((raw.match(/token\s*[:=]\s*["']?([^"'\\r\\n]+)["']?/i) || [])[1] || "").trim();
        const resolvedBaseUrl = baseUrl || baseUrlText || "https://api.app.cmvfacil.com";
        const resolvedToken = token || tokenText;
        if (resolvedBaseUrl && resolvedToken) {
          await admin.from("bubble_global_config").upsert({ id: "global", base_url: resolvedBaseUrl, api_token: resolvedToken }, { onConflict: "id" });
        }
      }
      const health2 = await httpJson(`${origin}/api/health/bubble-config`, { method: "GET", origin });
      const activeResolved2 = Boolean(health2.ok && health2.json?.ok && health2.json?.active?.resolved);
      if (!activeResolved2) {
        throw new Error("bubble_config_missing");
      }
    } catch (err) {
      throw err;
    }
  }

  const emails =
    args.emails.length > 0 ? args.emails : ["leonardonoronha12@gmail.com", "orenancapeletto@gmail.com", "goldburger013@gmail.com"];

  const users = [];
  for (const email of emails) {
    logEvent({ level: "info", step: "auth_session", email });
    const session = await getSessionForEmail(admin, anon, email);
    const supabaseUserId = String(session?.user?.id ?? "").trim();
    if (!supabaseUserId) throw new Error(`missing_supabase_user_id_for:${email}`);
    users.push({ email, supabaseUserId });
  }

  const resetResults = [];
  if (args.reset) {
    const payload = {
      ok: false,
      error: "reset_disabled_by_default_for_safety",
      hint: "run without --reset",
      args: { site, emails },
    };
    writeOut(payload);
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const reports = [];
  for (const u of users) {
    const email = u.email;
    const uid = u.supabaseUserId;
    const cookieRef = { value: toCookieFromSession(await getSessionForEmail(admin, anon, email)) };

    const startedAt = Date.now();
    const deadlineAt = startedAt + args.timeoutUserMs;
    let lastEnsureRes = null;
    let lastEnsureStatus = "";
    let lastTick = null;
    let lastObjectType = "";
    let attemptUsed = 0;
    let stopReason = "";
    let stopError = "";
    let lastStatusProbe = null;
    const retryingSeen = new Set();

    for (let attempt = 1; attempt <= args.maxPollAttempts; attempt++) {
      attemptUsed = attempt;
      const now = Date.now();
      const elapsedMs = now - startedAt;
      const remainingMs = deadlineAt - now;
      if (remainingMs <= 0) {
        stopReason = "timeout_user";
        break;
      }
      if (remainingMs < 5000) {
        stopReason = "timeout_user";
        break;
      }

      const ensureTimeoutMs = Math.min(args.timeoutEnsureMs, remainingMs);
      logEvent({ level: "info", step: "ensure", email, supabaseUserId: uid, attempt, elapsedMs, timeoutMs: ensureTimeoutMs, ensureParams: args.ensureParams });
      let r;
      try {
        r = await authedHttpJson(
          admin,
          anon,
          email,
          `${site}/api/bubble-obj/migration/ensure`,
          { method: "POST", origin, timeoutMs: ensureTimeoutMs, stage: "ensure", body: { ...args.ensureParams } },
          cookieRef,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isAbort = /aborted|abort/i.test(msg);
        stopReason = isAbort ? "timeout_user" : "ensure_error";
        stopError = msg;
        lastEnsureRes = null;
        break;
      }
      lastEnsureRes = { ok: r.ok, status: r.status, json: r.json };
      if (!r.ok || !r.json?.ok) {
        stopReason = "ensure_failed";
        stopError = String(r.json?.error ?? r.status);
        break;
      }

      lastEnsureStatus = String(r.json?.status ?? "");
      lastTick = r.json?.lastTick ?? null;
      lastObjectType = String(lastTick?.objectType ?? "").trim() || lastObjectType;
      if (lastObjectType) logEvent({ level: "info", step: "type", email, supabaseUserId: uid, objectType: lastObjectType, pageStats: lastTick?.pageStats ?? null });

      writeOut({
        ok: false,
        running: true,
        step: "ensure_poll",
        email,
        supabaseUserId: uid,
        attempt,
        elapsedMs,
        lastEnsureStatus,
        lastObjectType,
        lastTick,
      });

      const probeRemaining = deadlineAt - Date.now();
      if (probeRemaining > 0) {
        const probeTimeoutMs = Math.min(4000, probeRemaining);
        try {
          const stProbe = await authedHttpJson(
            admin,
            anon,
            email,
            `${site}/api/bubble-obj/migration/status`,
            { method: "GET", origin, timeoutMs: probeTimeoutMs, stage: "status_probe" },
            cookieRef,
          );
          if (stProbe.ok && stProbe.json?.ok) {
            const mig = stProbe.json.migration || {};
            const active = mig.active || null;
            const retryingTypesList = Array.isArray(mig.retryingObjectTypes) ? mig.retryingObjectTypes : [];
            for (const t of retryingTypesList) retryingSeen.add(String(t ?? "").trim());
            lastStatusProbe = {
              status: String(mig.status ?? ""),
              runningObjectTypes: Array.isArray(mig.runningObjectTypes) ? mig.runningObjectTypes : [],
              retryingObjectTypes: retryingTypesList,
              active,
              totals: mig.totals || null,
            };
            logEvent({
              level: "info",
              step: "status_probe",
              email,
              supabaseUserId: uid,
              migrationStatus: String(mig.status ?? ""),
              runningTypes: Array.isArray(mig.runningObjectTypes) ? mig.runningObjectTypes.length : 0,
              retryingTypes: Array.isArray(mig.retryingObjectTypes) ? mig.retryingObjectTypes.length : 0,
              active,
            });
          }
        } catch {}
      }

      if (lastEnsureStatus && lastEnsureStatus !== "running") break;
      const remainingAfter = deadlineAt - Date.now();
      if (remainingAfter <= 0) {
        stopReason = "timeout_user";
        break;
      }
      await sleep(Math.min(args.pollIntervalMs, remainingAfter));
    }

    const remainingForStatus = deadlineAt - Date.now();
    if (remainingForStatus <= 0) {
      const payload = {
        ok: false,
        stopReason: stopReason || "timeout_user",
        email,
        supabaseUserId: uid,
        attemptUsed,
        elapsedMs: Date.now() - startedAt,
        lastEnsureStatus,
        lastObjectType,
        lastTick,
        lastEnsure: lastEnsureRes,
        lastStatus: null,
        lastStatusProbe,
        retryingSeen: Array.from(retryingSeen.values()),
        resetResults,
      };
      reports.push(payload);
      continue;
    }

    const statusTimeoutMs = Math.min(args.timeoutStatusMs, remainingForStatus);
    logEvent({ level: "info", step: "status", email, supabaseUserId: uid, timeoutMs: statusTimeoutMs });
    let statusRes;
    try {
      statusRes = await authedHttpJson(
        admin,
        anon,
        email,
        `${site}/api/bubble-obj/migration/status`,
        { method: "GET", origin, timeoutMs: statusTimeoutMs, stage: "status" },
        cookieRef,
      );
    } catch (err) {
      const payload = {
        ok: false,
        stopReason: "status_error",
        email,
        supabaseUserId: uid,
        error: err instanceof Error ? err.message : String(err),
        attemptUsed,
        elapsedMs: Date.now() - startedAt,
        lastEnsureStatus,
        lastObjectType,
        lastTick,
        lastEnsure: lastEnsureRes,
        lastStatus: null,
        lastStatusProbe,
        retryingSeen: Array.from(retryingSeen.values()),
        resetResults,
      };
      reports.push(payload);
      continue;
    }
    if (!statusRes.ok || !statusRes.json?.ok) {
      const payload = {
        ok: false,
        stopReason: "status_failed",
        email,
        supabaseUserId: uid,
        lastEnsureStatus,
        lastObjectType,
        lastTick,
        lastEnsure: lastEnsureRes,
        lastStatus: { ok: statusRes.ok, status: statusRes.status, json: statusRes.json },
        lastStatusProbe,
        retryingSeen: Array.from(retryingSeen.values()),
        resetResults,
      };
      reports.push(payload);
      continue;
    }
    const mig = statusRes.json.migration || {};

    const bubbleUserId = String(mig.bubbleUserId || "").trim();
    const runId = mig.lastRunId ? String(mig.lastRunId) : null;
    const finalStatus = String(mig.status || "");

    if (!stopReason && lastEnsureStatus === "running") stopReason = "max_poll_attempts";

    if (stopReason || finalStatus !== "completed") {
      const payload = {
        ok: false,
        stopReason: stopReason || (finalStatus === "failed" ? "migration_failed" : "timeout_waiting_completed"),
        email,
        supabaseUserId: uid,
        bubbleUserId,
        runId,
        finalStatus,
        error: stopError || String(mig.lastError || ""),
        attemptUsed,
        elapsedMs: Date.now() - startedAt,
        lastEnsureStatus,
        lastObjectType,
        lastTick,
        lastEnsure: lastEnsureRes,
        lastStatus: { ok: statusRes.ok, status: statusRes.status, json: statusRes.json },
        lastStatusProbe,
        retryingSeen: Array.from(retryingSeen.values()),
        resetResults,
      };
      reports.push(payload);
      continue;
    }

    const remainingForValidate = deadlineAt - Date.now();
    if (remainingForValidate <= 0) {
      const payload = {
        ok: false,
        stopReason: "timeout_user",
        email,
        supabaseUserId: uid,
        bubbleUserId,
        runId,
        finalStatus,
        attemptUsed,
        elapsedMs: Date.now() - startedAt,
        lastEnsureStatus,
        lastObjectType,
        lastTick,
        lastEnsure: lastEnsureRes,
        lastStatus: { ok: statusRes.ok, status: statusRes.status, json: statusRes.json },
        lastStatusProbe,
        retryingSeen: Array.from(retryingSeen.values()),
        resetResults,
      };
      reports.push(payload);
      continue;
    }
    const validateTimeoutMs = Math.min(args.timeoutValidateMs, remainingForValidate);
    logEvent({ level: "info", step: "validate", email, supabaseUserId: uid, timeoutMs: validateTimeoutMs });
    let validateRes;
    try {
      validateRes = await authedHttpJson(
        admin,
        anon,
        email,
        `${site}/api/bubble-obj/migration/validate`,
        { method: "POST", origin, timeoutMs: validateTimeoutMs, stage: "validate", body: {} },
        cookieRef,
      );
    } catch (err) {
      const payload = {
        ok: false,
        stopReason: "validate_error",
        email,
        supabaseUserId: uid,
        bubbleUserId,
        runId,
        finalStatus,
        error: err instanceof Error ? err.message : String(err),
        attemptUsed,
        elapsedMs: Date.now() - startedAt,
        lastEnsureStatus,
        lastObjectType,
        lastTick,
        lastEnsure: lastEnsureRes,
        lastStatus: { ok: statusRes.ok, status: statusRes.status, json: statusRes.json },
        lastStatusProbe,
        retryingSeen: Array.from(retryingSeen.values()),
        resetResults,
      };
      reports.push(payload);
      continue;
    }
    if (!validateRes.ok || !validateRes.json?.ok) {
      const payload = {
        ok: false,
        stopReason: "validation_failed",
        email,
        supabaseUserId: uid,
        bubbleUserId,
        runId,
        finalStatus,
        validation_error: String(validateRes.json?.error ?? validateRes.status),
        lastEnsureStatus,
        lastObjectType,
        lastTick,
        lastEnsure: lastEnsureRes,
        lastStatus: { ok: statusRes.ok, status: statusRes.status, json: statusRes.json },
        lastStatusProbe,
        retryingSeen: Array.from(retryingSeen.values()),
        resetResults,
      };
      reports.push(payload);
      continue;
    }

    const validationStatus = String(validateRes.json?.status ?? "");
    const validationReport = validateRes.json?.report ?? null;
    if (validationStatus === "divergent") {
      const payload = {
        ok: false,
        stopReason: "divergence_found",
        email,
        supabaseUserId: uid,
        bubbleUserId,
        runId,
        finalStatus,
        validation_status: validationStatus,
        validationReport,
        lastEnsureStatus,
        lastObjectType,
        lastTick,
        lastEnsure: lastEnsureRes,
        lastStatus: { ok: statusRes.ok, status: statusRes.status, json: statusRes.json },
        lastStatusProbe,
        retryingSeen: Array.from(retryingSeen.values()),
        resetResults,
      };
      reports.push(payload);
      continue;
    }

    const attemptRow = await admin
      .from("bubble_obj_user_migration_attempt")
      .select("duration_ms,started_at,finished_at,status,validation_status")
      .eq("supabase_user_id", uid)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (attemptRow.error) throw new Error(`attempt_lookup_failed:${email}:${attemptRow.error.message}`);

    const durationMsClient = Math.max(0, Date.now() - startedAt);

    const finalCounts = await snapshotFinalCounts(admin, uid);
    const remainingForAfter = Math.max(0, deadlineAt - Date.now());
    const statusAfter = await authedHttpJson(
      admin,
      anon,
      email,
      `${site}/api/bubble-obj/migration/status`,
      { method: "GET", origin, timeoutMs: Math.min(args.timeoutStatusMs, Math.max(2000, remainingForAfter)), stage: "status_after" },
      cookieRef,
    ).catch(() => null);
    const perTypeLiveAfter = statusAfter && statusAfter.ok && statusAfter.json?.ok ? statusAfter.json.migration?.perTypeLive : [];
    const typeSummary = summarizePerType(perTypeLiveAfter);
    const typesMigrated = typeSummary.migrated.map((x) => x.objectType);
    const typesStagedOnly = typeSummary.stagedOnly.filter((x) => x.received > 0 || x.savedStaging > 0).map((x) => x.objectType);
    const typesRetryingFinal = typeSummary.retrying.map((x) => x.objectType);

    const beforeSecond = await snapshotFinalCounts(admin, uid);
    let ensure2 = null;
    try {
      const remainingForEnsure2 = deadlineAt - Date.now();
      if (remainingForEnsure2 > 0) {
        const ensure2TimeoutMs = Math.min(10_000, remainingForEnsure2);
        const ensure2Params = {
          ...args.ensureParams,
          callBudgetMs: Math.min(8000, Number(args.ensureParams.callBudgetMs ?? 15000) || 8000),
          maxPages: Math.min(2, Number(args.ensureParams.maxPages ?? 2) || 2),
          maxTicks: Math.min(2, Number(args.ensureParams.maxTicks ?? 2) || 2),
          processLimit: Math.min(100, Number(args.ensureParams.processLimit ?? 100) || 100),
          maxProcessTotal: Math.min(200, Number(args.ensureParams.maxProcessTotal ?? 200) || 200),
        };
        ensure2 = await authedHttpJson(
          admin,
          anon,
          email,
          `${site}/api/bubble-obj/migration/ensure`,
          { method: "POST", origin, timeoutMs: ensure2TimeoutMs, stage: "ensure_idempotency", body: ensure2Params },
          cookieRef,
        );
      }
    } catch {}
    const afterSecond = await snapshotFinalCounts(admin, uid);
    const idempotency = { ok: deepEqualShallowNumbers(beforeSecond, afterSecond), before: beforeSecond, after: afterSecond };

    const perType = Array.isArray(validationReport?.perType) ? validationReport.perType : [];
    const bubbleByType = Object.fromEntries(perType.map((x) => [String(x.objectType), x?.bubble?.total ?? null]));
    const importedByType = Object.fromEntries(perType.map((x) => [String(x.objectType), { savedStaging: x?.runItem?.savedStaging ?? 0, processed: x?.runItem?.processed ?? 0 }]));

    reports.push({
      ok: true,
      email,
      supabaseUserId: uid,
      bubbleUserId,
      runId,
      bubbleFoundByType: bubbleByType,
      importedByType,
      durationMs: durationMsClient,
      finalStatus,
      validation_status: validationStatus,
      divergent: false,
      idempotency,
      finalTableCounts: finalCounts,
      typesMigrated,
      typesStagedOnly,
      typesRetryingFinal,
      retryingSeen: Array.from(retryingSeen.values()),
      ensureFinalCheckpoints: lastEnsureRes?.json?.checkpoints ?? null,
      ensure2: ensure2 ? { ok: ensure2.ok, status: ensure2.status, json: ensure2.json } : null,
      statusAfter: statusAfter ? { ok: statusAfter.ok, status: statusAfter.status, json: statusAfter.json } : null,
    });
  }

  const payload = { ok: reports.every((r) => r && r.ok === true), site, resetResults, reports };
  writeOut(payload);
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  const payload = { ok: false, error: msg };
  try {
    writeOut(payload);
  } catch {}
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
});
