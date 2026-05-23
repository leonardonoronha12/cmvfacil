"use client";

const EVENT = "cmvfacil:insumos:categorias";
let cache: string[] = [];

function normalizeCategoryName(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeRows(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const name = normalizeCategoryName(String(raw ?? ""));
    if (!name || name === "-") continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export function readInsumoCategoriasFromStore(): string[] {
  return cache;
}

export function writeInsumoCategoriasToStore(rows: string[]) {
  if (typeof window === "undefined") return;
  const normalized = normalizeRows(rows);
  cache = normalized;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: normalized }));
}

export function subscribeInsumoCategorias(listener: (rows: string[]) => void) {
  if (typeof window === "undefined") return () => {};
  const onEvent = (e: Event) => {
    const ce = e as CustomEvent<unknown>;
    listener(normalizeRows(ce.detail));
  };
  window.addEventListener(EVENT, onEvent);
  return () => window.removeEventListener(EVENT, onEvent);
}
