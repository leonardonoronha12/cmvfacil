"use client";

import type { DesperdicioRow } from "./desperdiciosStore";

type DesperdicioDbRow = {
  id: string;
  data: string;
  item: string;
  quantidade: string;
  custo: string;
  motivo: string;
  created_at: string;
  updated_at: string;
};

export async function loadDesperdiciosFromSupabase() {
  const res = await fetch(`/api/desperdicios?ts=${Date.now()}`, { method: "GET", cache: "no-store" });
  const json = (await res.json().catch(() => null)) as { rows?: DesperdicioDbRow[]; error?: string } | null;
  if (!res.ok || !json?.rows) throw new Error(json?.error || "failed_to_load");
  return (json.rows ?? []).map((r) => ({ id: r.id, data: r.data, item: r.item, quantidade: r.quantidade, custo: r.custo, motivo: r.motivo })) as DesperdicioRow[];
}

export async function upsertDesperdicioToSupabase(row: DesperdicioRow) {
  const res = await fetch("/api/desperdicios", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(row),
  });
  const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!res.ok || !json?.ok) throw new Error(json?.error || "failed_to_save");
}

export async function deleteDesperdicioFromSupabase(id: string) {
  const res = await fetch(`/api/desperdicios?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!res.ok || !json?.ok) throw new Error(json?.error || "failed_to_delete");
}
