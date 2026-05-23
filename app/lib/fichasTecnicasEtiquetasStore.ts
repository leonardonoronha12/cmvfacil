"use client";

export type FichaTecnicaEtiquetaRow = {
  id: string;
  recipeId: string;
  receita: string;
  responsavel: string;
  quantidade: string;
  unidade: string;
  dataProducao: string;
  dataValidade: string;
};

const EVENT = "cmvfacil:fichas-tecnicas:etiquetas";
let cache: FichaTecnicaEtiquetaRow[] = [];
const STORAGE_KEY = "cmvfacil:fichas-tecnicas:etiquetas:v1";

export function readFichasTecnicasEtiquetasFromStore(fallback: FichaTecnicaEtiquetaRow[] = []) {
  if (typeof window === "undefined") return fallback;
  try {
    if (!cache.length) {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) cache = (JSON.parse(raw) as any[]) ?? [];
    }
  } catch {}
  return cache.length ? cache : fallback;
}

export function writeFichasTecnicasEtiquetasToStore(rows: FichaTecnicaEtiquetaRow[]) {
  if (typeof window === "undefined") return;
  cache = Array.isArray(rows) ? rows : [];
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {}
  window.dispatchEvent(new CustomEvent(EVENT, { detail: cache }));
}

export function subscribeFichasTecnicasEtiquetas(cb: (rows: FichaTecnicaEtiquetaRow[]) => void) {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => cb((e as CustomEvent).detail as FichaTecnicaEtiquetaRow[]);
  window.addEventListener(EVENT, handler as any);
  return () => window.removeEventListener(EVENT, handler as any);
}
