"use client";

import type { EntradaStoreRow } from "./entradasStore";

type EntradaDbRow = {
  id: string;
  numero: string;
  data_lancamento: string;
  fornecedor: string;
  valor_nota: string;
  itens: string;
  responsavel: string;
  data_criacao: string;
  itens_nota: unknown | null;
  created_at: string;
  updated_at: string;
};

function toStoreRow(r: EntradaDbRow): EntradaStoreRow {
  const fallbackValor = String((r as any)?.valorNota ?? (r as any)?.valor ?? "").trim();
  return {
    id: r.id,
    numero: r.numero,
    dataLancamento: r.data_lancamento,
    fornecedor: r.fornecedor,
    valorNota: r.valor_nota || fallbackValor,
    itens: r.itens,
    responsavel: r.responsavel,
    dataCriacao: r.data_criacao,
    itensNota: Array.isArray(r.itens_nota) ? (r.itens_nota as any) : undefined,
  };
}

function toDbRow(r: EntradaStoreRow) {
  return {
    id: r.id,
    numero: r.numero,
    data_lancamento: r.dataLancamento,
    fornecedor: r.fornecedor,
    valor_nota: r.valorNota,
    itens: r.itens,
    responsavel: r.responsavel,
    data_criacao: r.dataCriacao,
    itens_nota: r.itensNota ?? null,
  };
}

export async function loadEntradasFromSupabase() {
  const res = await fetch(`/api/entradas?ts=${Date.now()}`, { method: "GET", cache: "no-store" });
  const json = (await res.json().catch(() => null)) as { rows?: EntradaDbRow[]; error?: string } | null;
  if (!res.ok || !json?.rows) throw new Error(json?.error || "failed_to_load");
  return (json.rows ?? []).map(toStoreRow);
}

export async function upsertEntradaToSupabase(row: EntradaStoreRow) {
  const res = await fetch("/api/entradas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(toDbRow(row)) });
  const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!res.ok || !json?.ok) throw new Error(json?.error || "failed_to_save");
}

export async function deleteEntradaFromSupabase(id: string) {
  const res = await fetch(`/api/entradas?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!res.ok || !json?.ok) throw new Error(json?.error || "failed_to_delete");
}
