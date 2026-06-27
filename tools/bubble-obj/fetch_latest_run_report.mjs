import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, ".env.local");
const OUT_DIR = path.join(ROOT, "tools", "bubble-obj", "out");
const CANDIDATE_SITES = [
  String(process.env.BUBBLE_OBJ_SITE_URL || "").trim(),
  "http://localhost:3000",
  "https://cmvfacil.vercel.app",
].map((s) => String(s || "").trim().replace(/\/+$/, "")).filter(Boolean);

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

async function httpJson(url, { cookie } = {}) {
  const res = await fetch(url, { method: "GET", headers: cookie ? { cookie } : {}, cache: "no-store" });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) throw new Error(`http_${res.status}:${url}:${String(json?.error ?? text).slice(0, 400)}`);
  return json;
}

async function pickSite() {
  for (const site of CANDIDATE_SITES) {
    try {
      const res = await fetch(`${site}/api/health/bubble-config`, { method: "GET", cache: "no-store" });
      if (res.ok) return site;
    } catch {}
  }
  return CANDIDATE_SITES[0] || "http://localhost:3000";
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
  const gen = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (gen.error) throw new Error(`generate_link:${gen.error.message}`);
  const hashed = String(gen.data?.properties?.hashed_token ?? "").trim();
  const tokenHash = hashed || parseLinkTokenHash(gen.data?.action_link);
  if (!tokenHash) throw new Error("missing_token_hash_from_generate_link");
  const verified = await anon.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
  if (verified.error || !verified.data?.session) throw new Error(`verify_otp_failed:${verified.error?.message || "no_session"}`);
  return verified.data.session;
}

function cookieHeaderFromSession(session) {
  const at = String(session?.access_token ?? "").trim();
  if (!at) throw new Error("missing_access_token");
  return `cmv_at=${at}`;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const site = await pickSite();
  fs.writeFileSync(path.join(OUT_DIR, "latest_probe.json"), JSON.stringify({ cwd: process.cwd(), site, ts: new Date().toISOString() }, null, 2));
  const env = { ...readDotenv(ENV_PATH), ...process.env };
  const supabaseUrl = requireEnv(env, "SUPABASE_URL");
  const anonKey = requireEnv(env, "SUPABASE_ANON_KEY");
  const serviceKey = requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY");

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const anon = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: run, error: runErr } = await admin
    .from("bubble_obj_import_run")
    .select("id,status,started_at,finished_at,triggered_by_supabase_user_id")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (runErr) throw new Error(`run:${runErr.message}`);
  if (!run?.id) throw new Error("no_runs_found");

  const runId = String(run.id);
  const triggeredBy = String(run.triggered_by_supabase_user_id ?? "").trim();
  if (!triggeredBy) throw new Error("run_missing_triggered_by");

  const u = await admin.auth.admin.getUserById(triggeredBy);
  if (u.error) throw new Error(`getUserById:${u.error.message}`);
  const email = String(u.data?.user?.email ?? "").trim().toLowerCase();
  if (!email) throw new Error("trigger_user_missing_email");

  const session = await getSessionForEmail(admin, anon, email);
  const cookie = cookieHeaderFromSession(session);

  const summaryUrl = `${site}/api/bubble-obj/report/summary?runId=${encodeURIComponent(runId)}`;
  const pendingUrl = `${site}/api/bubble-obj/report/pending?runId=${encodeURIComponent(runId)}&limit=50&offset=0`;
  const summary = await httpJson(summaryUrl, { cookie });
  const pending = await httpJson(pendingUrl, { cookie });

  const { data: cps, error: cpsErr } = await admin
    .from("bubble_obj_import_checkpoint")
    .select("status")
    .eq("supabase_user_id", triggeredBy);
  if (cpsErr) throw new Error(`checkpoint:${cpsErr.message}`);
  const cpDone = (cps ?? []).filter((c) => String(c?.status ?? "") === "done").length;
  const cpErrCount = (cps ?? []).filter((c) => String(c?.status ?? "") === "error").length;
  const cpTotal = (cps ?? []).length;

  const out = {
    ok: true,
    site,
    runId,
    run: { status: String(run.status ?? ""), startedAt: String(run.started_at ?? ""), finishedAt: String(run.finished_at ?? "") },
    endpoints: { summaryUrl, pendingUrl },
    checkpointStatus: { total: cpTotal, done: cpDone, error: cpErrCount, pending: Math.max(0, cpTotal - cpDone - cpErrCount) },
    summary,
    pending,
  };

  fs.writeFileSync(path.join(OUT_DIR, "latest_run_report.json"), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "latest_summary.json"), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "latest_pending.json"), JSON.stringify(pending, null, 2));

  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(JSON.stringify({ ok: false, error: msg }, null, 2));
  process.exit(1);
});
