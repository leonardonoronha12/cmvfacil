import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "../../../../lib/requestUserId";
import { getSupabaseAdmin } from "../../../../lib/supabaseAdmin";
import { isLocalDevRequest } from "../../../../lib/localDevRequest";
import { fetchBubbleObjPageWithConstraints, getBubbleObjCredentials, type BubbleObjCredentials } from "../../../../lib/bubbleObjApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
  const raw = userId.toLowerCase();
  if (!isUuid(userId) && raw.includes("@") && process.env.ADMIN_SECRET) return true;
  if (ids.size && ids.has(raw)) return true;
  if (emails.size && emails.has(raw)) return true;
  return false;
}

function safeEmail(input: unknown) {
  const v = String(input ?? "").trim().toLowerCase();
  if (!v || !v.includes("@")) return "";
  return v;
}

async function findAuthUserIdByEmail(supabase: ReturnType<typeof getSupabaseAdmin>, email: string) {
  const target = email.trim().toLowerCase();
  for (let page = 1; page <= 2000; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`auth_list_users:${error.message}`);
    const users = (data?.users ?? []) as any[];
    for (const u of users) {
      const id = String(u?.id ?? "").trim();
      const em = String(u?.email ?? "").trim().toLowerCase();
      if (id && em === target) return id;
    }
    if (users.length < 1000) break;
  }
  return null;
}

async function getUserEmailFromDb(supabase: ReturnType<typeof getSupabaseAdmin>, userId: string) {
  if (!isUuid(userId)) return null;
  const { data, error } = await supabase.from("user_profiles").select("email").eq("user_id", userId).maybeSingle();
  if (error) return null;
  const email = String((data as any)?.email ?? "").trim().toLowerCase();
  return email && email.includes("@") ? email : null;
}

async function isAdminRequester(supabase: ReturnType<typeof getSupabaseAdmin>, requesterUserId: string) {
  if (isAdminUserId(requesterUserId)) return true;
  const requesterEmail = await getUserEmailFromDb(supabase, requesterUserId);
  if (!requesterEmail) return false;
  const allow = new Set(
    [...parseCsvEnv(process.env.ADMIN_USER_EMAILS), ...parseCsvEnv(process.env.ADMIN_EMAILS), ...parseCsvEnv(process.env.ADMIN_EMAILS_LEGACY)].map((x) => x.toLowerCase()),
  );
  return allow.has(requesterEmail);
}

function normalizeSpace(s: string) {
  return String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normKey(s: string) {
  return normalizeSpace(s).toLowerCase();
}

function parseMoneyToNumber(value: string) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const cleaned = raw
    .replace(/\s/g, "")
    .replace(/^R\$\s*/i, "")
    .replace(/[^\d,.-]/g, "");
  if (!cleaned) return null;

  const comma = cleaned.lastIndexOf(",");
  const dot = cleaned.lastIndexOf(".");
  let normalized = cleaned;

  if (comma >= 0 && dot >= 0) {
    if (comma > dot) normalized = cleaned.replace(/\./g, "").replace(",", ".");
    else normalized = cleaned.replace(/,/g, "");
  } else if (comma >= 0) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    normalized = cleaned.replace(/,/g, "");
  }

  const num = Number(normalized);
  if (!Number.isFinite(num)) return null;
  return num;
}

function isMissingTableError(err: any) {
  const msg = String(err?.message ?? "").toLowerCase();
  const code = String(err?.code ?? "").toLowerCase();
  if (code === "42p01") return true;
  if (msg.includes("does not exist")) return true;
  if (msg.includes("relation") && msg.includes("does not exist")) return true;
  return false;
}

function stripDiacriticsLower(s: string) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function parsePtNumber(input: string) {
  const s = String(input ?? "").replace(/[^\d,.-]/g, "").trim();
  if (!s) return 0;
  const neg = s.includes("-");
  const cleaned = s.replace(/-/g, "");
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  const normalized = (() => {
    if (lastComma < 0 && lastDot < 0) return cleaned.replace(/[^\d]/g, "");
    if (lastComma > lastDot) {
      const intPart = cleaned.slice(0, lastComma).replace(/[^\d]/g, "");
      const frac = cleaned.slice(lastComma + 1).replace(/[^\d]/g, "");
      return `${intPart}.${frac}`;
    }
    const intPart = cleaned.slice(0, lastDot).replace(/[^\d]/g, "");
    const frac = cleaned.slice(lastDot + 1).replace(/[^\d]/g, "");
    return `${intPart}.${frac}`;
  })();
  const n = Number.parseFloat(normalized);
  if (!Number.isFinite(n)) return 0;
  return neg ? -n : n;
}

function extractBubbleIdFromObj(obj: any) {
  const candidates = [obj?.unique_id, obj?._id, obj?.id, obj?.bubble_id];
  for (const c of candidates) {
    const v = String(c ?? "").trim();
    if (v) return v;
  }
  return "";
}

function extractRefId(input: unknown) {
  if (!input) return "";
  if (typeof input === "string") {
    const s = input.trim();
    const m1 = /\/?([0-9]{10,}x[0-9]{10,})\b/.exec(s);
    if (m1?.[1]) return m1[1];
    const m2 = /\b([0-9]{8,}x[0-9]{8,})\b/.exec(s);
    if (m2?.[1]) return m2[1];
    return "";
  }
  if (typeof input === "object") {
    const o = input as any;
    return String(o?.unique_id ?? o?._id ?? o?.id ?? o?.bubble_id ?? "").trim();
  }
  return "";
}

function getFieldLoose(obj: any, keys: string[]) {
  if (!obj || typeof obj !== "object") return "";
  for (const k of keys) {
    const v = obj[k];
    if (v == null) continue;
    if (typeof v === "string") {
      const s = v.trim();
      if (s) return s;
      continue;
    }
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "boolean") return v;
    if (Array.isArray(v) && v.length) return v;
    if (typeof v === "object") return v;
  }
  return "";
}

async function fetchBubbleObjById(creds: BubbleObjCredentials, type: string, id: string) {
  const baseUrl = String(creds.baseUrl ?? "").replace(/\/+$/, "");
  const url = `${baseUrl}/api/1.1/obj/${encodeURIComponent(type)}/${encodeURIComponent(id)}`;
  const res = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${creds.token}` }, cache: "no-store" });
  const text = await res.text().catch(() => "");
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {}
  if (!res.ok) throw new Error(`bubble_${res.status}:${String(text).slice(0, 500)}`);
  return (parsed?.response ?? parsed ?? {}) as any;
}

function formatBrl(v: number | null) {
  if (v == null || !Number.isFinite(v)) return "";
  const s = v.toFixed(2).replace(".", ",");
  return `R$${s}`;
}

function buildManualSlug(value: string) {
  return normKey(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

type InsumoDraftRow = {
  rowId: string;
  bubbleId?: string;
  item: string;
  medida: string;
  custoMedio: string;
  categoria: string;
  especificacao: string;
  ocultar: boolean;
};

type FichaTecnicaDraftRow = {
  rowId: string;
  receita: string;
  precoVenda: string;
  custoUnitario: string;
  cmvMeta: string;
  cmvAtual: string;
  bcg: string;
  invalid?: boolean;
};

export async function POST(req: NextRequest) {
  try {
    const isLocalDev = isLocalDevRequest(req);
    const { userId } = getUserIdFromRequest(req);
    if (!userId && !isLocalDev) return json({ ok: false, error: "unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => null)) as any;
    const module = String(body?.module ?? "").trim().toLowerCase();
    const email = safeEmail(body?.email);
    const companyId = String(body?.companyId ?? "").trim();
    const rows = Array.isArray(body?.rows) ? (body.rows as any[]) : null;

    if (!email) return json({ ok: false, error: "invalid_email" }, { status: 400 });
    if (!companyId) return json({ ok: false, error: "missing_company_id" }, { status: 400 });
    if (module !== "insumos" && module !== "fichas-tecnicas") return json({ ok: false, error: "module_not_supported_yet" }, { status: 400 });
    if (!rows) return json({ ok: false, error: "missing_rows" }, { status: 400 });

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    const requesterId = String(userId ?? "").trim();
    const requesterEmail = await getUserEmailFromDb(supabase, requesterId);
    const selfOk = isUuid(requesterId) && requesterEmail === email;
    const adminOk = isLocalDev ? true : await isAdminRequester(supabase, requesterId);
    if (!selfOk && !adminOk) return json({ ok: false, error: "forbidden" }, { status: 403 });

    const targetUserId = selfOk ? requesterId : await findAuthUserIdByEmail(supabase, email);
    if (!targetUserId) return json({ ok: false, error: "user_not_found" }, { status: 404 });

    const { data: memberRows, error: memberErr } = await supabase.from("company_members").select("company_id").eq("user_id", targetUserId).eq("company_id", companyId).limit(1);
    if (memberErr) return json({ ok: false, error: memberErr.message }, { status: 500 });
    if (!(memberRows ?? [])[0] && !adminOk) return json({ ok: false, error: "company_not_linked_to_user" }, { status: 400 });

    if (module === "fichas-tecnicas") {
      let created = 0;
      let updated = 0;
      let ignored = 0;
      const errors: Array<{ rowId: string; message: string }> = [];

      const desiredCategoryName = "Receitas";
      const { data: categoriesDb, error: catErr } = await supabase.from("categories").select("id,name").eq("company_id", companyId).limit(50_000);
      if (catErr) return json({ ok: false, error: catErr.message }, { status: 500 });

      let categoryId = "";
      for (const c of categoriesDb ?? []) {
        const id = String((c as any)?.id ?? "").trim();
        const name = normalizeSpace(String((c as any)?.name ?? "")).toLowerCase();
        if (!id || !name) continue;
        if (name === desiredCategoryName.toLowerCase()) {
          categoryId = id;
          break;
        }
      }
      if (!categoryId) {
        const { data: ins, error: insErr } = await supabase
          .from("categories")
          .insert({ company_id: companyId, name: desiredCategoryName } as any)
          .select("id")
          .maybeSingle();
        if (insErr) return json({ ok: false, error: insErr.message }, { status: 500 });
        categoryId = String((ins as any)?.id ?? "").trim();
      }
      if (!categoryId) return json({ ok: false, error: "missing_category_id" }, { status: 500 });

      const { data: recipesDb, error: recipesErr } = await supabase
        .from("items")
        .select("id,name")
        .eq("company_id", companyId)
        .eq("item_receita", true)
        .eq("item_do_cardapio", true)
        .limit(50_000);
      if (recipesErr) return json({ ok: false, error: recipesErr.message }, { status: 500 });

      const byNameKey = new Map<string, { id: string; name: string }>();
      for (const it of recipesDb ?? []) {
        const id = String((it as any)?.id ?? "").trim();
        const name = normalizeSpace(String((it as any)?.name ?? ""));
        if (!id || !name) continue;
        byNameKey.set(normKey(name), { id, name });
      }

      const normalizeQuadrante = (v: string) => {
        const k = normalizeSpace(String(v ?? "")).toUpperCase();
        if (!k) return "";
        if (k.includes("ESTRELA")) return "ESTRELA";
        if (k.includes("CAVALO")) return "CAVALO";
        if (k.includes("QUEBRA")) return "QUEBRA_CABECA";
        if (k.includes("ABACAXI")) return "ABACAXI";
        return "";
      };

      const mapQuadranteToLegacyBcg = (v: string) => {
        const k = normalizeSpace(String(v ?? "")).toUpperCase();
        if (k.includes("ESTRELA")) return "estrela";
        if (k.includes("CAVALO")) return "cavalo";
        if (k.includes("QUEBRA")) return "quebra-cabeca";
        if (k.includes("ABACAXI")) return "abacaxi";
        return "quebra-cabeca";
      };

      const makeLegacyId = (receita: string) => {
        const slug = normKey(receita)
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 80);
        return `manual:${slug || "ficha"}`;
      };

      const { data: companyDb, error: companyErr } = await supabase.from("companies").select("bubble_id").eq("id", companyId).maybeSingle();
      if (companyErr) errors.push({ rowId: "company", message: companyErr.message });
      const companyBubbleId = normalizeSpace(String((companyDb as any)?.bubble_id ?? ""));

      let bubbleCreds: BubbleObjCredentials | null = null;
      try {
        bubbleCreds = await getBubbleObjCredentials();
      } catch {
        bubbleCreds = null;
      }

      const findBubbleRecipeItemId = async (recipeName: string) => {
        if (!bubbleCreds) return "";
        const name = normalizeSpace(String(recipeName ?? ""));
        if (!name) return "";
        const type = "itens";
        const companyKeys = ["empresa_id", "company_id", "restaurante_id", "restaurant_id", "account_id"];
        const nameKeys = ["nome", "name", "titulo", "title"];
        const flagKeys = [
          { key: "boolean_item_receita", value: true },
          { key: "boolean_item_do_cardapio", value: true },
        ];

        const tryConstraints = async (constraints: any[]) => {
          try {
            const page = await fetchBubbleObjPageWithConstraints<any>({ creds: bubbleCreds as BubbleObjCredentials, type, cursor: 0, limit: 10, constraints, timeoutMs: 12_000 });
            const results = Array.isArray(page?.results) ? page.results : [];
            for (const r of results) {
              const gotName = normalizeSpace(String((r as any)?.nome ?? (r as any)?.name ?? (r as any)?.titulo ?? (r as any)?.title ?? ""));
              if (gotName && normKey(gotName) === normKey(name)) {
                const id = extractBubbleIdFromObj(r);
                if (id) return id;
              }
            }
            return extractBubbleIdFromObj(results[0] ?? {}) || "";
          } catch {
            return "";
          }
        };

        if (companyBubbleId) {
          for (const cKey of companyKeys) {
            for (const nKey of nameKeys) {
              const id = await tryConstraints([
                { key: cKey, constraint_type: "equals", value: companyBubbleId },
                { key: nKey, constraint_type: "equals", value: name },
                ...flagKeys.map((x) => ({ key: x.key, constraint_type: "equals", value: x.value })),
              ]);
              if (id) return id;
            }
          }
        }
        for (const nKey of nameKeys) {
          const id = await tryConstraints([{ key: nKey, constraint_type: "equals", value: name }, ...flagKeys.map((x) => ({ key: x.key, constraint_type: "equals", value: x.value }))]);
          if (id) return id;
        }
        for (const nKey of nameKeys) {
          const id = await tryConstraints([{ key: nKey, constraint_type: "equals", value: name }]);
          if (id) return id;
        }
        return "";
      };

      const ensureCategory = async (name: string) => {
        const key = normKey(name);
        const { data, error } = await supabase.from("categories").select("id,name").eq("company_id", companyId).limit(50_000);
        if (error) return "";
        for (const c of data ?? []) {
          const cid = String((c as any)?.id ?? "").trim();
          const cn = normalizeSpace(String((c as any)?.name ?? ""));
          if (cid && normKey(cn) === key) return cid;
        }
        const { data: ins, error: insErr } = await supabase.from("categories").insert({ company_id: companyId, name } as any).select("id").maybeSingle();
        if (insErr) return "";
        return String((ins as any)?.id ?? "").trim();
      };

      const insumoCategoryId = await ensureCategory("Sem categoria");

      const upsertIngredientItem = async (bubbleItemId: string, itemObj: any) => {
        const b = normalizeSpace(String(bubbleItemId ?? ""));
        if (!b) return null;
        const { data: existing } = await supabase.from("items").select("id,name,bubble_id").eq("company_id", companyId).eq("bubble_id", b).maybeSingle();
        const name = normalizeSpace(String(getFieldLoose(itemObj, ["nome", "name", "item"]) ?? "")) || b;
        const unidade = normalizeSpace(String(getFieldLoose(itemObj, ["unidade_medida", "unidade", "medida", "unit"]) ?? "")) || "Und";
        const custoMedio = (() => {
          const raw = getFieldLoose(itemObj, ["custo_medio", "custoMedio", "custo", "valor"]);
          const n = parsePtNumber(String(raw ?? ""));
          return Number.isFinite(n) && n > 0 ? n : null;
        })();

        const payload: any = {
          company_id: companyId,
          bubble_id: b,
          name,
          unidade_medida: unidade,
          custo_medio: custoMedio,
          item_receita: false,
          item_do_cardapio: false,
          category_id: insumoCategoryId || null,
          raw: itemObj && typeof itemObj === "object" ? itemObj : {},
        };

        if (existing?.id) {
          const { error } = await supabase.from("items").update(payload).eq("id", String((existing as any).id));
          if (error) return null;
          return { id: String((existing as any).id), bubble_id: b, name };
        }
        const { data: inserted, error } = await supabase.from("items").insert(payload).select("id").maybeSingle();
        if (error) return null;
        const id = String((inserted as any)?.id ?? "").trim();
        return id ? { id, bubble_id: b, name } : null;
      };

      const legacyDrafts: Array<{
        receita: string;
        precoVenda: string;
        custoUnitario: string;
        cmvMeta: string;
        cmvAtual: string;
        bcg: string;
      }> = [];

      const hydratedByNameKey = new Map<
        string,
        {
          modoPreparo: string;
          recipeYield: number | null;
          ingredientRows: Array<{ id: string; ingredientId: string; item: string; quantidade: string; unidade: string; custoTotal: number }>;
        }
      >();

      for (const r of rows as FichaTecnicaDraftRow[]) {
        if ((r as any)?.invalid) {
          ignored += 1;
          continue;
        }
        const rowId = normalizeSpace(String((r as any)?.rowId ?? "")) || "row";
        const receita = normalizeSpace(String((r as any)?.receita ?? ""));
        if (!receita) {
          ignored += 1;
          continue;
        }

        const precoVendaNum = parseMoneyToNumber(String((r as any)?.precoVenda ?? ""));
        const custoUnitarioNum = parseMoneyToNumber(String((r as any)?.custoUnitario ?? ""));
        const cmvMetaNum = parseMoneyToNumber(String((r as any)?.cmvMeta ?? ""));
        if (precoVendaNum === null || custoUnitarioNum === null || cmvMetaNum === null) {
          ignored += 1;
          continue;
        }

        const quadrante = normalizeQuadrante(String((r as any)?.bcg ?? ""));
        const existing = byNameKey.get(normKey(receita)) ?? null;
        const payload: any = {
          company_id: companyId,
          category_id: categoryId,
          name: receita,
          unidade_medida: "Und",
          rendimento: 1,
          custo_medio: custoUnitarioNum,
          custo_total_receita: custoUnitarioNum,
          cmv_desejado: cmvMetaNum,
          preco_venda_total: precoVendaNum,
          quadrante_ficha_tecnica: quadrante || null,
          item_receita: true,
          item_do_cardapio: true,
        };

        let recipeDbId = existing?.id ? String(existing.id) : "";
        try {
          if (existing?.id) {
            const { error: upErr } = await supabase.from("items").update(payload).eq("id", existing.id);
            if (upErr) throw new Error(upErr.message);
            updated += 1;
          } else {
            const { data: ins, error: insErr } = await supabase.from("items").insert(payload).select("id").maybeSingle();
            if (insErr) throw new Error(insErr.message);
            recipeDbId = String((ins as any)?.id ?? "").trim();
            created += 1;
          }
        } catch (err) {
          errors.push({ rowId, message: err instanceof Error ? err.message : String(err) });
        }

        const doHydrate = Boolean(bubbleCreds && companyBubbleId && recipeDbId);
        if (doHydrate) {
          try {
            const bubbleRecipeId = await findBubbleRecipeItemId(receita);
            if (bubbleRecipeId) {
              const bubbleItem = await fetchBubbleObjById(bubbleCreds as BubbleObjCredentials, "itens", bubbleRecipeId).catch(() => null);
              const modoPreparo = normalizeSpace(
                String(
                  getFieldLoose(bubbleItem, ["modo_preparo", "modoPreparo", "modo_de_preparo", "modo preparo", "preparo", "modo"]) ?? "",
                ),
              );
              const rendimentoNum = (() => {
                const raw = getFieldLoose(bubbleItem, ["rendimento", "porcoes", "porções", "yield"]);
                const n = parsePtNumber(String(raw ?? ""));
                return Number.isFinite(n) && n > 0 ? n : null;
              })();

              const ingredientEntries: any[] = [];
              const typeNames = ["Ingredientes", "ingredientes"];
              const candidateKeys = ["item_receita_id", "item_receita", "receita_id", "receita"];
              for (const typeName of typeNames) {
                for (const key of candidateKeys) {
                  try {
                    const page = await fetchBubbleObjPageWithConstraints<any>({
                      creds: bubbleCreds as BubbleObjCredentials,
                      type: typeName,
                      cursor: 0,
                      limit: 200,
                      constraints: [{ key, constraint_type: "equals", value: bubbleRecipeId }],
                      timeoutMs: 12_000,
                    });
                    const results = Array.isArray(page?.results) ? page.results : [];
                    if (results.length) {
                      ingredientEntries.push(...results);
                      break;
                    }
                  } catch {
                    continue;
                  }
                }
                if (ingredientEntries.length) break;
              }

              const ingredientRows: Array<{ id: string; ingredientId: string; item: string; quantidade: string; unidade: string; custoTotal: number }> = [];
              const ingredientItemIds: string[] = [];
              const ingredientRawByItemId = new Map<string, any>();

              for (const entry of ingredientEntries) {
                const ingObj = entry && typeof entry === "object" ? (entry as any) : null;
                if (!ingObj) continue;
                const itemRef = getFieldLoose(ingObj, ["item_id", "item", "insumo", "ingrediente"]);
                const itemRefId = extractRefId(itemRef);
                if (!itemRefId) continue;
                ingredientItemIds.push(itemRefId);
                ingredientRawByItemId.set(itemRefId, ingObj);
              }

              const itemObjCache = new Map<string, any>();
              const getBubbleItemCached = async (id: string) => {
                const k = String(id ?? "").trim();
                if (!k) return null;
                if (itemObjCache.has(k)) return itemObjCache.get(k);
                const obj = await fetchBubbleObjById(bubbleCreds as BubbleObjCredentials, "itens", k).catch(() => null);
                itemObjCache.set(k, obj);
                return obj;
              };

              const uniqIngredientItemIds = Array.from(new Set(ingredientItemIds)).slice(0, 300);
              const ingredientDbIdByBubbleId = new Map<string, string>();
              if (uniqIngredientItemIds.length) {
                const { data: ex } = await supabase.from("items").select("id,bubble_id").eq("company_id", companyId).in("bubble_id", uniqIngredientItemIds);
                for (const row of ex ?? []) {
                  const bid = normalizeSpace(String((row as any)?.bubble_id ?? ""));
                  const id = String((row as any)?.id ?? "").trim();
                  if (bid && id) ingredientDbIdByBubbleId.set(bid, id);
                }
              }

              const recipeIngRowsToInsert: any[] = [];
              for (const ingBubbleItemId of uniqIngredientItemIds) {
                const ingObj = ingredientRawByItemId.get(ingBubbleItemId) ?? null;
                const bubbleItem = await getBubbleItemCached(ingBubbleItemId);
                const name = normalizeSpace(String(getFieldLoose(bubbleItem, ["nome", "name", "item"]) ?? "")) || normalizeSpace(String(getFieldLoose(ingObj, ["nome", "name"]) ?? "")) || ingBubbleItemId;
                const unidade = normalizeSpace(String(getFieldLoose(bubbleItem, ["unidade_medida", "unidade", "medida", "unit"]) ?? "")) || "Und";
                const qtyRaw = getFieldLoose(ingObj, ["quantidade", "qtd", "qtde", "qty", "amount", "peso"]);
                const qtyNum = parsePtNumber(String(qtyRaw ?? ""));
                const quantidade = qtyNum > 0 ? qtyNum.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 }) : "0,000";
                const custoRaw = getFieldLoose(ingObj, ["custo", "valor", "subtotal", "total", "custo_total", "cost", "price"]);
                let custoNum = parsePtNumber(String(custoRaw ?? ""));
                if (!(custoNum > 0)) {
                  const custoMedioRaw = getFieldLoose(bubbleItem, ["custo_medio", "custoMedio", "custo"]);
                  const custoMedio = parsePtNumber(String(custoMedioRaw ?? ""));
                  if (custoMedio > 0 && qtyNum > 0) custoNum = custoMedio * qtyNum;
                }
                const custoTotal = custoNum > 0 ? custoNum : 0;

                let ingredientDbId = ingredientDbIdByBubbleId.get(ingBubbleItemId) ?? "";
                if (!ingredientDbId) {
                  const up = await upsertIngredientItem(ingBubbleItemId, bubbleItem);
                  if (up?.id) {
                    ingredientDbId = up.id;
                    ingredientDbIdByBubbleId.set(ingBubbleItemId, up.id);
                  }
                }
                if (!ingredientDbId) continue;

                const ingRowBubbleId = extractBubbleIdFromObj(ingObj);
                recipeIngRowsToInsert.push({
                  company_id: companyId,
                  ...(ingRowBubbleId ? { bubble_id: ingRowBubbleId } : {}),
                  recipe_item_id: recipeDbId,
                  ingredient_item_id: ingredientDbId,
                  quantidade: qtyNum > 0 ? qtyNum : null,
                  custo: custoTotal > 0 ? custoTotal : null,
                  ingrediente_temporario: false,
                  raw: ingObj && typeof ingObj === "object" ? ingObj : {},
                });

                ingredientRows.push({
                  id: ingRowBubbleId || ingBubbleItemId,
                  ingredientId: ingBubbleItemId,
                  item: name,
                  quantidade,
                  unidade,
                  custoTotal,
                });
              }

              await supabase.from("recipe_ingredients").delete().eq("company_id", companyId).eq("recipe_item_id", recipeDbId);
              if (recipeIngRowsToInsert.length) {
                for (let i = 0; i < recipeIngRowsToInsert.length; i += 200) {
                  const chunk = recipeIngRowsToInsert.slice(i, i + 200);
                  try {
                    await supabase.from("recipe_ingredients").insert(chunk as any);
                  } catch {}
                }
              }

              const updateRecipePayload: any = {
                bubble_id: bubbleRecipeId,
                raw: bubbleItem && typeof bubbleItem === "object" ? bubbleItem : {},
              };
              if (modoPreparo) updateRecipePayload.modo_preparo = modoPreparo;
              if (rendimentoNum) updateRecipePayload.rendimento = rendimentoNum;
              try {
                await supabase.from("items").update(updateRecipePayload).eq("id", recipeDbId);
              } catch {}

              hydratedByNameKey.set(normKey(receita), { modoPreparo, recipeYield: rendimentoNum, ingredientRows });
            }
          } catch (err) {
            errors.push({ rowId, message: `bubble_hydrate:${err instanceof Error ? err.message : String(err)}` });
          }
        }

        legacyDrafts.push({
          receita,
          precoVenda: String((r as any)?.precoVenda ?? "").trim(),
          custoUnitario: String((r as any)?.custoUnitario ?? "").trim(),
          cmvMeta: String((r as any)?.cmvMeta ?? "").trim(),
          cmvAtual: String((r as any)?.cmvAtual ?? "").trim(),
          bcg: mapQuadranteToLegacyBcg(quadrante || String((r as any)?.bcg ?? "")),
        });
      }

      const stateId = `user:${targetUserId}`;
      try {
        const { data: existingState, error: stErr } = await supabase.from("fichas_tecnicas_state").select("payload").eq("id", stateId).maybeSingle();
        if (!stErr) {
          const prevPayload = Array.isArray((existingState as any)?.payload) ? (((existingState as any).payload as any[]) ?? []) : [];
          const prevByKey = new Map<string, any>();
          for (const row of prevPayload) {
            const name = normalizeSpace(String((row as any)?.receita ?? ""));
            if (name) prevByKey.set(normKey(name), row);
          }

          const merged: any[] = [];
          const used = new Set<string>();
          for (const d of legacyDrafts) {
            const key = normKey(d.receita);
            used.add(key);
            const prev = prevByKey.get(key) ?? null;
            const id = String((prev as any)?.id ?? "").trim() || makeLegacyId(d.receita);
            const hydrated = hydratedByNameKey.get(key) ?? null;
            const ingredientRows = hydrated?.ingredientRows ? hydrated.ingredientRows : (prev as any)?.ingredientRows;
            const modoPreparo = hydrated?.modoPreparo ? hydrated.modoPreparo : String((prev as any)?.modoPreparo ?? "");
            const recipeYield =
              typeof hydrated?.recipeYield === "number" && Number.isFinite(hydrated.recipeYield) && hydrated.recipeYield > 0
                ? hydrated.recipeYield
                : typeof (prev as any)?.recipeYield === "number" && Number.isFinite((prev as any).recipeYield) && (prev as any).recipeYield > 0
                  ? (prev as any).recipeYield
                  : undefined;
            const ingredientsTotal =
              Array.isArray(ingredientRows) && ingredientRows.length
                ? ingredientRows.reduce((acc: number, it: any) => acc + (typeof it?.custoTotal === "number" ? it.custoTotal : 0), 0)
                : typeof (prev as any)?.ingredientsTotal === "number"
                  ? (prev as any).ingredientsTotal
                  : undefined;
            merged.push({
              ...(prev && typeof prev === "object" ? prev : {}),
              id,
              origin: "manual",
              receita: d.receita,
              precoVenda: d.precoVenda,
              custoUnitario: d.custoUnitario,
              cmvMeta: d.cmvMeta,
              cmvAtual: d.cmvAtual,
              cmvDelta: String((prev as any)?.cmvDelta ?? ""),
              bcg: d.bcg,
              thumb: String((prev as any)?.thumb ?? "burger"),
              ...(ingredientRows ? { ingredientRows } : {}),
              ...(modoPreparo ? { modoPreparo } : {}),
              ...(typeof recipeYield === "number" ? { recipeYield } : {}),
              ...(typeof ingredientsTotal === "number" ? { ingredientsTotal } : {}),
            });
          }
          for (const row of prevPayload) {
            const name = normalizeSpace(String((row as any)?.receita ?? ""));
            const key = name ? normKey(name) : "";
            if (key && used.has(key)) continue;
            merged.push(row);
          }
          const { error: upStateErr } = await supabase.from("fichas_tecnicas_state").upsert({ id: stateId, payload: merged } as any, { onConflict: "id" });
          if (upStateErr) errors.push({ rowId: "state", message: `fichas_tecnicas_state:${upStateErr.message}` });
        } else {
          errors.push({ rowId: "state", message: `fichas_tecnicas_state:${stErr.message}` });
        }
      } catch (err) {
        errors.push({ rowId: "state", message: err instanceof Error ? err.message : String(err) });
      }

      return json({ ok: true, result: { module, created, updated, ignored, errors } }, { status: 200 });
    }

    const insumoRows = rows as InsumoDraftRow[];

    const { data: categoriesDb, error: catErr } = await supabase.from("categories").select("id,name").eq("company_id", companyId).limit(50_000);
    if (catErr) return json({ ok: false, error: catErr.message }, { status: 500 });

    const categoryIdByKey = new Map<string, string>();
    for (const c of categoriesDb ?? []) {
      const id = String((c as any)?.id ?? "").trim();
      const name = normalizeSpace(String((c as any)?.name ?? ""));
      if (!id || !name) continue;
      categoryIdByKey.set(normKey(name), id);
    }

    const { data: itemsDb, error: itemsErr } = await supabase
      .from("items")
      .select("id,bubble_id,name,item_receita,item_do_cardapio")
      .eq("company_id", companyId)
      .or("item_receita.is.null,item_receita.eq.false")
      .or("item_do_cardapio.is.null,item_do_cardapio.eq.false")
      .limit(50_000);
    if (itemsErr) return json({ ok: false, error: itemsErr.message }, { status: 500 });

    const itemByBubbleId = new Map<string, { id: string; name: string }>();
    const itemByNameKey = new Map<string, { id: string; name: string }>();
    for (const it of itemsDb ?? []) {
      const id = String((it as any)?.id ?? "").trim();
      const bubbleId = normalizeSpace(String((it as any)?.bubble_id ?? ""));
      const name = normalizeSpace(String((it as any)?.name ?? ""));
      if (!id || !name) continue;
      if (bubbleId) itemByBubbleId.set(bubbleId, { id, name });
      itemByNameKey.set(normKey(name), { id, name });
    }

    let created = 0;
    let updated = 0;
    let ignored = 0;
    const errors: Array<{ rowId: string; message: string }> = [];

    for (const r of insumoRows) {
      if ((r as any)?.invalid) {
        ignored += 1;
        continue;
      }
      const rowId = String(r?.rowId ?? "").trim() || "row";
      const item = normalizeSpace(String(r?.item ?? ""));
      if (!item) {
        ignored += 1;
        continue;
      }
      const categoria = normalizeSpace(String(r?.categoria ?? "")) || "Pendente de classificação";
      const medida = normalizeSpace(String(r?.medida ?? "")) || "Und";
      const especificacao = normalizeSpace(String(r?.especificacao ?? ""));
      const ocultar = Boolean(r?.ocultar);
      const bubbleId = normalizeSpace(String((r as any)?.bubbleId ?? ""));
      const custoNum = parseMoneyToNumber(String(r?.custoMedio ?? ""));

      let categoryId = categoryIdByKey.get(normKey(categoria)) ?? "";
      if (!categoryId) {
        const { data: ins, error: insErr } = await supabase
          .from("categories")
          .insert({ company_id: companyId, name: categoria } as any)
          .select("id")
          .maybeSingle();
        if (insErr) {
          errors.push({ rowId, message: `categoria_insert:${insErr.message}` });
          continue;
        }
        categoryId = String((ins as any)?.id ?? "").trim();
        if (!categoryId) {
          errors.push({ rowId, message: "categoria_insert:missing_id" });
          continue;
        }
        categoryIdByKey.set(normKey(categoria), categoryId);
      }

      const existing = (bubbleId && itemByBubbleId.get(bubbleId)) || itemByNameKey.get(normKey(item)) || null;
      if (existing) {
        const updatePayload: any = {
          name: item,
          unidade_medida: medida,
          custo_medio: custoNum,
          descricao: especificacao || null,
          ocultar_cmv: ocultar,
          category_id: categoryId,
          item_receita: false,
          item_do_cardapio: false,
        };
        if (bubbleId) updatePayload.bubble_id = bubbleId;
        const { error: upErr } = await supabase
          .from("items")
          .update(updatePayload)
          .eq("id", existing.id);
        if (upErr) {
          errors.push({ rowId, message: `item_update:${upErr.message}` });
          continue;
        }
        updated += 1;
        if (bubbleId) itemByBubbleId.set(bubbleId, { id: existing.id, name: item });
        itemByNameKey.set(normKey(item), { id: existing.id, name: item });
      } else {
        const { data: ins, error: insErr } = await supabase
          .from("items")
          .insert(
            {
              company_id: companyId,
              name: item,
              unidade_medida: medida,
              custo_medio: custoNum,
              descricao: especificacao || null,
              ocultar_cmv: ocultar,
              category_id: categoryId,
              item_receita: false,
              item_do_cardapio: false,
              bubble_id: bubbleId || null,
            } as any,
          )
          .select("id")
          .maybeSingle();
        if (insErr) {
          errors.push({ rowId, message: `item_insert:${insErr.message}` });
          continue;
        }
        const newId = String((ins as any)?.id ?? "").trim();
        if (!newId) {
          errors.push({ rowId, message: "item_insert:missing_id" });
          continue;
        }
        created += 1;
        if (bubbleId) itemByBubbleId.set(bubbleId, { id: newId, name: item });
        itemByNameKey.set(normKey(item), { id: newId, name: item });
      }
    }

    const result = {
      ok: errors.length === 0,
      module: "insumos",
      companyId,
      created,
      updated,
      ignored,
      errors,
    };

    try {
      const stateId = `user:${targetUserId}`;
      const { data: prevState, error: stErr } = await supabase.from("insumos_state").select("payload").eq("id", stateId).maybeSingle();
      if (stErr && !isMissingTableError(stErr)) {
        errors.push({ rowId: "state", message: `insumos_state:${stErr.message}` });
      } else if (!stErr) {
        const prevPayload = (prevState as any)?.payload ?? {};
        const prevRows = Array.isArray(prevPayload?.rows) ? ((prevPayload.rows as any[]) ?? []) : [];
        const prevById = new Map<string, any>();
        for (const row of prevRows) {
          const id = String((row as any)?.id ?? "").trim();
          if (id) prevById.set(id, row);
        }

        const mergedById = new Map<string, any>(prevById);
        for (const r of insumoRows) {
          if ((r as any)?.invalid) continue;
          const item = normalizeSpace(String(r?.item ?? ""));
          if (!item) continue;
          const bubbleId = normalizeSpace(String((r as any)?.bubbleId ?? ""));
          const id = bubbleId ? `${stateId}:insumo:${bubbleId}` : `${stateId}:insumo:manual:${buildManualSlug(item) || "insumo"}`;
          const categoria = normalizeSpace(String(r?.categoria ?? "")) || "Pendente de classificação";
          const medida = normalizeSpace(String(r?.medida ?? "")) || "Und";
          const especificacao = normalizeSpace(String(r?.especificacao ?? ""));
          const ocultar = Boolean(r?.ocultar);
          const custoNum = parseMoneyToNumber(String(r?.custoMedio ?? ""));
          const custoMedio = normalizeSpace(String(r?.custoMedio ?? "")) || (custoNum != null ? formatBrl(custoNum) : "");

          const prev = mergedById.get(id) ?? null;
          mergedById.set(
            id,
            prev && typeof prev === "object"
              ? { ...(prev as any), id, item, medida, categoria, custoMedio: custoMedio || undefined, especificacao: especificacao || undefined, ocultar }
              : { id, item, medida, categoria, custoMedio: custoMedio || undefined, especificacao: especificacao || undefined, ocultar },
          );
        }

        const mergedRows = Array.from(mergedById.values()).filter((x) => x && typeof x === "object" && String((x as any)?.id ?? "").trim());
        const categories = Array.from(new Set(mergedRows.map((r: any) => String(r?.categoria ?? "").trim()).filter(Boolean))).sort((a, b) =>
          a.localeCompare(b, "pt-BR", { sensitivity: "base", numeric: true }),
        );
        const { error: upErr } = await supabase.from("insumos_state").upsert({ id: stateId, payload: { rows: mergedRows, categories } } as any, { onConflict: "id" });
        if (upErr && !isMissingTableError(upErr)) errors.push({ rowId: "state", message: `insumos_state:${upErr.message}` });
      }
    } catch (err) {
      errors.push({ rowId: "state", message: err instanceof Error ? err.message : String(err) });
    }

    return json({ ok: true, result }, { status: 200 });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
