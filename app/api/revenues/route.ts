import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../lib/requestUserId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const isoDate = (value: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "")) ? String(value) : "";

async function context(req: NextRequest) {
  const { userId } = getUserIdFromRequest(req);
  if (!userId) return null;
  const db = getSupabaseAdmin();
  const requested = String(req.cookies.get("cmv_active_company")?.value ?? "").trim();
  let query = db.from("company_members").select("company_id").eq("user_id", userId);
  if (/^[0-9a-f-]{36}$/i.test(requested)) query = query.eq("company_id", requested);
  const member = await query.limit(1).maybeSingle();
  return member.data?.company_id ? { db, userId, companyId: String(member.data.company_id) } : null;
}

export async function GET(req: NextRequest) {
  const ctx = await context(req);
  if (!ctx) return NextResponse.json({ ok: false, error: "Sessão ou empresa inválida." }, { status: 401 });
  const url = new URL(req.url);
  let startDate = isoDate(url.searchParams.get("startDate")); let endDate = isoDate(url.searchParams.get("endDate"));
  if (!startDate || !endDate) return NextResponse.json({ ok: false, error: "Período inválido." }, { status: 400 });
  if (startDate > endDate) [startDate, endDate] = [endDate, startDate];
  const result = await ctx.db.from("revenues").select("id,data_inicial,data_final,faturamento,created_at").eq("company_id", ctx.companyId).gte("data_inicial", startDate).lte("data_final", endDate).order("created_at", { ascending: false });
  if (result.error) return NextResponse.json({ ok: false, error: result.error.message }, { status: 500 });
  const rows = (result.data ?? []).filter(row => isoDate(row.data_inicial) && isoDate(row.data_final) && Number(row.faturamento) > 0);
  const exact = rows.find(row => row.data_inicial === startDate && row.data_final === endDate);
  if (exact) return NextResponse.json({ ok: true, value: Number(exact.faturamento), periods: 1, exact: true });
  const unique = Array.from(new Map(rows.map(row => [`${row.data_inicial}|${row.data_final}`, row])).values());
  const atomic = unique.filter(row => !unique.some(other => other !== row && other.data_inicial >= row.data_inicial && other.data_final <= row.data_final && (other.data_inicial !== row.data_inicial || other.data_final !== row.data_final)));
  atomic.sort((a, b) => String(a.data_inicial).localeCompare(String(b.data_inicial)) || String(a.data_final).localeCompare(String(b.data_final)));
  const selected: typeof atomic = [];
  for (const row of atomic) if (!selected.some(item => !(row.data_final < item.data_inicial || row.data_inicial > item.data_final))) selected.push(row);
  return NextResponse.json({ ok: true, value: selected.reduce((sum, row) => sum + Number(row.faturamento), 0), periods: selected.length, exact: false });
}

export async function POST(req: NextRequest) {
  const ctx = await context(req);
  if (!ctx) return NextResponse.json({ ok: false, error: "Sessão ou empresa inválida." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  let startDate = isoDate(body.startDate); let endDate = isoDate(body.endDate); const value = Number(body.value);
  if (!startDate || !endDate || !Number.isFinite(value) || value <= 0) return NextResponse.json({ ok: false, error: "Dados de faturamento inválidos." }, { status: 400 });
  if (startDate > endDate) [startDate, endDate] = [endDate, startDate];
  const existing = await ctx.db.from("revenues").select("id").eq("company_id", ctx.companyId).eq("data_inicial", startDate).eq("data_final", endDate).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const payload = { company_id: ctx.companyId, data_inicial: startDate, data_final: endDate, faturamento: value, created_by_user_id: ctx.userId };
  const saved = existing.data?.id ? await ctx.db.from("revenues").update(payload).eq("id", existing.data.id) : await ctx.db.from("revenues").insert(payload);
  if (saved.error) return NextResponse.json({ ok: false, error: saved.error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
