import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getUserIdFromRequest } from "../../lib/requestUserId";
import { getSupabaseAdmin, getSupabaseServerClient } from "../../lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function dbg(hypothesisId: string, location: string, msg: string, data: unknown) {
  // #region debug-point E:csv-only-audit
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
  headers.set("cache-control", "no-store");
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

function parseEnvBool(value: string | undefined) {
  const v = String(value ?? "")
    .trim()
    .toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
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

function normalizeNameKey(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function looksLikeBubbleId(v: unknown) {
  const s = String(v ?? "").trim();
  return /^\d{6,}x\d{6,}$/.test(s);
}

async function seedCompanyItemsFromLegacy(args: { supabaseServer: ReturnType<typeof getSupabaseServerClient>; companyId: string; diag?: boolean }) {
  const { supabaseServer, companyId } = args;
  let supabaseAdmin: ReturnType<typeof getSupabaseAdmin> | null = null;
  try {
    supabaseAdmin = getSupabaseAdmin();
  } catch {
    supabaseAdmin = null;
  }
  const db = supabaseAdmin ?? supabaseServer;

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

  const scoreRow = (r: any) => parsePermissionLevel(r?.permission_level) * 100 + scoreRole(r?.role);
  const sorted = memberRows.slice().sort((a, b) => scoreRow(b) - scoreRow(a)).filter((r) => isUuid(String(r?.user_id ?? "").trim()));

  let legacyRows: any[] = [];
  let legacyCategories: any[] = [];
  let foundFrom: "insumos_state" | "insumos" | "inventario" | null = null;
  let legacyKey: string | null = null;
  let chosenUserId: string | null = null;

  for (const m of sorted.slice(0, 12)) {
    const uid = String(m?.user_id ?? "").trim();
    if (!uid || !isUuid(uid)) continue;
    const email = String(emailByUserId.get(uid) ?? "").trim().toLowerCase();
    const bubbleUserId = String(m?.bubble_user_id ?? bubbleUserIdByUserId.get(uid) ?? "").trim();

    const stateIds = [`user:${uid}`, email ? `user:${email}` : "", bubbleUserId ? `user:${bubbleUserId}` : ""].filter(Boolean);
    for (const legacyId of stateIds) {
      if (diagOut && diagOut.attempts.length < 60) diagOut.attempts.push({ source: "insumos_state", legacyId, uid });
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
          chosenUserId = uid;
          break;
        }
      }
    }
    if (legacyRows.length) break;

    const prefixes = [`user:${uid}:`, email ? `user:${email}:` : "", bubbleUserId ? `user:${bubbleUserId}:` : ""].filter(Boolean);
    for (const prefix of prefixes) {
      if (diagOut && diagOut.attempts.length < 60) diagOut.attempts.push({ source: "insumos", prefix, uid });
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
        chosenUserId = uid;
        break;
      }
    }
    if (legacyRows.length) break;
  }

  if (!legacyRows.length) {
    for (const m of sorted.slice(0, 12)) {
      const uid = String(m?.user_id ?? "").trim();
      if (!uid || !isUuid(uid)) continue;
      const email = String(emailByUserId.get(uid) ?? "").trim().toLowerCase();
      const bubbleUserId = String(m?.bubble_user_id ?? bubbleUserIdByUserId.get(uid) ?? "").trim();
      const prefixes = [`user:${uid}:`, email ? `user:${email}:` : "", bubbleUserId ? `user:${bubbleUserId}:` : ""].filter(Boolean);
      for (const prefix of prefixes) {
        if (diagOut && diagOut.attempts.length < 60) diagOut.attempts.push({ source: "inventario", prefix, uid });
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
        chosenUserId = uid;
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
    const categoryId = categoria ? categoryIdByKey.get(normalizeNameKey(categoria)) ?? null : null;
    const unidade = String((r as any)?.medida ?? "").trim() || "Und";
    const custo = parseNumber((r as any)?.custoMedio ?? (r as any)?.custo_medio);
    const descricao = String((r as any)?.especificacao ?? "").trim() || null;
    const ocultar = typeof (r as any)?.ocultar === "boolean" ? Boolean((r as any).ocultar) : null;
    const bubbleId = looksLikeBubbleId(rawId) ? rawId : "";

    const patch: any = {
      company_id: companyId,
      name,
      unidade_medida: unidade,
      custo_medio: Number.isFinite(custo) ? custo : null,
      descricao,
      category_id: categoryId,
      ocultar_cmv: ocultar,
      item_receita: false,
    };

    if (bubbleId) {
      patch.bubble_id = bubbleId;
      const existingId = existingIdByBubbleId.get(bubbleId) ?? "";
      if (existingId) patch.id = existingId;
      upsertByBubble.push(patch);
      continue;
    }

    upsertById.push({ ...patch, id: crypto.randomUUID() });
  }

  if (upsertByBubble.length) {
    const { error } = await db.from("items").upsert(upsertByBubble as any, { onConflict: "company_id,bubble_id" });
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

function resolveUserScopedId(req: NextRequest) {
  const { accessToken, userId } = getUserIdFromRequest(req);
  if (!userId) return { accessToken, id: null as string | null, rawUserId: null as string | null };
  if (isUuid(userId)) return { accessToken, id: `user:${userId}`, rawUserId: userId };
  const url = new URL(req.url);
  const override = String(url.searchParams.get("userId") ?? "").trim();
  if (override && isUuid(override) && isAdminUserId(userId)) return { accessToken, id: `user:${override}`, rawUserId: userId };
  return { accessToken, id: null as string | null, rawUserId: userId };
}

async function shouldUseCompatSource(args: { req: NextRequest; supabase: ReturnType<typeof getSupabaseServerClient>; userId: string; isAdmin: boolean }) {
  const url = new URL(args.req.url);
  const source = String(url.searchParams.get("source") ?? "")
    .trim()
    .toLowerCase();
  if (source === "legacy") return false;

  const enabled = parseEnvBool(process.env.BUBBLE_COMPAT_READ_LISTA_DE_COMPRAS);
  if (source === "compat") return args.isAdmin ? true : enabled;
  if (enabled) return true;

  const { data, error } = await args.supabase.from("company_members").select("company_id").eq("user_id", args.userId).limit(1);
  if (!error && (data ?? []).length) return true;

  const { data: companiesRows, error: compErr } = await args.supabase.from("companies").select("id").eq("created_by_user_id", args.userId).limit(1);
  if (!compErr && (companiesRows ?? []).length) return true;

  return false;
}

function extractBubbleId(input: unknown) {
  if (input == null) return "";
  if (typeof input === "object") {
    const v: any = input as any;
    const direct = String(v?.unique_id ?? v?._id ?? v?.id ?? v?.bubble_id ?? "").trim();
    if (direct) return direct;
    let s = "";
    try {
      s = JSON.stringify(input);
    } catch {
      s = "";
    }
    const m = s.match(/\d{8,}x\d{6,}/);
    return m ? String(m[0]).trim() : "";
  }
  const s = String(input ?? "").trim();
  const m = s.match(/\d{8,}x\d{6,}/);
  return m ? String(m[0]).trim() : "";
}

function parseNumber(v: unknown) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v ?? "")
    .trim()
    .replace(/[^\d,.-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function parseDateOnlyLoose(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (m) {
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    const yyyy = Number(m[3]);
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (isoMatch) return raw;
  const normalized = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(",", "")
    .replace(/\s+/g, " ");
  const monthMap: Record<string, number> = {
    jan: 1,
    fev: 2,
    mar: 3,
    abr: 4,
    mai: 5,
    jun: 6,
    jul: 7,
    ago: 8,
    set: 9,
    out: 10,
    nov: 11,
    dez: 12,
  };
  const monthMatch = /^(\d{1,2})\s+([a-z]{3})\.?\s+(\d{4})$/.exec(normalized);
  if (monthMatch) {
    const dd = Number(monthMatch[1]);
    const mm = monthMap[monthMatch[2]] ?? 0;
    const yyyy = Number(monthMatch[3]);
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const diagEnabled = String(url.searchParams.get("diag") ?? "").trim() === "1";
    const { accessToken, id, rawUserId } = resolveUserScopedId(req);
    if (!id) return json({ ok: true, source: "legacy", readOnly: false, rows: [], ...(diagEnabled ? { diag: { reason: "unauthorized" } } : {}) }, { status: 200 });
    const supabaseServer = getSupabaseServerClient(accessToken);
    const userId = id.slice("user:".length);

    const isAdmin = Boolean(rawUserId && isAdminUserId(rawUserId));
    const useCompat = await shouldUseCompatSource({ req, supabase: supabaseServer, userId, isAdmin });
    await dbg("E", "api/lista-de-compras", "source_selected", {
      useCompat,
      rawUserId: rawUserId ? String(rawUserId) : null,
      userId,
      flags: { BUBBLE_COMPAT_READ_LISTA_DE_COMPRAS: process.env.BUBBLE_COMPAT_READ_LISTA_DE_COMPRAS ?? null },
    });
    if (useCompat) {
      const startInventoryId = String(url.searchParams.get("startInventoryId") ?? "").trim();
      const endInventoryId = String(url.searchParams.get("endInventoryId") ?? "").trim();
      const diasEstoqueParam = String(url.searchParams.get("diasEstoque") ?? "").trim();
      const prazoFornecedorParam = String(url.searchParams.get("prazoFornecedor") ?? "").trim();
      const diasEstoqueNumRaw = diasEstoqueParam ? Number(diasEstoqueParam.replace(/[^\d.]/g, "")) : NaN;
      const prazoFornecedorNumRaw = prazoFornecedorParam ? Number(prazoFornecedorParam.replace(/[^\d.]/g, "")) : NaN;
      const diasEstoque = Number.isFinite(diasEstoqueNumRaw) && diasEstoqueNumRaw > 0 ? Math.floor(diasEstoqueNumRaw) : 7;
      const prazoFornecedor = Number.isFinite(prazoFornecedorNumRaw) && prazoFornecedorNumRaw >= 0 ? Math.floor(prazoFornecedorNumRaw) : 1;

      const { data: memberRows, error: memberErr } = await supabaseServer
        .from("company_members")
        .select("company_id,role,permission_level")
        .eq("user_id", userId)
        .limit(50);
      if (memberErr) return json({ ok: false, error: memberErr.message, source: "compat", readOnly: true }, { status: 500 });
      let companyId = pickBestCompanyId((memberRows ?? []) as any[]);
      if (!companyId) {
        const { data: createdRows, error: createdErr } = await supabaseServer
          .from("companies")
          .select("id")
          .eq("created_by_user_id", userId)
          .order("updated_at", { ascending: false })
          .limit(1);
        if (createdErr) {
          await dbg("E", "api/lista-de-compras", "missing_company_fallback_failed", { error: createdErr.message, userId });
        }
        companyId = String(((createdRows ?? [])[0] as any)?.id ?? "").trim();
      }
      if (!companyId) {
        await dbg("E", "api/lista-de-compras", "missing_company", { userId, memberRows: (memberRows ?? []).length });
        return json(
          {
            ok: true,
            source: "legacy",
            readOnly: false,
            rows: [],
            banner: diagEnabled ? "Sem vínculo de empresa no banco compatível (company_members). Use legacy." : undefined,
          },
          { status: 200 },
        );
      }

      const { data: invRows, error: invErr } = await supabaseServer
        .from("inventories")
        .select("id,bubble_id,nome,data_contagem")
        .eq("company_id", companyId)
        .order("data_contagem", { ascending: false })
        .limit(200);
      if (invErr) return json({ ok: false, error: invErr.message, source: "compat", readOnly: true }, { status: 500 });
      await dbg("E", "api/lista-de-compras", "compat_inventories_loaded", {
        companyId,
        inventories: (invRows ?? []).length,
        sample: (invRows ?? []).slice(0, 5).map((r: any) => ({ id: String(r?.id ?? ""), data_contagem: r?.data_contagem ?? null })),
      });

      const legacyPeriodPrefix = `${id}:`;
      const { data: legacyInventoryRows, error: legacyInventoryErr } = await supabaseServer
        .from("inventario")
        .select("id,data,categorias,created_at")
        .like("id", `${legacyPeriodPrefix}%`)
        .order("created_at", { ascending: false })
        .limit(400);
      if (legacyInventoryErr) {
        return json({ ok: false, error: legacyInventoryErr.message, source: "compat", readOnly: true }, { status: 500 });
      }
      const legacyInventoryRowsForPeriod = (legacyInventoryRows ?? [])
        .map((r: any) => ({
          id: String(r?.id ?? "").trim(),
          bubble_id: null,
          nome: `Inventário ${String(r?.data ?? "").trim()}`,
          data_contagem: parseDateOnlyLoose(r?.data),
        }))
        .filter((r: any) => r.id && r.data_contagem)
        .sort((a: any, b: any) => String(b.data_contagem).localeCompare(String(a.data_contagem)));
      const inventoryRowsForPeriod = legacyInventoryRowsForPeriod.length ? legacyInventoryRowsForPeriod : ((invRows ?? []) as any[]);
      const inventories = inventoryRowsForPeriod.map((r: any) => ({
        id: String(r?.id ?? "").trim(),
        bubble_id: r?.bubble_id ? String(r.bubble_id) : null,
        nome: String(r?.nome ?? "").trim(),
        data_contagem: r?.data_contagem ? String(r.data_contagem) : null,
      }));

      const endInvId =
        (endInventoryId && inventories.some((x) => x.id === endInventoryId) ? endInventoryId : "") || (inventories[0]?.id ? inventories[0].id : "");
      const startInvId =
        (startInventoryId && inventories.some((x) => x.id === startInventoryId) ? startInventoryId : "") || (inventories[1]?.id ? inventories[1].id : endInvId);

      const invById = new Map<string, any>(inventories.map((x) => [x.id, x]));
      const startInv = invById.get(startInvId) ?? null;
      const endInv = invById.get(endInvId) ?? null;

      const toDateOnly = (value: string | null) => {
        if (!value) return null;
        const d = new Date(value);
        if (!Number.isFinite(d.getTime())) return null;
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
      };
      const startDate = toDateOnly(String(startInv?.data_contagem ?? "")) ?? null;
      const endDate = toDateOnly(String(endInv?.data_contagem ?? "")) ?? null;

      const daysBetweenDateOnly = (a: string, b: string) => {
        const parse = (s: string) => {
          const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
          if (!m) return NaN;
          return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        };
        const ta = parse(a);
        const tb = parse(b);
        if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 0;
        return Math.round((tb - ta) / 86_400_000);
      };

      const legacyPrefix = `${id}:`;
      const legacyInventarios = endDate || startDate
        ? await supabaseServer
            .from("inventario")
            .select("id,data,categorias,created_at")
            .like("id", `${legacyPrefix}%`)
            .order("created_at", { ascending: false })
            .limit(400)
        : { data: [], error: null as any };
      if ((legacyInventarios as any)?.error) {
        await dbg("E", "api/lista-de-compras", "legacy_inventario_load_failed", { error: String((legacyInventarios as any)?.error?.message ?? "") });
      }
      const legacyRows = ((legacyInventarios as any)?.data ?? []) as any[];
      const findLegacyInventoryRow = (targetDate: string | null) => {
        if (!targetDate) return null;
        const targetT = Date.parse(targetDate);
        let bestRow: any = null;
        let bestT = Number.NEGATIVE_INFINITY;
        for (const r of legacyRows) {
          const d = parseDateOnlyLoose(r?.data);
          if (!d) continue;
          if (d === targetDate) return r;
          const t = Date.parse(d);
          if (!Number.isFinite(targetT) || !Number.isFinite(t)) continue;
          if (t <= targetT && t > bestT) {
            bestT = t;
            bestRow = r;
          }
        }
        return bestRow;
      };
      const legacyStartRow = findLegacyInventoryRow(startDate);
      const legacyEndRow = findLegacyInventoryRow(endDate);
      const legacyStartQtyByNameKey = new Map<string, number>();
      const legacyEndQtyByNameKey = new Map<string, number>();
      const fillLegacyMap = (row: any, map: Map<string, number>) => {
        const categorias = Array.isArray(row?.categorias) ? (row.categorias as any[]) : [];
        for (const c of categorias) {
          const itens = Array.isArray(c?.itens) ? (c.itens as any[]) : [];
          for (const it of itens) {
            const nameKey = normalizeNameKey(String(it?.item ?? ""));
            if (!nameKey) continue;
            const qty = parseNumber(it?.estoqueFinal ?? it?.quantidadeContada ?? it?.quantidade_contada ?? it?.quantidade ?? "");
            const prev = map.get(nameKey) ?? 0;
            map.set(nameKey, Math.max(prev, qty));
          }
        }
      };
      if (legacyStartRow) fillLegacyMap(legacyStartRow, legacyStartQtyByNameKey);
      if (legacyEndRow) fillLegacyMap(legacyEndRow, legacyEndQtyByNameKey);
      await dbg("E", "api/lista-de-compras", "legacy_inventario_fallback_loaded", {
        startDate,
        endDate,
        legacyStartFound: Boolean(legacyStartRow),
        legacyEndFound: Boolean(legacyEndRow),
        legacyStartItems: legacyStartQtyByNameKey.size,
        legacyEndItems: legacyEndQtyByNameKey.size,
      });

      const invIdsToLoad = Array.from(
        new Set([startInvId, endInvId].filter((id): id is string => Boolean(id) && isUuid(id))),
      );
      const { data: invItemRows, error: invItemErr } = invIdsToLoad.length
        ? await supabaseServer
            .from("inventory_items")
            .select("inventory_id,item_id,quantidade_contada,raw,item:items(id,bubble_id,name)")
            .eq("company_id", companyId)
            .in("inventory_id", invIdsToLoad)
            .limit(50_000)
        : { data: [], error: null as any };
      if (invItemErr) return json({ ok: false, error: invItemErr.message, source: "compat", readOnly: true }, { status: 500 });

      const invItemRowsSafe = (invItemRows ?? []) as any[];

      const { data: entradaRows, error: entradaErr } =
        startDate && endDate
          ? await supabaseServer
              .from("invoice_items")
              .select("item_id,quantidade,subtotal,cadastro_item,data_lancamento")
              .eq("company_id", companyId)
              .eq("cadastro_item", false)
              .gte("data_lancamento", startDate)
              .lte("data_lancamento", endDate)
              .limit(50_000)
          : { data: [], error: null as any };
      if (entradaErr) return json({ ok: false, error: entradaErr.message, source: "compat", readOnly: true }, { status: 500 });
      const entradasByItemId = new Map<string, number>();
      const entradasSubtotalByItemId = new Map<string, number>();
      for (const r of (entradaRows ?? []) as any[]) {
        const itemId = String(r?.item_id ?? "").trim();
        if (!itemId) continue;
        const qty = parseNumber(r?.quantidade);
        const subtotal = parseNumber(r?.subtotal);
        if (qty) entradasByItemId.set(itemId, (entradasByItemId.get(itemId) ?? 0) + qty);
        if (subtotal) entradasSubtotalByItemId.set(itemId, (entradasSubtotalByItemId.get(itemId) ?? 0) + subtotal);
      }

      const { data: itemsRows, error: itemsErr } = await supabaseServer
        .from("items")
        .select("id,bubble_id,name,unidade_medida,custo_medio,category_id,item_receita")
        .eq("company_id", companyId)
        .or("item_receita.is.null,item_receita.eq.false")
        .order("name", { ascending: true })
        .limit(50_000);
      if (itemsErr) return json({ ok: false, error: itemsErr.message, source: "compat", readOnly: true }, { status: 500 });
      let itemsRowsSafe = (itemsRows ?? []) as any[];
      let seedDiag: any = null;
      if (!itemsRowsSafe.length) {
        const seedRes = await seedCompanyItemsFromLegacy({ supabaseServer, companyId, diag: diagEnabled });
        const seeded = Boolean(seedRes?.ok);
        seedDiag = seedRes?.diag ?? null;
        if (seeded) {
          const { data: itemsRows2, error: itemsErr2 } = await supabaseServer
            .from("items")
            .select("id,bubble_id,name,unidade_medida,custo_medio,category_id,item_receita")
            .eq("company_id", companyId)
            .or("item_receita.is.null,item_receita.eq.false")
            .order("name", { ascending: true })
            .limit(50_000);
          if (!itemsErr2) itemsRowsSafe = (itemsRows2 ?? []) as any[];
        }
      }
      if (!itemsRowsSafe.length) return json({ ok: true, source: "legacy", readOnly: false, rows: [] }, { status: 200 });

      const itemUuidByBubbleId = new Map<string, string>();
      const itemUuidByNameKey = new Map<string, string>();
      for (const it of itemsRowsSafe) {
        const id = String(it?.id ?? "").trim();
        if (!id) continue;
        const b = String(it?.bubble_id ?? "").trim();
        const nameKey = normalizeNameKey(String(it?.name ?? ""));
        if (b && !itemUuidByBubbleId.has(b)) itemUuidByBubbleId.set(b, id);
        if (nameKey && !itemUuidByNameKey.has(nameKey)) itemUuidByNameKey.set(nameKey, id);
      }

      const categoryIds = Array.from(new Set(itemsRowsSafe.map((r: any) => String(r?.category_id ?? "").trim()).filter(Boolean)));
      const { data: catRows, error: catErr } = categoryIds.length
        ? await supabaseServer.from("categories").select("id,name").eq("company_id", companyId).in("id", categoryIds)
        : { data: [], error: null as any };
      if (catErr) return json({ ok: false, error: catErr.message, source: "compat", readOnly: true }, { status: 500 });
      const categoryNameById = new Map<string, string>((catRows ?? []).map((r: any) => [String(r?.id ?? "").trim(), String(r?.name ?? "").trim()]));

      const { data: selectedRows, error: selErr } = await supabaseServer
        .from("shopping_list_items")
        .select("id,bubble_id,item_id,item_nome,item_medida,qtd_compra,qtd_sugestao,tipo")
        .eq("company_id", companyId)
        .in("tipo", ["", "itens"])
        .order("created_at", { ascending: true })
        .limit(50_000);
      if (selErr) return json({ ok: false, error: selErr.message, source: "compat", readOnly: true }, { status: 500 });

      const selectedByItemId = new Map<string, any>();
      for (const r of (selectedRows ?? []) as any[]) {
        const itemId = String(r?.item_id ?? "").trim();
        if (!itemId) continue;
        selectedByItemId.set(itemId, r);
      }

      const { data: realRows, error: realErr } = await supabaseServer.from("purchase_real_qty").select("item_id,quantidade").eq("company_id", companyId).limit(50_000);
      if (realErr) return json({ ok: false, error: realErr.message, source: "compat", readOnly: true }, { status: 500 });
      const realByItemId = new Map<string, number>();
      for (const r of (realRows ?? []) as any[]) {
        const itemId = String(r?.item_id ?? "").trim();
        if (!itemId) continue;
        const q = parseNumber(r?.quantidade);
        realByItemId.set(itemId, q);
      }

      const { data: supplierItemRows, error: siErr } = await supabaseServer.from("supplier_items").select("item_id,supplier_id").eq("company_id", companyId).limit(50_000);
      if (siErr) return json({ ok: false, error: siErr.message, source: "compat", readOnly: true }, { status: 500 });
      // Load the complete company catalogue. The supplier selector must not be
      // restricted to suppliers already linked to one of the calculated rows.
      const { data: supRows, error: supErr } = await supabaseServer
        .from("suppliers")
        .select("id,nome")
        .eq("company_id", companyId)
        .order("nome", { ascending: true })
        .limit(10_000);
      if (supErr) return json({ ok: false, error: supErr.message, source: "compat", readOnly: true }, { status: 500 });
      const supplierNameById = new Map<string, string>();
      for (const r of (supRows ?? []) as any[]) {
        const id = String(r?.id ?? "").trim();
        const nome = String(r?.nome ?? "").trim();
        if (!id || !nome) continue;
        if (normalizeNameKey(nome) === "sem fornecedor") continue;
        supplierNameById.set(id, nome);
      }
      const suppliers = Array.from(supplierNameById, ([id, name]) => ({ id, name }));
      const supplierNamesByItemId = new Map<string, string[]>();
      for (const r of (supplierItemRows ?? []) as any[]) {
        const itemId = String(r?.item_id ?? "").trim();
        const supplierId = String(r?.supplier_id ?? "").trim();
        if (!itemId || !supplierId) continue;
        const nome = supplierNameById.get(supplierId) ?? "";
        if (!nome) continue;
        const cur = supplierNamesByItemId.get(itemId) ?? [];
        cur.push(nome);
        supplierNamesByItemId.set(itemId, cur);
      }
      for (const [itemId, list] of supplierNamesByItemId.entries()) {
        const uniq = Array.from(new Set(list.map((x) => x.trim()).filter(Boolean)));
        uniq.sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));
        supplierNamesByItemId.set(itemId, uniq);
      }

      const itemsById = new Map<string, any>(itemsRowsSafe.map((r: any) => [String(r?.id ?? "").trim(), r]));

      const estoqueInicialByItemId = new Map<string, number>();
      const estoqueFinalByItemId = new Map<string, number>();
      const estoqueInicialByBubbleId = new Map<string, number>();
      const estoqueFinalByBubbleId = new Map<string, number>();
      const estoqueInicialByNameKey = new Map<string, number>();
      const estoqueFinalByNameKey = new Map<string, number>();
      let invResolvedByUuid = 0;
      let invResolvedByBubble = 0;
      let invResolvedByName = 0;
      for (const r of invItemRowsSafe) {
        const iid = String(r?.inventory_id ?? "").trim();
        const rawItemId = String(r?.item_id ?? "").trim();
        if (!iid || !rawItemId) continue;
        const qty = parseNumber(r?.quantidade_contada);
        if (!qty) continue;

        let resolvedItemId = "";
        let bubbleId = String(r?.item?.bubble_id ?? "").trim();
        let nameKey = normalizeNameKey(String(r?.item?.name ?? ""));
        const rawBubbleItemId = extractBubbleId(r?.raw?.item_id ?? r?.raw?.item_bubble_id ?? r?.raw?.item ?? "");
        const rawItemName = r?.raw?.item_nome ?? r?.raw?.nome_item ?? r?.raw?.item_name ?? r?.raw?.nome ?? "";
        if (!bubbleId && rawBubbleItemId) bubbleId = rawBubbleItemId;
        if (!nameKey && rawItemName) nameKey = normalizeNameKey(rawItemName);

        const linkedItemId = String(r?.item?.id ?? "").trim();
        if (linkedItemId) {
          resolvedItemId = linkedItemId;
          if (!bubbleId) bubbleId = String(itemsById.get(resolvedItemId)?.bubble_id ?? "").trim();
          if (!nameKey) nameKey = normalizeNameKey(String(itemsById.get(resolvedItemId)?.name ?? ""));
        } else if (isUuid(rawItemId)) {
          resolvedItemId = rawItemId;
          const exists = itemsById.has(resolvedItemId);
          if (exists) {
            if (!bubbleId) bubbleId = String(itemsById.get(resolvedItemId)?.bubble_id ?? "").trim();
            if (!nameKey) nameKey = normalizeNameKey(String(itemsById.get(resolvedItemId)?.name ?? ""));
          } else if (rawBubbleItemId) {
            const mapped = itemUuidByBubbleId.get(rawBubbleItemId) ?? "";
            if (mapped) {
              resolvedItemId = mapped;
              bubbleId = bubbleId || rawBubbleItemId;
              nameKey = nameKey || normalizeNameKey(String(itemsById.get(mapped)?.name ?? ""));
            }
          }
        } else {
          const extracted = extractBubbleId(rawItemId);
          const bubbleCandidate = extracted || rawItemId;
          const mapped = bubbleCandidate ? itemUuidByBubbleId.get(bubbleCandidate) ?? "" : "";
          if (mapped) {
            resolvedItemId = mapped;
            bubbleId = bubbleId || bubbleCandidate;
            nameKey = nameKey || normalizeNameKey(String(itemsById.get(mapped)?.name ?? ""));
          }
        }

        if (!resolvedItemId && !nameKey) continue;
        if (!resolvedItemId && nameKey) {
          const mappedByName = itemUuidByNameKey.get(nameKey) ?? "";
          if (mappedByName) resolvedItemId = mappedByName;
        }

        if (resolvedItemId) invResolvedByUuid += 1;
        if (bubbleId) invResolvedByBubble += 1;
        if (nameKey) invResolvedByName += 1;

        if (iid === startInvId) {
          if (resolvedItemId) estoqueInicialByItemId.set(resolvedItemId, Math.max(estoqueInicialByItemId.get(resolvedItemId) ?? 0, qty));
          if (bubbleId) estoqueInicialByBubbleId.set(bubbleId, Math.max(estoqueInicialByBubbleId.get(bubbleId) ?? 0, qty));
          if (nameKey) estoqueInicialByNameKey.set(nameKey, Math.max(estoqueInicialByNameKey.get(nameKey) ?? 0, qty));
        }
        if (iid === endInvId) {
          if (resolvedItemId) estoqueFinalByItemId.set(resolvedItemId, Math.max(estoqueFinalByItemId.get(resolvedItemId) ?? 0, qty));
          if (bubbleId) estoqueFinalByBubbleId.set(bubbleId, Math.max(estoqueFinalByBubbleId.get(bubbleId) ?? 0, qty));
          if (nameKey) estoqueFinalByNameKey.set(nameKey, Math.max(estoqueFinalByNameKey.get(nameKey) ?? 0, qty));
        }
      }
      await dbg("E", "api/lista-de-compras", "compat_inventory_items_resolve_stats", {
        loaded: invItemRowsSafe.length,
        invResolvedByUuid,
        invResolvedByBubble,
        invResolvedByName,
        startInvId,
        endInvId,
      });

      const diasCorridosBubble = startDate && endDate ? daysBetweenDateOnly(startDate, endDate) : 0;

      const rowsCompat = itemsRowsSafe
        .map((item: any) => {
          const itemId = String(item?.id ?? "").trim();
          if (!itemId) return null;
          const sel = selectedByItemId.get(itemId) ?? null;

          const bubbleItemId = String(item?.bubble_id ?? "").trim();
          const outId = bubbleItemId || `db:${itemId}`;

          const categoria = categoryNameById.get(String(item?.category_id ?? "").trim()) || "Sem categoria";
          const unidade = String(item?.unidade_medida ?? "").trim() || "Und";
          const custoMedio = parseNumber(item?.custo_medio);

          const nameKey = normalizeNameKey(String(item?.name ?? ""));

          const estoqueInicial =
            estoqueInicialByItemId.get(itemId) ??
            (bubbleItemId ? estoqueInicialByItemId.get(bubbleItemId) : undefined) ??
            (bubbleItemId ? estoqueInicialByBubbleId.get(bubbleItemId) : undefined) ??
            (nameKey ? estoqueInicialByNameKey.get(nameKey) : undefined) ??
            0;
          const legacyEstoqueInicial = nameKey ? legacyStartQtyByNameKey.get(nameKey) ?? 0 : 0;
          const estoqueInicialResolved = estoqueInicial !== 0 ? estoqueInicial : legacyEstoqueInicial;

          const estoqueAtual =
            estoqueFinalByItemId.get(itemId) ??
            (bubbleItemId ? estoqueFinalByItemId.get(bubbleItemId) : undefined) ??
            (bubbleItemId ? estoqueFinalByBubbleId.get(bubbleItemId) : undefined) ??
            (nameKey ? estoqueFinalByNameKey.get(nameKey) : undefined) ??
            0;
          const legacyEstoqueAtual = nameKey ? legacyEndQtyByNameKey.get(nameKey) ?? 0 : 0;
          const estoqueAtualResolved = estoqueAtual !== 0 ? estoqueAtual : legacyEstoqueAtual;
          const entradas = entradasByItemId.get(itemId) ?? 0;

          const saidas = estoqueInicialResolved + (entradas - estoqueAtualResolved);
          const consumoDiario = diasCorridosBubble > 0 ? saidas / diasCorridosBubble : 0;
          const consumoDiasManter = consumoDiario * diasEstoque;
          const consumoPrazoFornecedor = consumoDiario * prazoFornecedor;
          const sugestaoCalc = consumoDiasManter - (estoqueAtualResolved + consumoPrazoFornecedor);

          const qtdCompraStored = sel ? parseNumber(sel?.qtd_compra) : 0;
          const qtdSugestaoStored = sel ? parseNumber(sel?.qtd_sugestao) : 0;
          const comprar = Math.max(qtdCompraStored > 0 ? qtdCompraStored : sugestaoCalc, 0);

          const realQty = realByItemId.get(itemId) ?? 0;
          const fornecedores = supplierNamesByItemId.get(itemId) ?? [];
          const fornecedor = fornecedores[0] ?? "-";
          const custoPrevisto = comprar * custoMedio;
          const custoReal = realQty * custoMedio;

          return {
            id: outId,
            bubble_id: bubbleItemId || null,
            db_item_id: itemId,
            itemNome: String(item?.name ?? "").trim() || "Item",
            categoria,
            unidade,
            fornecedor,
            fornecedores,
            quantidadeSugerida: sugestaoCalc,
            quantidadeCompra: comprar,
            quantidadeReal: realQty,
            custoMedio,
            custoPrevisto,
            custoReal,
            selected: Boolean(sel),
            selection: sel
              ? {
                  id: String(sel?.id ?? "").trim() || null,
                  bubble_id: sel?.bubble_id ? String(sel.bubble_id) : null,
                  qtd_compra: qtdCompraStored,
                  qtd_sugestao: qtdSugestaoStored,
                  tipo: String(sel?.tipo ?? "").trim(),
                }
              : null,
            calc: {
              startInventoryId: startInvId || null,
              endInventoryId: endInvId || null,
              startDate,
              endDate,
              diasCorridos: diasCorridosBubble,
              diasEstoque,
              prazoFornecedor,
              estoqueInicial: estoqueInicialResolved,
              estoqueAtual: estoqueAtualResolved,
              entradas,
              saidas,
              consumoDiario,
              consumoDiasManter,
              consumoPrazoFornecedor,
              sugestaoCalc,
            },
          };
        })
        .filter(Boolean);

      const totals = rowsCompat.reduce(
        (acc: any, r: any) => {
          acc.itens += 1;
          acc.custoPrevisto += typeof r?.custoPrevisto === "number" ? r.custoPrevisto : 0;
          acc.custoReal += typeof r?.custoReal === "number" ? r.custoReal : 0;
          return acc;
        },
        { itens: 0, custoPrevisto: 0, custoReal: 0 },
      );

      const diag = (() => {
        if (!diagEnabled) return null;
        const legacyDatesSample = legacyRows.slice(0, 12).map((r: any) => ({ data: r?.data ?? null, parsed: parseDateOnlyLoose(r?.data) }));
        const sampleNameKeys = ["brownie tradicional 6x6", "papel acoplado", "caixa de fritas simples"];
        const samples = sampleNameKeys.map((nk) => {
          const row = (rowsCompat as any[]).find((x) => normalizeNameKey(x?.itemNome ?? "") === nk) ?? null;
          if (!row) return { nameKey: nk, found: false };
          const itemId = String(row?.db_item_id ?? "").trim();
          const bubbleId = String(row?.bubble_id ?? "").trim();
          const nameKey = normalizeNameKey(String(row?.itemNome ?? ""));
          const compatValue =
            estoqueFinalByItemId.get(itemId) ??
            (bubbleId ? estoqueFinalByBubbleId.get(bubbleId) : undefined) ??
            (nameKey ? estoqueFinalByNameKey.get(nameKey) : undefined) ??
            0;
          const legacyValue = nameKey ? legacyEndQtyByNameKey.get(nameKey) ?? 0 : 0;
          const resolved = parseNumber(row?.calc?.estoqueAtual);
          return { nameKey: nk, found: true, itemId: itemId || null, bubbleId: bubbleId || null, compatValue, legacyValue, resolved };
        });
        const nonZeroFinal = (rowsCompat as any[]).reduce((acc, r) => acc + (parseNumber(r?.calc?.estoqueAtual) > 0 ? 1 : 0), 0);
        return {
          useCompat,
          companyId,
          seed: seedDiag,
          startInvId,
          endInvId,
          startDate,
          endDate,
          diasEstoque,
          prazoFornecedor,
          invItemRows: invItemRowsSafe.length,
          invResolvedByUuid,
          invResolvedByBubble,
          invResolvedByName,
          estoqueFinalByItemId: estoqueFinalByItemId.size,
          estoqueFinalByBubbleId: estoqueFinalByBubbleId.size,
          estoqueFinalByNameKey: estoqueFinalByNameKey.size,
          legacyRows: legacyRows.length,
          legacyStartFound: Boolean(legacyStartRow),
          legacyEndFound: Boolean(legacyEndRow),
          legacyEndItems: legacyEndQtyByNameKey.size,
          legacyDatesSample,
          nonZeroFinal,
          samples,
        };
      })();

      return json(
        {
          ok: true,
          source: "compat",
          readOnly: true,
          banner: "Modo somente leitura.",
          rows: rowsCompat,
          suppliers,
          totals,
          filters: { startInventoryId: startInvId || null, endInventoryId: endInvId || null, diasEstoque, prazoFornecedor },
          inventories,
          diag,
        },
        { status: 200 },
      );
    }
    let diagLegacy: any = null;
    if (diagEnabled) {
      let supabaseAdmin: ReturnType<typeof getSupabaseAdmin> | null = null;
      try {
        supabaseAdmin = getSupabaseAdmin();
      } catch {
        supabaseAdmin = null;
      }
      const db = supabaseAdmin ?? supabaseServer;
      const { data: memberRows, error: memberErr } = await db.from("company_members").select("company_id").eq("user_id", userId).limit(3);
      const { data: createdRows, error: createdErr } = await db.from("companies").select("id").eq("created_by_user_id", userId).limit(3);
      diagLegacy = {
        useCompat,
        userId,
        companyMembersCount: memberErr ? null : (memberRows ?? []).length,
        createdCompaniesCount: createdErr ? null : (createdRows ?? []).length,
        memberErr: memberErr ? memberErr.message : null,
        createdErr: createdErr ? createdErr.message : null,
      };
    }
    return json({ ok: true, source: "legacy", readOnly: false, rows: [], ...(diagLegacy ? { diag: diagLegacy } : {}) }, { status: 200 });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
