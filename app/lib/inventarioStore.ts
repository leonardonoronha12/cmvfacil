"use client";

export type InventarioItemRow = {
  id: string;
  item: string;
  unidade: string;
  estoqueFinal: string;
  removido?: boolean;
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
  return cache.length ? cache : fallback;
}

export function writeInventarioToStore(rows: InventarioContagem[]) {
  if (typeof window === "undefined") return;
  const normalized = normalizeContagens(rows);
  cache = normalized;
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
