"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import AppSidebar from "../components/AppSidebar";
import LoadingSpinner from "../components/LoadingSpinner";
import SystemToast from "../components/SystemToast";
import dash from "../dashboard/dashboard.module.css";
import { loadEntradasFromSupabase } from "../lib/entradasSupabase";
import { readEntradasFromStore, subscribeEntradas, writeEntradasToStore, type EntradaStoreRow } from "../lib/entradasStore";
import { loadFornecedoresStateFromSupabase } from "../lib/fornecedoresSupabase";
import {
  readFornecedorEquivalenciasMap,
  readFornecedorInfoMap,
  readFornecedorProdutosMap,
  subscribeFornecedorEquivalencias,
  subscribeFornecedorInfo,
  subscribeFornecedorProdutos,
  writeFornecedorEquivalenciasMap,
  writeFornecedorInfoMap,
  writeFornecedorProdutosMap,
  type FornecedorEquivalenciasMap,
  type FornecedorInfoMap,
  type FornecedorProdutos,
} from "../lib/fornecedoresStore";
import { loadInventarioFromSupabase } from "../lib/inventarioSupabase";
import { readInventarioFromStore, subscribeInventario, writeInventarioToStore, type InventarioContagem } from "../lib/inventarioStore";
import { loadInsumosStateFromSupabase } from "../lib/insumosSupabase";
import { readInsumosFromStore, subscribeInsumos, writeInsumosToStore, type InsumoStoreItem } from "../lib/insumosStore";
import { QaModePanel } from "../lib/qaMode";
import styles from "./lista-de-compras.module.css";

type CompraRow = {
  id: string;
  item: string;
  displayItem: string;
  itemMetaLabel: string;
  categoria: string;
  medida: string;
  custoMedio: number;
  custoMedioLabel: string;
  fornecedor: string;
  fornecedores?: string[];
  fornecedorMedida: string;
  fornecedorFator: number;
  consumoDiario: number;
  estoqueFinal: number;
  comprar: number;
};

type CompraTableColumn = "item" | "custoMedio" | "consumoDiario" | "estoqueFinal" | "comprar";

type LatestItemInfo = {
  fornecedor: string;
  timestamp: number;
};

type BubbleListaComprasRow = {
  bubbleListaId: string;
  bubbleItemId: string;
  empresaId: string;
  itemNome: string;
  itemMedida: string;
  qtdSugestao: number;
  qtdCompra: number;
  tipo: string;
};

type CompatListaComprasRow = {
  id: string;
  bubble_id: string | null;
  db_item_id: string;
  itemNome: string;
  categoria: string;
  unidade: string;
  fornecedor: string;
  fornecedores: string[];
  quantidadeSugerida: number;
  quantidadeCompra: number;
  quantidadeReal: number;
  custoMedio: number;
  custoPrevisto: number;
  custoReal: number;
  selected: boolean;
  calc: {
    startInventoryId: string | null;
    endInventoryId: string | null;
    startDate: string | null;
    endDate: string | null;
    diasCorridos: number;
    diasEstoque: number;
    prazoFornecedor: number;
    estoqueInicial: number;
    estoqueAtual: number;
    entradas: number;
    saidas: number;
    consumoDiario: number;
    consumoDiasManter: number;
    consumoPrazoFornecedor: number;
    sugestaoCalc: number;
  };
};

type CompatListaComprasResponse = {
  ok: boolean;
  source: "compat";
  readOnly: boolean;
  banner?: string;
  rows: CompatListaComprasRow[];
  totals?: { itens: number; custoPrevisto: number; custoReal: number };
  filters?: { startInventoryId: string | null; endInventoryId: string | null; diasEstoque: number; prazoFornecedor: number };
  inventories?: Array<{ id: string; bubble_id: string | null; nome: string; data_contagem: string | null }>;
  error?: string;
};

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 20_000);
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function parseMoney(value: string) {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const cleaned = raw.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

function normalizeCategoryName(value: string) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function formatMoney(value: number) {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDecimal3(value: number) {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}

function formatDecimalUpTo3(value: number) {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

function parsePtNumber(input: string) {
  const s = String(input ?? "").replace(/[^\d,.-]/g, "").trim();
  if (!s) return 0;
  const neg = s.includes("-");
  const cleaned = s.replace(/-/g, "");
  const normalized = cleaned.replace(/\./g, "").replace(",", ".");
  const n = Number.parseFloat(normalized);
  if (!Number.isFinite(n)) return 0;
  return neg ? -n : n;
}

function parseDecimalInput(value: string) {
  const normalized = String(value ?? "").replace(/\./g, "").replace(",", ".");
  const num = Number(normalized);
  return Number.isFinite(num) ? num : 0;
}

function parseDateLoose(value: string) {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;

  const monthMap: Record<string, number> = {
    jan: 0,
    fev: 1,
    mar: 2,
    abr: 3,
    mai: 4,
    jun: 5,
    jul: 6,
    ago: 7,
    set: 8,
    out: 9,
    nov: 10,
    dez: 11,
  };

  const normalized = normalizeText(raw).replace(",", "");
  const monthMatch = normalized.match(/^(\d{1,2})\s+([a-z]{3})\s+(\d{4})$/);
  if (monthMatch) {
    const day = Number(monthMatch[1]);
    const month = monthMap[monthMatch[2]];
    const year = Number(monthMatch[3]);
    if (month != null) return new Date(year, month, day).getTime();
  }

  const slashMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const day = Number(slashMatch[1]);
    const month = Number(slashMatch[2]) - 1;
    const year = Number(slashMatch[3]);
    return new Date(year, month, day).getTime();
  }

  const iso = Date.parse(raw);
  return Number.isFinite(iso) ? iso : 0;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function normalizeUnit(value: string) {
  const raw = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z]/g, "")
    .toUpperCase()
    .trim();
  if (!raw) return "";
  if (raw === "UN" || raw === "UND" || raw === "UNID" || raw === "UNIDADE" || raw === "UNIDADES") return "UND";
  if (raw === "G" || raw === "GR" || raw === "GRAMA" || raw === "GRAMAS") return "G";
  if (raw === "KG" || raw === "KILO" || raw === "KILOS" || raw === "KILOGRAMA" || raw === "KILOGRAMAS") return "KG";
  if (raw === "ML" || raw === "MILILITRO" || raw === "MILILITROS") return "ML";
  if (raw === "L" || raw === "LT" || raw === "LITRO" || raw === "LITROS") return "L";
  return raw;
}

function convertUnitQty(qty: number, fromUnit: string, toUnit: string) {
  const from = normalizeUnit(fromUnit);
  const to = normalizeUnit(toUnit);
  if (!qty || !from || !to || from === to) return qty;
  if (from === "G" && to === "KG") return qty / 1000;
  if (from === "KG" && to === "G") return qty * 1000;
  if (from === "ML" && to === "L") return qty / 1000;
  if (from === "L" && to === "ML") return qty * 1000;
  return qty;
}

function parseQtyLabel(input: string) {
  const raw = String(input ?? "").trim();
  if (!raw) return { qty: 0, unit: "" };
  const match = raw.match(/^([0-9.,-]+)\s*([A-Za-zÀ-ÿ]+)?/);
  return { qty: parsePtNumber(match?.[1] ?? raw), unit: normalizeUnit(match?.[2] ?? "") };
}

function buildLatestEntriesIndex(
  entradas: EntradaStoreRow[],
  infoMap: FornecedorInfoMap,
  equivalenciasMap: FornecedorEquivalenciasMap,
  produtosMap: FornecedorProdutos,
) {
  const aliasMap = new Map<string, string>();
  for (const rows of Object.values(equivalenciasMap)) {
    for (const row of rows) {
      const notaKey = normalizeText(row.nomeNaNota);
      const insumoKey = normalizeText(row.insumoEquivalente);
      if (notaKey && insumoKey) aliasMap.set(notaKey, insumoKey);
    }
  }

  for (const [fornecedorKey, itens] of Object.entries(produtosMap)) {
    const fornecedor = infoMap[fornecedorKey]?.fornecedor?.trim() || fornecedorKey;
    for (const item of itens) {
      const itemKey = normalizeText(item);
      if (!itemKey || aliasMap.has(itemKey)) continue;
      aliasMap.set(itemKey, itemKey);
      aliasMap.set(`${fornecedorKey}:${itemKey}`, itemKey);
    }
  }

  const result = new Map<string, LatestItemInfo>();
  for (const entrada of entradas) {
    const timestamp = parseDateLoose(entrada.dataLancamento);
    const fornecedorKey = entrada.fornecedor.trim().toUpperCase();
    const fornecedorLabel = infoMap[fornecedorKey]?.fornecedor?.trim() || entrada.fornecedor.trim() || "-";

    for (const item of entrada.itensNota ?? []) {
      const directKey = normalizeText(item.nome);
      if (!directKey) continue;
      const itemKey = aliasMap.get(directKey) ?? directKey;
      const prev = result.get(itemKey);
      if (prev && prev.timestamp > timestamp) continue;
      result.set(itemKey, { fornecedor: fornecedorLabel, timestamp });
    }
  }

  return result;
}

function buildFornecedorFallbackIndex(
  infoMap: FornecedorInfoMap,
  produtosMap: FornecedorProdutos,
  equivalenciasMap: FornecedorEquivalenciasMap,
) {
  const result = new Map<string, string>();

  for (const [key, items] of Object.entries(produtosMap)) {
    const fornecedor = infoMap[key]?.fornecedor?.trim() || key;
    for (const item of items) {
      const itemKey = normalizeText(item);
      if (!itemKey || result.has(itemKey)) continue;
      result.set(itemKey, fornecedor);
    }
  }

  for (const [key, rows] of Object.entries(equivalenciasMap)) {
    const fornecedor = infoMap[key]?.fornecedor?.trim() || key;
    for (const row of rows) {
      const itemKey = normalizeText(row.insumoEquivalente);
      if (!itemKey || result.has(itemKey)) continue;
      result.set(itemKey, fornecedor);
    }
  }

  return result;
}

function HeaderIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M7.5 4.5H14.25" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M7.5 9H14.25" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M7.5 13.5H14.25" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M3 4.5 4.12 5.62 6 3.75" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 9 4.12 10.12 6 8.25" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M10.5 3a7.5 7.5 0 1 1 4.6 13.4l4.3 4.3-1.4 1.4-4.3-4.3A7.5 7.5 0 0 1 10.5 3Zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Z"
        fill="currentColor"
      />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.25" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 11V16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="12" cy="8" r="1" fill="currentColor" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7.5 4.5V6.25" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M16.5 4.5V6.25" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M4.75 8.5H19.25" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M5.5 5.75H18.5V19H5.5V5.75Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function ExportIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4.75V13.75" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M8.5 10.25L12 13.75L15.5 10.25" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.5 18.5H18.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function SortMark({ dir }: { dir: "asc" | "desc" }) {
  return <span>{dir === "asc" ? "^" : "v"}</span>;
}

export default function ListaDeComprasClient() {
  const searchParams = useSearchParams();
  const userIdOverride = (() => {
    const raw = String(searchParams.get("userId") ?? "").trim();
    return raw && isUuid(raw) ? raw : "";
  })();
  const sourceOverride = (() => {
    const raw = String(searchParams.get("source") ?? "").trim().toLowerCase();
    return raw === "compat" || raw === "legacy" ? raw : "";
  })();
  const [isLoadingTable, setIsLoadingTable] = useState(true);
  const toastTimerRef = useRef<number | null>(null);
  const compatFetchKeyRef = useRef<string>("");
  const [toast, setToast] = useState<{ title: string; message: string; tone: "success" | "error" } | null>(null);
  const [insumos, setInsumos] = useState<InsumoStoreItem[]>([]);
  const [entradas, setEntradas] = useState<EntradaStoreRow[]>([]);
  const [contagens, setContagens] = useState<InventarioContagem[]>([]);
  const [fornecedorInfoMap, setFornecedorInfoMap] = useState<FornecedorInfoMap>({});
  const [fornecedorProdutosMap, setFornecedorProdutosMap] = useState<FornecedorProdutos>({});
  const [fornecedorEquivalenciasMap, setFornecedorEquivalenciasMap] = useState<FornecedorEquivalenciasMap>({});
  const [insumoCategorias, setInsumoCategorias] = useState<string[]>([]);
  const [bubbleListaRows, setBubbleListaRows] = useState<BubbleListaComprasRow[]>([]);
  const [compat, setCompat] = useState<CompatListaComprasResponse | null>(null);
  const [mode, setMode] = useState<"categoria" | "fornecedor">("categoria");
  const [categoriaFilter, setCategoriaFilter] = useState("Categoria");
  const [fornecedorFilter, setFornecedorFilter] = useState("Fornecedor");
  const [query, setQuery] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [diasEstoque, setDiasEstoque] = useState("7");
  const [diasEntrega, setDiasEntrega] = useState("1");

  function parsePositiveInt(value: string, fallback: number) {
    const num = Number(value.replace(/[^\d]/g, ""));
    return Number.isFinite(num) && num > 0 ? num : fallback;
  }

  const diasEstoqueNum = parsePositiveInt(diasEstoque, 7);
  const diasEntregaNum = parsePositiveInt(diasEntrega, 1);
  const [columnOrder, setColumnOrder] = useState<CompraTableColumn[]>(["item", "custoMedio", "consumoDiario", "estoqueFinal", "comprar"]);
  const [draggingColumn, setDraggingColumn] = useState<CompraTableColumn | null>(null);
  const [sortKey, setSortKey] = useState<CompraTableColumn | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const [estoqueFinalMap, setEstoqueFinalMap] = useState<Record<string, string>>({});
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingXlsx, setIsExportingXlsx] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);

  function showToast(message: string, type: "success" | "error", durationMs = 4500) {
    setToast({ title: type === "success" ? "Sucesso" : "Erro", message, tone: type });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, durationMs);
  }

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const unsubs: Array<() => void> = [];

    setIsLoadingTable(true);
    setCompat(null);
    setBubbleListaRows([]);

    void (async () => {
      const qp = userIdOverride ? `&userId=${encodeURIComponent(userIdOverride)}` : "";
      const sp = sourceOverride ? `&source=${encodeURIComponent(sourceOverride)}` : "";
      const res = await fetch(`/api/lista-de-compras?ts=${Date.now()}${qp}${sp}`, { method: "GET", cache: "no-store" }).catch(() => null);
      const json = res ? ((await res.json().catch(() => null)) as any) : null;
      if (cancelled) return;

      const isCompat = Boolean(res?.ok && json?.ok && json?.source === "compat" && Array.isArray(json?.rows));
      if (isCompat) {
        setCompat(json as CompatListaComprasResponse);
        setBubbleListaRows([]);
      }

      const rows = (res?.ok && json?.ok && Array.isArray(json?.rows) ? (json.rows as any[]) : []) as BubbleListaComprasRow[];
      if (!isCompat) setBubbleListaRows(rows);

      setInsumos(readInsumosFromStore());
      setEntradas(readEntradasFromStore([]));
      setContagens(readInventarioFromStore([]));
      let doneInsumos = false;
      let doneFornecedores = false;
      const doneLista = true;
      const finalize = () => {
        if (doneInsumos && doneFornecedores && doneLista) setIsLoadingTable(false);
      };

      void (async () => {
        try {
          const state = await loadInsumosStateFromSupabase(userIdOverride || undefined);
          if (state.rows.length) writeInsumosToStore(state.rows);
          setInsumoCategorias(state.categories ?? []);
        } catch {}
        doneInsumos = true;
        finalize();
      })();

      void (async () => {
        try {
          const db = await loadEntradasFromSupabase(userIdOverride || undefined);
          if (db.length) writeEntradasToStore(db);
        } catch {}
      })();

      void (async () => {
        try {
          const db = await loadInventarioFromSupabase(userIdOverride || undefined);
          if (db.length) writeInventarioToStore(db);
        } catch {}
      })();

      void (async () => {
        let nextInfo: FornecedorInfoMap = {};
        let nextProdutos: FornecedorProdutos = {};
        let nextEq: FornecedorEquivalenciasMap = {};
        try {
          const db = await loadFornecedoresStateFromSupabase(userIdOverride || undefined);
          const hasDb = Object.keys(db.info).length || Object.keys(db.produtos).length || Object.keys(db.equivalencias).length;
          if (hasDb) {
            nextInfo = db.info;
            nextProdutos = db.produtos;
            nextEq = db.equivalencias;
          }
        } catch {}
        writeFornecedorInfoMap(nextInfo);
        writeFornecedorProdutosMap(nextProdutos);
        writeFornecedorEquivalenciasMap(nextEq);
        setFornecedorInfoMap(nextInfo);
        setFornecedorProdutosMap(nextProdutos);
        setFornecedorEquivalenciasMap(nextEq);
        doneFornecedores = true;
        finalize();
      })();

      unsubs.push(subscribeInsumos((rows2) => setInsumos(rows2)));
      unsubs.push(subscribeEntradas((rows2) => setEntradas(rows2)));
      unsubs.push(subscribeInventario((rows2) => setContagens(rows2)));
      unsubs.push(subscribeFornecedorInfo((rows2) => setFornecedorInfoMap(rows2)));
      unsubs.push(subscribeFornecedorProdutos((rows2) => setFornecedorProdutosMap(rows2)));
      unsubs.push(subscribeFornecedorEquivalencias((rows2) => setFornecedorEquivalenciasMap(rows2)));

      finalize();
    })();

    return () => {
      cancelled = true;
      for (const u of unsubs) u();
    };
  }, [userIdOverride]);

  const avgUnitCostCentsById = useMemo(() => {
    const idByKey = new Map<string, string>();
    const insumoById = new Map<string, InsumoStoreItem>();
    for (const item of insumos) {
      const key = normalizeText(item.item);
      if (!key || idByKey.has(key)) continue;
      idByKey.set(key, item.id);
      insumoById.set(item.id, item);
    }
    const fornecedorKeyLookup = new Map<string, string>();
    for (const key of Object.keys(fornecedorEquivalenciasMap)) {
      const nk = normalizeText(key);
      if (!nk || fornecedorKeyLookup.has(nk)) continue;
      fornecedorKeyLookup.set(nk, key);
    }
    const qtyById = new Map<string, number>();
    const centsById = new Map<string, number>();
    for (const entrada of entradas) {
      const fornecedorKey = fornecedorKeyLookup.get(normalizeText(entrada.fornecedor)) ?? entrada.fornecedor.trim().toUpperCase();
      const equivalencias = fornecedorEquivalenciasMap[fornecedorKey] ?? [];
      for (const item of entrada.itensNota ?? []) {
        const rawKey = normalizeText(item.nome);
        let mappedKey = rawKey;
        let fator = 1;
        const eq = equivalencias.find((m) => normalizeText(m.nomeNaNota) === rawKey) ?? null;
        if (eq) {
          mappedKey = normalizeText(eq.insumoEquivalente);
          const f = parsePtNumber(String(eq.equivalenteQuantidade ?? ""));
          if (Number.isFinite(f) && f > 0) fator = f;
        }
        const id = idByKey.get(mappedKey);
        if (!id) continue;
        const insumoUnit = insumoById.get(id)?.medida ?? "";
        const parsed = parseQtyLabel(item.quantidadeLabel ?? "");
        const qtyNota = parsed.qty;
        const qtyEq = eq
          ? qtyNota * fator
          : convertUnitQty(qtyNota, parsed.unit || insumoUnit, insumoUnit);
        if (!Number.isFinite(qtyEq) || qtyEq <= 0) continue;
        let sub = Math.round(parseMoney(item.subtotalLabel ?? "") * 100);
        if (!sub) {
          const unitCents = Math.round(parseMoney(item.custoUnitarioLabel ?? "") * 100);
          if (unitCents && qtyNota > 0) sub = Math.round(unitCents * qtyNota);
        }
        if (!sub) continue;
        qtyById.set(id, (qtyById.get(id) ?? 0) + qtyEq);
        centsById.set(id, (centsById.get(id) ?? 0) + sub);
      }
    }
    const out = new Map<string, number>();
    for (const [id, qty] of qtyById.entries()) {
      const cents = centsById.get(id) ?? 0;
      if (!qty || !cents) continue;
      out.set(id, Math.round(cents / qty));
    }
    return out;
  }, [entradas, fornecedorEquivalenciasMap, insumos]);

  const latestEntriesIndex = useMemo(() => {
    return buildLatestEntriesIndex(entradas, fornecedorInfoMap, fornecedorEquivalenciasMap, fornecedorProdutosMap);
  }, [entradas, fornecedorEquivalenciasMap, fornecedorInfoMap, fornecedorProdutosMap]);

  const fornecedorFallbackIndex = useMemo(() => {
    return buildFornecedorFallbackIndex(fornecedorInfoMap, fornecedorProdutosMap, fornecedorEquivalenciasMap);
  }, [fornecedorEquivalenciasMap, fornecedorInfoMap, fornecedorProdutosMap]);

  const baseRows = useMemo(() => {
    if (compat?.source === "compat" && Array.isArray(compat.rows)) {
      return compat.rows.map((r) => {
        const itemName = String(r.itemNome ?? "").trim() || "Item";
        const categoria = String(r.categoria ?? "").trim() || "-";
        const medida = String(r.unidade ?? "").trim() || "Und";
        const custoMedioValue = Number(r.custoMedio ?? 0) || 0;
        const fornecedorLabel = String(r.fornecedor ?? "-").trim() || "-";
        const fornecedores = Array.isArray(r.fornecedores)
          ? (r.fornecedores as any[])
              .map((x) => String(x ?? "").trim())
              .filter(Boolean)
              .filter((x) => x !== "-")
          : [];
        return {
          id: String(r.id),
          item: itemName,
          displayItem: itemName,
          itemMetaLabel: `${categoria}${fornecedorLabel && fornecedorLabel !== "-" ? ` • ${fornecedorLabel}` : ""}`,
          categoria,
          medida,
          custoMedio: custoMedioValue,
          custoMedioLabel: formatMoney(custoMedioValue),
          fornecedor: fornecedorLabel,
          fornecedores,
          fornecedorMedida: medida,
          fornecedorFator: 1,
          consumoDiario: Number(r.calc?.consumoDiario ?? 0) || 0,
          estoqueFinal: Number(r.calc?.estoqueAtual ?? 0) || 0,
          comprar: Number(r.quantidadeCompra ?? 0) || 0,
        } satisfies CompraRow;
      });
    }
    const contagemByIso = new Map<string, InventarioContagem>();
    const contagemOptions: Array<{ iso: string; t: number }> = [];
    const scoreContagem = (inv: InventarioContagem) => {
      let s = 0;
      for (const cat of inv.categorias ?? []) {
        for (const it of cat.itens ?? []) {
          if ((it as any)?.removido) continue;
          const raw = String((it as any)?.estoqueFinal ?? "").trim();
          if (!raw) continue;
          const n = parsePtNumber(raw);
          if (n > 0) s += 2;
          else s += 1;
        }
      }
      return s;
    };
    for (const c of contagens) {
      const t = parseDateLoose(c.data);
      if (!t) continue;
      const date = new Date(t);
      const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      const prev = contagemByIso.get(iso) ?? null;
      if (!prev) contagemByIso.set(iso, c);
      else if (scoreContagem(c) > scoreContagem(prev)) contagemByIso.set(iso, c);
      contagemOptions.push({ iso, t });
    }

    contagemOptions.sort((a, b) => b.t - a.t);
    const availableIsos = new Set(contagemOptions.map((x) => x.iso));
    const endIso = (endDate && availableIsos.has(endDate) ? endDate : contagemOptions[0]?.iso) ?? "";
    const startIso = (startDate && availableIsos.has(startDate) ? startDate : contagemOptions[contagemOptions.length - 1]?.iso) ?? endIso;

    const startContagem = startIso ? contagemByIso.get(startIso) ?? null : null;
    const endContagem = endIso ? contagemByIso.get(endIso) ?? null : null;

    const sumInventory = (inv: InventarioContagem | null) => {
      const out = new Map<string, { qty: number; unit: string }>();
      if (!inv) return out;
      for (const cat of inv.categorias ?? []) {
        for (const it of cat.itens ?? []) {
          if (it.removido) continue;
          const key = normalizeText(it.item);
          if (!key) continue;
          const qty = parsePtNumber(String(it.estoqueFinal ?? ""));
          const unit = normalizeUnit(String(it.unidade ?? ""));
          const cur = out.get(key);
          out.set(key, { qty: (cur?.qty ?? 0) + qty, unit: cur?.unit || unit });
        }
      }
      return out;
    };

    const estoqueInicialByKey = sumInventory(startContagem);
    const estoqueFinalByKey = sumInventory(endContagem);

    const startT = startIso ? Date.parse(startIso) : NaN;
    const endT = endIso ? Date.parse(endIso) : NaN;
    const diasCorridos = Number.isFinite(startT) && Number.isFinite(endT) ? Math.max(Math.round((endT - startT) / 86_400_000), 0) : 0;

    const entradasByKey = new Map<string, { qty: number; unit: string }>();
    for (const entrada of entradas) {
      const t = parseDateLoose(entrada.dataLancamento);
      if (!t) continue;
      if (Number.isFinite(startT) && t < startT) continue;
      if (Number.isFinite(endT) && t > endT + 86_399_000) continue;
      for (const item of entrada.itensNota ?? []) {
        const key = normalizeText(item.nome);
        if (!key) continue;
        const parsed = parseQtyLabel(item.quantidadeLabel);
        if (!parsed.qty) continue;
        const cur = entradasByKey.get(key);
        entradasByKey.set(key, { qty: (cur?.qty ?? 0) + parsed.qty, unit: cur?.unit || parsed.unit });
      }
    }

    const rows: CompraRow[] = [];
    for (const ins of insumos) {
      const itemName = String(ins.item ?? "").trim() || "Item";
      const key = normalizeText(itemName);
      if (!key) continue;

      const medida = String(ins.medida ?? "").trim() || "Und";
      const categoria = String(ins.categoria ?? "").trim() || "-";
      const custoMedioValue = parseMoney(String(ins.custoMedio ?? ""));

      const startInv = estoqueInicialByKey.get(key);
      const endInv = estoqueFinalByKey.get(key);
      const entradasAgg = entradasByKey.get(key);

      const estoqueInicial = startInv ? convertUnitQty(startInv.qty, startInv.unit, medida) : 0;
      const estoqueFinal = endInv ? convertUnitQty(endInv.qty, endInv.unit, medida) : 0;
      const entradasQty = entradasAgg ? convertUnitQty(entradasAgg.qty, entradasAgg.unit, medida) : 0;

      const saidas = estoqueInicial + (entradasQty - estoqueFinal);
      const consumoDiario = diasCorridos > 0 ? Math.max(saidas / diasCorridos, 0) : 0;

      const fornecedorFromLatest = key ? latestEntriesIndex.get(key)?.fornecedor ?? "" : "";
      const fornecedorFromFallback = key ? fornecedorFallbackIndex.get(key) ?? "" : "";
      const fornecedorCandidate = String(fornecedorFromLatest || fornecedorFromFallback || "-").trim() || "-";
      const fornecedorLabel = normalizeText(fornecedorCandidate) === "sem fornecedor" ? "-" : fornecedorCandidate;

      rows.push({
        id: String(ins.id),
        item: itemName,
        displayItem: itemName,
        itemMetaLabel: `${categoria}${fornecedorLabel && fornecedorLabel !== "-" ? ` • ${fornecedorLabel}` : ""}`,
        categoria,
        medida,
        custoMedio: custoMedioValue,
        custoMedioLabel: formatMoney(custoMedioValue),
        fornecedor: fornecedorLabel,
        fornecedorMedida: medida,
        fornecedorFator: 1,
        consumoDiario,
        estoqueFinal,
        comprar: 0,
      });
    }
    rows.sort((a, b) => a.item.localeCompare(b.item, "pt-BR", { sensitivity: "base", numeric: true }));
    return rows;
  }, [compat, contagens, endDate, entradas, fornecedorFallbackIndex, insumos, latestEntriesIndex, startDate]);

  useEffect(() => {
    if (compat?.source === "compat") return;
    setEstoqueFinalMap((prev) => {
      if (Object.keys(prev).length) return prev;
      const next: Record<string, string> = { ...prev };
      for (const row of baseRows) next[row.id] = formatDecimal3(row.estoqueFinal);
      return next;
    });
  }, [baseRows, compat]);

  const categorias = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    const push = (raw: string) => {
      const name = normalizeCategoryName(raw);
      if (!name || name === "-") return;
      const key = name.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(name);
    };

    if (compat?.source === "compat" && Array.isArray(compat.rows)) {
      for (const r of compat.rows) push(String(r.categoria ?? ""));
    } else {
      for (const c of insumoCategorias) push(c);
      for (const i of insumos) push(i.categoria ?? "");
    }

    out.sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));
    return ["Categoria", ...out];
  }, [compat, insumoCategorias, insumos]);

  const fornecedores = useMemo(() => {
    if (compat?.source === "compat" && Array.isArray(compat.rows)) {
      const labels = new Set<string>();
      for (const r of compat.rows) {
        const primary = String(r.fornecedor ?? "").trim();
        if (primary && primary !== "-") labels.add(primary);
        for (const s of r.fornecedores ?? []) {
          const v = String(s ?? "").trim();
          if (v) labels.add(v);
        }
      }
      const list = Array.from(labels).sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));
      return ["Fornecedor", ...list];
    }

    const labels = new Set<string>();
    for (const [key, info] of Object.entries(fornecedorInfoMap)) {
      const label = info.fornecedor.trim();
      if (!label) continue;
      if (normalizeText(label) === "sem fornecedor") continue;
      labels.add(label);
    }
    const list = Array.from(labels).sort((a, b) => a.localeCompare(b, "pt-BR"));
    return ["Fornecedor", ...list];
  }, [compat, fornecedorEquivalenciasMap, fornecedorInfoMap, fornecedorProdutosMap]);

  const inventoryOptions = useMemo(() => {
    const out: Array<{ value: string; iso: string; label: string; t: number }> = [];

    if (compat?.source === "compat" && Array.isArray(compat.inventories)) {
      const seenIso = new Set<string>();
      for (const inv of compat.inventories) {
        const id = String(inv?.id ?? "").trim();
        const d = String(inv?.data_contagem ?? "").trim();
        if (!id || !d) continue;
        const t = Date.parse(d);
        if (!Number.isFinite(t)) continue;
        const date = new Date(t);
        const y = date.getUTCFullYear();
        const m = date.getUTCMonth() + 1;
        const day = date.getUTCDate();
        const iso = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        if (seenIso.has(iso)) continue;
        seenIso.add(iso);
        const label = `${String(day).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
        out.push({ value: id, iso, label, t });
      }
      out.sort((a, b) => b.t - a.t);
      return out;
    }

    for (const c of contagens) {
      const t = parseDateLoose(c.data);
      if (!t) continue;
      const date = new Date(t);
      const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      out.push({ value: iso, iso, label: c.data, t });
    }
    out.sort((a, b) => b.t - a.t);
    const seen = new Set<string>();
    return out.filter((option) => {
      if (seen.has(option.iso)) return false;
      seen.add(option.iso);
      return true;
    });
  }, [compat, contagens]);

  const periodOptions = useMemo(() => [...inventoryOptions].sort((a, b) => b.t - a.t), [inventoryOptions]);

  const selectedStartOption = periodOptions.find((o) => o.value === startDate) ?? periodOptions[periodOptions.length - 1] ?? null;
  const selectedEndOption = periodOptions.find((o) => o.value === endDate) ?? periodOptions[0] ?? null;

  const effectiveStartDate = selectedStartOption?.iso ?? "";
  const effectiveEndDate = selectedEndOption?.iso ?? "";

  useEffect(() => {
    if (!periodOptions.length) return;
    if (compat?.source === "compat") {
      const filters = compat.filters;
      if (filters) {
        const fallbackStart =
          filters.startInventoryId && periodOptions.some((o) => o.value === filters.startInventoryId)
            ? filters.startInventoryId
            : periodOptions[periodOptions.length - 1]!.value;
        const fallbackEnd =
          filters.endInventoryId && periodOptions.some((o) => o.value === filters.endInventoryId) ? filters.endInventoryId : periodOptions[0]!.value;
      setStartDate((prev) => (periodOptions.some((o) => o.value === prev) ? prev : fallbackStart));
      setEndDate((prev) => (periodOptions.some((o) => o.value === prev) ? prev : fallbackEnd));
      return;
      }
    }
    setStartDate((prev) => (periodOptions.some((o) => o.value === prev) ? prev : periodOptions[periodOptions.length - 1]!.value));
    setEndDate((prev) => (periodOptions.some((o) => o.value === prev) ? prev : periodOptions[0]!.value));
  }, [compat, periodOptions]);

  useEffect(() => {
    if (compat?.source !== "compat") return;
    if (!startDate || !endDate) return;

    const startInventoryId = startDate;
    const endInventoryId = endDate;
    const desiredKey = `start=${startInventoryId}&end=${endInventoryId}&dias=${diasEstoqueNum}&prazo=${diasEntregaNum}`;
    if (compatFetchKeyRef.current === desiredKey) return;

    const current = compat.filters;
    if (
      current &&
      current.startInventoryId === startInventoryId &&
      current.endInventoryId === endInventoryId &&
      current.diasEstoque === diasEstoqueNum &&
      current.prazoFornecedor === diasEntregaNum
    ) {
      compatFetchKeyRef.current = desiredKey;
      return;
    }

    let cancelled = false;
    compatFetchKeyRef.current = desiredKey;
    setIsLoadingTable(true);

    void (async () => {
      const qp = userIdOverride ? `&userId=${encodeURIComponent(userIdOverride)}` : "";
      const sp = sourceOverride ? `&source=${encodeURIComponent(sourceOverride)}` : "";
      const url = `/api/lista-de-compras?ts=${Date.now()}${qp}${sp}&startInventoryId=${encodeURIComponent(startInventoryId)}&endInventoryId=${encodeURIComponent(
        endInventoryId,
      )}&diasEstoque=${encodeURIComponent(String(diasEstoqueNum))}&prazoFornecedor=${encodeURIComponent(String(diasEntregaNum))}`;
      const res = await fetch(url, { method: "GET", cache: "no-store" }).catch(() => null);
      const json = res ? ((await res.json().catch(() => null)) as any) : null;
      if (cancelled) return;
      if (res?.ok && json?.ok && json?.source === "compat" && Array.isArray(json?.rows)) {
        setCompat(json as CompatListaComprasResponse);
      } else if (json?.error) {
        showToast(String(json.error), "error", 8000);
      }
      setIsLoadingTable(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [compat, diasEntregaNum, diasEstoqueNum, endDate, startDate, userIdOverride]);

  const rows = useMemo(() => {
    const search = query.trim().toLowerCase();
    const mapped = baseRows.filter((row) => {
      if (mode === "categoria" && categoriaFilter !== "Categoria" && row.categoria !== categoriaFilter) return false;
      if (mode === "fornecedor" && fornecedorFilter !== "Fornecedor") {
        const extra = Array.isArray(row.fornecedores) ? row.fornecedores : [];
        if (row.fornecedor !== fornecedorFilter && !extra.includes(fornecedorFilter)) return false;
      }
      if (!search) return true;
      const suppliers = [row.fornecedor, ...(Array.isArray(row.fornecedores) ? row.fornecedores : [])].join(" ");
      return `${row.displayItem} ${row.item} ${row.categoria} ${suppliers}`.toLowerCase().includes(search);
    });

    const decorated = mapped.map((row, index) => ({ row, index }));
    const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });
    decorated.sort((a, b) => {
      if (sortKey) {
        let cmp = 0;
        switch (sortKey) {
          case "item":
            cmp = collator.compare(mode === "fornecedor" ? a.row.displayItem : a.row.item, mode === "fornecedor" ? b.row.displayItem : b.row.item);
            break;
          case "custoMedio":
            cmp =
              mode === "fornecedor"
                ? a.row.custoMedio * a.row.fornecedorFator - b.row.custoMedio * b.row.fornecedorFator
                : a.row.custoMedio - b.row.custoMedio;
            break;
          case "consumoDiario":
            cmp =
              mode === "fornecedor"
                ? a.row.consumoDiario / a.row.fornecedorFator - b.row.consumoDiario / b.row.fornecedorFator
                : a.row.consumoDiario - b.row.consumoDiario;
            break;
          case "estoqueFinal": {
            const aValue = parseDecimalInput(estoqueFinalMap[a.row.id] ?? "0,000");
            const bValue = parseDecimalInput(estoqueFinalMap[b.row.id] ?? "0,000");
            cmp = aValue - bValue;
            break;
          }
          case "comprar": {
            const aFactor = mode === "fornecedor" ? (a.row.fornecedorFator > 0 ? a.row.fornecedorFator : 1) : 1;
            const bFactor = mode === "fornecedor" ? (b.row.fornecedorFator > 0 ? b.row.fornecedorFator : 1) : 1;
            const aValue = a.row.comprar / aFactor;
            const bValue = b.row.comprar / bFactor;
            cmp = aValue - bValue;
            break;
          }
        }
        if (cmp) return cmp * (sortDir === "asc" ? 1 : -1);
      }
      if (mode === "fornecedor") {
        const byFornecedor = a.row.fornecedor.localeCompare(b.row.fornecedor, "pt-BR");
        if (byFornecedor !== 0) return byFornecedor;
      } else {
        const byCategoria = a.row.categoria.localeCompare(b.row.categoria, "pt-BR");
        if (byCategoria !== 0) return byCategoria;
      }
      const byItem = a.row.item.localeCompare(b.row.item, "pt-BR");
      if (byItem !== 0) return byItem;
      return a.index - b.index;
    });

    return decorated.map((entry) => entry.row);
  }, [baseRows, categoriaFilter, diasEntrega, diasEstoque, estoqueFinalMap, fornecedorFilter, mode, query, sortDir, sortKey]);

  const PAGE_SIZE = 12;
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePageIndex = Math.max(0, Math.min(pageIndex, totalPages - 1));
  const pageRows = useMemo(() => {
    const start = safePageIndex * PAGE_SIZE;
    return rows.slice(start, start + PAGE_SIZE);
  }, [rows, safePageIndex]);

  useEffect(() => {
    setPageIndex(0);
  }, [mode, categoriaFilter, fornecedorFilter, query, startDate, endDate]);

  useEffect(() => {
    if (pageIndex !== safePageIndex) setPageIndex(safePageIndex);
  }, [pageIndex, safePageIndex]);

  const allVisibleSelected = pageRows.length > 0 && pageRows.every((row) => selectedIds[row.id]);
  const isPeriodReady = inventoryOptions.length > 0 && Boolean(selectedStartOption) && Boolean(selectedEndOption);

  const hasAnySelected = useMemo(() => {
    for (const row of rows) {
      if (selectedIds[row.id]) return true;
    }
    return false;
  }, [rows, selectedIds]);

  const exportRows = useMemo(() => {
    return hasAnySelected ? rows.filter((row) => Boolean(selectedIds[row.id])) : rows;
  }, [hasAnySelected, rows, selectedIds]);

  const canExport = isPeriodReady && rows.length > 0;
  const exportDisabled = !canExport || isExportingPdf || isExportingXlsx;

  function computeCompra(row: CompraRow) {
    const fornecedorFactor = row.fornecedorFator > 0 ? row.fornecedorFator : 1;
    const comprarCalculado = Math.max(row.comprar, 0);
    const compraFornecedor = comprarCalculado / fornecedorFactor;
    return {
      estoqueFinalNum: 0,
      comprarCalculado,
      compraFornecedor,
      unidadeComprar: mode === "fornecedor" ? row.fornecedorMedida : row.medida,
      unidadeInsumo: row.medida,
    };
  }

  async function downloadListaXlsx() {
    if (!canExport || exportDisabled) return;
    setIsExportingXlsx(true);
    try {
      const XLSX = await import("xlsx");
      const header =
        mode === "fornecedor"
          ? ["Item", "Qtd Comprar", "Unidade", "Qtd Insumo", "Unidade Insumo", "Categoria", "Custo Médio (Insumo)"]
          : ["Item", "Categoria", "Qtd Comprar", "Unidade", "Custo Médio"];
      const table = [
        header,
        ...exportRows.map((row) => {
          const calc = computeCompra(row);
          if (mode === "fornecedor") {
            return [
              row.displayItem,
              Number(calc.compraFornecedor.toFixed(3)),
              calc.unidadeComprar,
              Number(calc.comprarCalculado.toFixed(3)),
              calc.unidadeInsumo,
              row.categoria,
              row.custoMedioLabel,
            ];
          }
          return [
            row.displayItem,
            row.categoria,
            Number(calc.comprarCalculado.toFixed(3)),
            calc.unidadeComprar,
            row.custoMedioLabel,
          ];
        }),
      ];
      const ws = XLSX.utils.aoa_to_sheet(table);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Lista");
      const array = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
      downloadBlob(new Blob([array], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `lista-de-compras-${effectiveStartDate}-ate-${effectiveEndDate}.xlsx`);
    } finally {
      setIsExportingXlsx(false);
    }
  }

  async function downloadListaPdf() {
    if (!canExport || exportDisabled) return;
    setIsExportingPdf(true);
    const previewTab = window.open("", "_blank");
    if (previewTab) {
      previewTab.document.title = "Gerando PDF...";
      previewTab.document.body.innerText = "Gerando PDF da Lista de Compras. Aguarde...";
    }
    try {
      const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

      const pageSize: [number, number] = [595.28, 841.89];
      const margin = 40;
      const rowH = 34;

      function safePdfText(text: string) {
        const raw = String(text ?? "");
        const replaced = raw
          .replaceAll("✓", "V")
          .replaceAll("✔", "V")
          .replaceAll("√", "V")
          .replaceAll("•", "-")
          .replaceAll("–", "-")
          .replaceAll("—", "-")
          .replaceAll("“", '"')
          .replaceAll("”", '"')
          .replaceAll("‘", "'")
          .replaceAll("’", "'")
          .replaceAll("…", "...")
          .replace(/[^\u0000-\u00FF]/g, "");
        return replaced;
      }

      function clipText(text: string, maxWidth: number, size: number) {
        const raw = safePdfText(text);
        if (font.widthOfTextAtSize(raw, size) <= maxWidth) return raw;
        let out = raw;
        while (out.length > 1 && font.widthOfTextAtSize(`${out}...`, size) > maxWidth) out = out.slice(0, -1);
        return `${out}...`;
      }

      let page = doc.addPage(pageSize);
      let y = pageSize[1] - margin;

      function drawHeader() {
        const title =
          mode === "fornecedor" && fornecedorFilter !== "Fornecedor" ? `Lista de Compras - ${fornecedorFilter}` : "Lista de Compras";
        const now = new Date();
        const meta = `Período: ${effectiveStartDate || "-"} até ${effectiveEndDate || "-"} - Gerado em ${now.toLocaleDateString("pt-BR")} ${now.toLocaleTimeString(
          "pt-BR",
          { hour: "2-digit", minute: "2-digit" },
        )}`;
        page.drawText(safePdfText(title), { x: margin, y, size: 16, font: fontBold, color: rgb(0.01, 0.01, 0.01) });
        y -= 18;
        page.drawText(safePdfText(meta), { x: margin, y, size: 10, font, color: rgb(0.3, 0.3, 0.3) });
        y -= 18;

        const tableW = pageSize[0] - margin * 2;
        const checkW = 18;
        const gridW = tableW - checkW;
        const frTotal = 4.8;
        const colItem = gridW * (1.8 / frTotal);
        const colCusto = gridW * (0.7 / frTotal);
        const colConsumo = gridW * (0.7 / frTotal);
        const colEstoque = gridW * (0.8 / frTotal);
        const colComprar = gridW * (0.8 / frTotal);

        page.drawRectangle({ x: margin, y: y - 14, width: tableW, height: 20, color: rgb(0, 0.157, 0.176) });
        page.drawText("V", { x: margin + 6, y: y - 10, size: 10, font: fontBold, color: rgb(1, 1, 1) });
        page.drawText("Item", { x: margin + checkW + 8, y: y - 10, size: 10, font: fontBold, color: rgb(1, 1, 1) });
        page.drawText("Custo Médio", { x: margin + checkW + colItem + 8, y: y - 10, size: 10, font: fontBold, color: rgb(1, 1, 1) });
        page.drawText("Consumo", { x: margin + checkW + colItem + colCusto + 8, y: y - 10, size: 10, font: fontBold, color: rgb(1, 1, 1) });
        page.drawText("Estoque", { x: margin + checkW + colItem + colCusto + colConsumo + 8, y: y - 10, size: 10, font: fontBold, color: rgb(1, 1, 1) });
        page.drawText("Comprar", { x: margin + checkW + colItem + colCusto + colConsumo + colEstoque + 8, y: y - 10, size: 10, font: fontBold, color: rgb(1, 1, 1) });
        y -= 28;

        return { tableW, checkW, colItem, colCusto, colConsumo, colEstoque, colComprar };
      }

      let cols = drawHeader();
      const fontSize = 10;
      const subFontSize = 9;

      for (const row of exportRows) {
        if (y < margin + 40) {
          page = doc.addPage(pageSize);
          y = pageSize[1] - margin;
          cols = drawHeader();
        }

        const calc = computeCompra(row);
        const fornecedorFactor = row.fornecedorFator > 0 ? row.fornecedorFator : 1;
        const consumo = mode === "fornecedor" ? row.consumoDiario / fornecedorFactor : row.consumoDiario;
        const consumoUnit = mode === "fornecedor" ? row.fornecedorMedida : row.medida;
        const custoFornecedor = row.custoMedio * fornecedorFactor;
        const custoMain = mode === "fornecedor" ? formatMoney(custoFornecedor) : row.custoMedioLabel;
        const custoSub = mode === "fornecedor" ? row.custoMedioLabel : "";
        const estoqueFinalValue = estoqueFinalMap[row.id] ?? "0,000";
        const comprar = mode === "fornecedor" ? calc.compraFornecedor : calc.comprarCalculado;
        const comprarLabel = `${formatDecimalUpTo3(comprar)} ${calc.unidadeComprar}`.trim();

        page.drawRectangle({ x: margin + 3, y: y - 2, width: 12, height: 12, borderWidth: 1, borderColor: rgb(0.88, 0.9, 0.9) });

        const itemLabel = clipText(row.displayItem, cols.colItem - 12, fontSize);
        const metaLabel = clipText(row.itemMetaLabel, cols.colItem - 12, subFontSize);
        page.drawText(itemLabel, { x: margin + cols.checkW + 8, y, size: fontSize, font: fontBold, color: rgb(0.12, 0.12, 0.12) });
        page.drawText(metaLabel, { x: margin + cols.checkW + 8, y: y - 12, size: subFontSize, font, color: rgb(0.43, 0.5, 0.49) });

        const custoLabel = clipText(custoMain, cols.colCusto - 12, fontSize);
        page.drawText(custoLabel, { x: margin + cols.checkW + cols.colItem + 8, y, size: fontSize, font: fontBold, color: rgb(0.12, 0.12, 0.12) });
        if (custoSub) {
          const sub = clipText(custoSub, cols.colCusto - 12, subFontSize);
          page.drawText(sub, { x: margin + cols.checkW + cols.colItem + 8, y: y - 12, size: subFontSize, font, color: rgb(0.43, 0.5, 0.49) });
        }

        page.drawText(clipText(`${formatDecimalUpTo3(consumo)} ${consumoUnit}`, cols.colConsumo - 12, fontSize), {
          x: margin + cols.checkW + cols.colItem + cols.colCusto + 8,
          y,
          size: fontSize,
          font,
          color: rgb(0.12, 0.12, 0.12),
        });

        page.drawText(clipText(`${estoqueFinalValue} ${row.medida}`, cols.colEstoque - 12, fontSize), {
          x: margin + cols.checkW + cols.colItem + cols.colCusto + cols.colConsumo + 8,
          y,
          size: fontSize,
          font,
          color: rgb(0.12, 0.12, 0.12),
        });

        page.drawText(clipText(comprarLabel, cols.colComprar - 12, fontSize), {
          x: margin + cols.checkW + cols.colItem + cols.colCusto + cols.colConsumo + cols.colEstoque + 8,
          y,
          size: fontSize,
          font,
          color: rgb(0.12, 0.12, 0.12),
        });

        y -= rowH;
      }

      const bytes = await doc.save();
      const suffix = mode === "fornecedor" && fornecedorFilter !== "Fornecedor" ? `-${fornecedorFilter.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}` : "";
      const filename = `lista-de-compras${suffix}-${effectiveStartDate}-ate-${effectiveEndDate}.pdf`;
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      if (previewTab) {
        previewTab.location.href = url;
      } else {
        downloadBlob(blob, filename);
      }
      showToast("PDF gerado.", "success");
      window.setTimeout(() => URL.revokeObjectURL(url), 20_000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err ?? "");
      showToast(`Não foi possível gerar o PDF (${msg || "erro"}).`, "error", 8000);
      if (previewTab) {
        previewTab.document.title = "Erro ao gerar PDF";
        previewTab.document.body.innerText = "Não foi possível gerar o PDF da Lista de Compras. Tente novamente.";
      }
    } finally {
      setIsExportingPdf(false);
    }
  }

  function toggleSelectAll() {
    if (isReadOnly) return;
    setSelectedIds((prev) => {
      const next = { ...prev };
      if (allVisibleSelected) {
        for (const row of pageRows) delete next[row.id];
      } else {
        for (const row of pageRows) next[row.id] = true;
      }
      return next;
    });
  }

  function toggleRow(id: string) {
    if (isReadOnly) return;
    setSelectedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function toggleSort(key: CompraTableColumn) {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
      return;
    }
    if (sortDir === "asc") {
      setSortDir("desc");
      return;
    }
    setSortKey(null);
    setSortDir("asc");
  }

  function onColumnDrop(target: CompraTableColumn) {
    if (!draggingColumn || draggingColumn === target) return;
    setColumnOrder((prev) => {
      const from = prev.indexOf(draggingColumn);
      const to = prev.indexOf(target);
      if (from === -1 || to === -1) return prev;
      const next = [...prev];
      next.splice(from, 1);
      next.splice(to, 0, draggingColumn);
      return next;
    });
    setDraggingColumn(null);
  }

  const gridTemplateColumns = ["38px", ...columnOrder.map((column) => {
    switch (column) {
      case "item":
        return "minmax(260px, 1.8fr)";
      case "custoMedio":
        return "minmax(90px, 0.7fr)";
      case "consumoDiario":
        return "minmax(96px, 0.7fr)";
      case "estoqueFinal":
      case "comprar":
        return "minmax(114px, 0.8fr)";
    }
  })].join(" ");

  function updateEstoqueFinal(id: string, value: string) {
    if (isReadOnly) return;
    const cleaned = value.replace(/[^\d,]/g, "");
    setEstoqueFinalMap((prev) => ({ ...prev, [id]: cleaned }));
  }
  const isCompatMode = compat?.source === "compat";
  const isReadOnly = Boolean(isCompatMode && compat?.readOnly);

  const qaUi = useMemo(() => {
    const renderedRows = rows.map((row) => {
      const fornecedorFactor = row.fornecedorFator > 0 ? row.fornecedorFator : 1;
      const consumoFornecedor = row.consumoDiario / fornecedorFactor;
      const custoFornecedor = row.custoMedio * fornecedorFactor;
      const estoqueFinalValue = isCompatMode ? formatDecimal3(row.estoqueFinal) : estoqueFinalMap[row.id] ?? "0,000";
      const comprarValue = (() => {
        if (isCompatMode) {
          const base = mode === "fornecedor" ? row.comprar / fornecedorFactor : row.comprar;
          return formatDecimalUpTo3(Number.isFinite(base) ? base : 0);
        }
        const estoqueFinalNum = parseDecimalInput(estoqueFinalValue);
        const demanda = row.consumoDiario * (diasEstoqueNum + diasEntregaNum);
        const comprarCalculado = Math.max(demanda - estoqueFinalNum, 0);
        const compraFornecedor = comprarCalculado / fornecedorFactor;
        return formatDecimalUpTo3(mode === "fornecedor" ? compraFornecedor : comprarCalculado);
      })();
      const consumoValue = mode === "fornecedor" ? consumoFornecedor : row.consumoDiario;
      const custoValue = mode === "fornecedor" ? custoFornecedor : row.custoMedio;
      return {
        id: row.id,
        displayItem: row.displayItem,
        itemMetaLabel: row.itemMetaLabel,
        categoria: row.categoria,
        fornecedor: row.fornecedor,
        medida: row.medida,
        custoMedio: row.custoMedio,
        custoMedioLabel: `R$${(custoValue || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        consumoDiarioValue: Number.isFinite(consumoValue) ? consumoValue : 0,
        estoqueFinalInput: estoqueFinalValue,
        estoqueFinalValue: row.estoqueFinal,
        comprarValue,
        selected: Boolean(selectedIds[row.id]),
        source: isCompatMode ? "compat" : "legacy",
      };
    });

    return {
      source: { mode: isCompatMode ? "compat" : "legacy", bubbleListaRowsCount: bubbleListaRows.length, baseRowsCount: baseRows.length, compatRowsCount: compat?.rows?.length ?? 0 },
      filters: { mode, categoriaFilter, fornecedorFilter, query, startDate: effectiveStartDate, endDate: effectiveEndDate, diasEstoque: diasEstoqueNum, diasEntrega: diasEntregaNum },
      sort: { sortKey, sortDir, columnOrder },
      selection: { selectedCount: Object.values(selectedIds).filter(Boolean).length, allVisibleSelected },
      rendered: { rowCount: rows.length, rows: renderedRows },
    };
  }, [
    allVisibleSelected,
    baseRows.length,
    bubbleListaRows.length,
    categoriaFilter,
    columnOrder,
    diasEntregaNum,
    diasEstoqueNum,
    effectiveEndDate,
    effectiveStartDate,
    fornecedorFilter,
    isCompatMode,
    mode,
    query,
    rows,
    selectedIds,
    sortDir,
    sortKey,
    estoqueFinalMap,
    compat?.rows?.length,
  ]);

  return (
    <div className={dash.dashboard}>
      <AppSidebar active="lista-compras" />
      {toast ? <SystemToast title={toast.title} message={toast.message} tone={toast.tone} onClose={() => setToast(null)} /> : null}
      <main className={dash.content}>
        <div className={styles.pageFrameWide}>
          <section className={styles.headerRow}>
            <div className={styles.titleWrap}>
              <span className={styles.titleIcon}>
                <HeaderIcon />
              </span>
              <div>
                <h1 className={styles.pageTitle}>Lista de Compras</h1>
                <p className={styles.pageSubtitle}>Monte sua lista de compras com base no seu estoque: filtre por categoria ou fornecedor.</p>
              </div>
            </div>

            <div className={styles.modeSwitch}>
              <button
                type="button"
                className={mode === "categoria" ? styles.modeActive : styles.modeBtn}
                onClick={() => {
                  setMode("categoria");
                  setCategoriaFilter("Categoria");
                }}
              >
                Por Categoria
              </button>
              <button
                type="button"
                className={mode === "fornecedor" ? styles.modeActive : styles.modeBtn}
                onClick={() => {
                  setMode("fornecedor");
                  setFornecedorFilter("Fornecedor");
                }}
              >
                Por Fornecedor
              </button>
            </div>
          </section>

          <QaModePanel screen="lista-de-compras" ui={qaUi} />

          <section className={styles.infoBanner}>
            <span className={styles.infoIcon}>
              <InfoIcon />
            </span>
            <span>
              {isCompatMode
                ? compat?.banner || "Fonte: Banco compatível Bubble"
                : inventoryOptions.length
                  ? "Selecione um período com inventários cadastrados e desbloqueie a seleção dos itens para montar sua lista."
                  : "Cadastre inventários para liberar o período e montar sua lista."}
            </span>
          </section>

          <section className={styles.filtersPanel}>
            <div className={styles.filterField}>
              <label className={styles.fieldLabel}>Buscar</label>
              <div className={styles.searchField}>
                <span className={styles.searchFieldIcon}>
                  <SearchIcon />
                </span>
                <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Pesquise por itens..." />
              </div>
            </div>

            <div className={styles.filterField}>
              <label className={styles.fieldLabel}>{mode === "categoria" ? "Categoria" : "Fornecedor"}</label>
              <select
                className={styles.select}
                value={mode === "categoria" ? categoriaFilter : fornecedorFilter}
                onChange={(e) => {
                  if (mode === "categoria") {
                    setCategoriaFilter(e.target.value);
                    return;
                  }
                  setFornecedorFilter(e.target.value);
                }}
              >
                {(mode === "categoria" ? categorias : fornecedores).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.periodBlock}>
              <div className={styles.fieldLabel}>Período:</div>
              <div className={styles.periodFields}>
                <div className={styles.dateFieldWrap}>
                  <div className={isPeriodReady || !inventoryOptions.length ? styles.dateSelectWrap : `${styles.dateSelectWrap} ${styles.dateSelectWrapInvalid}`}>
                    <span className={styles.dateIcon}>
                      <CalendarIcon />
                    </span>
                    <select className={styles.dateSelect} value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={!inventoryOptions.length}>
                      {!inventoryOptions.length ? <option value="">Selecione uma data</option> : null}
                      {periodOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <span className={styles.periodText}>Até</span>
                <div className={styles.dateFieldWrap}>
                  <div className={isPeriodReady || !inventoryOptions.length ? styles.dateSelectWrap : `${styles.dateSelectWrap} ${styles.dateSelectWrapInvalid}`}>
                    <span className={styles.dateIcon}>
                      <CalendarIcon />
                    </span>
                    <select className={styles.dateSelect} value={endDate} onChange={(e) => setEndDate(e.target.value)} disabled={!inventoryOptions.length}>
                      {!inventoryOptions.length ? <option value="">Selecione uma data</option> : null}
                      {periodOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <button type="button" className={styles.exportBtn} disabled={exportDisabled} onClick={downloadListaPdf}>
                  <ExportIcon />
                  PDF
                </button>
                <button type="button" className={styles.exportBtn} disabled={exportDisabled} onClick={downloadListaXlsx}>
                  <ExportIcon />
                  XLSX
                </button>
              </div>
            </div>
          </section>

          <section className={styles.metricGrid}>
            <article className={styles.metricCard}>
              <div className={styles.metricTitle}>Dias para Manter Estoque</div>
              <div className={styles.metricHint}>Qtd. de dias que cada item ficará no estoque até a próxima compra.</div>
              <div className={styles.metricInputRow}>
                <input className={styles.metricInput} value={diasEstoque} onChange={(e) => setDiasEstoque(e.target.value.replace(/[^\d]/g, ""))} />
                <span className={styles.metricSuffix}>Dia(s)</span>
              </div>
            </article>

            <article className={styles.metricCard}>
              <div className={styles.metricTitle}>Prazo de Entrega do Fornecedor</div>
              <div className={styles.metricHint}>Qtd. de dias entre o pedido e o recebimento.</div>
              <div className={styles.metricInputRow}>
                <input className={styles.metricInput} value={diasEntrega} onChange={(e) => setDiasEntrega(e.target.value.replace(/[^\d]/g, ""))} />
                <span className={styles.metricSuffix}>Dia(s)</span>
              </div>
            </article>
          </section>

          <section className={styles.tableCard} style={{ position: "relative" }}>
            {isLoadingTable ? (
              <div className={dash.loadingOverlay}>
                <LoadingSpinner />
              </div>
            ) : null}
            <div className={styles.tableHeader} style={{ gridTemplateColumns }}>
              <label className={styles.checkCell}>
                <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll} disabled={isReadOnly} />
              </label>
              {columnOrder.map((column) => {
                const label =
                  column === "item"
                    ? "Item"
                    : column === "custoMedio"
                      ? "Custo Médio"
                      : column === "consumoDiario"
                        ? "Consumo Diário"
                        : column === "estoqueFinal"
                          ? "Estoque Final"
                          : "Comprar";
                return (
                  <div
                    key={column}
                    className={styles.tableHeadDrag}
                    draggable
                    onDragStart={(e) => {
                      setDraggingColumn(column);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", column);
                    }}
                    onDragEnd={() => setDraggingColumn(null)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => onColumnDrop(column)}
                  >
                    <button type="button" className={styles.tableHeadBtn} onClick={() => toggleSort(column)}>
                      {label} {sortKey === column ? <SortMark dir={sortDir} /> : null}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className={styles.tableBody} data-qa-grid="lista-de-compras">
              {rows.length ? (
                pageRows.map((row) => {
                  const fornecedorFactor = row.fornecedorFator > 0 ? row.fornecedorFator : 1;
                  const consumoFornecedor = row.consumoDiario / fornecedorFactor;
                  const custoFornecedor = row.custoMedio * fornecedorFactor;
                  const estoqueFinalValue = isCompatMode ? formatDecimal3(row.estoqueFinal) : estoqueFinalMap[row.id] ?? "0,000";
                  const comprarValue = (() => {
                    if (isCompatMode) {
                      const base = mode === "fornecedor" ? row.comprar / fornecedorFactor : row.comprar;
                      return formatDecimalUpTo3(Number.isFinite(base) ? base : 0);
                    }
                    const estoqueFinalNum = parseDecimalInput(estoqueFinalValue);
                    const demanda = row.consumoDiario * (diasEstoqueNum + diasEntregaNum);
                    const comprarCalculado = Math.max(demanda - estoqueFinalNum, 0);
                    const compraFornecedor = comprarCalculado / fornecedorFactor;
                    return formatDecimalUpTo3(mode === "fornecedor" ? compraFornecedor : comprarCalculado);
                  })();
                  return (
                    <div key={row.id} className={styles.tableRow} style={{ gridTemplateColumns }} data-qa-grid-row data-qa-row-id={row.id}>
                      <label className={styles.checkCell}>
                        <input type="checkbox" checked={Boolean(selectedIds[row.id])} onChange={() => toggleRow(row.id)} disabled={isReadOnly} />
                      </label>
                      {columnOrder.map((column) => {
                        if (column === "item") {
                          return (
                            <div key={column} className={styles.itemCell}>
                              {isCompatMode ? (
                                <div className={styles.itemName}>{row.displayItem}</div>
                              ) : (
                                <Link className={`${styles.itemName} ${styles.itemNameLink}`} href={`/dashboard?itemId=${encodeURIComponent(row.id)}&tab=entradas`}>
                                  {row.displayItem}
                                </Link>
                              )}
                              <div className={styles.itemMeta}>{row.itemMetaLabel}</div>
                            </div>
                          );
                        }
                        if (column === "custoMedio") {
                          return (
                            <div key={column} className={styles.costCell}>
                              <div className={styles.costMain}>{mode === "fornecedor" ? formatMoney(custoFornecedor) : row.custoMedioLabel}</div>
                              {mode === "fornecedor" ? <div className={styles.costSub}>{row.custoMedioLabel}</div> : null}
                            </div>
                          );
                        }
                        if (column === "consumoDiario") {
                          const consumoDiasManter = row.consumoDiario * diasEstoqueNum;
                          return (
                            <div key={column} className={styles.measureStack}>
                              <div className={styles.measureCell}>
                                <span className={styles.valuePlain}>{formatDecimalUpTo3(mode === "fornecedor" ? consumoFornecedor : row.consumoDiario)}</span>
                                <span className={styles.unitPlain}>{mode === "fornecedor" ? row.fornecedorMedida : row.medida}</span>
                              </div>
                              {mode === "fornecedor" ? (
                                <div className={styles.measureSub}>{`${formatDecimalUpTo3(row.consumoDiario)} ${row.medida}`}</div>
                              ) : (
                                <div className={styles.measureSub}>{`${formatDecimalUpTo3(consumoDiasManter)} ${row.medida} (${diasEstoqueNum}D)`}</div>
                              )}
                            </div>
                          );
                        }
                        if (column === "estoqueFinal") {
                          return (
                            <div key={column} className={styles.measureCell}>
                              <input
                                className={styles.stockInput}
                                value={estoqueFinalValue}
                                onChange={(e) => updateEstoqueFinal(row.id, e.target.value)}
                                inputMode="decimal"
                                readOnly={isCompatMode || isReadOnly}
                              />
                              <span className={styles.unitTag}>{row.medida}</span>
                            </div>
                          );
                        }
                        return (
                          <div key={column} className={styles.measureCell}>
                            <input className={styles.buyInput} value={comprarValue} readOnly inputMode="decimal" />
                            <span className={styles.unitTag}>{mode === "fornecedor" ? row.fornecedorMedida : row.medida}</span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })
              ) : (
                <div className={styles.emptyState}>
                  {mode === "categoria"
                    ? "Nenhum item encontrado para a categoria selecionada."
                    : fornecedorFilter === "Fornecedor"
                      ? "Selecione um fornecedor para montar a lista de compras."
                      : "Nenhum item encontrado para o fornecedor selecionado."}
                </div>
              )}
            </div>
            <div className={styles.tableFooter}>
              <div className={styles.tableFooterLeft}>{`${rows.length} resultado(s) encontrado(s)`}</div>
              <div className={styles.tableFooterRight}>
                <button type="button" className={styles.pagerBtn} onClick={() => setPageIndex(0)} disabled={safePageIndex <= 0}>
                  «
                </button>
                <button type="button" className={styles.pagerBtn} onClick={() => setPageIndex((p) => Math.max(0, p - 1))} disabled={safePageIndex <= 0}>
                  ‹
                </button>
                <div className={styles.pagerPage}>{`${safePageIndex + 1} de ${totalPages}`}</div>
                <button
                  type="button"
                  className={styles.pagerBtn}
                  onClick={() => setPageIndex((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={safePageIndex >= totalPages - 1}
                >
                  ›
                </button>
                <button type="button" className={styles.pagerBtn} onClick={() => setPageIndex(totalPages - 1)} disabled={safePageIndex >= totalPages - 1}>
                  »
                </button>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
