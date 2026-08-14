"use client";

import type { SectorRow } from "./sectorsStore";

export type SectorStatePayload = {
  sectors: SectorRow[];
  itemLinks?: Array<{ itemId: string; sectorId: string }>;
  userId?: string | null;
  companyId?: string | null;
};

function getQaOverrides() {
  if (typeof window === "undefined") return { userId: "", source: "" };
  const params = new URLSearchParams(window.location.search);
  return {
    userId: String(params.get("userId") ?? "").trim(),
    source: String(params.get("source") ?? "").trim(),
  };
}

function buildQuery(args: { userId?: string }) {
  const o = getQaOverrides();
  const u = String(args.userId ?? "").trim() || o.userId;
  return u ? `&userId=${encodeURIComponent(u)}` : "";
}

export async function loadSectorsFromSupabase(userId?: string): Promise<SectorStatePayload> {
  const qp = buildQuery({ userId });
  const res = await fetch(`/api/sectors?ts=${Date.now()}${qp}`, { method: "GET", cache: "no-store" });
  const json = (await res.json().catch(() => null)) as
    | { sectors?: unknown[]; itemLinks?: unknown[]; userId?: unknown; companyId?: unknown; error?: string }
    | null;
  if (!res.ok || !json) throw new Error(json?.error || `failed_to_load_sectors_${res.status}`);
  const sectors = (Array.isArray(json.sectors) ? json.sectors : []) as any[];
  const itemLinks = Array.isArray(json.itemLinks) ? (json.itemLinks as any[]) : [];
  const typedSectors: SectorRow[] = [];
  for (const s of sectors) {
    if (!s || typeof s !== "object") continue;
    const r = s as Record<string, unknown>;
    const id = String(r.id ?? "").trim();
    const name = String(r.name ?? "").trim();
    if (!id || !name) continue;
    typedSectors.push({
      id,
      name,
      companyId: r.company_id != null ? String(r.company_id) : null,
      userScopeId: r.user_scope_id != null ? String(r.user_scope_id) : null,
      itemCount: typeof r.itemCount === "number" ? r.itemCount : typeof r.item_count === "number" ? r.item_count : undefined,
      createdAt: r.created_at != null ? String(r.created_at) : undefined,
      updatedAt: r.updated_at != null ? String(r.updated_at) : undefined,
    });
  }
  return {
    sectors: typedSectors,
    itemLinks: itemLinks.map((l) => ({ itemId: String((l as any).itemId ?? (l as any).item_id ?? ""), sectorId: String((l as any).sectorId ?? (l as any).sector_id ?? "") })).filter((x) => x.itemId && x.sectorId),
    userId: json.userId != null ? String(json.userId) : null,
    companyId: json.companyId != null ? String(json.companyId) : null,
  };
}

export async function saveSectorToSupabase(sector: { id?: string; name: string }): Promise<SectorRow> {
  const qp = buildQuery({});
  const res = await fetch(`/api/sectors?ts=${Date.now()}${qp}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(sector),
  });
  const json = (await res.json().catch(() => null)) as { sector?: unknown; ok?: boolean; error?: string } | null;
  if (!res.ok || !json?.ok || !json.sector) throw new Error(json?.error || `failed_to_save_sector_${res.status}`);
  const s = json.sector as Record<string, unknown>;
  return {
    id: String(s.id ?? "").trim(),
    name: String(s.name ?? "").trim(),
    companyId: s.company_id != null ? String(s.company_id) : null,
    userScopeId: s.user_scope_id != null ? String(s.user_scope_id) : null,
  };
}

export async function deleteSectorFromSupabase(id: string): Promise<{ deleted: boolean }> {
  const qp = buildQuery({});
  const url = `/api/sectors?ts=${Date.now()}${qp}&id=${encodeURIComponent(id)}`;
  const res = await fetch(url, { method: "DELETE" });
  const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; links?: unknown } | null;
  if (!res.ok || !json?.ok) {
    const err: any = new Error(json?.error || `failed_to_delete_sector_${res.status}`);
    err.payload = json;
    throw err;
  }
  return { deleted: true };
}

export async function saveItemSectorsToSupabase(itemSectors: Array<{ itemId: string; sectorIds: string[] }>): Promise<{ ok: boolean }> {
  const qp = buildQuery({});
  const res = await fetch(`/api/item-sectors?ts=${Date.now()}${qp}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ itemSectors }),
  });
  const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!res.ok || !json?.ok) throw new Error(json?.error || `failed_to_save_item_sectors_${res.status}`);
  return { ok: true };
}

export async function saveInventorySectorCountToSupabase(args: {
  inventoryId: string;
  itemId: string;
  sectorId: string;
  quantityRaw: string;
}): Promise<{ ok: boolean; countedAt?: string }> {
  const qp = buildQuery({});
  const res = await fetch(`/api/inventario/sectors?ts=${Date.now()}${qp}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; countedAt?: unknown } | null;
  if (!res.ok || !json?.ok) throw new Error(json?.error || `failed_to_save_sector_count_${res.status}`);
  return { ok: true, countedAt: json.countedAt != null ? String(json.countedAt) : undefined };
}
