import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "../../../../lib/requestUserId";
import { getSupabaseAdmin } from "../../../../lib/supabaseAdmin";
import { mapBubbleUsuario } from "../../../../lib/bubbleObjMappers";
import { fetchBubbleObjPageWithConstraints, getBubbleObjCredentials } from "../../../../lib/bubbleObjApi";
import {
  buildDesperdicioId,
  buildEntradaId,
  buildInsumoId,
  buildInventarioId,
  isStagedOnlyBaseType,
  mapCategoriaName,
  mapCustoMedioItem,
  mapDesperdicio,
  mapFornecedor,
  mapInventario,
  mapItemFornecedor,
  mapItemInventario,
  mapItemNota,
  mapItemToInsumo,
  mapMotivoDesperdicio,
  mapNotaFiscal,
  parseObjectType,
  userScopedId,
} from "../../../../lib/bubbleObjRealMapping";
import { formatMoneyBRL, parsePtNumber } from "../../../../lib/bubbleCsv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return NextResponse.json(data, { ...init, headers });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function requestOrigin(req: NextRequest) {
  const origin = (req.headers.get("origin") ?? "").trim();
  if (origin) return origin.replace(/\/+$/, "");
  const proto = (req.headers.get("x-forwarded-proto") ?? "").trim();
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").trim();
  if (proto && host) return `${proto}://${host}`.replace(/\/+$/, "");
  if (host) return `http://${host}`.replace(/\/+$/, "");
  return "http://localhost:3000";
}

function nowIso() {
  return new Date().toISOString();
}

function safeInt(n: any) {
  const v = Number(n ?? 0);
  return Number.isFinite(v) ? Math.floor(v) : 0;
}

function safeMsBetween(aIso: string | null, bIso: string | null) {
  const a = aIso ? Date.parse(aIso) : 0;
  const b = bIso ? Date.parse(bIso) : 0;
  if (!a || !b) return 0;
  const ms = b - a;
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : 0;
}

function jwtEmail(accessToken: string) {
  const t = String(accessToken ?? "").trim();
  const parts = t.split(".");
  if (parts.length < 2) return "";
  try {
    const payloadRaw = Buffer.from(parts[1], "base64").toString("utf8");
    const payload = JSON.parse(payloadRaw) as any;
    return String(payload?.email ?? payload?.user_metadata?.email ?? "")
      .trim()
      .toLowerCase();
  } catch {
    return "";
  }
}

async function ensureMigrationRow(supabase: ReturnType<typeof getSupabaseAdmin>, userId: string, email: string) {
  const { data, error } = await supabase.from("bubble_obj_user_migration").select("*").eq("supabase_user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return data as any;
  const { data: created, error: insErr } = await supabase
    .from("bubble_obj_user_migration")
    .insert({ supabase_user_id: userId, email, status: "not_started", last_attempt_at: null, last_error: "" } as any)
    .select("*")
    .maybeSingle();
  if (insErr) throw new Error(insErr.message);
  return created as any;
}

async function ensureBubbleUserForEmail(supabase: ReturnType<typeof getSupabaseAdmin>, userId: string, email: string) {
  const creds = await getBubbleObjCredentials();
  const candidates = ["user", "User", "users", "Users"];
  let picked: any = null;
  let pickedType = "";
  for (const t of candidates) {
    try {
      const page = await fetchBubbleObjPageWithConstraints<any>({
        creds,
        type: t,
        cursor: 0,
        limit: 10,
        constraints: [{ key: "email", constraint_type: "equals", value: email }],
      });
      const first = (page.results ?? [])[0];
      if (first) {
        picked = first;
        pickedType = t;
        break;
      }
    } catch {}
  }
  if (!picked) throw new Error("bubble_user_not_found_for_email");

  const mapped = mapBubbleUsuario(picked);
  const bubbleUserId = String(mapped.normalized?.bubble_user_id ?? "").trim();
  const nome = String(mapped.normalized?.nome ?? "").trim();
  if (!bubbleUserId) throw new Error("missing_bubble_user_id");

  const { error: upErr } = await supabase.from("bubble_obj_user_map").upsert(
    {
      bubble_user_id: bubbleUserId,
      email,
      nome: nome || "",
      supabase_user_id: userId,
    } as any,
    { onConflict: "bubble_user_id" },
  );
  if (upErr) throw new Error(upErr.message);

  return { bubbleUserId, nome, sourceType: pickedType };
}

function initialObjectTypes() {
  const raw = String(process.env.BUBBLE_OBJ_OBJECT_TYPES ?? "").trim();
  if (raw) return raw.split(",").map((x) => x.trim()).filter(Boolean);
  return ["user", "empresas"];
}

function companyScopedBaseTypes() {
  return [
    "item",
    "categorias",
    "custo_medio_item",
    "fornecedores",
    "itens_fornecedores",
    "inventarios",
    "itens_inventarios",
    "notas_fiscais",
    "itens_notas",
    "desperdicio",
    "motivos_desperdicios",
    "etiquetas",
    "itens_lista_compras",
    "qtd_compra_real",
    "faturamentos",
  ];
}

function companyUserContainsKeys() {
  return [
    "lista_usuarios",
    "lista_de_usuarios",
    "usuarios",
    "users",
    "lista_usuarios_ids",
    "usuarios_ids",
    "lista_users",
    "lista_user",
  ];
}

function isConstraintKeyRejected(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  if (!msg.startsWith("bubble_400:")) return false;
  const lower = msg.toLowerCase();
  return lower.includes("constraint") || lower.includes("constraints") || lower.includes("key") || lower.includes("field");
}

async function discoverCompanyIdsForUser(args: { creds: Awaited<ReturnType<typeof getBubbleObjCredentials>>; bubbleUserId: string }) {
  const { creds, bubbleUserId } = args;
  const out: string[] = [];
  for (const k of companyUserContainsKeys()) {
    let cursor = 0;
    for (let i = 0; i < 20; i++) {
      try {
        const page = await fetchBubbleObjPageWithConstraints<any>({
          creds,
          type: "empresas",
          cursor,
          limit: 100,
          constraints: [{ key: k, constraint_type: "contains", value: bubbleUserId }],
        });
        for (const r of page.results ?? []) {
          const id = String((r as any)?.unique_id ?? (r as any)?._id ?? (r as any)?.id ?? "").trim();
          if (id) out.push(id);
        }
        const got = (page.results ?? []).length;
        cursor += got;
        if (!got || page.remaining === 0) break;
      } catch (err) {
        if (isConstraintKeyRejected(err)) break;
        throw err;
      }
    }
    if (out.length) break;
  }
  return Array.from(new Set(out)).filter(Boolean);
}

function expandCompanyObjectTypes(companyIds: string[]) {
  const bases = companyScopedBaseTypes();
  const out: string[] = [];
  for (const id of companyIds) {
    const cid = String(id ?? "").trim();
    if (!cid) continue;
    for (const b of bases) out.push(`${b}@${cid}`);
  }
  return out;
}

async function ensureRunForUser(supabase: ReturnType<typeof getSupabaseAdmin>, args: { userId: string; baseUrl: string; batchLimit: number; prevRunId?: string | null }) {
  const { userId, baseUrl, batchLimit, prevRunId } = args;

  if (prevRunId) {
    const { data, error } = await supabase.from("bubble_obj_import_run").select("*").eq("id", prevRunId).maybeSingle();
    if (!error && data && String((data as any).triggered_by_supabase_user_id ?? "") === userId) {
      return String((data as any).id);
    }
  }

  const { data: runRow, error: runErr } = await supabase
    .from("bubble_obj_import_run")
    .insert({ triggered_by_supabase_user_id: userId, base_url: baseUrl, batch_limit: batchLimit, status: "running" } as any)
    .select("id")
    .maybeSingle();
  if (runErr) throw new Error(runErr.message);
  const runId = String((runRow as any)?.id ?? "").trim();
  if (!runId) throw new Error("failed_to_create_run");
  return runId;
}

async function ensureCheckpointsAndRunItems(supabase: ReturnType<typeof getSupabaseAdmin>, args: { userId: string; bubbleUserId: string; userEmail: string; runId: string; objectTypes: string[] }) {
  const { userId, bubbleUserId, userEmail, runId, objectTypes } = args;

  const { data: existingCp, error: cpErr } = await supabase
    .from("bubble_obj_import_checkpoint")
    .select("bubble_user_id,object_type,last_cursor,total_imported,status")
    .eq("supabase_user_id", userId)
    .eq("bubble_user_id", bubbleUserId)
    .in("object_type", objectTypes);
  if (cpErr) throw new Error(cpErr.message);
  const cpMap = new Map<string, any>();
  for (const r of (existingCp ?? []) as any[]) cpMap.set(String(r.object_type ?? ""), r);

  const checkpointRows: any[] = [];
  const runItemRows: any[] = [];
  for (const t of objectTypes) {
    const prev = cpMap.get(t) ?? null;
    if (!prev) {
      checkpointRows.push({
        user_email: userEmail,
        bubble_user_id: bubbleUserId,
        supabase_user_id: userId,
        object_type: t,
        last_cursor: 0,
        total_imported: 0,
        status: "pending",
      });
    }
    runItemRows.push({
      run_id: runId,
      bubble_user_id: bubbleUserId,
      supabase_user_id: userId,
      object_type: t,
      status: String(prev?.status ?? "") === "done" ? "done" : "pending",
      last_cursor: typeof prev?.last_cursor === "number" && Number.isFinite(prev.last_cursor) && prev.last_cursor >= 0 ? prev.last_cursor : 0,
    });
  }

  if (checkpointRows.length) {
    const { error } = await supabase.from("bubble_obj_import_checkpoint").upsert(checkpointRows as any, { onConflict: "bubble_user_id,object_type,supabase_user_id" });
    if (error) throw new Error(error.message);
  }

  if (runItemRows.length) {
    const { error } = await supabase.from("bubble_obj_import_run_item").upsert(runItemRows as any, { onConflict: "run_id,bubble_user_id,object_type,supabase_user_id" });
    if (error) throw new Error(error.message);
  }
}

async function processStagingBatch(args: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  userId: string;
  runId: string;
  objectType: string;
  limit: number;
  statuses?: string[];
}) {
  const { supabase, userId, runId, objectType, limit } = args;
  const statuses = Array.isArray(args.statuses) && args.statuses.length ? args.statuses.map((s) => String(s ?? "").trim()).filter(Boolean) : ["staged"];
  const parsed = parseObjectType(objectType);
  const baseType = String(parsed.baseType ?? "").trim().toLowerCase();
  const normTxt = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
  const scopeObjectType = (t: string) => `${String(t ?? "").trim()}#${userId}`;
  if (!baseType) return { processed: 0, pendingReview: 0, error: 0 };

  const { data: rows, error } = await supabase
    .from("bubble_obj_import_staging")
    .select("id,bubble_unique_id,raw_payload_json,status")
    .eq("supabase_user_id", userId)
    .eq("bubble_object_type", objectType)
    .in("status", statuses)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);

  const list = (rows ?? []) as any[];
  if (!list.length) return { processed: 0, pendingReview: 0, error: 0 };

  if (isStagedOnlyBaseType(baseType)) {
    const ids = list.map((r) => String(r?.id ?? "").trim()).filter(Boolean);
    const uniqueIds = list.map((r) => String(r?.bubble_unique_id ?? "").trim()).filter(Boolean);
    if (ids.length) await supabase.from("bubble_obj_import_staging").update({ status: "staged_only" } as any).in("id", ids);
    if (uniqueIds.length) {
      await supabase
        .from("bubble_obj_import_control")
        .update({ status: "staged_only" } as any)
        .eq("supabase_user_id", userId)
        .eq("bubble_object_type", objectType)
        .in("bubble_unique_id", uniqueIds)
        .in("status", statuses);
    }
    const processed = ids.length;
    if (processed) {
      const { data: it, error: itErr } = await supabase
        .from("bubble_obj_import_run_item")
        .select("id,total_processed")
        .eq("run_id", runId)
        .eq("supabase_user_id", userId)
        .eq("object_type", objectType)
        .maybeSingle();
      if (itErr) throw new Error(itErr.message);
      const prevProcessed = safeInt((it as any)?.total_processed);
      await supabase
        .from("bubble_obj_import_run_item")
        .update({ total_processed: prevProcessed + processed } as any)
        .eq("run_id", runId)
        .eq("supabase_user_id", userId)
        .eq("object_type", objectType);
    }
    return { processed, pendingReview: 0, error: 0 };
  }

  const processedIds: string[] = [];
  const processedUniqueIds: string[] = [];
  const pendingIds: string[] = [];
  let pendingReview = 0;
  let processed = 0;
  let errCount = 0;

  const stateId = userScopedId(userId).slice(0, -1);
  const loadInsumosState = async () => {
    const { data, error } = await supabase.from("insumos_state").select("payload").eq("id", stateId).maybeSingle();
    if (error) throw new Error(error.message);
    const payload = (data as any)?.payload ?? {};
    const rows = Array.isArray(payload?.rows) ? (payload.rows as any[]) : [];
    const categories = Array.isArray(payload?.categories) ? (payload.categories as any[]) : [];
    return { rows, categories };
  };
  const saveInsumosState = async (payload: { rows: any[]; categories: any[] }) => {
    const { error } = await supabase.from("insumos_state").upsert({ id: stateId, payload } as any, { onConflict: "id" });
    if (error) throw new Error(error.message);
  };
  const loadFornecedoresState = async () => {
    const { data, error } = await supabase.from("fornecedores_state").select("info,produtos,equivalencias").eq("id", stateId).maybeSingle();
    if (error) throw new Error(error.message);
    return {
      info: ((data as any)?.info as any) || {},
      produtos: ((data as any)?.produtos as any) || {},
      equivalencias: ((data as any)?.equivalencias as any) || {},
    };
  };
  const saveFornecedoresState = async (payload: { info: any; produtos: any; equivalencias: any }) => {
    const { error } = await supabase
      .from("fornecedores_state")
      .upsert({ id: stateId, info: payload.info, produtos: payload.produtos, equivalencias: payload.equivalencias } as any, { onConflict: "id" });
    if (error) throw new Error(error.message);
  };

  const loadCategoriaNameByIdForCompany = async () => {
    const companyId = parsed.companyId;
    if (!companyId) return {} as Record<string, string>;
    const key = scopeObjectType(`categorias@${companyId}`);
    const { data, error } = await supabase
      .from("bubble_obj_import_control")
      .select("bubble_unique_id,raw_payload_json,status")
      .eq("supabase_user_id", userId)
      .eq("bubble_object_type", key)
      .in("status", ["staged", "processed", "staged_only"]);
    if (error) throw new Error(error.message);
    const out: Record<string, string> = {};
    for (const r of (data ?? []) as any[]) {
      const id = String((r as any)?.bubble_unique_id ?? "").trim();
      if (!id) continue;
      const nome = mapCategoriaName((r as any)?.raw_payload_json ?? {});
      if (nome) out[id] = nome;
    }
    return out;
  };

  if (baseType === "categorias" || baseType === "item" || baseType === "custo_medio_item") {
    const categoriaNameById = baseType === "item" ? await loadCategoriaNameByIdForCompany() : ({} as Record<string, string>);
    const st = await loadInsumosState();
    const rowsById = new Map<string, any>(st.rows.map((r) => [String((r as any)?.id ?? ""), r]));
    const categoriesSet = new Set<string>(st.categories.map((c) => String(c ?? "").trim()).filter(Boolean));

    for (const r of list) {
      const bubbleUniqueId = String(r.bubble_unique_id ?? "").trim();
      const raw = r.raw_payload_json ?? {};
      if (!bubbleUniqueId) {
        pendingReview += 1;
        pendingIds.push(String(r.id));
        continue;
      }

      if (baseType === "categorias") {
        const nome = mapCategoriaName(raw);
        if (nome) categoriesSet.add(nome);
      } else if (baseType === "item") {
        const mapped = mapItemToInsumo(raw, { userId, categoriaNameById });
        if (!mapped.ok || !mapped.bubbleItemId) {
          pendingReview += 1;
          pendingIds.push(String(r.id));
          continue;
        }
        const prev = rowsById.get(mapped.insumo.id) ?? null;
        const next = { ...(prev ?? {}), ...mapped.insumo, custoMedio: String(prev?.custoMedio ?? "") || String(mapped.insumo.custoMedio ?? "") };
        rowsById.set(mapped.insumo.id, next);
        categoriesSet.add(String(mapped.insumo.categoria ?? "Sem categoria"));
      } else if (baseType === "custo_medio_item") {
        const cm = mapCustoMedioItem(raw);
        if (cm.bubbleItemId && cm.custoMedio) {
          const id = buildInsumoId(userId, cm.bubbleItemId);
          const prev = rowsById.get(id) ?? null;
          if (prev) rowsById.set(id, { ...(prev as any), custoMedio: cm.custoMedio });
        }
      }

      processedIds.push(String(r.id));
      processedUniqueIds.push(bubbleUniqueId);
      processed += 1;
    }

    const nextRows = Array.from(rowsById.values()).filter((x) => x && typeof x === "object" && String((x as any)?.id ?? ""));
    await saveInsumosState({ rows: nextRows, categories: Array.from(categoriesSet.values()) });
  } else if (baseType === "fornecedores" || baseType === "itens_fornecedores") {
    const st = await loadFornecedoresState();
    const info = (st.info && typeof st.info === "object" ? st.info : {}) as Record<string, any>;
    const produtos = (st.produtos && typeof st.produtos === "object" ? st.produtos : {}) as Record<string, any>;
    const equivalencias = (st.equivalencias && typeof st.equivalencias === "object" ? st.equivalencias : {}) as Record<string, any>;
    const insumos = baseType === "itens_fornecedores" ? await loadInsumosState() : null;
    const insumoByBubbleId =
      baseType === "itens_fornecedores"
        ? new Map<string, any>(
            (insumos?.rows ?? [])
              .map((r) => {
                const id = String((r as any)?.id ?? "");
                const bubbleId = id.includes("insumo:") ? id.split("insumo:", 2)[1] : "";
                return bubbleId ? [bubbleId, r] : null;
              })
              .filter(Boolean) as any,
          )
        : new Map<string, any>();

    const fornecedorNameById: Record<string, string> = {};
    if (baseType === "itens_fornecedores" && parsed.companyId) {
      const key = scopeObjectType(`fornecedores@${parsed.companyId}`);
      const { data, error } = await supabase
        .from("bubble_obj_import_control")
        .select("bubble_unique_id,raw_payload_json,status")
        .eq("supabase_user_id", userId)
        .eq("bubble_object_type", key)
        .in("status", ["staged", "processed", "staged_only"]);
      if (error) throw new Error(error.message);
      for (const r of (data ?? []) as any[]) {
        const id = String((r as any)?.bubble_unique_id ?? "").trim();
        if (!id) continue;
        const f = mapFornecedor((r as any)?.raw_payload_json ?? {});
        if (f.nome) fornecedorNameById[id] = f.nome;
      }
    }

    for (const r of list) {
      const bubbleUniqueId = String(r.bubble_unique_id ?? "").trim();
      const raw = r.raw_payload_json ?? {};
      if (!bubbleUniqueId) {
        pendingReview += 1;
        pendingIds.push(String(r.id));
        continue;
      }

      if (baseType === "fornecedores") {
        const f = mapFornecedor(raw);
        const nome = String(f.nome ?? "").trim();
        if (nome) {
          const k1 = nome.toUpperCase();
          info[k1] = {
            fornecedor: nome,
            vendedor: String((f as any)?.vendedor ?? "").trim(),
            whatsapp: String((f as any)?.whatsapp ?? "").trim(),
            endereco: String((f as any)?.endereco ?? "").trim(),
          };
        }
      } else {
        const it = mapItemFornecedor(raw);
        const fornecedorNome = String(fornecedorNameById[it.bubbleFornecedorId] ?? "").trim();
        const key = fornecedorNome ? fornecedorNome.toUpperCase() : "";
        if (key) {
          const prev = Array.isArray(produtos[key]) ? (produtos[key] as any[]) : [];
          const insumoNome = it.bubbleItemId ? String((insumoByBubbleId.get(it.bubbleItemId) as any)?.item ?? "").trim() : "";
          const added = String(it.nomeItem || insumoNome || "").trim();
          if (added) produtos[key] = Array.from(new Set([...prev.map((x) => String(x ?? "").trim()).filter(Boolean), added]));
        }
      }

      processedIds.push(String(r.id));
      processedUniqueIds.push(bubbleUniqueId);
      processed += 1;
    }

    await saveFornecedoresState({ info, produtos, equivalencias });
  } else if (baseType === "inventarios" || baseType === "itens_inventarios") {
    const loadInsumosStateOnce = async () => {
      const st = await loadInsumosState();
      const byBubbleId = new Map<string, any>();
      for (const row of st.rows) {
        const id = String((row as any)?.id ?? "");
        const m = id.match(/insumo:(.+)$/);
        if (!m) continue;
        byBubbleId.set(String(m[1] ?? "").trim(), row);
      }
      return { st, byBubbleId };
    };
    const { byBubbleId } = await loadInsumosStateOnce();
    const categoriaNameById = await loadCategoriaNameByIdForCompany();

    if (baseType === "inventarios") {
      const upserts: any[] = [];
      for (const r of list) {
        const bubbleUniqueId = String(r.bubble_unique_id ?? "").trim();
        const raw = r.raw_payload_json ?? {};
        const inv = mapInventario(raw);
        if (!inv.bubbleInventarioId) {
          pendingReview += 1;
          pendingIds.push(String(r.id));
          continue;
        }
        upserts.push({ id: buildInventarioId(userId, inv.bubbleInventarioId), data: inv.data, categorias: [] } as any);
        processedIds.push(String(r.id));
        processedUniqueIds.push(bubbleUniqueId);
        processed += 1;
      }
      if (upserts.length) {
        const { error: upErr } = await supabase.from("inventario").upsert(upserts as any, { onConflict: "id" });
        if (upErr) throw new Error(upErr.message);
      }
    } else {
      const byInv = new Map<string, any[]>();
      for (const r of list) {
        const raw = r.raw_payload_json ?? {};
        const it = mapItemInventario(raw);
        if (!it.bubbleInventarioId) {
          pendingReview += 1;
          pendingIds.push(String(r.id));
          continue;
        }
        const arr = byInv.get(it.bubbleInventarioId) ?? [];
        arr.push({ stId: String(r.id), bubbleUniqueId: String(r.bubble_unique_id ?? "").trim(), it });
        byInv.set(it.bubbleInventarioId, arr);
      }

      for (const [bubbleInvId, rows] of byInv.entries()) {
        const invId = buildInventarioId(userId, bubbleInvId);
        const { data: existing, error: exErr } = await supabase.from("inventario").select("data,categorias").eq("id", invId).maybeSingle();
        if (exErr) throw new Error(exErr.message);
        if (!existing) {
          for (const rowWrap of rows) {
            pendingReview += 1;
            pendingIds.push(String(rowWrap.stId));
          }
          continue;
        }
        const baseCats = Array.isArray((existing as any)?.categorias) ? ((existing as any).categorias as any[]) : [];
        const catsByKey = new Map<string, any>();
        for (const c of baseCats) {
          const nome = String((c as any)?.nome ?? "").trim() || "Sem categoria";
          catsByKey.set(nome.toLowerCase(), c);
        }

        for (const rowWrap of rows) {
          const it = rowWrap.it as any;
          const bubbleItemId = String(it.bubbleItemId ?? "").trim();
          const insumoId = bubbleItemId ? buildInsumoId(userId, bubbleItemId) : "";
          const insumo = bubbleItemId ? byBubbleId.get(bubbleItemId) ?? null : null;
          const itemName = String((insumo as any)?.item ?? it.nomeItem ?? "").trim() || "Item";
          const unidade = String((insumo as any)?.medida ?? it.unidade ?? "Und").trim() || "Und";
          const catFromId = it.categoriaId && categoriaNameById ? String(categoriaNameById[it.categoriaId] ?? "").trim() : "";
          const catName = normTxt(it.categoriaNome || catFromId) || String((insumo as any)?.categoria ?? "").trim() || "Sem categoria";
          const catKey = catName.toLowerCase();
          const catObj = catsByKey.get(catKey) ?? { id: `cat:${catKey}`, nome: catName, status: "pendente", itens: [] };
          const itensArr = Array.isArray(catObj.itens) ? (catObj.itens as any[]) : [];
          const id = insumoId || `${userScopedId(userId)}inventario_item:${bubbleItemId || rowWrap.bubbleUniqueId}`;
          const prevItem = itensArr.find((x) => String((x as any)?.id ?? "") === id) ?? null;
          if (!prevItem) {
            itensArr.push({ id, item: itemName, unidade, estoqueFinal: String(it.estoqueFinal ?? "") || "" });
          }
          catObj.itens = itensArr;
          catsByKey.set(catKey, catObj);

          processedIds.push(String(rowWrap.stId));
          processedUniqueIds.push(String(rowWrap.bubbleUniqueId));
          processed += 1;
        }

        const finalCats = Array.from(catsByKey.values());
        const { error: upErr } = await supabase.from("inventario").upsert({ id: invId, data: String((existing as any)?.data ?? "") || new Date().toISOString().slice(0, 10), categorias: finalCats } as any, { onConflict: "id" });
        if (upErr) throw new Error(upErr.message);
      }
    }
  } else if (baseType === "notas_fiscais" || baseType === "itens_notas") {
    const fornecedores = await loadFornecedoresState();
    const info = (fornecedores.info && typeof fornecedores.info === "object" ? fornecedores.info : {}) as Record<string, any>;
    const fornecedorNameByKey = new Map<string, string>();
    for (const [k, v] of Object.entries(info)) {
      const nome = String((v as any)?.fornecedor ?? "").trim();
      if (nome) fornecedorNameByKey.set(String(k ?? "").toUpperCase(), nome);
    }
    const insumos = await loadInsumosState();
    const insumoByBubbleId = new Map<string, any>(
      insumos.rows
        .map((r) => {
          const id = String((r as any)?.id ?? "");
          const bubbleId = id.includes("insumo:") ? id.split("insumo:", 2)[1] : "";
          return bubbleId ? [bubbleId, r] : null;
        })
        .filter(Boolean) as any,
    );

    const fornecedorNameById: Record<string, string> = {};
    if (parsed.companyId) {
      const key = scopeObjectType(`fornecedores@${parsed.companyId}`);
      const { data, error } = await supabase
        .from("bubble_obj_import_control")
        .select("bubble_unique_id,raw_payload_json,status")
        .eq("supabase_user_id", userId)
        .eq("bubble_object_type", key)
        .in("status", ["staged", "processed", "staged_only"]);
      if (error) throw new Error(error.message);
      for (const r of (data ?? []) as any[]) {
        const id = String((r as any)?.bubble_unique_id ?? "").trim();
        if (!id) continue;
        const f = mapFornecedor((r as any)?.raw_payload_json ?? {});
        if (f.nome) fornecedorNameById[id] = f.nome;
      }
    }

    const itensNotasByNotaId = new Map<string, Array<ReturnType<typeof mapItemNota>>>();
    if (parsed.companyId) {
      const key = scopeObjectType(`itens_notas@${parsed.companyId}`);
      const { data, error } = await supabase
        .from("bubble_obj_import_staging")
        .select("raw_payload_json,status")
        .eq("supabase_user_id", userId)
        .eq("bubble_object_type", key)
        .in("status", ["staged", "processed", "staged_only"])
        .limit(5000);
      if (error) throw new Error(error.message);
      for (const r of (data ?? []) as any[]) {
        const it = mapItemNota((r as any)?.raw_payload_json ?? {});
        if (!it.bubbleNotaId) continue;
        const arr = itensNotasByNotaId.get(it.bubbleNotaId) ?? [];
        arr.push(it);
        itensNotasByNotaId.set(it.bubbleNotaId, arr);
      }
    }

    if (baseType === "notas_fiscais") {
      const upserts: any[] = [];
      for (const r of list) {
        const bubbleUniqueId = String(r.bubble_unique_id ?? "").trim();
        const raw = r.raw_payload_json ?? {};
        const nf = mapNotaFiscal(raw);
        if (!nf.bubbleNotaId) {
          pendingReview += 1;
          pendingIds.push(String(r.id));
          continue;
        }
        const fornecedorFromId = nf.fornecedorId ? String(fornecedorNameById[nf.fornecedorId] ?? "").trim() : "";
        const fornecedorKey = String(fornecedorFromId || nf.fornecedorNome || nf.fornecedorId || "").toUpperCase();
        const fornecedor = fornecedorFromId || nf.fornecedorNome || fornecedorNameByKey.get(fornecedorKey) || String(nf.fornecedorId || "").trim() || "Sem fornecedor";
        const numero = nf.numero || `NF-${String(nf.bubbleNotaId).slice(0, 8)}`;
        const dataLancamento = nf.dataLancamento || nf.dataCriacao || "-";
        const responsavel = nf.responsavel || "";
        const dataCriacao = nf.dataCriacao || dataLancamento || "-";
        const itensDetalhe = itensNotasByNotaId.get(nf.bubbleNotaId) ?? [];
        const itensNota = itensDetalhe.length
          ? itensDetalhe.map((it) => {
              const bubbleItemId = String((it as any)?.bubbleItemId ?? "").trim();
              const insumo = bubbleItemId ? insumoByBubbleId.get(bubbleItemId) ?? null : null;
              const insumoNome = String((insumo as any)?.item ?? "").trim();
              const equivalenteUnidade = String((insumo as any)?.medida ?? "").trim();
              const nomeNaNota = String((it as any)?.nomeItem ?? "").trim() || insumoNome;
              const bubbleItemNotaId = String((it as any)?.bubbleItemNotaId ?? "").trim();
              const idPart = bubbleItemNotaId || bubbleItemId || nf.bubbleNotaId;
              return {
                id: `${userScopedId(userId)}nota_item:${nf.bubbleNotaId}:${idPart}`,
                nomeNaNota,
                unidadeNaNota: "",
                insumoEquivalente: insumoNome || "",
                equivalenteQuantidade: String((it as any)?.quantidade ?? "").trim(),
                equivalenteUnidade,
                subtotal: String((it as any)?.subtotal ?? "").trim(),
                custoUnitario: String((it as any)?.custoUnitario ?? "").trim(),
              };
            })
          : (() => {
              const itensIds = Array.isArray((nf as any).listaItens) ? ((nf as any).listaItens as any[]) : [];
              return itensIds
                .map((bubbleItemId) => {
                  const id = String(bubbleItemId ?? "").trim();
                  if (!id) return null;
                  const insumo = insumoByBubbleId.get(id) ?? null;
                  const nomeNaNota = String((insumo as any)?.item ?? "").trim();
                  const insumoEquivalente = nomeNaNota || "";
                  const equivalenteUnidade = String((insumo as any)?.medida ?? "").trim();
                  return {
                    id: `${userScopedId(userId)}nota_item:${nf.bubbleNotaId}:${id}`,
                    nomeNaNota,
                    unidadeNaNota: "",
                    insumoEquivalente,
                    equivalenteQuantidade: "",
                    equivalenteUnidade,
                    subtotal: "",
                    custoUnitario: "",
                  };
                })
                .filter(Boolean);
            })();
        const itensLabel = `${itensNota.length} ${itensNota.length === 1 ? "Item" : "Itens"}`;
        const valorNota = (() => {
          const v = parsePtNumber(String(nf.valorNota ?? ""));
          if (v && v > 0) return formatMoneyBRL(v);
          let sum = 0;
          for (const it of itensNota) {
            const sub = parsePtNumber(String((it as any)?.subtotal ?? ""));
            if (sub) sum += sub;
          }
          return sum > 0 ? formatMoneyBRL(sum) : nf.valorNota || "R$0,00";
        })();
        upserts.push({
          id: buildEntradaId(userId, nf.bubbleNotaId),
          user_id: userId,
          numero,
          data_lancamento: dataLancamento,
          fornecedor,
          valor_nota: valorNota,
          itens: itensLabel,
          responsavel,
          data_criacao: dataCriacao,
          itens_nota: itensNota,
        } as any);
        processedIds.push(String(r.id));
        processedUniqueIds.push(bubbleUniqueId);
        processed += 1;
      }
      if (upserts.length) {
        const { error: upErr } = await supabase.from("entradas").upsert(upserts as any, { onConflict: "id" });
        if (upErr) throw new Error(upErr.message);
      }
    } else {
      const byNota = new Map<string, any[]>();
      const rowsById = new Map<string, any>(insumos.rows.map((r) => [String((r as any)?.id ?? ""), r]));
      let insumosChanged = false;
      for (const r of list) {
        const bubbleUniqueId = String(r.bubble_unique_id ?? "").trim();
        const raw = r.raw_payload_json ?? {};
        const it = mapItemNota(raw);
        if (!it.bubbleNotaId) {
          if (it.bubbleItemId && it.custoUnitario) {
            const insumoId = buildInsumoId(userId, it.bubbleItemId);
            const prev = rowsById.get(insumoId) ?? null;
            if (prev) {
              const prevCost = String((prev as any)?.custoMedio ?? "").trim();
              if (!prevCost || prevCost === "-" || prevCost === "R$0,00") {
                rowsById.set(insumoId, { ...(prev as any), custoMedio: it.custoUnitario });
                insumosChanged = true;
              }
            }
          }
          if (!bubbleUniqueId) {
            pendingReview += 1;
            pendingIds.push(String(r.id));
          } else {
            processedIds.push(String(r.id));
            processedUniqueIds.push(bubbleUniqueId);
            processed += 1;
          }
          continue;
        }
        const arr = byNota.get(it.bubbleNotaId) ?? [];
        arr.push({ stId: String(r.id), bubbleUniqueId, it });
        byNota.set(it.bubbleNotaId, arr);
      }

      for (const [bubbleNotaId, rows] of byNota.entries()) {
        const entradaId = buildEntradaId(userId, bubbleNotaId);
        const { data: existing, error: exErr } = await supabase
          .from("entradas")
          .select("itens_nota,itens,valor_nota")
          .eq("id", entradaId)
          .maybeSingle();
        if (exErr) throw new Error(exErr.message);
        if (!existing) {
          continue;
        }
        const baseItems = Array.isArray((existing as any)?.itens_nota) ? ((existing as any).itens_nota as any[]) : [];
        const itemsById = new Map<string, any>(baseItems.map((x) => [String((x as any)?.id ?? ""), x]));

        for (const rowWrap of rows) {
          const it = rowWrap.it as any;
          const id = `${userScopedId(userId)}nota_item:${bubbleNotaId}:${it.bubbleItemId || it.bubbleItemNotaId || rowWrap.bubbleUniqueId}`;
          const insumo = it.bubbleItemId ? insumoByBubbleId.get(it.bubbleItemId) ?? null : null;
          const insumoEquivalente = String((insumo as any)?.item ?? "").trim();
          const equivalenteUnidade = String((insumo as any)?.medida ?? "").trim();
          const next = {
            id,
            nomeNaNota: it.nomeItem || "",
            unidadeNaNota: "",
            insumoEquivalente: insumoEquivalente || "",
            equivalenteQuantidade: it.quantidade || "",
            equivalenteUnidade: equivalenteUnidade || "",
            subtotal: it.subtotal || "",
            custoUnitario: it.custoUnitario || "",
          };
          itemsById.set(id, { ...(itemsById.get(id) ?? {}), ...next });
          processedIds.push(String(rowWrap.stId));
          processedUniqueIds.push(String(rowWrap.bubbleUniqueId));
          processed += 1;
        }

        const finalItems = Array.from(itemsById.values());
        const valorNotaRaw = String((existing as any)?.valor_nota ?? "").trim();
        const valorNota = (() => {
          const v = parsePtNumber(valorNotaRaw);
          if (v && v > 0) return formatMoneyBRL(v);
          let sum = 0;
          for (const it of finalItems) {
            const sub = parsePtNumber(String((it as any)?.subtotal ?? ""));
            if (sub) sum += sub;
          }
          return sum > 0 ? formatMoneyBRL(sum) : valorNotaRaw || "R$0,00";
        })();
        const { error: upErr } = await supabase
          .from("entradas")
          .update({
            itens_nota: finalItems,
            itens: `${finalItems.length} ${finalItems.length === 1 ? "Item" : "Itens"}`,
            valor_nota: valorNota,
          } as any)
          .eq("id", entradaId);
        if (upErr) throw new Error(upErr.message);
      }

      if (insumosChanged) {
        const nextRows = Array.from(rowsById.values()).filter((x) => x && typeof x === "object" && String((x as any)?.id ?? ""));
        await saveInsumosState({ rows: nextRows, categories: insumos.categories });
      }
    }
  } else if (baseType === "motivos_desperdicios" || baseType === "desperdicio") {
    const motivoMap: Record<string, string> = {};
    if (baseType === "desperdicio" && parsed.companyId) {
      const key = scopeObjectType(`motivos_desperdicios@${parsed.companyId}`);
      const { data, error } = await supabase
        .from("bubble_obj_import_control")
        .select("bubble_unique_id,raw_payload_json,status")
        .eq("supabase_user_id", userId)
        .eq("bubble_object_type", key)
        .in("status", ["staged", "processed", "staged_only"]);
      if (error) throw new Error(error.message);
      for (const r of (data ?? []) as any[]) {
        const id = String((r as any)?.bubble_unique_id ?? "").trim();
        if (!id) continue;
        const m = mapMotivoDesperdicio((r as any)?.raw_payload_json ?? {});
        if (m.nome) motivoMap[id] = m.nome;
      }
    }

    const upserts: any[] = [];
    for (const r of list) {
      const bubbleUniqueId = String(r.bubble_unique_id ?? "").trim();
      const raw = r.raw_payload_json ?? {};
      if (!bubbleUniqueId) {
        pendingReview += 1;
        pendingIds.push(String(r.id));
        continue;
      }

      if (baseType === "motivos_desperdicios") {
        processedIds.push(String(r.id));
        processedUniqueIds.push(bubbleUniqueId);
        processed += 1;
        continue;
      }

      const d = mapDesperdicio(raw);
      if (!d.bubbleDesperdicioId) {
        pendingReview += 1;
        pendingIds.push(String(r.id));
        continue;
      }
      const insumoId = d.bubbleItemId ? buildInsumoId(userId, d.bubbleItemId) : "";
      const item = insumoId || d.itemNome || "";
      const motivo = d.motivoNome || (d.bubbleMotivoId ? String(motivoMap[d.bubbleMotivoId] ?? "").trim() : "") || "";
      upserts.push({ id: buildDesperdicioId(userId, d.bubbleDesperdicioId), data: d.data, item, quantidade: d.quantidade || "", custo: d.custo || "", motivo } as any);
      processedIds.push(String(r.id));
      processedUniqueIds.push(bubbleUniqueId);
      processed += 1;
    }
    if (upserts.length) {
      const { error: upErr } = await supabase.from("desperdicios").upsert(upserts as any, { onConflict: "id" });
      if (upErr) throw new Error(upErr.message);
    }
  } else {
    for (const r of list) {
      const bubbleUniqueId = String(r.bubble_unique_id ?? "").trim();
      if (!bubbleUniqueId) continue;
      processedIds.push(String(r.id));
      processedUniqueIds.push(bubbleUniqueId);
      processed += 1;
    }
  }

  if (processedIds.length) {
    await supabase.from("bubble_obj_import_staging").update({ status: "processed" } as any).in("id", processedIds);
  }

  if (pendingIds.length) {
    await supabase.from("bubble_obj_import_staging").update({ status: "pending_review" } as any).in("id", pendingIds);
  }

  if (processed) {
    const { data: it, error: itErr } = await supabase
      .from("bubble_obj_import_run_item")
      .select("id,total_processed")
      .eq("run_id", runId)
      .eq("supabase_user_id", userId)
      .eq("object_type", objectType)
      .maybeSingle();
    if (itErr) throw new Error(itErr.message);
    const prevProcessed = safeInt((it as any)?.total_processed);
    await supabase.from("bubble_obj_import_run_item").update({ total_processed: prevProcessed + processed } as any).eq("run_id", runId).eq("supabase_user_id", userId).eq("object_type", objectType);
  }

  return { processed, pendingReview, error: errCount };
}

async function updateMigrationTotals(supabase: ReturnType<typeof getSupabaseAdmin>, userId: string, runId: string) {
  const { data: items, error } = await supabase
    .from("bubble_obj_import_run_item")
    .select("status,total_received,total_saved_staging,total_duplicate_ignored,total_pending_review,total_error,total_processed")
    .eq("run_id", runId)
    .eq("supabase_user_id", userId);
  if (error) throw new Error(error.message);
  const list = (items ?? []) as any[];
  const { data: stagedAny, error: pendingStagedErr } = await supabase
    .from("bubble_obj_import_staging")
    .select("id")
    .eq("supabase_user_id", userId)
    .eq("status", "staged")
    .limit(1);
  if (pendingStagedErr) throw new Error(pendingStagedErr.message);
  const pendingStagedCount = Array.isArray(stagedAny) ? stagedAny.length : 0;
  const totals = {
    received: list.reduce((a, r) => a + safeInt(r.total_received), 0),
    savedStaging: list.reduce((a, r) => a + safeInt(r.total_saved_staging), 0),
    duplicateIgnored: list.reduce((a, r) => a + safeInt(r.total_duplicate_ignored), 0),
    pendingReview: list.reduce((a, r) => a + safeInt(r.total_pending_review), 0),
    error: list.reduce((a, r) => a + safeInt(r.total_error), 0),
    processed: list.reduce((a, r) => a + safeInt(r.total_processed), 0),
  };
  const doneCount = list.filter((x) => String(x?.status ?? "") === "done").length;
  const errorCount = list.filter((x) => String(x?.status ?? "") === "error").length;
  const retryingCount = list.filter((x) => String(x?.status ?? "") === "retrying").length;
  const pendingCount = list.length - doneCount - errorCount;
  return { totals, doneCount, pendingCount, errorCount, retryingCount, pendingStagedCount };
}

async function loadPerTypeStats(supabase: ReturnType<typeof getSupabaseAdmin>, userId: string, runId: string) {
  const { data, error } = await supabase
    .from("bubble_obj_import_run_item")
    .select("object_type,status,total_expected,total_received,total_saved_staging,total_duplicate_ignored,total_pending_review,total_error,total_processed,last_cursor,last_error")
    .eq("run_id", runId)
    .eq("supabase_user_id", userId);
  if (error) throw new Error(error.message);
  const list = (data ?? []) as any[];
  const perType: Record<
    string,
    {
      status: string;
      expected: number;
      received: number;
      savedStaging: number;
      duplicateIgnored: number;
      pendingReview: number;
      error: number;
      processed: number;
      lastCursor: number;
      lastError: string;
    }
  > = {};
  for (const r of list) {
    const key = String(r?.object_type ?? "").trim();
    if (!key) continue;
    perType[key] = {
      status: String(r?.status ?? ""),
      expected: safeInt(r?.total_expected),
      received: safeInt(r?.total_received),
      savedStaging: safeInt(r?.total_saved_staging),
      duplicateIgnored: safeInt(r?.total_duplicate_ignored),
      pendingReview: safeInt(r?.total_pending_review),
      error: safeInt(r?.total_error),
      processed: safeInt(r?.total_processed),
      lastCursor: safeInt(r?.last_cursor),
      lastError: String(r?.last_error ?? ""),
    };
  }
  return perType;
}

async function drainStagingForRun(args: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  userId: string;
  runId: string;
  objectTypes: string[];
  processLimit: number;
  deadlineMs: number;
}) {
  const { supabase, userId, runId, objectTypes, processLimit, deadlineMs } = args;
  const orderIndex = (objectType: string) => {
    const base = String(parseObjectType(objectType).baseType ?? "").trim().toLowerCase();
    if (base === "categorias") return 1;
    if (base === "item") return 2;
    if (base === "custo_medio_item") return 3;
    if (base === "fornecedores") return 4;
    if (base === "itens_fornecedores") return 5;
    if (base === "inventarios") return 6;
    if (base === "itens_inventarios") return 7;
    if (base === "notas_fiscais") return 8;
    if (base === "itens_notas") return 9;
    if (base === "motivos_desperdicios") return 10;
    if (base === "desperdicio") return 11;
    return 99;
  };
  const ordered = [...objectTypes].sort((a, b) => orderIndex(a) - orderIndex(b) || a.localeCompare(b));
  const perTypeProcessed: Record<string, number> = {};
  for (const objectType of ordered) {
    let loops = 0;
    for (; loops < 50 && Date.now() < deadlineMs; loops++) {
      const r = await processStagingBatch({ supabase, userId, runId, objectType, limit: processLimit, statuses: ["staged"] });
      if (r.processed > 0) perTypeProcessed[objectType] = (perTypeProcessed[objectType] ?? 0) + r.processed;
      if (r.processed <= 0) break;
      if (Date.now() + 250 > deadlineMs) break;
    }
  }
  return perTypeProcessed;
}

function parseRetryAfterIso(lastError: string) {
  const s = String(lastError ?? "");
  const m = s.match(/retry_after=([^|]+)/i);
  return m ? String(m[1]).trim() : "";
}

async function releaseDueRetries(args: { supabase: ReturnType<typeof getSupabaseAdmin>; userId: string; runId: string; nowMs: number }) {
  const { supabase, userId, runId, nowMs } = args;
  const { data, error } = await supabase
    .from("bubble_obj_import_run_item")
    .select("id,bubble_user_id,object_type,last_error,updated_at")
    .eq("run_id", runId)
    .eq("supabase_user_id", userId)
    .eq("status", "retrying")
    .order("updated_at", { ascending: true })
    .limit(50);
  if (error) return { updated: 0 };
  const list = (data ?? []) as any[];
  if (!list.length) return { updated: 0 };
  let updated = 0;
  for (const it of list) {
    const retryAfterIso = parseRetryAfterIso(String(it?.last_error ?? ""));
    const retryAfterMs = retryAfterIso ? Date.parse(retryAfterIso) : 0;
    const updatedAtMs = it?.updated_at ? Date.parse(String(it.updated_at)) : 0;
    const due = (retryAfterMs && nowMs >= retryAfterMs) || (!retryAfterMs && updatedAtMs && nowMs - updatedAtMs >= 20_000);
    if (!due) continue;
    const bubbleUserId = String(it?.bubble_user_id ?? "").trim();
    const objectType = String(it?.object_type ?? "").trim();
    if (!bubbleUserId || !objectType) continue;
    await supabase.from("bubble_obj_import_run_item").update({ status: "running" } as any).eq("id", it.id);
    await supabase
      .from("bubble_obj_import_checkpoint")
      .update({ status: "running" } as any)
      .eq("supabase_user_id", userId)
      .eq("bubble_user_id", bubbleUserId)
      .eq("object_type", objectType);
    updated += 1;
  }
  return { updated };
}

async function rebuildEntradasFromControlForCompany(args: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  userId: string;
  companyId: string;
}) {
  const { supabase, userId, companyId } = args;
  const stateId = userScopedId(userId).slice(0, -1);

  const { data: ins, error: insErr } = await supabase.from("insumos_state").select("payload").eq("id", stateId).maybeSingle();
  if (insErr) throw new Error(insErr.message);
  const insRows = Array.isArray((ins as any)?.payload?.rows) ? (((ins as any).payload.rows as any[]) ?? []) : [];
  const insumoByBubbleId = new Map<string, any>(
    insRows
      .map((r) => {
        const id = String((r as any)?.id ?? "");
        const bubbleId = id.includes("insumo:") ? id.split("insumo:", 2)[1] : "";
        return bubbleId ? [bubbleId, r] : null;
      })
      .filter(Boolean) as any,
  );

  const scopeObjectType = (t: string) => `${String(t ?? "").trim()}#${userId}`;
  const fornecedoresKey = scopeObjectType(`fornecedores@${companyId}`);
  const { data: fornRows, error: fornErr } = await supabase
    .from("bubble_obj_import_control")
    .select("bubble_unique_id,raw_payload_json,status")
    .eq("supabase_user_id", userId)
    .eq("bubble_object_type", fornecedoresKey)
    .in("status", ["staged", "processed", "staged_only"])
    .limit(2000);
  if (fornErr) throw new Error(fornErr.message);
  const fornecedorNameById: Record<string, string> = {};
  for (const r of (fornRows ?? []) as any[]) {
    const id = String((r as any)?.bubble_unique_id ?? "").trim();
    if (!id) continue;
    const f = mapFornecedor((r as any)?.raw_payload_json ?? {});
    if (f.nome) fornecedorNameById[id] = f.nome;
  }

  const itensNotasKey = scopeObjectType(`itens_notas@${companyId}`);
  const { data: itensNotaRows, error: itensNotaErr } = await supabase
    .from("bubble_obj_import_control")
    .select("raw_payload_json,status")
    .eq("supabase_user_id", userId)
    .eq("bubble_object_type", itensNotasKey)
    .in("status", ["staged", "processed", "staged_only"])
    .limit(8000);
  if (itensNotaErr) throw new Error(itensNotaErr.message);
  const itensNotasByNotaId = new Map<string, Array<ReturnType<typeof mapItemNota>>>();
  for (const r of (itensNotaRows ?? []) as any[]) {
    const it = mapItemNota((r as any)?.raw_payload_json ?? {});
    if (!it.bubbleNotaId) continue;
    const arr = itensNotasByNotaId.get(it.bubbleNotaId) ?? [];
    arr.push(it);
    itensNotasByNotaId.set(it.bubbleNotaId, arr);
  }

  const notasKey = scopeObjectType(`notas_fiscais@${companyId}`);
  const { data: notasRows, error: notasErr } = await supabase
    .from("bubble_obj_import_control")
    .select("bubble_unique_id,raw_payload_json,status")
    .eq("supabase_user_id", userId)
    .eq("bubble_object_type", notasKey)
    .in("status", ["staged", "processed", "staged_only"])
    .limit(5000);
  if (notasErr) throw new Error(notasErr.message);

  const upserts: any[] = [];
  for (const r of (notasRows ?? []) as any[]) {
    const raw = (r as any)?.raw_payload_json ?? {};
    const nf = mapNotaFiscal(raw);
    if (!nf.bubbleNotaId) continue;
    const fornecedorFromId = nf.fornecedorId ? String(fornecedorNameById[nf.fornecedorId] ?? "").trim() : "";
    const fornecedor = fornecedorFromId || nf.fornecedorNome || String(nf.fornecedorId || "").trim() || "Sem fornecedor";
    const numero = nf.numero || `NF-${String(nf.bubbleNotaId).slice(0, 8)}`;
    const dataLancamento = nf.dataLancamento || nf.dataCriacao || "-";
    const responsavel = nf.responsavel || "";
    const dataCriacao = nf.dataCriacao || dataLancamento || "-";

    const itensDetalhe = itensNotasByNotaId.get(nf.bubbleNotaId) ?? [];
    const itensNota = itensDetalhe.length
      ? itensDetalhe.map((it) => {
          const bubbleItemId = String((it as any)?.bubbleItemId ?? "").trim();
          const insumo = bubbleItemId ? insumoByBubbleId.get(bubbleItemId) ?? null : null;
          const insumoNome = String((insumo as any)?.item ?? "").trim();
          const equivalenteUnidade = String((insumo as any)?.medida ?? "").trim();
          const nomeNaNota = String((it as any)?.nomeItem ?? "").trim() || insumoNome;
          const bubbleItemNotaId = String((it as any)?.bubbleItemNotaId ?? "").trim();
          const idPart = bubbleItemNotaId || bubbleItemId || nf.bubbleNotaId;
          return {
            id: `${userScopedId(userId)}nota_item:${nf.bubbleNotaId}:${idPart}`,
            nomeNaNota,
            unidadeNaNota: "",
            insumoEquivalente: insumoNome || "",
            equivalenteQuantidade: String((it as any)?.quantidade ?? "").trim(),
            equivalenteUnidade,
            subtotal: String((it as any)?.subtotal ?? "").trim(),
            custoUnitario: String((it as any)?.custoUnitario ?? "").trim(),
          };
        })
      : (() => {
          const itensIds = Array.isArray((nf as any).listaItens) ? ((nf as any).listaItens as any[]) : [];
          return itensIds
            .map((bubbleItemId) => {
              const id = String(bubbleItemId ?? "").trim();
              if (!id) return null;
              const insumo = insumoByBubbleId.get(id) ?? null;
              const nomeNaNota = String((insumo as any)?.item ?? "").trim();
              const insumoEquivalente = nomeNaNota || "";
              const equivalenteUnidade = String((insumo as any)?.medida ?? "").trim();
              return {
                id: `${userScopedId(userId)}nota_item:${nf.bubbleNotaId}:${id}`,
                nomeNaNota,
                unidadeNaNota: "",
                insumoEquivalente,
                equivalenteQuantidade: "",
                equivalenteUnidade,
                subtotal: "",
                custoUnitario: "",
              };
            })
            .filter(Boolean);
        })();

    const itensLabel = `${itensNota.length} ${itensNota.length === 1 ? "Item" : "Itens"}`;
    const valorNota = (() => {
      const v = parsePtNumber(String(nf.valorNota ?? ""));
      if (v && v > 0) return formatMoneyBRL(v);
      let sum = 0;
      for (const it of itensNota) {
        const sub = parsePtNumber(String((it as any)?.subtotal ?? ""));
        if (sub) sum += sub;
      }
      return sum > 0 ? formatMoneyBRL(sum) : nf.valorNota || "R$0,00";
    })();

    upserts.push({
      id: buildEntradaId(userId, nf.bubbleNotaId),
      user_id: userId,
      numero,
      data_lancamento: dataLancamento,
      fornecedor,
      valor_nota: valorNota,
      itens: itensLabel,
      responsavel,
      data_criacao: dataCriacao,
      itens_nota: itensNota,
    } as any);
  }

  if (upserts.length) {
    const { error: upErr } = await supabase.from("entradas").upsert(upserts as any, { onConflict: "id" });
    if (upErr) throw new Error(upErr.message);
  }
}

export async function POST(req: NextRequest) {
  let step = "start";
  try {
    step = "auth";
    const ensureStartedAt = nowIso();
    const { userId } = getUserIdFromRequest(req);
    if (!userId || !isUuid(userId)) return json({ ok: false, error: "unauthorized" }, { status: 401 });

    step = "parse_body";
    const body = (await req.json().catch(() => null)) as any;
    const callBudgetMs = typeof body?.callBudgetMs === "number" && Number.isFinite(body.callBudgetMs) && body.callBudgetMs > 0 ? Math.min(20_000, Math.floor(body.callBudgetMs)) : 15_000;
    const tickMaxPages = typeof body?.maxPages === "number" && Number.isFinite(body.maxPages) && body.maxPages > 0 ? Math.min(10, Math.floor(body.maxPages)) : 2;
    const maxTicks = typeof body?.maxTicks === "number" && Number.isFinite(body.maxTicks) && body.maxTicks > 0 ? Math.min(5, Math.floor(body.maxTicks)) : 2;
    const processLimit = typeof body?.processLimit === "number" && Number.isFinite(body.processLimit) && body.processLimit > 0 ? Math.min(500, Math.floor(body.processLimit)) : 250;
    const maxProcessTotal = typeof body?.maxProcessTotal === "number" && Number.isFinite(body.maxProcessTotal) && body.maxProcessTotal > 0 ? Math.min(1500, Math.floor(body.maxProcessTotal)) : 600;

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      step = "supabase_admin";
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    step = "migration_lookup";
    const { data: existingMigration, error: migLookupErr } = await supabase
      .from("bubble_obj_user_migration")
      .select("*")
      .eq("supabase_user_id", userId)
      .maybeSingle();
    if (migLookupErr) return json({ ok: false, error: migLookupErr.message }, { status: 500 });

    const existingEmail = String((existingMigration as any)?.email ?? "").trim().toLowerCase();
    const existingStatus = String((existingMigration as any)?.status ?? "").trim();
    const existingValidationStatus = String((existingMigration as any)?.validation_status ?? "").trim();
    let shouldRebuildFromControl = false;
    if (existingStatus === "completed") {
      const { data: stagedAny, error: stagedErr } = await supabase
        .from("bubble_obj_import_staging")
        .select("id")
        .eq("supabase_user_id", userId)
        .eq("status", "staged")
        .limit(1);
      if (stagedErr) return json({ ok: false, error: stagedErr.message }, { status: 500 });
      const hasStaged = Array.isArray(stagedAny) && stagedAny.length > 0;
      if (!hasStaged && existingValidationStatus.toLowerCase() === "validated")
        return json(
          { ok: true, status: "completed", runId: (existingMigration as any)?.last_run_id ? String((existingMigration as any).last_run_id) : null },
          { status: 200 },
        );
      if (!hasStaged && existingValidationStatus.toLowerCase() !== "validated") shouldRebuildFromControl = true;
    }

    step = "auth_email";
    const accessToken = (req.cookies.get("cmv_at")?.value ?? "").trim();
    const authUser = await supabase.auth.admin.getUserById(userId);
    const email = (authUser.error ? "" : String(authUser.data?.user?.email ?? "").trim().toLowerCase()) || existingEmail || jwtEmail(accessToken);
    if (!email) return json({ ok: false, error: "missing_supabase_email" }, { status: 400 });

    step = "migration_row";
    const row = existingMigration ? (existingMigration as any) : await ensureMigrationRow(supabase, userId, email);

    step = "bubble_user";
    const bubbleUserIdFromRow = String((row as any)?.bubble_user_id ?? "").trim();
    const bubbleUser = bubbleUserIdFromRow ? { bubbleUserId: bubbleUserIdFromRow } : await ensureBubbleUserForEmail(supabase, userId, email);
    const bubbleUserId = String((bubbleUser as any).bubbleUserId ?? "").trim();
    if (!bubbleUserId) return json({ ok: false, error: "missing_bubble_user_id" }, { status: 400 });

    step = "bubble_creds";
    const creds = await getBubbleObjCredentials();
    const batchLimit = 100;
    step = "run_create";
    const runId = await ensureRunForUser(supabase, { userId, baseUrl: creds.baseUrl, batchLimit, prevRunId: row.last_run_id ? String(row.last_run_id) : null });

    step = "object_types";
    const scopeObjectType = (t: string) => `${String(t ?? "").trim()}#${userId}`;

    const baseTypesRaw = (() => {
      const list = initialObjectTypes();
      const out: string[] = [];
      for (const t of list) {
        const v = String(t ?? "").trim();
        if (v) out.push(v);
      }
      if (!out.includes("user")) out.unshift("user");
      if (!out.includes("empresas")) out.splice(1, 0, "empresas");
      return Array.from(new Set(out));
    })();
    const baseTypes = baseTypesRaw.map(scopeObjectType);

    let companyIds: string[] = [];
    try {
      step = "company_discovery";
      const empresasKey = scopeObjectType("empresas");
      const { data, error } = await supabase
        .from("bubble_obj_import_control")
        .select("bubble_unique_id")
        .eq("supabase_user_id", userId)
        .eq("bubble_object_type", empresasKey)
        .in("status", ["staged", "processed", "staged_only"])
        .limit(200);
      if (!error) {
        companyIds = Array.from(new Set((data ?? []).map((x: any) => String(x?.bubble_unique_id ?? "").trim()).filter(Boolean)));
      }
      if (!companyIds.length) companyIds = await discoverCompanyIdsForUser({ creds, bubbleUserId });
    } catch {
      companyIds = [];
    }

    const expandedTypes = companyIds.length ? expandCompanyObjectTypes(companyIds).map(scopeObjectType) : [];
    const objectTypes = Array.from(new Set([...baseTypes, ...expandedTypes]));
    step = "checkpoints_run_items";
    await ensureCheckpointsAndRunItems(supabase, { userId, bubbleUserId, userEmail: email, runId, objectTypes });

    if (shouldRebuildFromControl && companyIds.length) {
      step = "rebuild_control";
      for (const companyId of companyIds.slice(0, 3)) {
        await rebuildEntradasFromControlForCompany({ supabase, userId, companyId });
      }
    }

    step = "attempt";
    const { data: existingAttempt, error: attemptLookupErr } = await supabase
      .from("bubble_obj_user_migration_attempt")
      .select("id,started_at")
      .eq("supabase_user_id", userId)
      .eq("run_id", runId)
      .is("finished_at", null)
      .limit(1)
      .maybeSingle();
    if (attemptLookupErr) return json({ ok: false, error: attemptLookupErr.message }, { status: 500 });
    let attemptId = existingAttempt ? String((existingAttempt as any).id ?? "").trim() : "";
    let attemptStartedAtIso = existingAttempt ? String((existingAttempt as any).started_at ?? "").trim() : "";
    if (!attemptId) {
      const { data: createdAttempt, error: attemptErr } = await supabase
        .from("bubble_obj_user_migration_attempt")
        .insert({ supabase_user_id: userId, email, bubble_user_id: bubbleUserId, run_id: runId, status: "running" } as any)
        .select("id,started_at")
        .maybeSingle();
      if (attemptErr) return json({ ok: false, error: attemptErr.message }, { status: 500 });
      attemptId = String((createdAttempt as any)?.id ?? "").trim();
      attemptStartedAtIso = String((createdAttempt as any)?.started_at ?? "").trim();
    }

    step = "migration_update_running";
    await supabase
      .from("bubble_obj_user_migration")
      .update({ email, bubble_user_id: bubbleUserId, status: "running", last_run_id: runId, last_attempt_at: nowIso(), last_error: "" } as any)
      .eq("supabase_user_id", userId);

    const origin = requestOrigin(req);
    if (!accessToken) return json({ ok: false, error: "unauthorized" }, { status: 401 });
    const cookie = `cmv_at=${accessToken}`;

    const tickUrl = `${origin}/api/bubble-obj/stage/tick`;
    const deadline = Date.now() + callBudgetMs;
    let lastTick: any = null;
    let tickCount = 0;
    let processedInCall = 0;

    step = "release_retries";
    await releaseDueRetries({ supabase, userId, runId, nowMs: Date.now() }).catch(() => null);

    step = "tick_loop";
    while (tickCount < maxTicks && Date.now() < deadline) {
      tickCount += 1;
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) break;
      const tickTimeoutMs = Math.max(1000, Math.min(8000, remainingMs));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), tickTimeoutMs);
      let res: Response;
      let text = "";
      try {
        res = await fetch(tickUrl, {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ runId, maxPages: tickMaxPages }),
          cache: "no-store",
          signal: controller.signal,
        });
        text = await res.text();
      } catch (err) {
        clearTimeout(timer);
        lastTick = { ok: true, transient: true, error: err instanceof Error ? err.message : String(err) };
        break;
      } finally {
        clearTimeout(timer);
      }
      let parsed: any = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { ok: false, error: text };
      }
      if (!res.ok || parsed?.ok !== true) {
        const errMsg = String(parsed?.error ?? "migration_tick_failed");
        const finishIso = nowIso();
        await supabase.from("bubble_obj_user_migration").update({ status: "failed", last_error: errMsg, last_attempt_at: nowIso() } as any).eq("supabase_user_id", userId);
        await supabase
          .from("bubble_obj_user_migration_attempt")
          .update({
            status: "failed",
            error_message: errMsg,
            finished_at: finishIso,
            duration_ms: safeMsBetween(attemptStartedAtIso || null, finishIso),
            validation_status: "failed",
          } as any)
          .eq("supabase_user_id", userId)
          .eq("run_id", runId)
          .is("finished_at", null);
        return json({ ok: false, error: errMsg, runId }, { status: 500 });
      }
      lastTick = parsed;

      if (parsed?.transient === true) break;

      const objectType = String(parsed?.objectType ?? "").trim();
      if (objectType) {
        try {
          const remaining = Math.max(0, maxProcessTotal - processedInCall);
          if (remaining > 0) {
            const r = await processStagingBatch({ supabase, userId, runId, objectType, limit: Math.min(processLimit, remaining), statuses: ["staged"] });
            processedInCall += Math.max(0, Number(r?.processed ?? 0) || 0);
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          const finishIso = nowIso();
          await supabase.from("bubble_obj_user_migration").update({ status: "failed", last_error: errMsg, last_attempt_at: nowIso() } as any).eq("supabase_user_id", userId);
          await supabase
            .from("bubble_obj_user_migration_attempt")
            .update({
              status: "failed",
              error_message: errMsg,
              finished_at: finishIso,
              duration_ms: safeMsBetween(attemptStartedAtIso || null, finishIso),
              validation_status: "failed",
            } as any)
            .eq("supabase_user_id", userId)
            .eq("run_id", runId)
            .is("finished_at", null);
          return json({ ok: false, error: errMsg, runId }, { status: 500 });
        }
      }

      const tickBase = objectType ? String(parseObjectType(objectType).baseType ?? "").trim().toLowerCase() : "";
      if (!companyIds.length && tickBase === "empresas" && parsed?.finishedThisType === true) {
        const empresasKey = scopeObjectType("empresas");
        const { data, error } = await supabase
          .from("bubble_obj_import_control")
          .select("bubble_unique_id")
          .eq("supabase_user_id", userId)
          .eq("bubble_object_type", empresasKey)
          .eq("bubble_user_id", bubbleUserId)
          .in("status", ["staged", "processed", "staged_only"])
          .limit(200);
        if (!error) {
          companyIds = Array.from(new Set((data ?? []).map((x: any) => String(x?.bubble_unique_id ?? "").trim()).filter(Boolean)));
          const more = companyIds.length ? expandCompanyObjectTypes(companyIds).map(scopeObjectType) : [];
          if (more.length) {
            const nextAll = Array.from(new Set([...objectTypes, ...more]));
            objectTypes.length = 0;
            objectTypes.push(...nextAll);
            await ensureCheckpointsAndRunItems(supabase, { userId, bubbleUserId, userEmail: email, runId, objectTypes }).catch(() => null);
          }
        }
      }

      if (parsed?.done === true) break;
      if (parsed?.finishedThisType === true) continue;
      if (Date.now() + 250 > deadline) break;
    }

    if (Date.now() < deadline && processedInCall < maxProcessTotal) {
      step = "process_backlog";
      const { data: stagedRows, error: stagedErr } = await supabase
        .from("bubble_obj_import_staging")
        .select("bubble_object_type")
        .eq("supabase_user_id", userId)
        .eq("status", "staged")
        .order("created_at", { ascending: true })
        .limit(50);
      if (!stagedErr) {
        const stagedTypes = Array.from(new Set((stagedRows ?? []).map((r: any) => String(r?.bubble_object_type ?? "").trim()).filter(Boolean))).slice(0, 3);
        for (const ot of stagedTypes) {
          if (Date.now() >= deadline) break;
          const remaining = Math.max(0, maxProcessTotal - processedInCall);
          if (remaining <= 0) break;
          const r = await processStagingBatch({ supabase, userId, runId, objectType: ot, limit: Math.min(processLimit, remaining), statuses: ["staged"] });
          processedInCall += Math.max(0, Number(r?.processed ?? 0) || 0);
        }
      }
    }

    step = "totals";
    const totalsRes = await updateMigrationTotals(supabase, userId, runId);
    step = "per_type_stats";
    const perTypeStats = await loadPerTypeStats(supabase, userId, runId).catch(() => ({} as any));
    const status =
      totalsRes.errorCount > 0
        ? "failed"
        : totalsRes.pendingCount === 0 && totalsRes.pendingStagedCount === 0 && (totalsRes as any).retryingCount === 0
          ? "completed"
          : "running";
    const finalStatus = status;

    step = "persist";
    await supabase
      .from("bubble_obj_user_migration")
      .update({
        status: finalStatus,
        last_run_id: runId,
        last_attempt_at: nowIso(),
        completed_at: finalStatus === "completed" ? nowIso() : null,
        per_type_stats: perTypeStats as any,
        total_received: totalsRes.totals.received,
        total_saved_staging: totalsRes.totals.savedStaging,
        total_duplicate_ignored: totalsRes.totals.duplicateIgnored,
        total_pending_review: totalsRes.totals.pendingReview,
        total_error: totalsRes.totals.error,
        total_processed: totalsRes.totals.processed,
      } as any)
      .eq("supabase_user_id", userId);

    const attemptFinishedAt = finalStatus === "running" ? null : nowIso();
    await supabase
      .from("bubble_obj_user_migration_attempt")
      .update({
        status: finalStatus === "completed" ? "completed" : finalStatus,
        finished_at: attemptFinishedAt,
        duration_ms: attemptFinishedAt ? safeMsBetween(attemptStartedAtIso || null, attemptFinishedAt) : 0,
        per_type_stats: perTypeStats as any,
      } as any)
      .eq("supabase_user_id", userId)
      .eq("run_id", runId)
      .is("finished_at", null);

    return json(
      {
        ok: true,
        runId,
        status: finalStatus,
        tickCount,
        lastTick,
        callBudgetMs,
        processedInCall,
        totals: totalsRes.totals,
        perType: perTypeStats,
        ensureStartedAt,
        checkpoints: {
          done: totalsRes.doneCount,
          pending: totalsRes.pendingCount,
          retrying: (totalsRes as any).retryingCount ?? 0,
          error: totalsRes.errorCount,
          pendingStaged: totalsRes.pendingStagedCount,
        },
      },
      { status: 200 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const finalMsg = step ? `${step}:${msg}` : msg;
    try {
      const { userId } = getUserIdFromRequest(req);
      if (userId && isUuid(userId)) {
        const supabase = getSupabaseAdmin();
        await supabase.from("bubble_obj_user_migration").update({ status: "failed", last_error: finalMsg, last_attempt_at: nowIso() } as any).eq("supabase_user_id", userId);
      }
    } catch {}
    return json({ ok: false, error: finalMsg }, { status: 500 });
  }
}
