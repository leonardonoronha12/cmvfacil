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

(async () => {
  const LOOKUP_ID = String(process.env.CMV_ENTRADA_ID || "").trim();
  if (LOOKUP_ID) {
    const { data: row, error } = await sb.from("entradas").select("*").eq("id", LOOKUP_ID).maybeSingle();
    if (error) {
      console.error(error);
      process.exit(1);
    }
    console.log(JSON.stringify({ ok: true, lookupId: LOOKUP_ID, found: Boolean(row), row }, null, 2));
    return;
  }

  const { data, error } = await sb
    .from("entradas")
    .select("id,fornecedor,data_lancamento,numero")
    .order("data_lancamento", { ascending: false })
    .limit(20);

  if (error) {
    console.error(error);
    process.exit(1);
  }

  console.log(JSON.stringify(data, null, 2));

  const firstId = String((data && data[0] && data[0].id) || "");
  const m = firstId.match(/^user:([0-9a-f-]{36}):/i);
  const uid = m ? m[1] : "";
  if (!uid) return;
  const { data: row, error: e2 } = await sb.from("fornecedores_state").select("id,info").eq("id", `user:${uid}`).maybeSingle();
  if (e2) {
    console.error(e2);
    process.exit(1);
  }
  const info = (row && row.info && typeof row.info === "object") ? row.info : {};
  const keys = Object.keys(info).slice(0, 30);
  console.log(JSON.stringify({ fornecedores_state_id: row ? row.id : null, infoKeysSample: keys }, null, 2));
})();
