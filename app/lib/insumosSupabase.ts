"use client";

import type { InsumoStoreItem } from "./insumosStore";

export type InsumosStatePayload = {
  rows: InsumoStoreItem[];
  categories: string[];
};

function normalizeItem(input: unknown): InsumoStoreItem | null {
  if (!input || typeof input !== "object") return null;
  const r = input as Record<string, unknown>;
  const id = String(r.id ?? "").trim();
  const item = String(r.item ?? "").trim();
  if (!id || !item) return null;
  return {
    id,
    item,
    medida: String(r.medida ?? "").trim() || "Und",
    custoMedio: String(r.custoMedio ?? "").trim() || undefined,
    categoria: String(r.categoria ?? "").trim() || undefined,
    especificacao: String(r.especificacao ?? "").trim() || undefined,
    ocultar: typeof r.ocultar === "boolean" ? (r.ocultar as boolean) : undefined,
  };
}

function normalizeCategories(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const name = String(raw ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

function normalizeRows(input: unknown): InsumoStoreItem[] {
  if (!Array.isArray(input)) return [];
  const out: InsumoStoreItem[] = [];
  for (const raw of input) {
    const it = normalizeItem(raw);
    if (it) out.push(it);
  }
  return out;
}

export async function loadInsumosFromSupabase() {
  const state = await loadInsumosStateFromSupabase();
  return state.rows;
}

export async function loadInsumosStateFromSupabase(): Promise<InsumosStatePayload> {
  const res = await fetch("/api/insumos", { method: "GET" });
  const json = (await res.json().catch(() => null)) as { rows?: unknown[]; categories?: unknown[]; error?: string } | null;
  if (!res.ok || !json) throw new Error(json?.error || "failed_to_load");
  return { rows: normalizeRows(json.rows), categories: normalizeCategories(json.categories) };
}

export async function saveInsumosStateToSupabase(payload: { rows: InsumoStoreItem[]; categories?: string[] }) {
  const res = await fetch("/api/insumos", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!res.ok || !json?.ok) throw new Error(json?.error || "failed_to_save");
}
