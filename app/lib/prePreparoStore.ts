"use client";

export type PrePreparoStoreRow = {
  id: string;
  categoria: string;
  receita: string;
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

const KEY = "cmvfacil.prepreparo.v1";
const EVENT = "cmvfacil:prepreparo";

function safeParse(json: string | null): unknown {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function normalizeRows(input: unknown): PrePreparoStoreRow[] {
  if (!Array.isArray(input)) return [];
  const out: PrePreparoStoreRow[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const id = String(r.id ?? "").trim();
    const receita = String(r.receita ?? "").trim();
    if (!id || !receita) continue;
    out.push({
      id,
      categoria: String(r.categoria ?? "").trim() || "-",
      receita,
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
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(KEY);
  if (raw === null) return fallback;
  return normalizeRows(safeParse(raw));
}

export function writePrePreparoToStore(rows: PrePreparoStoreRow[]) {
  if (typeof window === "undefined") return;
  const normalized = normalizeRows(rows);
  window.localStorage.setItem(KEY, JSON.stringify(normalized));
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
