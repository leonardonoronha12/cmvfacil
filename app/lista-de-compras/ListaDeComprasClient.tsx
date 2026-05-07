"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AppSidebar from "../components/AppSidebar";
import dash from "../dashboard/dashboard.module.css";
import { readEntradasFromStore, subscribeEntradas, type EntradaStoreRow } from "../lib/entradasStore";
import {
  readFornecedorEquivalenciasMap,
  readFornecedorInfoMap,
  readFornecedorProdutosMap,
  subscribeFornecedorEquivalencias,
  subscribeFornecedorInfo,
  subscribeFornecedorProdutos,
  type FornecedorEquivalenciasMap,
  type FornecedorInfoMap,
  type FornecedorProdutos,
} from "../lib/fornecedoresStore";
import { readInventarioFromStore, subscribeInventario, type InventarioContagem } from "../lib/inventarioStore";
import { readInsumosFromStore, subscribeInsumos, type InsumoStoreItem } from "../lib/insumosStore";
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

function parseQtyLabel(input: string) {
  const raw = String(input ?? "").trim();
  if (!raw) return 0;
  const match = raw.match(/^([0-9.,-]+)\s*([A-Za-zÀ-ÿ]+)?$/);
  return parsePtNumber(match?.[1] ?? raw);
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
  const [insumos, setInsumos] = useState<InsumoStoreItem[]>([]);
  const [entradas, setEntradas] = useState<EntradaStoreRow[]>([]);
  const [contagens, setContagens] = useState<InventarioContagem[]>([]);
  const [fornecedorInfoMap, setFornecedorInfoMap] = useState<FornecedorInfoMap>({});
  const [fornecedorProdutosMap, setFornecedorProdutosMap] = useState<FornecedorProdutos>({});
  const [fornecedorEquivalenciasMap, setFornecedorEquivalenciasMap] = useState<FornecedorEquivalenciasMap>({});
  const [mode, setMode] = useState<"categoria" | "fornecedor">("categoria");
  const [categoriaFilter, setCategoriaFilter] = useState("Categoria");
  const [fornecedorFilter, setFornecedorFilter] = useState("Fornecedor");
  const [query, setQuery] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [diasEstoque, setDiasEstoque] = useState("7");
  const [diasEntrega, setDiasEntrega] = useState("1");
  const [columnOrder, setColumnOrder] = useState<CompraTableColumn[]>(["item", "custoMedio", "consumoDiario", "estoqueFinal", "comprar"]);
  const [draggingColumn, setDraggingColumn] = useState<CompraTableColumn | null>(null);
  const [sortKey, setSortKey] = useState<CompraTableColumn | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const [estoqueFinalMap, setEstoqueFinalMap] = useState<Record<string, string>>({});

  useEffect(() => {
    setInsumos(readInsumosFromStore());
    setEntradas(readEntradasFromStore([]));
    setContagens(readInventarioFromStore([]));
    setFornecedorInfoMap(readFornecedorInfoMap());
    setFornecedorProdutosMap(readFornecedorProdutosMap());
    setFornecedorEquivalenciasMap(readFornecedorEquivalenciasMap());

    const unsubInsumos = subscribeInsumos((rows) => setInsumos(rows));
    const unsubEntradas = subscribeEntradas((rows) => setEntradas(rows));
    const unsubInventario = subscribeInventario((rows) => setContagens(rows));
    const unsubInfo = subscribeFornecedorInfo((rows) => setFornecedorInfoMap(rows));
    const unsubProdutos = subscribeFornecedorProdutos((rows) => setFornecedorProdutosMap(rows));
    const unsubEquiv = subscribeFornecedorEquivalencias((rows) => setFornecedorEquivalenciasMap(rows));

    return () => {
      unsubInsumos();
      unsubEntradas();
      unsubInventario();
      unsubInfo();
      unsubProdutos();
      unsubEquiv();
    };
  }, []);

  const baseRows = useMemo(() => {
    const latestIndex = buildLatestEntriesIndex(entradas, fornecedorInfoMap, fornecedorEquivalenciasMap, fornecedorProdutosMap);
    const fornecedorFallback = buildFornecedorFallbackIndex(fornecedorInfoMap, fornecedorProdutosMap, fornecedorEquivalenciasMap);
    const contagemOptions = contagens
      .map((contagem) => {
        const t = parseDateLoose(contagem.data);
        if (!t) return null;
        const date = new Date(t);
        const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        return { iso, label: contagem.data, t, contagem };
      })
      .filter((value): value is { iso: string; label: string; t: number; contagem: InventarioContagem } => Boolean(value))
      .sort((a, b) => b.t - a.t);
    const startIso = startDate || contagemOptions[0]?.iso || "";
    const endIso = endDate || contagemOptions[contagemOptions.length - 1]?.iso || "";
    const startOpt = contagemOptions.find((option) => option.iso === startIso) ?? null;
    const endOpt = contagemOptions.find((option) => option.iso === endIso) ?? null;
    const minT = startOpt && endOpt ? Math.min(startOpt.t, endOpt.t) : 0;
    const maxT = startOpt && endOpt ? Math.max(startOpt.t, endOpt.t) : 0;
    const periodDays = startOpt && endOpt ? Math.max(Math.round((maxT - minT) / (1000 * 60 * 60 * 24)), 1) : 1;

    const contagemStart = startOpt?.contagem ?? null;
    const contagemEnd = endOpt?.contagem ?? null;

    const initialById = new Map<string, number>();
    const finalById = new Map<string, number>();
    for (const cat of contagemStart?.categorias ?? []) {
      for (const item of cat.itens ?? []) initialById.set(item.id, parsePtNumber(item.estoqueFinal || "0"));
    }
    for (const cat of contagemEnd?.categorias ?? []) {
      for (const item of cat.itens ?? []) finalById.set(item.id, parsePtNumber(item.estoqueFinal || "0"));
    }

    const insumoIdByKey = new Map<string, string>();
    for (const item of insumos) {
      const key = normalizeText(item.item);
      if (!key || insumoIdByKey.has(key)) continue;
      insumoIdByKey.set(key, item.id);
    }

    const entradasQtyById = new Map<string, number>();
    for (const entrada of entradas) {
      const t = parseDateLoose(entrada.dataLancamento);
      if (!t || t < minT || t > maxT) continue;
      for (const item of entrada.itensNota ?? []) {
        const key = normalizeText(item.nome);
        const id = insumoIdByKey.get(key);
        if (!id) continue;
        const qty = parseQtyLabel(item.quantidadeLabel ?? "");
        entradasQtyById.set(id, (entradasQtyById.get(id) ?? 0) + qty);
      }
    }

    const fornecedorKeyByLabel = new Map<string, string>();
    for (const [key, info] of Object.entries(fornecedorInfoMap)) {
      const label = info.fornecedor.trim();
      if (!label || fornecedorKeyByLabel.has(label)) continue;
      fornecedorKeyByLabel.set(label, key);
    }
    const selectedFornecedorKey = fornecedorKeyByLabel.get(fornecedorFilter) ?? fornecedorFilter.trim().toUpperCase();
    const selectedEquivalencias = fornecedorEquivalenciasMap[selectedFornecedorKey] ?? [];
    const selectedProdutos = fornecedorProdutosMap[selectedFornecedorKey] ?? [];
    const supplierMetaByItemKey = new Map<string, { name: string; unit: string; factor: number }>();
    const supplierItemKeys = new Set<string>();

    for (const row of selectedEquivalencias) {
      const insumoKey = normalizeText(row.insumoEquivalente);
      const nomeFornecedor = row.nomeNaNota.trim();
      if (!insumoKey || !nomeFornecedor) continue;
      supplierItemKeys.add(insumoKey);
      if (!supplierMetaByItemKey.has(insumoKey)) {
        supplierMetaByItemKey.set(insumoKey, {
          name: nomeFornecedor,
          unit: row.unidadeNaNota.trim() || "Und",
          factor: Math.max(parsePtNumber(row.equivalenteQuantidade), 1),
        });
      }
    }

    for (const produto of selectedProdutos) {
      const produtoKey = normalizeText(produto);
      if (!produtoKey) continue;
      supplierItemKeys.add(produtoKey);
      if (!supplierMetaByItemKey.has(produtoKey)) {
        supplierMetaByItemKey.set(produtoKey, {
          name: produto.trim(),
          unit: "",
          factor: 1,
        });
      }
    }

    return insumos
      .filter((row) => !row.ocultar)
      .filter((row) => {
        if (mode !== "fornecedor" || fornecedorFilter === "Fornecedor") return true;
        return supplierItemKeys.has(normalizeText(row.item));
      })
      .map<CompraRow>((row) => {
        const itemKey = normalizeText(row.item);
        const latest = latestIndex.get(itemKey);
        const fornecedor = latest?.fornecedor || fornecedorFallback.get(itemKey) || "-";
        const supplierMeta = supplierMetaByItemKey.get(itemKey);
        const displayItem = mode === "fornecedor" && fornecedorFilter !== "Fornecedor" ? supplierMeta?.name ?? row.item : row.item;
        const itemMetaLabel = mode === "fornecedor" ? row.item : row.categoria?.trim() || "-";
        const initialQty = initialById.get(row.id) ?? 0;
        const finalQty = finalById.get(row.id) ?? 0;
        const entradasQty = entradasQtyById.get(row.id) ?? 0;
        const saidasQty = initialQty + entradasQty - finalQty;
        const consumoDiario = saidasQty / periodDays;
        const comprar = Math.max(consumoDiario * (parsePositiveInt(diasEstoque, 7) + parsePositiveInt(diasEntrega, 1)) - finalQty, 0);
        return {
          id: row.id,
          item: row.item,
          displayItem,
          itemMetaLabel,
          categoria: row.categoria?.trim() || "-",
          medida: row.medida?.trim() || "Und",
          custoMedio: parseMoney(row.custoMedio ?? ""),
          custoMedioLabel: row.custoMedio?.trim() || "R$0,00",
          fornecedor,
          fornecedorMedida: supplierMeta?.unit || row.medida?.trim() || "Und",
          fornecedorFator: supplierMeta?.factor && supplierMeta.factor > 0 ? supplierMeta.factor : 1,
          consumoDiario,
          estoqueFinal: finalQty,
          comprar,
        };
      });
  }, [
    contagens,
    diasEntrega,
    diasEstoque,
    endDate,
    entradas,
    fornecedorFilter,
    fornecedorEquivalenciasMap,
    fornecedorInfoMap,
    fornecedorProdutosMap,
    insumos,
    mode,
    startDate,
  ]);

  const categorias = useMemo(() => {
    const list = Array.from(new Set(baseRows.map((row) => row.categoria.trim()).filter((value) => value && value !== "-")));
    return ["Categoria", ...list];
  }, [baseRows]);

  const fornecedores = useMemo(() => {
    const labels = new Set<string>();
    for (const [key, info] of Object.entries(fornecedorInfoMap)) {
      if ((fornecedorProdutosMap[key]?.length ?? 0) > 0 || (fornecedorEquivalenciasMap[key]?.length ?? 0) > 0) {
        const label = info.fornecedor.trim();
        if (label) labels.add(label);
      }
    }
    const list = Array.from(labels).sort((a, b) => a.localeCompare(b, "pt-BR"));
    return ["Fornecedor", ...list];
  }, [fornecedorEquivalenciasMap, fornecedorInfoMap, fornecedorProdutosMap]);

  const inventoryOptions = useMemo(() => {
    const out: Array<{ iso: string; label: string; t: number }> = [];
    for (const c of contagens) {
      const t = parseDateLoose(c.data);
      if (!t) continue;
      const date = new Date(t);
      const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      out.push({ iso, label: c.data, t });
    }
    out.sort((a, b) => b.t - a.t);
    const seen = new Set<string>();
    return out.filter((option) => {
      if (seen.has(option.iso)) return false;
      seen.add(option.iso);
      return true;
    });
  }, [contagens]);

  const periodOptions = useMemo(() => [...inventoryOptions].sort((a, b) => b.t - a.t), [inventoryOptions]);

  const effectiveStartDate = startDate || periodOptions[periodOptions.length - 1]?.iso || "";
  const effectiveEndDate = endDate || periodOptions[0]?.iso || "";

  useEffect(() => {
    if (!periodOptions.length) return;
    setStartDate((prev) => (periodOptions.some((option) => option.iso === prev) ? prev : periodOptions[periodOptions.length - 1]!.iso));
    setEndDate((prev) => (periodOptions.some((option) => option.iso === prev) ? prev : periodOptions[0]!.iso));
  }, [periodOptions]);

  const rows = useMemo(() => {
    const search = query.trim().toLowerCase();
    const mapped = baseRows.filter((row) => {
      if (mode === "categoria" && categoriaFilter !== "Categoria" && row.categoria !== categoriaFilter) return false;
      if (mode === "fornecedor" && fornecedorFilter === "Fornecedor") return false;
      if (!search) return true;
      return `${row.displayItem} ${row.item} ${row.categoria} ${row.fornecedor}`.toLowerCase().includes(search);
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
            const coberturaDias = parsePositiveInt(diasEstoque, 7) + parsePositiveInt(diasEntrega, 1);
            const aEstoqueFinal = parseDecimalInput(estoqueFinalMap[a.row.id] ?? formatDecimal3(a.row.estoqueFinal));
            const bEstoqueFinal = parseDecimalInput(estoqueFinalMap[b.row.id] ?? formatDecimal3(b.row.estoqueFinal));
            const aValue = Math.max(a.row.consumoDiario * coberturaDias - aEstoqueFinal, 0) / (mode === "fornecedor" ? a.row.fornecedorFator : 1);
            const bValue = Math.max(b.row.consumoDiario * coberturaDias - bEstoqueFinal, 0) / (mode === "fornecedor" ? b.row.fornecedorFator : 1);
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

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const row of baseRows) next[row.id] = formatDecimal3(row.estoqueFinal);
    setEstoqueFinalMap(next);
  }, [baseRows]);

  const allVisibleSelected = rows.length > 0 && rows.every((row) => selectedIds[row.id]);
  const isPeriodReady =
    inventoryOptions.length > 0 &&
    inventoryOptions.some((option) => option.iso === effectiveStartDate) &&
    inventoryOptions.some((option) => option.iso === effectiveEndDate);

  function toggleSelectAll() {
    if (!isPeriodReady) return;
    setSelectedIds((prev) => {
      const next = { ...prev };
      if (allVisibleSelected) {
        for (const row of rows) delete next[row.id];
      } else {
        for (const row of rows) next[row.id] = true;
      }
      return next;
    });
  }

  function toggleRow(id: string) {
    if (!isPeriodReady) return;
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
    const cleaned = value.replace(/[^\d,]/g, "");
    setEstoqueFinalMap((prev) => ({ ...prev, [id]: cleaned }));
  }

  function parsePositiveInt(value: string, fallback: number) {
    const num = Number(value.replace(/[^\d]/g, ""));
    return Number.isFinite(num) && num > 0 ? num : fallback;
  }

  const diasEstoqueNum = parsePositiveInt(diasEstoque, 7);
  const diasEntregaNum = parsePositiveInt(diasEntrega, 1);

  return (
    <div className={dash.dashboard}>
      <AppSidebar active="lista-compras" />
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
              <button type="button" className={mode === "categoria" ? styles.modeActive : styles.modeBtn} onClick={() => setMode("categoria")}>
                Por Categoria
              </button>
              <button type="button" className={mode === "fornecedor" ? styles.modeActive : styles.modeBtn} onClick={() => setMode("fornecedor")}>
                Por Fornecedor
              </button>
            </div>
          </section>

          <section className={styles.infoBanner}>
            <span className={styles.infoIcon}>
              <InfoIcon />
            </span>
            <span>
              {inventoryOptions.length
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
                  <div className={styles.dateSelectWrap}>
                    <span className={styles.dateIcon}>
                      <CalendarIcon />
                    </span>
                    <select className={styles.dateSelect} value={effectiveStartDate} onChange={(e) => setStartDate(e.target.value)} disabled={!inventoryOptions.length}>
                      {!inventoryOptions.length ? <option value="">Selecione uma data</option> : null}
                      {periodOptions.map((o) => (
                        <option key={o.iso} value={o.iso}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <span className={styles.periodText}>Até</span>
                <div className={styles.dateFieldWrap}>
                  <div className={styles.dateSelectWrap}>
                    <span className={styles.dateIcon}>
                      <CalendarIcon />
                    </span>
                    <select className={styles.dateSelect} value={effectiveEndDate} onChange={(e) => setEndDate(e.target.value)} disabled={!inventoryOptions.length}>
                      {!inventoryOptions.length ? <option value="">Selecione uma data</option> : null}
                      {periodOptions.map((o) => (
                        <option key={o.iso} value={o.iso}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <button type="button" className={styles.exportBtn} disabled>
                  <ExportIcon />
                  PDF
                </button>
                <button type="button" className={styles.exportBtn} disabled>
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

          <section className={styles.tableCard}>
            <div className={styles.tableHeader} style={{ gridTemplateColumns }}>
              <label className={styles.checkCell}>
                <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll} disabled={!isPeriodReady} />
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

            <div className={styles.tableBody}>
              {rows.length ? (
                rows.map((row) => {
                  const estoqueFinalValue = estoqueFinalMap[row.id] ?? "0,000";
                  const estoqueFinalNum = parseDecimalInput(estoqueFinalValue);
                  const demanda = row.consumoDiario * (diasEstoqueNum + diasEntregaNum);
                  const comprarCalculado = Math.max(demanda - estoqueFinalNum, 0);
                  const fornecedorFactor = row.fornecedorFator > 0 ? row.fornecedorFator : 1;
                  const compraFornecedor = comprarCalculado / fornecedorFactor;
                  const consumoFornecedor = row.consumoDiario / fornecedorFactor;
                  const custoFornecedor = row.custoMedio * fornecedorFactor;
                  const comprarValue = formatDecimalUpTo3(mode === "fornecedor" ? compraFornecedor : comprarCalculado);
                  return (
                    <div key={row.id} className={styles.tableRow} style={{ gridTemplateColumns }}>
                      <label className={styles.checkCell}>
                        <input type="checkbox" checked={Boolean(selectedIds[row.id])} onChange={() => toggleRow(row.id)} disabled={!isPeriodReady} />
                      </label>
                      {columnOrder.map((column) => {
                        if (column === "item") {
                          return (
                            <div key={column} className={styles.itemCell}>
                              <Link className={`${styles.itemName} ${styles.itemNameLink}`} href={`/dashboard?itemId=${encodeURIComponent(row.id)}&tab=entradas`}>
                                {row.displayItem}
                              </Link>
                              <div className={styles.itemMeta}>{row.itemMetaLabel}</div>
                            </div>
                          );
                        }
                        if (column === "custoMedio") {
                          return (
                            <div key={column} className={styles.costCell}>
                              <div className={styles.costMain}>{mode === "fornecedor" ? formatMoney(custoFornecedor) : row.custoMedioLabel}</div>
                              <div className={styles.costSub}>{mode === "fornecedor" ? row.custoMedioLabel : row.fornecedor}</div>
                            </div>
                          );
                        }
                        if (column === "consumoDiario") {
                          return (
                            <div key={column} className={styles.measureStack}>
                              <div className={styles.measureCell}>
                                <span className={styles.valuePlain}>{formatDecimalUpTo3(mode === "fornecedor" ? consumoFornecedor : row.consumoDiario)}</span>
                                <span className={styles.unitPlain}>{mode === "fornecedor" ? row.fornecedorMedida : row.medida}</span>
                              </div>
                              {mode === "fornecedor" ? <div className={styles.measureSub}>{`${formatDecimalUpTo3(row.consumoDiario)} ${row.medida}`}</div> : null}
                            </div>
                          );
                        }
                        if (column === "estoqueFinal") {
                          return (
                            <div key={column} className={styles.measureCell}>
                              <input className={styles.stockInput} value={estoqueFinalValue} onChange={(e) => updateEstoqueFinal(row.id, e.target.value)} inputMode="decimal" />
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
          </section>
        </div>
      </main>
    </div>
  );
}
