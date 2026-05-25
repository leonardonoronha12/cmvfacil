import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../lib/requestUserId";

export const runtime = "nodejs";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return NextResponse.json(data, { ...init, headers });
}

function getUserScopedId(req: NextRequest) {
  const { accessToken, userId } = getUserIdFromRequest(req);
  if (!userId) return { accessToken, id: null as string | null };
  return { accessToken, id: `user:${userId}` };
}

type TemplateKind = "csv" | "xlsx";

type StoredTemplate = {
  name: string;
  mime: string;
  dataBase64: string;
};

function safeKind(v: string | null): TemplateKind | null {
  if (v === "csv" || v === "xlsx") return v;
  return null;
}

function safeTemplate(input: unknown): StoredTemplate | null {
  if (!input || typeof input !== "object") return null;
  const r = input as Record<string, unknown>;
  const name = String(r.name ?? "").trim();
  const mime = String(r.mime ?? "").trim();
  const dataBase64 = String(r.dataBase64 ?? "").trim();
  if (!name || !mime || !dataBase64) return null;
  return { name, mime, dataBase64 };
}

async function loadPayload(req: NextRequest) {
  const { accessToken, id } = getUserScopedId(req);
  if (!id) return { accessToken, id, payload: {} as Record<string, unknown>, updatedAt: null as string | null };
  const supabase = getSupabaseServerClient(accessToken);
  const { data, error } = await supabase.from("insumos_templates_state").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  const payload = ((data as any)?.payload ?? {}) as Record<string, unknown>;
  const updatedAt = (data as any)?.updated_at ? String((data as any).updated_at) : null;
  return { accessToken, id, payload, updatedAt };
}

function toBinaryResponse(kind: TemplateKind, file: StoredTemplate) {
  const bytes = Buffer.from(file.dataBase64, "base64");
  const headers = new Headers();
  headers.set("content-type", file.mime);
  headers.set("content-disposition", `attachment; filename="${file.name.replaceAll('"', "")}"`);
  headers.set("x-template-kind", kind);
  headers.set("x-template-filename", file.name);
  return new NextResponse(bytes, { status: 200, headers });
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const kind = safeKind(url.searchParams.get("kind"));
    const download = url.searchParams.get("download") === "1";

    const { id, payload, updatedAt } = await loadPayload(req);
    if (!id) return json({ csv: null, xlsx: null }, { status: 200 });

    if (kind && download) {
      const file = safeTemplate(payload[kind]);
      if (!file) return json({ error: "not_found" }, { status: 404 });
      return toBinaryResponse(kind, file);
    }

    const csv = safeTemplate(payload.csv);
    const xlsx = safeTemplate(payload.xlsx);
    return json({ csv, xlsx, updatedAt }, { status: 200 });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as unknown;
    if (!body || typeof body !== "object") return json({ error: "invalid_body" }, { status: 400 });
    const kind = safeKind(String((body as any).kind ?? "").trim());
    if (!kind) return json({ error: "invalid_kind" }, { status: 400 });
    const file = safeTemplate((body as any).file);
    if (!file) return json({ error: "invalid_file" }, { status: 400 });
    if (file.dataBase64.length > 6_000_000) return json({ error: "file_too_large" }, { status: 413 });

    const { accessToken, id, payload } = await loadPayload(req);
    if (!id) return json({ error: "unauthorized" }, { status: 401 });

    const nextPayload = { ...(payload ?? {}), [kind]: file };
    const supabase = getSupabaseServerClient(accessToken);
    const { error } = await supabase.from("insumos_templates_state").upsert({ id, payload: nextPayload } as any, { onConflict: "id" });
    if (error) return json({ error: error.message }, { status: 500 });
    return json({ ok: true }, { status: 200 });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const kind = safeKind(url.searchParams.get("kind"));
    if (!kind) return json({ error: "invalid_kind" }, { status: 400 });

    const { accessToken, id, payload } = await loadPayload(req);
    if (!id) return json({ error: "unauthorized" }, { status: 401 });

    const nextPayload = { ...(payload ?? {}) };
    delete (nextPayload as any)[kind];

    const supabase = getSupabaseServerClient(accessToken);
    const { error } = await supabase.from("insumos_templates_state").upsert({ id, payload: nextPayload } as any, { onConflict: "id" });
    if (error) return json({ error: error.message }, { status: 500 });
    return json({ ok: true }, { status: 200 });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

