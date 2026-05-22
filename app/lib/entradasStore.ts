"use client";

export type NotaItem = {
  id: string;
  nome: string;
  quantidadeLabel: string;
  subtotalLabel: string;
  custoUnitarioLabel: string;
};

export type EntradaStoreRow = {
  id: string;
  numero: string;
  dataLancamento: string;
  fornecedor: string;
  valorNota: string;
  itens: string;
  responsavel: string;
  dataCriacao: string;
  itensNota?: NotaItem[];
};

const KEY = "cmvfacil.entradas.rows.v1";
const EVENT = "cmvfacil:entradas:rows";

function safeParse(json: string | null): unknown {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function normalizeRow(input: unknown): EntradaStoreRow | null {
  if (!input || typeof input !== "object") return null;
  const r = input as Record<string, unknown>;
  const id = String(r.id ?? "").trim();
  const numero = String(r.numero ?? "").trim();
  const dataLancamento = String(r.dataLancamento ?? "").trim();
  const fornecedor = String(r.fornecedor ?? "").trim();
  const valorNota = String(r.valorNota ?? "").trim() || "R$0,00";
  const itens = String(r.itens ?? "").trim() || "0 Itens";
  const responsavel = String(r.responsavel ?? "").trim() || "-";
  const dataCriacao = String(r.dataCriacao ?? "").trim() || "-";
  if (!id || !numero || !dataLancamento || !fornecedor) return null;
  const itensNotaRaw = r.itensNota;
  const itensNota = Array.isArray(itensNotaRaw)
    ? itensNotaRaw
        .map((x) => {
          if (!x || typeof x !== "object") return null;
          const it = x as Record<string, unknown>;
          const item: NotaItem = {
            id: String(it.id ?? "").trim() || String(Date.now()),
            nome: String(it.nome ?? "").trim(),
            quantidadeLabel: String(it.quantidadeLabel ?? "").trim(),
            subtotalLabel: String(it.subtotalLabel ?? "").trim(),
            custoUnitarioLabel: String(it.custoUnitarioLabel ?? "").trim(),
          };
          if (!item.nome) return null;
          return item;
        })
        .filter((x): x is NotaItem => Boolean(x))
    : undefined;
  return { id, numero, dataLancamento, fornecedor, valorNota, itens, responsavel, dataCriacao, itensNota };
}

function normalizeRows(input: unknown): EntradaStoreRow[] {
  if (!Array.isArray(input)) return [];
  const out: EntradaStoreRow[] = [];
  for (const r of input) {
    const row = normalizeRow(r);
    if (row) out.push(row);
  }
  return out;
}

export function readEntradasFromStore(fallback: EntradaStoreRow[] = []): EntradaStoreRow[] {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(KEY);
  if (raw === null) return fallback;
  return normalizeRows(safeParse(raw));
}

export function writeEntradasToStore(rows: EntradaStoreRow[]) {
  if (typeof window === "undefined") return;
  const normalized = normalizeRows(rows);
  window.localStorage.setItem(KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent(EVENT, { detail: normalized }));
}

export function subscribeEntradas(listener: (rows: EntradaStoreRow[]) => void) {
  if (typeof window === "undefined") return () => {};
  const onEvent = (e: Event) => {
    const ce = e as CustomEvent<unknown>;
    listener(normalizeRows(ce.detail));
  };
  window.addEventListener(EVENT, onEvent);
  return () => window.removeEventListener(EVENT, onEvent);
}
