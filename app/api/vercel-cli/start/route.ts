import { NextRequest, NextResponse } from "next/server";
import { createJob, runPowershellJob } from "../_store";

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

type Body = {
  token?: string;
  mode?: "deployLinked" | "linkAndDeploy" | "alias";
  project?: string;
  scope?: string;
  deploymentUrl?: string;
  aliasDomain?: string;
  forceAlias?: boolean;
};

export async function POST(req: NextRequest) {
  if (!isEnabled(req)) return json({ ok: false, error: "disabled" }, { status: 403 });

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const token = String(body?.token ?? "").trim();
  if (!token) return json({ ok: false, error: "missing_token" }, { status: 400 });

  const mode = body?.mode === "alias" ? "alias" : body?.mode === "linkAndDeploy" ? "linkAndDeploy" : "deployLinked";
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

  const id = crypto.randomUUID();
  const job = createJob(id);

  const ps: string[] = [];
  ps.push("npx vercel --version");
  if (mode === "alias") {
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

  runPowershellJob(job, ps.join("; "), { VERCEL_TOKEN: token });

  return json({ ok: true, jobId: id }, { status: 200 });
}
