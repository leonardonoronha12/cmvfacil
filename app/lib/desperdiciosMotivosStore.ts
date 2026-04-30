"use client";

export type DesperdicioMotivoRow = {
  id: string;
  nome: string;
};

const KEY = "cmvfacil.desperdicios.motivos.v1";
const EVENT = "cmvfacil:desperdicios:motivos";

function safeParse(json: string | null): unknown {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

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
  if (typeof window === "undefined") return [];
  return normalizeRows(safeParse(window.localStorage.getItem(KEY)));
}

export function writeDesperdicioMotivosToStore(rows: DesperdicioMotivoRow[]) {
  if (typeof window === "undefined") return;
  const normalized = normalizeRows(rows);
  window.localStorage.setItem(KEY, JSON.stringify(normalized));
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

