import { NextRequest, NextResponse } from "next/server";
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

type Body = {
  token?: string;
  mode?: "deployLinked" | "linkAndDeploy" | "alias" | "setEnvAndDeploy";
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

  const supabaseUrl = String(body?.supabaseUrl ?? "").trim();
  const supabaseAnonKey = String(body?.supabaseAnonKey ?? "").trim();
  const supabaseServiceRoleKey = String(body?.supabaseServiceRoleKey ?? "").trim();

  if (mode === "setEnvAndDeploy") {
    if (!project) return json({ ok: false, error: "missing_project" }, { status: 400 });
    const resolvedSupabaseUrl = supabaseUrl || String(last?.supabaseUrl ?? "").trim();
    const resolvedAnonKey = supabaseAnonKey || String(last?.supabaseAnonKey ?? "").trim();
    const resolvedServiceRoleKey = supabaseServiceRoleKey || String(last?.supabaseServiceRoleKey ?? "").trim();
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
    const resolvedSupabaseUrl = String((body?.supabaseUrl ?? last?.supabaseUrl) ?? "").trim();
    const resolvedAnonKey = String((body?.supabaseAnonKey ?? last?.supabaseAnonKey) ?? "").trim();
    const resolvedServiceRoleKey = String((body?.supabaseServiceRoleKey ?? last?.supabaseServiceRoleKey) ?? "").trim();
    ps.push(`npx vercel link --yes --project ${project} --scope ${scope} --token $env:VERCEL_TOKEN`);
    ps.push(`Write-Output 'Setting SUPABASE_URL...'`);
    ps.push(
      `npx vercel env add SUPABASE_URL production --value "$env:CMV_SUPABASE_URL" --force --sensitive --scope ${scope} --token $env:VERCEL_TOKEN`,
    );
    ps.push(
      `npx vercel env add NEXT_PUBLIC_SUPABASE_URL production --value "$env:CMV_SUPABASE_URL" --force --sensitive --scope ${scope} --token $env:VERCEL_TOKEN`,
    );
    ps.push(
      `Write-Output 'Setting NEXT_PUBLIC_SUPABASE_ANON_KEY...'`,
    );
    ps.push(
      `npx vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production --value "$env:CMV_SUPABASE_ANON_KEY" --force --sensitive --scope ${scope} --token $env:VERCEL_TOKEN`,
    );
    if (resolvedServiceRoleKey) {
      ps.push(
        `Write-Output 'Setting SUPABASE_SERVICE_ROLE_KEY...'`,
      );
      ps.push(
        `npx vercel env add SUPABASE_SERVICE_ROLE_KEY production --value "$env:CMV_SUPABASE_SERVICE_ROLE_KEY" --force --sensitive --scope ${scope} --token $env:VERCEL_TOKEN`,
      );
    }
    ps.push(`Write-Output 'Deploying to production...'`);
    ps.push(`npx vercel --prod --yes --scope ${scope} --token $env:VERCEL_TOKEN`);
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
    CMV_SUPABASE_URL: stripLineBreaks(resolvedSupabaseUrl),
    CMV_SUPABASE_ANON_KEY: stripLineBreaks(resolvedAnonKey),
    CMV_SUPABASE_SERVICE_ROLE_KEY: stripLineBreaks(resolvedServiceRoleKey),
  });

  return json({ ok: true, jobId: id }, { status: 200 });
}
