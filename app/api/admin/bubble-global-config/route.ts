import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "../../../lib/requestUserId";
import { readBubbleGlobalConfigFromDb, readBubbleGlobalConfigFromEnv, upsertBubbleGlobalConfigToDb } from "../../../lib/bubbleGlobalConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return NextResponse.json(data, { ...init, headers });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseCsvEnv(value: string | undefined) {
  return String(value ?? "")
    .split(/[,\n;]/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

function isAdminUserId(userId: string) {
  const ids = new Set(parseCsvEnv(process.env.ADMIN_USER_IDS).map((x) => x.toLowerCase()));
  const emails = new Set(parseCsvEnv(process.env.ADMIN_USER_EMAILS).map((x) => x.toLowerCase()));
  if (!ids.size && !emails.size && !process.env.ADMIN_SECRET) return true;
  const raw = userId.toLowerCase();
  if (!isUuid(userId) && raw.includes("@") && process.env.ADMIN_SECRET) return true;
  if (ids.size && ids.has(raw)) return true;
  if (emails.size && emails.has(raw)) return true;
  return false;
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId) return json({ ok: false, error: "unauthorized" }, { status: 401 });
    if (!isAdminUserId(userId)) return json({ ok: false, error: "forbidden" }, { status: 403 });

    const db = await readBubbleGlobalConfigFromDb();
    if (!db.ok) return json({ ok: false, error: db.error }, { status: 500 });
    const env = readBubbleGlobalConfigFromEnv();

    const active = db.value ?? env ?? null;
    const source = db.value ? "db" : env ? "env" : "none";

    return json(
      {
        ok: true,
        source,
        db: {
          baseUrl: db.value?.baseUrl ?? "",
          tokenPresent: Boolean(db.value?.token),
          updatedAt: db.value?.updatedAt ?? null,
        },
        env: {
          baseUrl: env?.baseUrl ?? "",
          tokenPresent: Boolean(env?.token),
        },
        active: {
          baseUrl: active?.baseUrl ?? "",
          tokenPresent: Boolean(active?.token),
        },
      },
      { status: 200 },
    );
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId) return json({ ok: false, error: "unauthorized" }, { status: 401 });
    if (!isAdminUserId(userId)) return json({ ok: false, error: "forbidden" }, { status: 403 });

    const body = (await req.json().catch(() => null)) as any;
    const baseUrl = typeof body?.baseUrl === "string" ? body.baseUrl : undefined;
    const token = typeof body?.token === "string" ? body.token : undefined;
    const clearToken = Boolean(body?.clearToken);
    const clearBaseUrl = Boolean(body?.clearBaseUrl);

    const saved = await upsertBubbleGlobalConfigToDb({ baseUrl, token, clearToken, clearBaseUrl });
    if (!saved.ok) return json({ ok: false, error: saved.error }, { status: 500 });

    return json({ ok: true }, { status: 200 });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
