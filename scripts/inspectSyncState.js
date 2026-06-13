const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");

function parseDotEnv(filePath) {
  let raw = "";
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return {};
  }
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const l = String(line || "").trim();
    if (!l || l.startsWith("#")) continue;
    const m = l.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = String(m[2] || "").trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
      val = val.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    out[key] = val;
  }
  return out;
}

const envLocal = parseDotEnv(".env.local");
for (const [k, v] of Object.entries(envLocal)) {
  if (process.env[k] == null) process.env[k] = v;
}

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;

if (!url || !key) {
  console.error("missing supabase env");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const USER_ID = process.env.CMV_USER_ID || "359b2c94-e3f4-4449-9cd4-183d56532bbc";

async function readJsonFromStorage(bucket, path) {
  const { data, error } = await sb.storage.from(bucket).download(path);
  if (error || !data) return null;
  const buf = Buffer.from(await data.arrayBuffer());
  try {
    return JSON.parse(buf.toString("utf8"));
  } catch {
    return null;
  }
}

(async () => {
  const bucket = "bubble-imports";
  const statePath = `user:${USER_ID}/bootstrap/sync-state.json`;
  const state = await readJsonFromStorage(bucket, statePath);
  if (!state) {
    console.log(JSON.stringify({ ok: false, error: "missing_state", statePath }, null, 2));
    return;
  }
  const perType = state.perType && typeof state.perType === "object" ? state.perType : {};
  const perTypeSummary = {};
  for (const [k, v] of Object.entries(perType)) {
    perTypeSummary[k] = {
      status: v && typeof v === "object" ? v.status : undefined,
      constraintStrategy: v && typeof v === "object" ? v.constraintStrategy : undefined,
      companyKeyIndex: v && typeof v === "object" ? v.companyKeyIndex : undefined,
      fetched: v && typeof v === "object" ? v.fetched : undefined,
      parts: v && typeof v === "object" ? v.parts : undefined,
      lastError: v && typeof v === "object" ? v.lastError : undefined,
    };
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        userId: USER_ID,
        phase: state.phase,
        lastError: state.lastError,
        runPrefix: state.runPrefix,
        filter: state.filter,
        types: state.types,
        perType: perTypeSummary,
      },
      null,
      2,
    ),
  );
})();

