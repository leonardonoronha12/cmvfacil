"use client";

import type { FornecedorEquivalenciasMap, FornecedorInfoMap, FornecedorProdutos } from "./fornecedoresStore";

type FornecedoresStateDbRow = {
  id: string;
  info: unknown;
  produtos: unknown;
  equivalencias: unknown;
  created_at: string;
  updated_at: string;
};

function safeObj(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  return input as Record<string, unknown>;
}

function normName(value: string) {
  return value.trim();
}

function normalizeInfoMap(input: unknown): FornecedorInfoMap {
  const obj = safeObj(input);
  const out: FornecedorInfoMap = {};
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (!v || typeof v !== "object") continue;
    const row = v as Record<string, unknown>;
    const fornecedor = normName(String(row.fornecedor ?? ""));
    const fornecedorLabel = fornecedor || normName(String(k ?? ""));
    if (!fornecedorLabel) continue;
    const normalizedRow = {
      fornecedor: fornecedorLabel,
      vendedor: String(row.vendedor ?? "").trim(),
      whatsapp: String(row.whatsapp ?? "").trim(),
      endereco: String(row.endereco ?? "").trim(),
    };
    const fornecedorKey = fornecedorLabel.toUpperCase();
    out[fornecedorKey] = normalizedRow;
    const idKey = normName(String(k ?? "")).toUpperCase();
    if (idKey && idKey !== fornecedorKey) out[idKey] = normalizedRow;
  }
  return out;
}

function normalizeProdutosMap(input: unknown): FornecedorProdutos {
  const obj = safeObj(input);
  const out: FornecedorProdutos = {};
  for (const k of Object.keys(obj)) {
    const arr = obj[k];
    if (!Array.isArray(arr)) continue;
    const items = arr.map((x) => String(x ?? "")).map(normName).filter(Boolean);
    if (!items.length) continue;
    out[k.toUpperCase()] = Array.from(new Set(items));
  }
  return out;
}

function normalizeEquivalenciasMap(input: unknown): FornecedorEquivalenciasMap {
  const obj = safeObj(input);
  const out: FornecedorEquivalenciasMap = {};
  for (const k of Object.keys(obj)) {
    const arr = obj[k];
    if (!Array.isArray(arr)) continue;
    const list: any[] = [];
    for (const raw of arr) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      const nomeNaNota = normName(String(r.nomeNaNota ?? ""));
      const insumoEquivalente = normName(String(r.insumoEquivalente ?? ""));
      if (!nomeNaNota || !insumoEquivalente) continue;
      list.push({
        id: String(r.id ?? list.length + 1),
        nomeNaNota,
        unidadeNaNota: normName(String(r.unidadeNaNota ?? "Und")) || "Und",
        insumoEquivalente,
        equivalenteQuantidade: normName(String(r.equivalenteQuantidade ?? "")),
        equivalenteUnidade: normName(String(r.equivalenteUnidade ?? "")),
      });
    }
    if (!list.length) continue;
    out[k.toUpperCase()] = list as any;
  }
  return out;
}

export async function loadFornecedoresStateFromSupabase() {
  const res = await fetch("/api/fornecedores", { method: "GET" });
  const json = (await res.json().catch(() => null)) as { row?: FornecedoresStateDbRow | null; error?: string } | null;
  if (!res.ok || !json) throw new Error(json?.error || "failed_to_load");
  const row = json.row;
  if (!row) return { info: {} as FornecedorInfoMap, produtos: {} as FornecedorProdutos, equivalencias: {} as FornecedorEquivalenciasMap };
  return {
    info: normalizeInfoMap(row.info),
    produtos: normalizeProdutosMap(row.produtos),
    equivalencias: normalizeEquivalenciasMap(row.equivalencias),
  };
}

export async function saveFornecedoresStateToSupabase(payload: { info: FornecedorInfoMap; produtos: FornecedorProdutos; equivalencias: FornecedorEquivalenciasMap }) {
  const res = await fetch("/api/fornecedores", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!res.ok || !json?.ok) throw new Error(json?.error || "failed_to_save");
}
