import { NextRequest, NextResponse } from "next/server";
import { getLastSecrets } from "../_store";

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

const TTL_MS = 20 * 60 * 1000;

export async function GET(req: NextRequest) {
  if (!isEnabled(req)) return json({ ok: false, error: "disabled" }, { status: 403 });
  const s = getLastSecrets();
  const updatedAt = s?.updatedAt ?? null;
  const ttlRemainingMs = updatedAt ? Math.max(0, updatedAt + TTL_MS - Date.now()) : null;
  return json(
    {
      ok: true,
      hasToken: Boolean(s?.token),
      updatedAt,
      ttlRemainingSec: ttlRemainingMs != null ? Math.floor(ttlRemainingMs / 1000) : null,
      scope: s?.scope ?? null,
      project: s?.project ?? null,
    },
    { status: 200 },
  );
}

