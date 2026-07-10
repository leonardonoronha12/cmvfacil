import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "../../../../lib/requestUserId";
import { getSupabaseAdmin } from "../../../../lib/supabaseAdmin";
import { isLocalDevRequest } from "../../../../lib/localDevRequest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
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

function normalizeText(v: unknown) {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

function looksLikeBubbleId(v: unknown) {
  return /\d{8,}x\d{6,}/.test(String(v ?? "").trim());
}

function extractBubbleId(v: unknown) {
  const m = String(v ?? "").match(/\d{8,}x\d{6,}/);
  return m ? String(m[0]).trim() : "";
}

function splitCsvList(v: unknown) {
  const s = normalizeText(v);
  if (!s) return [];
  return s
    .split(",")
    .map((x) => normalizeText(x))
    .filter(Boolean);
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
    const companyId = String(body?.companyId ?? "").trim();
    if (!email) return json({ ok: false, error: "invalid_email" }, { status: 400 });
    if (!companyId) return json({ ok: false, error: "missing_company_id" }, { status: 400 });

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    const requesterId = String(userId ?? "").trim();
    const requesterEmail = await getUserEmailFromDb(supabase, requesterId);
    const selfOk = isUuid(requesterId) && requesterEmail === email;
    const adminOk = isLocalDev ? true : await isAdminRequester(supabase, requesterId);
    if (!selfOk && !adminOk) return json({ ok: false, error: "forbidden" }, { status: 403 });

    const { data: items, error: itemsErr } = await supabase.from("items").select("id,raw").eq("company_id", companyId);
    if (itemsErr) return json({ ok: false, error: itemsErr.message }, { status: 500 });

    const recipeIdByIngredientBubbleId = new Map<string, string>();
    const allowedIngredientBubbleIds = new Set<string>();
    for (const it of (items ?? []) as any[]) {
      const recipeId = String(it?.id ?? "").trim();
      if (!recipeId) continue;
      const bubble = (it?.raw ?? {}).bubble ?? {};
      const listRaw = bubble?.lista_ingredientes_custom_itens ?? bubble?.lista_ingredientes_custom_item ?? bubble?.lista_ingredientes ?? "";
      for (const token of splitCsvList(listRaw)) {
        if (!looksLikeBubbleId(token)) continue;
        const bid = extractBubbleId(token);
        if (!bid) continue;
        recipeIdByIngredientBubbleId.set(bid, recipeId);
        allowedIngredientBubbleIds.add(bid);
      }
    }

    const { data: ingRows, error: ingErr } = await supabase.from("recipe_ingredients").select("id,bubble_id,recipe_item_id").eq("company_id", companyId);
    if (ingErr) return json({ ok: false, error: ingErr.message }, { status: 500 });

    let updated = 0;
    let deleted = 0;
    let skipped = 0;
    const results: any[] = [];
    for (const row of (ingRows ?? []) as any[]) {
      const id = String(row?.id ?? "").trim();
      const bubbleId = String(row?.bubble_id ?? "").trim();
      const currentRecipeId = String(row?.recipe_item_id ?? "").trim();
      if (id && bubbleId && allowedIngredientBubbleIds.size && !allowedIngredientBubbleIds.has(bubbleId)) {
        const { error } = await supabase.from("recipe_ingredients").delete().eq("id", id);
        if (error) results.push({ bubble_id: bubbleId, status: "delete_error", error: error.message });
        else {
          deleted += 1;
          results.push({ bubble_id: bubbleId, status: "deleted" });
        }
        continue;
      }
      const expectedRecipeId = bubbleId ? recipeIdByIngredientBubbleId.get(bubbleId) ?? "" : "";
      if (!id || !bubbleId || !expectedRecipeId || expectedRecipeId === currentRecipeId) {
        skipped += 1;
        continue;
      }
      const { error } = await supabase.from("recipe_ingredients").update({ recipe_item_id: expectedRecipeId }).eq("id", id);
      if (error) {
        results.push({ bubble_id: bubbleId, status: "error", error: error.message });
        continue;
      }
      updated += 1;
      results.push({ bubble_id: bubbleId, status: "updated", from: currentRecipeId, to: expectedRecipeId });
    }

    return json(
      {
        ok: true,
        companyId,
        email,
        summary: { mapped: recipeIdByIngredientBubbleId.size, updated, deleted, skipped, total: (ingRows ?? []).length },
        results,
      },
      { status: 200 },
    );
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
