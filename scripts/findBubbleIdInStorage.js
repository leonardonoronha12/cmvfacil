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
const LOOKUP = String(process.env.CMV_LOOKUP || "1750909513782x926655005595533300").trim();
const PATH_MATCH = String(process.env.CMV_PATH_MATCH || "").trim();
const MAX_SCAN = Math.max(1, Math.min(20000, Number.parseInt(String(process.env.CMV_MAX_SCAN || "400"), 10) || 400));

async function readTextFromStorage(bucket, path) {
  const { data, error } = await sb.storage.from(bucket).download(path);
  if (error || !data) return null;
  const buf = Buffer.from(await data.arrayBuffer());
  return buf.toString("utf8");
}

async function readJsonFromStorage(bucket, path) {
  const txt = await readTextFromStorage(bucket, path);
  if (!txt) return null;
  try {
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

async function listAll(bucket, prefix) {
  const paths = [];
  async function walk(currentPrefix, depth) {
    if (depth > 10) return;
    for (let offset = 0; offset < 200000; offset += 1000) {
      const { data, error } = await sb.storage
        .from(bucket)
        .list(currentPrefix, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
      if (error) throw error;
      const batch = data || [];
      for (const it of batch) {
        const name = String(it.name || "");
        const full = currentPrefix ? `${currentPrefix}/${name}` : name;
        if (it.id == null) await walk(full, depth + 1);
        else paths.push(full);
      }
      if (batch.length < 1000) break;
    }
  }
  await walk(prefix, 0);
  return paths;
}

(async () => {
  const bucket = "bubble-imports";
  const statePath = `user:${USER_ID}/bootstrap/sync-state.json`;
  const state = await readJsonFromStorage(bucket, statePath);
  const runPrefix = state && state.runPrefix ? String(state.runPrefix).trim().replace(/^\/+|\/+$/g, "") : "";
  if (!runPrefix) {
    console.log(JSON.stringify({ ok: false, error: "missing_runPrefix" }, null, 2));
    return;
  }
  const folder = runPrefix.split("/").slice(0, -1).join("/") || runPrefix;
  const allFiles = await listAll(bucket, folder);
  let candidates = allFiles.filter((p) => /bubble-api-/i.test(p));
  if (PATH_MATCH) {
    const needle = PATH_MATCH.toLowerCase();
    candidates = candidates.filter((p) => p.toLowerCase().includes(needle));
  }
  candidates = candidates.slice(0, MAX_SCAN);

  for (const path of candidates) {
    const txt = await readTextFromStorage(bucket, path);
    if (!txt) continue;
    if (txt.includes(LOOKUP)) {
      console.log(JSON.stringify({ ok: true, lookup: LOOKUP, found: true, file: path }, null, 2));
      return;
    }
  }
  console.log(JSON.stringify({ ok: true, lookup: LOOKUP, found: false, scanned: candidates.length, folder, pathMatch: PATH_MATCH || null }, null, 2));
})();
