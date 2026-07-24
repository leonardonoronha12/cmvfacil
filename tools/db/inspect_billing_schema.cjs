const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

function loadEnvFromFile(filePath) {
  if (!filePath) return;
  if (!fs.existsSync(filePath)) return;
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
}

function pickConnEnv() {
  const candidates = ["DATABASE_URL", "SUPABASE_DB_URL", "SUPABASE_DATABASE_URL", "POSTGRES_URL", "POSTGRES_URL_NON_POOLING", "DIRECT_URL"];
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

async function fetchColumns(client, tableName) {
  const res = await client.query(
    `select column_name, data_type, udt_name, is_nullable, column_default
     from information_schema.columns
     where table_schema = 'public' and table_name = $1
     order by ordinal_position`,
    [tableName],
  );
  return res.rows.map((r) => ({
    column_name: String(r.column_name ?? ""),
    data_type: String(r.data_type ?? ""),
    udt_name: String(r.udt_name ?? ""),
    is_nullable: String(r.is_nullable ?? ""),
    column_default: r.column_default == null ? null : String(r.column_default),
  }));
}

async function fetchIndexes(client, tableName) {
  const res = await client.query(
    `select indexname, indexdef
     from pg_indexes
     where schemaname = 'public' and tablename = $1
     order by indexname`,
    [tableName],
  );
  return res.rows.map((r) => ({
    indexname: String(r.indexname ?? ""),
    indexdef: String(r.indexdef ?? ""),
  }));
}

async function fetchConstraints(client, tableName) {
  const res = await client.query(
    `select
       tc.constraint_name,
       tc.constraint_type,
       kcu.column_name,
       ccu.table_name as foreign_table_name,
       ccu.column_name as foreign_column_name
     from information_schema.table_constraints tc
     left join information_schema.key_column_usage kcu
       on tc.constraint_name = kcu.constraint_name
      and tc.table_schema = kcu.table_schema
     left join information_schema.constraint_column_usage ccu
       on ccu.constraint_name = tc.constraint_name
      and ccu.table_schema = tc.table_schema
     where tc.table_schema = 'public' and tc.table_name = $1
     order by tc.constraint_type, tc.constraint_name, kcu.ordinal_position`,
    [tableName],
  );
  return res.rows.map((r) => ({
    constraint_name: String(r.constraint_name ?? ""),
    constraint_type: String(r.constraint_type ?? ""),
    column_name: r.column_name == null ? null : String(r.column_name),
    foreign_table_name: r.foreign_table_name == null ? null : String(r.foreign_table_name),
    foreign_column_name: r.foreign_column_name == null ? null : String(r.foreign_column_name),
  }));
}

async function fetchTriggers(client, tableName) {
  const res = await client.query(
    `select t.tgname, pg_get_triggerdef(t.oid) as triggerdef
     from pg_trigger t
     join pg_class c on c.oid = t.tgrelid
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = $1 and not t.tgisinternal
     order by t.tgname`,
    [tableName],
  );
  return res.rows.map((r) => ({
    tgname: String(r.tgname ?? ""),
    triggerdef: String(r.triggerdef ?? ""),
  }));
}

async function fetchFunctions(client, names) {
  const res = await client.query(
    `select
       p.proname,
       pg_get_function_identity_arguments(p.oid) as identity_args,
       pg_get_function_result(p.oid) as result_type
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any($1::text[])
     order by p.proname`,
    [names],
  );
  return res.rows.map((r) => ({
    proname: String(r.proname ?? ""),
    identity_args: String(r.identity_args ?? ""),
    result_type: String(r.result_type ?? ""),
  }));
}

async function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const outPath = outIdx >= 0 ? String(args[outIdx + 1] ?? "").trim() : "";

  const envFiles = [".env.local", ".env.development.local", ".env.production.local", ".env.preview.local", ".env.supabase-cli.local"];
  for (const f of envFiles) loadEnvFromFile(path.join(process.cwd(), f));

  const conn = pickConnEnv() ?? deriveSupabaseConn();
  if (!conn) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          error: "no_db_connection_env",
          expectedEnv: ["DATABASE_URL", "SUPABASE_DB_URL", "SUPABASE_DATABASE_URL", "POSTGRES_URL", "POSTGRES_URL_NON_POOLING", "DIRECT_URL"],
          fallbackDerivation: "SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL + SUPABASE_DB_PASSWORD",
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  const insecureSsl = String(process.env.PG_SSL_INSECURE ?? "").trim() === "1" || String(conn.key ?? "").startsWith("derived:");
  const client = new Client(insecureSsl ? { connectionString: conn.value, ssl: { rejectUnauthorized: false } } : { connectionString: conn.value });
  await client.connect();

  const existsRes = await client.query(
    `select table_name
     from information_schema.tables
     where table_schema = 'public' and table_name = any($1::text[])
     order by table_name`,
    [["companies", "company_members", "automation_messages", "stripe_webhook_events"]],
  );
  const existingTables = existsRes.rows.map((r) => String(r.table_name ?? "")).filter(Boolean);

  const companies = {
    columns: existingTables.includes("companies") ? await fetchColumns(client, "companies") : [],
    indexes: existingTables.includes("companies") ? await fetchIndexes(client, "companies") : [],
    triggers: existingTables.includes("companies") ? await fetchTriggers(client, "companies") : [],
  };

  const companiesColSet = new Set(companies.columns.map((c) => String(c.column_name ?? "").trim()).filter(Boolean));

  const companyMembers = {
    columns: existingTables.includes("company_members") ? await fetchColumns(client, "company_members") : [],
    indexes: existingTables.includes("company_members") ? await fetchIndexes(client, "company_members") : [],
    constraints: existingTables.includes("company_members") ? await fetchConstraints(client, "company_members") : [],
  };

  const automationMessages = {
    columns: existingTables.includes("automation_messages") ? await fetchColumns(client, "automation_messages") : [],
    indexes: existingTables.includes("automation_messages") ? await fetchIndexes(client, "automation_messages") : [],
    constraints: existingTables.includes("automation_messages") ? await fetchConstraints(client, "automation_messages") : [],
  };

  const hasTrialCols = companiesColSet.has("trial_started_at") && companiesColSet.has("trial_ends_at");
  const hasStatusCol = companiesColSet.has("subscription_status");
  const trialCounts = existingTables.includes("companies")
    ? (
        await client.query(
          `select
             count(*)::int as total,
             ${hasTrialCols ? "count(*) filter (where trial_started_at is null)::int as no_trial_started," : "null::int as no_trial_started,"}
             ${hasTrialCols ? "count(*) filter (where trial_ends_at is null)::int as no_trial_ends," : "null::int as no_trial_ends,"}
             ${hasTrialCols ? "count(*) filter (where trial_started_at is not null and trial_ends_at is null)::int as started_no_end," : "null::int as started_no_end,"}
             ${hasTrialCols ? "count(*) filter (where trial_started_at is null and trial_ends_at is not null)::int as end_no_started," : "null::int as end_no_started,"}
             ${hasStatusCol ? "count(*) filter (where coalesce(subscription_status,'') = '' )::int as status_empty," : "null::int as status_empty,"}
             ${
               hasTrialCols && hasStatusCol
                 ? "count(*) filter (where subscription_status = 'trial_internal' and (trial_started_at is null or trial_ends_at is null))::int as trial_status_without_dates"
                 : "null::int as trial_status_without_dates"
             }
           from public.companies`,
        )
      ).rows?.[0] ?? null
    : null;

  const rpcFunctions = await fetchFunctions(client, ["enqueue_bravo_event", "upsert_contact"]);

  await client.end();

  const payload = {
    ok: true,
    connectionEnv: conn.key,
    existingTables,
    companies,
    companyMembers,
    automationMessages,
    rpcFunctions,
    trialCounts,
  };
  const text = JSON.stringify(payload, null, 2);

  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${text}\n`, "utf8");
    process.stdout.write(`{"ok":true,"written":true}\n`);
    return;
  }

  process.stdout.write(`${text}\n`);
}

main().catch((err) => {
  console.log(JSON.stringify({ ok: false, error: String(err?.message ?? err) }, null, 2));
  process.exit(1);
});
