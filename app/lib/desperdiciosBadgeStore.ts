"use client";

let cache: string[] = [];

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
  return cache;
}

export function writeDesperdiciosSeenIdsToStore(ids: string[]) {
  if (typeof window === "undefined") return;
  const normalized = normalizeIds(ids).slice(-500);
  cache = normalized;
}
