"use client";

export type DesperdicioMotivoRow = {
  id: string;
  nome: string;
};

const EVENT = "cmvfacil:desperdicios:motivos";
let cache: DesperdicioMotivoRow[] = [];
const STORAGE_KEY = "cmvfacil:desperdicios:motivos:v1";

function normalizeRows(input: unknown): DesperdicioMotivoRow[] {
  if (!Array.isArray(input)) return [];
  const out: DesperdicioMotivoRow[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const nome = String(r.nome ?? "").trim();
    if (!nome) continue;
    const key = nome.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: String(r.id ?? out.length + 1), nome });
  }
  return out;
}

export function readDesperdicioMotivosFromStore(): DesperdicioMotivoRow[] {
  if (typeof window !== "undefined") {
    try {
      if (!cache.length) {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) cache = normalizeRows(JSON.parse(raw) as unknown);
      }
    } catch {}
  }
  return cache;
}

export function writeDesperdicioMotivosToStore(rows: DesperdicioMotivoRow[]) {
  if (typeof window === "undefined") return;
  const normalized = normalizeRows(rows);
  cache = normalized;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  } catch {}
  window.dispatchEvent(new CustomEvent(EVENT, { detail: normalized }));
}

export function subscribeDesperdicioMotivos(listener: (rows: DesperdicioMotivoRow[]) => void) {
  if (typeof window === "undefined") return () => {};
  const onEvent = (e: Event) => {
    const ce = e as CustomEvent<unknown>;
    listener(normalizeRows(ce.detail));
  };
  window.addEventListener(EVENT, onEvent);
  return () => window.removeEventListener(EVENT, onEvent);
}
