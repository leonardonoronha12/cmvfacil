import { readBubbleGlobalConfigFromDb, readBubbleGlobalConfigFromEnv } from "./bubbleGlobalConfig";

export type BubbleObjCredentials = {
  baseUrl: string;
  token: string;
};

export type BubbleObjPage<T = any> = {
  results: T[];
  remaining: number | null;
  cursor: number;
  limit: number;
};

type BubbleObjConstraint = {
  key: string;
  constraint_type: string;
  value: any;
};

function extractResults(body: any) {
  const response = body?.response ?? body ?? {};
  const results = Array.isArray(response?.results) ? response.results : Array.isArray(response) ? response : [];
  const remaining = typeof response?.remaining === "number" ? response.remaining : null;
  return { results, remaining };
}

function looksLikeHtml(text: string) {
  return /<\s*(html|body|doctype)\b/i.test(String(text ?? ""));
}

export async function getBubbleObjCredentials(): Promise<BubbleObjCredentials> {
  const env = readBubbleGlobalConfigFromEnv();
  const db = await readBubbleGlobalConfigFromDb();
  const active = (db.ok ? db.value : null) ?? env ?? null;
  if (!active?.baseUrl) throw new Error("missing_base_url");
  if (!active?.token) throw new Error("missing_token");
  return { baseUrl: active.baseUrl, token: active.token };
}

function buildBubbleObjUrl(input: { baseUrl: string; type: string; cursor: number; limit: number; constraints?: BubbleObjConstraint[] }) {
  const { baseUrl, type, cursor, limit, constraints } = input;
  const url = new URL(`${baseUrl.replace(/\/+$/, "")}/api/1.1/obj/${encodeURIComponent(type)}`);
  url.searchParams.set("cursor", String(cursor));
  url.searchParams.set("limit", String(limit));
  if (constraints && constraints.length) url.searchParams.set("constraints", JSON.stringify(constraints));
  return url.toString();
}

export async function fetchBubbleObjPage<T = any>(input: { creds: BubbleObjCredentials; type: string; cursor: number; limit: number }): Promise<BubbleObjPage<T>> {
  const { creds, type, cursor, limit } = input;
  const url = buildBubbleObjUrl({ baseUrl: creds.baseUrl, type, cursor, limit });
  const res = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${creds.token}` }, cache: "no-store" });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {}
  if (!res.ok) {
    const hint = res.status === 404 ? "type_not_found" : looksLikeHtml(text) ? "html_response" : "";
    const msg = String(parsed?.body?.message ?? parsed?.message ?? text).slice(0, 600);
    throw new Error(`bubble_${res.status}:${hint}:${msg}`);
  }
  const { results, remaining } = extractResults(parsed);
  return { results: results as T[], remaining, cursor, limit };
}

export async function fetchBubbleObjPageWithConstraints<T = any>(input: {
  creds: BubbleObjCredentials;
  type: string;
  cursor: number;
  limit: number;
  constraints: BubbleObjConstraint[];
  timeoutMs?: number;
}): Promise<BubbleObjPage<T>> {
  const { creds, type, cursor, limit, constraints } = input;
  const url = buildBubbleObjUrl({ baseUrl: creds.baseUrl, type, cursor, limit, constraints });
  const timeoutMs = typeof input.timeoutMs === "number" && Number.isFinite(input.timeoutMs) && input.timeoutMs > 0 ? Math.min(30_000, Math.floor(input.timeoutMs)) : 0;
  const controller = timeoutMs ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${creds.token}` },
      cache: "no-store",
      ...(controller ? { signal: controller.signal } : {}),
    });
  } catch (err) {
    if (timer) clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`bubble_timeout:request:${msg}`);
  }
  if (timer) clearTimeout(timer);
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {}
  if (!res.ok) {
    const hint = res.status === 404 ? "type_not_found" : looksLikeHtml(text) ? "html_response" : "";
    const msg = String(parsed?.body?.message ?? parsed?.message ?? text).slice(0, 600);
    throw new Error(`bubble_${res.status}:${hint}:${msg}`);
  }
  const { results, remaining } = extractResults(parsed);
  return { results: results as T[], remaining, cursor, limit };
}
