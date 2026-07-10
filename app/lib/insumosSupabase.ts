"use client";

import type { InsumoStoreItem } from "./insumosStore";

export type InsumosStatePayload = {
  rows: InsumoStoreItem[];
  categories: string[];
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

function normalizeItem(input: unknown): InsumoStoreItem | null {
  if (!input || typeof input !== "object") return null;
  const r = input as Record<string, unknown>;
  const id = String(r.id ?? "").trim();
  const item = String(r.item ?? "").trim();
  if (!id || !item) return null;
  return {
    id,
    item,
    medida: String(r.medida ?? "").trim() || "Und",
    custoMedio: String(r.custoMedio ?? "").trim() || undefined,
    categoria: String(r.categoria ?? "").trim() || undefined,
    especificacao: String(r.especificacao ?? "").trim() || undefined,
    ocultar: typeof r.ocultar === "boolean" ? (r.ocultar as boolean) : undefined,
  };
}

function normalizeCategories(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const name = String(raw ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

function normalizeRows(input: unknown): InsumoStoreItem[] {
  if (!Array.isArray(input)) return [];
  const out: InsumoStoreItem[] = [];
  for (const raw of input) {
    const it = normalizeItem(raw);
    if (it) out.push(it);
  }
  return out;
}

function persistPageSource(source: "legacy" | "compat") {
  if (typeof window === "undefined") return;
  try {
    const p = String(window.location.pathname ?? "").trim();
    if (!p) return;
    window.sessionStorage.setItem(`cmvfacil:pageSource:v1:${p}`, source);
  } catch {}
}

export async function loadInsumosFromSupabase(userId?: string) {
  const state = await loadInsumosStateFromSupabase(userId);
  return state.rows;
}

export async function loadInsumosStateFromSupabase(userId?: string): Promise<InsumosStatePayload> {
  const override = getQaOverridesFromLocation();
  const u = String(userId ?? "").trim() || override.userId;
  const source = override.source;
  const qp = `${u ? `&userId=${encodeURIComponent(u)}` : ""}${source ? `&source=${encodeURIComponent(source)}` : ""}`;
  const res = await fetch(`/api/insumos?ts=${Date.now()}${qp}`, { method: "GET", cache: "no-store" });
  const json = (await res.json().catch(() => null)) as
    | { rows?: unknown[]; categories?: unknown[]; source?: string; readOnly?: boolean; error?: string }
    | null;
  if (!res.ok || !json) throw new Error(json?.error || `failed_to_load_${res.status}`);
  const sourceLabel = String(json.source ?? "").trim() === "compat" ? "compat" : "legacy";
  persistPageSource(sourceLabel);
  return { rows: normalizeRows(json.rows), categories: normalizeCategories(json.categories), meta: { source: sourceLabel, readOnly: Boolean(json.readOnly) } };
}

export async function saveInsumosStateToSupabase(payload: { rows: InsumoStoreItem[]; categories?: string[] }) {
  const res = await fetch("/api/insumos", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text().catch(() => "");
  const json = (text ? (JSON.parse(text) as any) : null) as { ok?: boolean; error?: string } | null;
  if (!res.ok || !json?.ok) {
    const msg = String(json?.error ?? "").trim() || (text ? text.slice(0, 400) : "") || `failed_to_save_${res.status}`;
    throw new Error(msg);
  }
}
