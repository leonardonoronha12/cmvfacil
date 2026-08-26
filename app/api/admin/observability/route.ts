import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { requireSystemAdmin } from "../../../lib/systemAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function allUsers(db: ReturnType<typeof getSupabaseAdmin>) {
  const result: Array<{ id: string; email: string; createdAt: string | null; lastSignInAt: string | null }> = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const u of data.users) result.push({ id: u.id, email: u.email ?? "", createdAt: u.created_at ?? null, lastSignInAt: u.last_sign_in_at ?? null });
    if (data.users.length < 1000) break;
  }
  return result;
}
const tally = (rows: any[], key: string, limit = 10) => Object.entries(rows.reduce<Record<string, number>>((a, r) => { const v = String(r[key] ?? "Não informado"); a[v] = (a[v] ?? 0) + 1; return a; }, {})).sort((a,b) => b[1]-a[1]).slice(0, limit).map(([name,value]) => ({ name, value }));

export async function GET(req: NextRequest) {
  try {
    const auth = await requireSystemAdmin(req);
    if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    const days = Math.max(1, Math.min(90, Number(req.nextUrl.searchParams.get("days") ?? 7)));
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const db = getSupabaseAdmin();
    const [users, sessionsRes, eventsRes, companiesRes, membersRes] = await Promise.all([
      allUsers(db), db.from("app_sessions").select("*").gte("last_seen_at", since).order("last_seen_at", { ascending: false }).limit(10000),
      db.from("app_events").select("*").gte("created_at", since).order("created_at", { ascending: false }).limit(20000),
      db.from("companies").select("id,fantasy_name,subscription_plan,subscription_status,current_period_end,created_at"),
      db.from("company_members").select("user_id,company_id"),
    ]);
    if (sessionsRes.error || eventsRes.error) return NextResponse.json({ ok: false, error: "observability_schema_missing", detail: sessionsRes.error?.message ?? eventsRes.error?.message }, { status: 503 });
    const sessions = sessionsRes.data ?? []; const events = eventsRes.data ?? []; const companies = companiesRes.data ?? []; const members = membersRes.data ?? [];
    const companyMap = new Map(companies.map((c:any) => [c.id, c])); const memberMap = new Map(members.map((m:any) => [m.user_id, m.company_id]));
    const now = Date.now(); const errors = events.filter((e:any) => e.category === "error");
    const userRows = users.map(u => {
      const own = sessions.filter((s:any) => s.user_id === u.id); const company:any = companyMap.get(memberMap.get(u.id));
      return { ...u, company: company?.fantasy_name ?? "Sem empresa", plan: company?.subscription_plan ?? "—", status: company?.subscription_status ?? "—", sessions: own.length, pageViews: own.reduce((n:number,s:any)=>n+Number(s.page_views||0),0), errors: own.reduce((n:number,s:any)=>n+Number(s.errors_count||0),0), lastSeenAt: own[0]?.last_seen_at ?? u.lastSignInAt, currentRoute: own[0]?.current_route ?? "—", location: [own[0]?.city,own[0]?.region,own[0]?.country].filter(Boolean).join(", ") || "—", device: [own[0]?.device_type,own[0]?.browser,own[0]?.os].filter(Boolean).join(" · ") || "—" };
    }).sort((a,b)=>String(b.lastSeenAt??"").localeCompare(String(a.lastSeenAt??"")));
    const daily = Array.from({ length: days }, (_, i) => { const d = new Date(Date.now()-(days-1-i)*86400000).toISOString().slice(0,10); const e = events.filter((x:any)=>String(x.created_at).slice(0,10)===d); return { date:d, events:e.length, errors:e.filter((x:any)=>x.category==="error").length, users:new Set(e.map((x:any)=>x.user_id)).size }; });
    const avgLoad = events.filter((e:any)=>e.category==="performance" && e.duration_ms!=null).map((e:any)=>Number(e.duration_ms));
    return NextResponse.json({ ok:true, generatedAt:new Date().toISOString(), days,
      metrics:{ totalUsers:users.length, activeNow:sessions.filter((s:any)=>now-new Date(s.last_seen_at).getTime()<300000).length, activeUsers:new Set(sessions.map((s:any)=>s.user_id)).size, companies:companies.length, sessions:sessions.length, pageViews:sessions.reduce((n:number,s:any)=>n+Number(s.page_views||0),0), actions:events.filter((e:any)=>e.category==="action").length, errors:errors.length, errorRate:events.length?errors.length/events.length*100:0, avgLoadMs:avgLoad.length?avgLoad.reduce((a,b)=>a+b,0)/avgLoad.length:0 },
      daily, users:userRows, topRoutes:tally(events.filter((e:any)=>e.category==="navigation"),"route"), topActions:tally(events.filter((e:any)=>e.category==="action"),"event_name"), topErrors:tally(errors,"error_code"), devices:tally(sessions,"device_type"), browsers:tally(sessions,"browser"), locations:tally(sessions,"country"), recent:events.slice(0,100).map((e:any)=>({ id:e.id,at:e.created_at,userId:e.user_id,category:e.category,name:e.event_name,route:e.route,success:e.success,errorCode:e.error_code,durationMs:e.duration_ms }))
    }, { headers:{"cache-control":"no-store"} });
  } catch (error) { return NextResponse.json({ ok:false,error:error instanceof Error?error.message:String(error) },{status:500}); }
}
