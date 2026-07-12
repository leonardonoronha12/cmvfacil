import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../lib/requestUserId";

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

async function shouldUseCompatSource(args: { req: NextRequest; supabase: ReturnType<typeof getSupabaseServerClient>; userId: string; isAdmin: boolean }) {
  const url = new URL(args.req.url);
  const override = String(url.searchParams.get("source") ?? "").trim().toLowerCase();
  if (args.isAdmin) {
    if (override === "compat") return true;
    if (override === "legacy") return false;
  }

  const enabled = String(process.env.BUBBLE_COMPAT_READ_INSUMOS ?? process.env.BUBBLE_COMPAT_READ_INSOMOS ?? "")
    .trim()
    .toLowerCase();
  if (!(enabled === "1" || enabled === "true" || enabled === "yes" || enabled === "on")) return false;

  const allowUsers = new Set(
    parseCsvEnv(process.env.BUBBLE_COMPAT_READ_INSUMOS_USER_IDS ?? process.env.BUBBLE_COMPAT_READ_INSOMOS_USER_IDS).map((x) => x.toLowerCase()),
  );
  const allowEmails = new Set(
    parseCsvEnv(process.env.BUBBLE_COMPAT_READ_INSUMOS_EMAILS ?? process.env.BUBBLE_COMPAT_READ_INSOMOS_EMAILS).map((x) => x.toLowerCase()),
  );
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
      const { data: memberRows, error: memberErr } = await supabase
        .from("company_members")
        .select("company_id,role,permission_level")
        .eq("user_id", userId)
        .limit(50);
      if (memberErr) return json({ error: memberErr.message }, { status: 500 });
      const companyId = pickBestCompanyId((memberRows ?? []) as any[]);
      if (!companyId) return json({ error: "missing_company" }, { status: 500 });

      const { data: categoriesDb, error: catErr } = await supabase.from("categories").select("id,name").eq("company_id", companyId);
      if (catErr) return json({ error: catErr.message }, { status: 500 });
      const categoryNameById = new Map<string, string>();
      for (const c of categoriesDb ?? []) {
        const cid = String((c as any)?.id ?? "").trim();
        const name = String((c as any)?.name ?? "").trim();
        if (cid) categoryNameById.set(cid, name);
      }

      const { data: itemsDb, error: itemsErr } = await supabase
        .from("items")
        .select("id,bubble_id,name,unidade_medida,custo_medio,descricao,ocultar_cmv,category_id,item_receita,item_do_cardapio")
        .eq("company_id", companyId)
        .eq("item_receita", false)
        .order("name", { ascending: true });
      if (itemsErr) return json({ error: itemsErr.message }, { status: 500 });

      await dbg("A", "api/insumos", "compat_items_loaded", {
        companyId,
        totalItemsDb: (itemsDb ?? []).length,
        sampleNames: (itemsDb ?? []).slice(0, 20).map((r: any) => String(r?.name ?? "").trim()),
        flagsTrueCounts: {
          item_receita_true: (itemsDb ?? []).filter((r: any) => Boolean(r?.item_receita)).length,
          item_do_cardapio_true: (itemsDb ?? []).filter((r: any) => Boolean(r?.item_do_cardapio)).length,
        },
        containsCarreteiro: (itemsDb ?? []).some((r: any) => String(r?.name ?? "").trim().toLowerCase() === "carreteiro"),
      });

      const rows = (itemsDb ?? [])
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

      const categories = Array.from(new Set(rows.map((r: any) => String(r?.categoria ?? "").trim()).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b, "pt-BR", { sensitivity: "base", numeric: true }),
      );
      await dbg("A", "api/insumos", "compat_response_ready", {
        rows: rows.length,
        categories: categories.length,
        containsCarreteiro: rows.some((r: any) => String(r?.item ?? "").trim().toLowerCase() === "carreteiro"),
      });
      return json({ source: "compat", readOnly: false, rows, categories }, { status: 200 });
    }

    const { data, error } = await supabase.from("insumos_state").select("*").eq("id", id).maybeSingle();
    if (!error) {
      const payload = (data as any)?.payload;
      const rows = Array.isArray(payload?.rows) ? (payload.rows as unknown[]) : [];
      const categories = Array.isArray(payload?.categories) ? (payload.categories as unknown[]) : [];
      await dbg("A", "api/insumos", "legacy_state_response_ready", { rows: rows.length, categories: categories.length });
      return json({ source: "legacy", readOnly: false, rows, categories }, { status: 200 });
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
    return json({ source: "legacy", readOnly: false, rows, categories }, { status: 200 });
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
      const { data: memberRows, error: memberErr } = await supabase
        .from("company_members")
        .select("company_id,role,permission_level")
        .eq("user_id", userId)
        .limit(50);
      if (memberErr) return json({ error: memberErr.message }, { status: 500 });
      const companyId = pickBestCompanyId((memberRows ?? []) as any[]);
      if (!companyId) return json({ error: "missing_company" }, { status: 500 });

      const { data: categoriesDb, error: catErr } = await supabase.from("categories").select("id,name").eq("company_id", companyId);
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
      for (const name0 of categoryNames) {
        const key = normalizeNameKey(name0);
        if (!key || categoryIdByKey.has(key)) continue;
        toCreate.push({ company_id: companyId, name: name0 });
      }
      if (toCreate.length) {
        const { data: created, error: createErr } = await supabase.from("categories").insert(toCreate as any).select("id,name");
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
            .filter((x) => x.startsWith("db:"))
            .map((x) => x.slice("db:".length))
            .filter((x) => isUuid(x)),
        ),
      );

      const existingIdByBubbleId = new Map<string, string>();
      if (bubbleIds.length) {
        const { data, error } = await supabase.from("items").select("id,bubble_id").eq("company_id", companyId).in("bubble_id", bubbleIds);
        if (error) return json({ error: error.message }, { status: 500 });
        for (const it of data ?? []) {
          const id0 = String((it as any)?.id ?? "").trim();
          const bid = String((it as any)?.bubble_id ?? "").trim();
          if (id0 && bid) existingIdByBubbleId.set(bid, id0);
        }
      }

      const existingIdById = new Map<string, string>();
      if (dbIds.length) {
        const { data, error } = await supabase.from("items").select("id").eq("company_id", companyId).in("id", dbIds);
        if (error) return json({ error: error.message }, { status: 500 });
        for (const it of data ?? []) {
          const id0 = String((it as any)?.id ?? "").trim();
          if (id0) existingIdById.set(id0, id0);
        }
      }

      const upsertByBubble: any[] = [];
      const upsertById: any[] = [];
      const keepIds = new Set<string>();

      for (const r of rows as any[]) {
        const rawId = String(r?.id ?? "").trim();
        const name = String(r?.item ?? "").trim();
        if (!name) continue;

        const categoria = String(r?.categoria ?? "").trim();
        const categoriaKey = categoria && categoria !== "-" ? normalizeNameKey(categoria) : "";
        const categoryId = categoriaKey ? categoryIdByKey.get(categoriaKey) ?? null : null;

        const bubbleId = looksLikeBubbleId(rawId) ? rawId : null;
        const dbId = rawId.startsWith("db:") ? rawId.slice("db:".length) : "";
        const existingId = bubbleId ? existingIdByBubbleId.get(bubbleId) ?? "" : dbId && existingIdById.has(dbId) ? dbId : "";

        const patch = {
          company_id: companyId,
          id: existingId || crypto.randomUUID(),
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
        keepIds.add(String((patch as any).id ?? "").trim());
        if (bubbleId) upsertByBubble.push(patch);
        else upsertById.push(patch);
      }

      if (upsertByBubble.length) {
        const { error } = await supabase.from("items").upsert(upsertByBubble as any, { onConflict: "company_id,bubble_id" });
        if (error) return json({ error: error.message }, { status: 500 });
      }
      if (upsertById.length) {
        const { error } = await supabase.from("items").upsert(upsertById as any, { onConflict: "id" });
        if (error) return json({ error: error.message }, { status: 500 });
      }

      const { data: existingInsumos, error: listErr } = await supabase
        .from("items")
        .select("id")
        .eq("company_id", companyId)
        .eq("item_receita", false)
        .eq("item_do_cardapio", false)
        .limit(5000);
      if (listErr) return json({ error: listErr.message }, { status: 500 });

      const toDelete = (existingInsumos ?? [])
        .map((x: any) => String(x?.id ?? "").trim())
        .filter((x: string) => x && !keepIds.has(x));
      if (toDelete.length) {
        const { error: delErr } = await supabase.from("items").delete().in("id", toDelete);
        if (delErr) return json({ error: delErr.message }, { status: 500 });
      }

      return json({ ok: true }, { status: 200 });
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
    if (!error) return json({ ok: true }, { status: 200 });
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
    return json({ ok: true }, { status: 200 });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
