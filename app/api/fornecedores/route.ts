import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../lib/requestUserId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return NextResponse.json(data, { ...init, headers });
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

function normalizeText(v: unknown) {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

function normalizeNameKey(v: unknown) {
  return normalizeText(v).toLowerCase();
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

function resolveUserScopedId(req: NextRequest) {
  const { accessToken, userId } = getUserIdFromRequest(req);
  if (!userId) return { accessToken, id: null as string | null };
  if (isUuid(userId)) return { accessToken, id: `user:${userId}` };
  const url = new URL(req.url);
  const override = String(url.searchParams.get("userId") ?? "").trim();
  if (override && isUuid(override) && isAdminUserId(userId)) return { accessToken, id: `user:${override}` };
  return { accessToken, id: null as string | null };
}

async function shouldUseCompatSource(args: { req: NextRequest; supabase: ReturnType<typeof getSupabaseServerClient>; userId: string; isAdmin: boolean }) {
  const url = new URL(args.req.url);
  const override = String(url.searchParams.get("source") ?? "").trim().toLowerCase();
  if (args.isAdmin) {
    if (override === "compat") return true;
    if (override === "legacy") return false;
  }

  const enabled = String(process.env.BUBBLE_COMPAT_READ_FORNECEDORES ?? "").trim().toLowerCase();
  if (!(enabled === "1" || enabled === "true" || enabled === "yes" || enabled === "on")) return false;

  const allowUsers = new Set(parseCsvEnv(process.env.BUBBLE_COMPAT_READ_FORNECEDORES_USER_IDS).map((x) => x.toLowerCase()));
  const allowEmails = new Set(parseCsvEnv(process.env.BUBBLE_COMPAT_READ_FORNECEDORES_EMAILS).map((x) => x.toLowerCase()));
  const hasAllowList = allowUsers.size > 0 || allowEmails.size > 0;
  if (!hasAllowList) return true;

  const uid = String(args.userId ?? "").trim().toLowerCase();
  if (allowUsers.has(uid)) return true;

  const { data, error } = await args.supabase.from("user_profiles").select("email").eq("user_id", args.userId).maybeSingle();
  if (error) return false;
  const email = String((data as any)?.email ?? "").trim().toLowerCase();
  if (email && allowEmails.has(email)) return true;
  return false;
}

export async function GET(req: NextRequest) {
  try {
    const { accessToken, id } = resolveUserScopedId(req);
    if (!id) return json({ source: "legacy", readOnly: false, row: null }, { status: 200 });
    const supabase = getSupabaseServerClient(accessToken);
    const userId = id.slice("user:".length);

    const { userId: rawUserId } = getUserIdFromRequest(req);
    const isAdmin = Boolean(rawUserId && isAdminUserId(rawUserId));
    const shouldUseCompat = await shouldUseCompatSource({ req, supabase, userId, isAdmin });
    if (shouldUseCompat) {
      const { data: memberRows, error: memberErr } = await supabase
        .from("company_members")
        .select("company_id,role,permission_level")
        .eq("user_id", userId)
        .limit(50);
      if (memberErr) return json({ error: memberErr.message }, { status: 500 });
      const companyId = pickBestCompanyId((memberRows ?? []) as any[]);
      if (!companyId) return json({ error: "missing_company" }, { status: 500 });

      const { data: suppliersDb, error: suppliersErr } = await supabase
        .from("suppliers")
        .select("id,bubble_id,external_key,nome,endereco,vendedor,whatsapp,raw")
        .eq("company_id", companyId)
        .order("nome", { ascending: true });
      if (suppliersErr) return json({ error: suppliersErr.message }, { status: 500 });

      const info: Record<string, any> = {};
      const supplierKeyById = new Map<string, string>();
      for (const s of suppliersDb ?? []) {
        const nome = normalizeText((s as any)?.nome ?? "");
        const externalKey = normalizeText((s as any)?.external_key ?? "");
        const sys = ((s as any)?.raw as any)?.system ?? null;
        const isDefault = externalKey === "supplier:default:sem_fornecedor" || normalizeNameKey(nome) === "sem fornecedor" || Boolean(sys?.default);
        if (isDefault) continue;
        const dbId = String((s as any)?.id ?? "").trim();
        const bubbleId = String((s as any)?.bubble_id ?? "").trim();
        const key = bubbleId || (dbId ? `db:${dbId}` : "");
        if (!key || !nome) continue;
        supplierKeyById.set(dbId, key);
        info[key] = {
          fornecedor: nome,
          vendedor: String((s as any)?.vendedor ?? "").trim(),
          whatsapp: String((s as any)?.whatsapp ?? "").trim(),
          endereco: String((s as any)?.endereco ?? "").trim(),
        };
      }

      const produtos: Record<string, string[]> = {};
      const { data: linksDb, error: linksErr } = await supabase
        .from("supplier_items")
        .select("supplier_id,item:items(name),supplier:suppliers(id,bubble_id)")
        .eq("company_id", companyId)
        .limit(5000);
      if (linksErr) return json({ error: linksErr.message }, { status: 500 });
      for (const r of linksDb ?? []) {
        const supplier = (r as any)?.supplier ?? null;
        const supplierDbId = String(supplier?.id ?? "").trim();
        const supplierBubbleId = String(supplier?.bubble_id ?? "").trim();
        const supplierKey = supplierBubbleId || supplierKeyById.get(supplierDbId) || (supplierDbId ? `db:${supplierDbId}` : "");
        if (!supplierKey || !(supplierKey in info)) continue;
        const itemName = String((r as any)?.item?.name ?? "").trim();
        if (!itemName) continue;
        const prev = Array.isArray(produtos[supplierKey]) ? produtos[supplierKey] : [];
        if (!prev.includes(itemName)) produtos[supplierKey] = [...prev, itemName];
      }

      return json({ source: "compat", readOnly: true, row: { id, info, produtos, equivalencias: {} } }, { status: 200 });
    }

    const { data, error } = await supabase.from("fornecedores_state").select("*").eq("id", id).maybeSingle();
    if (error) return json({ error: error.message }, { status: 500 });
    return json({ source: "legacy", readOnly: false, row: data ?? null }, { status: 200 });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as unknown;
    if (!body || typeof body !== "object") return json({ error: "invalid_body" }, { status: 400 });
    const data = body as Record<string, unknown>;
    const { accessToken, id } = resolveUserScopedId(req);
    if (!id) return json({ error: "unauthorized" }, { status: 401 });
    const supabase = getSupabaseServerClient(accessToken);
    const payload = {
      id,
      info: (data.info ?? {}) as any,
      produtos: (data.produtos ?? {}) as any,
      equivalencias: (data.equivalencias ?? {}) as any,
    };
    const { error } = await supabase.from("fornecedores_state").upsert(payload as any, { onConflict: "id" });
    if (error) return json({ error: error.message }, { status: 500 });
    return json({ ok: true }, { status: 200 });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
