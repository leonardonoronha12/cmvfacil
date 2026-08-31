import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "../../../../lib/requestUserId";
import { getSupabaseAdmin } from "../../../../lib/supabaseAdmin";
import { fetchBubbleObjPageWithConstraints, getBubbleObjCredentials } from "../../../../lib/bubbleObjApi";
import {
  buildDesperdicioId,
  buildEntradaId,
  buildInsumoId,
  buildInventarioId,
  isCountableFinalBaseType,
  isDerivedBaseType,
  isScopeOnlyBaseType,
  isStagedOnlyBaseType,
  mapCustoMedioItem,
  mapDesperdicio,
  mapInventario,
  mapItemInventario,
  mapItemToInsumo,
  mapItemNota,
  mapNotaFiscal,
  parseObjectType,
  userScopedId,
} from "../../../../lib/bubbleObjRealMapping";
import { parsePtNumber } from "../../../../lib/bubbleCsv";
import { requireSystemAdmin } from "../../../../lib/systemAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Large legacy tenants can have thousands of invoices and inventory rows.
// Validation is an admin-only background operation, so allow it to finish
// instead of returning a false failure at the default 30-second boundary.
export const maxDuration = 120;

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return NextResponse.json(data, { ...init, headers });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function nowIso() {
  return new Date().toISOString();
}

function looksLikeTechnicalId(value: unknown) {
  const s = String(value ?? "").trim();
  if (!s) return false;
  if (s.startsWith("user:")) return true;
  if (/\d{8,}x\d{6,}/.test(s)) return true;
  return false;
}

function scopeObjectType(userId: string, objectType: string) {
  const base = String(objectType ?? "").trim();
  if (!base) return "";
  return base.includes("#") ? base : `${base}#${userId}`;
}

function readJsonObjectEnv(name: string) {
  const raw = String(process.env[name] ?? "").trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readStringArrayEnv(name: string) {
  const raw = String(process.env[name] ?? "").trim();
  if (!raw) return null;
  const list = raw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  return list.length ? list : null;
}

function isUserTypeName(typeName: string) {
  const t = String(typeName ?? "").trim().toLowerCase();
  return t === "user" || t === "users" || t === "usuario" || t === "usuarios" || t === "usuário" || t === "usuários";
}

function constraintKeysForType(objectType: string) {
  const byType = readJsonObjectEnv("BUBBLE_OBJ_USER_CONSTRAINT_KEYS_BY_TYPE");
  const lower = String(objectType ?? "").trim().toLowerCase();
  const fromType = byType ? (byType[lower] as unknown) : null;
  const fromTypeList = Array.isArray(fromType) ? (fromType as any[]).map((x) => String(x ?? "").trim()).filter(Boolean) : null;
  if (fromTypeList && fromTypeList.length) return fromTypeList;
  const global = readStringArrayEnv("BUBBLE_OBJ_USER_CONSTRAINT_KEYS");
  if (global && global.length) return global;
  return [
    "Created By",
    "created_by",
    "criado_por",
    "owner",
    "Owner",
    "usuario",
    "usuário",
    "user",
    "User",
    "usuario_id",
    "user_id",
    "bubble_user_id",
    "responsavel_id",
  ];
}

function isConstraintKeyRejected(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  if (!msg.startsWith("bubble_400:")) return false;
  const lower = msg.toLowerCase();
  return lower.includes("constraint") || lower.includes("constraints") || lower.includes("key") || lower.includes("field");
}

async function countBubbleUserScoped(args: { creds: Awaited<ReturnType<typeof getBubbleObjCredentials>>; objectType: string; bubbleUserId: string; email: string }) {
  const { creds, objectType, bubbleUserId, email } = args;
  const parsed = parseObjectType(objectType);
  const baseType = String(parsed.baseType ?? "").trim();

  if (isUserTypeName(baseType)) {
    const e = String(email ?? "").trim().toLowerCase();
    if (!e) return { total: null as number | null, scopedBy: "none" as const };
    const page = await fetchBubbleObjPageWithConstraints<any>({
      creds,
      type: baseType,
      cursor: 0,
      limit: 1,
      constraints: [{ key: "email", constraint_type: "equals", value: e }],
    });
    const remaining = typeof page.remaining === "number" ? page.remaining : null;
    return { total: remaining == null ? null : page.results.length + Math.max(0, remaining), scopedBy: "email" as const };
  }

  if (String(baseType).trim().toLowerCase() === "empresas") {
    const keys = ["lista_usuarios", "lista_de_usuarios", "usuarios", "users", "lista_usuarios_ids", "usuarios_ids", "lista_users", "lista_user"];
    let lastErr: unknown = null;
    for (const key of keys) {
      try {
        const page = await fetchBubbleObjPageWithConstraints<any>({
          creds,
          type: baseType,
          cursor: 0,
          limit: 1,
          constraints: [{ key, constraint_type: "contains", value: bubbleUserId }],
        });
        const remaining = typeof page.remaining === "number" ? page.remaining : null;
        return { total: remaining == null ? null : page.results.length + Math.max(0, remaining), scopedBy: key };
      } catch (err) {
        lastErr = err;
        if (isConstraintKeyRejected(err)) continue;
        throw err;
      }
    }
    const details = lastErr instanceof Error ? lastErr.message : String(lastErr ?? "");
    throw new Error(`unable_to_scope_query_for_type:${String(baseType ?? "")}:${details}`);
  }

  if (parsed.companyId) {
    const keys = ["empresa_id", "empresa", "company_id", "company", "restaurante_id", "restaurante"];
    let lastErr: unknown = null;
    for (const key of keys) {
      try {
        const page = await fetchBubbleObjPageWithConstraints<any>({
          creds,
          type: baseType,
          cursor: 0,
          limit: 1,
          constraints: [{ key, constraint_type: "equals", value: parsed.companyId }],
        });
        const remaining = typeof page.remaining === "number" ? page.remaining : null;
        return { total: remaining == null ? null : page.results.length + Math.max(0, remaining), scopedBy: key };
      } catch (err) {
        lastErr = err;
        if (isConstraintKeyRejected(err)) continue;
        throw err;
      }
    }
    const details = lastErr instanceof Error ? lastErr.message : String(lastErr ?? "");
    throw new Error(`unable_to_scope_query_for_type:${String(baseType ?? "")}:${details}`);
  }

  const keys = constraintKeysForType(baseType);
  let lastErr: unknown = null;
  for (const key of keys) {
    try {
      const page = await fetchBubbleObjPageWithConstraints<any>({
        creds,
        type: baseType,
        cursor: 0,
        limit: 1,
        constraints: [{ key, constraint_type: "equals", value: bubbleUserId }],
      });
      const remaining = typeof page.remaining === "number" ? page.remaining : null;
      return { total: remaining == null ? null : page.results.length + Math.max(0, remaining), scopedBy: key };
    } catch (err) {
      lastErr = err;
      if (isConstraintKeyRejected(err)) continue;
      throw err;
    }
  }

  const details = lastErr instanceof Error ? lastErr.message : String(lastErr ?? "");
  throw new Error(`unable_to_scope_query_for_type:${String(baseType ?? "")}:${details}`);
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as any;
    const session = getUserIdFromRequest(req);
    const adminTargetUserId = String(body?.adminTargetUserId ?? "").trim();
    let userId = String(session.userId ?? "").trim();
    if (adminTargetUserId) {
      if (!isUuid(adminTargetUserId)) return json({ ok: false, error: "invalid_admin_target_user" }, { status: 400 });
      const admin = await requireSystemAdmin(req);
      if (!admin.ok) return json({ ok: false, error: admin.error }, { status: admin.status });
      userId = adminTargetUserId;
    }
    if (!userId || !isUuid(userId)) return json({ ok: false, error: "unauthorized" }, { status: 401 });

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    const { data: mig, error: migErr } = await supabase.from("bubble_obj_user_migration").select("*").eq("supabase_user_id", userId).maybeSingle();
    if (migErr) return json({ ok: false, error: migErr.message }, { status: 500 });
    if (!mig) return json({ ok: true, status: "skipped", reason: "not_started" }, { status: 200 });

    const migration = mig as any;
    const status = String(migration.status ?? "");
    const runId = migration.last_run_id ? String(migration.last_run_id) : "";
    const email = String(migration.email ?? "").trim().toLowerCase();
    const bubbleUserId = String(migration.bubble_user_id ?? "").trim();
    if (!runId) return json({ ok: true, status: "skipped", reason: "missing_run_id" }, { status: 200 });

    if (status !== "completed") {
      const { error: updErr } = await supabase
        .from("bubble_obj_user_migration")
        .update({ validation_status: "skipped", validation_report: { reason: "migration_not_completed", status }, validated_at: nowIso() } as any)
        .eq("supabase_user_id", userId);
      if (updErr) return json({ ok: false, error: updErr.message }, { status: 500 });
      return json({ ok: true, status: "skipped", reason: "migration_not_completed" }, { status: 200 });
    }

    const { data: attempt, error: attemptErr } = await supabase
      .from("bubble_obj_user_migration_attempt")
      .select("id")
      .eq("supabase_user_id", userId)
      .eq("run_id", runId)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (attemptErr) return json({ ok: false, error: attemptErr.message }, { status: 500 });
    const attemptId = attempt ? String((attempt as any).id ?? "").trim() : "";

    const { error: migRunningErr } = await supabase
      .from("bubble_obj_user_migration")
      .update({ validation_status: "running", validated_at: null } as any)
      .eq("supabase_user_id", userId);
    if (migRunningErr) return json({ ok: false, error: migRunningErr.message }, { status: 500 });
    if (attemptId) {
      const { error: attRunningErr } = await supabase
        .from("bubble_obj_user_migration_attempt")
        .update({ validation_status: "running", validated_at: null } as any)
        .eq("id", attemptId);
      if (attRunningErr) return json({ ok: false, error: attRunningErr.message }, { status: 500 });
    }

    const creds = await getBubbleObjCredentials();
    const { data: items, error: itemsErr } = await supabase
      .from("bubble_obj_import_run_item")
      .select("object_type,status,total_received,total_saved_staging,total_processed,total_pending_review,total_error,total_duplicate_ignored")
      .eq("run_id", runId)
      .eq("supabase_user_id", userId)
      .order("object_type", { ascending: true });
    if (itemsErr) return json({ ok: false, error: itemsErr.message }, { status: 500 });
    const list = (items ?? []) as any[];

    const perType: any[] = [];
    let hasDiff = false;
    let ignoredCount = 0;

    const groups = new Map<
      string,
      {
        baseType: string;
        objectTypes: string[];
        runItem: { status: string; received: number; savedStaging: number; processed: number; duplicateIgnored: number; pendingReview: number; error: number };
      }
    >();

    for (const it of list) {
      const objectType = String(it.object_type ?? "").trim();
      if (!objectType) continue;
      const baseType = String(parseObjectType(objectType).baseType ?? "").trim().toLowerCase();
      if (!baseType) continue;

      const got = groups.get(baseType) ?? {
        baseType,
        objectTypes: [],
        runItem: { status: "", received: 0, savedStaging: 0, processed: 0, duplicateIgnored: 0, pendingReview: 0, error: 0 },
      };
      got.objectTypes.push(objectType);
      got.runItem.received += Number(it.total_received ?? 0) || 0;
      got.runItem.savedStaging += Number(it.total_saved_staging ?? 0) || 0;
      got.runItem.processed += Number(it.total_processed ?? 0) || 0;
      got.runItem.duplicateIgnored += Number(it.total_duplicate_ignored ?? 0) || 0;
      got.runItem.pendingReview += Number(it.total_pending_review ?? 0) || 0;
      got.runItem.error += Number(it.total_error ?? 0) || 0;
      const st = String(it.status ?? "");
      got.runItem.status = got.runItem.status && got.runItem.status !== st ? "mixed" : st || got.runItem.status;
      groups.set(baseType, got);
    }

    const stateId = userScopedId(userId).slice(0, -1);
    const insumosDb = await supabase.from("insumos_state").select("payload").eq("id", stateId).maybeSingle();
    const insumosDbError = insumosDb.error ? insumosDb.error.message : "";
    const insumosRows = Array.isArray((insumosDb.data as any)?.payload?.rows) ? (((insumosDb.data as any).payload.rows as any[]) ?? []) : [];
    const fornecedoresDb = await supabase.from("fornecedores_state").select("info").eq("id", stateId).maybeSingle();
    const fornecedoresDbError = fornecedoresDb.error ? fornecedoresDb.error.message : "";
    const fornecedoresInfo = ((fornecedoresDb.data as any)?.info as any) || {};
    const fornecedoresUnique = (() => {
      if (fornecedoresDbError) return 0;
      if (!fornecedoresInfo || typeof fornecedoresInfo !== "object") return 0;
      const set = new Set<string>();
      for (const v of Object.values(fornecedoresInfo as Record<string, any>)) {
        const nome = String((v as any)?.fornecedor ?? "").trim().toUpperCase();
        if (nome) set.add(nome);
      }
      return set.size;
    })();

    const invPrefix = `${userScopedId(userId)}inventario:`.replace(/:+$/, ":");
    const entPrefix = `${userScopedId(userId)}entrada:`.replace(/:+$/, ":");
    const despPrefix = `${userScopedId(userId)}desperdicio:`.replace(/:+$/, ":");

    const countLike = async (table: string, prefix: string) => {
      const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true }).like("id", `${prefix}%`);
      if (error) return { total: null as number | null, error: error.message };
      return { total: typeof count === "number" ? count : null, error: "" };
    };

    const invCount = await countLike("inventario", invPrefix);
    const entCount = await countLike("entradas", entPrefix);
    const despCount = await countLike("desperdicios", despPrefix);

    const orderedBases = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b));
    for (const baseType of orderedBases) {
      const g = groups.get(baseType)!;
      const objectTypes = Array.from(new Set(g.objectTypes)).sort((a, b) => a.localeCompare(b));

      const mappingStatus = isScopeOnlyBaseType(baseType)
        ? "scope_only"
        : isStagedOnlyBaseType(baseType)
          ? "staged_only"
          : isDerivedBaseType(baseType)
            ? "derived"
            : isCountableFinalBaseType(baseType)
              ? "final"
              : "unknown";

      let bubbleTotal: number | null = null;
      let bubbleScopedBy: string | null = null;
      let bubbleError = "";
      if (mappingStatus === "final") {
        let sum = 0;
        let hasNull = false;
        let scopedBy = "";
        for (const ot of objectTypes) {
          try {
            const counted = await countBubbleUserScoped({ creds, objectType: ot, bubbleUserId, email });
            if (counted.total == null) {
              hasNull = true;
              break;
            }
            sum += counted.total;
            if (!scopedBy) scopedBy = typeof counted.scopedBy === "string" ? counted.scopedBy : String(counted.scopedBy);
          } catch (err) {
            bubbleError = err instanceof Error ? err.message : String(err);
            hasNull = true;
            break;
          }
        }
        bubbleTotal = hasNull ? null : sum;
        bubbleScopedBy = scopedBy || null;
      }

      let dbTotal: number | null = null;
      let dbError = "";
      if (mappingStatus === "final") {
        if (baseType === "item") {
          dbTotal = insumosDbError ? null : insumosRows.length;
          dbError = insumosDbError;
        } else if (baseType === "fornecedores") {
          dbTotal = fornecedoresDbError ? null : fornecedoresUnique;
          dbError = fornecedoresDbError;
          // fornecedores_state is keyed by the display name because the UI
          // intentionally consolidates duplicate supplier records from
          // Bubble. Count that same semantic identity on the source side,
          // while keeping unnamed records unique through their Bubble id.
          const sourceSupplierKeys = new Set<string>();
          for (const ot of objectTypes) {
            const { data, error } = await supabase
              .from("bubble_obj_import_control")
              .select("bubble_unique_id,raw_payload_json")
              .eq("supabase_user_id", userId)
              .eq("bubble_object_type", ot)
              .in("status", ["staged", "processed", "staged_only"])
              .limit(50_000);
            if (error) {
              dbError = error.message;
              break;
            }
            for (const row of data ?? []) {
              const raw = (row as any)?.raw_payload_json ?? {};
              const name = String(raw?.nome ?? "").replace(/\s+/g, " ").trim().toLocaleUpperCase("pt-BR");
              const sourceId = String((row as any)?.bubble_unique_id ?? "").trim();
              if (name) sourceSupplierKeys.add(name);
              else if (sourceId) sourceSupplierKeys.add(`__SEM_NOME__:${sourceId}`);
            }
          }
          if (!dbError) bubbleTotal = sourceSupplierKeys.size;
        }
        else if (baseType === "inventarios") {
          dbTotal = invCount.total;
          dbError = invCount.error;
        } else if (baseType === "notas_fiscais") {
          dbTotal = entCount.total;
          dbError = entCount.error;
        } else if (baseType === "desperdicio") {
          dbTotal = despCount.total;
          dbError = despCount.error;
        }
      }

      const diff = bubbleTotal != null && dbTotal != null ? bubbleTotal - dbTotal : null;
      const ok =
        mappingStatus !== "final"
          ? true
          : (() => {
              if (bubbleTotal == null || dbTotal == null) return false;
              if (bubbleError || dbError) return false;
              if (baseType === "inventarios") return diff != null && diff <= 0;
              return diff === 0;
            })();
      if (!ok && mappingStatus === "final") hasDiff = true;
      if (mappingStatus === "staged_only" || mappingStatus === "derived" || mappingStatus === "scope_only") ignoredCount += 1;

      perType.push({
        objectType: baseType,
        objectTypes,
        mappingStatus,
        runItem: g.runItem,
        bubble: { total: bubbleTotal, scopedBy: bubbleScopedBy, error: bubbleError },
        db: { table: mappingStatus === "final" ? `cmv:${baseType}` : null, total: dbTotal, error: dbError },
        diff,
        ok,
        ignored: mappingStatus !== "final" ? mappingStatus : null,
      });
    }

    const companyId =
      (list ?? []).map((x: any) => parseObjectType(String(x?.object_type ?? "")).companyId).find((x: any) => typeof x === "string" && String(x).trim()) ?? null;

    const contentValidation = {
      ok: true,
      companyId,
      mismatches: [] as any[],
      checked: { items: 0, custos: 0, inventarioItems: 0, notas: 0, desperdicios: 0, fichasTecnicas: 0, prePreparos: 0 },
    };

    if (companyId) {
      const loadControl = async (baseType: string, limit: number) => {
        const key = scopeObjectType(userId, `${baseType}@${companyId}`);
        const out: any[] = [];
        const pageSize = 1000;
        for (let from = 0; from < limit; from += pageSize) {
          const to = Math.min(limit - 1, from + pageSize - 1);
          const { data, error } = await supabase
            .from("bubble_obj_import_control")
            .select("bubble_unique_id,raw_payload_json,status")
            .eq("supabase_user_id", userId)
            .eq("bubble_object_type", key)
            .in("status", ["staged", "processed", "staged_only"])
            .order("bubble_unique_id", { ascending: true })
            .range(from, to);
          if (error) throw new Error(error.message);
          const rows = (data ?? []) as any[];
          out.push(...rows);
          if (rows.length < pageSize) break;
        }
        return out;
      };

      const insumoById = new Map<string, any>(insumosRows.map((r: any) => [String(r?.id ?? ""), r]));

      const categoriasControl = await loadControl("categorias", 200).catch(() => []);
      const categoriaNameById: Record<string, string> = {};
      for (const r of categoriasControl) {
        const id = String((r as any)?.bubble_unique_id ?? "").trim();
        if (!id) continue;
        const raw = (r as any)?.raw_payload_json ?? {};
        const nome = String(raw?.nome ?? raw?.name ?? raw?.titulo ?? "").trim();
        if (nome) categoriaNameById[id] = nome;
      }

      const itemControl = await loadControl("item", 50_000).catch(() => []);
      const sourceItemCostByBubbleId = new Map<string, number>();
      const sourceItemNameByBubbleId = new Map<string, string>();
      for (const r of itemControl) {
        const raw = (r as any)?.raw_payload_json ?? {};
        const mapped = mapItemToInsumo(raw, { userId, categoriaNameById });
        if (!mapped.ok || !mapped.bubbleItemId) continue;
        const sourceCost = parsePtNumber(String(mapped.insumo.custoMedio ?? ""));
        if (sourceCost > 0) sourceItemCostByBubbleId.set(mapped.bubbleItemId, sourceCost);
        sourceItemNameByBubbleId.set(mapped.bubbleItemId, String(mapped.insumo.item ?? "").trim());
        const dbRow = insumoById.get(mapped.insumo.id) ?? null;
        contentValidation.checked.items += 1;
        if (!dbRow) {
          contentValidation.mismatches.push({ baseType: "item", bubbleId: mapped.bubbleItemId, kind: "missing_in_db", expected: mapped.insumo, actual: null });
          continue;
        }
        const dbItem = String((dbRow as any)?.item ?? "").trim();
        const dbMedida = String((dbRow as any)?.medida ?? "").trim();
        const dbCategoria = String((dbRow as any)?.categoria ?? "").trim();
        if (!dbItem || looksLikeTechnicalId(dbItem)) {
          contentValidation.mismatches.push({ baseType: "item", bubbleId: mapped.bubbleItemId, kind: "bad_item_label", expected: mapped.insumo.item, actual: dbItem });
        }
        if (mapped.insumo.medida && dbMedida && mapped.insumo.medida !== dbMedida) {
          contentValidation.mismatches.push({ baseType: "item", bubbleId: mapped.bubbleItemId, kind: "medida_mismatch", expected: mapped.insumo.medida, actual: dbMedida });
        }
        if (mapped.insumo.categoria && dbCategoria && mapped.insumo.categoria !== dbCategoria) {
          contentValidation.mismatches.push({ baseType: "item", bubbleId: mapped.bubbleItemId, kind: "categoria_mismatch", expected: mapped.insumo.categoria, actual: dbCategoria });
        }
      }

      const truthy = (value: unknown) => ["1", "true", "sim", "yes"].includes(String(value ?? "").trim().toLowerCase());
      const expectedFichaIds = new Set<string>();
      const expectedPreIds = new Set<string>();
      for (const row of itemControl) {
        const raw = (row as any)?.raw_payload_json ?? {};
        if (!truthy((raw as any)?.boolean_item_receita)) continue;
        const id = String((row as any)?.bubble_unique_id ?? (raw as any)?._id ?? "").trim();
        if (!id) continue;
        if (truthy((raw as any)?.boolean_item_do_cardapio)) expectedFichaIds.add(id);
        else expectedPreIds.add(id);
      }
      const [fichaState, preState] = await Promise.all([
        supabase.from("fichas_tecnicas_state").select("payload").eq("id", stateId).maybeSingle(),
        supabase.from("pre_preparo_state").select("payload").eq("id", stateId).maybeSingle(),
      ]);
      const fichaRows = Array.isArray((fichaState.data as any)?.payload) ? (((fichaState.data as any).payload ?? []) as any[]) : [];
      const preRows = Array.isArray((preState.data as any)?.payload) ? (((preState.data as any).payload ?? []) as any[]) : [];
      const fichaIds = new Set(fichaRows.map((row: any) => String(row?.id ?? "").trim()).filter(Boolean));
      const preIds = new Set(preRows.map((row: any) => String(row?.id ?? "").trim()).filter(Boolean));
      contentValidation.checked.fichasTecnicas = expectedFichaIds.size;
      contentValidation.checked.prePreparos = expectedPreIds.size;
      for (const id of expectedFichaIds) {
        if (!fichaIds.has(id)) contentValidation.mismatches.push({ baseType: "item", bubbleId: id, kind: "missing_ficha_tecnica", expected: "fichas_tecnicas_state", actual: null });
      }
      for (const id of expectedPreIds) {
        if (!preIds.has(id)) contentValidation.mismatches.push({ baseType: "item", bubbleId: id, kind: "missing_pre_preparo", expected: "pre_preparo_state", actual: null });
      }
      if (fichaRows.length !== expectedFichaIds.size)
        contentValidation.mismatches.push({ baseType: "item", kind: "fichas_tecnicas_count_mismatch", expected: expectedFichaIds.size, actual: fichaRows.length });
      if (preRows.length !== expectedPreIds.size)
        contentValidation.mismatches.push({ baseType: "item", kind: "pre_preparo_count_mismatch", expected: expectedPreIds.size, actual: preRows.length });

      const bubbleIdFromInsumoId = (id: string) => {
        const raw = String(id ?? "").trim();
        if (!raw) return "";
        const idx = raw.indexOf("insumo:");
        if (idx < 0) return "";
        return raw.slice(idx + "insumo:".length).trim();
      };

      const sampleBubbleItemIds = Array.from(insumoById.keys())
        .map((id) => bubbleIdFromInsumoId(id))
        .filter(Boolean);
      const custoControl = await loadControl("custo_medio_item", 50_000).catch(() => []);
      const latestCostByItem = new Map<string, { raw: any; launchedAt: number; updatedAt: number }>();
      for (const row of custoControl) {
        const raw = (row as any)?.raw_payload_json ?? {};
        const mapped = mapCustoMedioItem(raw);
        const bubbleItemId = String(mapped.bubbleItemId ?? "").trim();
        if (!bubbleItemId) continue;
        const launchedAt = Date.parse(String((raw as any)?.data_lancamento ?? "")) || 0;
        const updatedAt = Date.parse(String((raw as any)?.["Modified Date"] ?? (raw as any)?.["Created Date"] ?? "")) || 0;
        const previous = latestCostByItem.get(bubbleItemId);
        if (!previous || launchedAt > previous.launchedAt || (launchedAt === previous.launchedAt && updatedAt > previous.updatedAt)) {
          latestCostByItem.set(bubbleItemId, { raw, launchedAt, updatedAt });
        }
      }

      for (const bubbleItemId of sampleBubbleItemIds) {
        contentValidation.checked.custos += 1;
        const insumoId = buildInsumoId(userId, bubbleItemId);
        const dbRow = insumoById.get(insumoId) ?? null;
        if (!dbRow) continue;
        const dbCostRaw = String((dbRow as any)?.custoMedio ?? "").trim();
        const dbCost = parsePtNumber(dbCostRaw);

        const rawLatest = latestCostByItem.get(bubbleItemId)?.raw ?? null;
        const cm = rawLatest ? mapCustoMedioItem(rawLatest) : null;
        // The Item record is Bubble's current value. custo_medio_item is a
        // historical ledger and is only a fallback when Item has no cost.
        const expectedCost = sourceItemCostByBubbleId.get(bubbleItemId) ?? (cm?.custoMedio ? parsePtNumber(cm.custoMedio) : 0);

        if (expectedCost && !dbCost) {
          contentValidation.mismatches.push({ baseType: "custo_medio_item", bubbleId: bubbleItemId, kind: "missing_cost", expected: expectedCost, actual: null });
          continue;
        }
        if (expectedCost && dbCost) {
          const tol = Math.max(1.0, expectedCost * 0.2);
          if (Math.abs(dbCost - expectedCost) > tol) {
            contentValidation.mismatches.push({ baseType: "custo_medio_item", bubbleId: bubbleItemId, kind: "cost_mismatch", expected: expectedCost, actual: dbCost });
          }
        }
      }

      const invItemControlRaw = await loadControl("itens_inventarios", 50_000).catch(() => []);
      const latestInvItemByKey = new Map<string, any>();
      for (const row of invItemControlRaw) {
        const raw = (row as any)?.raw_payload_json ?? {};
        const mapped = mapItemInventario(raw);
        if (!mapped.bubbleInventarioId || !mapped.bubbleItemId) continue;
        const key = `${mapped.bubbleInventarioId}:${mapped.bubbleItemId}`;
        const updatedAt = Date.parse(String((raw as any)?.["Modified Date"] ?? (raw as any)?.["Created Date"] ?? "")) || 0;
        const previous = latestInvItemByKey.get(key) ?? null;
        const previousRaw = (previous as any)?.raw_payload_json ?? {};
        const previousUpdatedAt = Date.parse(String((previousRaw as any)?.["Modified Date"] ?? (previousRaw as any)?.["Created Date"] ?? "")) || 0;
        const createdAt = Date.parse(String((raw as any)?.["Created Date"] ?? "")) || 0;
        const previousCreatedAt = Date.parse(String((previousRaw as any)?.["Created Date"] ?? "")) || 0;
        const sourceId = String((row as any)?.bubble_unique_id ?? (raw as any)?._id ?? "");
        const previousSourceId = String((previous as any)?.bubble_unique_id ?? (previousRaw as any)?._id ?? "");
        const nextHasValue = Boolean(String(mapped.estoqueFinal ?? "").trim());
        const previousMapped = previous ? mapItemInventario(previousRaw) : null;
        const previousHasValue = Boolean(String(previousMapped?.estoqueFinal ?? "").trim());
        if (
          !previous ||
          updatedAt > previousUpdatedAt ||
          (updatedAt === previousUpdatedAt && createdAt > previousCreatedAt) ||
          (updatedAt === previousUpdatedAt && createdAt === previousCreatedAt && sourceId > previousSourceId) ||
          (updatedAt === previousUpdatedAt && createdAt === previousCreatedAt && sourceId === previousSourceId && nextHasValue && !previousHasValue)
        ) latestInvItemByKey.set(key, row);
      }
      const invItemControl = Array.from(latestInvItemByKey.values());
      const invIdsToLoad = Array.from(
        new Set(
          invItemControl
            .map((r: any) => {
              const it = mapItemInventario((r as any)?.raw_payload_json ?? {});
              if (!it.bubbleInventarioId) return "";
              return buildInventarioId(userId, it.bubbleInventarioId);
            })
            .filter(Boolean),
        ),
      );
      const { data: invRowsDb } = invIdsToLoad.length
        ? await supabase.from("inventario").select("id,categorias").in("id", invIdsToLoad).limit(50)
        : await supabase.from("inventario").select("id,categorias").like("id", `${invPrefix}%`).limit(10);
      const invById = new Map<string, any>((invRowsDb ?? []).map((r: any) => [String(r?.id ?? ""), r]));
      for (const r of invItemControl) {
        const it = mapItemInventario((r as any)?.raw_payload_json ?? {});
        if (!it.bubbleInventarioId || !it.bubbleItemId) continue;
        contentValidation.checked.inventarioItems += 1;
        const invId = buildInventarioId(userId, it.bubbleInventarioId);
        const invDb = invById.get(invId) ?? null;
        if (!invDb) continue;
        const insumoId = buildInsumoId(userId, it.bubbleItemId);
        const cats = Array.isArray((invDb as any)?.categorias) ? ((invDb as any).categorias as any[]) : [];
        let found: any = null;
        for (const c of cats) {
          const items = Array.isArray((c as any)?.itens) ? ((c as any).itens as any[]) : [];
          const got = items.find((x) => String((x as any)?.id ?? "") === insumoId) ?? null;
          if (got) {
            found = got;
            break;
          }
        }
        const dbQty = String((found as any)?.estoqueFinal ?? "").trim();
        if (it.estoqueFinal && dbQty !== String(it.estoqueFinal ?? "").trim()) {
          contentValidation.mismatches.push({ baseType: "itens_inventarios", bubbleId: it.bubbleItemId, kind: "estoque_final_mismatch", expected: String(it.estoqueFinal), actual: dbQty || null });
        }
      }

      const notasControl = await loadControl("notas_fiscais", 50_000).catch(() => []);
      const entIdsToLoad = Array.from(
        new Set(
          notasControl
            .map((r: any) => {
              const rawNota = (r as any)?.raw_payload_json ?? {};
              const nf = mapNotaFiscal({ ...rawNota, _id: (rawNota as any)?._id || String((r as any)?.bubble_unique_id ?? "").trim() });
              if (!nf.bubbleNotaId) return "";
              return buildEntradaId(userId, nf.bubbleNotaId);
            })
            .filter(Boolean),
        ),
      );
      const entradasDbRows: any[] = [];
      if (entIdsToLoad.length) {
        // Supabase projects commonly cap a single response at 500/1000 rows.
        // Chunking also keeps the generated `in` URL below proxy limits.
        for (let offset = 0; offset < entIdsToLoad.length; offset += 200) {
          const ids = entIdsToLoad.slice(offset, offset + 200);
          const { data, error } = await supabase.from("entradas").select("id,itens_nota,valor_nota").in("id", ids).limit(ids.length);
          if (error) throw new Error(error.message);
          entradasDbRows.push(...(data ?? []));
        }
      } else {
        const { data, error } = await supabase.from("entradas").select("id,itens_nota,valor_nota").like("id", `${entPrefix}%`).limit(10);
        if (error) throw new Error(error.message);
        entradasDbRows.push(...(data ?? []));
      }
      const entById = new Map<string, any>((entradasDbRows ?? []).map((r: any) => [String(r?.id ?? ""), r]));
      const itensNotasControl = await loadControl("itens_notas", 50_000).catch(() => []);
      const itensNotaByNotaId = new Map<string, { count: number; subtotalSum: number; hasPositiveSubtotal: boolean; hasPositiveUnitCost: boolean }>();
      for (const r of itensNotasControl) {
        const it = mapItemNota((r as any)?.raw_payload_json ?? {});
        if (!it.bubbleNotaId) continue;
        const cur = itensNotaByNotaId.get(it.bubbleNotaId) ?? { count: 0, subtotalSum: 0, hasPositiveSubtotal: false, hasPositiveUnitCost: false };
        const subtotal = parsePtNumber(String(it.subtotal ?? ""));
        const unitCost = parsePtNumber(String(it.custoUnitario ?? ""));
        itensNotaByNotaId.set(it.bubbleNotaId, {
          count: cur.count + 1,
          subtotalSum: cur.subtotalSum + (subtotal || 0),
          hasPositiveSubtotal: cur.hasPositiveSubtotal || subtotal > 0,
          hasPositiveUnitCost: cur.hasPositiveUnitCost || unitCost > 0,
        });
      }
      const insumoNames = new Set<string>(
        insumosRows
          .map((r: any) => String(r?.item ?? "").trim().toLowerCase())
          .filter(Boolean),
      );
      for (const r of notasControl) {
        const rawNota = (r as any)?.raw_payload_json ?? {};
        const nf = mapNotaFiscal({ ...rawNota, _id: (rawNota as any)?._id || String((r as any)?.bubble_unique_id ?? "").trim() });
        if (!nf.bubbleNotaId) continue;
        contentValidation.checked.notas += 1;
        const entId = buildEntradaId(userId, nf.bubbleNotaId);
        const ent = entById.get(entId) ?? null;
        const items = Array.isArray((ent as any)?.itens_nota) ? ((ent as any).itens_nota as any[]) : [];
        // Detailed itens_notas is authoritative when present; listaItens on
        // the note is only Bubble's denormalized summary and can be stale.
        const bubbleItemsMeta = itensNotaByNotaId.get(nf.bubbleNotaId) ?? null;
        const expected = bubbleItemsMeta?.count ?? (Array.isArray((nf as any).listaItens) ? ((nf as any).listaItens as any[]).length : 0);
        if (!ent || items.length !== expected) {
          contentValidation.mismatches.push({ baseType: "notas_fiscais", bubbleId: nf.bubbleNotaId, kind: "itens_nota_count_mismatch", expected, actual: ent ? items.length : null });
        }

        if (bubbleItemsMeta && bubbleItemsMeta.count > 0) {
          const hasAnySubtotal = items.some((x) => parsePtNumber(String((x as any)?.subtotalLabel ?? (x as any)?.subtotal ?? "")) > 0);
          const hasAnyUnitCost = items.some((x) => parsePtNumber(String((x as any)?.custoUnitarioLabel ?? (x as any)?.custoUnitario ?? "")) > 0);
          if ((bubbleItemsMeta.hasPositiveSubtotal && !hasAnySubtotal) || (bubbleItemsMeta.hasPositiveUnitCost && !hasAnyUnitCost)) {
            contentValidation.mismatches.push({
              baseType: "notas_fiscais",
              bubbleId: nf.bubbleNotaId,
              kind: "missing_itens_notas_details",
              expected: "itens_nota com subtotal e custoUnitario",
              actual: { hasAnySubtotal, hasAnyUnitCost },
            });
          }

          const dbValor = parsePtNumber(String((ent as any)?.valor_nota ?? ""));
          const expectedValor = bubbleItemsMeta.subtotalSum;
          if (expectedValor > 0 && (!dbValor || Math.abs(dbValor - expectedValor) > 0.02)) {
            contentValidation.mismatches.push({
              baseType: "notas_fiscais",
              bubbleId: nf.bubbleNotaId,
              kind: "valor_nota_mismatch",
              expected: expectedValor,
              actual: dbValor || null,
            });
          }
        }

        for (const it of items.slice(0, 5)) {
          const nomeNaNota = String((it as any)?.nome ?? (it as any)?.nomeNaNota ?? "").trim();
          const insumoEquivalente = String((it as any)?.nome ?? (it as any)?.insumoEquivalente ?? "").trim();
          if (nomeNaNota && looksLikeTechnicalId(nomeNaNota)) {
            contentValidation.mismatches.push({ baseType: "notas_fiscais", bubbleId: nf.bubbleNotaId, kind: "nome_na_nota_technical", expected: "texto", actual: nomeNaNota });
          }
          if (!insumoEquivalente || looksLikeTechnicalId(insumoEquivalente)) {
            contentValidation.mismatches.push({ baseType: "notas_fiscais", bubbleId: nf.bubbleNotaId, kind: "insumo_equivalente_technical_or_empty", expected: "nome de insumo", actual: insumoEquivalente || null });
            continue;
          }
          const key = insumoEquivalente.toLowerCase();
          if (!insumoNames.has(key)) {
            contentValidation.mismatches.push({ baseType: "notas_fiscais", bubbleId: nf.bubbleNotaId, kind: "insumo_equivalente_not_found", expected: "nome existente em insumos_state", actual: insumoEquivalente });
          }
        }
      }

      const desperdicioControl = await loadControl("desperdicio", 50_000).catch(() => []);
      const despIdsToLoad = Array.from(
        new Set(
          desperdicioControl
            .map((r: any) => {
              const d = mapDesperdicio((r as any)?.raw_payload_json ?? {});
              if (!d.bubbleDesperdicioId) return "";
              return buildDesperdicioId(userId, d.bubbleDesperdicioId);
            })
            .filter(Boolean),
        ),
      );
      const despRowsDb: any[] = [];
      if (despIdsToLoad.length) {
        for (let offset = 0; offset < despIdsToLoad.length; offset += 200) {
          const ids = despIdsToLoad.slice(offset, offset + 200);
          const { data, error } = await supabase.from("desperdicios").select("id,item,motivo,custo").in("id", ids).limit(ids.length);
          if (error) throw new Error(error.message);
          despRowsDb.push(...(data ?? []));
        }
      } else {
        const { data, error } = await supabase.from("desperdicios").select("id,item,motivo,custo").like("id", `${despPrefix}%`).limit(20);
        if (error) throw new Error(error.message);
        despRowsDb.push(...(data ?? []));
      }
      const despById = new Map<string, any>((despRowsDb ?? []).map((r: any) => [String(r?.id ?? ""), r]));
      for (const r of desperdicioControl) {
        const d = mapDesperdicio((r as any)?.raw_payload_json ?? {});
        if (!d.bubbleDesperdicioId) continue;
        contentValidation.checked.desperdicios += 1;
        const dbId = buildDesperdicioId(userId, d.bubbleDesperdicioId);
        const dbRow = despById.get(dbId) ?? null;
        const dbItem = String((dbRow as any)?.item ?? "").trim();
        const dbMotivo = String((dbRow as any)?.motivo ?? "").trim();
        const dbCusto = String((dbRow as any)?.custo ?? "").trim();
        const expectedItemName = sourceItemNameByBubbleId.get(d.bubbleItemId) ?? "";
        if (d.bubbleItemId && (!dbItem || (expectedItemName && dbItem !== expectedItemName))) {
          contentValidation.mismatches.push({ baseType: "desperdicio", bubbleId: d.bubbleDesperdicioId, kind: "item_link_mismatch", expected: expectedItemName || d.bubbleItemId, actual: dbItem || null });
        }
        if (d.custo && (!dbCusto || dbCusto === "R$0,00")) {
          contentValidation.mismatches.push({ baseType: "desperdicio", bubbleId: d.bubbleDesperdicioId, kind: "missing_custo", expected: d.custo, actual: dbCusto || null });
        }
        if (d.motivoNome && (!dbMotivo || looksLikeTechnicalId(dbMotivo) || dbMotivo !== d.motivoNome)) {
          contentValidation.mismatches.push({ baseType: "desperdicio", bubbleId: d.bubbleDesperdicioId, kind: "motivo_mismatch", expected: d.motivoNome, actual: dbMotivo || null });
        }
      }
    }

    if (contentValidation.mismatches.length) {
      hasDiff = true;
      contentValidation.ok = false;
    }

    const validatedAt = nowIso();
    const validationStatus = hasDiff ? "divergent" : "validated";
    const report = {
      runId,
      validatedAt,
      validationStatus,
      user: { email, bubbleUserId },
      ignoredCount,
      perType,
      contentValidation,
    };

    const { error: migUpdErr } = await supabase
      .from("bubble_obj_user_migration")
      .update({ validation_status: validationStatus, validation_report: report as any, validated_at: validatedAt } as any)
      .eq("supabase_user_id", userId);
    if (migUpdErr) return json({ ok: false, error: migUpdErr.message }, { status: 500 });

    if (attemptId) {
      const { error: attUpdErr } = await supabase
        .from("bubble_obj_user_migration_attempt")
        .update({ validation_status: validationStatus, validation_report: report as any, validated_at: validatedAt } as any)
        .eq("id", attemptId);
      if (attUpdErr) return json({ ok: false, error: attUpdErr.message }, { status: 500 });
    }

    const { data: persisted, error: persistedErr } = await supabase
      .from("bubble_obj_user_migration")
      .select("validation_status,validated_at,validation_report,last_run_id")
      .eq("supabase_user_id", userId)
      .maybeSingle();
    if (persistedErr) return json({ ok: false, error: persistedErr.message }, { status: 500 });

    return json({ ok: true, status: validationStatus, report, persisted }, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try {
      const { userId } = getUserIdFromRequest(req);
      if (userId && isUuid(userId)) {
        const supabase = getSupabaseAdmin();
        const { error } = await supabase
          .from("bubble_obj_user_migration")
          .update({ validation_status: "failed", validation_report: { error: msg }, validated_at: nowIso() } as any)
          .eq("supabase_user_id", userId);
        if (error) {}
      }
    } catch {}
    return json({ ok: false, error: msg }, { status: 500 });
  }
}
