import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../lib/requestUserId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) { return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } }); }
function isUuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function asNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

async function context(req: NextRequest) {
  const { userId } = getUserIdFromRequest(req);
  if (!userId || !isUuid(userId)) return null;
  const db = getSupabaseAdmin();
  const requested = String(req.cookies.get("cmv_active_company")?.value ?? "").trim();
  let query = db.from("company_members").select("company_id").eq("user_id", userId);
  if (requested && isUuid(requested)) query = query.eq("company_id", requested);
  const { data } = await query.limit(1).maybeSingle();
  if (!data?.company_id) return null;
  return { db, userId, companyId: String(data.company_id) };
}

export async function GET(req: NextRequest) {
  const ctx = await context(req);
  if (!ctx) return json({ error: "unauthorized" }, 401);
  let [{ data: rows, error }, { data: reasons, error: reasonsError }] = await Promise.all([
    ctx.db.from("internal_consumptions").select("id,item_id,item_name,quantity,unit,unit_cost,total_cost,reason_id,reason_text,occurred_on,notes,created_at").eq("company_id", ctx.companyId).order("occurred_on", { ascending: false }).order("created_at", { ascending: false }).limit(2000),
    ctx.db.from("internal_consumption_reasons").select("id,name,active").eq("company_id", ctx.companyId).eq("active", true).order("name"),
  ]);
  if (error || reasonsError) return json({ error: error?.message || reasonsError?.message }, 500);
  if (!reasons?.length) {
    const defaults = ["Refeição da equipe", "Teste de produto", "Cortesia", "Uso operacional", "Outro"].map((name) => ({ company_id: ctx.companyId, name }));
    const { error: seedError } = await ctx.db.from("internal_consumption_reasons").upsert(defaults, { onConflict: "company_id,name", ignoreDuplicates: true });
    if (seedError) return json({ error: seedError.message }, 500);
    const refreshed = await ctx.db.from("internal_consumption_reasons").select("id,name,active").eq("company_id", ctx.companyId).eq("active", true).order("name");
    if (refreshed.error) return json({ error: refreshed.error.message }, 500);
    reasons = refreshed.data ?? [];
  }
  return json({ rows: rows ?? [], reasons: reasons ?? [] });
}

export async function POST(req: NextRequest) {
  const ctx = await context(req);
  if (!ctx) return json({ error: "unauthorized" }, 401);
  const body = await req.json().catch(() => null) as any;
  const itemName = String(body?.itemName ?? "").trim();
  const unit = String(body?.unit ?? "").trim();
  const reasonText = String(body?.reasonText ?? "").trim();
  const quantity = asNumber(body?.quantity);
  const unitCost = asNumber(body?.unitCost);
  const occurredOn = String(body?.occurredOn ?? "").trim();
  if (!itemName || !unit || !reasonText || quantity <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(occurredOn)) return json({ error: "invalid_fields" }, 400);
  const itemId = isUuid(String(body?.itemId ?? "")) ? String(body.itemId) : null;
  if (itemId) {
    const { data: item } = await ctx.db.from("items").select("id").eq("id", itemId).eq("company_id", ctx.companyId).maybeSingle();
    if (!item) return json({ error: "item_not_found" }, 400);
  }
  const reasonId = isUuid(String(body?.reasonId ?? "")) ? String(body.reasonId) : null;
  const payload = { company_id: ctx.companyId, item_id: itemId, item_name: itemName, quantity, unit, unit_cost: unitCost, total_cost: Math.round(quantity * unitCost * 100) / 100, reason_id: reasonId, reason_text: reasonText, occurred_on: occurredOn, notes: String(body?.notes ?? "").trim() || null, created_by: ctx.userId };
  const { data, error } = await ctx.db.from("internal_consumptions").insert(payload).select("*").single();
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, row: data }, 201);
}

export async function DELETE(req: NextRequest) {
  const ctx = await context(req);
  if (!ctx) return json({ error: "unauthorized" }, 401);
  const id = String(new URL(req.url).searchParams.get("id") ?? "").trim();
  if (!isUuid(id)) return json({ error: "invalid_id" }, 400);
  const { error } = await ctx.db.from("internal_consumptions").delete().eq("id", id).eq("company_id", ctx.companyId);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}
