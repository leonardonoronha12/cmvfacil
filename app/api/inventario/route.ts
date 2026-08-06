import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../lib/requestUserId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

async function resolveSharedInventoryScope(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  userId: string,
) {
  const ownPrefix = `user:${userId}:`;
  const { data: ownMemberships, error: ownMembershipsError } = await supabase
    .from("company_members")
    .select("company_id,role,permission_level")
    .eq("user_id", userId)
    .limit(50);

  if (ownMembershipsError) throw new Error(ownMembershipsError.message);
  const companyId = pickBestCompanyId((ownMemberships ?? []) as any[]);
  if (!companyId) return { companyId: null as string | null, prefixes: [ownPrefix] };

  const { data: companyMembers, error: companyMembersError } = await supabase
    .from("company_members")
    .select("user_id")
    .eq("company_id", companyId)
    .limit(500);
  if (companyMembersError) throw new Error(companyMembersError.message);

  const prefixes = new Set<string>([ownPrefix, `company:${companyId}:`]);
  for (const member of companyMembers ?? []) {
    const memberUserId = String((member as any)?.user_id ?? "").trim();
    if (isUuid(memberUserId)) prefixes.add(`user:${memberUserId}:`);
  }
  return { companyId, prefixes: Array.from(prefixes) };
}

async function loadSharedLegacyInventoryRows(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  prefixes: string[],
) {
  const batches = await Promise.all(
    prefixes.map(async (prefix) => {
      const { data, error } = await supabase
        .from("inventario")
        .select("*")
        .like("id", `${prefix}%`)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    }),
  );

  const byId = new Map<string, any>();
  for (const row of batches.flat()) {
    const rowId = String((row as any)?.id ?? "").trim();
    if (rowId) byId.set(rowId, row);
  }
  return Array.from(byId.values()).sort((a: any, b: any) => {
    const aTime = new Date(String(a?.updated_at ?? a?.created_at ?? "")).getTime();
    const bTime = new Date(String(b?.updated_at ?? b?.created_at ?? "")).getTime();
    return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
  });
}

async function shouldUseCompatSource(args: { req: NextRequest; supabase: ReturnType<typeof getSupabaseServerClient>; userId: string; isAdmin: boolean }) {
  return false;
}

function formatDateNumericPT(d: Date) {
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function parseMaybeNumber(v: unknown) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v ?? "").replace(/[^\d,.-]/g, "").trim();
  if (!s) return 0;
  const neg = s.includes("-");
  const cleaned = s.replace(/-/g, "");
  const normalized = cleaned.replace(/\./g, "").replace(",", ".");
  const n = Number.parseFloat(normalized);
  if (!Number.isFinite(n)) return 0;
  return neg ? -n : n;
}

function formatQty(value: number) {
  if (!Number.isFinite(value)) return "0,000";
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function formatMoneyBRL(value: number) {
  if (!Number.isFinite(value)) return "R$0,00";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pickExpectedQty(raw: any): number {
  if (!raw || typeof raw !== "object") return 0;
  const candidates = [
    raw.quantidade_esperada,
    raw.quantidadeEsperada,
    raw.qtd_esperada,
    raw.qtdEsperada,
    raw.estoque_esperado,
    raw.estoqueEsperado,
    raw.quantidade_em_estoque,
    raw.quantidadeEmEstoque,
    raw.estoque_atual,
    raw.estoqueAtual,
    raw.quantidade_atual,
    raw.quantidadeAtual,
  ];
  for (const c of candidates) {
    const n = parseMaybeNumber(c);
    if (Number.isFinite(n) && n !== 0) return n;
  }
  const n0 = parseMaybeNumber(candidates[0]);
  return Number.isFinite(n0) ? n0 : 0;
}

export async function GET(req: NextRequest) {
  try {
    const { accessToken, id, rawUserId } = resolveUserScopedId(req);
    if (!id) return json({ source: "legacy", readOnly: false, rows: [] }, { status: 200 });
    const supabase = getSupabaseServerClient(accessToken);
    const userId = id.slice("user:".length);

    const isAdmin = Boolean(rawUserId && isAdminUserId(rawUserId));
    const useCompat = await shouldUseCompatSource({ req, supabase, userId, isAdmin });

    if (useCompat) {
      const { data: memberRows, error: memberErr } = await supabase
        .from("company_members")
        .select("company_id,role,permission_level")
        .eq("user_id", userId)
        .limit(50);
      if (memberErr) return json({ error: memberErr.message }, { status: 500 });
      const companyId = pickBestCompanyId((memberRows ?? []) as any[]);
      if (!companyId) return json({ error: "missing_company" }, { status: 500 });

      const { data: invRows, error: invErr } = await supabase
        .from("inventories")
        .select("id,bubble_id,nome,data_contagem,created_by_user_id,raw,created_at,updated_at")
        .eq("company_id", companyId)
        .order("data_contagem", { ascending: false })
        .order("created_at", { ascending: false });
      if (invErr) return json({ error: invErr.message }, { status: 500 });

      const inventoryIds = (invRows ?? []).map((r: any) => String(r?.id ?? "").trim()).filter(Boolean);
      const { data: invItems, error: itErr } = inventoryIds.length
        ? await supabase
            .from("inventory_items")
            .select("id,bubble_id,inventory_id,item_id,quantidade_contada,ocultar_cmv,item_temporario,raw,item:items(id,bubble_id,name,unidade_medida,custo_medio,ocultar_cmv,category_id)")
            .eq("company_id", companyId)
            .in("inventory_id", inventoryIds)
            .order("created_at", { ascending: true })
        : { data: [], error: null as any };
      if (itErr) return json({ error: itErr.message }, { status: 500 });

      const catIds = new Set<string>();
      for (const it of (invItems ?? []) as any[]) {
        const cid = String(it?.item?.category_id ?? "").trim();
        if (cid) catIds.add(cid);
      }
      const { data: catRows, error: catErr } = catIds.size
        ? await supabase.from("categories").select("id,name").eq("company_id", companyId).in("id", Array.from(catIds))
        : { data: [], error: null as any };
      if (catErr) return json({ error: catErr.message }, { status: 500 });
      const categoryNameById = new Map<string, string>((catRows ?? []).map((r: any) => [String(r?.id ?? ""), String(r?.name ?? "")]));

      const userIds = new Set<string>();
      for (const inv of (invRows ?? []) as any[]) {
        const uid = String(inv?.created_by_user_id ?? "").trim();
        if (uid) userIds.add(uid);
      }
      const { data: userEmailRows, error: ueErr } = userIds.size
        ? await supabase.from("user_profiles").select("user_id,email").in("user_id", Array.from(userIds))
        : { data: [], error: null as any };
      if (ueErr) return json({ error: ueErr.message }, { status: 500 });
      const emailByUserId = new Map<string, string>((userEmailRows ?? []).map((r: any) => [String(r?.user_id ?? ""), String(r?.email ?? "")]));

      const itemsByInventory = new Map<string, any[]>();
      for (const it of (invItems ?? []) as any[]) {
        const invId = String(it?.inventory_id ?? "").trim();
        if (!invId) continue;
        const arr = itemsByInventory.get(invId) ?? [];
        arr.push(it);
        itemsByInventory.set(invId, arr);
      }

      const compatInventories = (invRows ?? [])
        .map((inv: any) => {
          const invDbId = String(inv?.id ?? "").trim();
          const bubbleId = String(inv?.bubble_id ?? "").trim();
          const outId = bubbleId || (invDbId ? `db:${invDbId}` : "");
          if (!outId) return null;

          const dataDt = inv?.data_contagem ? new Date(String(inv.data_contagem)) : null;
          const dataContagem = dataDt && Number.isFinite(dataDt.getTime()) ? formatDateNumericPT(dataDt) : "-";
          const status = String(inv?.raw?.status ?? inv?.raw?.estado ?? "").trim() || "-";
          const responsavelUserId = String(inv?.created_by_user_id ?? "").trim();
          const responsavel = (responsavelUserId && emailByUserId.get(responsavelUserId)) || (responsavelUserId ? responsavelUserId : "-");

          const items = (itemsByInventory.get(invDbId) ?? []).map((it: any) => {
            const itDbId = String(it?.id ?? "").trim();
            const itBubbleId = String(it?.bubble_id ?? "").trim();
            const itemOutId = itBubbleId || (itDbId ? `db:${itDbId}` : "");
            const itemName = String(it?.item?.name ?? "").trim() || "-";
            const unit = String(it?.item?.unidade_medida ?? it?.raw?.unidade ?? it?.raw?.unidade_medida ?? "").trim() || "Und";
            const categoria = categoryNameById.get(String(it?.item?.category_id ?? "")) || "Sem categoria";
            const expectedQty = pickExpectedQty(it?.raw ?? {});
            const countedQty = parseMaybeNumber(it?.quantidade_contada ?? it?.raw?.quantidade_contada ?? it?.raw?.quantidadeContada ?? "");
            const diffQty = countedQty - expectedQty;
            const avgCost = parseMaybeNumber(it?.item?.custo_medio ?? it?.raw?.custo_medio ?? it?.raw?.custoMedio ?? 0);
            const valueDiff = diffQty * avgCost;
            const ocultarCmv = Boolean(it?.ocultar_cmv || it?.item?.ocultar_cmv);
            return {
              id: itemOutId,
              itemId: String(it?.item?.bubble_id ?? "").trim() || null,
              item: itemName,
              categoria,
              unidade: unit,
              quantidadeEsperada: formatQty(expectedQty),
              quantidadeContada: formatQty(countedQty),
              diferenca: formatQty(diffQty),
              custoMedio: formatMoneyBRL(avgCost),
              valorDiferenca: formatMoneyBRL(valueDiff),
              ocultarCmv,
            };
          });

          return { id: outId, bubble_id: bubbleId || null, dataContagem, status, responsavel, itens: items };
        })
        .filter(Boolean);

      const legacyRows = compatInventories.map((inv: any) => {
        const cats = new Map<string, any[]>();
        for (const it of inv.itens ?? []) {
          const catName = String(it?.categoria ?? "Sem categoria");
          const key = catName.toLowerCase();
          const list = cats.get(key) ?? [];
          list.push({ id: String(it?.itemId ?? it?.id ?? ""), item: String(it?.item ?? ""), unidade: String(it?.unidade ?? "Und"), estoqueFinal: String(it?.quantidadeContada ?? "") });
          cats.set(key, list);
        }
        const categorias = Array.from(cats.entries()).map(([key, itens]) => ({
          id: `cat-${inv.id}-${key}`,
          nome: key ? key[0].toUpperCase() + key.slice(1) : "Sem categoria",
          status: "concluida",
          itens,
        }));
        return { id: String(inv.id), data: String(inv.dataContagem), categorias };
      });

      const totals = {
        inventories: compatInventories.length,
        inventoryItems: compatInventories.reduce((acc: number, inv: any) => acc + (Array.isArray(inv.itens) ? inv.itens.length : 0), 0),
      };

      return json({ source: "compat", readOnly: true, rows: legacyRows, compat: { totals, inventories: compatInventories } }, { status: 200 });
    }

    const sharedScope = await resolveSharedInventoryScope(supabase, userId);
    const rows = await loadSharedLegacyInventoryRows(supabase, sharedScope.prefixes);
    return json(
      {
        source: "legacy",
        readOnly: false,
        rows,
        scope: sharedScope.companyId ? "company" : "user",
        companyId: sharedScope.companyId,
      },
      { status: 200 },
    );
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const src = String(new URL(req.url).searchParams.get("source") ?? "").trim().toLowerCase();
    if (src === "compat") return json({ error: "read_only" }, { status: 403 });
    const body = (await req.json().catch(() => null)) as unknown;
    if (!body || typeof body !== "object") return json({ error: "invalid_body" }, { status: 400 });
    const { accessToken, id } = resolveUserScopedId(req);
    const ownPrefix = id ? `${id}:` : "";
    if (!ownPrefix) return json({ error: "unauthorized" }, { status: 401 });
    const invId = String((body as any).id ?? "").trim();
    if (!invId) return json({ error: "invalid_id_scope" }, { status: 400 });
    const supabase = getSupabaseServerClient(accessToken);
    const userId = id!.slice("user:".length);
    const sharedScope = await resolveSharedInventoryScope(supabase, userId);
    if (!sharedScope.prefixes.some((prefix) => invId.startsWith(prefix))) {
      return json({ error: "invalid_id_scope" }, { status: 400 });
    }

    const inventoryDate = String((body as any)?.data ?? "").trim();
    if (inventoryDate) {
      const existingRows = await loadSharedLegacyInventoryRows(supabase, sharedScope.prefixes);
      const duplicate = existingRows.some(
        (row: any) => String(row?.id ?? "").trim() !== invId && String(row?.data ?? "").trim() === inventoryDate,
      );
      if (duplicate) return json({ error: "inventario_date_exists" }, { status: 409 });
    }

    const { error } = await supabase.from("inventario").upsert(body as any, { onConflict: "id" });
    if (error) return json({ error: error.message }, { status: 500 });
    return json({ ok: true }, { status: 200 });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const src = String(url.searchParams.get("source") ?? "").trim().toLowerCase();
    if (src === "compat") return json({ error: "read_only" }, { status: 403 });
    const id = (url.searchParams.get("id") ?? "").trim();
    if (!id) return json({ error: "missing_id" }, { status: 400 });
    const { accessToken, id: userScopedId } = resolveUserScopedId(req);
    const ownPrefix = userScopedId ? `${userScopedId}:` : "";
    if (!ownPrefix) return json({ error: "unauthorized" }, { status: 401 });
    const supabase = getSupabaseServerClient(accessToken);
    const userId = userScopedId!.slice("user:".length);
    const sharedScope = await resolveSharedInventoryScope(supabase, userId);
    if (!sharedScope.prefixes.some((prefix) => id.startsWith(prefix))) {
      return json({ error: "invalid_id_scope" }, { status: 400 });
    }
    const { error } = await supabase.from("inventario").delete().eq("id", id);
    if (error) return json({ error: error.message }, { status: 500 });
    return json({ ok: true }, { status: 200 });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
