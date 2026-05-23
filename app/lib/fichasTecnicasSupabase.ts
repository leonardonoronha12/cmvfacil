"use client";

import type { FichaTecnicaRow } from "./fichasTecnicasStore";

export async function loadFichasTecnicasFromSupabase() {
  const res = await fetch("/api/fichas-tecnicas", { method: "GET" });
  const json = (await res.json().catch(() => null)) as { rows?: unknown[]; error?: string } | null;
  if (!res.ok || !json) throw new Error(json?.error || "failed_to_load");
  return (Array.isArray(json.rows) ? (json.rows as any[]) : []) as FichaTecnicaRow[];
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

