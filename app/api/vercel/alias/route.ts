import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "../../../lib/requestUserId";
import { readFileSync } from "fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return NextResponse.json(data, { ...init, headers });
}

function safeSlug(input: unknown) {
  const s = String(input ?? "").trim();
  if (!s) return "";
  if (!/^[a-z0-9][a-z0-9-_]{0,120}$/i.test(s)) return "";
  return s;
}

function safeHost(input: unknown) {
  const s = String(input ?? "").trim().toLowerCase().replace(/^https?:\/\//i, "").replace(/\/+$/g, "");
  if (!s) return "";
  if (s.includes("..")) return "";
  if (!/^[a-z0-9][a-z0-9.-]{0,250}[a-z0-9]$/i.test(s)) return "";
  return s;
}

function isLocalhost(req: NextRequest) {
  if (process.env.NODE_ENV === "production") return false;
  const hostHeader = String(req.headers.get("host") ?? "").toLowerCase();
  const hostUrl = String(req.nextUrl?.host ?? "").toLowerCase();
  const host = hostHeader || hostUrl;
  if (!host) return false;
  if (!host.includes("localhost") && !host.includes("127.0.0.1")) return false;
  return true;
}

function readTokenFromLocalFile() {
  try {
    const raw = readFileSync(".vercel-token.local", "utf8");
    const token = String(raw ?? "")
      .replace(/[\r\n]+/g, "\n")
      .split("\n")[0]
      ?.trim();
    if (!token) return "";
    if (token === "PASTE_VERCEL_TOKEN_HERE") return "";
    return token;
  } catch {
    return "";
  }
}

async function vercelFetch(token: string, url: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (!headers.get("content-type") && init.body) headers.set("content-type", "application/json");
  return fetch(url, { ...init, headers, cache: "no-store" });
}

type Body = {
  token?: string;
  teamSlug?: string;
  project?: string;
  aliasDomain?: string;
  deploymentUrl?: string;
  sha?: string;
};

export async function POST(req: NextRequest) {
  const { userId } = getUserIdFromRequest(req);
  const allowUnauthed = process.env.NODE_ENV !== "production";
  if (!allowUnauthed) {
    if (!userId) return json({ ok: false, error: "unauthorized" }, { status: 401 });
    if (!String(userId).includes("@")) return json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const tokenBody = String(body?.token ?? "").trim();
  const tokenEnv = String(process.env.VERCEL_TOKEN ?? "").trim();
  const tokenFile = allowUnauthed ? readTokenFromLocalFile() : "";
  const token = tokenBody || tokenEnv || tokenFile;
  if (!token) return json({ ok: false, error: "missing_token" }, { status: 400 });

  const teamSlug = safeSlug(body?.teamSlug) || safeSlug(process.env.VERCEL_TEAM_SLUG) || "leonardonoronha12-2214s-projects";
  const project = safeSlug(body?.project) || safeSlug(process.env.VERCEL_PROJECT) || "cmvfacil_repo";
  const aliasDomain = safeHost(body?.aliasDomain) || "cmvfacil.vercel.app";
  const deploymentUrl = safeHost(body?.deploymentUrl);
  const sha = String(body?.sha ?? "").trim();

  try {
    let targetDeploymentIdOrUrl = deploymentUrl;
    let chosen: any = null;

    if (!targetDeploymentIdOrUrl) {
      const projRes = await vercelFetch(
        token,
        `https://api.vercel.com/v9/projects/${encodeURIComponent(project)}?slug=${encodeURIComponent(teamSlug)}`,
        { method: "GET" },
      );
      const projJson = (await projRes.json().catch(() => null)) as any;
      if (!projRes.ok) {
        return json({ ok: false, error: "vercel_project_lookup_failed", status: projRes.status, details: projJson }, { status: 400 });
      }
      const projectId = String(projJson?.id ?? "").trim();
      if (!projectId) return json({ ok: false, error: "missing_project_id" }, { status: 400 });

      const qs = new URLSearchParams();
      qs.set("projectId", projectId);
      qs.set("target", "production");
      qs.set("state", "READY");
      qs.set("limit", "20");
      qs.set("slug", teamSlug);
      if (sha) qs.set("sha", sha);

      const depRes = await vercelFetch(token, `https://api.vercel.com/v7/deployments?${qs.toString()}`, { method: "GET" });
      const depJson = (await depRes.json().catch(() => null)) as any;
      if (!depRes.ok) {
        return json({ ok: false, error: "vercel_deployments_list_failed", status: depRes.status, details: depJson }, { status: 400 });
      }
      const list = Array.isArray(depJson?.deployments) ? (depJson.deployments as any[]) : [];
      chosen = list[0] ?? null;
      const uid = String(chosen?.uid ?? chosen?.id ?? "").trim();
      const url = safeHost(chosen?.url);
      targetDeploymentIdOrUrl = uid || url;
      if (!targetDeploymentIdOrUrl) return json({ ok: false, error: "no_ready_deployment_found" }, { status: 400 });
    }

    const aliasRes = await vercelFetch(
      token,
      `https://api.vercel.com/v2/deployments/${encodeURIComponent(targetDeploymentIdOrUrl)}/aliases?slug=${encodeURIComponent(teamSlug)}`,
      { method: "POST", body: JSON.stringify({ alias: aliasDomain, redirect: null }) },
    );
    const aliasJson = (await aliasRes.json().catch(() => null)) as any;
    if (!aliasRes.ok) {
      return json({ ok: false, error: "vercel_alias_failed", status: aliasRes.status, details: aliasJson }, { status: 400 });
    }

    return json({
      ok: true,
      alias: aliasJson?.alias ?? aliasDomain,
      deploymentId: aliasJson?.oldDeploymentId ? targetDeploymentIdOrUrl : targetDeploymentIdOrUrl,
      oldDeploymentId: aliasJson?.oldDeploymentId ?? null,
      used: {
        teamSlug,
        project,
        aliasDomain,
        deploymentUrl: deploymentUrl || null,
        sha: sha || null,
        chosen: chosen
          ? {
              uid: String(chosen?.uid ?? chosen?.id ?? "").trim() || null,
              url: safeHost(chosen?.url) || null,
              created: typeof chosen?.created === "number" ? chosen.created : null,
              target: String(chosen?.target ?? "").trim() || null,
            }
          : null,
      },
    });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
