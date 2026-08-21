import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, getSupabaseServerClient } from "../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../lib/requestUserId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return NextResponse.json(data, { ...init, headers });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value ?? "").trim());
}

function parseCsvEnv(value: string | undefined) {
  return String(value ?? "")
    .split(/[,\n;]/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

function isAdminUserId(userId: string) {
  const ids = new Set(parseCsvEnv(process.env.ADMIN_USER_IDS).map((x) => x.toLowerCase()));
  const emails = new Set(
    [...parseCsvEnv(process.env.ADMIN_USER_EMAILS), ...parseCsvEnv(process.env.ADMIN_EMAILS), ...parseCsvEnv(process.env.ADMIN_EMAILS_LEGACY)].map((x) =>
      x.toLowerCase(),
    ),
  );
  const raw = userId.toLowerCase();
  if (!isUuid(userId) && raw.includes("@") && process.env.ADMIN_SECRET) return true;
  if (ids.size && ids.has(raw)) return true;
  if (emails.size && emails.has(raw)) return true;
  return false;
}

function parsePermissionLevel(v: unknown) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : 0;
}

function scoreRole(role: unknown) {
  const r = String(role ?? "").trim().toLowerCase();
  if (!r) return 0;
  if (r.includes("owner") || r.includes("propriet")) return 30;
  if (r.includes("admin")) return 20;
  if (r.includes("manager") || r.includes("gerente")) return 10;
  return 0;
}

function pickBestCompanyId(memberRows: unknown[]) {
  let bestCompanyId = "";
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const row of memberRows ?? []) {
    const r = row as any;
    const companyId = String(r?.company_id ?? "").trim();
    if (!companyId) continue;
    const perm = parsePermissionLevel(r?.permission_level);
    const score = perm * 100 + scoreRole(r?.role);
    if (score > bestScore) {
      bestScore = score;
      bestCompanyId = companyId;
    }
  }
  return bestCompanyId;
}

function resolveScope(req: NextRequest) {
  const { accessToken, userId } = getUserIdFromRequest(req);
  if (!userId) return { accessToken, userId: null, userScopeId: null as string | null, companyId: null as string | null };
  let userScopeId = isUuid(userId) ? `user:${userId}` : null;
  const url = new URL(req.url);
  const override = String(url.searchParams.get("userId") ?? "").trim();
  if (override && isUuid(override) && isAdminUserId(userId)) {
    userScopeId = `user:${override}`;
  }
  const effectiveUserId = override && isUuid(override) && isAdminUserId(userId) ? override : userId;
  return { accessToken, userId: effectiveUserId, userScopeId, companyId: null as string | null };
}

async function getSectorsForScope(db: any, scope: { companyId: string | null; userScopeId: string | null }): Promise<any[]> {
  const q = db.from("sectors").select("id,name");
  if (scope.companyId) {
    const { data, error } = await q.eq("company_id", scope.companyId);
    if (error) throw error;
    return (data ?? []) as any[];
  }
  if (scope.userScopeId) {
    const { data, error } = await q.eq("user_scope_id", scope.userScopeId);
    if (error) throw error;
    return (data ?? []) as any[];
  }
  return [];
}

export async function GET(req: NextRequest) {
  try {
    const { accessToken, userId, userScopeId } = resolveScope(req);
    if (!userId) return json({ error: "unauthorized" }, { status: 401 });
    const supabase = getSupabaseServerClient(accessToken);
    let supabaseAdmin: ReturnType<typeof getSupabaseAdmin> | null = null;
    try {
      supabaseAdmin = getSupabaseAdmin();
    } catch {
      supabaseAdmin = null;
    }
    const db = supabaseAdmin ?? supabase;
    let companyId: string | null = null;
    if (isUuid(userId)) {
      const { data: memberRows, error } = await db.from("company_members").select("company_id,role,permission_level").eq("user_id", userId).limit(50);
      if (!error) companyId = pickBestCompanyId((memberRows ?? []) as any[]);
    }
    const scope = { companyId, userScopeId: userScopeId && !companyId ? userScopeId : null };
    const url = new URL(req.url);
    const itemIdParam = String(url.searchParams.get("itemId") ?? "").trim();
    const q = db.from("item_sectors").select("item_id,sector_id");
    let res;
    if (scope.companyId) {
      let r = q.eq("company_id", scope.companyId);
      if (itemIdParam) r = r.eq("item_id", itemIdParam);
      res = await r.limit(20000);
    } else if (scope.userScopeId) {
      let r = q.eq("user_scope_id", scope.userScopeId);
      if (itemIdParam) r = r.eq("item_id", itemIdParam);
      res = await r.limit(20000);
    } else {
      res = { data: [], error: null };
    }
    if (res.error) return json({ error: res.error.message }, { status: 500 });
    return json({
      ok: true,
      itemSectors: (res.data ?? []).map((r: any) => ({ itemId: String(r?.item_id ?? ""), sectorId: String(r?.sector_id ?? "") })),
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { accessToken, userId, userScopeId } = resolveScope(req);
    if (!userId) return json({ error: "unauthorized" }, { status: 401 });
    const supabase = getSupabaseServerClient(accessToken);
    let supabaseAdmin: ReturnType<typeof getSupabaseAdmin> | null = null;
    try {
      supabaseAdmin = getSupabaseAdmin();
    } catch {
      supabaseAdmin = null;
    }
    const db = supabaseAdmin ?? supabase;
    let companyId: string | null = null;
    if (isUuid(userId)) {
      const { data: memberRows, error } = await db.from("company_members").select("company_id,role,permission_level").eq("user_id", userId).limit(50);
      if (!error) companyId = pickBestCompanyId((memberRows ?? []) as any[]);
    }
    const scope = { companyId, userScopeId: userScopeId && !companyId ? userScopeId : null };

    const sectorRows = await getSectorsForScope(db, scope);
    const sectorNames = new Map(sectorRows.map((s: any) => [String(s?.name ?? "").trim().toLowerCase(), String(s?.id ?? "")]));
    let geralId: string | null = sectorNames.get("geral") ?? null;
    if (!geralId) {
      const insert: any = { name: "Geral" };
      if (scope.companyId) insert.company_id = scope.companyId;
      else if (scope.userScopeId) insert.user_scope_id = scope.userScopeId;
      else return json({ error: "missing_scope" }, { status: 400 });
      const { data, error } = await db.from("sectors").insert([insert]).select("id").maybeSingle();
      if (error) return json({ error: error.message }, { status: 500 });
      geralId = String((data as any)?.id ?? "");
      if (!geralId) return json({ error: "failed_create_geral" }, { status: 500 });
    }

    const body = (await req.json().catch(() => null)) as any;
    const itemSectorsRaw = body?.itemSectors;
    if (!Array.isArray(itemSectorsRaw)) return json({ error: "missing_itemSectors" }, { status: 400 });

    const existingByItem = new Map<string, Set<string>>();
    const q = db.from("item_sectors").select("item_id,sector_id");
    const readRes = scope.companyId ? await q.eq("company_id", scope.companyId).limit(20000)
      : scope.userScopeId ? await q.eq("user_scope_id", scope.userScopeId).limit(20000)
      : { data: [], error: null };
    if (readRes.error) return json({ error: readRes.error.message }, { status: 500 });
    for (const l of (readRes.data ?? []) as any[]) {
      const k = String(l?.item_id ?? "");
      if (!k) continue;
      const set = existingByItem.get(k) ?? new Set<string>();
      set.add(String(l?.sector_id ?? ""));
      existingByItem.set(k, set);
    }

    const toUpsert: any[] = [];
    const toDelete: Array<{ item_id: string; sector_id: string }> = [];
    const requestedByItem = new Map<string, Set<string>>();
    for (const entry of itemSectorsRaw) {
      const itemId = String(entry?.itemId ?? "").trim();
      if (!itemId) continue;
      const sids: string[] = Array.isArray(entry?.sectorIds) ? (entry.sectorIds as any[]).map((x: any) => String(x ?? "").trim()).filter(Boolean) : [];
      const deduped = new Set(sids);
      if (!deduped.size) deduped.add(geralId);
      requestedByItem.set(itemId, deduped);
    }
    // This endpoint receives partial snapshots (for example, only the supplies
    // visible on /insumos or only the recipes visible on /pre-preparo). Never
    // rewrite links for an item that was not explicitly included in the body.
    // Doing so used to move every omitted item back to "Geral" and silently
    // erased sector work made on another screen.
    for (const itemId of requestedByItem.keys()) {
      const existing = existingByItem.get(itemId) ?? new Set<string>();
      const requested = requestedByItem.get(itemId) ?? new Set<string>([geralId]);
      for (const sid of requested) {
        if (!isUuid(sid)) continue;
        toUpsert.push({
          id: scope.companyId || scope.userScopeId ? undefined : crypto.randomUUID(),
          ...(scope.companyId ? { company_id: scope.companyId } : {}),
          ...(scope.userScopeId ? { user_scope_id: scope.userScopeId } : {}),
          item_id: itemId,
          sector_id: sid,
        });
      }
      for (const sid of existing) {
        if (!requested.has(sid)) toDelete.push({ item_id: itemId, sector_id: sid });
      }
    }

    if (toUpsert.length) {
      // item_sectors uses partial unique indexes for company and legacy user
      // scopes. PostgREST cannot infer those indexes through onConflict, so an
      // upsert fails with "no unique or exclusion constraint". We already
      // loaded the current links above; insert only the missing pairs.
      const missing = toUpsert.filter((row) => !existingByItem.get(String(row.item_id))?.has(String(row.sector_id)));
      for (let start = 0; start < missing.length; start += 200) {
        const batch = missing.slice(start, start + 200);
        const { error } = await db.from("item_sectors").insert(batch);
        if (error && String((error as any)?.code ?? "") === "23505") {
          for (const row of batch) {
            const retry = await db.from("item_sectors").insert(row);
            if (retry.error && String((retry.error as any)?.code ?? "") !== "23505") return json({ error: retry.error.message }, { status: 500 });
          }
        } else if (error) {
          return json({ error: error.message }, { status: 500 });
        }
      }
    }
    if (toDelete.length) {
      for (const d of toDelete) {
        const q2 = db.from("item_sectors").delete().eq("item_id", d.item_id).eq("sector_id", d.sector_id);
        const res = scope.companyId ? await q2.eq("company_id", scope.companyId)
          : scope.userScopeId ? await q2.eq("user_scope_id", scope.userScopeId)
          : { error: null };
        if (res.error) return json({ error: res.error.message }, { status: 500 });
      }
    }
    return json({ ok: true, applied: toUpsert.length, removed: toDelete.length });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
