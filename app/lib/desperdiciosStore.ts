"use client";

import { readTableCache, writeTableCache } from "./tableCache";

export type DesperdicioRow = {
  id: string;
  data: string;
  item: string;
  quantidade: string;
  custo: string;
  motivo: string;
};

const EVENT = "cmvfacil:desperdicios:rows";
let cache: DesperdicioRow[] = [];

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
  if (!cache.length) cache = normalizeRows(readTableCache<unknown>("desperdicios", []));
  return cache.length ? cache : fallback;
}

export function writeDesperdiciosToStore(rows: DesperdicioRow[]) {
  if (typeof window === "undefined") return;
  const normalized = normalizeRows(rows);
  cache = normalized;
  writeTableCache("desperdicios", normalized);
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
