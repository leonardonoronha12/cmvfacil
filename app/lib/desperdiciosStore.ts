"use client";

export type DesperdicioRow = {
  id: string;
  data: string;
  item: string;
  quantidade: string;
  custo: string;
  motivo: string;
};

const KEY = "cmvfacil.desperdicios.rows.v1";
const EVENT = "cmvfacil:desperdicios:rows";

function safeParse(json: string | null): unknown {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function normalizeRow(input: unknown): DesperdicioRow | null {
  if (!input || typeof input !== "object") return null;
  const r = input as Record<string, unknown>;
  const id = String(r.id ?? "").trim();
  const data = String(r.data ?? "").trim();
  const item = String(r.item ?? "").trim();
  const quantidade = String(r.quantidade ?? "").trim();
  const custo = String(r.custo ?? "").trim();
  const motivo = String(r.motivo ?? "").trim();
  if (!id || !data || !item) return null;
  return { id, data, item, quantidade, custo, motivo };
}

function normalizeRows(input: unknown): DesperdicioRow[] {
  if (!Array.isArray(input)) return [];
  const out: DesperdicioRow[] = [];
  for (const raw of input) {
    const r = normalizeRow(raw);
    if (r) out.push(r);
  }
  return out;
}

export function readDesperdiciosFromStore(fallback: DesperdicioRow[] = []): DesperdicioRow[] {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(KEY);
  if (raw === null) return fallback;
  return normalizeRows(safeParse(raw));
}

export function writeDesperdiciosToStore(rows: DesperdicioRow[]) {
  if (typeof window === "undefined") return;
  const normalized = normalizeRows(rows);
  window.localStorage.setItem(KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent(EVENT, { detail: normalized }));
}

export function subscribeDesperdicios(listener: (rows: DesperdicioRow[]) => void) {
  if (typeof window === "undefined") return () => {};
  const onEvent = (e: Event) => {
    const ce = e as CustomEvent<unknown>;
    listener(normalizeRows(ce.detail));
  };
  window.addEventListener(EVENT, onEvent);
  return () => window.removeEventListener(EVENT, onEvent);
}
