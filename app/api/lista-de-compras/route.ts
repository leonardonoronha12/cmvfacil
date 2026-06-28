import { NextRequest, NextResponse } from "next/server";
import { getBubbleObjCredentials, fetchBubbleObjPageWithConstraints } from "../../lib/bubbleObjApi";
import { parseObjectType } from "../../lib/bubbleObjRealMapping";
import { getUserIdFromRequest } from "../../lib/requestUserId";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return NextResponse.json(data, { ...init, headers });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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
    .replace(/\./g, "")
    .replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

async function findCompanyIdForUser(args: { supabase: ReturnType<typeof getSupabaseAdmin>; userId: string }) {
  const { supabase, userId } = args;
  const { data: mig, error: migErr } = await supabase.from("bubble_obj_user_migration").select("last_run_id").eq("supabase_user_id", userId).maybeSingle();
  if (migErr) throw new Error(migErr.message);
  const runId = String((mig as any)?.last_run_id ?? "").trim();
  if (!runId) return { runId: null as string | null, companyId: null as string | null };
  const { data: runItems, error: runItemsErr } = await supabase
    .from("bubble_obj_import_run_item")
    .select("object_type")
    .eq("supabase_user_id", userId)
    .eq("run_id", runId)
    .order("object_type", { ascending: true });
  if (runItemsErr) throw new Error(runItemsErr.message);
  const objectTypes = (runItems ?? []).map((x) => String((x as any)?.object_type ?? "").trim()).filter(Boolean);
  const companyId =
    objectTypes
      .map((ot) => parseObjectType(ot))
      .map((p) => String(p.companyId ?? "").trim())
      .find(Boolean) || null;
  return { runId, companyId };
}

async function fetchAllBubble<T>(args: {
  creds: Awaited<ReturnType<typeof getBubbleObjCredentials>>;
  type: string;
  constraints: { key: string; constraint_type: string; value: any }[];
  max?: number;
}) {
  const out: T[] = [];
  let cursor = 0;
  const max = typeof args.max === "number" && Number.isFinite(args.max) && args.max > 0 ? Math.min(20_000, Math.floor(args.max)) : 5000;
  while (out.length < max) {
    const page = await fetchBubbleObjPageWithConstraints<T>({
      creds: args.creds,
      type: args.type,
      cursor,
      limit: Math.min(100, max - out.length),
      constraints: args.constraints,
      timeoutMs: 25_000,
    });
    out.push(...page.results);
    if (!page.remaining || page.remaining <= 0) break;
    cursor += page.results.length;
    if (!page.results.length) break;
  }
  return out;
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId || !isUuid(userId)) return json({ ok: false, error: "unauthorized" }, { status: 401 });

    let supabase: ReturnType<typeof getSupabaseAdmin>;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      return json({ ok: false, error: "supabase_not_configured" }, { status: 500 });
    }

    const { runId, companyId } = await findCompanyIdForUser({ supabase, userId });
    if (!companyId) return json({ ok: true, rows: [], meta: { runId, companyId: null } }, { status: 200 });

    const creds = await getBubbleObjCredentials();
    const constraints = [
      { key: "empresa_id", constraint_type: "equals", value: companyId },
    ];
    const rowsRaw = await fetchAllBubble<any>({ creds, type: "itens_lista_compras", constraints, max: 5000 });

    const rows = rowsRaw
      .map((r) => {
        const bubbleListaId = String((r as any)?._id ?? "").trim();
        const bubbleItemId = extractBubbleId((r as any)?.item_id) || String((r as any)?.item_id ?? "").trim();
        const empresaId = extractBubbleId((r as any)?.empresa_id) || String((r as any)?.empresa_id ?? "").trim();
        const itemNome = String((r as any)?.Item_nome ?? (r as any)?.item_nome ?? "").trim();
        const itemMedida = String((r as any)?.item_medida ?? "").trim();
        const qtdSugestao = parseNumber((r as any)?.qtd_sugestao);
        const qtdCompra = parseNumber((r as any)?.qtd_compra);
        const tipo = String((r as any)?.tipo ?? "").trim();
        if (!bubbleListaId) return null;
        return { bubbleListaId, bubbleItemId, empresaId, itemNome, itemMedida, qtdSugestao, qtdCompra, tipo };
      })
      .filter((r) => Boolean(r) && (!String((r as any)?.tipo ?? "").trim() || String((r as any)?.tipo ?? "").trim() === "itens"));

    return json({ ok: true, rows, meta: { runId, companyId, constraints } }, { status: 200 });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
