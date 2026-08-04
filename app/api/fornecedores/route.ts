import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, getSupabaseServerClient } from "../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../lib/requestUserId";
import fs from "node:fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOMBSTONE_KEY = "__CMVFACIL_DELETED_SUPPLIERS__";
const DEBUG_ENV_PATH = ".dbg/supplier-items-persist.env";

// #region debug-point reporter
let __dbgCfg: null | { url: string; sessionId: string; runId: string } = null;
function __getDbgCfg() {
  if (__dbgCfg) return __dbgCfg;
  let url = String(process.env.DEBUG_SERVER_URL ?? "").trim();
  let sessionId = String(process.env.DEBUG_SESSION_ID ?? "").trim() || "supplier-items-persist";
  let runId = String(process.env.DEBUG_RUN_ID ?? "").trim() || "pre-fix";
  if (!url && process.env.NODE_ENV === "production") {
    url = "https://cmvfacil.app/api/debug/event";
    if (!String(process.env.DEBUG_RUN_ID ?? "").trim()) runId = "prod-pre-fix";
  }
  if (!url && process.env.NODE_ENV !== "production") {
    try {
      const raw = fs.readFileSync(DEBUG_ENV_PATH, "utf8");
      url = String(raw.match(/^DEBUG_SERVER_URL=(.+)$/m)?.[1] ?? "").trim() || url;
      sessionId = String(raw.match(/^DEBUG_SESSION_ID=(.+)$/m)?.[1] ?? "").trim() || sessionId;
    } catch {}
  }
  __dbgCfg = { url, sessionId, runId };
  return __dbgCfg;
}
async function __dbgStore(args: {
  supabase: ReturnType<typeof getSupabaseServerClient>;
  companyId: string;
  event: { sessionId: string; runId: string; hypothesisId: string; traceId?: string; location: string; msg: string; data: unknown; ts: number };
}) {
  try {
    const supabase = (() => {
      try {
        return getSupabaseAdmin();
      } catch {
        return args.supabase;
      }
    })();
    const { error: tableErr } = await supabase.from("debug_events").insert({
      session_id: args.event.sessionId,
      run_id: args.event.runId,
      hypothesis_id: args.event.hypothesisId,
      trace_id: args.event.traceId ?? null,
      location: args.event.location ?? null,
      msg: args.event.msg,
      data: (args.event.data ?? {}) as any,
      company_id: args.companyId,
      user_id: null,
    } as any);
    if (!tableErr) return;
    const { data: sysSupplier1, error: supplierErr1 } = await supabase
      .from("suppliers")
      .select("id,raw")
      .eq("company_id", args.companyId)
      .ilike("external_key", "supplier:default:sem_fornecedor")
      .limit(1)
      .maybeSingle();
    if (supplierErr1) return;
    let supplierRow = sysSupplier1 as any;
    if (!supplierRow) {
      const { data: ins, error: insErr } = await supabase
        .from("suppliers")
        .insert({
          company_id: args.companyId,
          external_key: "supplier:default:sem_fornecedor",
          nome: "Sem Fornecedor",
          endereco: "",
          vendedor: "",
          whatsapp: "",
          bubble_id: null,
          raw: { system: { default: true } },
        } as any)
        .select("id,raw")
        .limit(1)
        .maybeSingle();
      if (insErr) {
        const { data: existing, error: reErr } = await supabase
          .from("suppliers")
          .select("id,raw")
          .eq("company_id", args.companyId)
          .ilike("external_key", "supplier:default:sem_fornecedor")
          .limit(1)
          .maybeSingle();
        if (reErr) return;
        supplierRow = existing as any;
      } else {
        supplierRow = ins as any;
      }
    }
    if (!supplierRow) return;
    const supplierId = String((supplierRow as any)?.id ?? "").trim();
    if (!supplierId) return;
    const raw = supplierRow?.raw ?? {};
    const system = (raw as any)?.system ?? {};
    const prev = Array.isArray((system as any)?.debug_events) ? (system as any).debug_events : [];
    const next = [...prev, args.event].slice(-200);
    const nextRaw = { ...(raw as any), system: { ...(system as any), debug_events: next } };
    await supabase.from("suppliers").update({ raw: nextRaw } as any).eq("company_id", args.companyId).eq("id", supplierId);
  } catch {}
}

async function __dbgSend(args: {
  hypothesisId: string;
  traceId?: string;
  location: string;
  msg: string;
  data?: unknown;
  accessToken?: string;
  companyId?: string;
  supabase?: ReturnType<typeof getSupabaseServerClient>;
}) {
  try {
    const cfg = __getDbgCfg();
    if (!cfg.url) return;
    const adminSecret = String(process.env.ADMIN_SECRET ?? process.env.DEBUG_SECRET ?? "").trim();
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (adminSecret) headers["x-admin-secret"] = adminSecret;
    const accessToken = String(args.accessToken ?? "").trim();
    if (accessToken) headers.authorization = `Bearer ${accessToken}`;
    const data = typeof args.data === "undefined" || args.data === null ? {} : args.data;
    if (process.env.NODE_ENV === "production" && args.companyId && args.supabase) {
      await __dbgStore({
        supabase: args.supabase,
        companyId: args.companyId,
        event: {
          sessionId: cfg.sessionId,
          runId: cfg.runId,
          hypothesisId: args.hypothesisId,
          traceId: args.traceId,
          location: args.location,
          msg: args.msg,
          data,
          ts: Date.now(),
        },
      });
      if (cfg.url.includes("/api/debug/event")) return;
    }
    void fetch(cfg.url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        sessionId: cfg.sessionId,
        runId: cfg.runId,
        hypothesisId: args.hypothesisId,
        traceId: args.traceId,
        location: args.location,
        msg: args.msg,
        data,
        ts: Date.now(),
      }),
    }).catch(() => {});
  } catch {}
}
// #endregion

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

function canonicalUuid(value: string) {
  const s = String(value ?? "").trim();
  if (!s) return "";
  return isUuid(s) ? s.toLowerCase() : s;
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
  if (typeof patch.produtos !== "undefined") nextFornecedores.produtos = patch.produtos;
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
    const url = new URL(req.url);
    const diag = String(url.searchParams.get("diag") ?? "").trim() === "1";
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
        if (nome === TOMBSTONE_KEY) {
          const extracted = extractCompatTombstonesFromRaw((s as any)?.raw);
          if (extracted.length) tombstones = extracted;
          continue;
        }
        const dbId = canonicalUuid(String((s as any)?.id ?? ""));
        const bubbleId = String((s as any)?.bubble_id ?? "").trim();
        const key = dbId ? `db:${dbId}` : "";
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
        .select("supplier_id,item:items(name)")
        .eq("company_id", companyId)
        .limit(5000);
      if (linksErr) return errJson({ status: 500, traceId, stage: "compat.supplier_items_select", error: linksErr.message, source: "compat" });
      let linksSupplierIdMissing = 0;
      let linksSupplierKeyMissing = 0;
      let linksSupplierNotInInfo = 0;
      let linksItemNameMissing = 0;
      const linksSupplierIdSamples: string[] = [];
      const linksNotInInfoSamples: string[] = [];
      const distinctSupplierIds = new Set<string>();
      for (const r of linksDb ?? []) {
        const supplierDbId = canonicalUuid(String((r as any)?.supplier_id ?? ""));
        const supplierKey = supplierKeyById.get(supplierDbId) || (supplierDbId ? `db:${supplierDbId}` : "");
        if (!supplierDbId) {
          linksSupplierIdMissing++;
          continue;
        }
        distinctSupplierIds.add(supplierDbId);
        if (!supplierKey) {
          linksSupplierKeyMissing++;
          if (linksSupplierIdSamples.length < 5) linksSupplierIdSamples.push(supplierDbId);
          continue;
        }
        if (!(supplierKey in info)) {
          linksSupplierNotInInfo++;
          if (linksNotInInfoSamples.length < 5) linksNotInInfoSamples.push(supplierKey);
          continue;
        }
        const itemName = String((r as any)?.item?.name ?? "").trim();
        if (!itemName) {
          linksItemNameMissing++;
          continue;
        }
        const prev = Array.isArray(produtos[supplierKey]) ? produtos[supplierKey] : [];
        if (!prev.includes(itemName)) produtos[supplierKey] = [...prev, itemName];
      }

      for (const k of Object.keys(info)) {
        const rawProdutos = rawProdutosByKey.get(k) ?? [];
        const cur = Array.isArray(produtos[k]) ? produtos[k] : [];
        if (!cur.length && rawProdutos.length) produtos[k] = rawProdutos;
      }

      // #region debug-point D:get-compat-shape
      await __dbgSend({
        hypothesisId: "D",
        traceId,
        location: "app/api/fornecedores/route.ts:GET:compat",
        msg: "[DEBUG] fornecedores GET compat: shape",
        data: {
          companyId,
          suppliersDb: (suppliersDb ?? []).length,
          infoKeys: Object.keys(info).length,
          linksDb: (linksDb ?? []).length,
          produtosKeys: Object.keys(produtos).length,
        },
        accessToken,
        companyId,
        supabase,
      });
      // #endregion

      // #region debug-point D2:get-compat-links-skip
      await __dbgSend({
        hypothesisId: "D2",
        traceId,
        location: "app/api/fornecedores/route.ts:GET:compat",
        msg: "[DEBUG] fornecedores GET compat: links skip reasons",
        data: {
          companyId,
          shouldUseCompat,
          isAdmin,
          suppliersDb: (suppliersDb ?? []).length,
          infoKeys: Object.keys(info).length,
          linksDb: (linksDb ?? []).length,
          distinctSupplierIds: distinctSupplierIds.size,
          linksSupplierIdMissing,
          linksSupplierKeyMissing,
          linksSupplierNotInInfo,
          linksItemNameMissing,
          linksSupplierIdSamples,
          linksNotInInfoSamples,
        },
        accessToken,
        companyId,
        supabase,
      });
      // #endregion

      const normalizedTombstones = Array.from(new Set(tombstones.map(normalizeTombstoneKey).filter(Boolean)));
      if (normalizedTombstones.length) produtos[TOMBSTONE_KEY] = normalizedTombstones;

      const equivalencias: Record<string, any> = {};
      for (const k of Object.keys(info)) {
        const eq = rawEquivByKey.get(k);
        if (typeof eq !== "undefined") equivalencias[k] = eq as any;
      }

      const fornecedorLabelRaw = normalizeText(String(url.searchParams.get("fornecedorLabel") ?? ""));
      const fornecedorLabelLookup = normalizeLookupKey(fornecedorLabelRaw);
      const fornecedorLabelUpper = fornecedorLabelRaw ? fornecedorLabelRaw.toUpperCase() : "";
      let resolvedKey: string | null = null;
      let resolvedLabel: string | null = null;
      if (fornecedorLabelRaw) {
        if (isDbPrefixed(fornecedorLabelRaw)) {
          const dbId = canonicalUuid(dbIdFromKey(fornecedorLabelRaw));
          resolvedKey = dbId ? `db:${dbId}` : null;
        } else {
          for (const [k, v] of Object.entries(info)) {
            const label = normalizeLookupKey((v as any)?.fornecedor ?? "");
            if (label && fornecedorLabelLookup && label === fornecedorLabelLookup) {
              resolvedKey = k;
              break;
            }
          }
        }
      }
      if (resolvedKey) {
        const v = (info as any)[resolvedKey];
        const label = normalizeText((v as any)?.fornecedor ?? "");
        if (label) resolvedLabel = label;
      }

      return json(
        {
          ok: true,
          traceId,
          source: "compat",
          readOnly: false,
          ...(diag
            ? {
                diag: {
                  companyId,
                  shouldUseCompat,
                  isAdmin,
                  suppliersDb: (suppliersDb ?? []).length,
                  infoKeys: Object.keys(info).length,
                  linksDb: (linksDb ?? []).length,
                  produtosKeys: Object.keys(produtos).length,
                  distinctSupplierIds: distinctSupplierIds.size,
                  linksSupplierIdMissing,
                  linksSupplierKeyMissing,
                  linksSupplierNotInInfo,
                  linksItemNameMissing,
                  linksSupplierIdSamples,
                  linksNotInInfoSamples,
                  fornecedorLabel: fornecedorLabelRaw || null,
                  fornecedorLabelUpper: fornecedorLabelUpper || null,
                  fornecedorResolvedKey: resolvedKey,
                  fornecedorResolvedLabel: resolvedLabel,
                  fornecedorProdutosLenByResolvedKey: resolvedKey ? (produtos[resolvedKey]?.length ?? 0) : null,
                  fornecedorProdutosLenByUpperLabel: fornecedorLabelUpper ? (produtos[fornecedorLabelUpper]?.length ?? 0) : null,
                },
              }
            : null),
          row: { id, info, produtos, equivalencias },
        },
        { status: 200 },
      );
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
    // Authentication and company scoping are validated above with the user's
    // session. Persist through the service client so an otherwise valid member
    // is not blocked by legacy/incomplete RLS policies on the compat tables.
    const compatDb = (() => {
      try {
        return getSupabaseAdmin();
      } catch {
        return supabase;
      }
    })();

    const infoMap = safeObj(data.info);
    const produtosMap = safeObj(data.produtos);
    const equivMap = safeObj(data.equivalencias);

    const { data: suppliersDb, error: suppliersErr } = await compatDb
      .from("suppliers")
      .select("id,bubble_id,external_key,nome,endereco,vendedor,whatsapp,raw")
      .eq("company_id", companyId)
      .limit(5000);
    if (suppliersErr) return errJson({ status: 500, traceId, stage: "compat.suppliers_select", error: suppliersErr.message, source: "compat" });

      const supplierIdByBubbleId = new Map<string, string>();
      const supplierIdByNameKey = new Map<string, string>();
      const supplierRawById = new Map<string, unknown>();
      const supplierInfoById = new Map<string, { nome: string; endereco: string; vendedor: string; whatsapp: string }>();
      const supplierIdByKeyUpper = new Map<string, string>();
    let defaultSupplierId = "";
    let tombstoneSupplierId = "";
    for (const s of suppliersDb ?? []) {
      const sid = canonicalUuid(String((s as any)?.id ?? ""));
      if (!sid) continue;
      const bubbleId = String((s as any)?.bubble_id ?? "").trim();
      const externalKey = normalizeText((s as any)?.external_key ?? "");
      const nome = normalizeText((s as any)?.nome ?? "");
      const endereco = normalizeText((s as any)?.endereco ?? "");
      const vendedor = normalizeText((s as any)?.vendedor ?? "");
      const whatsapp = normalizeText((s as any)?.whatsapp ?? "");
      const sys = ((s as any)?.raw as any)?.system ?? null;
      const isDefault = externalKey === "supplier:default:sem_fornecedor" || normalizeNameKey(nome) === "sem fornecedor" || Boolean(sys?.default);
      if (isDefault) defaultSupplierId = sid;
      if (nome === TOMBSTONE_KEY) tombstoneSupplierId = sid;
      if (bubbleId) supplierIdByBubbleId.set(bubbleId, sid);
      if (nome) supplierIdByNameKey.set(normalizeLookupKey(nome), sid);
      supplierRawById.set(sid, (s as any)?.raw ?? {});
      supplierInfoById.set(sid, { nome, endereco, vendedor, whatsapp });
      const dbKey = `db:${sid}`;
      supplierIdByKeyUpper.set(dbKey.toUpperCase(), sid);
      if (bubbleId) supplierIdByKeyUpper.set(bubbleId.toUpperCase(), sid);
    }

    const tombstonesUpper = Array.from(new Set(safeArr(produtosMap[TOMBSTONE_KEY]).map(normalizeTombstoneKey).filter(Boolean)));
    const keys = new Set<string>(
      [...Object.keys(infoMap), ...Object.keys(produtosMap), ...Object.keys(equivMap)]
        .map((k) => String(k ?? "").trim())
        .filter((k) => Boolean(k) && k !== TOMBSTONE_KEY),
    );
    const keepKeysUpper = new Set<string>(Array.from(keys).map(normalizeTombstoneKey).filter(Boolean));

    // #region debug-point A:post-compat-payload
    let countHasProdutosKey = 0;
    let countProdutosEmpty = 0;
    let countProdutosOne = 0;
    let maxProdutosLen = 0;
    const emptyKeySamples: string[] = [];
    const oneKeySamples: string[] = [];
    for (const k of keys) {
      const hasProdutosKey = Object.prototype.hasOwnProperty.call(produtosMap, k);
      if (!hasProdutosKey) continue;
      countHasProdutosKey++;
      const produtosLen = safeArr(produtosMap[k]).filter((x) => String(x ?? "").trim()).length;
      if (!produtosLen) {
        countProdutosEmpty++;
        if (emptyKeySamples.length < 5) emptyKeySamples.push(k);
      } else if (produtosLen === 1) {
        countProdutosOne++;
        if (oneKeySamples.length < 5) oneKeySamples.push(k);
      }
      if (produtosLen > maxProdutosLen) maxProdutosLen = produtosLen;
    }
    await __dbgSend({
      hypothesisId: "A",
      traceId,
      location: "app/api/fornecedores/route.ts:POST:compat",
      msg: "[DEBUG] fornecedores POST compat: payload summary",
      data: {
        companyId,
        infoKeys: Object.keys(infoMap).length,
        produtosKeys: Object.keys(produtosMap).length,
        equivKeys: Object.keys(equivMap).length,
        unionKeys: keys.size,
        hasProdutosKey: countHasProdutosKey,
        produtosEmpty: countProdutosEmpty,
        produtosOne: countProdutosOne,
        produtosMax: maxProdutosLen,
        tombstones: safeArr(produtosMap[TOMBSTONE_KEY]).length,
        emptyKeySamples,
        oneKeySamples,
      },
      accessToken,
      companyId,
      supabase,
    });
    // #endregion

    const updatesById = new Map<string, any>();
    const insertsByKey = new Map<string, any>();
    for (const key of keys) {
      const infoRow = safeObj(infoMap[key]);
      const hasFornecedor = Object.prototype.hasOwnProperty.call(infoRow, "fornecedor");
      const hasVendedor = Object.prototype.hasOwnProperty.call(infoRow, "vendedor");
      const hasEndereco = Object.prototype.hasOwnProperty.call(infoRow, "endereco");
      const hasWhatsapp = Object.prototype.hasOwnProperty.call(infoRow, "whatsapp");
      const hasProdutosKey = Object.prototype.hasOwnProperty.call(produtosMap, key);
      const nomeFromInfo = normalizeText((infoRow as any).fornecedor ?? "");
      const nameKey = normalizeLookupKey(nomeFromInfo || key);
      const rawProdutos = safeArr(produtosMap[key])
        .map((x) => normalizeText(x))
        .filter(Boolean);
      const produtos = Array.from(new Set(rawProdutos));
      const equivalencias = typeof equivMap[key] !== "undefined" ? equivMap[key] : undefined;

      let supplierId = "";
      if (isDbPrefixed(key) && isUuid(dbIdFromKey(key))) supplierId = canonicalUuid(dbIdFromKey(key));
      if (!supplierId && isUuid(key)) supplierId = canonicalUuid(key);
      if (!supplierId) supplierId = canonicalUuid(supplierIdByBubbleId.get(key) ?? "");
      if (!supplierId && nameKey) supplierId = canonicalUuid(supplierIdByNameKey.get(nameKey) ?? "");

      const existing = supplierId ? supplierInfoById.get(supplierId) : null;

      const rawBase = supplierId ? supplierRawById.get(supplierId) : {};
      const nextRaw = normalizeFornecedoresRaw(rawBase, { produtos: hasProdutosKey ? produtos : undefined, equivalencias });

      const vendedor = hasVendedor ? normalizeText((infoRow as any).vendedor ?? "") : normalizeText(existing?.vendedor ?? "");
      const endereco = hasEndereco ? normalizeText((infoRow as any).endereco ?? "") : normalizeText(existing?.endereco ?? "");
      const whatsapp = hasWhatsapp ? normalizeText((infoRow as any).whatsapp ?? "") : normalizeText(existing?.whatsapp ?? "");
      const nome =
        nomeFromInfo ||
        normalizeText(existing?.nome ?? "") ||
        (!isDbPrefixed(key) && !isUuid(key) && !hasFornecedor ? normalizeText(key) : "");

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

      if (supplierId) {
        updatesById.set(supplierId, row);
      } else {
        const insertKey = row.bubble_id ? `bubble:${row.bubble_id}` : `name:${normalizeLookupKey(row.nome)}`;
        if (insertKey && !insertsByKey.has(insertKey)) insertsByKey.set(insertKey, row);
      }
    }

    const updates = Array.from(updatesById.values());
    const inserts = Array.from(insertsByKey.values());

    if (updates.length) {
      const { error: upErr } = await compatDb.from("suppliers").upsert(updates as any, { onConflict: "id" });
      if (upErr) return errJson({ status: 500, traceId, stage: "compat.suppliers_upsert", error: upErr.message, source: "compat" });
    }

    if (inserts.length) {
      const { error: insErr } = await compatDb.from("suppliers").insert(inserts as any);
      if (insErr) return errJson({ status: 500, traceId, stage: "compat.suppliers_insert", error: insErr.message, source: "compat" });
    }

    const { data: suppliersDb2, error: suppliersErr2 } = await compatDb
      .from("suppliers")
      .select("id,bubble_id,nome,external_key,raw")
      .eq("company_id", companyId)
      .limit(7000);
    if (suppliersErr2) return errJson({ status: 500, traceId, stage: "compat.suppliers_reselect", error: suppliersErr2.message, source: "compat" });

    const supplierIdByBubbleId2 = new Map<string, string>();
    const supplierIdByNameKey2 = new Map<string, string>();
    const supplierIdByKeyUpper2 = new Map<string, string>();
    for (const s of suppliersDb2 ?? []) {
      const sid = canonicalUuid(String((s as any)?.id ?? ""));
      if (!sid) continue;
      const bubbleId = String((s as any)?.bubble_id ?? "").trim();
      const nome = normalizeText((s as any)?.nome ?? "");
      if (bubbleId) supplierIdByBubbleId2.set(bubbleId, sid);
      if (nome) supplierIdByNameKey2.set(normalizeLookupKey(nome), sid);
      const dbKey = `db:${sid}`;
      supplierIdByKeyUpper2.set(dbKey.toUpperCase(), sid);
      if (bubbleId) supplierIdByKeyUpper2.set(bubbleId.toUpperCase(), sid);
    }

    if (tombstonesUpper.length || tombstoneSupplierId) {
      const db = (() => {
        try {
          return getSupabaseAdmin();
        } catch {
          return supabase;
        }
      })();
      let tombId = tombstoneSupplierId;
      if (!tombId) {
        const { data: tombSupplierDb } = await db
          .from("suppliers")
          .select("id,raw")
          .eq("company_id", companyId)
          .eq("nome", TOMBSTONE_KEY)
          .limit(1)
          .maybeSingle();
        tombId = canonicalUuid(String((tombSupplierDb as any)?.id ?? ""));
      }
      if (!tombId) {
        const { data: ins, error: insErr } = await db
          .from("suppliers")
          .insert({
            company_id: companyId,
            external_key: "supplier:system:tombstones",
            nome: TOMBSTONE_KEY,
            endereco: "",
            vendedor: "",
            whatsapp: "",
            bubble_id: null,
            raw: { system: {} },
          } as any)
          .select("id")
          .limit(1)
          .maybeSingle();
        if (insErr) {
          const { data: tombSupplierDb } = await db
            .from("suppliers")
            .select("id")
            .eq("company_id", companyId)
            .eq("nome", TOMBSTONE_KEY)
            .limit(1)
            .maybeSingle();
          tombId = canonicalUuid(String((tombSupplierDb as any)?.id ?? ""));
        } else {
          tombId = canonicalUuid(String((ins as any)?.id ?? ""));
        }
      }
      if (tombId) {
        const { data: tombSupplierDb } = await db
          .from("suppliers")
          .select("raw")
          .eq("company_id", companyId)
          .eq("id", tombId)
          .limit(1)
          .maybeSingle();
        const rawBase = (tombSupplierDb as any)?.raw ?? supplierRawById.get(tombId) ?? {};
        const nextRaw = withCompatTombstonesRaw(rawBase, tombstonesUpper);
        const { error: defErr } = await db.from("suppliers").update({ raw: nextRaw } as any).eq("company_id", companyId).eq("id", tombId);
        if (defErr) return errJson({ status: 500, traceId, stage: "compat.suppliers_update_tombstones_raw", error: defErr.message, source: "compat" });
      }
    }

    const deleteCandidateIds = new Set<string>();
    for (const kUpper of tombstonesUpper) {
      if (!kUpper || keepKeysUpper.has(kUpper)) continue;
      let supplierId = "";
      if (isDbPrefixed(kUpper) && isUuid(dbIdFromKey(kUpper))) supplierId = canonicalUuid(dbIdFromKey(kUpper));
      else if (isUuid(kUpper)) supplierId = canonicalUuid(kUpper);
      else supplierId = canonicalUuid(supplierIdByKeyUpper.get(kUpper) ?? "");
      if (!supplierId || supplierId === defaultSupplierId) continue;
      deleteCandidateIds.add(supplierId);
    }

    const deleteIds = Array.from(deleteCandidateIds).filter(Boolean);
    if (deleteIds.length) {
      const { error: linkDelErr } = await compatDb.from("supplier_items").delete().eq("company_id", companyId).in("supplier_id", deleteIds);
      if (linkDelErr) return errJson({ status: 500, traceId, stage: "compat.supplier_items_delete", error: linkDelErr.message, source: "compat" });
      const { error: supplierDelErr } = await compatDb.from("suppliers").delete().eq("company_id", companyId).in("id", deleteIds);
      if (supplierDelErr) return errJson({ status: 500, traceId, stage: "compat.suppliers_delete", error: supplierDelErr.message, source: "compat" });
    }

    const supplierProductsById = new Map<string, string[]>();
    for (const key of keys) {
      const hasProdutosKey = Object.prototype.hasOwnProperty.call(produtosMap, key);
      if (!hasProdutosKey) continue;
      const rawProdutos = safeArr(produtosMap[key])
        .map((x) => normalizeText(x))
        .filter(Boolean);
      const produtos = Array.from(new Set(rawProdutos));
      const nameKey = normalizeLookupKey(normalizeText(safeObj(infoMap[key]).fornecedor ?? "") || key);

      let supplierId = "";
      if (isDbPrefixed(key) && isUuid(dbIdFromKey(key))) supplierId = canonicalUuid(dbIdFromKey(key));
      if (!supplierId && isUuid(key)) supplierId = canonicalUuid(key);
      if (!supplierId) supplierId = canonicalUuid(supplierIdByBubbleId2.get(key) ?? "");
      if (!supplierId && nameKey) supplierId = canonicalUuid(supplierIdByNameKey2.get(nameKey) ?? "");
      if (!supplierId) supplierId = canonicalUuid(supplierIdByKeyUpper2.get(normalizeTombstoneKey(key)) ?? "");

      if (!supplierId) continue;
      supplierProductsById.set(supplierId, produtos);
    }

    const supplierIdsForSync = Array.from(supplierProductsById.keys()).filter(Boolean);
    if (supplierIdsForSync.length) {
      const { data: itemsDb, error: itemsErr } = await compatDb.from("items").select("id,name").eq("company_id", companyId).limit(12000);
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

      const desiredByKey = new Map<string, { company_id: string; supplier_id: string; item_id: string }>();
      const missing: string[] = [];
      for (const [supplierId, produtos] of supplierProductsById.entries()) {
        if (!produtos.length) continue;
        for (const nome of produtos) {
          const itemId = itemIdByKey.get(normalizeLookupKey(nome)) ?? "";
          if (!itemId) {
            if (missing.length < 12) missing.push(nome);
            continue;
          }
          const k = `${supplierId}:${itemId}`;
          if (!desiredByKey.has(k)) desiredByKey.set(k, { company_id: companyId, supplier_id: supplierId, item_id: itemId });
        }
      }
      const desiredRows = Array.from(desiredByKey.values());

      // #region debug-point B:post-compat-link-plan
      await __dbgSend({
        hypothesisId: "B",
        traceId,
        location: "app/api/fornecedores/route.ts:POST:compat:links",
        msg: "[DEBUG] fornecedores POST compat: link plan",
        data: {
          companyId,
          supplierIdsForSync: supplierIdsForSync.length,
          desiredRows: desiredRows.length,
          missing: missing.length,
          missingSample: missing.slice(0, 5),
        },
        accessToken,
        companyId,
        supabase,
      });
      // #endregion

      // Preserve unresolved legacy labels in suppliers.raw, but do not abort
      // the entire supplier save. Only resolvable labels become relational
      // supplier_items links.

      const supplierIdsToClear = supplierIdsForSync.filter((sid) => !(supplierProductsById.get(sid)?.length ?? 0));
      if (supplierIdsToClear.length) {
        // #region debug-point B:post-compat-clear
        await __dbgSend({
          hypothesisId: "B",
          traceId,
          location: "app/api/fornecedores/route.ts:POST:compat:clear",
          msg: "[DEBUG] fornecedores POST compat: clearing supplier_items",
          data: { companyId, supplierIdsToClear: supplierIdsToClear.length },
          accessToken,
          companyId,
          supabase,
        });
        // #endregion
        const { error: clearErr } = await compatDb.from("supplier_items").delete().eq("company_id", companyId).in("supplier_id", supplierIdsToClear);
        if (clearErr) return errJson({ status: 500, traceId, stage: "compat.supplier_items_clear", error: clearErr.message, source: "compat" });
      }

      if (desiredRows.length) {
        const { error: linkInsErr } = await compatDb
          .from("supplier_items")
          .upsert(desiredRows as any, { onConflict: "company_id,supplier_id,item_id", ignoreDuplicates: true });
        if (linkInsErr) return errJson({ status: 500, traceId, stage: "compat.supplier_items_insert", error: linkInsErr.message, source: "compat" });
      }
    }

    // #region debug-point C:post-compat-ok
    await __dbgSend({
      hypothesisId: "C",
      traceId,
      location: "app/api/fornecedores/route.ts:POST:compat:done",
      msg: "[DEBUG] fornecedores POST compat: ok",
      data: { companyId, ok: true },
      accessToken,
      companyId,
      supabase,
    });
    // #endregion

    return json({ ok: true, traceId }, { status: 200 });
  } catch (err) {
    return errJson({ status: 500, traceId, stage: "post.exception", error: err });
  }
}
