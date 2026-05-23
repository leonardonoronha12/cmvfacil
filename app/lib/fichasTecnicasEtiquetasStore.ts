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

export function readFichasTecnicasEtiquetasFromStore(fallback: FichaTecnicaEtiquetaRow[] = []) {
  if (typeof window === "undefined") return fallback;
  return cache.length ? cache : fallback;
}

export function writeFichasTecnicasEtiquetasToStore(rows: FichaTecnicaEtiquetaRow[]) {
  if (typeof window === "undefined") return;
  cache = Array.isArray(rows) ? rows : [];
  window.dispatchEvent(new CustomEvent(EVENT, { detail: cache }));
}

export function subscribeFichasTecnicasEtiquetas(cb: (rows: FichaTecnicaEtiquetaRow[]) => void) {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => cb((e as CustomEvent).detail as FichaTecnicaEtiquetaRow[]);
  window.addEventListener(EVENT, handler as any);
  return () => window.removeEventListener(EVENT, handler as any);
}

