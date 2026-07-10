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

export type EntradasStatePayload = {
  rows: EntradaStoreRow[];
  meta?: { source: "legacy" | "compat"; readOnly: boolean };
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

export async function loadEntradasStateFromSupabase(userId?: string): Promise<EntradasStatePayload> {
  const override = getQaOverridesFromLocation();
  const u = String(userId ?? "").trim() || override.userId;
  const source = override.source;
  const qp = `${u ? `&userId=${encodeURIComponent(u)}` : ""}${source ? `&source=${encodeURIComponent(source)}` : ""}`;
  const res = await fetch(`/api/entradas?ts=${Date.now()}${qp}`, { method: "GET", cache: "no-store" });
  const json = (await res.json().catch(() => null)) as { rows?: EntradaDbRow[]; source?: unknown; readOnly?: unknown; error?: string } | null;
  if (!res.ok || !json?.rows) throw new Error(json?.error || "failed_to_load");
  const sourceLabel = String(json?.source ?? "legacy") === "compat" ? "compat" : "legacy";
  persistPageSource(sourceLabel);
  return { rows: (json.rows ?? []).map(toStoreRow), meta: { source: sourceLabel, readOnly: Boolean(json?.readOnly) } };
}

export async function loadEntradasFromSupabase(userId?: string) {
  const st = await loadEntradasStateFromSupabase(userId);
  return st.rows;
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
