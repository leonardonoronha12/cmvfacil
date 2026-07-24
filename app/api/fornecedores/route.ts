import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../lib/requestUserId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOMBSTONE_KEY = "__CMVFACIL_DELETED_SUPPLIERS__";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return NextResponse.json(data, { ...init, headers });
}

function errJson(args: { status: number; traceId: string; stage: string; error: unknown; source?: "legacy" | "compat" }) {
  const msg = args.error instanceof Error ? args.error.message : String(args.error ?? "");
  return json(
    { ok: false, error: msg || "unknown_error", stage: args.stage, traceId: args.traceId, ...(args.source ? { source: args.source } : null) },
    { status: args.status },
  );
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function safeObj(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  return input as Record<string, unknown>;
}

function safeArr(input: unknown): unknown[] {
  return Array.isArray(input) ? input : [];
}

function parseCsvEnv(value: string | undefined) {
  return String(value ?? "")
    .split(/[,\n;]/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

function normalizeText(v: unknown) {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

function normalizeNameKey(v: unknown) {
  return normalizeText(v).toLowerCase();
}

function normalizeLookupKey(v: unknown) {
  return normalizeText(v)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function parsePermissionLevel(v: unknown) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : 0;
}

function scoreRole(role: unknown) {
  const r = String(role ?? "").trim().toLowerCase();
  if (!r) return 0;
  if (r.includes("owner") || r.includes("propriet")) return 30;
  if (r.includes("admin")) return 20;
  if (r.includes("manager") || r.includes("gerente")) return 10;
  return 0;
}

function pickBestCompanyId(memberRows: unknown[]) {
  let bestCompanyId = "";
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const row of memberRows ?? []) {
    const r = row as any;
    const companyId = String(r?.company_id ?? "").trim();
    if (!companyId) continue;
    const perm = parsePermissionLevel(r?.permission_level);
    const score = perm * 100 + scoreRole(r?.role);
    if (score > bestScore) {
      bestScore = score;
      bestCompanyId = companyId;
    }
  }
  return bestCompanyId;
}

function isAdminUserId(userId: string) {
  const ids = new Set(parseCsvEnv(process.env.ADMIN_USER_IDS).map((x) => x.toLowerCase()));
  const emails = new Set(
    [...parseCsvEnv(process.env.ADMIN_USER_EMAILS), ...parseCsvEnv(process.env.ADMIN_EMAILS), ...parseCsvEnv(process.env.ADMIN_EMAILS_LEGACY)].map((x) =>
      x.toLowerCase(),
    ),
  );
  const raw = userId.toLowerCase();
  if (!isUuid(userId) && raw.includes("@") && process.env.ADMIN_SECRET) return true;
  if (ids.size && ids.has(raw)) return true;
  if (emails.size && emails.has(raw)) return true;
  return false;
}

function resolveUserScopedId(req: NextRequest) {
  const { accessToken, userId } = getUserIdFromRequest(req);
  if (!userId) return { accessToken, id: null as string | null };
  if (isUuid(userId)) return { accessToken, id: `user:${userId}` };
  const url = new URL(req.url);
  const override = String(url.searchParams.get("userId") ?? "").trim();
  if (override && isUuid(override) && isAdminUserId(userId)) return { accessToken, id: `user:${override}` };
  return { accessToken, id: null as string | null };
}

function normalizeFornecedoresRaw(raw: unknown, patch: { produtos?: string[]; equivalencias?: unknown }) {
  const obj = safeObj(raw);
  const fornecedores = safeObj(obj.fornecedores);
  const nextFornecedores = { ...fornecedores } as any;
  if (patch.produtos) nextFornecedores.produtos = patch.produtos;
  if (typeof patch.equivalencias !== "undefined") nextFornecedores.equivalencias = patch.equivalencias;
  return { ...obj, fornecedores: nextFornecedores };
}

function extractCompatTombstonesFromRaw(raw: unknown) {
  const obj = safeObj(raw);
  const fornecedores = safeObj(obj.fornecedores);
  const system = safeObj(obj.system);
  const a = safeArr((system as any).cmvfacil_deleted_suppliers).map((x) => String(x ?? "").trim()).filter(Boolean);
  if (a.length) return a;
  const b = safeArr((fornecedores as any).tombstones).map((x) => String(x ?? "").trim()).filter(Boolean);
  return b;
}

function withCompatTombstonesRaw(raw: unknown, tombstones: string[]) {
  const obj = safeObj(raw);
  const system = safeObj(obj.system);
  const nextSystem = { ...system, cmvfacil_deleted_suppliers: tombstones.length ? tombstones : [] } as any;
  return { ...obj, system: nextSystem };
}

async function shouldUseCompatSource(args: { req: NextRequest; supabase: ReturnType<typeof getSupabaseServerClient> }) {
  const url = new URL(args.req.url);
  const source = String(url.searchParams.get("source") ?? "").trim().toLowerCase();
  if (source === "legacy") return false;
  if (source === "compat") return true;
  try {
    const { error } = await args.supabase.from("suppliers").select("id").limit(1);
    if (error) {
      const msg = String(error.message ?? "").toLowerCase();
      if (msg.includes("does not exist") && msg.includes("suppliers")) return false;
      if (msg.includes("relation") && msg.includes("suppliers")) return false;
    }
  } catch {}
  return true;
}

function normalizeTombstoneKey(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

function isDbPrefixed(value: string) {
  return value.trim().toLowerCase().startsWith("db:");
}

function dbIdFromKey(value: string) {
  const s = value.trim();
  if (!isDbPrefixed(s)) return "";
  return s.slice(3);
}

export async function GET(req: NextRequest) {
  const traceId = crypto.randomUUID();
  try {
    const { accessToken, id } = resolveUserScopedId(req);
    if (!id) return json({ ok: true, traceId, source: "legacy", readOnly: false, row: null }, { status: 200 });
    const supabase = getSupabaseServerClient(accessToken);
    const userId = id.slice("user:".length);

    const { userId: rawUserId } = getUserIdFromRequest(req);
    const isAdmin = Boolean(rawUserId && isAdminUserId(rawUserId));
    const shouldUseCompat = await shouldUseCompatSource({ req, supabase });
    if (shouldUseCompat) {
      const { data: memberRows, error: memberErr } = await supabase
        .from("company_members")
        .select("company_id,role,permission_level")
        .eq("user_id", userId)
        .limit(50);
      if (memberErr) return errJson({ status: 500, traceId, stage: "compat.company_members_select", error: memberErr.message, source: "compat" });
      const companyId = pickBestCompanyId((memberRows ?? []) as any[]);
      if (!companyId) return errJson({ status: 500, traceId, stage: "compat.missing_company", error: "missing_company", source: "compat" });

      const { data: suppliersDb, error: suppliersErr } = await supabase
        .from("suppliers")
        .select("id,bubble_id,external_key,nome,endereco,vendedor,whatsapp,raw")
        .eq("company_id", companyId)
        .order("nome", { ascending: true });
      if (suppliersErr) return errJson({ status: 500, traceId, stage: "compat.suppliers_select", error: suppliersErr.message, source: "compat" });

      const info: Record<string, any> = {};
      const supplierKeyById = new Map<string, string>();
      const rawProdutosByKey = new Map<string, string[]>();
      const rawEquivByKey = new Map<string, unknown>();
      let tombstones: string[] = [];
      for (const s of suppliersDb ?? []) {
        const nome = normalizeText((s as any)?.nome ?? "");
        const externalKey = normalizeText((s as any)?.external_key ?? "");
        const sys = ((s as any)?.raw as any)?.system ?? null;
        const isDefault = externalKey === "supplier:default:sem_fornecedor" || normalizeNameKey(nome) === "sem fornecedor" || Boolean(sys?.default);
        if (isDefault) {
          const extracted = extractCompatTombstonesFromRaw((s as any)?.raw);
          if (extracted.length) tombstones = extracted;
          continue;
        }
        if (nome === TOMBSTONE_KEY) continue;
        const dbId = String((s as any)?.id ?? "").trim();
        const bubbleId = String((s as any)?.bubble_id ?? "").trim();
        const key = bubbleId || (dbId ? `db:${dbId}` : "");
        if (!key || !nome) continue;
        supplierKeyById.set(dbId, key);
        const fornecedoresRaw = safeObj(((s as any)?.raw as any)?.fornecedores);
        const rawProdutos = safeArr(fornecedoresRaw.produtos)
          .map((x) => normalizeText(x))
          .filter(Boolean);
        if (rawProdutos.length) rawProdutosByKey.set(key, rawProdutos);
        if (typeof fornecedoresRaw.equivalencias !== "undefined") rawEquivByKey.set(key, fornecedoresRaw.equivalencias);
        info[key] = {
          fornecedor: nome,
          vendedor: String((s as any)?.vendedor ?? "").trim(),
          whatsapp: String((s as any)?.whatsapp ?? "").trim(),
          endereco: String((s as any)?.endereco ?? "").trim(),
        };
      }

      const produtos: Record<string, string[]> = {};
      const { data: linksDb, error: linksErr } = await supabase
        .from("supplier_items")
        .select("supplier_id,item:items(name),supplier:suppliers(id,bubble_id)")
        .eq("company_id", companyId)
        .limit(5000);
      if (linksErr) return errJson({ status: 500, traceId, stage: "compat.supplier_items_select", error: linksErr.message, source: "compat" });
      for (const r of linksDb ?? []) {
        const supplier = (r as any)?.supplier ?? null;
        const supplierDbId = String(supplier?.id ?? "").trim();
        const supplierBubbleId = String(supplier?.bubble_id ?? "").trim();
        const supplierKey = supplierBubbleId || supplierKeyById.get(supplierDbId) || (supplierDbId ? `db:${supplierDbId}` : "");
        if (!supplierKey || !(supplierKey in info)) continue;
        const itemName = String((r as any)?.item?.name ?? "").trim();
        if (!itemName) continue;
        const prev = Array.isArray(produtos[supplierKey]) ? produtos[supplierKey] : [];
        if (!prev.includes(itemName)) produtos[supplierKey] = [...prev, itemName];
      }

      for (const k of Object.keys(info)) {
        const rawProdutos = rawProdutosByKey.get(k) ?? [];
        if (rawProdutos.length) produtos[k] = rawProdutos;
      }

      const normalizedTombstones = Array.from(new Set(tombstones.map(normalizeTombstoneKey).filter(Boolean)));
      if (normalizedTombstones.length) produtos[TOMBSTONE_KEY] = normalizedTombstones;

      const equivalencias: Record<string, any> = {};
      for (const k of Object.keys(info)) {
        const eq = rawEquivByKey.get(k);
        if (typeof eq !== "undefined") equivalencias[k] = eq as any;
      }

      return json({ ok: true, traceId, source: "compat", readOnly: false, row: { id, info, produtos, equivalencias } }, { status: 200 });
    }

    const { data, error } = await supabase.from("fornecedores_state").select("*").eq("id", id).maybeSingle();
    if (error) {
      const msg = String(error.message ?? "");
      if (msg.toLowerCase().includes("does not exist") && msg.toLowerCase().includes("fornecedores_state")) {
        return errJson({
          status: 500,
          traceId,
          stage: "legacy.missing_table_fornecedores_state",
          error: "missing_table_fornecedores_state (/setup-supabase)",
          source: "legacy",
        });
      }
      return errJson({ status: 500, traceId, stage: "legacy.fornecedores_state_select", error: msg, source: "legacy" });
    }
    return json({ ok: true, traceId, source: "legacy", readOnly: false, row: data ?? null }, { status: 200 });
  } catch (err) {
    return errJson({ status: 500, traceId, stage: "get.exception", error: err });
  }
}

export async function POST(req: NextRequest) {
  const traceId = crypto.randomUUID();
  try {
    const body = (await req.json().catch(() => null)) as unknown;
    if (!body || typeof body !== "object") return errJson({ status: 400, traceId, stage: "post.invalid_body", error: "invalid_body" });
    const data = body as Record<string, unknown>;
    const { accessToken, id } = resolveUserScopedId(req);
    if (!id) return errJson({ status: 401, traceId, stage: "post.unauthorized", error: "unauthorized" });
    const supabase = getSupabaseServerClient(accessToken);
    const shouldUseCompat = await shouldUseCompatSource({ req, supabase });
    const userId = id.slice("user:".length);

    if (!shouldUseCompat) {
      const payload = {
        id,
        info: (data.info ?? {}) as any,
        produtos: (data.produtos ?? {}) as any,
        equivalencias: (data.equivalencias ?? {}) as any,
      };
      const { error } = await supabase.from("fornecedores_state").upsert(payload as any, { onConflict: "id" });
      if (error) {
        const msg = String(error.message ?? "");
        if (msg.toLowerCase().includes("does not exist") && msg.toLowerCase().includes("fornecedores_state")) {
          return errJson({
            status: 500,
            traceId,
            stage: "legacy.missing_table_fornecedores_state",
            error: "missing_table_fornecedores_state (/setup-supabase)",
            source: "legacy",
          });
        }
        return errJson({ status: 500, traceId, stage: "legacy.fornecedores_state_upsert", error: msg, source: "legacy" });
      }
      return json({ ok: true, traceId }, { status: 200 });
    }

    const { data: memberRows, error: memberErr } = await supabase
      .from("company_members")
      .select("company_id,role,permission_level")
      .eq("user_id", userId)
      .limit(50);
    if (memberErr) return errJson({ status: 500, traceId, stage: "compat.company_members_select", error: memberErr.message, source: "compat" });
    const companyId = pickBestCompanyId((memberRows ?? []) as any[]);
    if (!companyId) return errJson({ status: 500, traceId, stage: "compat.missing_company", error: "missing_company", source: "compat" });

    const infoMap = safeObj(data.info);
    const produtosMap = safeObj(data.produtos);
    const equivMap = safeObj(data.equivalencias);

    const { data: suppliersDb, error: suppliersErr } = await supabase
      .from("suppliers")
      .select("id,bubble_id,external_key,nome,raw")
      .eq("company_id", companyId)
      .limit(5000);
    if (suppliersErr) return errJson({ status: 500, traceId, stage: "compat.suppliers_select", error: suppliersErr.message, source: "compat" });

    const supplierIdByBubbleId = new Map<string, string>();
    const supplierIdByNameKey = new Map<string, string>();
    const supplierRawById = new Map<string, unknown>();
    const supplierIdByKeyUpper = new Map<string, string>();
    let defaultSupplierId = "";
    const reservedSupplierIds = new Set<string>();
    for (const s of suppliersDb ?? []) {
      const sid = String((s as any)?.id ?? "").trim();
      if (!sid) continue;
      const bubbleId = String((s as any)?.bubble_id ?? "").trim();
      const externalKey = normalizeText((s as any)?.external_key ?? "");
      const nome = normalizeText((s as any)?.nome ?? "");
      const sys = ((s as any)?.raw as any)?.system ?? null;
      const isDefault = externalKey === "supplier:default:sem_fornecedor" || normalizeNameKey(nome) === "sem fornecedor" || Boolean(sys?.default);
      if (isDefault) defaultSupplierId = sid;
      if (nome === TOMBSTONE_KEY) reservedSupplierIds.add(sid);
      if (bubbleId) supplierIdByBubbleId.set(bubbleId, sid);
      if (nome) supplierIdByNameKey.set(normalizeNameKey(nome), sid);
      supplierRawById.set(sid, (s as any)?.raw ?? {});
      const key = bubbleId || `db:${sid}`;
      supplierIdByKeyUpper.set(key.toUpperCase(), sid);
    }

    const tombstonesUpper = Array.from(new Set(safeArr(produtosMap[TOMBSTONE_KEY]).map(normalizeTombstoneKey).filter(Boolean)));
    const keys = new Set<string>(
      [...Object.keys(infoMap), ...Object.keys(produtosMap), ...Object.keys(equivMap)]
        .map((k) => String(k ?? "").trim())
        .filter((k) => Boolean(k) && k !== TOMBSTONE_KEY),
    );
    const keepKeysUpper = new Set<string>(Array.from(keys).map(normalizeTombstoneKey).filter(Boolean));

    const updates: any[] = [];
    const inserts: any[] = [];
    for (const key of keys) {
      const infoRow = safeObj(infoMap[key]);
      const nomeFromInfo = normalizeText(infoRow.fornecedor ?? "");
      const nameKey = normalizeNameKey(nomeFromInfo || key);
      const rawProdutos = safeArr(produtosMap[key])
        .map((x) => normalizeText(x))
        .filter(Boolean);
      const produtos = Array.from(new Set(rawProdutos));
      const equivalencias = typeof equivMap[key] !== "undefined" ? equivMap[key] : undefined;

      let supplierId = "";
      if (isDbPrefixed(key) && isUuid(dbIdFromKey(key))) supplierId = dbIdFromKey(key);
      if (!supplierId && isUuid(key)) supplierId = key;
      if (!supplierId) supplierId = supplierIdByBubbleId.get(key) ?? "";
      if (!supplierId && nameKey) supplierId = supplierIdByNameKey.get(nameKey) ?? "";

      const rawBase = supplierId ? supplierRawById.get(supplierId) : {};
      const nextRaw = normalizeFornecedoresRaw(rawBase, { produtos: produtos.length ? produtos : undefined, equivalencias });

      const vendedor = normalizeText(infoRow.vendedor ?? "");
      const endereco = normalizeText(infoRow.endereco ?? "");
      const whatsapp = normalizeText(infoRow.whatsapp ?? "");
      const nome = nomeFromInfo || normalizeText(key);

      const row = {
        ...(supplierId ? { id: supplierId } : null),
        company_id: companyId,
        bubble_id: !supplierId && /^\d{8,}x\d{6,}$/i.test(key) ? key : null,
        nome: nome || "-",
        endereco,
        vendedor,
        whatsapp,
        raw: nextRaw,
      };

      if (supplierId) updates.push(row);
      else inserts.push(row);
    }

    if (updates.length) {
      const { error: upErr } = await supabase.from("suppliers").upsert(updates as any, { onConflict: "id" });
      if (upErr) return errJson({ status: 500, traceId, stage: "compat.suppliers_upsert", error: upErr.message, source: "compat" });
    }

    if (inserts.length) {
      const { error: insErr } = await supabase.from("suppliers").insert(inserts as any);
      if (insErr) return errJson({ status: 500, traceId, stage: "compat.suppliers_insert", error: insErr.message, source: "compat" });
    }

    const { data: suppliersDb2, error: suppliersErr2 } = await supabase
      .from("suppliers")
      .select("id,bubble_id,nome,external_key,raw")
      .eq("company_id", companyId)
      .limit(7000);
    if (suppliersErr2) return errJson({ status: 500, traceId, stage: "compat.suppliers_reselect", error: suppliersErr2.message, source: "compat" });

    const supplierIdByBubbleId2 = new Map<string, string>();
    const supplierIdByNameKey2 = new Map<string, string>();
    const supplierIdByKeyUpper2 = new Map<string, string>();
    for (const s of suppliersDb2 ?? []) {
      const sid = String((s as any)?.id ?? "").trim();
      if (!sid) continue;
      const bubbleId = String((s as any)?.bubble_id ?? "").trim();
      const nome = normalizeText((s as any)?.nome ?? "");
      if (bubbleId) supplierIdByBubbleId2.set(bubbleId, sid);
      if (nome) supplierIdByNameKey2.set(normalizeNameKey(nome), sid);
      const key = bubbleId || `db:${sid}`;
      supplierIdByKeyUpper2.set(key.toUpperCase(), sid);
    }

    if (defaultSupplierId) {
      const rawBase = supplierRawById.get(defaultSupplierId) ?? {};
      const nextRaw = withCompatTombstonesRaw(rawBase, tombstonesUpper);
      const { error: defErr } = await supabase
        .from("suppliers")
        .update({ raw: nextRaw } as any)
        .eq("company_id", companyId)
        .eq("id", defaultSupplierId);
      if (defErr) return errJson({ status: 500, traceId, stage: "compat.suppliers_update_default_raw", error: defErr.message, source: "compat" });
    }

    const deleteCandidateIds = new Set<string>();
    for (const sid of reservedSupplierIds) {
      if (sid && sid !== defaultSupplierId) deleteCandidateIds.add(sid);
    }
    for (const kUpper of tombstonesUpper) {
      if (!kUpper || keepKeysUpper.has(kUpper)) continue;
      let supplierId = "";
      if (isDbPrefixed(kUpper) && isUuid(dbIdFromKey(kUpper))) supplierId = dbIdFromKey(kUpper);
      else if (isUuid(kUpper)) supplierId = kUpper;
      else supplierId = supplierIdByKeyUpper.get(kUpper) ?? "";
      if (!supplierId || supplierId === defaultSupplierId) continue;
      deleteCandidateIds.add(supplierId);
    }

    const deleteIds = Array.from(deleteCandidateIds).filter(Boolean);
    if (deleteIds.length) {
      const { error: linkDelErr } = await supabase.from("supplier_items").delete().eq("company_id", companyId).in("supplier_id", deleteIds);
      if (linkDelErr) return errJson({ status: 500, traceId, stage: "compat.supplier_items_delete", error: linkDelErr.message, source: "compat" });
      const { error: supplierDelErr } = await supabase.from("suppliers").delete().eq("company_id", companyId).in("id", deleteIds);
      if (supplierDelErr) return errJson({ status: 500, traceId, stage: "compat.suppliers_delete", error: supplierDelErr.message, source: "compat" });
    }

    const supplierProductsById = new Map<string, string[]>();
    for (const key of keys) {
      const rawProdutos = safeArr(produtosMap[key])
        .map((x) => normalizeText(x))
        .filter(Boolean);
      const produtos = Array.from(new Set(rawProdutos));
      const nameKey = normalizeNameKey(normalizeText(safeObj(infoMap[key]).fornecedor ?? "") || key);

      let supplierId = "";
      if (isDbPrefixed(key) && isUuid(dbIdFromKey(key))) supplierId = dbIdFromKey(key);
      if (!supplierId && isUuid(key)) supplierId = key;
      if (!supplierId) supplierId = supplierIdByBubbleId2.get(key) ?? "";
      if (!supplierId && nameKey) supplierId = supplierIdByNameKey2.get(nameKey) ?? "";
      if (!supplierId) supplierId = supplierIdByKeyUpper2.get(normalizeTombstoneKey(key)) ?? "";

      if (!supplierId) continue;
      supplierProductsById.set(supplierId, produtos);
    }

    const supplierIdsForSync = Array.from(supplierProductsById.keys()).filter(Boolean);
    if (supplierIdsForSync.length) {
      const { data: itemsDb, error: itemsErr } = await supabase.from("items").select("id,name").eq("company_id", companyId).limit(12000);
      if (itemsErr) return errJson({ status: 500, traceId, stage: "compat.items_select", error: itemsErr.message, source: "compat" });
      const itemIdByKey = new Map<string, string>();
      for (const it of itemsDb ?? []) {
        const id = String((it as any)?.id ?? "").trim();
        const name = String((it as any)?.name ?? "").trim();
        if (!id || !name) continue;
        const k = normalizeLookupKey(name);
        if (!k || itemIdByKey.has(k)) continue;
        itemIdByKey.set(k, id);
      }

      const desiredRows: Array<{ company_id: string; supplier_id: string; item_id: string }> = [];
      const missing: string[] = [];
      for (const [supplierId, produtos] of supplierProductsById.entries()) {
        for (const nome of produtos) {
          const itemId = itemIdByKey.get(normalizeLookupKey(nome)) ?? "";
          if (!itemId) {
            if (missing.length < 12) missing.push(nome);
            continue;
          }
          desiredRows.push({ company_id: companyId, supplier_id: supplierId, item_id: itemId });
        }
      }

      if (missing.length) {
        return errJson({
          status: 400,
          traceId,
          stage: "compat.items_not_found",
          error: `items_not_found: ${missing.join(" | ")}`,
          source: "compat",
        });
      }

      const { error: clearErr } = await supabase.from("supplier_items").delete().eq("company_id", companyId).in("supplier_id", supplierIdsForSync);
      if (clearErr) return errJson({ status: 500, traceId, stage: "compat.supplier_items_clear", error: clearErr.message, source: "compat" });

      if (desiredRows.length) {
        const { error: linkInsErr } = await supabase.from("supplier_items").insert(desiredRows as any);
        if (linkInsErr) return errJson({ status: 500, traceId, stage: "compat.supplier_items_insert", error: linkInsErr.message, source: "compat" });
      }
    }

    return json({ ok: true, traceId }, { status: 200 });
  } catch (err) {
    return errJson({ status: 500, traceId, stage: "post.exception", error: err });
  }
}
