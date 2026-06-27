import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getUserIdFromRequest } from "../../../../lib/requestUserId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return NextResponse.json(data, { ...init, headers });
}

function safePreview(value: unknown, maxLen = 80) {
  const s = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s;
}

export async function GET(req: NextRequest) {
  const { userId } = getUserIdFromRequest(req);
  if (!userId) return json({ ok: false, error: "unauthorized" }, { status: 401 });

  const root = process.cwd();
  const file = path.join(root, ".bubble-debug.local.json");
  if (!fs.existsSync(file)) return json({ ok: false, error: "missing_file" }, { status: 404 });

  const raw = fs.readFileSync(file, "utf8");
  let parsed: any = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const payload = parsed?.paste ?? parsed;
  const payloadIsObject = payload && typeof payload === "object";
  if (!payloadIsObject) return json({ ok: false, error: "missing_payload" }, { status: 400 });

  const type = String(payload?.type ?? "").trim();
  const phase = String(payload?.phase ?? "").trim();
  const baseUrl = String(payload?.baseUrl ?? "").trim();
  const count = typeof payload?.count === "number" ? payload.count : null;
  const keys = Array.isArray(payload?.keys) ? payload.keys : null;
  const sample = payload?.sample && typeof payload.sample === "object" ? payload.sample : null;
  const summary = Array.isArray(payload?.summary) ? payload.summary : null;

  const summarySmall =
    summary && summary.length
      ? summary
          .slice(0, 60)
          .map((x: any) => ({
            type: String(x?.type ?? ""),
            status: String(x?.status ?? ""),
            fetched: typeof x?.fetched === "number" ? x.fetched : null,
            parts: typeof x?.parts === "number" ? x.parts : null,
            lastError: safePreview(x?.lastError ?? "", 120),
          }))
      : null;

  return json(
    {
      ok: true,
      detected: {
        kind: type ? "bubble-type-debug" : summary ? "sync-status" : "unknown",
        baseUrl: baseUrl || null,
        type: type || null,
        phase: phase || null,
        count,
      },
      keys: keys ? keys.slice(0, 80) : null,
      sample,
      summary: summarySmall,
    },
    { status: 200 },
  );
}
