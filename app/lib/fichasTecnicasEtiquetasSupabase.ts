"use client";

import type { FichaTecnicaEtiquetaRow } from "./fichasTecnicasEtiquetasStore";

function normalizeRow(input: unknown): FichaTecnicaEtiquetaRow | null {
  if (!input || typeof input !== "object") return null;
  const r = input as Record<string, unknown>;
  const id = String(r.id ?? "").trim();
  const recipeId = String(r.recipeId ?? "").trim();
  if (!id || !recipeId) return null;
  return {
    id,
    recipeId,
    receita: String(r.receita ?? "").trim(),
    responsavel: String(r.responsavel ?? "").trim(),
    quantidade: String(r.quantidade ?? "").trim(),
    unidade: String(r.unidade ?? "").trim(),
    dataProducao: String(r.dataProducao ?? "").trim(),
    dataValidade: String(r.dataValidade ?? "").trim(),
  };
}

function normalizeRows(input: unknown): FichaTecnicaEtiquetaRow[] {
  if (!Array.isArray(input)) return [];
  const out: FichaTecnicaEtiquetaRow[] = [];
  for (const raw of input) {
    const row = normalizeRow(raw);
    if (row) out.push(row);
  }
  return out;
}

export async function loadFichasTecnicasEtiquetasFromSupabase() {
  const res = await fetch("/api/fichas-tecnicas-etiquetas", { method: "GET" });
  const json = (await res.json().catch(() => null)) as { rows?: unknown[]; error?: string } | null;
  if (!res.ok || !json) throw new Error(json?.error || `failed_to_load_${res.status}`);
  return normalizeRows(json.rows);
}

export async function saveFichasTecnicasEtiquetasToSupabase(rows: FichaTecnicaEtiquetaRow[]) {
  const res = await fetch("/api/fichas-tecnicas-etiquetas", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rows }),
  });
  const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!res.ok || !json?.ok) throw new Error(json?.error || `failed_to_save_${res.status}`);
}

