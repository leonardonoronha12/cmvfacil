import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "../../../../lib/requestUserId";
import { readBubbleGlobalConfigFromDb, readBubbleGlobalConfigFromEnv } from "../../../../lib/bubbleGlobalConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return NextResponse.json(data, { ...init, headers });
}

function pickAny(obj: any, keys: string[]) {
  if (!obj || typeof obj !== "object") return "";
  for (const k of keys) {
    const v = obj[k];
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return "";
}

function safePreview(value: unknown, maxLen = 80) {
  const s = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s;
}

function extractResults(body: any) {
  const response = body?.response ?? body ?? {};
  const results = Array.isArray(response?.results) ? response.results : Array.isArray(response) ? response : [];
  const remaining = typeof response?.remaining === "number" ? response.remaining : null;
  return { results, remaining };
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId) return json({ ok: false, error: "unauthorized" }, { status: 401 });

    const typeName = String(new URL(req.url).searchParams.get("type") ?? "").trim();
    if (!typeName) return json({ ok: false, error: "missing_type" }, { status: 400 });

    const env = readBubbleGlobalConfigFromEnv();
    const db = await readBubbleGlobalConfigFromDb();
    const active = (db.ok ? db.value : null) ?? env ?? null;
    if (!active?.baseUrl) return json({ ok: false, error: "missing_base_url" }, { status: 400 });
    if (!active?.token) return json({ ok: false, error: "missing_token" }, { status: 400 });

    const url = `${active.baseUrl}/api/1.1/obj/${encodeURIComponent(typeName)}?cursor=0&limit=5`;
    const res = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${active.token}` }, cache: "no-store" });
    const text = await res.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {}

    const isHtml = /<\s*(html|body|doctype)\b/i.test(text);
    if (!res.ok) {
      return json(
        {
          ok: false,
          error: `bubble_${res.status}`,
          baseUrl: active.baseUrl,
          type: typeName,
          hint: isHtml ? "Recebido HTML. Isso indica host/roteamento errado ou WAF/proteção." : "",
          message: safePreview(parsed?.body?.message || parsed?.message || text, 400),
        },
        { status: 400 },
      );
    }

    const { results, remaining } = extractResults(parsed);
    const first = results[0] && typeof results[0] === "object" ? results[0] : null;
    const keys = first ? Object.keys(first).slice(0, 60) : [];

    const sample = first
      ? {
          unique_id: safePreview((first as any)?.unique_id || (first as any)?._id || (first as any)?.id || (first as any)?.bubble_id, 32),
          nome: safePreview(pickAny(first, ["nome", "name", "titulo", "title", "item", "produto", "receita", "descricao"]), 80),
          tipo: safePreview(pickAny(first, ["tipo", "tipo_item", "tipo_de_item", "type"]), 80),
          categoria: safePreview(pickAny(first, ["categoria", "categoria_id", "categoria_slug", "category"]), 80),
        }
      : null;

    return json({ ok: true, baseUrl: active.baseUrl, type: typeName, count: results.length, remaining, keys, sample }, { status: 200 });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

