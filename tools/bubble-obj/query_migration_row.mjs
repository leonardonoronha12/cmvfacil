import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, ".env.local");

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

function requiredEnv(env, key) {
  const v = String(env[key] ?? "").trim();
  if (!v) throw new Error(`missing_env:${key}`);
  return v;
}

function parseArgs(argv) {
  const args = { userId: "" };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--userId") args.userId = String(argv[i + 1] ?? "");
  }
  args.userId = String(args.userId ?? "").trim();
  if (!args.userId) throw new Error("missing_arg:--userId");
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const env = readDotenv(ENV_PATH);
  const url = requiredEnv(env, "SUPABASE_URL");
  const service = requiredEnv(env, "SUPABASE_SERVICE_ROLE_KEY");
  const sb = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data, error } = await sb
    .from("bubble_obj_user_migration")
    .select("supabase_user_id,email,status,last_run_id,validation_status,validated_at,validation_report,updated_at")
    .eq("supabase_user_id", args.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  process.stdout.write(JSON.stringify({ ok: true, row: data ?? null }, null, 2) + "\n");
}

main().catch((err) => {
  const msg = err instanceof Error ? err.stack || err.message : String(err);
  process.stderr.write(`${msg}\n`);
  process.exit(1);
});

