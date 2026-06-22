"use client";

export type FichaTecnicaRow = {
  id: string;
  origin?: "manual" | "bubble";
  receita: string;
  precoVenda: string;
  precoVendaSub?: string;
  custoUnitario: string;
  cmvMeta: string;
  cmvAtual: string;
  cmvDelta: string;
  bcg: "estrela" | "cavalo" | "quebra-cabeca" | "abacaxi";
  thumb: "burger" | "duplo" | "triplo";
  recipeImage?: string;
  popularidade?: "alta" | "baixa";
  ingredientsTotal?: number;
  recipeYield?: number;
  ingredientRows?: Array<{
    id: string;
    ingredientId: string;
    item: string;
    quantidade: string;
    unidade: string;
    custoTotal: number;
  }>;
  modoPreparo?: string;
};

const EVENT = "cmvfacil:fichas_tecnicas:rows";
let cache: FichaTecnicaRow[] = [];
const STORAGE_KEY = "cmvfacil:fichas_tecnicas:rows:v1";

function normalizeRow(input: unknown): FichaTecnicaRow | null {
  if (!input || typeof input !== "object") return null;
  const r = input as Record<string, unknown>;
  const id = String(r.id ?? "").trim();
  const receita = String(r.receita ?? "").trim();
  if (!id || !receita) return null;
  const originRaw = String(r.origin ?? "").trim().toLowerCase();
  const origin: FichaTecnicaRow["origin"] = originRaw === "manual" || originRaw === "bubble" ? (originRaw as any) : undefined;
  const bcgRaw = String(r.bcg ?? "").trim();
  const thumbRaw = String(r.thumb ?? "").trim();
  const bcg: FichaTecnicaRow["bcg"] =
    bcgRaw === "estrela" || bcgRaw === "cavalo" || bcgRaw === "quebra-cabeca" || bcgRaw === "abacaxi" ? (bcgRaw as any) : "quebra-cabeca";
  const thumb: FichaTecnicaRow["thumb"] = thumbRaw === "burger" || thumbRaw === "duplo" || thumbRaw === "triplo" ? (thumbRaw as any) : "burger";
  const precoVendaSub = String(r.precoVendaSub ?? "").trim();
  const recipeImage = String(r.recipeImage ?? "").trim();
  const popularidadeRaw = String(r.popularidade ?? "").trim().toLowerCase();
  const popularidade: FichaTecnicaRow["popularidade"] = popularidadeRaw === "alta" || popularidadeRaw === "baixa" ? (popularidadeRaw as any) : undefined;
  const ingredientsTotal = typeof r.ingredientsTotal === "number" && Number.isFinite(r.ingredientsTotal) && r.ingredientsTotal >= 0 ? r.ingredientsTotal : undefined;
  const recipeYield = typeof r.recipeYield === "number" && Number.isFinite(r.recipeYield) && r.recipeYield > 0 ? r.recipeYield : undefined;
  const modoPreparo = String(r.modoPreparo ?? "");
  const ingredientRows = Array.isArray(r.ingredientRows)
    ? (r.ingredientRows as any[])
        .map((raw) => {
          if (!raw || typeof raw !== "object") return null;
          const rr = raw as Record<string, unknown>;
          const rid = String(rr.id ?? "").trim();
          const item = String(rr.item ?? "").trim();
          if (!rid || !item) return null;
          const ingredientId = String(rr.ingredientId ?? "").trim();
          const quantidade = String(rr.quantidade ?? "").trim();
          const unidade = String(rr.unidade ?? "").trim() || "Und";
          const custoTotal = typeof rr.custoTotal === "number" && Number.isFinite(rr.custoTotal) ? rr.custoTotal : 0;
          return { id: rid, ingredientId, item, quantidade, unidade, custoTotal };
        })
        .filter(Boolean)
    : undefined;
  return {
    id,
    origin,
    receita,
    precoVenda: String(r.precoVenda ?? "").trim(),
    precoVendaSub: precoVendaSub ? precoVendaSub : undefined,
    custoUnitario: String(r.custoUnitario ?? "").trim(),
    cmvMeta: String(r.cmvMeta ?? "").trim(),
    cmvAtual: String(r.cmvAtual ?? "").trim(),
    cmvDelta: String(r.cmvDelta ?? "").trim(),
    bcg,
    thumb,
    recipeImage: recipeImage ? recipeImage : undefined,
    popularidade,
    ingredientsTotal,
    recipeYield,
    ingredientRows: ingredientRows && ingredientRows.length ? (ingredientRows as any) : undefined,
    modoPreparo: modoPreparo ? modoPreparo : undefined,
  };
}

function normalizeRows(input: unknown): FichaTecnicaRow[] {
  if (!Array.isArray(input)) return [];
  const out: FichaTecnicaRow[] = [];
  for (const raw of input) {
    const row = normalizeRow(raw);
    if (row) out.push(row);
  }
  return out;
}

export function readFichasTecnicasFromStore(fallback: FichaTecnicaRow[] = []): FichaTecnicaRow[] {
  if (typeof window !== "undefined") {
    try {
      if (!cache.length) {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) cache = normalizeRows(JSON.parse(raw) as unknown);
      }
    } catch {}
  }
  return cache.length ? cache : fallback;
}

export function writeFichasTecnicasToStore(rows: FichaTecnicaRow[]) {
  if (typeof window === "undefined") return;
  const normalized = normalizeRows(rows);
  cache = normalized;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  } catch {}
  window.dispatchEvent(new CustomEvent(EVENT, { detail: normalized }));
}

export function subscribeFichasTecnicas(callback: (rows: FichaTecnicaRow[]) => void) {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => callback(((e as CustomEvent).detail ?? []) as FichaTecnicaRow[]);
  window.addEventListener(EVENT, handler as any);
  return () => window.removeEventListener(EVENT, handler as any);
}
