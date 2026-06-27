import { NextResponse } from "next/server";
import { readBubbleGlobalConfigFromDb, readBubbleGlobalConfigFromEnv } from "../../../lib/bubbleGlobalConfig";

export const dynamic = "force-dynamic";

export async function GET() {
  const headers = new Headers();
  headers.set("cache-control", "no-store, no-cache, must-revalidate, max-age=0");

  const env = readBubbleGlobalConfigFromEnv();
  const db = await readBubbleGlobalConfigFromDb();
  const dbValue = db.ok ? db.value : null;
  const active = dbValue ?? env ?? null;

  return NextResponse.json(
    {
      ok: true,
      source: dbValue ? "db" : env ? "env" : "none",
      db: db.ok
        ? { resolved: Boolean(dbValue?.baseUrl && dbValue?.token), baseUrlResolved: Boolean(dbValue?.baseUrl), tokenResolved: Boolean(dbValue?.token) }
        : { resolved: false, error: db.error },
      env: { resolved: Boolean(env?.baseUrl && env?.token), baseUrlResolved: Boolean(env?.baseUrl), tokenResolved: Boolean(env?.token) },
      active: { resolved: Boolean(active?.baseUrl && active?.token), baseUrlResolved: Boolean(active?.baseUrl), tokenResolved: Boolean(active?.token) },
    },
    { status: 200, headers },
  );
}
