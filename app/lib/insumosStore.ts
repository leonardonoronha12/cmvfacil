"use client";

export type InsumoStoreItem = {
  id: string;
  item: string;
  medida: string;
  custoMedio?: string;
  categoria?: string;
  especificacao?: string;
  ocultar?: boolean;
};

const STORAGE_KEY = "cmvfacil.insumos.v1";
const EVENT_NAME = "cmvfacil:insumos";

function safeParse(json: string | null): unknown {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function normalizeRows(input: unknown): InsumoStoreItem[] {
  if (!Array.isArray(input)) return [];
  const out: InsumoStoreItem[] = [];
  for (const r of input) {
    if (!r || typeof r !== "object") continue;
    const row = r as Record<string, unknown>;
    const item = String(row.item ?? "").trim();
    if (!item) continue;
    const custoMedio = String(row.custoMedio ?? "").trim();
    const categoria = String(row.categoria ?? "").trim();
    const especificacao = String(row.especificacao ?? "").trim();
    const ocultarRaw = row.ocultar;
    const ocultar = typeof ocultarRaw === "boolean" ? ocultarRaw : undefined;
    out.push({
      id: String(row.id ?? out.length + 1),
      item,
      medida: String(row.medida ?? "").trim() || "Und",
      custoMedio: custoMedio || undefined,
      categoria: categoria || undefined,
      especificacao: especificacao || undefined,
      ocultar,
    });
  }
  return out;
}

export function readInsumosFromStore(): InsumoStoreItem[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return normalizeRows(safeParse(raw));
}

export function writeInsumosToStore(rows: InsumoStoreItem[]) {
  if (typeof window === "undefined") return;
  const normalized = normalizeRows(rows);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: normalized }));
}

export function subscribeInsumos(listener: (rows: InsumoStoreItem[]) => void) {
  if (typeof window === "undefined") return () => {};
  const onEvent = (e: Event) => {
    const ce = e as CustomEvent<unknown>;
    listener(normalizeRows(ce.detail));
  };
  window.addEventListener(EVENT_NAME, onEvent);
  return () => window.removeEventListener(EVENT_NAME, onEvent);
}
