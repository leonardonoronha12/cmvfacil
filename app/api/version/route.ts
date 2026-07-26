import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return NextResponse.json(data, { ...init, headers });
}

export async function GET() {
  const sha = String(process.env.VERCEL_GIT_COMMIT_SHA ?? "").trim() || null;
  const ref = String(process.env.VERCEL_GIT_COMMIT_REF ?? "").trim() || null;
  const env = String(process.env.VERCEL_ENV ?? "").trim() || null;
  const url = String(process.env.VERCEL_URL ?? "").trim() || null;
  return json({ ok: true, sha, ref, env, url }, { status: 200 });
}

