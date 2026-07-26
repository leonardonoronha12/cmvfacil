import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "../../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../../lib/requestUserId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return NextResponse.json(data, { ...init, headers });
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

export async function GET(req: NextRequest) {
  const traceId = crypto.randomUUID();
  try {
    const { accessToken, userId } = getUserIdFromRequest(req);
    if (!userId || !accessToken) return json({ ok: false, traceId, error: "unauthorized" }, { status: 401 });

    const url = new URL(req.url);
    const diag = String(url.searchParams.get("diag") ?? "").trim() === "1";
    const seed = String(url.searchParams.get("seed") ?? "").trim() === "1";
    const sessionIdFilter = String(url.searchParams.get("sessionId") ?? "").trim();
    const sinceTsRaw = Number(url.searchParams.get("sinceTs") ?? "");
    const sinceTs = Number.isFinite(sinceTsRaw) ? Math.max(0, Math.floor(sinceTsRaw)) : 0;
    const limitRaw = Number(url.searchParams.get("limit") ?? "200");
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(400, Math.floor(limitRaw))) : 200;

    const supabase = getSupabaseServerClient(accessToken);
    const { data: memberRows, error: memberErr } = await supabase
      .from("company_members")
      .select("company_id,role,permission_level")
      .eq("user_id", userId)
      .limit(50);
    if (memberErr) return json({ ok: false, traceId, error: memberErr.message }, { status: 500 });
    const companyId = pickBestCompanyId((memberRows ?? []) as any[]);
    if (!companyId) return json({ ok: true, traceId, companyId: null, events: [] }, { status: 200 });

    const diagDebugTable: any = diag ? { ok: false, count: null, countError: null, rowsError: null, seedError: null } : null;
    const { count, error: countErr } = await supabase.from("debug_events").select("id", { count: "exact", head: true }).eq("company_id", companyId);
    if (!countErr) {
      if (diagDebugTable) {
        diagDebugTable.ok = true;
        diagDebugTable.count = count ?? 0;
      }
      if (seed) {
        try {
          const { error: seedErr } = await supabase.from("debug_events").insert({
            session_id: "events-me",
            run_id: "seed",
            hypothesis_id: "seed",
            trace_id: null,
            location: "app/api/debug/events-me/route.ts",
            msg: "seed",
            data: { companyId },
            company_id: companyId,
            user_id: userId,
          } as any);
          if (seedErr && diagDebugTable) diagDebugTable.seedError = String(seedErr.message ?? "");
        } catch (err) {
          if (diagDebugTable) diagDebugTable.seedError = err instanceof Error ? err.message : String(err ?? "");
        }
      }
      const { data: rows, error: rowsErr } = await supabase
        .from("debug_events")
        .select("created_at,session_id,run_id,hypothesis_id,trace_id,location,msg,data")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (!rowsErr) {
        const mapped = (rows ?? [])
          .map((r) => ({
            ts: new Date(String((r as any)?.created_at ?? "")).getTime(),
            msg: String((r as any)?.msg ?? ""),
            data: (r as any)?.data ?? {},
            runId: String((r as any)?.run_id ?? ""),
            traceId: (r as any)?.trace_id ?? null,
            location: String((r as any)?.location ?? ""),
            sessionId: String((r as any)?.session_id ?? ""),
            hypothesisId: String((r as any)?.hypothesis_id ?? ""),
          }))
          .reverse();
        let filtered = sessionIdFilter ? mapped.filter((e) => e.sessionId === sessionIdFilter) : mapped;
        if (sinceTs) filtered = filtered.filter((e) => Number(e.ts) >= sinceTs);
        return json(
          {
            ok: true,
            traceId,
            companyId,
            ...(diag
              ? {
                  diag: {
                    hasDefaultSupplier: null,
                    defaultSupplierId: null,
                    eventsCount: count ?? 0,
                    ...(sessionIdFilter || sinceTs ? { sessionIdFilter: sessionIdFilter || null, sinceTs: sinceTs || null, filteredCount: filtered.length } : null),
                    systemKeys: ["debug_events_table"],
                    debugEventsTable: diagDebugTable,
                  },
                }
              : null),
            events: filtered,
          },
          { status: 200 },
        );
      }
      if (diagDebugTable) diagDebugTable.rowsError = String(rowsErr?.message ?? "");
    } else if (diagDebugTable) {
      diagDebugTable.countError = String(countErr.message ?? "");
    }

    const { data: defaultSupplier, error: supplierErr1 } = await supabase
      .from("suppliers")
      .select("id,raw")
      .eq("company_id", companyId)
      .ilike("external_key", "supplier:default:sem_fornecedor")
      .limit(1)
      .maybeSingle();
    if (supplierErr1) return json({ ok: false, traceId, error: supplierErr1.message }, { status: 500 });
    let supplierRow = defaultSupplier as any;
    if (seed) {
      if (!supplierRow) {
        const { data: ins, error: insErr } = await supabase
          .from("suppliers")
          .insert({
            company_id: companyId,
            external_key: "supplier:default:sem_fornecedor",
            nome: "Sem Fornecedor",
            endereco: "",
            vendedor: "",
            whatsapp: "",
            bubble_id: null,
            raw: { system: { default: true } },
          } as any)
          .select("id,raw")
          .limit(1)
          .maybeSingle();
        if (insErr) {
          const msg = String(insErr.message ?? "");
          const m = msg.toLowerCase();
          if (!m.includes("duplicate key") && !m.includes("suppliers_company_external_key_uidx")) {
            return json({ ok: false, traceId, error: `default_supplier_insert_failed: ${msg || "unknown"}` }, { status: 500 });
          }
          const { data: existing, error: reErr } = await supabase
            .from("suppliers")
            .select("id,raw")
            .eq("company_id", companyId)
            .ilike("external_key", "supplier:default:sem_fornecedor")
            .limit(1)
            .maybeSingle();
          if (reErr) return json({ ok: false, traceId, error: reErr.message }, { status: 500 });
          supplierRow = existing as any;
        } else {
          supplierRow = ins as any;
        }
      }
      const supplierId = String((supplierRow as any)?.id ?? "").trim();
      if (!supplierId) return json({ ok: false, traceId, error: "missing_default_supplier" }, { status: 500 });
      const rawBase = (supplierRow as any)?.raw ?? {};
      const systemBase = (rawBase as any)?.system ?? {};
      const prev = Array.isArray((systemBase as any)?.debug_events) ? (systemBase as any).debug_events : [];
      const next = [
        ...prev,
        { sessionId: "events-me", runId: "seed", hypothesisId: "seed", location: "app/api/debug/events-me/route.ts", msg: "seed", data: { companyId }, ts: Date.now() },
      ].slice(-200);
      const nextRaw = { ...(rawBase as any), system: { ...(systemBase as any), debug_events: next } };
      const { error: updErr } = await supabase
        .from("suppliers")
        .update({ raw: nextRaw } as any)
        .eq("company_id", companyId)
        .eq("id", supplierId);
      if (updErr) return json({ ok: false, traceId, error: updErr.message }, { status: 500 });
      supplierRow = { ...(supplierRow as any), raw: nextRaw };
    }

    if (!supplierRow) {
      return json(
        {
          ok: true,
          traceId,
          companyId,
          ...(diag
            ? {
                diag: {
                  hasDefaultSupplier: false,
                  defaultSupplierId: null,
                  eventsCount: 0,
                  systemKeys: [],
                  debugEventsTable: diagDebugTable,
                },
              }
            : null),
          events: [],
        },
        { status: 200 },
      );
    }

    const raw = (supplierRow as any)?.raw ?? {};
    const system = (raw as any)?.system ?? {};
    const events = Array.isArray((system as any)?.debug_events) ? (system as any).debug_events : [];
    let filtered = sessionIdFilter ? events.filter((e: any) => String(e?.sessionId ?? "") === sessionIdFilter) : events;
    if (sinceTs) filtered = filtered.filter((e: any) => Number(e?.ts ?? 0) >= sinceTs);
    const out = filtered.slice(-limit);
    return json(
      {
        ok: true,
        traceId,
        companyId,
        ...(diag
          ? {
              diag: {
                hasDefaultSupplier: Boolean((supplierRow as any)?.id),
                defaultSupplierId: String((supplierRow as any)?.id ?? "").trim() || null,
                eventsCount: events.length,
                ...(sessionIdFilter || sinceTs ? { sessionIdFilter: sessionIdFilter || null, sinceTs: sinceTs || null, filteredCount: filtered.length } : null),
                systemKeys: Object.keys(system ?? {}),
                debugEventsTable: diagDebugTable,
              },
            }
          : null),
        events: out,
      },
      { status: 200 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err ?? "");
    return json({ ok: false, traceId, error: msg || "unknown_error" }, { status: 500 });
  }
}
