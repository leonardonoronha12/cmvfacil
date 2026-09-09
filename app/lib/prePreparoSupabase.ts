"use client";

import type { PrePreparoStoreRow } from "./prePreparoStore";

export type PrePreparoCompatIngredient = {
  id: string;
  ingredientId: string | null;
  item: string;
  quantidade: string;
  unidade: string;
  custo: string;
};

export type PrePreparoCompatEtiqueta = {
  id: string;
  bubble_id: string | null;
  codigo: string;
  dataProducao: string;
  dataValidade: string;
  quantidadeProduzida: string;
};

export type PrePreparoCompatRow = {
  id: string;
  bubble_id: string | null;
  nome: string;
  categoria: string;
  unidade: string;
  rendimento: string;
  validade: string;
  validadeDias: number | null;
  custoTotal: string;
  custoUnitario: string;
  modoPreparo: string;
  ingredientes: PrePreparoCompatIngredient[];
  etiquetas: PrePreparoCompatEtiqueta[];
};

export type PrePreparoStatePayload = {
  rows: PrePreparoStoreRow[];
  meta?: { source: "legacy" | "compat"; readOnly: boolean };
  compat?: { totals: { prePreparos: number }; prePreparos: PrePreparoCompatRow[] };
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

export async function loadPrePreparoStateFromSupabase(userId?: string): Promise<PrePreparoStatePayload> {
  const override = getQaOverridesFromLocation();
  const u = String(userId ?? "").trim() || override.userId;
  const source = override.source;
  const qp = `${u ? `&userId=${encodeURIComponent(u)}` : ""}${source ? `&source=${encodeURIComponent(source)}` : ""}`;
  const res = await fetch(`/api/pre-preparo?ts=${Date.now()}${qp}`, { method: "GET", cache: "no-store" });
  const json = (await res.json().catch(() => null)) as { rows?: unknown[]; compat?: unknown; source?: unknown; readOnly?: unknown; error?: string } | null;
  if (!res.ok || !json) throw new Error(json?.error || `failed_to_load_${res.status}`);
  const isCompat = String(json?.source ?? "legacy") === "compat";
  persistPageSource("legacy");
  return {
    rows: (Array.isArray(json.rows) ? (json.rows as any[]) : []) as PrePreparoStoreRow[],
    compat: (json as any)?.compat,
    meta: { source: "legacy", readOnly: Boolean(json?.readOnly) || isCompat },
  };
}

export async function loadPrePreparoFromSupabase(userId?: string) {
  const st = await loadPrePreparoStateFromSupabase(userId);
  return st.rows;
}

export async function savePrePreparoToSupabase(rows: PrePreparoStoreRow[]) {
  const res = await fetch("/api/pre-preparo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rows }),
  });
  const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!res.ok || !json?.ok) throw new Error(json?.error || `failed_to_save_${res.status}`);
}

export async function loadLivePrePreparoDetails(itemId: string) {
  const res = await fetch("/api/bubble-live/pre-preparo-ingredients", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ itemId }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => null)) as {
    ok?: boolean;
    modoPreparo?: string | null;
    ingredientes?: Array<{ id: string; item: string; quantidade: string; unidade: string; custoCents: number }>;
    error?: string;
  } | null;
  if (!res.ok || !json?.ok) throw new Error(json?.error || `failed_to_load_live_details_${res.status}`);
  return {
    modoPreparo: String(json.modoPreparo ?? "").trim(),
    ingredientes: Array.isArray(json.ingredientes) ? json.ingredientes : [],
  };
}
