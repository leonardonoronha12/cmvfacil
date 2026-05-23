"use client";

export type FichaTecnicaRow = {
  id: string;
  receita: string;
  precoVenda: string;
  precoVendaSub?: string;
  custoUnitario: string;
  cmvMeta: string;
  cmvAtual: string;
  cmvDelta: string;
  bcg: "estrela" | "cavalo" | "quebra-cabeca" | "abacaxi";
  thumb: "burger" | "duplo" | "triplo";
};

const EVENT = "cmvfacil:fichas_tecnicas:rows";
let cache: FichaTecnicaRow[] = [];

function normalizeRow(input: unknown): FichaTecnicaRow | null {
  if (!input || typeof input !== "object") return null;
  const r = input as Record<string, unknown>;
  const id = String(r.id ?? "").trim();
  const receita = String(r.receita ?? "").trim();
  if (!id || !receita) return null;
  const bcgRaw = String(r.bcg ?? "").trim();
  const thumbRaw = String(r.thumb ?? "").trim();
  const bcg: FichaTecnicaRow["bcg"] =
    bcgRaw === "estrela" || bcgRaw === "cavalo" || bcgRaw === "quebra-cabeca" || bcgRaw === "abacaxi" ? (bcgRaw as any) : "quebra-cabeca";
  const thumb: FichaTecnicaRow["thumb"] = thumbRaw === "burger" || thumbRaw === "duplo" || thumbRaw === "triplo" ? (thumbRaw as any) : "burger";
  const precoVendaSub = String(r.precoVendaSub ?? "").trim();
  return {
    id,
    receita,
    precoVenda: String(r.precoVenda ?? "").trim(),
    precoVendaSub: precoVendaSub ? precoVendaSub : undefined,
    custoUnitario: String(r.custoUnitario ?? "").trim(),
    cmvMeta: String(r.cmvMeta ?? "").trim(),
    cmvAtual: String(r.cmvAtual ?? "").trim(),
    cmvDelta: String(r.cmvDelta ?? "").trim(),
    bcg,
    thumb,
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
  return cache.length ? cache : fallback;
}

export function writeFichasTecnicasToStore(rows: FichaTecnicaRow[]) {
  if (typeof window === "undefined") return;
  const normalized = normalizeRows(rows);
  cache = normalized;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: normalized }));
}

export function subscribeFichasTecnicas(callback: (rows: FichaTecnicaRow[]) => void) {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => callback(((e as CustomEvent).detail ?? []) as FichaTecnicaRow[]);
  window.addEventListener(EVENT, handler as any);
  return () => window.removeEventListener(EVENT, handler as any);
}
