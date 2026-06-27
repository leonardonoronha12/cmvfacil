import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, ".env.local");
const OUT_DIR = path.join(ROOT, "tools", "bubble-obj", "out");

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

function countBy(arr, key) {
  const m = {};
  for (const r of arr) {
    const k = String(r?.[key] ?? "");
    m[k] = (m[k] || 0) + 1;
  }
  return m;
}

async function main() {
  const runId = String(process.argv[2] ?? "").trim();
  if (!runId) throw new Error("missing_runId");
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const env = { ...readDotenv(ENV_PATH), ...process.env };
  const supabaseUrl = requireEnv(env, "SUPABASE_URL");
  const serviceKey = requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY");
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: run, error: runErr } = await admin.from("bubble_obj_import_run").select("*").eq("id", runId).maybeSingle();
  if (runErr) throw new Error(runErr.message);
  if (!run) throw new Error("run_not_found");

  const { data: items, error: itemsErr } = await admin.from("bubble_obj_import_run_item").select("*").eq("run_id", runId);
  if (itemsErr) throw new Error(itemsErr.message);
  const runItems = Array.isArray(items) ? items : [];

  const { data: cps, error: cpsErr } = await admin.from("bubble_obj_import_checkpoint").select("*").eq("supabase_user_id", String(run.triggered_by_supabase_user_id ?? ""));
  if (cpsErr) throw new Error(cpsErr.message);
  const checkpoints = Array.isArray(cps) ? cps : [];

  const latestItemUpdatedAt = runItems.map((x) => String(x?.updated_at ?? "")).filter(Boolean).sort().slice(-1)[0] ?? "";
  const latestCheckpointUpdatedAt = checkpoints.map((x) => String(x?.updated_at ?? "")).filter(Boolean).sort().slice(-1)[0] ?? "";

  const out = {
    ok: true,
    run: { id: String(run.id), status: String(run.status ?? ""), started_at: String(run.started_at ?? ""), finished_at: String(run.finished_at ?? "") },
    runItems: {
      total: runItems.length,
      byStatus: countBy(runItems, "status"),
      byType: countBy(runItems, "object_type"),
      latestUpdatedAt: latestItemUpdatedAt,
      sampleRunning: runItems.filter((x) => String(x?.status ?? "") === "running").slice(0, 5).map((x) => ({
        id: String(x?.id ?? ""),
        object_type: String(x?.object_type ?? ""),
        bubble_user_id: String(x?.bubble_user_id ?? ""),
        last_cursor: x?.last_cursor ?? null,
        total_received: x?.total_received ?? null,
        total_saved_staging: x?.total_saved_staging ?? null,
        total_duplicate_ignored: x?.total_duplicate_ignored ?? null,
        updated_at: String(x?.updated_at ?? ""),
        last_error: String(x?.last_error ?? ""),
      })),
    },
    checkpoints: {
      total: checkpoints.length,
      byStatus: countBy(checkpoints, "status"),
      latestUpdatedAt: latestCheckpointUpdatedAt,
    },
  };

  fs.writeFileSync(path.join(OUT_DIR, "latest_activity.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

