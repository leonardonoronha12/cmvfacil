"use client";

import type { InsumoStoreItem } from "./insumosStore";

type InsumoDbRow = {
  id: string;
  item: string;
  medida: string;
  custo_medio: string;
  categoria: string;
  especificacao: string;
  ocultar: boolean;
  created_at: string;
  updated_at: string;
};

function toStoreRow(r: InsumoDbRow): InsumoStoreItem {
  return {
    id: r.id,
    item: r.item,
    medida: r.medida,
    custoMedio: r.custo_medio || undefined,
    categoria: r.categoria || undefined,
    especificacao: r.especificacao || undefined,
    ocultar: Boolean(r.ocultar),
  };
}

function toDbRow(r: InsumoStoreItem) {
  return {
    id: r.id,
    item: r.item,
    medida: r.medida,
    custo_medio: String(r.custoMedio ?? ""),
    categoria: String(r.categoria ?? ""),
    especificacao: String(r.especificacao ?? ""),
    ocultar: Boolean(r.ocultar),
  };
}

export async function loadInsumosFromSupabase() {
  const res = await fetch("/api/insumos", { method: "GET" });
  const json = (await res.json().catch(() => null)) as { rows?: InsumoDbRow[]; error?: string } | null;
  if (!res.ok || !json?.rows) throw new Error(json?.error || "failed_to_load");
  return (json.rows ?? []).map(toStoreRow);
}

export async function syncInsumosToSupabase(rows: InsumoStoreItem[], deleteIds: string[] = []) {
  const res = await fetch("/api/insumos", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rows: rows.map(toDbRow), deleteIds }),
  });
  const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!res.ok || !json?.ok) throw new Error(json?.error || "failed_to_save");
}

export async function deleteInsumoFromSupabase(id: string) {
  const res = await fetch(`/api/insumos?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!res.ok || !json?.ok) throw new Error(json?.error || "failed_to_delete");
}

