"use client";

export type FornecedorInfo = {
  fornecedor: string;
  vendedor: string;
  whatsapp: string;
  endereco: string;
};

export type FornecedorProdutos = Record<string, string[]>;
export type FornecedorInfoMap = Record<string, FornecedorInfo>;
export type FornecedorItemEquivalencia = {
  id: string;
  nomeNaNota: string;
  unidadeNaNota: string;
  insumoEquivalente: string;
  equivalenteQuantidade: string;
  equivalenteUnidade: string;
};
export type FornecedorEquivalenciasMap = Record<string, FornecedorItemEquivalencia[]>;

const INFO_EVENT = "cmvfacil:fornecedores:info";
const PROD_EVENT = "cmvfacil:fornecedores:produtos";
const MAP_EVENT = "cmvfacil:fornecedores:mapa";
let infoCache: FornecedorInfoMap = {};
let prodCache: FornecedorProdutos = {};
let mapCache: FornecedorEquivalenciasMap = {};

function normName(value: string) {
  return value.trim();
}

function isStableSupplierKey(key: string) {
  const s = String(key ?? "").trim();
  if (!s) return false;
  if (s.toLowerCase().startsWith("db:")) return true;
  if (/^\d{10,}$/.test(s)) return true;
  return /^\d{8,}x\d{6,}$/i.test(s);
}

function normalizeInfoMap(input: unknown): FornecedorInfoMap {
  if (!input || typeof input !== "object") return {};
  const obj = input as Record<string, unknown>;
  const out: FornecedorInfoMap = {};
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (!v || typeof v !== "object") continue;
    const row = v as Record<string, unknown>;
    const fornecedor = normName(String(row.fornecedor ?? ""));
    const fornecedorLabel = fornecedor || normName(String(k ?? ""));
    if (!fornecedorLabel) continue;
    const normalizedRow = {
      fornecedor: fornecedorLabel,
      vendedor: String(row.vendedor ?? "").trim(),
      whatsapp: String(row.whatsapp ?? "").trim(),
      endereco: String(row.endereco ?? "").trim(),
    };
    const inputKey = normName(String(k ?? ""));
    const primaryKey = (isStableSupplierKey(inputKey) ? inputKey : fornecedorLabel).toUpperCase();
    if (!primaryKey) continue;
    out[primaryKey] = normalizedRow;
  }
  return out;
}

function normalizeProdutosMap(input: unknown): FornecedorProdutos {
  if (!input || typeof input !== "object") return {};
  const obj = input as Record<string, unknown>;
  const out: FornecedorProdutos = {};
  for (const k of Object.keys(obj)) {
    const arr = obj[k];
    if (!Array.isArray(arr)) continue;
    const items = arr.map((x) => String(x ?? "")).map(normName).filter(Boolean);
    if (!items.length) continue;
    out[k.toUpperCase()] = Array.from(new Set(items));
  }
  return out;
}

function normalizeEquivalenciasMap(input: unknown): FornecedorEquivalenciasMap {
  if (!input || typeof input !== "object") return {};
  const obj = input as Record<string, unknown>;
  const out: FornecedorEquivalenciasMap = {};
  for (const k of Object.keys(obj)) {
    const arr = obj[k];
    if (!Array.isArray(arr)) continue;
    const list: FornecedorItemEquivalencia[] = [];
    for (const raw of arr) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      const nomeNaNota = normName(String(r.nomeNaNota ?? ""));
      const insumoEquivalente = normName(String(r.insumoEquivalente ?? ""));
      if (!nomeNaNota || !insumoEquivalente) continue;
      list.push({
        id: String(r.id ?? list.length + 1),
        nomeNaNota,
        unidadeNaNota: normName(String(r.unidadeNaNota ?? "Und")) || "Und",
        insumoEquivalente,
        equivalenteQuantidade: normName(String(r.equivalenteQuantidade ?? "")),
        equivalenteUnidade: normName(String(r.equivalenteUnidade ?? "")),
      });
    }
    if (!list.length) continue;
    out[k.toUpperCase()] = list;
  }
  return out;
}

export function readFornecedorInfoMap(): FornecedorInfoMap {
  return infoCache;
}

export function writeFornecedorInfoMap(map: FornecedorInfoMap) {
  if (typeof window === "undefined") return;
  const normalized = normalizeInfoMap(map);
  infoCache = normalized;
  window.dispatchEvent(new CustomEvent(INFO_EVENT, { detail: normalized }));
}

export function subscribeFornecedorInfo(listener: (map: FornecedorInfoMap) => void) {
  if (typeof window === "undefined") return () => {};
  const onEvent = (e: Event) => {
    const ce = e as CustomEvent<unknown>;
    listener(normalizeInfoMap(ce.detail));
  };
  window.addEventListener(INFO_EVENT, onEvent);
  return () => window.removeEventListener(INFO_EVENT, onEvent);
}

export function readFornecedorProdutosMap(): FornecedorProdutos {
  return prodCache;
}

export function writeFornecedorProdutosMap(map: FornecedorProdutos) {
  if (typeof window === "undefined") return;
  const normalized = normalizeProdutosMap(map);
  prodCache = normalized;
  window.dispatchEvent(new CustomEvent(PROD_EVENT, { detail: normalized }));
}

export function subscribeFornecedorProdutos(listener: (map: FornecedorProdutos) => void) {
  if (typeof window === "undefined") return () => {};
  const onEvent = (e: Event) => {
    const ce = e as CustomEvent<unknown>;
    listener(normalizeProdutosMap(ce.detail));
  };
  window.addEventListener(PROD_EVENT, onEvent);
  return () => window.removeEventListener(PROD_EVENT, onEvent);
}

export function readFornecedorEquivalenciasMap(): FornecedorEquivalenciasMap {
  return mapCache;
}

export function writeFornecedorEquivalenciasMap(map: FornecedorEquivalenciasMap) {
  if (typeof window === "undefined") return;
  const normalized = normalizeEquivalenciasMap(map);
  mapCache = normalized;
  window.dispatchEvent(new CustomEvent(MAP_EVENT, { detail: normalized }));
}

export function subscribeFornecedorEquivalencias(listener: (map: FornecedorEquivalenciasMap) => void) {
  if (typeof window === "undefined") return () => {};
  const onEvent = (e: Event) => {
    const ce = e as CustomEvent<unknown>;
    listener(normalizeEquivalenciasMap(ce.detail));
  };
  window.addEventListener(MAP_EVENT, onEvent);
  return () => window.removeEventListener(MAP_EVENT, onEvent);
}
