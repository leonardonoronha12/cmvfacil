import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, getSupabaseServerClient } from "../../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../../lib/requestUserId";

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
      x.toLowerCase()
    )
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
  if (!userId) return { accessToken, userId: null, userScopeId: null, companyId: null, countedByUserId: null };
  let userScopeId = isUuid(userId) ? `user:${userId}` : null;
  const url = new URL(req.url);
  const override = String(url.searchParams.get("userId") ?? "").trim();
  const countedByUserId = isUuid(userId) ? userId : null;
  if (override && isUuid(override) && isAdminUserId(userId)) {
    userScopeId = `user:${override}`;
  }
  const effectiveUserId = override && isUuid(override) && isAdminUserId(userId) ? override : userId;
  return { accessToken, userId: effectiveUserId, userScopeId, companyId: null, countedByUserId };
}

function parsePtNumber(input: unknown): number {
  const raw = String(input ?? "").replace(/[^\d,.-]/g, "").trim();
  if (!raw) return 0;
  const neg = raw.includes("-");
  const cleaned = raw.replace(/-/g, "");
  const parts = cleaned.split(",");
  const intPart = (parts[0] ?? "").replace(/\./g, "").replace(/[^\d]/g, "") || "0";
  const decPart = (parts[1] ?? "").replace(/[^\d]/g, "");
  const num = Number.parseFloat(`${intPart}.${decPart}`);
  return neg ? -num : num;
}

export async function GET(req: NextRequest) {
  try {
    const scopeCtx = resolveScope(req);
    const { accessToken, userId, userScopeId, countedByUserId } = scopeCtx;
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
      const { data: memberRows, error } = await db
        .from("company_members")
        .select("company_id,role,permission_level")
        .eq("user_id", userId)
        .limit(50);
      if (!error) companyId = pickBestCompanyId((memberRows ?? []) as any);
    }
    const scope = { companyId, userScopeId: userScopeId && !companyId ? userScopeId : null };
    const url = new URL(req.url);
    const inventoryId = String(url.searchParams.get("inventoryId") ?? "").trim();
    const itemId = String(url.searchParams.get("itemId") ?? "").trim();
    const base = db
      .from("inventory_item_sector_counts")
      .select("inventory_id,item_id,sector_id,quantity,counted_by_user_id,counted_at");
    let res;
    if (scope.companyId) {
      let r: any = base.eq("company_id", scope.companyId);
      if (inventoryId) r = r.eq("inventory_id", inventoryId);
      if (itemId) r = r.eq("item_id", itemId);
      res = await r.limit(50000);
    } else if (scope.userScopeId) {
      let r: any = base.eq("user_scope_id", scope.userScopeId);
      if (inventoryId) r = r.eq("inventory_id", inventoryId);
      if (itemId) r = r.eq("item_id", itemId);
      res = await r.limit(50000);
    } else {
      res = { data: [], error: null };
    }
    if (res.error) return json({ error: res.error.message }, { status: 500 });
    const counts = (res.data ?? []).map((r: any) => ({
      inventory_id: String(r?.inventory_id ?? ""),
      item_id: String(r?.item_id ?? ""),
      sector_id: String(r?.sector_id ?? ""),
      quantity: r?.quantity == null ? "0" : typeof r?.quantity === "number" ? String(r.quantity) : String(r.quantity),
      counted_by_user_id: r?.counted_by_user_id != null ? String(r.counted_by_user_id) : null,
      counted_at: r?.counted_at != null ? String(r.counted_at) : null,
    }));
    return json({ ok: true, countedByUserId, rows: counts, counts });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

type BulkItem = {
  inventoryId: string;
  itemId: string;
  sectorId: string;
  quantity: string | number;
};

function toCountedRows(items: BulkItem[], meta: { scope: { companyId?: string | null; userScopeId?: string | null }; countedByUserId: string | null; nowIso: string }) {
  return items
    .filter((x) => x && isUuid(String(x.sectorId ?? "")) && String(x.inventoryId ?? "").trim() && String(x.itemId ?? "").trim())
    .map((x) => {
      const row: any = {
        inventory_id: String(x.inventoryId).trim(),
        item_id: String(x.itemId).trim(),
        sector_id: String(x.sectorId).trim(),
        quantity: parsePtNumber(x.quantity),
        counted_by_user_id: meta.countedByUserId,
        counted_at: meta.nowIso,
      };
      if (meta.scope.companyId) row.company_id = meta.scope.companyId;
      else if (meta.scope.userScopeId) row.user_scope_id = meta.scope.userScopeId;
      else return null;
      return row as any;
    })
    .filter(Boolean) as any[];
}

async function updateExistingCount(db: any, row: any) {
  let query = db
    .from("inventory_item_sector_counts")
    .update({
      quantity: row.quantity,
      counted_by_user_id: row.counted_by_user_id,
      counted_at: row.counted_at,
    })
    .eq("inventory_id", row.inventory_id)
    .eq("item_id", row.item_id)
    .eq("sector_id", row.sector_id);

  query = row.company_id
    ? query.eq("company_id", row.company_id)
    : query.eq("user_scope_id", row.user_scope_id);

  return await query.select("id").limit(1);
}

async function persistCountRow(db: any, row: any): Promise<string | null> {
  const updated = await updateExistingCount(db, row);
  if (updated.error) return updated.error.message;
  if ((updated.data ?? []).length > 0) return null;

  const inserted = await db.from("inventory_item_sector_counts").insert(row);
  if (!inserted.error) return null;

  // The unique index protects concurrent writes. If another request inserted
  // this key between UPDATE and INSERT, finish by updating that row.
  if (String(inserted.error.code ?? "") === "23505") {
    const retried = await updateExistingCount(db, row);
    if (!retried.error && (retried.data ?? []).length > 0) return null;
    return retried.error?.message ?? inserted.error.message;
  }

  return inserted.error.message;
}

export async function POST(req: NextRequest) {
  try {
    const scopeCtx = resolveScope(req);
    const { accessToken, userId, userScopeId, countedByUserId } = scopeCtx;
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
      const { data: memberRows, error } = await db
        .from("company_members")
        .select("company_id,role,permission_level")
        .eq("user_id", userId)
        .limit(50);
      if (!error) companyId = pickBestCompanyId((memberRows ?? []) as any);
    }
    const scope = { companyId, userScopeId: userScopeId && !companyId ? userScopeId : null };
    if (!scope.companyId && !scope.userScopeId) return json({ error: "missing_scope" }, { status: 400 });
    const nowIso = new Date().toISOString();
    const body = (await req.json().catch(() => null)) as any;
    if (!body || typeof body !== "object") return json({ error: "invalid_body" }, { status: 400 });

    if (Array.isArray(body.bulk)) {
      const rows = toCountedRows(body.bulk as BulkItem[], { scope, countedByUserId, nowIso });
      if (rows.length) {
        const CHUNK = 25;
        for (let i = 0; i < rows.length; i += CHUNK) {
          const chunk = rows.slice(i, i + CHUNK);
          const errors = (await Promise.all(chunk.map((row) => persistCountRow(db, row)))).filter(Boolean);
          if (errors.length) return json({ error: errors[0] }, { status: 500 });
        }
      }
      return json({ ok: true, countedAt: nowIso, bulkCount: rows.length });
    }

    const inventoryId = String(body?.inventoryId ?? "").trim();
    const itemId = String(body?.itemId ?? "").trim();
    const sectorId = String(body?.sectorId ?? "").trim();
    if (!inventoryId || !itemId || !sectorId || !isUuid(sectorId)) {
      return json({ error: "missing_keys" }, { status: 400 });
    }
    const qty = parsePtNumber(body?.quantityRaw ?? body?.quantity ?? 0);
    const insert: any = {
      inventory_id: inventoryId,
      item_id: itemId,
      sector_id: sectorId,
      quantity: qty,
      counted_by_user_id: countedByUserId,
      counted_at: nowIso,
    };
    if (scope.companyId) insert.company_id = scope.companyId;
    else if (scope.userScopeId) insert.user_scope_id = scope.userScopeId;
    const error = await persistCountRow(db, insert);
    if (error) return json({ error }, { status: 500 });
    return json({ ok: true, countedAt: insert.counted_at });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
