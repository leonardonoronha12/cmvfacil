import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../lib/requestUserId";
import { formatMoneyBRL, parsePtNumber } from "../../lib/bubbleCsv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function dbg(hypothesisId: string, location: string, msg: string, data: unknown) {
  // #region debug-point B:csv-only-audit
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
  if (!userId) return { accessToken, id: null as string | null, rawUserId: null as string | null };
  if (isUuid(userId)) return { accessToken, id: `user:${userId}`, rawUserId: userId };
  const url = new URL(req.url);
  const override = String(url.searchParams.get("userId") ?? "").trim();
  if (override && isUuid(override) && isAdminUserId(userId)) return { accessToken, id: `user:${override}`, rawUserId: userId };
  return { accessToken, id: null as string | null, rawUserId: userId };
}

async function shouldUseCompatSource(args: { req: NextRequest; supabase: ReturnType<typeof getSupabaseServerClient>; userId: string; isAdmin: boolean }) {
  return false;
}

function formatDateLabelPT(d: Date) {
  const day = String(d.getDate()).padStart(2, "0");
  const year = d.getFullYear();
  const month = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"][d.getMonth()];
  return `${day} ${month}, ${year}`;
}

function formatDateLabelPTFromValue(value: unknown) {
  const s = String(value ?? "").trim();
  if (!s) return "-";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const year = m[1] as string;
    const monthIndex = Math.max(0, Math.min(11, Number(m[2]) - 1));
    const day = m[3] as string;
    const month = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"][monthIndex];
    return `${day} ${month}, ${year}`;
  }
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return "-";
  return formatDateLabelPT(d);
}

export async function GET(req: NextRequest) {
  try {
    const { accessToken, id, rawUserId } = resolveUserScopedId(req);
    if (!id) return json({ source: "legacy", readOnly: false, rows: [] }, { status: 200 });
    const supabase = getSupabaseServerClient(accessToken);
    const userId = id.slice("user:".length);

    const isAdmin = Boolean(rawUserId && isAdminUserId(rawUserId));
    const shouldUseCompat = await shouldUseCompatSource({ req, supabase, userId, isAdmin });
    await dbg("B", "api/entradas", "source_selected", {
      shouldUseCompat,
      rawUserId: rawUserId ? String(rawUserId) : null,
      userId,
      flags: { BUBBLE_COMPAT_READ_ENTRADAS: process.env.BUBBLE_COMPAT_READ_ENTRADAS ?? null },
    });

    if (shouldUseCompat) {
      const { data: memberRows, error: memberErr } = await supabase
        .from("company_members")
        .select("company_id,role,permission_level")
        .eq("user_id", userId)
        .limit(50);
      if (memberErr) return json({ error: memberErr.message }, { status: 500 });
      const companyId = pickBestCompanyId((memberRows ?? []) as any[]);
      if (!companyId) {
        const prefix = `${id}:`;
        const { data, error } = await supabase.from("entradas").select("*").like("id", `${prefix}%`).order("created_at", { ascending: false });
        if (error) return json({ error: error.message }, { status: 500 });
        return json({ source: "legacy", readOnly: false, rows: data ?? [] }, { status: 200 });
      }

      const { data: invoicesDb, error: invErr } = await supabase
        .from("invoices")
        .select("id,bubble_id,external_key,codigo,responsavel_user_id,data_criacao,data_recebimento,raw,fornecedor:suppliers(id,bubble_id,external_key,nome)")
        .eq("company_id", companyId)
        .order("data_recebimento", { ascending: false })
        .order("created_at", { ascending: false });
      if (invErr) return json({ error: invErr.message }, { status: 500 });
      await dbg("B", "api/entradas", "compat_invoices_loaded", {
        companyId,
        totalInvoicesDb: (invoicesDb ?? []).length,
        sample: (invoicesDb ?? []).slice(0, 10).map((inv: any) => ({
          id: String(inv?.id ?? ""),
          bubble_id: String(inv?.bubble_id ?? ""),
          external_key: String(inv?.external_key ?? ""),
          fornecedor: String(inv?.fornecedor?.nome ?? ""),
          fornecedor_external_key: String(inv?.fornecedor?.external_key ?? ""),
        })),
      });
      const visibleInvoicesDb = (invoicesDb ?? []).filter((inv: any) => {
        const bubbleId = String(inv?.bubble_id ?? "").trim();
        if (bubbleId) return true;
        const ext = String(inv?.external_key ?? "").trim().toLowerCase();
        const sys = (inv?.raw as any)?.system ?? null;
        const fornecedorNome = normalizeNameKey(inv?.fornecedor?.nome ?? "");
        const fornecedorExt = String(inv?.fornecedor?.external_key ?? "").trim().toLowerCase();
        const isDefaultSupplier = fornecedorExt === "supplier:default:sem_fornecedor" || fornecedorNome === "sem fornecedor";
        const isSynthetic = Boolean(sys?.synthetic) || ext.endsWith(":manual") || ext.includes(":manual:") || isDefaultSupplier;
        return !isSynthetic;
      });
      await dbg("B", "api/entradas", "compat_invoices_filtered", {
        totalInvoicesDb: (invoicesDb ?? []).length,
        visibleInvoices: visibleInvoicesDb.length,
        filteredOut: (invoicesDb ?? []).length - visibleInvoicesDb.length,
        filteredSamples: (invoicesDb ?? [])
          .filter((inv: any) => {
            const bubbleId = String(inv?.bubble_id ?? "").trim();
            if (bubbleId) return false;
            const ext = String(inv?.external_key ?? "").trim().toLowerCase();
            const sys = (inv?.raw as any)?.system ?? null;
            const fornecedorNome = normalizeNameKey(inv?.fornecedor?.nome ?? "");
            const fornecedorExt = String(inv?.fornecedor?.external_key ?? "").trim().toLowerCase();
            const isDefaultSupplier = fornecedorExt === "supplier:default:sem_fornecedor" || fornecedorNome === "sem fornecedor";
            const isSynthetic = Boolean(sys?.synthetic) || ext.endsWith(":manual") || ext.includes(":manual:") || isDefaultSupplier;
            return isSynthetic;
          })
          .slice(0, 10)
          .map((inv: any) => ({
            id: String(inv?.id ?? ""),
            bubble_id: String(inv?.bubble_id ?? ""),
            external_key: String(inv?.external_key ?? ""),
            sys: (inv?.raw as any)?.system ?? null,
            fornecedor: String(inv?.fornecedor?.nome ?? ""),
            fornecedor_external_key: String(inv?.fornecedor?.external_key ?? ""),
          })),
      });

      if (!visibleInvoicesDb.length) {
        const prefix = `${id}:`;
        const { data, error } = await supabase.from("entradas").select("*").like("id", `${prefix}%`).order("created_at", { ascending: false });
        if (error) return json({ error: error.message }, { status: 500 });
        return json({ source: "legacy", readOnly: false, rows: data ?? [] }, { status: 200 });
      }

      const invoiceIds = visibleInvoicesDb.map((r: any) => String(r?.id ?? "").trim()).filter(Boolean);
      const { data: itemsDb, error: itemsErr } = invoiceIds.length
        ? await supabase
            .from("invoice_items")
            .select("id,bubble_id,invoice_id,item_id,quantidade,custo_unitario,subtotal,ocultar_cmv,raw,item:items(id,bubble_id,name,unidade_medida)")
            .eq("company_id", companyId)
            .in("invoice_id", invoiceIds)
            .order("created_at", { ascending: true })
        : { data: [], error: null as any };
      if (itemsErr) return json({ error: itemsErr.message }, { status: 500 });
      await dbg("B", "api/entradas", "compat_invoice_items_loaded", {
        invoiceIds: invoiceIds.length,
        totalInvoiceItemsDb: (itemsDb ?? []).length,
        itemsPerInvoice: invoiceIds.slice(0, 10).map((invId: string) => ({
          invoice_id: invId,
          count: (itemsDb ?? []).filter((it: any) => String(it?.invoice_id ?? "").trim() === invId).length,
        })),
      });

      const byInvoiceId = new Map<string, any[]>();
      for (const it of (itemsDb ?? []) as any[]) {
        const invId = String(it?.invoice_id ?? "").trim();
        if (!invId) continue;
        const arr = byInvoiceId.get(invId) ?? [];
        arr.push(it);
        byInvoiceId.set(invId, arr);
      }

      const rows = visibleInvoicesDb
        .map((inv: any) => {
          const invDbId = String(inv?.id ?? "").trim();
          const bubbleId = String(inv?.bubble_id ?? "").trim();
          const idOut = bubbleId || (invDbId ? `db:${invDbId}` : "");
          if (!idOut) return null;

          const supplierName = String(inv?.fornecedor?.nome ?? "").trim() || "-";
          const codigo = String(inv?.codigo ?? "").trim() || "-";
          const dataLancamento = formatDateLabelPTFromValue(inv?.data_recebimento);
          const dataCriacao = formatDateLabelPTFromValue(inv?.data_criacao);
          const responsavel = String(
            inv?.responsavel_user_id ??
              (inv?.raw as any)?.responsavel_id ??
              (inv?.raw as any)?.bubble?.responsavel_id ??
              (inv?.raw as any)?.bubble?.responsavel_id_custom_notas_fiscais ??
              (inv?.raw as any)?.bubble?.creator ??
              "",
          ).trim();

          const itensNota = (byInvoiceId.get(invDbId) ?? []).map((it: any) => {
            const itDbId = String(it?.id ?? "").trim();
            const itBubbleId = String(it?.bubble_id ?? "").trim();
            const itemKey = itBubbleId || (itDbId ? `db:${itDbId}` : String(Date.now()));
            const itemName = String(it?.item?.name ?? "").trim() || "-";
            const unit = String(it?.item?.unidade_medida ?? (it?.raw as any)?.unidade_medida ?? (it?.raw as any)?.unidade ?? "").trim() || "Und";
            const qtyNum = typeof it?.quantidade === "number" ? it.quantidade : Number(it?.quantidade);
            const qty = Number.isFinite(qtyNum) ? qtyNum : parsePtNumber(String(it?.quantidade ?? ""));
            const qtyLabel = Number.isFinite(qty) ? qty.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 }) : "0,000";
            const subtotalNum = typeof it?.subtotal === "number" ? it.subtotal : Number(it?.subtotal);
            const subtotal = Number.isFinite(subtotalNum) ? subtotalNum : parsePtNumber(String(it?.subtotal ?? ""));
            const custoUnitNum = typeof it?.custo_unitario === "number" ? it.custo_unitario : Number(it?.custo_unitario);
            const custoUnitario = Number.isFinite(custoUnitNum) ? custoUnitNum : parsePtNumber(String(it?.custo_unitario ?? ""));
            const custoUnitarioLabel = custoUnitario ? formatMoneyBRL(custoUnitario) : "R$0,00";
            const subtotalLabel = subtotal ? formatMoneyBRL(subtotal) : "R$0,00";
            const itemId = String(it?.item?.bubble_id ?? "").trim();
            const ocultarCmv = Boolean(it?.ocultar_cmv);
            return {
              id: itemKey,
              itemId: itemId || undefined,
              nome: itemName,
              unidade: unit,
              quantidadeLabel: `${qtyLabel} ${unit}`,
              custoUnitarioLabel,
              subtotalLabel,
              ocultarCmv,
            };
          });

          const subtotalSum = itensNota.reduce((acc: number, it: any) => acc + parsePtNumber(String(it?.subtotalLabel ?? "")), 0);
          const rawValorNota =
            (inv?.raw as any)?.valor_nota ??
            (inv?.raw as any)?.valorNota ??
            (inv?.raw as any)?.bubble?.valor_nota ??
            (inv?.raw as any)?.bubble?.valorNota ??
            (inv?.raw as any)?.bubble?.valor_nota_custom_notas_fiscais ??
            (inv?.raw as any)?.bubble?.valorNota_custom_notas_fiscais;
          const rawValorNum = parsePtNumber(String(rawValorNota ?? ""));
          const valorNum = rawValorNum > 0 ? rawValorNum : subtotalSum;
          const valorNota = valorNum > 0 ? formatMoneyBRL(valorNum) : "R$0,00";
          const itensLabel = `${itensNota.length} ${itensNota.length === 1 ? "Item" : "Itens"}`;

          return {
            id: idOut,
            numero: codigo,
            data_lancamento: dataLancamento,
            fornecedor: supplierName,
            valor_nota: valorNota,
            itens: itensLabel,
            responsavel,
            data_criacao: dataCriacao,
            itens_nota: itensNota.map((it: any) => ({
              id: String(it.id),
              itemId: it.itemId ?? null,
              nome: it.nome,
              quantidadeLabel: it.quantidadeLabel,
              subtotalLabel: it.subtotalLabel,
              custoUnitarioLabel: it.custoUnitarioLabel,
              unidade: it.unidade,
              ocultarCmv: it.ocultarCmv,
            })),
          };
        })
        .filter(Boolean);

      await dbg("B", "api/entradas", "compat_response_ready", {
        rows: rows.length,
        rowsWithZeroItems: rows.filter((r: any) => (r?.itens_nota ?? []).length === 0).map((r: any) => ({ id: r.id, fornecedor: r.fornecedor, numero: r.numero })),
        sampleTotals: rows.slice(0, 5).map((r: any) => ({ id: r.id, fornecedor: r.fornecedor, valor_nota: r.valor_nota, itens: r.itens })),
      });
      return json({ source: "compat", readOnly: true, rows }, { status: 200 });
    }

    const prefix = `${id}:`;
    const { data, error } = await supabase.from("entradas").select("*").like("id", `${prefix}%`).order("created_at", { ascending: false });
    if (error) return json({ error: error.message }, { status: 500 });
    return json({ source: "legacy", readOnly: false, rows: data ?? [] }, { status: 200 });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as unknown;
    if (!body || typeof body !== "object") return json({ error: "invalid_body" }, { status: 400 });
    const { accessToken, id } = resolveUserScopedId(req);
    const prefix = id ? `${id}:` : "";
    if (!prefix) return json({ error: "unauthorized" }, { status: 401 });
    const entradaId = String((body as any).id ?? "").trim();
    if (!entradaId || !entradaId.startsWith(prefix)) return json({ error: "invalid_id_scope" }, { status: 400 });
    const supabase = getSupabaseServerClient(accessToken);
    const { error } = await supabase.from("entradas").upsert(body as any, { onConflict: "id" });
    if (error) return json({ error: error.message }, { status: 500 });
    return json({ ok: true }, { status: 200 });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const { accessToken, id: userScopedId } = resolveUserScopedId(req);
    const prefix = userScopedId ? `${userScopedId}:` : "";
    if (!prefix) return json({ error: "unauthorized" }, { status: 401 });
    const supabase = getSupabaseServerClient(accessToken);

    const qId = String(url.searchParams.get("id") ?? "").trim();
    const body = (await req.json().catch(() => null)) as any;
    const idsRaw = Array.isArray(body?.ids) ? (body.ids as unknown[]) : body?.id ? [body.id] : qId ? [qId] : [];
    const ids = idsRaw.map((x) => String(x ?? "").trim()).filter(Boolean);
    if (!ids.length) return json({ error: "missing_id" }, { status: 400 });

    const invalidIds = ids.filter((id) => !id.startsWith(prefix));
    if (invalidIds.length) return json({ error: "invalid_id_scope", invalidIds }, { status: 400 });

    const deletedIds: string[] = [];
    const chunkSize = 200;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const { data, error } = await supabase.from("entradas").delete().in("id", chunk).select("id");
      if (error) return json({ error: error.message }, { status: 500 });
      for (const r of data ?? []) {
        const did = String((r as any)?.id ?? "").trim();
        if (did) deletedIds.push(did);
      }
    }

    return json({ ok: true, deletedCount: deletedIds.length, deletedIds }, { status: 200 });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
