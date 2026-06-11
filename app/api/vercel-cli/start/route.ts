import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync } from "fs";
import { createJob, getLastSecrets, runPowershellJob, setLastSecrets } from "../_store";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return NextResponse.json(data, { ...init, headers });
}

function isEnabled(req: NextRequest) {
  if (process.env.NODE_ENV === "production") return false;
  const host = String(req.headers.get("host") ?? "").toLowerCase();
  if (!host.includes("localhost") && !host.includes("127.0.0.1")) return false;
  return true;
}

function safeSlug(input: unknown) {
  const s = String(input ?? "").trim();
  if (!s) return "";
  if (!/^[a-z0-9][a-z0-9-_]{0,80}$/i.test(s)) return "";
  return s;
}

function psQuote(value: string) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

function stripLineBreaks(value: string) {
  return String(value ?? "").replace(/[\r\n]+/g, "").trim();
}

function parseDotEnv(filePath: string) {
  let raw = "";
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const l = line.trim();
    if (!l || l.startsWith("#")) continue;
    const m = l.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    const key = m[1]!;
    let val = (m[2] ?? "").trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
      val = val.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    out[key] = val;
  }
  return out;
}

function getLocalEnv(name: string) {
  const v = (process.env[name] ?? "").trim();
  if (v) return v;
  const envLocal = parseDotEnv(".env.local");
  const v2 = String(envLocal[name] ?? "").trim();
  return v2 || null;
}

function upsertEnvFile(filePath: string, vars: Record<string, string | undefined>) {
  const keys = Object.keys(vars).filter((k) => typeof k === "string" && k.trim());
  if (keys.length === 0) return;

  let existing = "";
  try {
    existing = readFileSync(filePath, "utf8");
  } catch {
    existing = "";
  }

  const lines = existing ? existing.split(/\r?\n/) : [];
  const indexByKey = new Map<string, number>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (m?.[1]) indexByKey.set(m[1], i);
  }

  const setLine = (k: string, v: string) => `${k}="${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

  for (const k of keys) {
    const v = vars[k];
    if (typeof v !== "string" || !v.trim()) continue;
    const line = setLine(k, v.trim());
    const idx = indexByKey.get(k);
    if (typeof idx === "number") {
      lines[idx] = line;
    } else {
      lines.push(line);
    }
  }

  const out = lines.join("\n").replace(/\n{3,}/g, "\n\n");
  writeFileSync(filePath, out.endsWith("\n") ? out : `${out}\n`, "utf8");
}

type Body = {
  token?: string;
  mode?: "deployLinked" | "linkAndDeploy" | "alias" | "setEnvAndDeploy" | "deployAndAlias";
  project?: string;
  scope?: string;
  deploymentUrl?: string;
  aliasDomain?: string;
  forceAlias?: boolean;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  supabaseServiceRoleKey?: string;
};

export async function POST(req: NextRequest) {
  if (!isEnabled(req)) return json({ ok: false, error: "disabled" }, { status: 403 });

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const last = getLastSecrets();
  const token = String(body?.token ?? last?.token ?? "").trim();
  if (!token) return json({ ok: false, error: "missing_token" }, { status: 400 });

  const mode =
    body?.mode === "setEnvAndDeploy"
      ? "setEnvAndDeploy"
      : body?.mode === "deployAndAlias"
        ? "deployAndAlias"
      : body?.mode === "alias"
        ? "alias"
        : body?.mode === "linkAndDeploy"
          ? "linkAndDeploy"
          : "deployLinked";
  const project = safeSlug(body?.project);
  const scope = safeSlug(body?.scope);
  if (!scope) return json({ ok: false, error: "missing_scope" }, { status: 400 });

  const rawDeploymentUrl = String(body?.deploymentUrl ?? "").trim();
  const deploymentUrl = rawDeploymentUrl.replace(/^https?:\/\//i, "").replace(/\/+$/, "").trim();
  const aliasDomain = String(body?.aliasDomain ?? "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "").trim();
  const forceAlias = Boolean(body?.forceAlias);

  const isHost = (value: string) => /^[a-z0-9][a-z0-9.-]{0,250}[a-z0-9]$/i.test(value) && !value.includes("..");

  if (mode === "alias") {
    if (!deploymentUrl || !isHost(deploymentUrl)) return json({ ok: false, error: "invalid_deployment_url" }, { status: 400 });
    if (!aliasDomain || !isHost(aliasDomain)) return json({ ok: false, error: "invalid_alias_domain" }, { status: 400 });
  }
  if (mode === "deployAndAlias") {
    const a = aliasDomain || "cmvfacil.vercel.app";
    if (!isHost(a)) return json({ ok: false, error: "invalid_alias_domain" }, { status: 400 });
  }

  const supabaseUrl = String(body?.supabaseUrl ?? "").trim();
  const supabaseAnonKey = String(body?.supabaseAnonKey ?? "").trim();
  const supabaseServiceRoleKey = String(body?.supabaseServiceRoleKey ?? "").trim();

  if (mode === "setEnvAndDeploy") {
    if (!project) return json({ ok: false, error: "missing_project" }, { status: 400 });
    const resolvedSupabaseUrl =
      supabaseUrl ||
      String(last?.supabaseUrl ?? "").trim() ||
      getLocalEnv("SUPABASE_URL") ||
      getLocalEnv("NEXT_PUBLIC_SUPABASE_URL") ||
      (getLocalEnv("SUPABASE_FUNCTIONS_BASE_URL") ? getLocalEnv("SUPABASE_FUNCTIONS_BASE_URL")!.replace(/\/functions\/v1\/?$/, "") : null) ||
      "";
    const resolvedAnonKey =
      supabaseAnonKey ||
      String(last?.supabaseAnonKey ?? "").trim() ||
      getLocalEnv("SUPABASE_ANON_KEY") ||
      getLocalEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY") ||
      getLocalEnv("SUPABASE_ANON_PUBLIC_KEY") ||
      getLocalEnv("NEXT_PUBLIC_SUPABASE_ANON_PUBLIC_KEY") ||
      "";
    const resolvedServiceRoleKey =
      supabaseServiceRoleKey || String(last?.supabaseServiceRoleKey ?? "").trim() || getLocalEnv("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!resolvedSupabaseUrl) return json({ ok: false, error: "missing_supabase_url" }, { status: 400 });
    if (!resolvedAnonKey) return json({ ok: false, error: "missing_supabase_anon_key" }, { status: 400 });

    setLastSecrets({
      token,
      scope,
      project,
      supabaseUrl: resolvedSupabaseUrl,
      supabaseAnonKey: resolvedAnonKey,
      supabaseServiceRoleKey: resolvedServiceRoleKey || undefined,
    });

    upsertEnvFile(".env.local", {
      SUPABASE_URL: resolvedSupabaseUrl,
      NEXT_PUBLIC_SUPABASE_URL: resolvedSupabaseUrl,
      SUPABASE_ANON_KEY: resolvedAnonKey,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: resolvedAnonKey,
      SUPABASE_SERVICE_ROLE_KEY: resolvedServiceRoleKey || undefined,
    });
  }

  if (body?.token || body?.supabaseUrl || body?.supabaseAnonKey || body?.supabaseServiceRoleKey || body?.scope || body?.project) {
    setLastSecrets({
      token: body?.token ? token : undefined,
      scope: body?.scope ? scope : undefined,
      project: body?.project ? project : undefined,
      supabaseUrl: body?.supabaseUrl ? supabaseUrl : undefined,
      supabaseAnonKey: body?.supabaseAnonKey ? supabaseAnonKey : undefined,
      supabaseServiceRoleKey: body?.supabaseServiceRoleKey ? supabaseServiceRoleKey : undefined,
    });
  }

  const id = crypto.randomUUID();
  const job = createJob(id);

  const ps: string[] = [];
  ps.push("npx vercel --version");
  if (mode === "setEnvAndDeploy") {
    const resolvedSupabaseUrl =
      supabaseUrl ||
      String(last?.supabaseUrl ?? "").trim() ||
      getLocalEnv("SUPABASE_URL") ||
      getLocalEnv("NEXT_PUBLIC_SUPABASE_URL") ||
      (getLocalEnv("SUPABASE_FUNCTIONS_BASE_URL") ? getLocalEnv("SUPABASE_FUNCTIONS_BASE_URL")!.replace(/\/functions\/v1\/?$/, "") : null) ||
      "";
    const resolvedAnonKey =
      supabaseAnonKey ||
      String(last?.supabaseAnonKey ?? "").trim() ||
      getLocalEnv("SUPABASE_ANON_KEY") ||
      getLocalEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY") ||
      getLocalEnv("SUPABASE_ANON_PUBLIC_KEY") ||
      getLocalEnv("NEXT_PUBLIC_SUPABASE_ANON_PUBLIC_KEY") ||
      "";
    const resolvedServiceRoleKey =
      supabaseServiceRoleKey || String(last?.supabaseServiceRoleKey ?? "").trim() || getLocalEnv("SUPABASE_SERVICE_ROLE_KEY") || "";
    ps.push(`npx vercel link --yes --project ${project} --scope ${scope} --token $env:VERCEL_TOKEN`);
    ps.push(`Write-Output 'Setting SUPABASE_URL...'`);
    ps.push(
      `$env:CMV_SUPABASE_URL | npx vercel env add SUPABASE_URL production --force --yes --sensitive --scope ${scope} --token $env:VERCEL_TOKEN`,
    );
    ps.push(
      `$env:CMV_SUPABASE_URL | npx vercel env add NEXT_PUBLIC_SUPABASE_URL production --force --yes --sensitive --scope ${scope} --token $env:VERCEL_TOKEN`,
    );
    ps.push(
      `Write-Output 'Setting NEXT_PUBLIC_SUPABASE_ANON_KEY...'`,
    );
    ps.push(
      `$env:CMV_SUPABASE_ANON_KEY | npx vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production --force --yes --sensitive --scope ${scope} --token $env:VERCEL_TOKEN`,
    );
    if (resolvedServiceRoleKey) {
      ps.push(
        `Write-Output 'Setting SUPABASE_SERVICE_ROLE_KEY...'`,
      );
      ps.push(
        `$env:CMV_SUPABASE_SERVICE_ROLE_KEY | npx vercel env add SUPABASE_SERVICE_ROLE_KEY production --force --yes --sensitive --scope ${scope} --token $env:VERCEL_TOKEN`,
      );
    }
    ps.push(`Write-Output 'Deploying to production...'`);
    ps.push(`$outLines = @()`);
    ps.push(`npx vercel --prod --yes --scope ${scope} --token $env:VERCEL_TOKEN 2>&1 | Tee-Object -Variable outLines | Out-Default`);
    ps.push(`$outText = ($outLines | Out-String)`);
    ps.push(
      `$deployUrl = ($outText | Select-String -Pattern 'https://[a-z0-9-]+\\.vercel\\.app' -AllMatches | ForEach-Object { $_.Matches } | ForEach-Object { $_.Value } | Select-Object -Last 1)`,
    );
    ps.push(`if (-not $deployUrl) { throw 'deploy_url_not_found' }`);
    ps.push(`$deployUrl = ($deployUrl | Out-String).Trim()`);
    ps.push(`Write-Output ('DEPLOY_URL ' + $deployUrl)`);
    ps.push(`try { npx vercel alias rm cmvfacil.vercel.app --yes --scope ${scope} --token $env:VERCEL_TOKEN } catch {}`);
    ps.push(`npx vercel alias set $deployUrl cmvfacil.vercel.app --scope ${scope} --token $env:VERCEL_TOKEN`);
  } else if (mode === "deployAndAlias") {
    const a = aliasDomain || "cmvfacil.vercel.app";
    const doForce = Boolean(forceAlias);
    if (project) {
      ps.push(`npx vercel link --yes --project ${project} --scope ${scope} --token $env:VERCEL_TOKEN`);
    } else {
      ps.push(`npx vercel link --yes --scope ${scope} --token $env:VERCEL_TOKEN`);
    }
    ps.push(`Write-Output 'Deploying to production...'`);
    ps.push(`$outLines = @()`);
    ps.push(`npx vercel --prod --yes --scope ${scope} --token $env:VERCEL_TOKEN 2>&1 | Tee-Object -Variable outLines | Out-Default`);
    ps.push(`$outText = ($outLines | Out-String)`);
    ps.push(
      `$deployUrl = ($outText | Select-String -Pattern 'https://[a-z0-9-]+\\.vercel\\.app' -AllMatches | ForEach-Object { $_.Matches } | ForEach-Object { $_.Value } | Select-Object -Last 1)`,
    );
    ps.push(`if (-not $deployUrl) { throw 'deploy_url_not_found' }`);
    ps.push(`$deployUrl = ($deployUrl | Out-String).Trim()`);
    ps.push(`Write-Output ('DEPLOY_URL ' + $deployUrl)`);
    if (doForce) {
      ps.push(`try { npx vercel alias rm ${a} --yes --scope ${scope} --token $env:VERCEL_TOKEN } catch {}`);
    }
    ps.push(`npx vercel alias set $deployUrl ${a} --scope ${scope} --token $env:VERCEL_TOKEN`);
  } else if (mode === "alias") {
    if (forceAlias) ps.push(`npx vercel alias rm ${aliasDomain} --yes --scope ${scope} --token $env:VERCEL_TOKEN`);
    ps.push(`npx vercel alias set https://${deploymentUrl} ${aliasDomain} --scope ${scope} --token $env:VERCEL_TOKEN`);
  } else if (mode === "deployLinked") {
    ps.push(`npx vercel pull --yes --environment=production --scope ${scope} --token $env:VERCEL_TOKEN`);
    ps.push(`npx vercel --prod --yes --scope ${scope} --token $env:VERCEL_TOKEN`);
  } else {
    const linkParts = ["npx vercel link --yes"];
    if (project) linkParts.push(`--project ${project}`);
    linkParts.push(`--scope ${scope}`);
    linkParts.push("--token $env:VERCEL_TOKEN");
    ps.push(linkParts.join(" "));
    ps.push(`npx vercel --prod --yes --scope ${scope} --token $env:VERCEL_TOKEN`);
  }

  const resolvedSupabaseUrl = String((body?.supabaseUrl ?? last?.supabaseUrl) ?? "").trim();
  const resolvedAnonKey = String((body?.supabaseAnonKey ?? last?.supabaseAnonKey) ?? "").trim();
  const resolvedServiceRoleKey = String((body?.supabaseServiceRoleKey ?? last?.supabaseServiceRoleKey) ?? "").trim();

  runPowershellJob(job, ps.join("; "), {
    VERCEL_TOKEN: token,
    CMV_SUPABASE_URL: stripLineBreaks(resolvedSupabaseUrl || getLocalEnv("SUPABASE_URL") || getLocalEnv("NEXT_PUBLIC_SUPABASE_URL") || ""),
    CMV_SUPABASE_ANON_KEY: stripLineBreaks(resolvedAnonKey || getLocalEnv("SUPABASE_ANON_KEY") || getLocalEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY") || ""),
    CMV_SUPABASE_SERVICE_ROLE_KEY: stripLineBreaks(resolvedServiceRoleKey || getLocalEnv("SUPABASE_SERVICE_ROLE_KEY") || ""),
  });

  return json({ ok: true, jobId: id }, { status: 200 });
}
