"use client";

const KEY = "cmvfacil.desperdicios.badge.seen_ids.v1";

function safeParse(json: string | null): unknown {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function normalizeIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const id = String(raw ?? "").trim();
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function readDesperdiciosSeenIdsFromStore(): string[] {
  if (typeof window === "undefined") return [];
  return normalizeIds(safeParse(window.localStorage.getItem(KEY)));
}

export function writeDesperdiciosSeenIdsToStore(ids: string[]) {
  if (typeof window === "undefined") return;
  const normalized = normalizeIds(ids).slice(-500);
  window.localStorage.setItem(KEY, JSON.stringify(normalized));
}

