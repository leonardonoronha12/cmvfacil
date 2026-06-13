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
const EMAIL = String(process.env.CMV_EMAIL || "goldburger013@gmail.com").trim().toLowerCase();

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

function asList(json) {
  if (Array.isArray(json)) return json;
  if (json && typeof json === "object" && Array.isArray(json.rows)) return json.rows;
  return [];
}

function normalizeKey(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
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
  const userFiles = allFiles.filter((p) => /bubble-api-(user|users|usuario|usuarios)/i.test(p));
  let found = null;
  for (const path of userFiles.slice(0, 80)) {
    const json = await readJsonFromStorage(bucket, path);
    const list = asList(json);
    for (const obj of list) {
      if (!obj || typeof obj !== "object") continue;
      const email = String(obj.email || obj.Email || "").trim().toLowerCase();
      if (email && email === EMAIL) {
        found = { path, obj };
        break;
      }
    }
    if (found) break;
  }

  if (!found) {
    console.log(JSON.stringify({ ok: true, email: EMAIL, found: false, files: userFiles.length }, null, 2));
    return;
  }

  const obj = found.obj;
  const flat = {};
  for (const [k, v] of Object.entries(obj)) {
    const nk = normalizeKey(k);
    if (!nk) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v == null) flat[nk] = v;
    else flat[nk] = JSON.stringify(v);
  }
  const interesting = Object.fromEntries(
    Object.entries(flat).filter(([k]) => k.includes("empresa") || k.includes("restaur") || k.includes("company") || k.includes("unidade") || k.includes("selected") || k.includes("atual")),
  );
  console.log(JSON.stringify({ ok: true, email: EMAIL, found: true, file: found.path, id: String(obj._id || obj.id || obj.unique_id || ''), interestingKeys: Object.keys(interesting), interesting }, null, 2));
})();

