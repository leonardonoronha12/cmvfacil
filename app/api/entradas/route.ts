import { NextRequest, NextResponse } from "next/server";
import { performance } from "node:perf_hooks";
import { getSupabaseAdmin, getSupabaseServerClient } from "../../lib/supabaseAdmin";
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

function canonicalUuid(value: string) {
  const s = String(value ?? "").trim();
  if (!s) return "";
  return isUuid(s) ? s.toLowerCase() : s;
}

function isDbPrefixed(value: string) {
  return String(value ?? "").trim().toLowerCase().startsWith("db:");
}

function dbIdFromKey(value: string) {
  const s = String(value ?? "").trim();
  if (!isDbPrefixed(s)) return "";
  return s.slice(3).trim();
}

function isBadSupplierLabel(value: string) {
  const s = String(value ?? "").trim();
  if (!s) return true;
  if (s === "-") return true;
  if (isDbPrefixed(s)) return true;
  if (isUuid(s)) return true;
  return false;
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

function normalizeLookupKey(v: unknown) {
  return normalizeText(v)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function safeObj(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  return input as Record<string, unknown>;
}

function safeArr(input: unknown): unknown[] {
  return Array.isArray(input) ? input : [];
}

function pickFirstText(obj: unknown, keys: string[]) {
  const o = safeObj(obj);
  for (const k of keys) {
    const v = normalizeText((o as any)[k]);
    if (v) return v;
  }
  return "";
}

function isGoodSupplierLabel(value: string) {
  const s = normalizeText(value);
  if (isBadSupplierLabel(s)) return false;
  if (s.length > 120) return false;
  return /[A-Za-zÀ-ÿ]/.test(s);
}

function scanSupplierLabelDeep(raw: unknown) {
  const maxDepth = 5;
  const maxItems = 50;
  let seen = 0;
  const skipKey = (k: string) => {
    const key = k.toLowerCase();
    if (key.includes("produto") || key.includes("produtos")) return true;
    if (key.includes("item") || key.includes("itens") || key.includes("items")) return true;
    if (key.includes("equival")) return true;
    if (key.includes("debug")) return true;
    return false;
  };
  const wantsKey = (k: string) => {
    const key = k.toLowerCase();
    return key.includes("nome") || key.includes("fornecedor") || key.includes("supplier") || key.includes("vendor");
  };
  const scan = (node: unknown, depth: number): string => {
    if (seen > maxItems) return "";
    if (depth > maxDepth) return "";
    if (typeof node === "string") {
      seen += 1;
      const s = normalizeText(node);
      return isGoodSupplierLabel(s) ? s : "";
    }
    if (!node || typeof node !== "object") return "";
    if (Array.isArray(node)) {
      return "";
    }
    const obj = node as Record<string, unknown>;
    const keys = Object.keys(obj);
    const preferred = keys.filter((k) => !skipKey(k) && wantsKey(k));
    const rest = keys.filter((k) => !skipKey(k) && !wantsKey(k));
    for (const k of [...preferred, ...rest]) {
      const v = scan(obj[k], depth + 1);
      if (v) return v;
    }
    return "";
  };
  return scan(raw, 0);
}

function extractSupplierLabelFromRaw(raw: unknown) {
  const base = safeObj(raw);
  const bubble = safeObj((base as any).bubble);
  const bubbleNormalized = safeObj((base as any).bubble_normalized);
  const candidates = [bubble, bubbleNormalized, base];
  const keys = ["nome", "fornecedor", "name", "Nome", "Fornecedor", "Nome do fornecedor", "nome_fornecedor", "fornecedor_nome"];
  for (const c of candidates) {
    const v = pickFirstText(c, keys);
    if (isGoodSupplierLabel(v)) return v;
  }
  return scanSupplierLabelDeep(raw);
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

async function resolveCompanyEntryScope(args: {
  supabase: ReturnType<typeof getSupabaseServerClient>;
  userId: string;
}) {
  const { data: ownMemberships, error: ownMembershipError } = await args.supabase
    .from("company_members")
    .select("company_id,role,permission_level")
    .eq("user_id", args.userId)
    .limit(50);
  if (ownMembershipError) throw ownMembershipError;

  const companyId = pickBestCompanyId((ownMemberships ?? []) as any[]);
  if (!companyId) return { companyId: "", userIds: [args.userId], db: args.supabase };

  let db: ReturnType<typeof getSupabaseServerClient> = args.supabase;
  try {
    db = getSupabaseAdmin();
  } catch {}

  const { data: companyMembers, error: companyMembersError } = await db
    .from("company_members")
    .select("user_id")
    .eq("company_id", companyId)
    .limit(5000);
  if (companyMembersError) throw companyMembersError;

  const userIds = Array.from(
    new Set(
      [args.userId, ...(companyMembers ?? []).map((row: any) => String(row?.user_id ?? "").trim())]
        .filter(isUuid)
        .map((value) => value.toLowerCase()),
    ),
  );
  return { companyId, userIds, db };
}

function entryIdAllowedForCompanyScope(entryId: string, scope: { companyId: string; userIds: string[] }) {
  const id = String(entryId ?? "").trim().toLowerCase();
  if (!id) return false;
  if (scope.companyId && id.startsWith(`company:${scope.companyId.toLowerCase()}:`)) return true;
  return scope.userIds.some((userId) => id.startsWith(`user:${userId.toLowerCase()}:`));
}

async function loadCompanyLegacyEntradas(args: {
  supabase: ReturnType<typeof getSupabaseServerClient>;
  userIds: string[];
}) {
  const byId = new Map<string, any>();
  for (const userId of args.userIds) {
    const prefix = `user:${userId}:`;
    const { data, error } = await args.supabase
      .from("entradas")
      .select("*")
      .like("id", `${prefix}%`)
      .order("created_at", { ascending: false });
    const rows = (error ? [] : (data ?? [])) as any[];
    for (const row of rows) {
      const id = String(row?.id ?? "").trim();
      if (id) byId.set(id, row);
    }
  }
  return Array.from(byId.values()).sort((a, b) => {
    const aTime = Date.parse(String(a?.created_at ?? a?.data_criacao ?? "")) || 0;
    const bTime = Date.parse(String(b?.created_at ?? b?.data_criacao ?? "")) || 0;
    return bTime - aTime;
  });
}

async function loadUserDisplayNames(db: ReturnType<typeof getSupabaseServerClient>, userIds: string[]) {
  const ids = Array.from(new Set(userIds.map((value) => String(value ?? "").trim().toLowerCase()).filter(isUuid)));
  const names = new Map<string, string>();
  if (!ids.length) return names;

  const { data: profiles } = await db
    .from("user_profiles")
    .select("user_id,email,nome,sobrenome,nome_completo")
    .in("user_id", ids);
  for (const profile of profiles ?? []) {
    const userId = String((profile as any)?.user_id ?? "").trim().toLowerCase();
    if (!userId) continue;
    const first = normalizeText((profile as any)?.nome);
    const last = normalizeText((profile as any)?.sobrenome);
    const displayName =
      normalizeText((profile as any)?.nome_completo) ||
      normalizeText([first, last].filter(Boolean).join(" ")) ||
      normalizeText((profile as any)?.email);
    if (displayName) names.set(userId, displayName);
  }

  const missing = ids.filter((id) => !names.has(id));
  if (missing.length) {
    try {
      const admin = getSupabaseAdmin();
      await Promise.all(
        missing.map(async (userId) => {
          const { data } = await admin.auth.admin.getUserById(userId);
          const user = data?.user;
          const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
          const displayName = normalizeText(meta.full_name ?? meta.nome_completo ?? meta.name) || normalizeText(user?.email);
          if (displayName) names.set(userId, displayName);
        }),
      );
    } catch {}
  }
  return names;
}

function userIdFromLegacyEntryId(value: unknown) {
  const match = /^user:([0-9a-f-]{36}):/i.exec(String(value ?? "").trim());
  return match && isUuid(match[1] ?? "") ? String(match[1]).toLowerCase() : "";
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
    const url = new URL(req.url);
    const diag = String(url.searchParams.get("diag") ?? "").trim() === "1";
    const { accessToken, id, rawUserId } = resolveUserScopedId(req);
    if (!id) return json({ source: "legacy", readOnly: false, rows: [] }, { status: 200 });
    const supabase = getSupabaseServerClient(accessToken);
    const userId = String(id).slice("user:".length);

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

      const responsibleIds = visibleInvoicesDb
        .map((inv: any) =>
          String(
            inv?.responsavel_user_id ??
              (inv?.raw as any)?.responsavel_user_id ??
              (inv?.raw as any)?.responsavel_id ??
              (inv?.raw as any)?.created_by_user_id ??
              "",
          ).trim(),
        )
        .filter(isUuid);
      const responsibleNames = await loadUserDisplayNames(supabase, responsibleIds);

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
          const responsavelRaw = String(
            inv?.responsavel_user_id ??
              (inv?.raw as any)?.responsavel_id ??
              (inv?.raw as any)?.bubble?.responsavel_id ??
              (inv?.raw as any)?.bubble?.responsavel_id_custom_notas_fiscais ??
              (inv?.raw as any)?.bubble?.creator ??
              "",
          ).trim();
          const responsavel = (isUuid(responsavelRaw) ? responsibleNames.get(responsavelRaw.toLowerCase()) : "") || responsavelRaw || "-";

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
            const itemBubbleId = String(it?.item?.bubble_id ?? "").trim();
            const itemDbId = String(it?.item?.id ?? it?.item_id ?? "").trim();
            const itemId = itemBubbleId || (itemDbId ? `db:${itemDbId}` : "");
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

    const companyScope = await resolveCompanyEntryScope({ supabase, userId });
    const data = await loadCompanyLegacyEntradas({ supabase: companyScope.db, userIds: companyScope.userIds });

    let companyId = companyScope.companyId;
    try {
      if (!companyId) {
        const { data: memberRows, error: memberErr } = await supabase
          .from("company_members")
          .select("company_id,role,permission_level")
          .eq("user_id", userId)
          .limit(50);
        if (!memberErr) companyId = pickBestCompanyId((memberRows ?? []) as any[]);
      }
    } catch {}

    const rowsDb = data as any[];
    const supplierIds = Array.from(
      new Set(
        rowsDb
          .map((r) => String(r?.fornecedor ?? "").trim())
          .map((f) => (isDbPrefixed(f) ? canonicalUuid(dbIdFromKey(f)) : isUuid(f) ? canonicalUuid(f) : ""))
          .filter(Boolean),
      ),
    );

    const supplierNameById = new Map<string, string>();
    const supplierNameRawById = new Map<string, string>();
    const supplierNameFromRawById = new Map<string, string>();
    const supplierRawKeysById = new Map<string, string[]>();
    const supplierBubbleKeysById = new Map<string, string[]>();
    const supplierBubbleIdById = new Map<string, string>();
    const supplierExternalKeyById = new Map<string, string>();
    if (companyId && supplierIds.length) {
      const { data: suppliersDb } = await supabase
        .from("suppliers")
        .select("id,nome,raw,bubble_id,external_key")
        .eq("company_id", companyId)
        .in("id", supplierIds)
        .limit(5000);
      for (const s of suppliersDb ?? []) {
        const sid = canonicalUuid(String((s as any)?.id ?? ""));
        const nome = String((s as any)?.nome ?? "").trim();
        const rawObj = (s as any)?.raw;
        const rawLabel = extractSupplierLabelFromRaw(rawObj);
        if (sid && !supplierNameRawById.has(sid)) supplierNameRawById.set(sid, nome);
        if (sid && rawLabel && !supplierNameFromRawById.has(sid)) supplierNameFromRawById.set(sid, rawLabel);
        if (sid && !supplierRawKeysById.has(sid)) supplierRawKeysById.set(sid, Object.keys(safeObj(rawObj)).slice(0, 30));
        if (sid && !supplierBubbleKeysById.has(sid)) supplierBubbleKeysById.set(sid, Object.keys(safeObj(safeObj(rawObj as any).bubble)).slice(0, 30));
        if (sid && !supplierBubbleIdById.has(sid)) supplierBubbleIdById.set(sid, String((s as any)?.bubble_id ?? "").trim());
        if (sid && !supplierExternalKeyById.has(sid)) supplierExternalKeyById.set(sid, String((s as any)?.external_key ?? "").trim());
        const chosen = isGoodSupplierLabel(nome) ? nome : isGoodSupplierLabel(rawLabel) ? rawLabel : "";
        if (sid && chosen && !supplierNameById.has(sid)) supplierNameById.set(sid, chosen);
      }
    }

    if (companyId && supplierIds.length) {
      for (const sid of supplierIds) {
        if (supplierNameById.get(sid)) continue;
        const bubbleId = String(supplierBubbleIdById.get(sid) ?? "").trim();
        const externalKey = String(supplierExternalKeyById.get(sid) ?? "").trim();
        try {
          if (bubbleId) {
            const { data: alt } = await supabase
              .from("suppliers")
              .select("id,nome")
              .eq("company_id", companyId)
              .eq("bubble_id", bubbleId)
              .limit(25);
            for (const r of alt ?? []) {
              const nome = String((r as any)?.nome ?? "").trim();
              if (isGoodSupplierLabel(nome)) {
                supplierNameById.set(sid, nome);
                break;
              }
            }
          }
          if (!supplierNameById.get(sid) && externalKey) {
            const { data: alt } = await supabase
              .from("suppliers")
              .select("id,nome")
              .eq("company_id", companyId)
              .eq("external_key", externalKey)
              .limit(25);
            for (const r of alt ?? []) {
              const nome = String((r as any)?.nome ?? "").trim();
              if (isGoodSupplierLabel(nome)) {
                supplierNameById.set(sid, nome);
                break;
              }
            }
          }
        } catch {}
      }
    }

    const fallbackNameById = new Map<string, string>();
    let fornecedoresStateInfo: any = null;
    let fornecedoresStateProdutos: any = null;
    if (supplierIds.length) {
      try {
        const { data: st } = await supabase.from("fornecedores_state").select("info,produtos").eq("id", id).maybeSingle();
        const infoMap = (st as any)?.info && typeof (st as any)?.info === "object" ? ((st as any).info as any) : null;
        const produtosMap = (st as any)?.produtos && typeof (st as any)?.produtos === "object" ? ((st as any).produtos as any) : null;
        fornecedoresStateInfo = infoMap;
        fornecedoresStateProdutos = produtosMap;
        if (infoMap) {
          for (const sid of supplierIds) {
            if (supplierNameById.get(sid)) continue;
            const key = `db:${sid}`;
            const row = infoMap[key] ?? infoMap[key.toUpperCase()] ?? null;
            const label = row && typeof row === "object" ? String((row as any)?.fornecedor ?? "").trim() : "";
            if (label && !isBadSupplierLabel(label) && !fallbackNameById.has(sid)) fallbackNameById.set(sid, label);
          }
        }
      } catch {}
    }

    const inferredNameById = new Map<string, string>();
    if (companyId && supplierIds.length) {
      const targets = supplierIds.slice(0, 5).filter((sid) => !supplierNameById.get(sid));
      for (const targetId of targets) {
        try {
          const { data: linksTarget } = await supabase
            .from("supplier_items")
            .select("item_id")
            .eq("company_id", companyId)
            .eq("supplier_id", targetId)
            .limit(2000);
          const itemIds = Array.from(
            new Set((linksTarget ?? []).map((r: any) => String(r?.item_id ?? "").trim()).filter(Boolean)),
          ).slice(0, 200);
          if (!itemIds.length) continue;

          const { data: linksOthers } = await supabase
            .from("supplier_items")
            .select("supplier_id,item_id")
            .eq("company_id", companyId)
            .in("item_id", itemIds)
            .limit(5000);
          const counts = new Map<string, number>();
          for (const r of linksOthers ?? []) {
            const sid = canonicalUuid(String((r as any)?.supplier_id ?? ""));
            if (!sid || sid === targetId) continue;
            counts.set(sid, (counts.get(sid) ?? 0) + 1);
          }
          if (!counts.size) continue;
          const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
          const [bestId, bestCount] = sorted[0] ?? ["", 0];
          if (!bestId || !bestCount) continue;
          const threshold = Math.min(itemIds.length, 6);
          if (bestCount < threshold) continue;

          let candidateName = String(supplierNameById.get(bestId) ?? "").trim();
          if (!isGoodSupplierLabel(candidateName)) {
            const { data: row } = await supabase.from("suppliers").select("nome").eq("company_id", companyId).eq("id", bestId).limit(1).maybeSingle();
            candidateName = String((row as any)?.nome ?? "").trim();
          }
          if (!isGoodSupplierLabel(candidateName)) continue;
          inferredNameById.set(targetId, candidateName);
        } catch {}
      }
    }

    if (fornecedoresStateProdutos && fornecedoresStateInfo && supplierIds.length) {
      const produtosMap = fornecedoresStateProdutos as Record<string, unknown>;
      const infoMap = fornecedoresStateInfo as Record<string, unknown>;
      const wanted = supplierIds.slice(0, 5).filter((sid) => !supplierNameById.get(sid) && !fallbackNameById.get(sid) && !inferredNameById.get(sid));
      for (const sid of wanted) {
        try {
          const keyDb = `db:${sid}`;
          const rowsWithSupplier = rowsDb.filter((r) => normalizeLookupKey((r as any)?.fornecedor) === normalizeLookupKey(keyDb));
          const names = Array.from(
            new Set(
              rowsWithSupplier
                .flatMap((r) => safeArr((r as any)?.itens_nota))
                .map((it: any) => normalizeLookupKey(it?.nome))
                .filter(Boolean),
            ),
          );
          if (!names.length) continue;
          const wantedSet = new Set(names);
          let bestKey = "";
          let bestScore = 0;
          for (const k of Object.keys(produtosMap)) {
            const arr = safeArr((produtosMap as any)[k]).map((x) => normalizeLookupKey(x)).filter(Boolean);
            if (!arr.length) continue;
            let score = 0;
            for (const n of arr) if (wantedSet.has(n)) score += 1;
            if (score > bestScore) {
              bestScore = score;
              bestKey = k;
            }
          }
          const threshold = Math.min(2, names.length);
          if (!bestKey || bestScore < threshold) continue;
          const infoRow = (infoMap as any)[bestKey] ?? (infoMap as any)[String(bestKey).toUpperCase()] ?? null;
          const label = infoRow && typeof infoRow === "object" ? String((infoRow as any)?.fornecedor ?? "").trim() : "";
          if (isGoodSupplierLabel(label)) inferredNameById.set(sid, label);
        } catch {}
      }
    }

    const missingSupplierIds: string[] = [];
    const invalidSupplierNames: Array<{ id: string; nome: string }> = [];
    const responsibleNames = await loadUserDisplayNames(
      companyScope.db,
      rowsDb.flatMap((r) => {
        const raw = String((r as any)?.responsavel ?? "").trim();
        const owner = userIdFromLegacyEntryId((r as any)?.id);
        return [raw, owner].filter(isUuid);
      }),
    );
    const rows = rowsDb.map((r) => {
      const fornecedorRaw = String(r?.fornecedor ?? "").trim();
      const dbId = isDbPrefixed(fornecedorRaw) ? canonicalUuid(dbIdFromKey(fornecedorRaw)) : isUuid(fornecedorRaw) ? canonicalUuid(fornecedorRaw) : "";
      const storedNome = normalizeText((r as any)?.fornecedor_nome ?? "");
      const primary = dbId ? String(supplierNameById.get(dbId) ?? "").trim() : "";
      const fallback = dbId ? String(fallbackNameById.get(dbId) ?? "").trim() : "";
      const rawNome = dbId ? String(supplierNameRawById.get(dbId) ?? "").trim() : "";
      const rawLabel = dbId ? String(supplierNameFromRawById.get(dbId) ?? "").trim() : "";
      const inferred = dbId ? String(inferredNameById.get(dbId) ?? "").trim() : "";
      const nome = (isGoodSupplierLabel(storedNome) ? storedNome : "") || primary || fallback || inferred;
      if (dbId && rawNome && isBadSupplierLabel(rawNome) && invalidSupplierNames.length < 12) invalidSupplierNames.push({ id: dbId, nome: rawNome });
      if (dbId && !nome && missingSupplierIds.length < 12) missingSupplierIds.push(dbId);
      const responsavelRaw = String((r as any)?.responsavel ?? "").trim();
      const ownerUserId = userIdFromLegacyEntryId((r as any)?.id);
      const responsavel =
        (isUuid(responsavelRaw) ? responsibleNames.get(responsavelRaw.toLowerCase()) : "") ||
        responsibleNames.get(ownerUserId) ||
        responsavelRaw ||
        "-";
      return { ...r, responsavel, fornecedor_nome: nome && !isBadSupplierLabel(nome) ? nome : null };
    });

    return json(
      {
        source: "legacy",
        readOnly: false,
        ...(diag
          ? {
              diag: {
                companyId: companyId || null,
                supplierIdsCount: supplierIds.length,
                suppliersResolved: supplierNameById.size,
                suppliersFallbackResolved: fallbackNameById.size,
                missingSupplierIds,
                invalidSupplierNames,
                ...(supplierIds.length && (missingSupplierIds.length || invalidSupplierNames.length || supplierIds.length <= 5)
                  ? {
                      supplierLabelDebug: supplierIds.slice(0, 5).map((sid) => ({
                        id: sid,
                        nomeCol: supplierNameRawById.get(sid) ?? null,
                        rawLabel: supplierNameFromRawById.get(sid) ?? null,
                        rawKeys: supplierRawKeysById.get(sid) ?? [],
                        bubbleKeys: supplierBubbleKeysById.get(sid) ?? [],
                        resolved: supplierNameById.get(sid) ?? null,
                        inferred: inferredNameById.get(sid) ?? null,
                      })),
                    }
                  : null),
              },
            }
          : null),
        rows,
      },
      { status: 200 },
    );
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const t0 = performance.now();
    const body = (await req.json().catch(() => null)) as unknown;
    const tJson = performance.now();
    if (!body || typeof body !== "object") return json({ error: "invalid_body" }, { status: 400 });
    const { accessToken, id } = resolveUserScopedId(req);
    if (!id) return json({ error: "unauthorized" }, { status: 401 });
    const entradaId = String((body as any).id ?? "").trim();
    const supabase = getSupabaseServerClient(accessToken);
    const userId = String(id).slice("user:".length);
    const companyScope = await resolveCompanyEntryScope({ supabase, userId });
    if (!entryIdAllowedForCompanyScope(entradaId, companyScope)) {
      return json({ error: "invalid_id_scope" }, { status: 400 });
    }
    const responsibleNames = await loadUserDisplayNames(companyScope.db, [userId]);
    const existingResponsible = String((body as any)?.responsavel ?? "").trim();
    const payload = {
      ...(body as Record<string, unknown>),
      responsavel: existingResponsible || responsibleNames.get(userId.toLowerCase()) || userId,
    };
    const tBeforeUpsert = performance.now();
    const { error } = await companyScope.db.from("entradas").upsert(payload as any, { onConflict: "id" });
    const tAfterUpsert = performance.now();
    if (error) return json({ error: error.message }, { status: 500 });
    const total = tAfterUpsert - t0;
    const jsonMs = tJson - t0;
    const upsertMs = tAfterUpsert - tBeforeUpsert;
    const serverTiming = `total;dur=${total.toFixed(1)}, json;dur=${jsonMs.toFixed(1)}, upsert;dur=${upsertMs.toFixed(1)}`;
    return json({ ok: true }, { status: 200, headers: { "server-timing": serverTiming } });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const { accessToken, id: userScopedId } = resolveUserScopedId(req);
    if (!userScopedId) return json({ error: "unauthorized" }, { status: 401 });
    const supabase = getSupabaseServerClient(accessToken);
    const userId = String(userScopedId).slice("user:".length);
    const companyScope = await resolveCompanyEntryScope({ supabase, userId });

    const qId = String(url.searchParams.get("id") ?? "").trim();
    const body = (await req.json().catch(() => null)) as any;
    const idsRaw = Array.isArray(body?.ids) ? (body.ids as unknown[]) : body?.id ? [body.id] : qId ? [qId] : [];
    const ids = idsRaw.map((x) => String(x ?? "").trim()).filter(Boolean);
    if (!ids.length) return json({ error: "missing_id" }, { status: 400 });

    const invalidIds = ids.filter((id) => !entryIdAllowedForCompanyScope(id, companyScope));
    if (invalidIds.length) return json({ error: "invalid_id_scope", invalidIds }, { status: 400 });

    const deletedIds: string[] = [];
    const chunkSize = 200;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const { data, error } = await companyScope.db.from("entradas").delete().in("id", chunk).select("id");
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
