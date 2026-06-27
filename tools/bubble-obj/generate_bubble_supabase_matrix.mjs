import fs from "fs";
import path from "path";

const ROOT = process.cwd();

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
    if ((v.startsWith("\"") && v.endsWith("\"")) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function uniq(arr) {
  return Array.from(new Set(arr.filter(Boolean)));
}

function normalizeName(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function singularGuess(s) {
  const t = normalizeName(s);
  if (t.endsWith("ses")) return t.slice(0, -2); // very rough
  if (t.endsWith("s") && t.length > 2) return t.slice(0, -1);
  return t;
}

async function bubbleMetaTypes({ baseUrl, token }) {
  const metaUrl = String(baseUrl).replace(/\/obj\/?$/i, "/meta");
  const res = await fetch(metaUrl, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  const text = await res.text();
  const json = safeJsonParse(text);
  if (!res.ok) throw new Error(`bubble_meta_http_${res.status}:${text.slice(0, 500)}`);
  const root = json?.response ?? json;
  const types = root?.types ?? root?.data_types ?? root?.dataTypes ?? root?.datatypes ?? null;
  if (!types) throw new Error(`bubble_meta_missing_types:keys=${Object.keys(root ?? {}).join(",")}`);
  const names = Array.isArray(types)
    ? types
        .map((t) => (typeof t === "string" ? t : t?.name ?? t?.type ?? ""))
        .map((x) => String(x || "").trim())
        .filter(Boolean)
    : Object.keys(types);
  names.sort((a, b) => a.localeCompare(b, "pt-BR"));
  return { metaUrl, names };
}

async function bubbleCountType({ objBaseUrl, token, typeName }) {
  const url = `${String(objBaseUrl).replace(/\/+$/, "")}/${encodeURIComponent(typeName)}?limit=1`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  const text = await res.text();
  const json = safeJsonParse(text);
  if (!res.ok) {
    const msg = json?.error?.type ? `${json?.error?.type}:${json?.error?.message ?? ""}` : text.slice(0, 250);
    return { ok: false, url, status: res.status, error: msg };
  }
  const root = json?.response ?? json;
  const results = Array.isArray(root?.results) ? root.results : [];
  const remaining = typeof root?.remaining === "number" ? root.remaining : null;
  const total = remaining != null ? remaining + results.length : results.length;
  const sample = results.length ? results[0] : null;
  return { ok: true, url, total, remaining, sample };
}

function looksLikeBubbleId(v) {
  const s = String(v ?? "").trim();
  if (!s) return false;
  return /^\d{10,}x\d{8,}$/.test(s) || /^\d{10,}x\d{5,}/.test(s);
}

function inferDependencies({ sample, bubbleTypeSet }) {
  if (!sample || typeof sample !== "object") return { byField: {}, types: [] };
  const byField = {};
  const depTypes = [];

  for (const [k, v] of Object.entries(sample)) {
    const key = normalizeName(k);
    const addDep = (dep) => {
      if (!dep) return;
      depTypes.push(dep);
      if (!byField[key]) byField[key] = [];
      byField[key].push(dep);
    };

    if (typeof v === "string") {
      if (looksLikeBubbleId(v) && key !== "unique_id" && key !== "_id" && key !== "id") {
        const keyGuess = key.endsWith("_id") ? key.slice(0, -3) : key;
        if (bubbleTypeSet.has(keyGuess)) addDep(keyGuess);
        else if (bubbleTypeSet.has(`${keyGuess}s`)) addDep(`${keyGuess}s`);
        else addDep(keyGuess);
      }
    } else if (Array.isArray(v)) {
      const ids = v.filter((x) => typeof x === "string" && looksLikeBubbleId(x));
      if (ids.length) {
        const keyGuess = key.endsWith("_ids") ? key.slice(0, -4) : key.endsWith("_id") ? key.slice(0, -3) : key;
        if (bubbleTypeSet.has(keyGuess)) addDep(keyGuess);
        else if (bubbleTypeSet.has(`${keyGuess}s`)) addDep(`${keyGuess}s`);
        else addDep(keyGuess);
      }
    }
  }

  for (const k of Object.keys(byField)) byField[k] = uniq(byField[k]).sort();
  return { byField, types: uniq(depTypes).sort() };
}

function walkFiles(dir, out) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next" || e.name === ".git" || e.name === "tools") continue;
      walkFiles(p, out);
    } else if (e.isFile()) {
      if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(e.name)) continue;
      out.push(p);
    }
  }
}

function extractSupabaseFromCalls(fileText) {
  const out = [];
  const re = /\.from\(\s*["']([^"']+)["']\s*\)/g;
  let m;
  while ((m = re.exec(fileText))) out.push(m[1]);
  return out;
}

function extractSupabaseStorageBuckets(fileText) {
  const out = [];
  const re = /\.storage\.from\(\s*["']([^"']+)["']\s*\)/g;
  let m;
  while ((m = re.exec(fileText))) out.push(m[1]);
  return out;
}

function extractSupabaseRpcCalls(fileText) {
  const out = [];
  const re = /\.rpc\(\s*["']([^"']+)["']\s*/g;
  let m;
  while ((m = re.exec(fileText))) out.push(m[1]);
  return out;
}

function extractRouteHints(filePath) {
  const norm = filePath.replace(/\\/g, "/");
  const i = norm.indexOf("/app/");
  if (i < 0) return [];
  const rest = norm.slice(i + 5);
  const parts = rest.split("/").filter(Boolean);
  const seg = parts[0] || "";
  if (!seg) return [];
  if (seg === "api") {
    const apiName = parts[1] || "";
    if (!apiName) return [];
    return [apiName];
  }
  return [seg];
}

function parsePublicTablesFromSchemaDump(schemaText) {
  const tables = [];
  const re = /CREATE TABLE IF NOT EXISTS\s+"public"\."([^"]+)"/g;
  let m;
  while ((m = re.exec(schemaText))) tables.push(m[1]);
  return uniq(tables).sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function pickTargetTable({ bubbleType, publicTables, usedTables }) {
  const t = normalizeName(bubbleType);
  const candidates = uniq([
    t,
    singularGuess(t),
    `${t}_state`,
    `${singularGuess(t)}_state`,
  ]);
  const exists = candidates.filter((c) => publicTables.includes(c));
  const used = exists.filter((c) => usedTables.includes(c));
  if (used.length) return { table: used[0], reason: "exists+used" };
  if (exists.length) return { table: exists[0], reason: "exists" };
  return { table: "", reason: "no_match" };
}

function priorityFromRoutes(routes) {
  if (!routes || !routes.length) return "baixa";
  if (routes.includes("dashboard")) return "alta";
  if (routes.includes("inventario") || routes.includes("entradas") || routes.includes("desperdicios") || routes.includes("insumos")) return "alta";
  return "média";
}

async function main() {
  const env = { ...readDotenv(path.join(ROOT, ".env.local")), ...readDotenv(path.join(ROOT, ".bubble.env.local")) };
  const baseUrl = String(env.BUBBLE_BASE_URL ?? "").trim();
  const token = String(env.BUBBLE_API_TOKEN ?? "").trim();
  if (!baseUrl || !token) throw new Error("missing_BUBBLE_BASE_URL_or_BUBBLE_API_TOKEN");

  const { metaUrl, names: bubbleTypes } = await bubbleMetaTypes({ baseUrl, token });
  const bubbleTypeSet = new Set(bubbleTypes.map((x) => normalizeName(x)));

  const schemaPath = path.join(ROOT, "tools", "bubble-obj", "out", "remote_public_schema.sql");
  const schemaText = fs.existsSync(schemaPath) ? fs.readFileSync(schemaPath, "utf8") : "";
  const publicTables = schemaText ? parsePublicTablesFromSchemaDump(schemaText) : [];

  const files = [];
  walkFiles(path.join(ROOT, "app"), files);
  const middlewareFile = path.join(ROOT, "middleware.ts");
  if (fs.existsSync(middlewareFile)) files.push(middlewareFile);
  const usedTables = new Set();
  const usedBuckets = new Set();
  const usedRpcs = new Set();
  const tableToRoutes = new Map();

  for (const f of files) {
    let text = "";
    try {
      text = fs.readFileSync(f, "utf8");
    } catch {
      continue;
    }
    const buckets = extractSupabaseStorageBuckets(text);
    for (const b of buckets) usedBuckets.add(b);

    const tables = extractSupabaseFromCalls(text).filter((t) => !buckets.includes(t));
    const rpcs = extractSupabaseRpcCalls(text);
    const routes = extractRouteHints(f);
    for (const t of tables) {
      usedTables.add(t);
      if (routes.length) {
        if (!tableToRoutes.has(t)) tableToRoutes.set(t, new Set());
        for (const r of routes) tableToRoutes.get(t).add(r);
      }
    }
    for (const r of rpcs) usedRpcs.add(r);
  }

  const usedTablesArr = Array.from(usedTables).sort((a, b) => a.localeCompare(b, "pt-BR"));
  const usedBucketsArr = Array.from(usedBuckets).sort((a, b) => a.localeCompare(b, "pt-BR"));

  const rows = [];
  const unmapped = [];

  for (const bubbleType of bubbleTypes) {
    const countRes = await bubbleCountType({ objBaseUrl: baseUrl, token, typeName: bubbleType });
    const total = countRes.ok ? countRes.total : null;
    const deps = countRes.ok ? inferDependencies({ sample: countRes.sample, bubbleTypeSet }) : { byField: {}, types: [] };

    const target = pickTargetTable({ bubbleType, publicTables, usedTables: usedTablesArr });
    const routes = target.table && tableToRoutes.has(target.table) ? Array.from(tableToRoutes.get(target.table)).sort() : [];

    const status = target.table ? "OK (mapeado)" : "Existe no Bubble, mas não está mapeado";
    if (!target.table) unmapped.push(bubbleType);

    rows.push({
      bubbleType,
      bubbleCount: total,
      screens: routes,
      suggestedSupabaseTable: target.table,
      mappingStatus: status,
      dependencies: deps.types,
      dependencyFields: deps.byField,
      priority: priorityFromRoutes(routes),
      bubbleCountError: countRes.ok ? "" : `${countRes.status}:${countRes.error}`,
    });
  }

  const payload = {
    ok: true,
    metaUrl,
    bubbleTypesCount: bubbleTypes.length,
    bubbleTypes,
    supabasePublicTablesCount: publicTables.length,
    usedSupabaseTablesCount: usedTablesArr.length,
    usedSupabaseTables: usedTablesArr,
    usedSupabaseStorageBuckets: usedBucketsArr,
    usedSupabaseRpcs: Array.from(usedRpcs).sort(),
    unmappedBubbleTypes: unmapped,
    rows,
  };

  const outPath = path.join(ROOT, "tools", "bubble-obj", "out", "bubble_supabase_matrix.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n", "utf8");

  console.log(JSON.stringify({ ok: true, wrote: outPath, bubbleTypesCount: bubbleTypes.length, unmappedCount: unmapped.length }, null, 2));
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(JSON.stringify({ ok: false, error: msg }, null, 2));
  process.exit(1);
});
