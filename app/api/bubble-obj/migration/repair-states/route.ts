import { NextRequest, NextResponse } from "next/server";
import {
  buildDesperdicioId,
  buildEntradaId,
  buildInsumoId,
  buildInventarioId,
  mapCategoriaName,
  mapCustoMedioItem,
  mapDesperdicio,
  mapFornecedor,
  mapInventario,
  mapItemFornecedor,
  mapItemInventario,
  mapItemNota,
  mapItemToInsumo,
  mapMotivoDesperdicio,
  mapNotaFiscal,
  formatBubbleDateLabelPT,
  formatBubbleQuantity3,
  parseBubbleNumber,
  parseObjectType,
  userScopedId,
} from "../../../../lib/bubbleObjRealMapping";
import { formatMoneyBRL, parsePtNumber } from "../../../../lib/bubbleCsv";
import { getUserIdFromRequest } from "../../../../lib/requestUserId";
import { getSupabaseAdmin } from "../../../../lib/supabaseAdmin";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return NextResponse.json(data, { ...init, headers });
}

function nowIso() {
  return new Date().toISOString();
}

function uniqueStrings(input: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of input) {
    const v = String(s ?? "").trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function bubbleIdFromInsumoId(id: string) {
  const s = String(id ?? "");
  return s.includes("insumo:") ? s.split("insumo:", 2)[1] : "";
}

function mergeUniqueSortedStrings(input: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of input) {
    const s = String(v ?? "").trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  out.sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base", numeric: true }));
  return out;
}

function parseBubbleBool(value: unknown) {
  const s = String(value ?? "").trim().toLowerCase();
  if (["1", "true", "sim", "yes"].includes(s)) return true;
  if (["0", "false", "nao", "não", "no", ""].includes(s)) return false;
  return Boolean(value);
}

function formatPercent(value: number, digits = 1) {
  return `${value.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: digits })}%`;
}

function scopeObjectType(userId: string, objectType: string) {
  const base = String(objectType ?? "").trim();
  if (!base) return "";
  return base.includes("#") ? base : `${base}#${userId}`;
}

async function loadControlRows(supabase: ReturnType<typeof getSupabaseAdmin>, userId: string, objectType: string) {
  const out: any[] = [];
  const pageSize = 1000;
  for (let from = 0; from < 50_000; from += pageSize) {
    const { data, error } = await supabase
      .from("bubble_obj_import_control")
      .select("id,bubble_unique_id,raw_payload_json,status")
      .eq("supabase_user_id", userId)
      .eq("bubble_object_type", objectType)
      .in("status", ["staged", "processed", "staged_only"])
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as any[];
    for (const r of rows) out.push(r);
    if (rows.length < pageSize) break;
  }
  return out;
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId) return json({ ok: false, error: "unauthorized" }, { status: 401 });

    const supabase = getSupabaseAdmin();
    const { data: mig, error: migErr } = await supabase
      .from("bubble_obj_user_migration")
      .select("supabase_user_id,last_run_id,email")
      .eq("supabase_user_id", userId)
      .maybeSingle();
    if (migErr) return json({ ok: false, error: migErr.message }, { status: 500 });
    if (!mig) return json({ ok: false, error: "migration_not_found" }, { status: 404 });
    const runId = String((mig as any)?.last_run_id ?? "").trim();
    if (!runId) return json({ ok: false, error: "missing_run_id" }, { status: 400 });

    const { data: runItems, error: runItemsErr } = await supabase
      .from("bubble_obj_import_run_item")
      .select("object_type")
      .eq("supabase_user_id", userId)
      .eq("run_id", runId);
    if (runItemsErr) return json({ ok: false, error: runItemsErr.message }, { status: 500 });
    const objectTypes = (runItems ?? []).map((x: any) => String(x?.object_type ?? "").trim()).filter(Boolean);
    const companyId =
      objectTypes.map((ot: string) => parseObjectType(ot).companyId).find((x: any) => typeof x === "string" && String(x).trim()) ?? null;
    if (!companyId) return json({ ok: false, error: "missing_company_id" }, { status: 400 });

    const stId = userScopedId(userId).slice(0, -1);

    const categoriasKey = scopeObjectType(userId, `categorias@${companyId}`);
    const itemKey = scopeObjectType(userId, `item@${companyId}`);
    const custoKey = scopeObjectType(userId, `custo_medio_item@${companyId}`);
    const fornecedoresKey = scopeObjectType(userId, `fornecedores@${companyId}`);
    const inventariosKey = scopeObjectType(userId, `inventarios@${companyId}`);
    const itensInventariosKey = scopeObjectType(userId, `itens_inventarios@${companyId}`);
    const notasKey = scopeObjectType(userId, `notas_fiscais@${companyId}`);
    const itensNotasKey = scopeObjectType(userId, `itens_notas@${companyId}`);
    const itensFornecedoresKey = scopeObjectType(userId, `itens_fornecedores@${companyId}`);
    const motivosKey = scopeObjectType(userId, `motivos_desperdicios@${companyId}`);
    const desperdicioKey = scopeObjectType(userId, `desperdicio@${companyId}`);

    const [
      categoriasRows,
      itemRows,
      custoRows,
      fornecedoresRows,
      itensFornecedoresRows,
      inventariosRows,
      itensInvRows,
      notasRows,
      itensNotasRows,
      motivosRows,
      desperdicioRows,
    ] = await Promise.all([
      loadControlRows(supabase, userId, categoriasKey),
      loadControlRows(supabase, userId, itemKey),
      loadControlRows(supabase, userId, custoKey),
      loadControlRows(supabase, userId, fornecedoresKey),
      loadControlRows(supabase, userId, itensFornecedoresKey),
      loadControlRows(supabase, userId, inventariosKey),
      loadControlRows(supabase, userId, itensInventariosKey),
      loadControlRows(supabase, userId, notasKey),
      loadControlRows(supabase, userId, itensNotasKey),
      loadControlRows(supabase, userId, motivosKey),
      loadControlRows(supabase, userId, desperdicioKey),
    ]);

    const categoriaNameById: Record<string, string> = {};
    for (const r of categoriasRows) {
      const id = String(r?.bubble_unique_id ?? "").trim();
      if (!id) continue;
      const nome = mapCategoriaName(r?.raw_payload_json ?? {});
      if (nome) categoriaNameById[id] = nome;
    }

    const insumosById = new Map<string, any>();
    for (const r of itemRows) {
      const raw = r?.raw_payload_json ?? {};
      const mapped = mapItemToInsumo(raw, { userId, categoriaNameById });
      if (!mapped.ok || !mapped.bubbleItemId) continue;
      insumosById.set(mapped.insumo.id, mapped.insumo);
    }

    const latestCostByBubbleItemId = new Map<string, { custoMedio: string; createdAt: string }>();
    for (const r of custoRows) {
      const cm = mapCustoMedioItem(r?.raw_payload_json ?? {});
      if (!cm.bubbleItemId || !cm.custoMedio) continue;
      const prev = latestCostByBubbleItemId.get(cm.bubbleItemId) ?? null;
      const prevParsed = prev?.createdAt ? Date.parse(prev.createdAt) : 0;
      const nextParsed = cm.createdAt ? Date.parse(cm.createdAt) : 0;
      const prevT = Number.isFinite(prevParsed) ? prevParsed : 0;
      const nextT = Number.isFinite(nextParsed) ? nextParsed : 0;
      if (!prev || nextT >= prevT) latestCostByBubbleItemId.set(cm.bubbleItemId, { custoMedio: cm.custoMedio, createdAt: cm.createdAt });
    }

    for (const [id, row] of insumosById.entries()) {
      const bubbleItemId = bubbleIdFromInsumoId(id);
      if (!bubbleItemId) continue;
      const fromCostType = latestCostByBubbleItemId.get(bubbleItemId)?.custoMedio ?? "";
      const current = String((row as any)?.custoMedio ?? "").trim();
      if (fromCostType && (!current || current === "-" || current === "R$0,00")) insumosById.set(id, { ...(row as any), custoMedio: fromCostType });
    }

    for (const r of itensNotasRows) {
      const it = mapItemNota(r?.raw_payload_json ?? {});
      if (!it.bubbleItemId || !it.custoUnitario) continue;
      const insumoId = buildInsumoId(userId, it.bubbleItemId);
      const prev = insumosById.get(insumoId) ?? null;
      if (!prev) continue;
      const prevCost = String((prev as any)?.custoMedio ?? "").trim();
      if (!prevCost || prevCost === "-" || prevCost === "R$0,00") insumosById.set(insumoId, { ...(prev as any), custoMedio: it.custoUnitario });
    }

    const insumosRows = Array.from(insumosById.values()).filter((x) => x && typeof x === "object" && String((x as any)?.id ?? ""));
    const categories = uniqueStrings(
      insumosRows
        .map((r: any) => String(r?.categoria ?? "").trim())
        .filter(Boolean)
        .concat(Object.values(categoriaNameById)),
    );
    await supabase.from("insumos_state").upsert({ id: stId, payload: { rows: insumosRows, categories } } as any, { onConflict: "id" });

    const fichasTecnicasRows: any[] = [];
    const prePreparoRows: any[] = [];
    for (const r of itemRows) {
      const raw = r?.raw_payload_json ?? {};
      if (!parseBubbleBool((raw as any)?.boolean_item_receita)) continue;
      const bubbleItemId = String(r?.bubble_unique_id ?? (raw as any)?._id ?? "").trim();
      if (!bubbleItemId) continue;
      const receita = String((raw as any)?.nome ?? "").trim() || "-";
      const unidade = String((raw as any)?.unidade_medida ?? "").trim() || "Und";
      const categoriaId = String((raw as any)?.categoria_id ?? "").trim();
      const categoria = String(categoriaNameById[categoriaId] ?? "").trim() || "Sem categoria";
      const rendimentoNum = parseBubbleNumber((raw as any)?.rendimento);
      const custoTotalNum = parseBubbleNumber((raw as any)?.custo_total_receita);
      const custoUnitarioNum = parseBubbleNumber((raw as any)?.custo_medio) || parseBubbleNumber(latestCostByBubbleItemId.get(bubbleItemId)?.custoMedio);
      const precoVendaNum = parseBubbleNumber((raw as any)?.preco_venda_total);
      const cmvMetaNum = parseBubbleNumber((raw as any)?.cmv_desejado);
      const cmvAtualNum = precoVendaNum > 0 ? (custoUnitarioNum / precoVendaNum) * 100 : 0;
      const cmvDeltaNum = cmvAtualNum - cmvMetaNum;
      const quadrante = String((raw as any)?.quadrante_ficha_tecnica ?? "").trim().toLowerCase();
      const bcg = ["estrela", "cavalo", "quebra-cabeca", "abacaxi"].includes(quadrante) ? quadrante : "quebra-cabeca";
      const modoPreparo = String((raw as any)?.modo_preparo ?? "").trim() || "-";

      if (parseBubbleBool((raw as any)?.boolean_item_do_cardapio)) {
        fichasTecnicasRows.push({
          id: bubbleItemId,
          origin: "bubble",
          receita,
          precoVenda: precoVendaNum > 0 ? formatMoneyBRL(precoVendaNum) : "-",
          custoUnitario: `${formatMoneyBRL(custoUnitarioNum)} / ${unidade}`,
          cmvMeta: formatPercent(cmvMetaNum, 2),
          cmvAtual: formatPercent(cmvAtualNum, 1),
          cmvDelta: `${cmvDeltaNum > 0 ? "+" : ""}${formatPercent(cmvDeltaNum, 1)}`,
          bcg,
          thumb: "burger",
          recipeYield: rendimentoNum,
          ingredientsTotal: custoTotalNum,
          ingredientRows: [],
          modoPreparo,
        });
      } else {
        const validadeDias = Math.max(0, Math.trunc(parseBubbleNumber((raw as any)?.validade_dias)));
        prePreparoRows.push({
          id: bubbleItemId,
          origin: "bubble",
          categoria,
          receita,
          custoTotal: formatMoneyBRL(custoTotalNum),
          rendimento: rendimentoNum > 0 ? `${formatBubbleQuantity3(rendimentoNum)} ${unidade}` : "-",
          custoUnitario: `${formatMoneyBRL(custoUnitarioNum)} / ${unidade}`,
          validadeDias,
          ingredientes: [],
          modoPreparo,
        });
      }
    }
    await supabase.from("fichas_tecnicas_state").upsert({ id: stId, payload: fichasTecnicasRows } as any, { onConflict: "id" });
    await supabase.from("pre_preparo_state").upsert({ id: stId, payload: prePreparoRows } as any, { onConflict: "id" });

    const insumoByBubbleId = new Map<string, any>();
    for (const r of insumosRows as any[]) {
      const bubbleId = bubbleIdFromInsumoId(String((r as any)?.id ?? ""));
      if (bubbleId) insumoByBubbleId.set(bubbleId, r);
    }

    const fornecedorNameById: Record<string, string> = {};
    const fornecedoresInfo: Record<string, any> = {};
    for (const r of fornecedoresRows) {
      const f = mapFornecedor(r?.raw_payload_json ?? {});
      if (!f.bubbleFornecedorId) continue;
      if (f.nome) fornecedorNameById[f.bubbleFornecedorId] = f.nome;
      const nome = String(f.nome ?? "").trim();
      if (!nome) continue;
      const k = nome.toUpperCase();
      fornecedoresInfo[k] = {
        fornecedor: nome,
        vendedor: String((f as any)?.vendedor ?? "").trim(),
        whatsapp: String((f as any)?.whatsapp ?? "").trim(),
        endereco: String((f as any)?.endereco ?? "").trim(),
      };
    }

    const fornecedoresProdutos: Record<string, string[]> = {};
    for (const r of itensFornecedoresRows) {
      const it = mapItemFornecedor(r?.raw_payload_json ?? {});
      const fornNome = String(fornecedorNameById[it.bubbleFornecedorId] ?? "").trim();
      const key = fornNome ? fornNome.toUpperCase() : "";
      if (!key) continue;
      const insumoNome = it.bubbleItemId ? String((insumoByBubbleId.get(it.bubbleItemId) as any)?.item ?? "").trim() : "";
      const nomeItem = String(it.nomeItem || insumoNome || "").trim();
      if (!nomeItem) continue;
      fornecedoresProdutos[key] = mergeUniqueSortedStrings([...(fornecedoresProdutos[key] ?? []), nomeItem]);
    }

    // Some Bubble tenants never persisted itens_fornecedores. In that case,
    // rebuild only relationships proven by their purchase history: the item
    // belongs to the supplier of its parent invoice. Never guess links for
    // orphan invoice items.
    if (itensFornecedoresRows.length === 0) {
      const supplierByInvoiceId = new Map<string, string>();
      for (const r of notasRows) {
        const nf = mapNotaFiscal(r?.raw_payload_json ?? {});
        if (nf.bubbleNotaId && nf.fornecedorId) supplierByInvoiceId.set(nf.bubbleNotaId, nf.fornecedorId);
      }
      for (const r of itensNotasRows) {
        const it = mapItemNota(r?.raw_payload_json ?? {});
        const supplierId = supplierByInvoiceId.get(it.bubbleNotaId) ?? "";
        const supplierName = String(fornecedorNameById[supplierId] ?? "").trim();
        const itemName = it.bubbleItemId ? String((insumoByBubbleId.get(it.bubbleItemId) as any)?.item ?? "").trim() : "";
        if (!supplierName || !itemName) continue;
        const key = supplierName.toUpperCase();
        fornecedoresProdutos[key] = mergeUniqueSortedStrings([...(fornecedoresProdutos[key] ?? []), itemName]);
      }
    }

    await supabase
      .from("fornecedores_state")
      .upsert({ id: stId, info: fornecedoresInfo, produtos: fornecedoresProdutos, equivalencias: {} } as any, { onConflict: "id" });

    const inventariosById = new Map<string, { id: string; data: string; categorias: any[] }>();
    for (const r of inventariosRows) {
      const inv = mapInventario(r?.raw_payload_json ?? {});
      if (!inv.bubbleInventarioId) continue;
      const id = buildInventarioId(userId, inv.bubbleInventarioId);
      inventariosById.set(id, { id, data: inv.data, categorias: [] });
    }

    const invCatsByInvId = new Map<string, Map<string, any>>();
    for (const r of itensInvRows) {
      const it = mapItemInventario(r?.raw_payload_json ?? {});
      if (!it.bubbleInventarioId || !it.bubbleItemId) continue;
      const invId = buildInventarioId(userId, it.bubbleInventarioId);
      if (!inventariosById.has(invId)) continue;
      const insumoId = buildInsumoId(userId, it.bubbleItemId);
      const insumo = insumoByBubbleId.get(it.bubbleItemId) ?? null;
      const itemName = String((insumo as any)?.item ?? "").trim() || "Item";
      const unidade = String((insumo as any)?.medida ?? it.unidade ?? "Und").trim() || "Und";
      const catName = String((insumo as any)?.categoria ?? "").trim() || "Sem categoria";
      const catKey = catName.toLowerCase();
      const cats = invCatsByInvId.get(invId) ?? new Map<string, any>();
      const catObj = cats.get(catKey) ?? { id: `cat:${catKey}`, nome: catName, status: "contabilizado", itens: [] };
      const itensArr = Array.isArray(catObj.itens) ? (catObj.itens as any[]) : [];
      const raw = r?.raw_payload_json ?? {};
      const sourceUpdatedAt = Date.parse(String((raw as any)?.["Modified Date"] ?? (raw as any)?.["Created Date"] ?? "")) || 0;
      const candidate = { id: insumoId, item: itemName, unidade, estoqueFinal: String(it.estoqueFinal ?? "") || "", __bubbleUpdatedAt: sourceUpdatedAt };
      const existingIndex = itensArr.findIndex((x) => String((x as any)?.id ?? "") === insumoId);
      if (existingIndex < 0) {
        itensArr.push(candidate);
      } else {
        const existing = itensArr[existingIndex] as any;
        const existingUpdatedAt = Number(existing?.__bubbleUpdatedAt ?? 0) || 0;
        const candidateHasValue = Boolean(String(candidate.estoqueFinal ?? "").trim());
        const existingHasValue = Boolean(String(existing?.estoqueFinal ?? "").trim());
        if (sourceUpdatedAt > existingUpdatedAt || (sourceUpdatedAt === existingUpdatedAt && candidateHasValue && !existingHasValue)) itensArr[existingIndex] = candidate;
      }
      catObj.itens = itensArr;
      cats.set(catKey, catObj);
      invCatsByInvId.set(invId, cats);
    }

    const inventarioUpserts = Array.from(inventariosById.values()).map((inv) => {
      const cats = invCatsByInvId.get(inv.id);
      const finalCats = cats
        ? Array.from(cats.values()).map((category: any) => ({
            ...category,
            itens: (Array.isArray(category?.itens) ? category.itens : []).map(({ __bubbleUpdatedAt: _sourceUpdatedAt, ...item }: any) => item),
          }))
        : [];
      return { id: inv.id, data: inv.data, categorias: finalCats } as any;
    });
    if (inventarioUpserts.length) await supabase.from("inventario").upsert(inventarioUpserts as any, { onConflict: "id" });

    const notaItemsByNotaId = new Map<string, any[]>();
    for (const r of itensNotasRows) {
      const it = mapItemNota(r?.raw_payload_json ?? {});
      if (!it.bubbleNotaId || !it.bubbleItemId) continue;
      const insumo = insumoByBubbleId.get(it.bubbleItemId) ?? null;
      const nomeNaNota = String((insumo as any)?.item ?? it.nomeItem ?? "").trim();
      const insumoEquivalente = nomeNaNota || "";
      const equivalenteUnidade = String((insumo as any)?.medida ?? "").trim();
      const stablePart = it.bubbleItemNotaId || it.bubbleItemId;
      const stableItemId = `${userScopedId(userId)}nota_item:${it.bubbleNotaId}:${stablePart}`;
      const unidade = equivalenteUnidade || "Und";
      const quantidade = parseBubbleNumber(it.quantidade);
      const arr = notaItemsByNotaId.get(it.bubbleNotaId) ?? [];
      arr.push({
        id: stableItemId,
        itemId: it.bubbleItemId,
        nome: nomeNaNota || insumoEquivalente || "-",
        unidade,
        quantidadeLabel: `${quantidade.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} ${unidade}`,
        subtotalLabel: it.subtotal || "R$0,00",
        custoUnitarioLabel: it.custoUnitario || "R$0,00",
      });
      notaItemsByNotaId.set(it.bubbleNotaId, arr);
    }

    const entradasUpserts: any[] = [];
    for (const r of notasRows) {
      const nf = mapNotaFiscal(r?.raw_payload_json ?? {});
      if (!nf.bubbleNotaId) continue;
      const fornecedorFromId = nf.fornecedorId ? String(fornecedorNameById[nf.fornecedorId] ?? "").trim() : "";
      const fornecedor = fornecedorFromId || nf.fornecedorNome || String(nf.fornecedorId || "").trim() || "Sem fornecedor";
      const numero = nf.numero || `NF-${String(nf.bubbleNotaId).slice(0, 8)}`;
      const dataLancamento = formatBubbleDateLabelPT(nf.dataLancamento || nf.dataCriacao);
      const dataCriacao = formatBubbleDateLabelPT(nf.dataCriacao || nf.dataLancamento);
      const baseItensNota = (nf as any).listaItens
        ? (nf as any).listaItens
            .map((bubbleItemId: any) => {
              const id = String(bubbleItemId ?? "").trim();
              if (!id) return null;
              const insumo = insumoByBubbleId.get(id) ?? null;
              const nomeNaNota = String((insumo as any)?.item ?? "").trim();
              const insumoEquivalente = nomeNaNota || "";
              const equivalenteUnidade = String((insumo as any)?.medida ?? "").trim();
              const unidade = equivalenteUnidade || "Und";
              return {
                id: `${userScopedId(userId)}nota_item:${nf.bubbleNotaId}:${id}`,
                itemId: id,
                nome: nomeNaNota || insumoEquivalente || "-",
                unidade,
                quantidadeLabel: `0,000 ${unidade}`,
                subtotalLabel: "R$0,00",
                custoUnitarioLabel: "R$0,00",
              };
            })
            .filter(Boolean)
        : [];
      const extras = notaItemsByNotaId.get(nf.bubbleNotaId) ?? [];
      const itensNota = extras.length ? extras : baseItensNota;
      const itensLabel = `${itensNota.length} ${itensNota.length === 1 ? "Item" : "Itens"}`;

      const valorNota = (() => {
        const raw = String(nf.valorNota ?? "").trim();
        const parsed = parsePtNumber(raw);
        if (parsed && parsed > 0) return formatMoneyBRL(parsed);
        let sum = 0;
        for (const it of itensNota) {
          const sub = parsePtNumber(String((it as any)?.subtotalLabel ?? ""));
          if (sub) sum += sub;
        }
        return sum > 0 ? formatMoneyBRL(sum) : "R$0,00";
      })();

      entradasUpserts.push({
        id: buildEntradaId(userId, nf.bubbleNotaId),
        user_id: userId,
        numero,
        data_lancamento: dataLancamento,
        fornecedor,
        valor_nota: valorNota,
        itens: itensLabel,
        responsavel: nf.responsavel || "",
        data_criacao: dataCriacao,
        itens_nota: itensNota,
      } as any);
    }
    if (entradasUpserts.length) await supabase.from("entradas").upsert(entradasUpserts as any, { onConflict: "id" });

    // Keep the normalized purchase tables complete as well as the legacy
    // entradas projection. Dashboard history currently tolerates the legacy
    // projection, but CMV consumers must not depend on embedded JSON forever.
    let normalizedInvoiceItems = 0;
    let normalizedInvoiceItemsSkipped = 0;
    const { data: targetCompanyRow } = await supabase.from("companies").select("id").eq("bubble_id", companyId).maybeSingle();
    let targetCompanyId = String((targetCompanyRow as any)?.id ?? "").trim();
    if (!targetCompanyId) {
      const { data: membershipRows } = await supabase.from("company_members").select("company_id").eq("user_id", userId).limit(2);
      if ((membershipRows ?? []).length === 1) targetCompanyId = String((membershipRows as any[])[0]?.company_id ?? "").trim();
    }
    if (targetCompanyId) {
      const [targetItemsRes, targetInvoicesRes] = await Promise.all([
        supabase.from("items").select("id,bubble_id,name").eq("company_id", targetCompanyId),
        supabase.from("invoices").select("id,bubble_id,fornecedor_id").eq("company_id", targetCompanyId),
      ]);
      if (targetItemsRes.error) throw new Error(targetItemsRes.error.message);
      if (targetInvoicesRes.error) throw new Error(targetInvoicesRes.error.message);
      const targetItemIdByBubbleId = new Map<string, string>();
      const targetItemIdByName = new Map<string, string>();
      for (const row of (targetItemsRes.data ?? []) as any[]) {
        const bubbleId = String(row?.bubble_id ?? "").trim();
        const id = String(row?.id ?? "").trim();
        if (bubbleId && id) targetItemIdByBubbleId.set(bubbleId, id);
        const nameKey = String(row?.name ?? "").replace(/\s+/g, " ").trim().toLocaleUpperCase("pt-BR");
        if (nameKey && id && !targetItemIdByName.has(nameKey)) targetItemIdByName.set(nameKey, id);
      }
      const sourceItemNameByBubbleId = new Map<string, string>();
      for (const sourceItemRow of itemRows) {
        const bubbleId = String(sourceItemRow?.bubble_unique_id ?? "").trim();
        const name = String((sourceItemRow?.raw_payload_json as any)?.nome ?? "").replace(/\s+/g, " ").trim();
        if (bubbleId && name) sourceItemNameByBubbleId.set(bubbleId, name);
      }
      const itemBubbleIdBackfills = new Map<string, string>();
      const targetInvoiceByBubbleId = new Map<string, { id: string; fornecedorId: string }>();
      for (const row of (targetInvoicesRes.data ?? []) as any[]) {
        const bubbleId = String(row?.bubble_id ?? "").trim();
        const id = String(row?.id ?? "").trim();
        if (bubbleId && id) targetInvoiceByBubbleId.set(bubbleId, { id, fornecedorId: String(row?.fornecedor_id ?? "").trim() });
      }
      const relationalRows: any[] = [];
      for (const sourceRow of itensNotasRows) {
        const raw = sourceRow?.raw_payload_json ?? {};
        const mapped = mapItemNota(raw);
        const bubbleId = String(sourceRow?.bubble_unique_id ?? mapped.bubbleItemNotaId ?? "").trim();
        const invoice = targetInvoiceByBubbleId.get(mapped.bubbleNotaId) ?? null;
        const sourceItemNameKey = String(sourceItemNameByBubbleId.get(mapped.bubbleItemId) ?? "").toLocaleUpperCase("pt-BR");
        const itemId = targetItemIdByBubbleId.get(mapped.bubbleItemId) ?? targetItemIdByName.get(sourceItemNameKey) ?? "";
        if (!bubbleId || !invoice?.id || !itemId) {
          normalizedInvoiceItemsSkipped += 1;
          continue;
        }
        if (!targetItemIdByBubbleId.has(mapped.bubbleItemId)) itemBubbleIdBackfills.set(itemId, mapped.bubbleItemId);
        const rawDate = String((raw as any)?.data_lancamento ?? (raw as any)?.["Created Date"] ?? "").trim();
        relationalRows.push({
          company_id: targetCompanyId,
          bubble_id: bubbleId,
          external_key: null,
          invoice_id: invoice.id,
          item_id: itemId,
          fornecedor_id: invoice.fornecedorId || null,
          data_lancamento: /^\d{4}-\d{2}-\d{2}/.test(rawDate) ? rawDate.slice(0, 10) : null,
          quantidade: parseBubbleNumber((raw as any)?.quantidade),
          custo_unitario: parseBubbleNumber((raw as any)?.custo_unitario),
          subtotal: parseBubbleNumber((raw as any)?.subtotal),
          ocultar_cmv: parseBubbleBool((raw as any)?.ocultar_cmv),
          cadastro_item: parseBubbleBool((raw as any)?.cadastro_Item ?? (raw as any)?.cadastro_item),
          excluivel_detalhes_item: parseBubbleBool((raw as any)?.excluivel_detalhes_item ?? (raw as any)?.["excluível_detalhes_item"]),
          created_by_user_id: userId,
          raw: { bubble: raw, system: { source: "bubble_obj_repair_states" } },
        });
      }
      for (const [itemId, bubbleId] of itemBubbleIdBackfills.entries()) {
        const { error: itemBackfillError } = await supabase.from("items").update({ bubble_id: bubbleId } as any).eq("company_id", targetCompanyId).eq("id", itemId).is("bubble_id", null);
        if (itemBackfillError) throw new Error(itemBackfillError.message);
      }
      for (let offset = 0; offset < relationalRows.length; offset += 500) {
        const chunk = relationalRows.slice(offset, offset + 500);
        const { error: invoiceItemsError } = await supabase.from("invoice_items").upsert(chunk as any, { onConflict: "company_id,bubble_id" } as any);
        if (invoiceItemsError) throw new Error(invoiceItemsError.message);
        normalizedInvoiceItems += chunk.length;
      }
    }

    const motivoNameById: Record<string, string> = {};
    for (const r of motivosRows) {
      const m = mapMotivoDesperdicio(r?.raw_payload_json ?? {});
      if (m.bubbleMotivoId && m.nome) motivoNameById[m.bubbleMotivoId] = m.nome;
    }

    const desperdicioUpserts: any[] = [];
    for (const r of desperdicioRows) {
      const d = mapDesperdicio(r?.raw_payload_json ?? {});
      if (!d.bubbleDesperdicioId) continue;
      const insumoId = d.bubbleItemId ? buildInsumoId(userId, d.bubbleItemId) : "";
      const item = d.bubbleItemId ? String((insumoByBubbleId.get(d.bubbleItemId) as any)?.item ?? "").trim() : "";
      const motivo = d.motivoNome || (d.bubbleMotivoId ? String(motivoNameById[d.bubbleMotivoId] ?? "").trim() : "") || "";
      desperdicioUpserts.push({ id: buildDesperdicioId(userId, d.bubbleDesperdicioId), data: d.data, item: item || d.itemNome || insumoId, quantidade: d.quantidade || "", custo: d.custo || "", motivo } as any);
    }
    if (desperdicioUpserts.length) await supabase.from("desperdicios").upsert(desperdicioUpserts as any, { onConflict: "id" });

    return json(
      {
        ok: true,
        repairedAt: nowIso(),
        userId,
        runId,
        companyId,
        counts: {
          insumos: insumosRows.length,
          fornecedores: Object.keys(fornecedoresInfo).length,
          inventario: inventarioUpserts.length,
          entradas: entradasUpserts.length,
          invoiceItems: normalizedInvoiceItems,
          invoiceItemsSkipped: normalizedInvoiceItemsSkipped,
          desperdicios: desperdicioUpserts.length,
        },
      },
      { status: 200 },
    );
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
