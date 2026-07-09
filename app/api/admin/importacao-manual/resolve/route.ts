import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "../../../../lib/requestUserId";
import { getSupabaseAdmin } from "../../../../lib/supabaseAdmin";
import { isLocalDevRequest } from "../../../../lib/localDevRequest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return NextResponse.json(data, { ...init, headers });
}

function getEnv(name: string) {
  const v = (process.env[name] ?? "").trim();
  return v || null;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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
    [...parseCsvEnv(process.env.ADMIN_USER_EMAILS), ...parseCsvEnv(process.env.ADMIN_EMAILS), ...parseCsvEnv(process.env.ADMIN_EMAILS_LEGACY)].map((x) => x.toLowerCase()),
  );
  const raw = userId.toLowerCase();
  if (!isUuid(userId) && raw.includes("@") && process.env.ADMIN_SECRET) return true;
  if (ids.size && ids.has(raw)) return true;
  if (emails.size && emails.has(raw)) return true;
  return false;
}

function safeEmail(input: unknown) {
  const v = String(input ?? "").trim().toLowerCase();
  if (!v || !v.includes("@")) return "";
  return v;
}

function extractUuidFromRpcData(data: unknown) {
  if (typeof data === "string") {
    const v = data.trim();
    return isUuid(v) ? v : null;
  }
  if (Array.isArray(data)) {
    const first = (data as any[])[0];
    if (first && typeof first === "object") {
      const cand = String((first as any).id ?? (first as any).user_id ?? (first as any).userId ?? (first as any).get_auth_user_id_by_email ?? "").trim();
      return isUuid(cand) ? cand : null;
    }
    return null;
  }
  if (data && typeof data === "object") {
    const cand = String((data as any).id ?? (data as any).user_id ?? (data as any).userId ?? (data as any).get_auth_user_id_by_email ?? "").trim();
    return isUuid(cand) ? cand : null;
  }
  return null;
}

function throwIfRestUnhealthy(err: any) {
  const code = String(err?.code ?? "").trim();
  const msg = String(err?.message ?? "").trim().toLowerCase();
  if (code === "PGRST002" || msg.includes("schema cache")) throw new Error("supabase_rest_unhealthy");
}

async function probeSupabaseRestHealth() {
  const url = getEnv("SUPABASE_URL") ?? getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key =
    getEnv("SUPABASE_SERVICE_ROLE_KEY") ?? getEnv("SUPABASE_SERVICE_ROLE") ?? getEnv("SERVICE_ROLE_KEY") ?? getEnv("SUPABASE_SERVICE_KEY");
  if (!url || !key) return;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 1200);
  try {
    const endpoint = `${url.replace(/\/+$/, "")}/rest/v1/companies?select=id&limit=1`;
    const res = await fetch(endpoint, { headers: { apikey: key, authorization: `Bearer ${key}` }, signal: controller.signal });
    const text = await res.text().catch(() => "");
    if (res.status === 503 && (text.includes("PGRST002") || text.toLowerCase().includes("schema cache"))) {
      throw new Error("supabase_rest_unhealthy");
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw new Error("supabase_rest_timeout");
    if (err instanceof Error && err.message === "supabase_rest_unhealthy") throw err;
  } finally {
    clearTimeout(t);
  }
}

async function withTimeout<T>(p: PromiseLike<T>, ms: number, errorCode: string): Promise<T> {
  let t: any = null;
  try {
    const promise = new Promise<T>((resolve, reject) => p.then(resolve, reject));
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        t = setTimeout(() => reject(new Error(errorCode)), ms);
      }),
    ]);
  } finally {
    if (t) clearTimeout(t);
  }
}

async function findBubbleObjUserMapByEmail(supabase: ReturnType<typeof getSupabaseAdmin>, email: string) {
  const target = email.trim().toLowerCase();
  if (!target || !target.includes("@")) return null;
  try {
    const { data, error } = await withTimeout(
      supabase.from("bubble_obj_user_map").select("bubble_user_id,email,supabase_user_id").eq("email", target).limit(1).maybeSingle(),
      2500,
      "bubble_obj_user_map_timeout",
    );
    if (error) {
      throwIfRestUnhealthy(error);
      return null;
    }
    const bubbleUserId = String((data as any)?.bubble_user_id ?? "").trim();
    const em = String((data as any)?.email ?? "").trim().toLowerCase();
    const supabaseUserId = String((data as any)?.supabase_user_id ?? "").trim();
    if (em === target) return { bubbleUserId: bubbleUserId || null, supabaseUserId: supabaseUserId || null };
  } catch (err) {
    if (err instanceof Error && (err.message === "supabase_rest_unhealthy" || err.message.endsWith("_timeout"))) throw err;
    return null;
  }

  try {
    const { data, error } = await withTimeout(
      supabase.from("bubble_obj_user_map").select("bubble_user_id,email,supabase_user_id").ilike("email", target).limit(1).maybeSingle(),
      2500,
      "bubble_obj_user_map_timeout",
    );
    if (error) {
      throwIfRestUnhealthy(error);
      return null;
    }
    const bubbleUserId = String((data as any)?.bubble_user_id ?? "").trim();
    const em = String((data as any)?.email ?? "").trim().toLowerCase();
    const supabaseUserId = String((data as any)?.supabase_user_id ?? "").trim();
    if (em === target) return { bubbleUserId: bubbleUserId || null, supabaseUserId: supabaseUserId || null };
  } catch (err) {
    if (err instanceof Error && (err.message === "supabase_rest_unhealthy" || err.message.endsWith("_timeout"))) throw err;
    return null;
  }

  return null;
}

async function findAuthUserIdFromAuthSchema(supabase: ReturnType<typeof getSupabaseAdmin>, email: string) {
  const target = email.trim().toLowerCase();
  if (!target || !target.includes("@")) return null;
  try {
    const { data, error } = await withTimeout(supabase.rpc("get_auth_user_id_by_email", { p_email: target } as any), 2500, "auth_lookup_timeout");
    if (error) {
      throwIfRestUnhealthy(error);
      return null;
    }
    return extractUuidFromRpcData(data);
  } catch (err) {
    if (err instanceof Error && (err.message === "supabase_rest_unhealthy" || err.message.endsWith("_timeout"))) throw err;
    return null;
  }
}

async function findAuthUserIdByEmail(supabase: ReturnType<typeof getSupabaseAdmin>, email: string) {
  const target = email.trim().toLowerCase();
  if (!target || !target.includes("@")) return null;

  try {
    const { data: p1, error: e1 } = await withTimeout(
      supabase.from("user_profiles").select("user_id,email").eq("email", target).limit(1).maybeSingle(),
      2500,
      "user_profiles_lookup_timeout",
    );
    if (e1) throwIfRestUnhealthy(e1);
    if (!e1) {
      const id = String((p1 as any)?.user_id ?? "").trim();
      const em = String((p1 as any)?.email ?? "").trim().toLowerCase();
      if (id && em === target) return id;
    }
  } catch (err) {
    if (err instanceof Error && (err.message === "supabase_rest_unhealthy" || err.message.endsWith("_timeout"))) throw err;
  }

  const mapped = await findBubbleObjUserMapByEmail(supabase, target);
  if (mapped?.supabaseUserId && isUuid(mapped.supabaseUserId)) return mapped.supabaseUserId;

  const authId = await findAuthUserIdFromAuthSchema(supabase, target);
  if (authId) return authId;

  return null;
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

async function getUserEmailFromDb(supabase: ReturnType<typeof getSupabaseAdmin>, userId: string) {
  if (!isUuid(userId)) return null;
  const { data, error } = await supabase.from("user_profiles").select("email").eq("user_id", userId).maybeSingle();
  if (error) return null;
  const email = String((data as any)?.email ?? "").trim().toLowerCase();
  return email && email.includes("@") ? email : null;
}

async function isAdminRequester(supabase: ReturnType<typeof getSupabaseAdmin>, requesterUserId: string) {
  if (isAdminUserId(requesterUserId)) return true;
  const requesterEmail = await getUserEmailFromDb(supabase, requesterUserId);
  if (!requesterEmail) return false;
  const allow = new Set(
    [...parseCsvEnv(process.env.ADMIN_USER_EMAILS), ...parseCsvEnv(process.env.ADMIN_EMAILS), ...parseCsvEnv(process.env.ADMIN_EMAILS_LEGACY)].map((x) => x.toLowerCase()),
  );
  return allow.has(requesterEmail);
}

export async function POST(req: NextRequest) {
  try {
    const isLocalDev = isLocalDevRequest(req);
    const { userId } = getUserIdFromRequest(req);
    if (!userId && !isLocalDev) return json({ ok: false, error: "unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => null)) as any;
    const email = safeEmail(body?.email);
    if (!email) return json({ ok: false, error: "invalid_email" }, { status: 400 });

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    await probeSupabaseRestHealth();

    const requesterId = String(userId ?? "").trim();
    let selfOk = false;
    let adminOk = false;
    if (isLocalDev) {
      adminOk = true;
    } else {
      const requesterEmail = requesterId ? await getUserEmailFromDb(supabase, requesterId) : null;
      selfOk = isUuid(requesterId) && requesterEmail === email;
      adminOk = await isAdminRequester(supabase, requesterId);
      if (!selfOk && !adminOk) return json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const targetUserId = selfOk ? requesterId : await findAuthUserIdByEmail(supabase, email);

    let memberRows: any[] = [];
    let memberErr: any = null;
    let resolvedUserId: string | null = targetUserId && isUuid(targetUserId) ? targetUserId : null;

    if (resolvedUserId) {
      const res = await withTimeout(
        supabase.from("company_members").select("company_id,role,permission_level").eq("user_id", resolvedUserId).limit(100),
        4000,
        "company_members_timeout",
      );
      memberRows = (res as any)?.data ?? [];
      memberErr = (res as any)?.error ?? null;
    } else if (isLocalDev) {
      const mapped = await findBubbleObjUserMapByEmail(supabase, email);
      if (mapped?.bubbleUserId) {
        const res = await withTimeout(
          supabase.from("company_members").select("company_id,role,permission_level").eq("bubble_user_id", mapped.bubbleUserId).limit(100),
          4000,
          "company_members_timeout",
        );
        memberRows = (res as any)?.data ?? [];
        memberErr = (res as any)?.error ?? null;
        resolvedUserId = mapped.supabaseUserId && isUuid(mapped.supabaseUserId) ? mapped.supabaseUserId : null;
      }
    }

    if (!resolvedUserId && !(memberRows ?? []).length) return json({ ok: false, error: "user_not_found" }, { status: 404 });
    if (memberErr) return json({ ok: false, error: memberErr.message }, { status: 500 });

    const companyId = pickBestCompanyId((memberRows ?? []) as any[]);
    if (!companyId) return json({ ok: false, error: "missing_company" }, { status: 500 });

    const uniqueCompanyIds = Array.from(new Set((memberRows ?? []).map((r: any) => String(r?.company_id ?? "").trim()).filter(Boolean)));
    const companyNameById = new Map<string, string | null>();
    if (uniqueCompanyIds.length) {
      const { data: companiesDb } = await withTimeout(
        supabase.from("companies").select("id,fantasy_name,legal_name").in("id", uniqueCompanyIds).limit(200),
        4000,
        "companies_timeout",
      );
      for (const c of companiesDb ?? []) {
        const id = String((c as any)?.id ?? "").trim();
        if (!id) continue;
        const nome = String((c as any)?.fantasy_name ?? (c as any)?.legal_name ?? "").trim();
        companyNameById.set(id, nome || null);
      }
    }

    const memberships = (memberRows ?? []).map((r: any) => ({
      companyId: String(r?.company_id ?? "").trim(),
      companyName: companyNameById.get(String(r?.company_id ?? "").trim()) ?? null,
      role: r?.role ? String(r.role).trim() : null,
      permissionLevel: typeof r?.permission_level === "number" ? r.permission_level : Number(r?.permission_level ?? null),
    }));

    return json(
      {
        ok: true,
        user: {
          userId: resolvedUserId ?? "",
          email,
          companyId,
          companyName: companyNameById.get(companyId) ?? null,
          memberships,
        },
      },
      { status: 200 },
    );
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
