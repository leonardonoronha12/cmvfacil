const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

function loadEnvFromFile(filePath) {
  if (!filePath) return { loaded: false, filePath: "" };
  if (!fs.existsSync(filePath)) return { loaded: false, filePath };
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = String(line ?? "").trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (!key) continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!Object.prototype.hasOwnProperty.call(process.env, key)) process.env[key] = value;
  }
  return { loaded: true, filePath };
}

function pickConnEnv() {
  const candidates = [
    "DATABASE_URL",
    "SUPABASE_DB_URL",
    "SUPABASE_DATABASE_URL",
    "POSTGRES_URL",
    "POSTGRES_URL_NON_POOLING",
    "DIRECT_URL",
  ];
  for (const k of candidates) {
    const v = String(process.env[k] ?? "").trim();
    if (v) return { key: k, value: v };
  }
  return null;
}

function deriveSupabaseConn() {
  const pwdKeys = ["SUPABASE_DB_PASSWORD", "SUPABASE_DATABASE_PASSWORD", "SUPABASE_POSTGRES_PASSWORD", "SUPABASE_DB_PASS"];
  let password = "";
  for (const k of pwdKeys) {
    const v = String(process.env[k] ?? "").trim();
    if (v) {
      password = v;
      break;
    }
  }
  const urlKeys = ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"];
  let supabaseUrl = "";
  for (const k of urlKeys) {
    const v = String(process.env[k] ?? "").trim();
    if (v) {
      supabaseUrl = v;
      break;
    }
  }
  if (!password || !supabaseUrl) return null;

  let ref = "";
  try {
    const u = new URL(supabaseUrl);
    const host = String(u.host ?? "").trim();
    const m = host.match(/^([a-z0-9-]+)\.supabase\.co$/i);
    ref = m?.[1] ? String(m[1]).trim() : "";
  } catch {
    ref = "";
  }
  if (!ref) return null;

  const connectionString = `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres`;
  return { key: "derived:supabase", value: connectionString };
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");

  const envFiles = [
    ".env.local",
    ".env.development.local",
    ".env.production.local",
    ".env.preview.local",
    ".env.supabase-cli.local",
  ];
  const loadedEnvFiles = envFiles.map((f) => loadEnvFromFile(path.join(process.cwd(), f))).filter((x) => x.loaded);

  const conn = pickConnEnv() ?? deriveSupabaseConn();
  if (!conn) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: "no_db_connection_env",
          message:
            "Defina uma variável de ambiente com a connection string do Postgres (ex.: DATABASE_URL). O script não encontrou nenhuma das variáveis esperadas.",
          expectedEnv: ["DATABASE_URL", "SUPABASE_DB_URL", "SUPABASE_DATABASE_URL", "POSTGRES_URL", "POSTGRES_URL_NON_POOLING", "DIRECT_URL"],
          fallbackDerivation:
            "Se houver SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL + SUPABASE_DB_PASSWORD (ou similares), o script também consegue derivar a connection string automaticamente.",
          loadedEnvFiles: loadedEnvFiles.map((x) => x.filePath),
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  const tables = [
    "categories",
    "companies",
    "suppliers",
    "invoices",
    "inventories",
    "items",
    "recipe_ingredients",
    "waste_reasons",
    "wastes",
    "avg_cost_events",
    "invoice_items",
    "inventory_items",
    "labels",
  ];

  const insecureSsl = String(process.env.PG_SSL_INSECURE ?? "").trim() === "1" || String(conn.key ?? "").startsWith("derived:");
  const client = new Client(
    insecureSsl
      ? { connectionString: conn.value, ssl: { rejectUnauthorized: false } }
      : { connectionString: conn.value },
  );
  await client.connect();

  if (apply) {
    const migrationPath = path.join(process.cwd(), "supabase", "migrations", "20260707000000_external_key.sql");
    const sql = fs.readFileSync(migrationPath, "utf8");
    await client.query(sql);
  }

  const results = [];
  for (const table of tables) {
    const colsRes = await client.query(
      `select column_name
       from information_schema.columns
       where table_schema = 'public' and table_name = $1
       order by ordinal_position`,
      [table],
    );
    const columns = colsRes.rows.map((r) => String(r.column_name ?? "").trim()).filter(Boolean);

    const idxRes = await client.query(
      `select indexname, indexdef
       from pg_indexes
       where schemaname = 'public' and tablename = $1
       order by indexname`,
      [table],
    );
    const indexes = idxRes.rows.map((r) => ({
      indexname: String(r.indexname ?? "").trim(),
      indexdef: String(r.indexdef ?? "").trim(),
    }));

    const externalKey = columns.includes("external_key");
    const externalKeyIndexes = indexes.filter((i) => i.indexdef.toLowerCase().includes("external_key"));

    results.push({
      table,
      has_external_key: externalKey,
      external_key_indexes: externalKeyIndexes.map((i) => i.indexname),
      external_key_unique_indexes: externalKeyIndexes.filter((i) => i.indexdef.toLowerCase().includes("unique")).map((i) => i.indexname),
    });
  }

  const expectedUniqueIndex = {
    companies: { kind: "single", names: ["companies_external_key_uidx"] },
    categories: { kind: "company", names: ["categories_company_external_key_uidx"] },
    suppliers: { kind: "company", names: ["suppliers_company_external_key_uidx"] },
    invoices: { kind: "company", names: ["invoices_company_external_key_uidx"] },
    inventories: { kind: "company", names: ["inventories_company_external_key_uidx"] },
    items: { kind: "company", names: ["items_company_external_key_uidx"] },
    recipe_ingredients: { kind: "company", names: ["recipe_ingredients_company_external_key_uidx"] },
    waste_reasons: { kind: "company", names: ["waste_reasons_company_external_key_uidx"] },
    wastes: { kind: "company", names: ["wastes_company_external_key_uidx"] },
    avg_cost_events: { kind: "company", names: ["avg_cost_events_company_external_key_uidx"] },
    invoice_items: { kind: "company", names: ["invoice_items_company_external_key_uidx"] },
    inventory_items: { kind: "company", names: ["inventory_items_company_external_key_uidx"] },
    labels: { kind: "company", names: ["labels_company_external_key_uidx"] },
  };

  const problems = [];
  for (const r of results) {
    if (!r.has_external_key) problems.push({ table: r.table, problem: "missing_column:external_key" });
    const exp = expectedUniqueIndex[r.table];
    if (exp) {
      const hasAnyExpected = exp.names.some((n) => r.external_key_unique_indexes.includes(n));
      if (!hasAnyExpected) problems.push({ table: r.table, problem: "missing_unique_index", expected: exp.names, found: r.external_key_unique_indexes });
    }
  }

  await client.end();

  console.log(
    JSON.stringify(
      {
        ok: problems.length === 0,
        applied: apply,
        connectionEnv: conn.key,
        results,
        problems,
      },
      null,
      2,
    ),
  );
  process.exit(problems.length ? 2 : 0);
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: String(err?.message ?? err) }, null, 2));
  process.exit(1);
});
