"use client";

import type { InventarioContagem } from "./inventarioStore";

type InventarioDbRow = {
  id: string;
  data: string;
  categorias: unknown;
  created_at: string;
  updated_at: string;
};

export type InventarioCompatItem = {
  id: string;
  itemId: string | null;
  item: string;
  categoria: string;
  unidade: string;
  quantidadeEsperada: string;
  quantidadeContada: string;
  diferenca: string;
  custoMedio: string;
  valorDiferenca: string;
  ocultarCmv: boolean;
};

export type InventarioCompatInventory = {
  id: string;
  bubble_id: string | null;
  dataContagem: string;
  status: string;
  responsavel: string;
  itens: InventarioCompatItem[];
};

export type InventarioStatePayload = {
  rows: InventarioContagem[];
  meta?: { source: "legacy" | "compat"; readOnly: boolean };
  compat?: { totals: { inventories: number; inventoryItems: number }; inventories: InventarioCompatInventory[] };
};

function getQaOverridesFromLocation(): { userId: string; source: "" | "legacy" | "compat" } {
  if (typeof window === "undefined") return { userId: "", source: "" };
  const params = new URLSearchParams(window.location.search);
  const userId = String(params.get("userId") ?? "").trim();
  const sourceRaw = String(params.get("source") ?? "").trim().toLowerCase();
  const source = sourceRaw === "legacy" || sourceRaw === "compat" ? (sourceRaw as "legacy" | "compat") : "";
  return { userId, source };
}

function persistPageSource(source: "legacy" | "compat") {
  if (typeof window === "undefined") return;
  try {
    const p = String(window.location.pathname ?? "").trim();
    if (!p) return;
    window.sessionStorage.setItem(`cmvfacil:pageSource:v1:${p}`, source);
  } catch {}
}

function toStoreRow(r: InventarioDbRow): InventarioContagem {
  return { id: r.id, data: r.data, categorias: Array.isArray(r.categorias) ? (r.categorias as any) : [] } as InventarioContagem;
}

export async function loadInventarioStateFromSupabase(userId?: string): Promise<InventarioStatePayload> {
  const override = getQaOverridesFromLocation();
  const u = String(userId ?? "").trim() || override.userId;
  const source = override.source;
  const qp = `${u ? `&userId=${encodeURIComponent(u)}` : ""}${source ? `&source=${encodeURIComponent(source)}` : ""}`;
  const res = await fetch(`/api/inventario?ts=${Date.now()}${qp}`, { method: "GET", cache: "no-store" });
  const json = (await res.json().catch(() => null)) as {
    rows?: InventarioDbRow[];
    compat?: unknown;
    source?: unknown;
    readOnly?: unknown;
    error?: string;
  } | null;
  if (!res.ok || !json?.rows) throw new Error(json?.error || "failed_to_load");
  const isCompat = String(json?.source ?? "legacy") === "compat";
  persistPageSource("legacy");
  return {
    rows: (json.rows ?? []).map(toStoreRow),
    compat: (json as any)?.compat,
    meta: { source: "legacy", readOnly: Boolean(json?.readOnly) || isCompat },
  };
}

export async function loadInventarioFromSupabase(userId?: string) {
  const st = await loadInventarioStateFromSupabase(userId);
  return st.rows;
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
