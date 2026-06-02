import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "../../../lib/requestUserId";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return NextResponse.json(data, { ...init, headers });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function getEnv(name: string) {
  const v = (process.env[name] ?? "").trim();
  return v || null;
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId) return json({ ok: false, error: "unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => null)) as any;
    const confirm = String(body?.confirm ?? "").trim();
    if (confirm !== "RESET_AND_REIMPORT") return json({ ok: false, error: "missing_confirm" }, { status: 400 });

    const master = getEnv("IMPORT_MASTER_USER_ID");
    const isAdminSession = !isUuid(userId);
    if (!isAdminSession && master && master !== userId) return json({ ok: false, error: "forbidden" }, { status: 403 });

    const storageOwnerUserIdRaw = String(body?.storageOwnerUserId ?? "").trim();
    const storageOwnerUserId = isUuid(userId) ? userId : isUuid(storageOwnerUserIdRaw) ? storageOwnerUserIdRaw : "";
    if (!storageOwnerUserId) return json({ ok: false, error: "missing_storageOwnerUserId" }, { status: 400 });

    const bucket = "bubble-imports";
    const prefix = `user:${storageOwnerUserId}`;
    const only = Array.isArray(body?.only) ? (body.only as any[]).map((x) => String(x ?? "").trim()).filter(Boolean) : null;
    const includeUnknown = typeof body?.includeUnknown === "boolean" ? Boolean(body.includeUnknown) : true;

    const supabase = getSupabaseAdmin();

    const toDeleteByIdLike = [
      "insumos_state",
      "fornecedores_state",
      "pre_preparo_state",
      "pre_preparo_etiquetas_state",
      "fichas_tecnicas_state",
      "fichas_tecnicas_etiquetas_state",
      "insumos_templates_state",
      "inventario",
      "desperdicios",
      "entradas",
    ] as const;

    const deleted: Record<string, { ok: boolean; error?: string }> = {};
    for (const table of toDeleteByIdLike) {
      try {
        const { error } = await supabase.from(table).delete().like("id", "user:%");
        if (error) deleted[table] = { ok: false, error: error.message };
        else deleted[table] = { ok: true };
      } catch (err) {
        deleted[table] = { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    const importUrl = new URL("/api/bubble-import/import", req.url);
    const importRes = await fetch(importUrl, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: req.headers.get("cookie") ?? "" },
      body: JSON.stringify({ prefix, only, includeUnknown }),
      cache: "no-store",
    });
    const importJson = await importRes.json().catch(() => null);
    if (!importRes.ok || !importJson) return json({ ok: false, error: "import_failed", deleted, import: importJson }, { status: 500 });

    return json({ ok: true, deleted, import: importJson, ran: { prefix, bucket } }, { status: 200 });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
