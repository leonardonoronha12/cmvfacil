import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../../lib/requestUserId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return NextResponse.json(data, { ...init, headers });
}

function safeToken(input: string) {
  const t = String(input ?? "").trim();
  return t.toLowerCase().startsWith("bearer ") ? t.slice(7).trim() : t;
}

function safeBaseUrl(input: string) {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  const noTrail = raw.replace(/\/+$/, "");
  const stripped = noTrail.replace(/\/api\/1\.1\/obj$/i, "").replace(/\/api\/1\.1$/i, "");
  if (!/^https?:\/\//i.test(stripped)) return `https://${stripped}`;
  return stripped;
}

function extractAllBubbleIdsLoose(input: string) {
  const s = String(input ?? "").trim();
  if (!s) return [];
  const out: string[] = [];
  const re = /\d{8,}x\d{6,}/g;
  let m: RegExpExecArray | null = null;
  while ((m = re.exec(s))) {
    const v = String(m[0] ?? "").trim();
    if (v) out.push(v);
  }
  return out;
}

type BubbleConstraint = { key: string; constraint_type: string; value: unknown };

class BubbleApiError extends Error {
  bubbleStatus: number;
  bubbleBody: string;
  constructor(message: string, bubbleStatus: number, bubbleBody: string) {
    super(message);
    this.name = "BubbleApiError";
    this.bubbleStatus = bubbleStatus;
    this.bubbleBody = bubbleBody;
  }
}

async function fetchBubblePage(args: {
  baseUrl: string;
  token: string;
  typeName: string;
  cursor: number;
  limit: number;
  constraints?: BubbleConstraint[] | null;
  sortField?: string | null;
  descending?: boolean | null;
}) {
  const { baseUrl, token, typeName, cursor, limit, constraints, sortField, descending } = args;
  const qs = new URLSearchParams();
  qs.set("cursor", String(cursor));
  qs.set("limit", String(limit));
  if (sortField) qs.set("sort_field", String(sortField));
  if (typeof descending === "boolean") qs.set("descending", descending ? "true" : "false");
  if (constraints?.length) qs.set("constraints", JSON.stringify(constraints));
  const url = `${baseUrl}/api/1.1/obj/${encodeURIComponent(typeName)}?${qs.toString()}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  const text = await res.text();
  let jsonBody: any = null;
  try {
    jsonBody = JSON.parse(text);
  } catch {}
  if (!res.ok) {
    const rawText = String(text ?? "");
    const looksHtml = /<\s*(html|body|doctype)\b/i.test(rawText);
    const msgRaw = jsonBody?.body?.message || jsonBody?.message || rawText || `bubble_failed_${res.status}`;
    const msg = looksHtml ? `Bubble retornou HTML (status ${res.status}). Verifique URL base e token da Data API.` : String(msgRaw);
    throw new BubbleApiError(String(msg).slice(0, 400), res.status, rawText.slice(0, 2000));
  }
  const response = jsonBody?.response ?? jsonBody ?? {};
  const results = Array.isArray(response?.results) ? response.results : Array.isArray(response) ? response : [];
  const remaining = typeof response?.remaining === "number" ? response.remaining : null;
  return { results: results as unknown[], remaining };
}

async function fetchBubbleObjectById(baseUrl: string, token: string, typeName: string, id: string) {
  const url = `${baseUrl}/api/1.1/obj/${encodeURIComponent(typeName)}/${encodeURIComponent(id)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  const text = await res.text();
  let jsonBody: any = null;
  try {
    jsonBody = JSON.parse(text);
  } catch {}
  if (!res.ok) {
    const rawText = String(text ?? "");
    const msgRaw = jsonBody?.body?.message || jsonBody?.message || rawText || `bubble_failed_${res.status}`;
    throw new BubbleApiError(String(msgRaw).slice(0, 400), res.status, rawText.slice(0, 2000));
  }
  return jsonBody?.response ?? jsonBody ?? null;
}

async function getSupabaseEmailForUserId(supabase: ReturnType<typeof getSupabaseAdmin>, userId: string) {
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error) return null;
  const email = String((data as any)?.user?.email ?? "").trim().toLowerCase();
  return email || null;
}

function pickFirst(obj: any, keys: string[]) {
  for (const k of keys) {
    if (!k) continue;
    const v = obj && typeof obj === "object" ? (obj as any)[k] : undefined;
    const s = String(v ?? "").trim();
    if (s) return s;
  }
  return "";
}

function findNameFromObj(obj: any) {
  const direct = pickFirst(obj, ["nome_fantasia", "nome", "name", "razao_social", "titulo", "title"]);
  if (direct) return direct;
  if (!obj || typeof obj !== "object") return "";
  for (const [k, v] of Object.entries(obj)) {
    const kk = String(k ?? "").toLowerCase();
    if (!kk.includes("nome") && !kk.includes("name") && !kk.includes("razao")) continue;
    const s = String(v ?? "").trim();
    if (s && s.length <= 120) return s;
  }
  return "";
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId) return json({ ok: false, error: "unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => null)) as any;
    const baseUrl = safeBaseUrl(body?.baseUrl ?? "");
    const token = safeToken(body?.token ?? "");
    if (!baseUrl) return json({ ok: false, error: "missing_base_url" }, { status: 400 });
    if (!token) return json({ ok: false, error: "missing_token" }, { status: 400 });

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    const email = (await getSupabaseEmailForUserId(supabase, userId)) ?? "";
    if (!email) return json({ ok: false, error: "missing_supabase_email" }, { status: 400 });

    const userTypeCandidates = ["User", "user", "Usuario", "usuario", "usuarios"];
    let bubbleUser: any = null;
    let bubbleUserId = "";
    for (const t of userTypeCandidates) {
      try {
        const page = await fetchBubblePage({
          baseUrl,
          token,
          typeName: t,
          cursor: 0,
          limit: 1,
          constraints: [{ key: "email", constraint_type: "equals", value: email }],
        });
        const first = (page.results ?? [])[0] as any;
        if (!first) continue;
        bubbleUser = first;
        bubbleUserId = String(first?.unique_id ?? first?._id ?? first?.id ?? "").trim();
        if (bubbleUserId) break;
      } catch (err) {
        const st = err instanceof BubbleApiError ? err.bubbleStatus : null;
        if (st === 404 || st === 400) continue;
        throw err;
      }
    }

    if (!bubbleUserId) return json({ ok: false, error: "bubble_user_not_found_for_email" }, { status: 400 });

    const raw = bubbleUser && typeof bubbleUser === "object" ? bubbleUser : {};
    const fromUser = new Set<string>();
    for (const v of Object.values(raw)) for (const id of extractAllBubbleIdsLoose(String(v ?? ""))) fromUser.add(id);

    const notasTypeCandidates = ["notas_fiscais", "notas", "notasfiscais", "Notas Fiscais", "Notas_Fiscais"];
    const empresaFieldCandidates = ["empresa_id", "empresa", "restaurante_id", "restaurante", "company_id", "company"];
    const responsavelFieldCandidates = ["responsavel_id", "responsavel", "user_id", "usuario_id", "Created By"];
    const fromNotas = new Set<string>();

    let notasTypeUsed = "";
    for (const t of notasTypeCandidates) {
      try {
        const page = await fetchBubblePage({ baseUrl, token, typeName: t, cursor: 0, limit: 1 });
        if (Array.isArray(page.results)) {
          notasTypeUsed = t;
          break;
        }
      } catch (err) {
        const st = err instanceof BubbleApiError ? err.bubbleStatus : null;
        if (st === 404) continue;
        if (st === 400) continue;
        throw err;
      }
    }

    if (notasTypeUsed) {
      for (const userKey of responsavelFieldCandidates) {
        try {
          const page = await fetchBubblePage({
            baseUrl,
            token,
            typeName: notasTypeUsed,
            cursor: 0,
            limit: 200,
            sortField: "Modified Date",
            descending: true,
            constraints: [{ key: userKey, constraint_type: "equals", value: bubbleUserId }],
          });
          const list = (page.results ?? []) as any[];
          for (const n of list) {
            for (const key of empresaFieldCandidates) {
              const v = String((n as any)?.[key] ?? "").trim();
              for (const id of extractAllBubbleIdsLoose(v)) fromNotas.add(id);
            }
          }
          if (list.length) break;
        } catch (err) {
          const st = err instanceof BubbleApiError ? err.bubbleStatus : null;
          if (st === 400 || st === 404) continue;
          throw err;
        }
      }
    }

    const candidateIds = Array.from(new Set<string>([...fromNotas, ...fromUser])).slice(0, 50);

    const companyTypeCandidates = [
      "empresa",
      "empresas",
      "Empresa",
      "Empresas",
      "restaurante",
      "restaurantes",
      "Restaurante",
      "Restaurantes",
      "unidade",
      "unidades",
      "Unidade",
      "Unidades",
      "Company",
      "company",
    ];

    const out: Array<{ id: string; name: string; type: string }> = [];
    for (const id of candidateIds) {
      let name = "";
      let typeUsed = "";
      for (const t of companyTypeCandidates) {
        try {
          const obj = await fetchBubbleObjectById(baseUrl, token, t, id);
          if (!obj || typeof obj !== "object") continue;
          const guessed = findNameFromObj(obj);
          name = guessed || "";
          typeUsed = t;
          break;
        } catch (err) {
          const st = err instanceof BubbleApiError ? err.bubbleStatus : null;
          if (st === 404) continue;
          if (st === 400) continue;
          continue;
        }
      }
      out.push({ id, name: name || id, type: typeUsed });
    }

    const filtered = out
      .filter((c) => Boolean(c.id))
      .map((c) => ({ id: c.id, name: c.name, type: c.type }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base", numeric: true }));

    return json({ ok: true, bubbleUserId, email, notasType: notasTypeUsed || null, companies: filtered }, { status: 200 });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

