"use client";

export type SectorRow = {
  id: string;
  name: string;
  companyId?: string | null;
  userScopeId?: string | null;
  itemCount?: number;
  createdAt?: string;
  updatedAt?: string;
};

const EVENT_NAME = "cmvfacil:sectors";
let cache: SectorRow[] = [];

function normalizeRows(input: unknown): SectorRow[] {
  if (!Array.isArray(input)) return [];
  const out: SectorRow[] = [];
  for (const r of input) {
    if (!r || typeof r !== "object") continue;
    const row = r as Record<string, unknown>;
    const id = String(row.id ?? "").trim();
    const name = String(row.name ?? "").trim();
    if (!id || !name) continue;
    out.push({
      id,
      name,
      companyId: row.company_id != null || row.companyId != null ? String(row.company_id ?? row.companyId ?? "") : null,
      userScopeId: row.user_scope_id != null || row.userScopeId != null ? String(row.user_scope_id ?? row.userScopeId ?? "") : null,
      itemCount: typeof row.itemCount === "number" ? row.itemCount : typeof row.item_count === "number" ? row.item_count : undefined,
      createdAt: row.created_at != null ? String(row.created_at) : undefined,
      updatedAt: row.updated_at != null ? String(row.updated_at) : undefined,
    });
  }
  return out;
}

export function readSectorsFromStore(): SectorRow[] {
  return cache;
}

export function writeSectorsToStore(rows: SectorRow[]) {
  if (typeof window === "undefined") return;
  const normalized = normalizeRows(rows);
  cache = normalized;
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: normalized }));
}

export function subscribeSectors(listener: (rows: SectorRow[]) => void) {
  if (typeof window === "undefined") return () => {};
  const onEvent = (e: Event) => {
    const ce = e as CustomEvent<unknown>;
    listener(normalizeRows(ce.detail));
  };
  window.addEventListener(EVENT_NAME, onEvent);
  return () => window.removeEventListener(EVENT_NAME, onEvent);
}
