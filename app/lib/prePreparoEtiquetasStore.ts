"use client";

export type PrePreparoEtiquetaRow = {
  id: string;
  recipeId: string;
  receita: string;
  responsavel: string;
  quantidade: string;
  unidade: string;
  custo: string;
  dataProducao: string;
  dataValidade: string;
  wasteStatus?: "pending" | "launched" | "ignored";
};

const KEY = "cmvfacil.prepreparo.etiquetas.v1";
const EVENT = "cmvfacil:prepreparo:etiquetas";

function safeParse(json: string | null): unknown {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function normalizeRow(input: unknown): PrePreparoEtiquetaRow | null {
  if (!input || typeof input !== "object") return null;
  const r = input as Record<string, unknown>;
  const id = String(r.id ?? "").trim();
  const recipeId = String(r.recipeId ?? "").trim();
  const receita = String(r.receita ?? "").trim();
  const responsavel = String(r.responsavel ?? "").trim();
  const quantidade = String(r.quantidade ?? "").trim();
  const unidade = String(r.unidade ?? "").trim();
  const custo = String(r.custo ?? "").trim();
  const dataProducao = String(r.dataProducao ?? "").trim();
  const dataValidade = String(r.dataValidade ?? "").trim();
  if (!id || !recipeId || !receita || !quantidade || !unidade || !dataValidade) return null;
  const wsRaw = String(r.wasteStatus ?? "").trim().toLowerCase();
  const wasteStatus: "pending" | "launched" | "ignored" = wsRaw === "launched" ? "launched" : wsRaw === "ignored" ? "ignored" : "pending";
  return {
    id,
    recipeId,
    receita,
    responsavel,
    quantidade,
    unidade,
    custo,
    dataProducao,
    dataValidade,
    wasteStatus,
  };
}

function normalizeRows(input: unknown): PrePreparoEtiquetaRow[] {
  if (!Array.isArray(input)) return [];
  const out: PrePreparoEtiquetaRow[] = [];
  for (const raw of input) {
    const row = normalizeRow(raw);
    if (row) out.push(row);
  }
  return out;
}

export function readPrePreparoEtiquetasFromStore(fallback: PrePreparoEtiquetaRow[] = []): PrePreparoEtiquetaRow[] {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(KEY);
  if (raw === null) return fallback;
  return normalizeRows(safeParse(raw));
}

export function writePrePreparoEtiquetasToStore(rows: PrePreparoEtiquetaRow[]) {
  if (typeof window === "undefined") return;
  const normalized = normalizeRows(rows);
  window.localStorage.setItem(KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent(EVENT, { detail: normalized }));
}

export function subscribePrePreparoEtiquetas(listener: (rows: PrePreparoEtiquetaRow[]) => void) {
  if (typeof window === "undefined") return () => {};
  const onEvent = (e: Event) => {
    const ce = e as CustomEvent<unknown>;
    listener(normalizeRows(ce.detail));
  };
  window.addEventListener(EVENT, onEvent);
  return () => window.removeEventListener(EVENT, onEvent);
}
