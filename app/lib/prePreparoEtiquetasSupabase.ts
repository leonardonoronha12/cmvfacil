"use client";

import type { PrePreparoEtiquetaRow } from "./prePreparoEtiquetasStore";

export async function loadPrePreparoEtiquetasFromSupabase() {
  const res = await fetch(`/api/pre-preparo-etiquetas?ts=${Date.now()}`, { method: "GET", cache: "no-store" });
  const json = (await res.json().catch(() => null)) as { rows?: unknown[]; error?: string } | null;
  if (!res.ok || !json) throw new Error(json?.error || `failed_to_load_${res.status}`);
  return (Array.isArray(json.rows) ? (json.rows as any[]) : []) as PrePreparoEtiquetaRow[];
}

export async function savePrePreparoEtiquetasToSupabase(rows: PrePreparoEtiquetaRow[]) {
  const res = await fetch("/api/pre-preparo-etiquetas", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rows }),
  });
  const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!res.ok || !json?.ok) throw new Error(json?.error || `failed_to_save_${res.status}`);
}
