import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getUserIdFromRequest } from "../../../lib/requestUserId";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return NextResponse.json(data, { ...init, headers });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function getEnv(name: string) {
  const v = (process.env[name] ?? "").trim();
  return v || null;
}

async function ensureBucket(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string) {
  const got = await supabase.storage.getBucket(bucket);
  if (!got.error) return;
  await supabase.storage.createBucket(bucket, { public: false }).catch(() => {});
}

async function uploadJson(supabase: ReturnType<typeof getSupabaseAdmin>, bucket: string, path: string, payload: unknown) {
  const { error } = await supabase.storage.from(bucket).upload(path, JSON.stringify(payload), { contentType: "application/json", upsert: true });
  if (error) throw new Error(error.message);
}

type RebuildStep = {
  key: string;
  label: string;
  kinds: string[];
  status: "pending" | "running" | "done" | "error";
  lastError: string;
  startedAt: string | null;
  finishedAt: string | null;
  lastResult: any;
};

type RebuildState = {
  v: 1;
  runId: string;
  runPrefix: string;
  statePath: string;
  startedAt: string;
  updatedAt: string;
  phase: "deleting" | "importing" | "done" | "error";
  storageOwnerUserId: string;
  prefix: string;
  includeUnknown: boolean;
  only: string[] | null;
  delete: {
    tables: string[];
    index: number;
    status: "pending" | "running" | "done" | "error";
    lastError: string;
  };
  steps: RebuildStep[];
};

export async function POST(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId) return json({ ok: false, error: "unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => null)) as any;
    const confirm = String(body?.confirm ?? "").trim();
    if (confirm !== "RESET_AND_REIMPORT") return json({ ok: false, error: "missing_confirm" }, { status: 400 });

    const master = getEnv("IMPORT_MASTER_USER_ID");
    const isAdminSession = !isUuid(userId);
    if (!isAdminSession && master && master !== userId) return json({ ok: false, error: "forbidden" }, { status: 403 });

    const storageOwnerUserIdRaw = String(body?.storageOwnerUserId ?? "").trim();
    const storageOwnerUserId = isUuid(userId) ? userId : isUuid(storageOwnerUserIdRaw) ? storageOwnerUserIdRaw : "";
    if (!storageOwnerUserId) return json({ ok: false, error: "missing_storageOwnerUserId" }, { status: 400 });

    const bucket = "bubble-imports";
    const prefix = `user:${storageOwnerUserId}`;
    const only = Array.isArray(body?.only) ? (body.only as any[]).map((x) => String(x ?? "").trim()).filter(Boolean) : null;
    const includeUnknown = typeof body?.includeUnknown === "boolean" ? Boolean(body.includeUnknown) : true;

    const supabase = getSupabaseAdmin();
    await ensureBucket(supabase, bucket);

    const toDeleteByIdLike = [
      "insumos_state",
      "fornecedores_state",
      "pre_preparo_state",
      "pre_preparo_etiquetas_state",
      "fichas_tecnicas_state",
      "fichas_tecnicas_etiquetas_state",
      "insumos_templates_state",
      "inventario",
      "desperdicios",
      "entradas",
    ] as const;

    const stepsBase: Array<{ key: string; label: string; kinds: string[] }> = [
      { key: "users", label: "Users", kinds: ["users"] },
      { key: "empresas", label: "Empresas", kinds: ["empresas"] },
      { key: "categorias", label: "Categorias", kinds: ["categorias"] },
      { key: "insumos_custo_medio", label: "Insumos (Custo Médio)", kinds: ["custo_medio"] },
      { key: "insumos_ingredientes", label: "Insumos (Ingredientes)", kinds: ["ingredientes"] },
      { key: "insumos_itens", label: "Insumos (Itens)", kinds: ["itens"] },
      { key: "fornecedores_info", label: "Fornecedores (Info)", kinds: ["fornecedores"] },
      { key: "fornecedores_itens", label: "Fornecedores (Itens)", kinds: ["itens_fornecedores"] },
      { key: "fornecedores_equivalencias", label: "Fornecedores (Equivalências)", kinds: ["equivalencias"] },
      { key: "entradas_notas", label: "Entradas (Notas)", kinds: ["notas_fiscais"] },
      { key: "entradas_itens", label: "Entradas (Itens)", kinds: ["itens_notas"] },
      { key: "inventario", label: "Inventário", kinds: ["inventario"] },
      { key: "desperdicios_motivos", label: "Desperdícios (Motivos)", kinds: ["motivos_desperdicios"] },
      { key: "desperdicios", label: "Desperdícios", kinds: ["desperdicios"] },
      { key: "pre_preparo", label: "Pré-preparo", kinds: ["pre_preparo", "pre_preparo_etiquetas"] },
      { key: "fichas_tecnicas", label: "Fichas Técnicas", kinds: ["fichas_tecnicas"] },
    ];
    const stepsList = includeUnknown ? [...stepsBase, { key: "unknown", label: "Desconhecidos", kinds: ["unknown"] }] : stepsBase;
    const steps: RebuildStep[] = stepsList.map((s) => ({
      ...s,
      status: "pending",
      lastError: "",
      startedAt: null,
      finishedAt: null,
      lastResult: null,
    }));

    const runId = crypto.randomUUID();
    const day = new Date().toISOString().slice(0, 10);
    const runPrefix = `user:${storageOwnerUserId}/${day}/${runId}`;
    const statePath = `${runPrefix}/rebuild-state.json`;
    const now = new Date().toISOString();

    const state: RebuildState = {
      v: 1,
      runId,
      runPrefix,
      statePath,
      startedAt: now,
      updatedAt: now,
      phase: "deleting",
      storageOwnerUserId,
      prefix,
      includeUnknown,
      only,
      delete: { tables: Array.from(toDeleteByIdLike), index: 0, status: "pending", lastError: "" },
      steps,
    };

    await uploadJson(supabase, bucket, statePath, state);
    return json({ ok: true, state }, { status: 200 });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
