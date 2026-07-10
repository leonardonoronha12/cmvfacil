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
  const emails = new Set(
    [...parseCsvEnv(process.env.ADMIN_USER_EMAILS), ...parseCsvEnv(process.env.ADMIN_EMAILS), ...parseCsvEnv(process.env.ADMIN_EMAILS_LEGACY)].map((x) => x.toLowerCase()),
  );
  if (!ids.size && !emails.size && !process.env.ADMIN_SECRET) return true;
  const raw = userId.toLowerCase();
  if (!isUuid(userId) && raw.includes("@") && process.env.ADMIN_SECRET) return true;
  if (ids.size && ids.has(raw)) return true;
  if (emails.size && emails.has(raw)) return true;
  return false;
}

const BUBBLE_GLOBAL_CONFIG_SQL = `create table if not exists public.bubble_global_config (
  id text primary key,
  base_url text null,
  api_token text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists bubble_global_config_set_updated_at on public.bubble_global_config;
create trigger bubble_global_config_set_updated_at
before update on public.bubble_global_config
for each row execute function public.set_updated_at();

alter table public.bubble_global_config enable row level security;
`;

export async function GET(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId) return json({ ok: false, error: "unauthorized" }, { status: 401 });

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
          tableMissing: Boolean((db as any)?.tableMissing),
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

    const body = (await req.json().catch(() => null)) as any;
    const baseUrl = typeof body?.baseUrl === "string" ? body.baseUrl : undefined;
    const token = typeof body?.token === "string" ? body.token : undefined;
    const clearToken = Boolean(body?.clearToken);
    const clearBaseUrl = Boolean(body?.clearBaseUrl);

    const saved = await upsertBubbleGlobalConfigToDb({ baseUrl, token, clearToken, clearBaseUrl });
    if (!saved.ok) {
      if (saved.error === "missing_bubble_global_config_table") {
        return json({ ok: false, error: saved.error, sql: BUBBLE_GLOBAL_CONFIG_SQL }, { status: 500 });
      }
      return json({ ok: false, error: saved.error }, { status: 500 });
    }

    return json({ ok: true }, { status: 200 });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
