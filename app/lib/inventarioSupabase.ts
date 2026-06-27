"use client";

import type { InventarioContagem } from "./inventarioStore";

type InventarioDbRow = {
  id: string;
  data: string;
  categorias: unknown;
  created_at: string;
  updated_at: string;
};

export async function loadInventarioFromSupabase() {
  const res = await fetch(`/api/inventario?ts=${Date.now()}`, { method: "GET", cache: "no-store" });
  const json = (await res.json().catch(() => null)) as { rows?: InventarioDbRow[]; error?: string } | null;
  if (!res.ok || !json?.rows) throw new Error(json?.error || "failed_to_load");
  return (json.rows ?? []).map((r) => ({ id: r.id, data: r.data, categorias: Array.isArray(r.categorias) ? (r.categorias as any) : [] })) as InventarioContagem[];
}

export async function upsertInventarioToSupabase(row: InventarioContagem) {
  const res = await fetch("/api/inventario", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: row.id, data: row.data, categorias: row.categorias }),
  });
  const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!res.ok || !json?.ok) throw new Error(json?.error || "failed_to_save");
}

export async function deleteInventarioFromSupabase(id: string) {
  const res = await fetch(`/api/inventario?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!res.ok || !json?.ok) throw new Error(json?.error || "failed_to_delete");
}
