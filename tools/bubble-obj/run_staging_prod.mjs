import fs from "fs";
import path from "path";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, ".env.local");
const DEFAULT_SITE = process.env.BUBBLE_OBJ_SITE_URL || "https://cmvfacil.vercel.app";
const OUT_DIR = path.join(ROOT, "tools", "bubble-obj", "out");
const BOT_FILE = path.join(ROOT, ".bubble.obj-import-bot.local");

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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}

function requireEnv(env, key) {
  const v = String(env[key] || "").trim();
  if (!v) throw new Error(`missing_env:${key}`);
  return v;
}

function cookieHeader(session) {
  const at = String(session?.access_token ?? "").trim();
  if (!at) throw new Error("missing_access_token");
  return `cmv_at=${at}`;
}

async function httpJson(method, url, { body, headers } = {}) {
  const res = await fetch(url, {
    method,
    headers: { ...(headers || {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) throw new Error(`http_${res.status}:${url}:${String(json?.error ?? text).slice(0, 600)}`);
  return json;
}

function randPassword() {
  return crypto.randomBytes(18).toString("base64url");
}

function parseArgs(argv) {
  const out = {
    site: DEFAULT_SITE,
    runId: "",
    watch: false,
    intervalMs: 2000,
    maxPages: 10,
    maxTicks: 0,
    batchLimit: 100,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i] ?? "").trim();
    if (!a) continue;
    if (a === "--watch") out.watch = true;
    else if (a === "--runId") out.runId = String(argv[i + 1] ?? "").trim();
    else if (a.startsWith("--runId=")) out.runId = a.slice("--runId=".length).trim();
    else if (a === "--site") out.site = String(argv[i + 1] ?? "").trim() || out.site;
    else if (a.startsWith("--site=")) out.site = a.slice("--site=".length).trim() || out.site;
    else if (a === "--intervalMs") out.intervalMs = Math.max(250, Number(argv[i + 1] ?? out.intervalMs) || out.intervalMs);
    else if (a.startsWith("--intervalMs=")) out.intervalMs = Math.max(250, Number(a.slice("--intervalMs=".length)) || out.intervalMs);
    else if (a === "--maxPages") out.maxPages = Math.max(1, Math.min(20, Number(argv[i + 1] ?? out.maxPages) || out.maxPages));
    else if (a.startsWith("--maxPages=")) out.maxPages = Math.max(1, Math.min(20, Number(a.slice("--maxPages=".length)) || out.maxPages));
    else if (a === "--maxTicks") out.maxTicks = Math.max(0, Number(argv[i + 1] ?? out.maxTicks) || out.maxTicks);
    else if (a.startsWith("--maxTicks=")) out.maxTicks = Math.max(0, Number(a.slice("--maxTicks=".length)) || out.maxTicks);
    else if (a === "--batchLimit") out.batchLimit = Math.max(1, Math.min(200, Number(argv[i + 1] ?? out.batchLimit) || out.batchLimit));
    else if (a.startsWith("--batchLimit=")) out.batchLimit = Math.max(1, Math.min(200, Number(a.slice("--batchLimit=".length)) || out.batchLimit));
  }

  out.site = String(out.site || DEFAULT_SITE).replace(/\/+$/, "");
  return out;
}

function formatDurationMs(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (hh > 0) return `${hh.toString().padStart(2, "0")}:${mm.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
  return `${mm.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
}

function safeNumber(n) {
  const x = Number(n ?? 0);
  return Number.isFinite(x) ? x : 0;
}

async function assertTablesExist(admin) {
  const tables = [
    "bubble_obj_user_map",
    "bubble_obj_import_control",
    "bubble_obj_import_staging",
    "bubble_obj_import_checkpoint",
    "bubble_obj_import_run",
    "bubble_obj_import_run_item",
  ];
  const checks = [];
  for (const t of tables) {
    const q = admin.from(t).select("*", { count: "exact", head: true }).limit(1);
    checks.push(q.then((r) => ({ table: t, ok: !r.error, error: r.error?.message || "" })));
  }
  const results = await Promise.all(checks);
  const bad = results.filter((r) => !r.ok);
  return { ok: bad.length === 0, results };
}

function parseLinkTokenHash(actionLink) {
  const s = String(actionLink ?? "").trim();
  if (!s) return "";
  const q = s.includes("?") ? s.split("?", 2)[1] : "";
  if (!q) return "";
  const params = new URLSearchParams(q);
  return String(params.get("token_hash") ?? params.get("token") ?? "").trim();
}

async function getSessionForExistingEmail(admin, anon, email) {
  const gen = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (gen.error) throw new Error(`generate_link:${gen.error.message}`);
  const hashed = String(gen.data?.properties?.hashed_token ?? "").trim();
  if (hashed) {
    const verified = await anon.auth.verifyOtp({ type: "magiclink", token_hash: hashed });
    if (verified.error || !verified.data?.session) throw new Error(`verify_otp_failed:${verified.error?.message || "no_session"}`);
    return verified.data.session;
  }
  const tokenHash = parseLinkTokenHash(gen.data?.action_link);
  if (tokenHash) {
    const verified = await anon.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
    if (verified.error || !verified.data?.session) throw new Error(`verify_otp_failed:${verified.error?.message || "no_session"}`);
    return verified.data.session;
  }
  throw new Error("missing_token_hash_from_generate_link");
}

function sumBy(arr, key) {
  let out = 0;
  for (const r of arr) out += safeNumber(r?.[key]);
  return out;
}

async function fetchProgressDirect(admin, runId) {
  const { data: run, error: runErr } = await admin.from("bubble_obj_import_run").select("*").eq("id", runId).maybeSingle();
  if (runErr) throw new Error(`run:${runErr.message}`);
  if (!run) throw new Error("run_not_found");

  const { data: items, error: itemsErr } = await admin.from("bubble_obj_import_run_item").select("*").eq("run_id", runId);
  if (itemsErr) throw new Error(`run_item:${itemsErr.message}`);
  const runItems = Array.isArray(items) ? items : [];

  const bubbleUserIdsInRun = Array.from(new Set(runItems.map((x) => String(x?.bubble_user_id ?? "").trim()).filter(Boolean)));
  const { data: cps, error: cpsErr } = await admin
    .from("bubble_obj_import_checkpoint")
    .select("*")
    .in("bubble_user_id", bubbleUserIdsInRun.length ? bubbleUserIdsInRun : ["__none__"]);
  if (cpsErr) throw new Error(`checkpoint:${cpsErr.message}`);
  const checkpoints = Array.isArray(cps) ? cps : [];

  const cpDone = checkpoints.filter((c) => String(c?.status ?? "") === "done").length;
  const cpError = checkpoints.filter((c) => String(c?.status ?? "") === "error").length;
  const cpPending = checkpoints.length - cpDone - cpError;

  return {
    run,
    runItems,
    totals: {
      totalExpected: sumBy(runItems, "total_expected"),
      totalReceived: sumBy(runItems, "total_received"),
      totalSavedStaging: sumBy(runItems, "total_saved_staging"),
      totalDuplicateIgnored: sumBy(runItems, "total_duplicate_ignored"),
      totalPendingReview: sumBy(runItems, "total_pending_review"),
      totalError: sumBy(runItems, "total_error"),
    },
    checkpoints: { total: checkpoints.length, done: cpDone, pending: cpPending, error: cpError },
  };
}

function readBotEmail() {
  if (!fs.existsSync(BOT_FILE)) return "";
  const raw = fs.readFileSync(BOT_FILE, "utf8").trim();
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    return String(parsed?.email ?? "").trim().toLowerCase();
  } catch {
    return "";
  }
}

function writeBotEmail(email) {
  fs.writeFileSync(BOT_FILE, JSON.stringify({ email }, null, 2));
}

async function ensureBotSession(admin, anon) {
  let email = readBotEmail();
  if (!email) {
    const salt = crypto.createHash("sha256").update(String(Date.now()) + randPassword()).digest("hex").slice(0, 10);
    email = `bubble-obj-import-bot-${salt}@cmvfacil.local`;
    writeBotEmail(email);
  }

  const password = randPassword();
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error && !String(created.error.message ?? "").toLowerCase().includes("already")) throw new Error(`create_user:${created.error.message}`);
  const session = await getSessionForExistingEmail(admin, anon, email);
  const userId = String(session?.user?.id ?? "").trim();
  if (!userId) throw new Error("missing_user_id_from_session");
  return { email, userId, session };
}

async function mapUnlinkedBubbleUsersToSupabaseUser(admin, supabaseUserId) {
  const { data, error } = await admin.from("bubble_obj_user_map").select("bubble_user_id").is("supabase_user_id", null).limit(5000);
  if (error) throw new Error(`bubble_obj_user_map_list:${error.message}`);
  const rows = (data ?? [])
    .map((r) => ({ bubble_user_id: String(r?.bubble_user_id ?? "").trim(), supabase_user_id: supabaseUserId }))
    .filter((r) => r.bubble_user_id);
  if (!rows.length) return { updated: 0 };
  const { error: upErr } = await admin.from("bubble_obj_user_map").upsert(rows, { onConflict: "bubble_user_id" });
  if (upErr) throw new Error(`bubble_obj_user_map_upsert:${upErr.message}`);
  return { updated: rows.length };
}

async function getOrCreateRun(admin, { supabaseUserId, baseUrl, batchLimit, runId }) {
  if (runId) {
    const { data, error } = await admin.from("bubble_obj_import_run").select("*").eq("id", runId).maybeSingle();
    if (error) throw new Error(`run_lookup:${error.message}`);
    const row = data ?? null;
    if (!row) throw new Error("run_not_found");
    if (String(row.triggered_by_supabase_user_id ?? "").trim() !== supabaseUserId) throw new Error("run_forbidden");
    return { runId: String(row.id), reused: true };
  }

  const { data: existing, error: exErr } = await admin
    .from("bubble_obj_import_run")
    .select("*")
    .eq("triggered_by_supabase_user_id", supabaseUserId)
    .eq("status", "running")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (exErr) throw new Error(`run_lookup:${exErr.message}`);
  if (existing?.id) return { runId: String(existing.id), reused: true };

  const { data: created, error: createErr } = await admin
    .from("bubble_obj_import_run")
    .insert({ triggered_by_supabase_user_id: supabaseUserId, base_url: baseUrl, batch_limit: batchLimit, status: "running" })
    .select("id")
    .maybeSingle();
  if (createErr) throw new Error(`create_run:${createErr.message}`);
  const newRunId = String(created?.id ?? "").trim();
  if (!newRunId) throw new Error("create_run:missing_id");
  return { runId: newRunId, reused: false };
}

async function ensureCheckpointsAndRunItems(admin, { runId, supabaseUserId, objectTypes }) {
  const { data: users, error: usersErr } = await admin
    .from("bubble_obj_user_map")
    .select("bubble_user_id,email")
    .eq("supabase_user_id", supabaseUserId)
    .limit(5000);
  if (usersErr) throw new Error(`mapped_users:${usersErr.message}`);
  const bubbleUsers = (users ?? []).filter((u) => String(u?.bubble_user_id ?? "").trim());
  if (!bubbleUsers.length) throw new Error("no_mapped_bubble_users_for_this_supabase_user");

  const bubbleUserIds = bubbleUsers.map((u) => String(u.bubble_user_id).trim());
  const { data: existingCp, error: cpErr } = await admin
    .from("bubble_obj_import_checkpoint")
    .select("bubble_user_id,object_type,last_cursor,total_imported,status")
    .eq("supabase_user_id", supabaseUserId)
    .in("bubble_user_id", bubbleUserIds)
    .in("object_type", objectTypes);
  if (cpErr) throw new Error(`checkpoint_list:${cpErr.message}`);

  const cpMap = new Map();
  for (const r of existingCp ?? []) {
    const k = `${String(r?.bubble_user_id ?? "").trim()}|${String(r?.object_type ?? "").trim()}`;
    if (k) cpMap.set(k, r);
  }

  const checkpointRows = [];
  const runItemRows = [];
  for (const u of bubbleUsers) {
    const bubbleUserId = String(u?.bubble_user_id ?? "").trim();
    if (!bubbleUserId) continue;
    const userEmail = String(u?.email ?? "").trim().toLowerCase();
    for (const t of objectTypes) {
      const k = `${bubbleUserId}|${t}`;
      const prev = cpMap.get(k);
      if (!prev) {
        checkpointRows.push({
          user_email: userEmail,
          bubble_user_id: bubbleUserId,
          supabase_user_id: supabaseUserId,
          object_type: t,
          last_cursor: 0,
          total_imported: 0,
          status: "pending",
        });
      }
      const prevStatus = String(prev?.status ?? "");
      runItemRows.push({
        run_id: runId,
        bubble_user_id: bubbleUserId,
        supabase_user_id: supabaseUserId,
        object_type: t,
        status: prevStatus === "done" ? "done" : prevStatus === "error" ? "error" : "pending",
        last_cursor: typeof prev?.last_cursor === "number" && Number.isFinite(prev.last_cursor) && prev.last_cursor >= 0 ? prev.last_cursor : 0,
      });
    }
  }

  if (checkpointRows.length) {
    const { error: upErr } = await admin.from("bubble_obj_import_checkpoint").upsert(checkpointRows, { onConflict: "bubble_user_id,object_type,supabase_user_id" });
    if (upErr) throw new Error(`checkpoint_upsert:${upErr.message}`);
  }
  if (runItemRows.length) {
    const { error: riErr } = await admin.from("bubble_obj_import_run_item").upsert(runItemRows, { onConflict: "run_id,bubble_user_id,object_type,supabase_user_id" });
    if (riErr) throw new Error(`run_item_upsert:${riErr.message}`);
  }

  return { bubbleUsers: bubbleUsers.length, runItems: runItemRows.length, checkpointsCreated: checkpointRows.length };
}

function progressFromDirect(progress, { startMs, lastSnapshot, nowMs }) {
  const totals = progress?.totals ?? {};
  const checkpoints = progress?.checkpoints ?? {};
  const totalExpected = safeNumber(totals.totalExpected);
  const totalReceived = safeNumber(totals.totalReceived);
  const totalSavedStaging = safeNumber(totals.totalSavedStaging);
  const totalDuplicateIgnored = safeNumber(totals.totalDuplicateIgnored);
  const totalPendingReview = safeNumber(totals.totalPendingReview);
  const totalError = safeNumber(totals.totalError);
  const cpDone = safeNumber(checkpoints.done);
  const cpPending = safeNumber(checkpoints.pending);

  const elapsedMs = Math.max(1, nowMs - startMs);
  const elapsedSec = elapsedMs / 1000;
  const avgRps = totalReceived / elapsedSec;

  const prevAt = safeNumber(lastSnapshot?.atMs);
  const prevReceived = safeNumber(lastSnapshot?.totalReceived);
  const instWindowMs = prevAt ? Math.max(1, nowMs - prevAt) : 0;
  const instRps = instWindowMs ? (totalReceived - prevReceived) / (instWindowMs / 1000) : 0;

  const remaining = totalExpected > 0 ? Math.max(0, totalExpected - totalReceived) : null;
  const etaSec = remaining != null && avgRps > 0 ? remaining / avgRps : null;

  return {
    totals: { totalExpected, totalReceived, totalSavedStaging, totalDuplicateIgnored, totalPendingReview, totalError },
    checkpoints: { done: cpDone, pending: cpPending },
    rates: { instRps, avgRps },
    time: { elapsedMs, etaMs: etaSec != null ? etaSec * 1000 : null, remaining },
  };
}

function printTickLine({ tickNo, objectType, bubbleUserId, p }) {
  const etaStr = p.time.etaMs == null ? "-" : formatDurationMs(p.time.etaMs);
  const elapsedStr = formatDurationMs(p.time.elapsedMs);
  const pct = p.totals.totalExpected > 0 ? Math.min(100, Math.floor((p.totals.totalReceived / p.totals.totalExpected) * 100)) : null;
  const pctStr = pct == null ? "-" : `${pct}%`;
  const rpsStr = p.rates.instRps > 0 ? p.rates.instRps.toFixed(1) : p.rates.avgRps.toFixed(1);
  const remStr = p.time.remaining == null ? "-" : String(p.time.remaining);

  console.log(
    [
      `tick=${String(tickNo).padStart(4, "0")}`,
      `type=${objectType || "-"}`,
      `bubbleUser=${bubbleUserId || "-"}`,
      `recv=${p.totals.totalReceived}`,
      `staging=${p.totals.totalSavedStaging}`,
      `dup=${p.totals.totalDuplicateIgnored}`,
      `pending=${p.totals.totalPendingReview}`,
      `err=${p.totals.totalError}`,
      `cp_done=${p.checkpoints.done}`,
      `cp_pending=${p.checkpoints.pending}`,
      `rps=${rpsStr}`,
      `eta=${etaStr}`,
      `elapsed=${elapsedStr}`,
      `rem=${remStr}`,
      `progress=${pctStr}`,
    ].join(" | "),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = { ...readDotenv(ENV_PATH), ...process.env };
  const supabaseUrl = requireEnv(env, "SUPABASE_URL");
  const anonKey = requireEnv(env, "SUPABASE_ANON_KEY");
  const serviceKey = requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY");

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const anon = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log("bubble-obj: starting", args.watch ? "(watch)" : "(run)");

  const tableCheck = await assertTablesExist(admin);
  fs.writeFileSync(path.join(OUT_DIR, "migration_check.json"), JSON.stringify(tableCheck, null, 2));
  if (!tableCheck.ok) throw new Error(`missing_tables:${tableCheck.results.filter((x) => !x.ok).map((x) => x.table).join(",")}`);
  console.log("bubble-obj: migration check ok");

  const bot = await ensureBotSession(admin, anon);
  const cookie = cookieHeader(bot.session);
  fs.writeFileSync(path.join(OUT_DIR, "bot_user.json"), JSON.stringify({ email: bot.email, userId: bot.userId }, null, 2));
  console.log("bubble-obj: bot user ready", bot.userId);

  const usersSync = await httpJson("POST", `${args.site}/api/bubble-obj/users/sync`, {
    body: { limit: 100 },
    headers: { cookie },
  });
  fs.writeFileSync(path.join(OUT_DIR, "usersSync.json"), JSON.stringify(usersSync, null, 2));
  console.log("bubble-obj: users sync ok");

  const autoMap = await mapUnlinkedBubbleUsersToSupabaseUser(admin, bot.userId);
  fs.writeFileSync(path.join(OUT_DIR, "auto_user_map.json"), JSON.stringify({ botUserId: bot.userId, autoMap }, null, 2));
  console.log("bubble-obj: auto map updated", autoMap.updated);

  const objectTypes = Array.from(
    new Set([
      "empresa",
      "empresas",
      "cliente",
      "clientes",
      "veiculo",
      "veiculos",
      "ordem_servico",
      "ordens_servico",
      "ordem_servicos",
      "ordem",
      "ordens",
      "financeiro",
      "financeiros",
      "lancamento",
      "lancamentos",
      "anexo",
      "anexos",
      "attachment",
      "attachments",
    ]),
  );

  if (args.watch && !args.runId) throw new Error("watch_requires_runId");

  const runRes = await getOrCreateRun(admin, { supabaseUserId: bot.userId, baseUrl: args.site, batchLimit: args.batchLimit, runId: args.runId });
  const runId = String(runRes.runId ?? "").trim();
  if (!runId) throw new Error("missing_runId");
  console.log("bubble-obj: run", runId, runRes.reused ? "(reused)" : "(created)");
  console.log("bubble-obj: summary url", `${args.site}/api/bubble-obj/report/summary?runId=${encodeURIComponent(runId)}`);
  console.log("bubble-obj: pending url", `${args.site}/api/bubble-obj/report/pending?runId=${encodeURIComponent(runId)}&limit=50&offset=0`);

  if (args.watch) {
    const startMs = Date.now();
    let lastSnapshot = null;
    let tickNo = 0;
    while (true) {
      tickNo += 1;
      const nowMs = Date.now();
      const prog = await fetchProgressDirect(admin, runId);
      const p = progressFromDirect(prog, { startMs, lastSnapshot, nowMs });
      printTickLine({ tickNo, objectType: "-", bubbleUserId: "-", p });
      lastSnapshot = { atMs: nowMs, totalReceived: p.totals.totalReceived };
      fs.writeFileSync(path.join(OUT_DIR, "summary.json"), JSON.stringify(prog, null, 2));
      if (String(prog?.run?.status ?? "") === "done") break;
      await new Promise((r) => setTimeout(r, args.intervalMs));
    }
    console.log("bubble-obj: watch complete");
    return;
  }

  const ensured = await ensureCheckpointsAndRunItems(admin, { runId, supabaseUserId: bot.userId, objectTypes });
  fs.writeFileSync(path.join(OUT_DIR, "run_setup.json"), JSON.stringify({ runId, ensured, objectTypes }, null, 2));
  console.log("bubble-obj: run setup", `bubbleUsers=${ensured.bubbleUsers}`, `runItems=${ensured.runItems}`, `newCheckpoints=${ensured.checkpointsCreated}`);

  const startMs = Date.now();
  let lastSnapshot = null;

  let done = false;
  let tickNo = 0;
  while (!done) {
    tickNo += 1;
    const tick = await httpJson("POST", `${args.site}/api/bubble-obj/stage/tick`, { body: { runId, maxPages: args.maxPages }, headers: { cookie } });
    const nowMs = Date.now();
    const prog = await fetchProgressDirect(admin, runId);
    const p = progressFromDirect(prog, { startMs, lastSnapshot, nowMs });
    printTickLine({ tickNo, objectType: String(tick?.objectType ?? ""), bubbleUserId: String(tick?.bubbleUserId ?? ""), p });
    lastSnapshot = { atMs: nowMs, totalReceived: p.totals.totalReceived };
    fs.writeFileSync(path.join(OUT_DIR, "summary.json"), JSON.stringify(prog, null, 2));
    done = tick?.done === true || String(prog?.run?.status ?? "") === "done";
    if (args.maxTicks > 0 && tickNo >= args.maxTicks) break;
  }

  const finalSummary = await fetchProgressDirect(admin, runId);
  const pending = await httpJson("GET", `${args.site}/api/bubble-obj/report/pending?runId=${encodeURIComponent(runId)}&limit=50&offset=0`, { headers: { cookie } });
  fs.writeFileSync(path.join(OUT_DIR, "summary.json"), JSON.stringify(finalSummary, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "pending.json"), JSON.stringify(pending, null, 2));

  console.log("bubble-obj: done", runId);
  console.log(JSON.stringify({ ok: true, runId, summary: finalSummary, pending }, null, 2));
}

main().catch((err) => {
  console.error(String(err?.stack || err?.message || err));
  process.exit(1);
});
