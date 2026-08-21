"use client";

import { readTableCache, writeTableCache } from "./tableCache";

export type InventarioItemRow = {
  id: string;
  item: string;
  unidade: string;
  estoqueFinal: string;
  removido?: boolean;
  sectorCounts?: Record<string, string>;
};

export type InventarioCategoria = {
  id: string;
  nome: string;
  status: "pendente" | "concluida";
  itens: InventarioItemRow[];
};

export type InventarioContagem = {
  id: string;
  data: string;
  categorias: InventarioCategoria[];
  created_at?: string;
  updated_at?: string;
};

const EVENT = "cmvfacil:inventario:contagens";
let cache: InventarioContagem[] = [];

function normalizeItem(input: unknown): InventarioItemRow | null {
  if (!input || typeof input !== "object") return null;
  const r = input as Record<string, unknown>;
  const id = String(r.id ?? "").trim();
  const item = String(r.item ?? "").trim();
  if (!id || !item) return null;
  return {
    id,
    item,
    unidade: String(r.unidade ?? "").trim() || "Und",
    estoqueFinal: String(r.estoqueFinal ?? "").trim(),
    removido: Boolean(r.removido),
    sectorCounts: typeof r.sectorCounts === "object" && r.sectorCounts != null
      ? (() => {
          const obj = r.sectorCounts as Record<string, unknown>;
          const out: Record<string, string> = {};
          for (const k of Object.keys(obj)) out[k] = String(obj[k] ?? "");
          return out;
        })()
      : undefined,
  };
}

function normalizeCategoria(input: unknown): InventarioCategoria | null {
  if (!input || typeof input !== "object") return null;
  const r = input as Record<string, unknown>;
  const id = String(r.id ?? "").trim();
  const nome = String(r.nome ?? "").trim();
  if (!id || !nome) return null;
  const statusRaw = String(r.status ?? "pendente");
  const status: "pendente" | "concluida" = statusRaw === "concluida" ? "concluida" : "pendente";
  const itensRaw = r.itens;
  const itens = Array.isArray(itensRaw) ? itensRaw.map(normalizeItem).filter((x): x is InventarioItemRow => Boolean(x)) : [];
  return { id, nome, status, itens };
}

function normalizeContagem(input: unknown): InventarioContagem | null {
  if (!input || typeof input !== "object") return null;
  const r = input as Record<string, unknown>;
  const id = String(r.id ?? "").trim();
  const data = String(r.data ?? "").trim();
  if (!id || !data) return null;
  const categoriasRaw = r.categorias;
  const categorias = Array.isArray(categoriasRaw)
    ? categoriasRaw.map(normalizeCategoria).filter((x): x is InventarioCategoria => Boolean(x))
    : [];
  return { id, data, categorias };
}

function normalizeContagens(input: unknown): InventarioContagem[] {
  if (!Array.isArray(input)) return [];
  const out: InventarioContagem[] = [];
  for (const raw of input) {
    const c = normalizeContagem(raw);
    if (c) out.push(c);
  }
  return out;
}

export function readInventarioFromStore(fallback: InventarioContagem[] = []): InventarioContagem[] {
  if (!cache.length) cache = normalizeContagens(readTableCache<unknown>("inventario", []));
  return cache.length ? cache : fallback;
}

export function writeInventarioToStore(rows: InventarioContagem[]) {
  if (typeof window === "undefined") return;
  const normalized = normalizeContagens(rows);
  cache = normalized;
  writeTableCache("inventario", normalized);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: normalized }));
}

export function subscribeInventario(listener: (rows: InventarioContagem[]) => void) {
  if (typeof window === "undefined") return () => {};
  const onEvent = (e: Event) => {
    const ce = e as CustomEvent<unknown>;
    listener(normalizeContagens(ce.detail));
  };
  window.addEventListener(EVENT, onEvent);
  return () => window.removeEventListener(EVENT, onEvent);
}
