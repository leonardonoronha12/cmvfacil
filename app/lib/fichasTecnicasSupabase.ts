"use client";

import type { FichaTecnicaRow } from "./fichasTecnicasStore";

export type FichaTecnicaCompatIngredient = {
  id: string;
  ingredientId: string | null;
  item: string;
  quantidade: string;
  unidade: string;
  custo: string;
};

export type FichaTecnicaCompatRecipe = {
  id: string;
  bubble_id: string | null;
  receita: string;
  categoria: string;
  unidade: string;
  rendimento: string;
  validade: string;
  precoVenda: string;
  precoSugerido: string;
  custoTotal: string;
  custoUnitario: string;
  cmvMeta: string;
  cmvAtual: string;
  quadrante: string;
  modoPreparo: string;
  ingredientes: FichaTecnicaCompatIngredient[];
};

export type FichasTecnicasStatePayload = {
  rows: FichaTecnicaRow[];
  meta?: { source: "legacy" | "compat"; readOnly: boolean };
  compat?: { totals: { recipes: number }; recipes: FichaTecnicaCompatRecipe[] };
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

export async function loadFichasTecnicasStateFromSupabase(userId?: string): Promise<FichasTecnicasStatePayload> {
  const override = getQaOverridesFromLocation();
  const u = String(userId ?? "").trim() || override.userId;
  const source = override.source;
  const qp = `${u ? `&userId=${encodeURIComponent(u)}` : ""}${source ? `&source=${encodeURIComponent(source)}` : ""}`;
  const res = await fetch(`/api/fichas-tecnicas?ts=${Date.now()}${qp}`, { method: "GET", cache: "no-store" });
  const json = (await res.json().catch(() => null)) as { rows?: unknown[]; compat?: unknown; source?: unknown; readOnly?: unknown; error?: string } | null;
  if (!res.ok || !json) throw new Error(json?.error || "failed_to_load");
  const isCompat = String(json?.source ?? "legacy") === "compat";
  persistPageSource(isCompat ? "compat" : "legacy");
  return {
    rows: (Array.isArray(json.rows) ? (json.rows as any[]) : []) as FichaTecnicaRow[],
    compat: (json as any)?.compat,
    meta: { source: isCompat ? "compat" : "legacy", readOnly: Boolean(json?.readOnly) || isCompat },
  };
}

export async function loadFichasTecnicasFromSupabase(userId?: string) {
  const st = await loadFichasTecnicasStateFromSupabase(userId);
  return st.rows;
}

export async function saveFichasTecnicasToSupabase(rows: FichaTecnicaRow[]) {
  const res = await fetch("/api/fichas-tecnicas", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rows }),
  });
  const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!res.ok || !json?.ok) throw new Error(json?.error || "failed_to_save");
}
