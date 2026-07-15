"use client";

export type PrePreparoStoreRow = {
  id: string;
  categoria: string;
  receita: string;
  recipeImage?: string;
  custoTotal: string;
  rendimento: string;
  custoUnitario: string;
  validadeDias?: number;
  ingredientes?: Array<{
    id: string;
    item: string;
    quantidade: string;
    unidade: string;
    custoCents: number;
  }>;
  modoPreparo?: string;
};

const EVENT = "cmvfacil:prepreparo";
let cache: PrePreparoStoreRow[] = [];

function normalizeRows(input: unknown): PrePreparoStoreRow[] {
  if (!Array.isArray(input)) return [];
  const out: PrePreparoStoreRow[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const id = String(r.id ?? "").trim();
    const receita = String(r.receita ?? "").trim();
    if (!id || !receita) continue;
    const recipeImage = String((r as any).recipeImage ?? (r as any).recipeImageUrl ?? (r as any).imageUrl ?? "").trim();
    out.push({
      id,
      categoria: String(r.categoria ?? "").trim() || "-",
      receita,
      recipeImage: recipeImage ? recipeImage : undefined,
      custoTotal: String(r.custoTotal ?? "").trim() || "-",
      rendimento: String(r.rendimento ?? "").trim() || "-",
      custoUnitario: String(r.custoUnitario ?? "").trim() || "-",
      validadeDias: typeof r.validadeDias === "number" && Number.isFinite(r.validadeDias) ? r.validadeDias : undefined,
      ingredientes: Array.isArray(r.ingredientes)
        ? (r.ingredientes as any[]).map((x) => ({
            id: String((x as any)?.id ?? "").trim() || String(Date.now()),
            item: String((x as any)?.item ?? "").trim(),
            quantidade: String((x as any)?.quantidade ?? "").trim(),
            unidade: String((x as any)?.unidade ?? "").trim(),
            custoCents: Number((x as any)?.custoCents ?? 0) || 0,
          }))
        : undefined,
      modoPreparo: String(r.modoPreparo ?? "").trim() || undefined,
    });
  }
  return out;
}

export function readPrePreparoFromStore(fallback: PrePreparoStoreRow[] = []): PrePreparoStoreRow[] {
  return cache.length ? cache : fallback;
}

export function writePrePreparoToStore(rows: PrePreparoStoreRow[]) {
  if (typeof window === "undefined") return;
  const normalized = normalizeRows(rows);
  cache = normalized;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: normalized }));
}

export function subscribePrePreparo(listener: (rows: PrePreparoStoreRow[]) => void) {
  if (typeof window === "undefined") return () => {};
  const onEvent = (e: Event) => {
    const ce = e as CustomEvent<unknown>;
    listener(normalizeRows(ce.detail));
  };
  window.addEventListener(EVENT, onEvent);
  return () => window.removeEventListener(EVENT, onEvent);
}
