import { NextResponse } from "next/server";
import { readBubbleGlobalConfigFromDb, readBubbleGlobalConfigFromEnv } from "../../../lib/bubbleGlobalConfig";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store, no-cache, must-revalidate, max-age=0");
  return NextResponse.json(data, { ...init, headers });
}

function looksLikeHtml(text: string) {
  const raw = String(text ?? "");
  return /<\s*(html|body|doctype)\b/i.test(raw);
}

export async function GET() {
  const env = readBubbleGlobalConfigFromEnv();
  const db = await readBubbleGlobalConfigFromDb();
  const dbValue = db.ok ? db.value : null;
  const active = dbValue ?? env ?? null;

  if (!active?.baseUrl) return json({ ok: false, error: "missing_base_url" }, { status: 400 });
  if (!active?.token) return json({ ok: false, error: "missing_token" }, { status: 400 });

  const baseUrl = active.baseUrl;
  const token = active.token;

  const typesToTry = ["User", "Users", "usuarios", "Usuario"];
  for (const typeName of typesToTry) {
    const url = `${baseUrl}/api/1.1/obj/${encodeURIComponent(typeName)}?cursor=0&limit=1`;
    try {
      const res = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const text = await res.text();
      let parsed: any = null;
      try {
        parsed = JSON.parse(text);
      } catch {}

      if (res.ok) {
        const response = parsed?.response ?? parsed ?? {};
        const count = Array.isArray(response?.results) ? response.results.length : Array.isArray(response) ? response.length : null;
        return json({ ok: true, baseUrl, typeTested: typeName, count }, { status: 200 });
      }

      const msgRaw = parsed?.body?.message || parsed?.message || text || `bubble_failed_${res.status}`;
      const hint = looksLikeHtml(text)
        ? "Recebido HTML. Isso normalmente indica host errado (ex.: deveria ser https://api.SEUDOMINIO) ou proteção/WAF."
        : "";
      if (res.status === 404) {
        return json(
          {
            ok: false,
            error: "bubble_404",
            baseUrl,
            typeTested: typeName,
            hint: hint || "Se o Bubble mostra 'Data API root URL' como https://api.seudominio.com/api/1.1/obj, então o BUBBLE_BASE_URL deve ser https://api.seudominio.com",
          },
          { status: 400 },
        );
      }
      return json(
        {
          ok: false,
          error: `bubble_${res.status}`,
          baseUrl,
          typeTested: typeName,
          message: String(msgRaw).slice(0, 400),
          hint,
        },
        { status: 400 },
      );
    } catch (err) {
      return json({ ok: false, error: "network_error", baseUrl, typeTested: typeName, message: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
  }

  return json({ ok: false, error: "no_type_worked", baseUrl }, { status: 400 });
}

