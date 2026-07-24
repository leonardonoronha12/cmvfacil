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

export type FornecedoresStatePayload = {
  info: FornecedorInfoMap;
  produtos: FornecedorProdutos;
  equivalencias: FornecedorEquivalenciasMap;
  meta?: { source: "legacy" | "compat"; readOnly: boolean };
};

function getQaOverridesFromLocation() {
  if (typeof window === "undefined") return { userId: "", source: "" };
  const params = new URLSearchParams(window.location.search);
  return {
    userId: String(params.get("userId") ?? "").trim(),
    source: String(params.get("source") ?? "").trim(),
  };
}

function persistPageSource(source: "legacy" | "compat") {
  if (typeof window === "undefined") return;
  try {
    const p = String(window.location.pathname ?? "").trim();
    if (!p) return;
    window.sessionStorage.setItem(`cmvfacil:pageSource:v1:${p}`, source);
  } catch {}
}

function safeObj(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  return input as Record<string, unknown>;
}

function normName(value: string) {
  return value.trim();
}

function isStableSupplierKey(key: string) {
  const s = String(key ?? "").trim();
  if (!s) return false;
  if (s.toLowerCase().startsWith("db:")) return true;
  if (/^\d{10,}$/.test(s)) return true;
  return /^\d{8,}x\d{6,}$/i.test(s);
}

function normalizeInfoMap(input: unknown): FornecedorInfoMap {
  const obj = safeObj(input);
  const out: FornecedorInfoMap = {};
  const score = (row: { fornecedor: string; vendedor: string; whatsapp: string; endereco: string }) =>
    (row.fornecedor ? 2 : 0) + (row.vendedor ? 1 : 0) + (row.whatsapp ? 1 : 0) + (row.endereco ? 1 : 0);
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
    const inputKey = normName(String(k ?? ""));
    const fornecedorKey = isStableSupplierKey(inputKey) ? inputKey : fornecedorLabel.toUpperCase();
    const prev = out[fornecedorKey];
    if (!prev || score(normalizedRow) >= score(prev)) out[fornecedorKey] = normalizedRow;
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
    const key = normName(String(k ?? ""));
    out[isStableSupplierKey(key) ? key : key.toUpperCase()] = Array.from(new Set(items));
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
    const key = normName(String(k ?? ""));
    out[isStableSupplierKey(key) ? key : key.toUpperCase()] = list as any;
  }
  return out;
}

export async function loadFornecedoresStateFromSupabase(userId?: string) {
  const override = getQaOverridesFromLocation();
  const u = String(userId ?? "").trim() || override.userId;
  const source = override.source;
  const qp = `${u ? `&userId=${encodeURIComponent(u)}` : ""}${source ? `&source=${encodeURIComponent(source)}` : ""}`;
  const res = await fetch(`/api/fornecedores?ts=${Date.now()}${qp}`, { method: "GET", cache: "no-store" });
  const json = (await res.json().catch(() => null)) as
    | { row?: FornecedoresStateDbRow | null; source?: string; readOnly?: boolean; error?: string; stage?: string; traceId?: string }
    | null;
  if (!json) throw new Error("failed_to_load");
  if (!res.ok) {
    const stage = String((json as any)?.stage ?? "").trim();
    const traceId = String((json as any)?.traceId ?? "").trim();
    const suffix = [stage ? `stage=${stage}` : "", traceId ? `trace=${traceId}` : ""].filter(Boolean).join(" ");
    throw new Error(`${json?.error || "failed_to_load"}${suffix ? ` (${suffix})` : ""}`);
  }
  const row = json.row;
  const sourceLabel = String(json.source ?? "").trim() === "compat" ? "compat" : "legacy";
  persistPageSource(sourceLabel);
  if (!row)
    return {
      info: {} as FornecedorInfoMap,
      produtos: {} as FornecedorProdutos,
      equivalencias: {} as FornecedorEquivalenciasMap,
      meta: { source: sourceLabel, readOnly: Boolean(json.readOnly) },
    };
  return {
    info: normalizeInfoMap(row.info),
    produtos: normalizeProdutosMap(row.produtos),
    equivalencias: normalizeEquivalenciasMap(row.equivalencias),
    meta: { source: sourceLabel, readOnly: Boolean(json.readOnly) },
  };
}

export async function saveFornecedoresStateToSupabase(payload: { info: FornecedorInfoMap; produtos: FornecedorProdutos; equivalencias: FornecedorEquivalenciasMap }) {
  const res = await fetch("/api/fornecedores", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; stage?: string; traceId?: string } | null;
  if (!res.ok || !json?.ok) {
    const stage = String(json?.stage ?? "").trim();
    const traceId = String(json?.traceId ?? "").trim();
    const suffix = [stage ? `stage=${stage}` : "", traceId ? `trace=${traceId}` : ""].filter(Boolean).join(" ");
    throw new Error(`${json?.error || "failed_to_save"}${suffix ? ` (${suffix})` : ""}`);
  }
}
