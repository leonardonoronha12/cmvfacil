import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, getSupabaseServerClient } from "../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../lib/requestUserId";
import { resolveCurrentCompanyForUser } from "../../lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function dbg(hypothesisId: string, location: string, msg: string, data: unknown) {
  // #region debug-point A:csv-only-audit
  try {
    const fs = await import("node:fs");
    const p = ".dbg/csv-only-audit.env";
    let u = "http://127.0.0.1:7777/event";
    let s = "csv-only-audit";
    try {
      const e = fs.readFileSync(p, "utf8");
      u = e.match(/DEBUG_SERVER_URL=(.+)/)?.[1]?.trim() || u;
      s = e.match(/DEBUG_SESSION_ID=(.+)/)?.[1]?.trim() || s;
    } catch {}
    await fetch(u, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: s, runId: "pre", hypothesisId, location, msg: `[DEBUG] ${msg}`, data, ts: Date.now() }),
    }).catch(() => {});
  } catch {}
  // #endregion
}

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return NextResponse.json(data, { ...init, headers });
}

function isMissingTableError(err: any) {
  const msg = String(err?.message ?? "").toLowerCase();
  const code = String(err?.code ?? "").toLowerCase();
  if (code === "42p01") return true;
  if (msg.includes("does not exist")) return true;
  if (msg.includes("relation") && msg.includes("does not exist")) return true;
  return false;
}

function safeSegment(input: string) {
  const s = String(input ?? "").trim();
  if (!s) return "";
  return s.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 90);
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

function parseEnvBool(value: unknown) {
  const v = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!v) return false;
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
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

function pickBestMemberUserId(memberRows: unknown[]) {
  let bestUserId = "";
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const row of memberRows ?? []) {
    const r = row as any;
    const userId = String(r?.user_id ?? "").trim();
    if (!userId) continue;
    const perm = parsePermissionLevel(r?.permission_level);
    const score = perm * 100 + scoreRole(r?.role);
    if (score > bestScore) {
      bestScore = score;
      bestUserId = userId;
    }
  }
  return bestUserId;
}

async function resolveCompanyFromMigratedAliases(db: any, userId: string) {
  const candidateUserIds = new Set<string>([userId]);
  const bubbleIds = new Set<string>();
  let email = "";
  try {
    const { data: profile } = await db.from("user_profiles").select("user_id,email,bubble_user_id").eq("user_id", userId).maybeSingle();
    email = String(profile?.email ?? "").trim().toLowerCase();
    const bubble = String(profile?.bubble_user_id ?? "").trim();
    if (bubble) bubbleIds.add(bubble);
  } catch {}
  try {
    if (!email && db?.auth?.admin?.getUserById) {
      const { data } = await db.auth.admin.getUserById(userId);
      email = String(data?.user?.email ?? "").trim().toLowerCase();
    }
  } catch {}
  try {
    if (email) {
      const { data } = await db.from("user_profiles").select("user_id,bubble_user_id").ilike("email", email).limit(50);
      for (const row of data ?? []) {
        const uid = String(row?.user_id ?? "").trim();
        const bubble = String(row?.bubble_user_id ?? "").trim();
        if (uid) candidateUserIds.add(uid);
        if (bubble) bubbleIds.add(bubble);
      }
    }
    for (const bubble of Array.from(bubbleIds)) {
      const { data } = await db.from("user_profiles").select("user_id,bubble_user_id").eq("bubble_user_id", bubble).limit(50);
      for (const row of data ?? []) {
        const uid = String(row?.user_id ?? "").trim();
        if (uid) candidateUserIds.add(uid);
      }
    }
  } catch {}
  try {
    const ids = Array.from(candidateUserIds).filter(isUuid);
    if (ids.length) {
      const { data } = await db.from("company_members").select("company_id,role,permission_level").in("user_id", ids).limit(100);
      const companyId = pickBestCompanyId(data ?? []);
      if (companyId) return companyId;
    }
  } catch {}
  for (const bubble of Array.from(bubbleIds)) {
    try {
      const { data } = await db.from("company_members").select("company_id,role,permission_level").eq("bubble_user_id", bubble).limit(50);
      const companyId = pickBestCompanyId(data ?? []);
      if (companyId) return companyId;
    } catch {}
  }
  return "";
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

function formatBrl(v: number | null) {
  if (v == null || !Number.isFinite(v)) return "";
  const s = v.toFixed(2).replace(".", ",");
  return `R$${s}`;
}

function parseBrlNumber(v: unknown) {
  const raw0 = typeof v === "number" && Number.isFinite(v) ? String(v) : String(v ?? "").trim();
  if (!raw0 || raw0 === "-") return null;
  const raw = raw0.replace(/\s/g, "").replace(/^R\$/i, "").trim();
  if (!raw || raw === "-") return null;
  const numeric = raw.replace(/\./g, "").replace(",", ".");
  const n = Number(numeric);
  return Number.isFinite(n) ? n : null;
}

function normalizeNameKey(v: unknown) {
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function looksLikeBubbleId(v: unknown) {
  const s = String(v ?? "").trim();
  return /^\d{6,}x\d{6,}$/.test(s);
}

async function seedCompanyItemsFromLegacy(args: { supabase: ReturnType<typeof getSupabaseServerClient>; companyId: string; diag?: boolean }) {
  const { supabase, companyId } = args;
  let supabaseAdmin: ReturnType<typeof getSupabaseAdmin> | null = null;
  try {
    supabaseAdmin = getSupabaseAdmin();
  } catch {
    supabaseAdmin = null;
  }
  const db = supabaseAdmin ?? supabase;

  const diagOut = args.diag ? ({ attempts: [] as any[], chosen: null as any }) : null;

  const { data: members, error: mErr } = await db
    .from("company_members")
    .select("user_id,bubble_user_id,role,permission_level")
    .eq("company_id", companyId)
    .limit(80);
  if (mErr) return { ok: false, diag: diagOut };
  const memberRows = (members ?? []) as any[];
  if (!memberRows.length) return { ok: false, diag: diagOut };

  const memberUserIds = Array.from(new Set(memberRows.map((r) => String(r?.user_id ?? "").trim()).filter((x) => isUuid(x))));
  const { data: memberProfiles } = memberUserIds.length
    ? await db.from("user_profiles").select("user_id,email,bubble_user_id").in("user_id", memberUserIds).limit(200)
    : { data: [] as any[] };
  const emailByUserId = new Map<string, string>();
  const bubbleUserIdByUserId = new Map<string, string>();
  for (const p of memberProfiles ?? []) {
    const uid = String((p as any)?.user_id ?? "").trim();
    const email = String((p as any)?.email ?? "").trim().toLowerCase();
    if (uid && email) emailByUserId.set(uid, email);
    const bub = String((p as any)?.bubble_user_id ?? "").trim();
    if (uid && bub) bubbleUserIdByUserId.set(uid, bub);
  }

  const sorted = memberRows.slice().sort((a, b) => parsePermissionLevel(b?.permission_level) * 100 + scoreRole(b?.role) - (parsePermissionLevel(a?.permission_level) * 100 + scoreRole(a?.role)));

  let legacyRows: any[] = [];
  let legacyCategories: any[] = [];
  let foundFrom: "insumos_state" | "insumos" | "inventario" | null = null;
  let legacyKey: string | null = null;
  let chosenUserId: string | null = null;
  for (const m of sorted.slice(0, 12)) {
    const candidateUserId = String(m?.user_id ?? "").trim();
    if (!candidateUserId || !isUuid(candidateUserId)) continue;
    const email = String(emailByUserId.get(candidateUserId) ?? "").trim().toLowerCase();
    const bubbleUserId = String(m?.bubble_user_id ?? bubbleUserIdByUserId.get(candidateUserId) ?? "").trim();
    const stateIds = [`user:${candidateUserId}`, email ? `user:${email}` : "", bubbleUserId ? `user:${bubbleUserId}` : ""].filter(Boolean);
    for (const legacyId of stateIds) {
      if (diagOut && diagOut.attempts.length < 60) diagOut.attempts.push({ source: "insumos_state", legacyId, candidateUserId });
      const { data, error } = await db.from("insumos_state").select("*").eq("id", legacyId).maybeSingle();
      if (!error && data) {
        const payload = (data as any)?.payload;
        const rows = Array.isArray(payload?.rows) ? (payload.rows as any[]) : [];
        const categories = Array.isArray(payload?.categories) ? (payload.categories as any[]) : [];
        if (rows.length) {
          legacyRows = rows;
          legacyCategories = categories;
          foundFrom = "insumos_state";
          legacyKey = legacyId;
          chosenUserId = candidateUserId;
          break;
        }
      }
    }
    if (legacyRows.length) break;

    const prefixes = [`user:${candidateUserId}:`, email ? `user:${email}:` : "", bubbleUserId ? `user:${bubbleUserId}:` : ""].filter(Boolean);
    for (const prefix of prefixes) {
      if (diagOut && diagOut.attempts.length < 60) diagOut.attempts.push({ source: "insumos", prefix, candidateUserId });
      const { data: rowsDb, error: rowsErr } = await db
        .from("insumos")
        .select("id,item,medida,custo_medio,categoria,especificacao,ocultar")
        .like("id", `${prefix}%`)
        .order("item", { ascending: true })
        .limit(8000);
      if (!rowsErr && (rowsDb ?? []).length) {
        legacyRows = (rowsDb ?? []).map((r: any) => ({
          id: String(r?.id ?? "").trim(),
          item: String(r?.item ?? "").trim(),
          medida: String(r?.medida ?? "").trim() || "Und",
          custoMedio: String(r?.custo_medio ?? "").trim() || undefined,
          categoria: String(r?.categoria ?? "").trim() || undefined,
          especificacao: String(r?.especificacao ?? "").trim() || undefined,
          ocultar: typeof r?.ocultar === "boolean" ? Boolean(r.ocultar) : undefined,
        }));
        legacyCategories = [];
        foundFrom = "insumos";
        legacyKey = `${prefix}%`;
        chosenUserId = candidateUserId;
        break;
      }
    }
    if (legacyRows.length) break;
  }

  if (!legacyRows.length) {
    for (const m of sorted.slice(0, 12)) {
      const candidateUserId = String(m?.user_id ?? "").trim();
      if (!candidateUserId || !isUuid(candidateUserId)) continue;
      const email = String(emailByUserId.get(candidateUserId) ?? "").trim().toLowerCase();
      const bubbleUserId = String(m?.bubble_user_id ?? bubbleUserIdByUserId.get(candidateUserId) ?? "").trim();
      const prefixes = [`user:${candidateUserId}:`, email ? `user:${email}:` : "", bubbleUserId ? `user:${bubbleUserId}:` : ""].filter(Boolean);
      for (const prefix of prefixes) {
        if (diagOut && diagOut.attempts.length < 60) diagOut.attempts.push({ source: "inventario", prefix, candidateUserId });
        const { data: invRows, error: invErr } = await db
          .from("inventario")
          .select("id,categorias,created_at")
          .like("id", `${prefix}%`)
          .order("created_at", { ascending: false })
          .limit(25);
        if (invErr) continue;
        const inv = (invRows ?? [])[0] as any;
        const categorias = Array.isArray(inv?.categorias) ? (inv.categorias as any[]) : [];
        const byNameKey = new Map<string, any>();
        const catNames = new Set<string>();
        for (const c of categorias) {
          const catName = String((c as any)?.nome ?? (c as any)?.name ?? "").trim();
          if (catName) catNames.add(catName);
          const itens = Array.isArray((c as any)?.itens) ? ((c as any).itens as any[]) : [];
          for (const it of itens) {
            const name = String(it?.item ?? it?.name ?? "").trim();
            if (!name) continue;
            const key = normalizeNameKey(name);
            if (!key || byNameKey.has(key)) continue;
            byNameKey.set(key, {
              id: String(it?.id ?? "").trim() || name,
              item: name,
              medida: String(it?.unidade ?? it?.unidade_medida ?? it?.medida ?? "").trim() || "Und",
              categoria: catName || undefined,
              especificacao: undefined,
              custoMedio: undefined,
              ocultar: undefined,
            });
          }
        }
        legacyRows = Array.from(byNameKey.values());
        legacyCategories = Array.from(catNames.values());
        foundFrom = "inventario";
        legacyKey = `${prefix}%`;
        chosenUserId = candidateUserId;
        break;
      }
      if (legacyRows.length) break;
    }
  }

  if (!legacyRows.length) return { ok: false, diag: diagOut };

  const { data: categoriesDb, error: catErr } = await db.from("categories").select("id,name").eq("company_id", companyId);
  if (catErr) return { ok: false, diag: diagOut };
  const categoryIdByKey = new Map<string, string>();
  for (const c of categoriesDb ?? []) {
    const id0 = String((c as any)?.id ?? "").trim();
    const name0 = String((c as any)?.name ?? "").trim();
    if (!id0 || !name0) continue;
    categoryIdByKey.set(normalizeNameKey(name0), id0);
  }

  const categoryNames = new Set<string>();
  for (const c of legacyCategories ?? []) {
    const name0 = String(c ?? "").trim();
    if (!name0 || name0 === "-") continue;
    categoryNames.add(name0);
  }
  for (const r of legacyRows) {
    const name0 = String((r as any)?.categoria ?? "").trim();
    if (!name0 || name0 === "-") continue;
    categoryNames.add(name0);
  }

  const toCreate: { company_id: string; name: string }[] = [];
  for (const name0 of categoryNames) {
    const key = normalizeNameKey(name0);
    if (!key || categoryIdByKey.has(key)) continue;
    toCreate.push({ company_id: companyId, name: name0 });
  }
  if (toCreate.length) {
    const { data: created, error: createErr } = await db.from("categories").insert(toCreate as any).select("id,name");
    if (createErr) return { ok: false, diag: diagOut };
    for (const c of created ?? []) {
      const id0 = String((c as any)?.id ?? "").trim();
      const name0 = String((c as any)?.name ?? "").trim();
      if (!id0 || !name0) continue;
      categoryIdByKey.set(normalizeNameKey(name0), id0);
    }
  }

  const bubbleIds = Array.from(new Set(legacyRows.map((r) => String((r as any)?.id ?? "").trim()).filter((x) => looksLikeBubbleId(x))));
  const existingIdByBubbleId = new Map<string, string>();
  if (bubbleIds.length) {
    const { data, error } = await db.from("items").select("id,bubble_id").eq("company_id", companyId).in("bubble_id", bubbleIds);
    if (error) return { ok: false, diag: diagOut };
    for (const it of data ?? []) {
      const id0 = String((it as any)?.id ?? "").trim();
      const bid = String((it as any)?.bubble_id ?? "").trim();
      if (id0 && bid) existingIdByBubbleId.set(bid, id0);
    }
  }

  const upsertByBubble: any[] = [];
  const upsertById: any[] = [];
  for (const r of legacyRows) {
    const rawId = String((r as any)?.id ?? "").trim();
    const name = String((r as any)?.item ?? "").trim();
    if (!name) continue;
    const categoria = String((r as any)?.categoria ?? "").trim();
    const categoriaKey = categoria && categoria !== "-" ? normalizeNameKey(categoria) : "";
    const categoryId = categoriaKey ? categoryIdByKey.get(categoriaKey) ?? null : null;
    const bubbleId = looksLikeBubbleId(rawId) ? rawId : null;
    const existingId = bubbleId ? existingIdByBubbleId.get(bubbleId) ?? "" : "";
    const patch = {
      company_id: companyId,
      id: existingId || crypto.randomUUID(),
      bubble_id: bubbleId,
      name,
      unidade_medida: String((r as any)?.medida ?? "").trim() || null,
      custo_medio: parseBrlNumber((r as any)?.custoMedio),
      descricao: String((r as any)?.especificacao ?? "").trim() || "",
      ocultar_cmv: typeof (r as any)?.ocultar === "boolean" ? Boolean((r as any).ocultar) : false,
      category_id: categoryId,
      item_receita: false,
      item_do_cardapio: false,
    };
    if (bubbleId) upsertByBubble.push(patch);
    else upsertById.push(patch);
  }

  if (upsertByBubble.length) {
    const { error } = await db.from("items").upsert(upsertByBubble as any, { onConflict: "id" });
    if (error) return { ok: false, diag: diagOut };
  }
  if (upsertById.length) {
    const { error } = await db.from("items").upsert(upsertById as any, { onConflict: "id" });
    if (error) return { ok: false, diag: diagOut };
  }

  if (diagOut) {
    diagOut.chosen = {
      companyId,
      chosenUserId,
      legacyKey,
      foundFrom,
      legacyRows: legacyRows.length,
      legacyCategories: legacyCategories.length,
      createdCategories: toCreate.length,
      upsertByBubble: upsertByBubble.length,
      upsertById: upsertById.length,
    };
  }
  return { ok: true, diag: diagOut };
}

async function shouldUseCompatSource(args: { req: NextRequest; supabase: ReturnType<typeof getSupabaseServerClient>; userId: string; isAdmin: boolean }) {
  const url = new URL(args.req.url);
  const source = String(url.searchParams.get("source") ?? "")
    .trim()
    .toLowerCase();
  if (source === "legacy") return false;

  const enabled = parseEnvBool(process.env.BUBBLE_COMPAT_READ_INSUMOS) || parseEnvBool(process.env.BUBBLE_COMPAT_READ_INSOMOS);
  if (source === "compat") return args.isAdmin ? true : enabled;
  return enabled;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const diag = String(url.searchParams.get("diag") ?? "").trim() === "1";
    const { accessToken, id } = resolveUserScopedId(req);
    if (!id) return json({ error: "unauthorized" }, { status: 401 });
    const supabase = getSupabaseServerClient(accessToken);
    const userId = id.slice("user:".length);

    const { userId: rawUserId } = getUserIdFromRequest(req);
    const isAdmin = Boolean(rawUserId && isAdminUserId(rawUserId));
    const shouldUseCompat = await shouldUseCompatSource({ req, supabase, userId, isAdmin });
    await dbg("A", "api/insumos", "source_selected", {
      shouldUseCompat,
      rawUserId: rawUserId ? String(rawUserId) : null,
      userId,
      flags: {
        BUBBLE_COMPAT_READ_INSUMOS: process.env.BUBBLE_COMPAT_READ_INSUMOS ?? null,
        BUBBLE_COMPAT_READ_INSOMOS: process.env.BUBBLE_COMPAT_READ_INSOMOS ?? null,
      },
    });
    if (shouldUseCompat) {
      let supabaseAdmin: ReturnType<typeof getSupabaseAdmin> | null = null;
      try {
        supabaseAdmin = getSupabaseAdmin();
      } catch {
        supabaseAdmin = null;
      }
      const db = supabaseAdmin ?? supabase;

      const { data: memberRows, error: memberErr } = await db
        .from("company_members")
        .select("company_id,role,permission_level")
        .eq("user_id", userId)
        .limit(50);
      if (memberErr) return json({ error: memberErr.message }, { status: 500 });
      let companyId = pickBestCompanyId((memberRows ?? []) as any[]);
      if (!companyId && supabaseAdmin) {
        companyId = (await resolveCurrentCompanyForUser(supabaseAdmin, userId)).companyId ?? "";
      }
      if (!companyId) companyId = await resolveCompanyFromMigratedAliases(db, userId);
      if (!companyId) return json({ error: "missing_company" }, { status: 500 });

      const { data: categoriesDbRaw, error: catErr } = await db.from("categories").select("id,name").eq("company_id", companyId);
      if (catErr) return json({ error: catErr.message }, { status: 500 });
      let categoriesDb = (categoriesDbRaw ?? []) as any[];

      const { data: itemsDbRaw, error: itemsErr } = await db
        .from("items")
        .select("id,bubble_id,name,unidade_medida,custo_medio,descricao,ocultar_cmv,category_id,item_receita,item_do_cardapio")
        .eq("company_id", companyId)
        .or("item_receita.is.null,item_receita.eq.false")
        .or("ocultar_cmv.is.null,ocultar_cmv.eq.false")
        .order("name", { ascending: true });
      if (itemsErr) return json({ error: itemsErr.message }, { status: 500 });
      let itemsDb = (itemsDbRaw ?? []) as any[];
      const diagCompat: any = diag ? { companyId, before: { categories: categoriesDb.length, items: itemsDb.length } } : null;

      if (!itemsDb.length) {
        const seedRes = await seedCompanyItemsFromLegacy({ supabase, companyId, diag });
        const seeded = Boolean(seedRes?.ok);
        if (diagCompat) diagCompat.seed = seedRes?.diag ?? { ok: seeded };
        if (seeded) {
          const { data: categoriesDb2, error: catErr2 } = await db.from("categories").select("id,name").eq("company_id", companyId);
          if (!catErr2) categoriesDb = (categoriesDb2 ?? []) as any[];

          const { data: itemsDb2, error: itemsErr2 } = await db
            .from("items")
            .select("id,bubble_id,name,unidade_medida,custo_medio,descricao,ocultar_cmv,category_id,item_receita,item_do_cardapio")
            .eq("company_id", companyId)
            .or("item_receita.is.null,item_receita.eq.false")
            .or("ocultar_cmv.is.null,ocultar_cmv.eq.false")
            .order("name", { ascending: true });
          if (!itemsErr2) itemsDb = (itemsDb2 ?? []) as any[];
        }
        if (diagCompat) diagCompat.after = { categories: categoriesDb.length, items: itemsDb.length };
      }

      if (!itemsDb.length) {
        const { data, error } = await supabase.from("insumos_state").select("*").eq("id", id).maybeSingle();
        if (!error) {
          const payload = (data as any)?.payload;
          const rows = Array.isArray(payload?.rows) ? (payload.rows as unknown[]) : [];
          const categories = Array.isArray(payload?.categories) ? (payload.categories as unknown[]) : [];
          if (diagCompat) diagCompat.fallbackLegacyState = { rows: rows.length, categories: categories.length };
          if (rows.length) return json({ source: "legacy", readOnly: false, rows, categories, ...(diagCompat ? { diag: diagCompat } : {}) }, { status: 200 });
        }
      }

      const categoryNameById = new Map<string, string>();
      for (const c of categoriesDb) {
        const cid = String((c as any)?.id ?? "").trim();
        const name = String((c as any)?.name ?? "").trim();
        if (cid) categoryNameById.set(cid, name);
      }
      await dbg("A", "api/insumos", "compat_items_loaded", {
        companyId,
        totalItemsDb: itemsDb.length,
        sampleNames: itemsDb.slice(0, 20).map((r: any) => String(r?.name ?? "").trim()),
        flagsTrueCounts: {
          item_receita_true: itemsDb.filter((r: any) => Boolean(r?.item_receita)).length,
          item_do_cardapio_true: itemsDb.filter((r: any) => Boolean(r?.item_do_cardapio)).length,
        },
        containsCarreteiro: itemsDb.some((r: any) => String(r?.name ?? "").trim().toLowerCase() === "carreteiro"),
      });

      const rows = itemsDb
        .map((r: any) => {
          const bubbleId = String(r?.bubble_id ?? "").trim();
          const dbId = String(r?.id ?? "").trim();
          const idOut = bubbleId || (dbId ? `db:${dbId}` : "");
          const item = String(r?.name ?? "").trim();
          if (!idOut || !item) return null;
          const categoria = r?.category_id ? String(categoryNameById.get(String(r.category_id)) ?? "").trim() : "";
          const custoLabel = typeof r?.custo_medio === "number" ? formatBrl(r.custo_medio) : formatBrl(Number(r?.custo_medio ?? null));
          return {
            id: idOut,
            item,
            medida: String(r?.unidade_medida ?? "").trim() || "Und",
            custoMedio: custoLabel || undefined,
            categoria: categoria || undefined,
            especificacao: String(r?.descricao ?? "").trim() || undefined,
            ocultar: typeof r?.ocultar_cmv === "boolean" ? Boolean(r.ocultar_cmv) : undefined,
            flags: { item_receita: Boolean(r?.item_receita), item_do_cardapio: Boolean(r?.item_do_cardapio) },
            bubble: { bubble_id: bubbleId || undefined },
          };
        })
        .filter(Boolean);

      const categories = Array.from(
        new Set(
          categoriesDb
            .map((c: any) => String(c?.name ?? "").trim())
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base", numeric: true }));
      await dbg("A", "api/insumos", "compat_response_ready", {
        rows: rows.length,
        categories: categories.length,
        containsCarreteiro: rows.some((r: any) => String(r?.item ?? "").trim().toLowerCase() === "carreteiro"),
      });
      return json(
        { source: "compat", readOnly: false, rows, categories, ...(diagCompat ? { diag: diagCompat } : {}) },
        { status: 200, headers: { "x-cmv-insumos-read-source": "compat" } },
      );
    }

    const { data, error } = await supabase.from("insumos_state").select("*").eq("id", id).maybeSingle();
    if (!error) {
      const payload = (data as any)?.payload;
      const rows = Array.isArray(payload?.rows) ? (payload.rows as unknown[]) : [];
      const categories = Array.isArray(payload?.categories) ? (payload.categories as unknown[]) : [];
      await dbg("A", "api/insumos", "legacy_state_response_ready", { rows: rows.length, categories: categories.length });
      return json(
        { source: "legacy", readOnly: false, rows, categories },
        { status: 200, headers: { "x-cmv-insumos-read-source": "legacy" } },
      );
    }
    if (!isMissingTableError(error)) return json({ error: error.message }, { status: 500 });

    const prefix = `user:${userId}:`;
    const { data: rowsDb, error: rowsErr } = await supabase
      .from("insumos")
      .select("id,item,medida,custo_medio,categoria,especificacao,ocultar")
      .like("id", `${prefix}%`)
      .order("item", { ascending: true });
    if (rowsErr) return json({ error: rowsErr.message }, { status: 500 });
    const rows = (rowsDb ?? []).map((r: any) => ({
      id: String(r.id ?? "").trim(),
      item: String(r.item ?? "").trim(),
      medida: String(r.medida ?? "").trim() || "Und",
      custoMedio: String(r.custo_medio ?? "").trim() || undefined,
      categoria: String(r.categoria ?? "").trim() || undefined,
      especificacao: String(r.especificacao ?? "").trim() || undefined,
      ocultar: typeof r.ocultar === "boolean" ? Boolean(r.ocultar) : undefined,
    }));
    const categories = Array.from(new Set(rows.map((r) => String(r.categoria ?? "").trim()).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b, "pt-BR", { sensitivity: "base", numeric: true }),
    );
    return json(
      { source: "legacy", readOnly: false, rows, categories },
      { status: 200, headers: { "x-cmv-insumos-read-source": "legacy" } },
    );
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as unknown;
    if (!body || typeof body !== "object") return json({ error: "invalid_body" }, { status: 400 });
    const { accessToken, id } = resolveUserScopedId(req);
    if (!id) return json({ error: "unauthorized" }, { status: 401 });
    const supabase = getSupabaseServerClient(accessToken);
    const userId = id.slice("user:".length);

    const { userId: rawUserId } = getUserIdFromRequest(req);
    const isAdmin = Boolean(rawUserId && isAdminUserId(rawUserId));
    const shouldUseCompat = await shouldUseCompatSource({ req, supabase, userId, isAdmin });

    const rows = Array.isArray((body as any).rows) ? ((body as any).rows as unknown[]) : null;
    if (!rows) return json({ error: "missing_rows" }, { status: 400 });
    const categoriesProvided = (body as any).categories;
    let categories: unknown[] = Array.isArray(categoriesProvided) ? (categoriesProvided as unknown[]) : [];

    if (shouldUseCompat) {
      let supabaseAdmin: ReturnType<typeof getSupabaseAdmin> | null = null;
      try {
        supabaseAdmin = getSupabaseAdmin();
      } catch {
        supabaseAdmin = null;
      }
      const db = supabaseAdmin ?? supabase;

      const { data: memberRows, error: memberErr } = await db
        .from("company_members")
        .select("company_id,role,permission_level")
        .eq("user_id", userId)
        .limit(50);
      if (memberErr) return json({ error: memberErr.message }, { status: 500 });
      let companyId = pickBestCompanyId((memberRows ?? []) as any[]);
      if (!companyId && supabaseAdmin) {
        companyId = (await resolveCurrentCompanyForUser(supabaseAdmin, userId)).companyId ?? "";
      }
      if (!companyId) companyId = await resolveCompanyFromMigratedAliases(db, userId);
      if (!companyId) return json({ error: "missing_company" }, { status: 500 });

      const { data: categoriesDb, error: catErr } = await db.from("categories").select("id,name").eq("company_id", companyId);
      if (catErr) return json({ error: catErr.message }, { status: 500 });
      const categoryIdByKey = new Map<string, string>();
      for (const c of categoriesDb ?? []) {
        const id0 = String((c as any)?.id ?? "").trim();
        const name0 = String((c as any)?.name ?? "").trim();
        if (!id0 || !name0) continue;
        categoryIdByKey.set(normalizeNameKey(name0), id0);
      }

      const categoryNames = new Set<string>();
      for (const c of categories) {
        const name0 = String(c ?? "").trim();
        if (!name0 || name0 === "-") continue;
        categoryNames.add(name0);
      }
      for (const r of rows as any[]) {
        const name0 = String(r?.categoria ?? "").trim();
        if (!name0 || name0 === "-") continue;
        categoryNames.add(name0);
      }

      const toCreate: { company_id: string; name: string }[] = [];
      const plannedCategoryKeys = new Set<string>();
      for (const name0 of categoryNames) {
        const key = normalizeNameKey(name0);
        if (!key || categoryIdByKey.has(key) || plannedCategoryKeys.has(key)) continue;
        plannedCategoryKeys.add(key);
        toCreate.push({ company_id: companyId, name: name0 });
      }
      if (toCreate.length) {
        const { data: created, error: createErr } = await db.from("categories").insert(toCreate as any).select("id,name");
        if (createErr) return json({ error: createErr.message }, { status: 500 });
        for (const c of created ?? []) {
          const id0 = String((c as any)?.id ?? "").trim();
          const name0 = String((c as any)?.name ?? "").trim();
          if (!id0 || !name0) continue;
          categoryIdByKey.set(normalizeNameKey(name0), id0);
        }
      }

      const bubbleIds = Array.from(
        new Set(
          (rows as any[])
            .map((r) => String(r?.id ?? "").trim())
            .filter((x) => looksLikeBubbleId(x)),
        ),
      );
      const dbIds = Array.from(
        new Set(
          (rows as any[])
            .map((r) => String(r?.id ?? "").trim())
            .map((x) => (x.startsWith("db:") ? x.slice("db:".length) : x))
            .filter((x) => isUuid(x)),
        ),
      );

      const existingIdByBubbleId = new Map<string, string>();
      if (bubbleIds.length) {
        const { data, error } = await db.from("items").select("id,bubble_id").eq("company_id", companyId).in("bubble_id", bubbleIds);
        if (error) return json({ error: error.message }, { status: 500 });
        for (const it of data ?? []) {
          const id0 = String((it as any)?.id ?? "").trim();
          const bid = String((it as any)?.bubble_id ?? "").trim();
          if (id0 && bid) existingIdByBubbleId.set(bid, id0);
        }
      }

      const existingIdById = new Map<string, string>();
      if (dbIds.length) {
        const { data, error } = await db.from("items").select("id").eq("company_id", companyId).in("id", dbIds);
        if (error) return json({ error: error.message }, { status: 500 });
        for (const it of data ?? []) {
          const id0 = String((it as any)?.id ?? "").trim();
          if (id0) existingIdById.set(id0, id0);
        }
      }

      const upsertByBubble: any[] = [];
      const upsertById: any[] = [];

      for (const r of rows as any[]) {
        const rawId = String(r?.id ?? "").trim();
        const name = String(r?.item ?? "").trim();
        if (!name) continue;

        const categoria = String(r?.categoria ?? "").trim();
        const categoriaKey = categoria && categoria !== "-" ? normalizeNameKey(categoria) : "";
        const categoryId = categoriaKey ? categoryIdByKey.get(categoriaKey) ?? null : null;

        const bubbleId = looksLikeBubbleId(rawId) ? rawId : null;
        const dbId = rawId.startsWith("db:") ? rawId.slice("db:".length) : isUuid(rawId) ? rawId : "";
        const existingId = bubbleId ? existingIdByBubbleId.get(bubbleId) ?? "" : dbId && existingIdById.has(dbId) ? dbId : "";

        const patch = {
          company_id: companyId,
          id: existingId || dbId || crypto.randomUUID(),
          bubble_id: bubbleId,
          name,
          unidade_medida: String(r?.medida ?? "").trim() || null,
          custo_medio: parseBrlNumber(r?.custoMedio),
          descricao: String(r?.especificacao ?? "").trim() || "",
          ocultar_cmv: typeof r?.ocultar === "boolean" ? Boolean(r.ocultar) : false,
          category_id: categoryId,
          item_receita: false,
          item_do_cardapio: false,
        };
        if (bubbleId) upsertByBubble.push(patch);
        else upsertById.push(patch);
      }

      if (upsertByBubble.length) {
        for (let start = 0; start < upsertByBubble.length; start += 100) {
          const { error } = await db.from("items").upsert(upsertByBubble.slice(start, start + 100) as any, { onConflict: "id" });
          if (error) return json({ error: error.message, stage: "compat.items_upsert_bubble", batchStart: start }, { status: 500 });
        }
      }
      if (upsertById.length) {
        for (let start = 0; start < upsertById.length; start += 100) {
          const { error } = await db.from("items").upsert(upsertById.slice(start, start + 100) as any, { onConflict: "id" });
          if (error) return json({ error: error.message, stage: "compat.items_upsert_id", batchStart: start }, { status: 500 });
        }
      }

      return json(
        { ok: true, savedCount: upsertByBubble.length + upsertById.length },
        {
          status: 200,
          headers: {
            "x-cmv-insumos-write-source": "compat",
          },
        },
      );
    }

    if (typeof categoriesProvided === "undefined") {
      const { data, error } = await supabase.from("insumos_state").select("*").eq("id", id).maybeSingle();
      if (!error) {
        const prevPayload = (data as any)?.payload;
        categories = Array.isArray(prevPayload?.categories) ? (prevPayload.categories as unknown[]) : [];
      }
    }

    const payload = { rows, categories };
    const { error } = await supabase.from("insumos_state").upsert({ id, payload } as any, { onConflict: "id" });
    if (!error) return json({ ok: true }, { status: 200, headers: { "x-cmv-insumos-write-source": "legacy" } });
    if (!isMissingTableError(error)) return json({ error: error.message }, { status: 500 });

    const prefix = `user:${userId}:`;
    const desired = (rows as any[]).map((r) => {
      const rawId = String(r?.id ?? "").trim();
      const idPart = safeSegment(rawId) || crypto.randomUUID();
      const dbId = rawId.startsWith(prefix) ? rawId : `${prefix}insumo:${idPart}`;
      return {
        id: dbId,
        item: String(r?.item ?? "").trim(),
        medida: String(r?.medida ?? "").trim() || "Und",
        custo_medio: String(r?.custoMedio ?? "").trim(),
        categoria: String(r?.categoria ?? "").trim(),
        especificacao: String(r?.especificacao ?? "").trim(),
        ocultar: typeof r?.ocultar === "boolean" ? Boolean(r.ocultar) : false,
      };
    });

    const { data: existing, error: listErr } = await supabase.from("insumos").select("id").like("id", `${prefix}%`).limit(5000);
    if (listErr) return json({ error: listErr.message }, { status: 500 });
    const keep = new Set(desired.map((r) => r.id));
    const toDelete = (existing ?? []).map((x: any) => String(x?.id ?? "").trim()).filter((x: string) => x && !keep.has(x));
    if (toDelete.length) {
      const { error: delErr } = await supabase.from("insumos").delete().in("id", toDelete);
      if (delErr) return json({ error: delErr.message }, { status: 500 });
    }
    if (desired.length) {
      const { error: upErr } = await supabase.from("insumos").upsert(desired as any, { onConflict: "id" });
      if (upErr) return json({ error: upErr.message }, { status: 500 });
    }
    return json({ ok: true }, { status: 200, headers: { "x-cmv-insumos-write-source": "legacy" } });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

type DeleteTarget = { id?: string; bubbleId?: string; key: string };

function normalizeDeleteTarget(input: { id?: unknown; bubbleId?: unknown }, indexKey: string): DeleteTarget | null {
  const rawId0 = String(input.id ?? "").trim();
  const rawBubble0 = String(input.bubbleId ?? "").trim();

  const rawId = rawId0.startsWith("db:") ? rawId0.slice("db:".length) : rawId0;
  const id = isUuid(rawId) ? rawId : "";
  const bubbleId = looksLikeBubbleId(rawId0) ? rawId0 : looksLikeBubbleId(rawBubble0) ? rawBubble0 : "";

  if (id) return { id, key: indexKey || `id:${id}` };
  if (bubbleId) return { bubbleId, key: indexKey || `bubble:${bubbleId}` };
  return null;
}

async function countRef(args: {
  supabase: ReturnType<typeof getSupabaseServerClient>;
  table: string;
  companyId: string;
  column: string;
  itemId: string;
}) {
  const { count, error } = await args.supabase
    .from(args.table)
    .select("id", { count: "exact", head: true })
    .eq("company_id", args.companyId)
    .eq(args.column, args.itemId);
  if (error) throw error;
  return typeof count === "number" ? count : 0;
}

async function getLinksBlockingDelete(args: { supabase: ReturnType<typeof getSupabaseServerClient>; companyId: string; itemId: string }) {
  const out: Array<{ table: string; columns: string[]; fk: string; count: number }> = [];

  const invoiceItems = await countRef({ supabase: args.supabase, table: "invoice_items", companyId: args.companyId, column: "item_id", itemId: args.itemId });
  if (invoiceItems > 0) out.push({ table: "invoice_items", columns: ["item_id"], fk: "set null", count: invoiceItems });

  const inventoryItems = await countRef({ supabase: args.supabase, table: "inventory_items", companyId: args.companyId, column: "item_id", itemId: args.itemId });
  if (inventoryItems > 0) out.push({ table: "inventory_items", columns: ["item_id"], fk: "set null", count: inventoryItems });

  const wastes = await countRef({ supabase: args.supabase, table: "wastes", companyId: args.companyId, column: "item_id", itemId: args.itemId });
  if (wastes > 0) out.push({ table: "wastes", columns: ["item_id"], fk: "set null", count: wastes });

  const supplierItems = await countRef({ supabase: args.supabase, table: "supplier_items", companyId: args.companyId, column: "item_id", itemId: args.itemId });
  if (supplierItems > 0) out.push({ table: "supplier_items", columns: ["item_id"], fk: "cascade", count: supplierItems });

  const shoppingListItems = await countRef({
    supabase: args.supabase,
    table: "shopping_list_items",
    companyId: args.companyId,
    column: "item_id",
    itemId: args.itemId,
  });
  if (shoppingListItems > 0) out.push({ table: "shopping_list_items", columns: ["item_id"], fk: "set null", count: shoppingListItems });

  const avgCostEvents = await countRef({ supabase: args.supabase, table: "avg_cost_events", companyId: args.companyId, column: "item_id", itemId: args.itemId });
  if (avgCostEvents > 0) out.push({ table: "avg_cost_events", columns: ["item_id"], fk: "set null", count: avgCostEvents });

  const recipeIngredientRecipe = await countRef({
    supabase: args.supabase,
    table: "recipe_ingredients",
    companyId: args.companyId,
    column: "recipe_item_id",
    itemId: args.itemId,
  });
  const recipeIngredientIngredient = await countRef({
    supabase: args.supabase,
    table: "recipe_ingredients",
    companyId: args.companyId,
    column: "ingredient_item_id",
    itemId: args.itemId,
  });
  const recipeIngredients = recipeIngredientRecipe + recipeIngredientIngredient;
  if (recipeIngredients > 0) {
    out.push({
      table: "recipe_ingredients",
      columns: ["recipe_item_id", "ingredient_item_id"],
      fk: "set null",
      count: recipeIngredients,
    });
  }

  return out;
}

async function getRecipeUsageNames(args: { supabase: ReturnType<typeof getSupabaseServerClient>; companyId: string; itemId: string }): Promise<string[]> {
  const names: string[] = [];
  const seen = new Set<string>();
  try {
    const res1 = await args.supabase
      .from("recipe_ingredients")
      .select("recipe_item:items!recipe_ingredients_recipe_item_id_fkey(name)")
      .eq("company_id", args.companyId)
      .eq("ingredient_item_id", args.itemId)
      .limit(50);
    if (!res1.error) {
      for (const r of res1.data ?? []) {
        const n = String((r as any)?.recipe_item?.name ?? "").trim();
        if (n && !seen.has(n.toLowerCase())) {
          seen.add(n.toLowerCase());
          names.push(n);
        }
      }
    }
  } catch {}
  try {
    const res2 = await args.supabase
      .from("recipe_ingredients")
      .select("ingredient_item:items!recipe_ingredients_ingredient_item_id_fkey(name)")
      .eq("company_id", args.companyId)
      .eq("recipe_item_id", args.itemId)
      .limit(50);
    if (!res2.error) {
      for (const r of res2.data ?? []) {
        const n = String((r as any)?.ingredient_item?.name ?? "").trim();
        if (n && !seen.has(n.toLowerCase())) {
          seen.add(n.toLowerCase());
          names.push(n);
        }
      }
    }
  } catch {}
  try {
    const res3 = await args.supabase
      .from("items")
      .select("name")
      .eq("company_id", args.companyId)
      .eq("id", args.itemId)
      .eq("item_receita", true)
      .maybeSingle();
    if (!res3.error && res3.data) {
      const n = String((res3.data as any)?.name ?? "").trim();
      if (n && !seen.has(n.toLowerCase())) {
        seen.add(n.toLowerCase());
        names.push(n);
      }
    }
  } catch {}
  return names;
}

async function deleteOneCompatItem(args: {
  supabase: ReturnType<typeof getSupabaseServerClient>;
  companyId: string;
  target: DeleteTarget;
  checkOnly?: boolean;
}) {
  const base = {
    source: "compat" as const,
    deletedCount: 0,
    deletedIds: [] as string[],
    archivedCount: 0,
    archivedIds: [] as string[],
    recipeNames: [] as string[],
  };

  const findQ = args.supabase.from("items").select("id,bubble_id,name").eq("company_id", args.companyId);
  const findRes = args.target.id ? await findQ.eq("id", args.target.id).maybeSingle() : await findQ.eq("bubble_id", args.target.bubbleId as string).maybeSingle();
  if (findRes.error) return { status: 500, body: { ...base, ok: false, error: findRes.error.message } };
  const itemId = String((findRes.data as any)?.id ?? "").trim();
  if (!itemId) return { status: 404, body: { ...base, ok: false, error: "not_found" } };

  let links: Array<{ table: string; columns: string[]; fk: string; count: number }> = [];
  let recipeNames: string[] = [];
  try {
    const [linkRes, rn] = await Promise.all([
      getLinksBlockingDelete({ supabase: args.supabase, companyId: args.companyId, itemId }),
      getRecipeUsageNames({ supabase: args.supabase, companyId: args.companyId, itemId }),
    ]);
    links = linkRes;
    recipeNames = rn;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: 500, body: { ...base, ok: false, error: msg } };
  }

  const hasRecipeLinks = links.some((l) => l.table === "recipe_ingredients") || recipeNames.length > 0;
  const hasAnyLinks = links.length > 0;

  if (args.checkOnly) {
    return {
      status: 200,
      body: {
        ...base,
        ok: true,
        checkOnly: true,
        links,
        recipeNames,
        hasRecipeLinks,
        hasAnyLinks,
        suggestedAction: !hasAnyLinks ? "delete" : hasRecipeLinks ? "block" : "archive",
      },
    };
  }

  if (hasRecipeLinks) {
    const list = recipeNames.slice(0, 10).join(", ") + (recipeNames.length > 10 ? "…" : "");
    const humanMsg = list
      ? `Usado em receitas${recipeNames.length > 1 ? ` (${recipeNames.length})` : ""}: ${list}. Não é possível excluir.`
      : `Usado em fichas técnicas ou pré-preparos. Não é possível excluir.`;
    return {
      status: 409,
      body: {
        ...base,
        ok: false,
        error: "used_in_recipe",
        humanMessage: humanMsg,
        links,
        recipeNames,
      },
    };
  }

  if (hasAnyLinks) {
    const patchRes = await args.supabase
      .from("items")
      .update({ ocultar_cmv: true })
      .eq("company_id", args.companyId)
      .eq("id", itemId)
      .select("id");
    if (patchRes.error) return { status: 500, body: { ...base, ok: false, error: patchRes.error.message } };
    const archivedIds = (patchRes.data ?? []).map((r: any) => String(r?.id ?? "").trim()).filter(Boolean);
    if (!archivedIds.length) return { status: 404, body: { ...base, ok: false, error: "not_found" } };
    return {
      status: 200,
      body: {
        ...base,
        ok: true,
        archived: true,
        archivedCount: archivedIds.length,
        archivedIds,
        archivedBecauseLinks: links,
      },
    };
  }

  const delRes = await args.supabase.from("items").delete().eq("company_id", args.companyId).eq("id", itemId).select("id");
  if (delRes.error) return { status: 500, body: { ...base, ok: false, error: delRes.error.message } };
  const deletedIds = (delRes.data ?? []).map((r: any) => String(r?.id ?? "").trim()).filter(Boolean);
  if (!deletedIds.length) return { status: 404, body: { ...base, ok: false, error: "not_found" } };

  const verify = await args.supabase.from("items").select("id").eq("company_id", args.companyId).eq("id", itemId).maybeSingle();
  if (verify.error) return { status: 500, body: { ...base, ok: false, error: verify.error.message } };
  if (verify.data) return { status: 500, body: { ...base, ok: false, error: "delete_not_applied" } };

  return { status: 200, body: { ...base, ok: true, deletedCount: deletedIds.length, deletedIds } };
}

export async function DELETE(req: NextRequest) {
  try {
    const { accessToken, id } = resolveUserScopedId(req);
    if (!id) return json({ ok: false, error: "unauthorized" }, { status: 401 });
    const supabase = getSupabaseServerClient(accessToken);
    const userId = id.slice("user:".length);

    const { userId: rawUserId } = getUserIdFromRequest(req);
    const isAdmin = Boolean(rawUserId && isAdminUserId(rawUserId));
    const shouldUseCompat = await shouldUseCompatSource({ req, supabase, userId, isAdmin });
    if (!shouldUseCompat) return json({ ok: false, error: "compat_required", source: "legacy" }, { status: 400 });

    const { data: memberRows, error: memberErr } = await supabase
      .from("company_members")
      .select("company_id,role,permission_level")
      .eq("user_id", userId)
      .limit(50);
    if (memberErr) return json({ ok: false, error: memberErr.message }, { status: 500 });
    let companyId = pickBestCompanyId((memberRows ?? []) as any[]);
    if (!companyId) {
      try {
        companyId = (await resolveCurrentCompanyForUser(getSupabaseAdmin(), userId)).companyId ?? "";
      } catch {}
    }
    if (!companyId) {
      try { companyId = await resolveCompanyFromMigratedAliases(getSupabaseAdmin(), userId); } catch {}
    }
    if (!companyId) return json({ ok: false, error: "missing_company" }, { status: 500 });

    const url = new URL(req.url);
    const checkOnly = String(url.searchParams.get("checkOnly") ?? url.searchParams.get("check_only") ?? "").trim() === "1";
    const qId = String(url.searchParams.get("id") ?? "").trim();
    const qBubbleId = String(url.searchParams.get("bubbleId") ?? url.searchParams.get("bubble_id") ?? "").trim();
    const body = (await req.json().catch(() => null)) as any;

    const ids = Array.isArray(body?.ids) ? (body.ids as unknown[]) : [];
    const bubbleIds = Array.isArray(body?.bubbleIds) ? (body.bubbleIds as unknown[]) : Array.isArray(body?.bubble_ids) ? (body.bubble_ids as unknown[]) : [];

    const batchTargets: DeleteTarget[] = [];
    for (let i = 0; i < ids.length; i++) {
      const t = normalizeDeleteTarget({ id: ids[i] }, `ids[${i}]`);
      if (t) batchTargets.push(t);
    }
    for (let i = 0; i < bubbleIds.length; i++) {
      const t = normalizeDeleteTarget({ bubbleId: bubbleIds[i] }, `bubbleIds[${i}]`);
      if (t) batchTargets.push(t);
    }

    const singleTarget = normalizeDeleteTarget(
      { id: body?.id ?? qId, bubbleId: body?.bubbleId ?? body?.bubble_id ?? qBubbleId },
      "single",
    );

    if (batchTargets.length) {
      const results: any[] = [];
      let totalDeleted = 0;
      let totalArchived = 0;
      const allDeletedIds: string[] = [];
      const allArchivedIds: string[] = [];
      for (const t of batchTargets) {
        const r = await deleteOneCompatItem({ supabase, companyId, target: t, checkOnly });
        const b: any = { key: t.key, ...r.body, status: r.status };
        results.push(b);
        if (!checkOnly) {
          if (typeof b.deletedCount === "number" && b.deletedCount > 0) totalDeleted += b.deletedCount;
          if (typeof b.archivedCount === "number" && b.archivedCount > 0) totalArchived += b.archivedCount;
          if (Array.isArray(b.deletedIds)) for (const x of b.deletedIds) if (x) allDeletedIds.push(x);
          if (Array.isArray(b.archivedIds)) for (const x of b.archivedIds) if (x) allArchivedIds.push(x);
        }
      }
      return json(
        {
          ok: true,
          source: "compat",
          checkOnly: checkOnly ? true : undefined,
          deletedCount: totalDeleted,
          deletedIds: allDeletedIds,
          archivedCount: totalArchived,
          archivedIds: allArchivedIds,
          results,
        },
        { status: 200 },
      );
    }

    if (!singleTarget) {
      return json({ ok: false, source: "compat", deletedCount: 0, deletedIds: [], error: "missing_id" }, { status: 400 });
    }

    const res = await deleteOneCompatItem({ supabase, companyId, target: singleTarget, checkOnly });
    return json(res.body, { status: res.status });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: msg }, { status: 500 });
  }
}
