import { NextRequest, NextResponse } from "next/server";
import { setLastSecrets } from "../_store";

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

export async function POST(req: NextRequest) {
  if (!isEnabled(req)) return json({ ok: false, error: "disabled" }, { status: 403 });

  let body: { token?: string; scope?: string; project?: string } = {};
  try {
    body = (await req.json()) as { token?: string; scope?: string; project?: string };
  } catch {
    return json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const token = String(body?.token ?? "").trim();
  if (!token) return json({ ok: false, error: "missing_token" }, { status: 400 });

  const scope = String(body?.scope ?? "").trim();
  const project = String(body?.project ?? "").trim();

  setLastSecrets({
    token,
    ...(scope ? { scope } : {}),
    ...(project ? { project } : {}),
  });

  return json({ ok: true }, { status: 200 });
}

