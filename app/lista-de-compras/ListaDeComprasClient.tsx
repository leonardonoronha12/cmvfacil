"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { readInsumosFromStore, subscribeInsumos, type InsumoStoreItem } from "../lib/insumosStore";
import styles from "./lista-de-compras.module.css";

type CompraRow = {
  id: string;
  item: string;
  categoria: string;
  medida: string;
  custoMedio: number;
  custoMedioLabel: string;
  fornecedor: string;
  consumoDiario: number;
  estoqueFinal: number;
  comprar: number;
};

type CompraTableColumn = "item" | "custoMedio" | "consumoDiario" | "estoqueFinal" | "comprar";

type LatestItemInfo = {
  fornecedor: string;
  timestamp: number;
};

type PickerField = "start" | "end";

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

function formatDateDisplay(value: string) {
  if (!value) return "Selecione uma data";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return "Selecione uma data";
  return `${day}/${month}/${year}`;
}

function parseIsoDate(value: string) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function toIsoDate(date: Date) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, delta: number) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

function isSameDay(a: Date | null, b: Date | null) {
  if (!a || !b) return false;
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function getCalendarDays(viewDate: Date) {
  const first = startOfMonth(viewDate);
  const startWeekDay = first.getDay();
  const start = new Date(first);
  start.setDate(first.getDate() - startWeekDay);
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return {
      date: day,
      inMonth: day.getMonth() === viewDate.getMonth(),
    };
  });
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
  const [fornecedorInfoMap, setFornecedorInfoMap] = useState<FornecedorInfoMap>({});
  const [fornecedorProdutosMap, setFornecedorProdutosMap] = useState<FornecedorProdutos>({});
  const [fornecedorEquivalenciasMap, setFornecedorEquivalenciasMap] = useState<FornecedorEquivalenciasMap>({});
  const [mode, setMode] = useState<"categoria" | "fornecedor">("categoria");
  const [categoria, setCategoria] = useState("Categoria");
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
  const [comprarMap, setComprarMap] = useState<Record<string, string>>({});
  const [openPicker, setOpenPicker] = useState<PickerField | null>(null);
  const [pickerMonth, setPickerMonth] = useState<Date>(() => startOfMonth(new Date()));
  const pickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setInsumos(readInsumosFromStore());
    setEntradas(readEntradasFromStore([]));
    setFornecedorInfoMap(readFornecedorInfoMap());
    setFornecedorProdutosMap(readFornecedorProdutosMap());
    setFornecedorEquivalenciasMap(readFornecedorEquivalenciasMap());

    const unsubInsumos = subscribeInsumos((rows) => setInsumos(rows));
    const unsubEntradas = subscribeEntradas((rows) => setEntradas(rows));
    const unsubInfo = subscribeFornecedorInfo((rows) => setFornecedorInfoMap(rows));
    const unsubProdutos = subscribeFornecedorProdutos((rows) => setFornecedorProdutosMap(rows));
    const unsubEquiv = subscribeFornecedorEquivalencias((rows) => setFornecedorEquivalenciasMap(rows));

    return () => {
      unsubInsumos();
      unsubEntradas();
      unsubInfo();
      unsubProdutos();
      unsubEquiv();
    };
  }, []);

  const rows = useMemo(() => {
    const latestIndex = buildLatestEntriesIndex(entradas, fornecedorInfoMap, fornecedorEquivalenciasMap, fornecedorProdutosMap);
    const fornecedorFallback = buildFornecedorFallbackIndex(fornecedorInfoMap, fornecedorProdutosMap, fornecedorEquivalenciasMap);
    const search = query.trim().toLowerCase();

    const mapped = insumos
      .filter((row) => !row.ocultar)
      .map<CompraRow>((row) => {
        const itemKey = normalizeText(row.item);
        const latest = latestIndex.get(itemKey);
        const fornecedor = latest?.fornecedor || fornecedorFallback.get(itemKey) || "-";
        return {
          id: row.id,
          item: row.item,
          categoria: row.categoria?.trim() || "-",
          medida: row.medida?.trim() || "Und",
          custoMedio: parseMoney(row.custoMedio ?? ""),
          custoMedioLabel: row.custoMedio?.trim() || "R$0,00",
          fornecedor,
          consumoDiario: 0,
          estoqueFinal: 0,
          comprar: 0,
        };
      })
      .filter((row) => {
        if (categoria !== "Categoria" && row.categoria !== categoria) return false;
        if (!search) return true;
        return `${row.item} ${row.categoria} ${row.fornecedor}`.toLowerCase().includes(search);
      });

    const decorated = mapped.map((row, index) => ({ row, index }));
    const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });
    decorated.sort((a, b) => {
      if (sortKey) {
        let cmp = 0;
        switch (sortKey) {
          case "item":
            cmp = collator.compare(a.row.item, b.row.item);
            break;
          case "custoMedio":
            cmp = a.row.custoMedio - b.row.custoMedio;
            break;
          case "consumoDiario":
            cmp = a.row.consumoDiario - b.row.consumoDiario;
            break;
          case "estoqueFinal": {
            const aValue = parseDecimalInput(estoqueFinalMap[a.row.id] ?? "0,000");
            const bValue = parseDecimalInput(estoqueFinalMap[b.row.id] ?? "0,000");
            cmp = aValue - bValue;
            break;
          }
          case "comprar": {
            const aValue = parseDecimalInput(comprarMap[a.row.id] ?? "0,000");
            const bValue = parseDecimalInput(comprarMap[b.row.id] ?? "0,000");
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
  }, [categoria, comprarMap, entradas, estoqueFinalMap, fornecedorEquivalenciasMap, fornecedorInfoMap, fornecedorProdutosMap, insumos, mode, query, sortDir, sortKey]);

  useEffect(() => {
    setEstoqueFinalMap((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const row of rows) {
        if (next[row.id] != null) continue;
        next[row.id] = "0,000";
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [rows]);

  useEffect(() => {
    setComprarMap((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const row of rows) {
        if (next[row.id] != null) continue;
        next[row.id] = "0,000";
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [rows]);

  const categorias = useMemo(() => {
    const list = Array.from(new Set(insumos.map((row) => row.categoria?.trim() || "-").filter((value) => value && value !== "-")));
    return ["Categoria", ...list];
  }, [insumos]);

  const allVisibleSelected = rows.length > 0 && rows.every((row) => selectedIds[row.id]);
  const isPeriodReady = Boolean(startDate && endDate);

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

  function updateComprar(id: string, value: string) {
    const cleaned = value.replace(/[^\d,]/g, "");
    setComprarMap((prev) => ({ ...prev, [id]: cleaned }));
  }

  function parsePositiveInt(value: string, fallback: number) {
    const num = Number(value.replace(/[^\d]/g, ""));
    return Number.isFinite(num) && num > 0 ? num : fallback;
  }

  function openDatePicker(field: PickerField) {
    const currentValue = field === "start" ? startDate : endDate;
    setPickerMonth(startOfMonth(parseIsoDate(currentValue) ?? new Date()));
    setOpenPicker((prev) => (prev === field ? null : field));
  }

  function selectDate(field: PickerField, date: Date) {
    const iso = toIsoDate(date);
    if (field === "start") setStartDate(iso);
    else setEndDate(iso);
    setOpenPicker(null);
  }

  useEffect(() => {
    if (!openPicker) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (pickerRef.current?.contains(target)) return;
      setOpenPicker(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [openPicker]);

  const diasEstoqueNum = parsePositiveInt(diasEstoque, 7);
  const diasEntregaNum = parsePositiveInt(diasEntrega, 1);
  const weekDays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];
  const calendarDays = getCalendarDays(pickerMonth);
  const selectedDate = openPicker === "start" ? parseIsoDate(startDate) : openPicker === "end" ? parseIsoDate(endDate) : null;
  const today = new Date();

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
            <span>Selecione o período e desbloqueie a seleção dos itens para montar sua lista.</span>
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
              <label className={styles.fieldLabel}>Categoria</label>
              <select className={styles.select} value={categoria} onChange={(e) => setCategoria(e.target.value)}>
                {categorias.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.periodBlock}>
              <div className={styles.fieldLabel}>Período:</div>
              <div className={styles.periodFields} ref={pickerRef}>
                <div className={styles.dateFieldWrap}>
                  <button type="button" className={styles.dateField} onClick={() => openDatePicker("start")}>
                    <span className={styles.dateIcon}>
                      <CalendarIcon />
                    </span>
                    <span className={startDate ? styles.dateValue : styles.datePlaceholder}>{formatDateDisplay(startDate)}</span>
                  </button>
                  {openPicker === "start" ? (
                    <div className={styles.calendarPopover}>
                      <div className={styles.calendarHeader}>
                        <button type="button" className={styles.calendarNav} onClick={() => setPickerMonth((prev) => addMonths(prev, -1))}>
                          {"<"}
                        </button>
                        <div className={styles.calendarTitle}>
                          {pickerMonth.toLocaleString("pt-BR", { month: "long", year: "numeric" })}
                        </div>
                        <button type="button" className={styles.calendarNav} onClick={() => setPickerMonth((prev) => addMonths(prev, 1))}>
                          {">"}
                        </button>
                      </div>
                      <div className={styles.calendarWeekdays}>
                        {weekDays.map((day) => (
                          <span key={day}>{day}</span>
                        ))}
                      </div>
                      <div className={styles.calendarGrid}>
                        {calendarDays.map(({ date, inMonth }) => (
                          <button
                            key={date.toISOString()}
                            type="button"
                            className={`${styles.calendarDay} ${!inMonth ? styles.calendarDayMuted : ""} ${
                              isSameDay(selectedDate, date) ? styles.calendarDaySelected : ""
                            } ${isSameDay(today, date) ? styles.calendarDayToday : ""}`}
                            onClick={() => selectDate("start", date)}
                          >
                            {date.getDate()}
                          </button>
                        ))}
                      </div>
                      <div className={styles.calendarFooter}>
                        <button type="button" className={styles.calendarAction} onClick={() => setStartDate("")}>
                          Limpar
                        </button>
                        <button type="button" className={styles.calendarAction} onClick={() => selectDate("start", new Date())}>
                          Hoje
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
                <span className={styles.periodText}>Até</span>
                <div className={styles.dateFieldWrap}>
                  <button type="button" className={styles.dateField} onClick={() => openDatePicker("end")}>
                    <span className={styles.dateIcon}>
                      <CalendarIcon />
                    </span>
                    <span className={endDate ? styles.dateValue : styles.datePlaceholder}>{formatDateDisplay(endDate)}</span>
                  </button>
                  {openPicker === "end" ? (
                    <div className={styles.calendarPopover}>
                      <div className={styles.calendarHeader}>
                        <button type="button" className={styles.calendarNav} onClick={() => setPickerMonth((prev) => addMonths(prev, -1))}>
                          {"<"}
                        </button>
                        <div className={styles.calendarTitle}>
                          {pickerMonth.toLocaleString("pt-BR", { month: "long", year: "numeric" })}
                        </div>
                        <button type="button" className={styles.calendarNav} onClick={() => setPickerMonth((prev) => addMonths(prev, 1))}>
                          {">"}
                        </button>
                      </div>
                      <div className={styles.calendarWeekdays}>
                        {weekDays.map((day) => (
                          <span key={day}>{day}</span>
                        ))}
                      </div>
                      <div className={styles.calendarGrid}>
                        {calendarDays.map(({ date, inMonth }) => (
                          <button
                            key={date.toISOString()}
                            type="button"
                            className={`${styles.calendarDay} ${!inMonth ? styles.calendarDayMuted : ""} ${
                              isSameDay(selectedDate, date) ? styles.calendarDaySelected : ""
                            } ${isSameDay(today, date) ? styles.calendarDayToday : ""}`}
                            onClick={() => selectDate("end", date)}
                          >
                            {date.getDate()}
                          </button>
                        ))}
                      </div>
                      <div className={styles.calendarFooter}>
                        <button type="button" className={styles.calendarAction} onClick={() => setEndDate("")}>
                          Limpar
                        </button>
                        <button type="button" className={styles.calendarAction} onClick={() => selectDate("end", new Date())}>
                          Hoje
                        </button>
                      </div>
                    </div>
                  ) : null}
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
                  const comprarValue = comprarMap[row.id] ?? formatDecimal3(comprarCalculado);
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
                                {row.item}
                              </Link>
                              <div className={styles.itemMeta}>{mode === "fornecedor" ? row.fornecedor : row.categoria}</div>
                            </div>
                          );
                        }
                        if (column === "custoMedio") {
                          return (
                            <div key={column} className={styles.costCell}>
                              <div className={styles.costMain}>{row.custoMedioLabel}</div>
                              <div className={styles.costSub}>{row.fornecedor}</div>
                            </div>
                          );
                        }
                        if (column === "consumoDiario") {
                          return (
                            <div key={column} className={styles.measureCell}>
                              <span className={styles.valuePlain}>{formatDecimal3(row.consumoDiario)}</span>
                              <span className={styles.unitPlain}>{row.medida}</span>
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
                            <input className={styles.buyInput} value={comprarValue} onChange={(e) => updateComprar(row.id, e.target.value)} inputMode="decimal" />
                            <span className={styles.unitTag}>{row.medida}</span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })
              ) : (
                <div className={styles.emptyState}>Nenhum item encontrado para a categoria selecionada.</div>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
