import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "../../../lib/requestUserId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return NextResponse.json(data, { ...init, headers });
}

function getEnv(name: string) {
  const v = (process.env[name] ?? "").trim();
  return v || null;
}

function safeToken(input: string) {
  const t = String(input ?? "").trim();
  return t.toLowerCase().startsWith("bearer ") ? t.slice(7).trim() : t;
}

function safeBaseUrl(input: string) {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  const noTrail = raw.replace(/\/+$/, "");
  const stripped = noTrail
    .replace(/\/api\/1\.1\/obj$/i, "")
    .replace(/\/api\/1\.1$/i, "");
  if (!/^https?:\/\//i.test(stripped)) return `https://${stripped}`;
  return stripped;
}

function pickLabelFromBubbleObject(obj: any) {
  const candidateKeys = [
    "fornecedor",
    "fornecedor_nome",
    "nome_fornecedor",
    "empresa",
    "empresa_nome",
    "nome_fantasia",
    "nome",
    "razao_social",
    "title",
    "name",
  ];
  for (const k of candidateKeys) {
    const v = obj?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId) return json({ ok: false, error: "unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => null)) as any;
    const baseUrl = safeBaseUrl(body?.baseUrl ?? getEnv("BUBBLE_BASE_URL") ?? "");
    const token = safeToken(body?.token ?? getEnv("BUBBLE_API_TOKEN") ?? "");
    const type = String(body?.type ?? "fornecedores").trim() || "fornecedores";
    const ids = Array.isArray(body?.ids) ? (body.ids as any[]).map((x) => String(x ?? "").trim()).filter(Boolean) : [];
    const unique = Array.from(new Set(ids)).slice(0, 60);

    if (!baseUrl) return json({ ok: false, error: "missing_base_url" }, { status: 400 });
    if (!token) return json({ ok: false, error: "missing_token" }, { status: 400 });
    if (!unique.length) return json({ ok: true, type, map: {} }, { status: 200 });

    const map: Record<string, string> = {};
    for (const id of unique) {
      try {
        const url = `${baseUrl}/api/1.1/obj/${encodeURIComponent(type)}/${encodeURIComponent(id)}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        const text = await res.text();
        let j: any = null;
        try {
          j = JSON.parse(text);
        } catch {}
        if (!res.ok) continue;
        const response = j?.response ?? j ?? {};
        const label = pickLabelFromBubbleObject(response);
        if (label) map[id] = label;
      } catch {}
    }

    return json({ ok: true, type, map }, { status: 200 });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
