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

function normalizeSectorName(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 80);
}

async function resolveCompanyFor(db: any, userId: string): Promise<{ companyId: string | null; userIds: Set<string>; bubbles: Set<string> }> {
  const empty = { companyId: null as string | null, userIds: new Set<string>(), bubbles: new Set<string>() };
  if (!userId || !isUuid(userId)) return empty;
  try {
    let { data: mine, error: myErr } = await db
      .from("company_members")
      .select("company_id,user_id,bubble_user_id,role,permission_level")
      .eq("user_id", userId)
      .limit(50);
    if (myErr) return empty;
    if (!mine?.length) {
      try {
        const pf = await db.from("user_profiles").select("bubble_user_id").eq("user_id", userId).maybeSingle();
        const bub = String((pf.data as any)?.bubble_user_id ?? "").trim();
        if (bub) {
          const byBubble = await db
            .from("company_members")
            .select("company_id,user_id,bubble_user_id,role,permission_level")
            .eq("bubble_user_id", bub)
            .limit(50);
          mine = byBubble.data ?? [];
        }
      } catch {}
    }
    if (!mine?.length) return empty;
    const cid = pickBestCompanyId(mine as any[]);
    if (!cid) return empty;
    const all = await db
      .from("company_members")
      .select("company_id,user_id,bubble_user_id")
      .eq("company_id", cid)
      .limit(500);
    if (all.error) return empty;
    const userIds = new Set<string>();
    const bubbles = new Set<string>();
    for (const r of (all.data ?? []) as any[]) {
      const u = String(r?.user_id ?? "").trim();
      if (u && isUuid(u)) userIds.add(u);
      const b = String(r?.bubble_user_id ?? "").trim();
      if (b) bubbles.add(b);
    }
    if (!userIds.has(userId)) userIds.add(userId);
    return { companyId: cid, userIds, bubbles };
  } catch {
    return empty;
  }
}

function mapSupabaseSectorErrorToCode(dbError: any): { code: string; message: string } {
  const msg = String(dbError?.message ?? "").toLowerCase();
  const code = String(dbError?.code ?? "");
  const details = String(dbError?.details ?? "").toLowerCase();
  if (code === "23505" || msg.includes("duplicate") || details.includes("duplicate")) {
    return { code: "duplicate_sector", message: "duplicate_sector" };
  }
  if (msg.includes("violates row-level security") || msg.includes("rls")) {
    return { code: "forbidden", message: "forbidden" };
  }
  if (code === "23502" || msg.includes("violates not-null")) {
    return { code: "missing_scope", message: "missing_scope" };
  }
  return { code: "db_error", message: String(dbError?.message ?? String(dbError)) };
}

async function ensureGeralSector(db: any, scope: { companyId: string | null; userScopeId: string | null }) {
  try {
    const selectQ = db.from("sectors").select("id,name");
    let rows: any[] = [];
    if (scope.companyId) {
      const { data, error } = await selectQ.eq("company_id", scope.companyId).ilike("name", "geral").limit(1);
      if (error) return null;
      rows = (data ?? []) as any[];
    } else if (scope.userScopeId) {
      const { data, error } = await selectQ.eq("user_scope_id", scope.userScopeId).ilike("name", "geral").limit(1);
      if (error) return null;
      rows = (data ?? []) as any[];
    }
    if (rows.length) return rows[0];
    const insertPayload: any = { name: "Geral" };
    if (scope.companyId) insertPayload.company_id = scope.companyId;
    else if (scope.userScopeId) insertPayload.user_scope_id = scope.userScopeId;
    else return null;
    const { data, error } = await db.from("sectors").insert([insertPayload]).select("id,name").maybeSingle();
    if (error) return null;
    return (data as any) ?? null;
  } catch {
    return null;
  }
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
      const r = await resolveCompanyFor(db, userId);
      companyId = r.companyId;
    }
    const scope = { companyId, userScopeId: userScopeId && !companyId ? userScopeId : null };

    const geralId: string | null = null;
    void geralId;
    let sectorsDb: any[] = [];
    try {
      const q = db.from("sectors").select("id,name,company_id,user_scope_id,created_at,updated_at");
      if (scope.companyId) {
        const { data, error } = await q.eq("company_id", scope.companyId).order("name");
        if (!error) sectorsDb = (data ?? []) as any[];
      } else if (scope.userScopeId) {
        const { data, error } = await q.eq("user_scope_id", scope.userScopeId).order("name");
        if (!error) sectorsDb = (data ?? []) as any[];
      }
    } catch {}
    if (!sectorsDb.length) {
      await ensureGeralSector(db, scope);
      const q2 = db.from("sectors").select("id,name,company_id,user_scope_id,created_at,updated_at");
      if (scope.companyId) {
        const { data, error } = await q2.eq("company_id", scope.companyId).order("name");
        if (!error) sectorsDb = (data ?? []) as any[];
      } else if (scope.userScopeId) {
        const { data, error } = await q2.eq("user_scope_id", scope.userScopeId).order("name");
        if (!error) sectorsDb = (data ?? []) as any[];
      }
    }

    let itemLinks: any[] = [];
    try {
      const q = db.from("item_sectors").select("item_id,sector_id");
      if (scope.companyId) {
        const { data, error } = await q.eq("company_id", scope.companyId).limit(10000);
        if (!error) itemLinks = (data ?? []) as any[];
      } else if (scope.userScopeId) {
        const { data, error } = await q.eq("user_scope_id", scope.userScopeId).limit(10000);
        if (!error) itemLinks = (data ?? []) as any[];
      }
    } catch {}

    const sectors = (sectorsDb as any[]).map((s: any) => ({
      id: String(s?.id ?? ""),
      name: String(s?.name ?? ""),
      company_id: s?.company_id != null ? String(s.company_id) : null,
      user_scope_id: s?.user_scope_id != null ? String(s.user_scope_id) : null,
      created_at: s?.created_at != null ? String(s.created_at) : undefined,
      updated_at: s?.updated_at != null ? String(s.updated_at) : undefined,
    }));

    return json({
      sectors,
      itemLinks: itemLinks.map((l: any) => ({ itemId: String((l as any).item_id ?? ""), sectorId: String((l as any).sector_id ?? "") })),
      userId,
      companyId,
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
      const r = await resolveCompanyFor(db, userId);
      companyId = r.companyId;
    }
    const scope = { companyId, userScopeId: userScopeId && !companyId ? userScopeId : null };

    const body = (await req.json().catch(() => null)) as any;
    if (!body || typeof body !== "object") return json({ ok: false, error: "invalid_body" }, { status: 400 });
    const idRaw = String(body.id ?? "").trim();
    const name = normalizeSectorName(String(body.name ?? ""));
    if (!name) return json({ ok: false, error: "missing_name" }, { status: 400 });

    if (idRaw && isUuid(idRaw)) {
      const updateQ = db.from("sectors").update({ name }).eq("id", idRaw);
      const updateRes = scope.companyId
        ? await updateQ.eq("company_id", scope.companyId).select("id,name").maybeSingle()
        : scope.userScopeId
          ? await updateQ.eq("user_scope_id", scope.userScopeId).select("id,name").maybeSingle()
          : { data: null, error: new Error("no_scope") as any };
      if (updateRes.error) {
        const mapped = mapSupabaseSectorErrorToCode(updateRes.error);
        return json({ ok: false, error: mapped.code, message: mapped.message }, { status: /^duplicate_/i.test(mapped.code) ? 409 : 500 });
      }
      if (!updateRes.data) return json({ ok: false, error: "not_found" }, { status: 404 });
      return json({ ok: true, sector: updateRes.data });
    }

    const nameNorm = normalizeSectorName(name).toLowerCase();
    const matchLike = "%" + nameNorm.replace(/[%_\\]/g, (c) => `\\${c}`) + "%";
    if (scope.companyId) {
      try {
        const chk = await db.from("sectors").select("id,name").eq("company_id", scope.companyId).ilike("name", matchLike).limit(100);
        if (!chk.error && Array.isArray(chk.data)) {
          for (const s of chk.data) if (normalizeSectorName(String((s as any).name ?? "")).toLowerCase() === nameNorm) return json({ ok: false, error: "duplicate_sector" }, { status: 409 });
        }
      } catch {}
    } else if (scope.userScopeId) {
      try {
        const chk = await db.from("sectors").select("id,name").eq("user_scope_id", scope.userScopeId).ilike("name", matchLike).limit(100);
        if (!chk.error && Array.isArray(chk.data)) {
          for (const s of chk.data) if (normalizeSectorName(String((s as any).name ?? "")).toLowerCase() === nameNorm) return json({ ok: false, error: "duplicate_sector" }, { status: 409 });
        }
      } catch {}
    }

    const insert: any = { name };
    if (scope.companyId) insert.company_id = scope.companyId;
    else if (scope.userScopeId) insert.user_scope_id = scope.userScopeId;
    else return json({ ok: false, error: "missing_scope" }, { status: 400 });
    const insertRes = await db.from("sectors").insert([insert]).select("id,name,company_id,user_scope_id").maybeSingle();
    if (insertRes.error) {
      const mapped = mapSupabaseSectorErrorToCode(insertRes.error);
      const status = mapped.code === "duplicate_sector" ? 409 : 500;
      return json({ ok: false, error: mapped.code }, { status });
    }
    return json({ ok: true, sector: (insertRes.data as any) ?? null });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { accessToken, userId, userScopeId } = resolveScope(req);
    if (!userId) return json({ ok: false, error: "unauthorized" }, { status: 401 });
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
      const r = await resolveCompanyFor(db, userId);
      companyId = r.companyId;
    }
    const scope = { companyId, userScopeId: userScopeId && !companyId ? userScopeId : null };

    const url = new URL(req.url);
    const id = String(url.searchParams.get("id") ?? "").trim();
    const checkOnly = url.searchParams.get("checkOnly") === "1";
    if (!id || !isUuid(id)) return json({ ok: false, error: "missing_id" }, { status: 400 });

    const baseQ = db.from("sectors").select("id,name").eq("id", id);
    const secRes = scope.companyId
      ? await baseQ.eq("company_id", scope.companyId).maybeSingle()
      : scope.userScopeId
        ? await baseQ.eq("user_scope_id", scope.userScopeId).maybeSingle()
        : { data: null, error: new Error("no_scope") as any };
    if (secRes.error) return json({ ok: false, error: secRes.error.message }, { status: 500 });
    const sector = (secRes.data as any) ?? null;
    if (!sector) return json({ ok: false, error: "not_found" }, { status: 404 });
    if (String(sector.name ?? "").trim().toLowerCase() === "geral") {
      return json({ ok: false, error: "cannot_delete_geral" }, { status: 400 });
    }

    let usage = { itemLinks: 0, counts: 0 };
    try {
      const linksQ = db.from("item_sectors").select("id", { count: "exact", head: true }).eq("sector_id", id);
      const countsQ = db.from("inventory_item_sector_counts").select("id", { count: "exact", head: true }).eq("sector_id", id);
      const scoped = scope.companyId ? { q1: linksQ.eq("company_id", scope.companyId), q2: countsQ.eq("company_id", scope.companyId) } : scope.userScopeId ? { q1: linksQ.eq("user_scope_id", scope.userScopeId), q2: countsQ.eq("user_scope_id", scope.userScopeId) } : { q1: linksQ, q2: countsQ };
      const [r1, r2] = await Promise.all([scoped.q1, scoped.q2]);
      const links = typeof r1.count === "number" ? r1.count : 0;
      const counts = typeof r2.count === "number" ? r2.count : 0;
      usage = { itemLinks: links, counts };
      if (checkOnly) return json({ ok: true, links: usage });
      if (links || counts) return json({ ok: false, error: "sector_in_use", links: usage }, { status: 409 });
    } catch {}

    if (checkOnly) return json({ ok: true, links: usage });

    const delQ = db.from("sectors").delete().eq("id", id);
    const delRes = scope.companyId
      ? await delQ.eq("company_id", scope.companyId)
      : scope.userScopeId
        ? await delQ.eq("user_scope_id", scope.userScopeId)
        : { error: new Error("no_scope") as any };
    if (delRes.error) return json({ ok: false, error: delRes.error.message }, { status: 500 });
    return json({ ok: true, deleted: true });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
