"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import dash from "../dashboard/dashboard.module.css";
import AppSidebar from "../components/AppSidebar";
import { readInsumosFromStore, writeInsumosToStore } from "../lib/insumosStore";
import { readInsumoCategoriasFromStore, writeInsumoCategoriasToStore } from "../lib/insumoCategoriasStore";
import { loadInsumosFromSupabase, syncInsumosToSupabase } from "../lib/insumosSupabase";
import styles from "./insumos.module.css";

type InsumoRow = {
  id: string;
  ocultar: boolean;
  item: string;
  medida: string;
  custoMedio: string;
  categoria: string;
  especificacao: string;
};

function normalizeCategoryName(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function getUniqueCategoriesFromRows(rows: InsumoRow[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const name = normalizeCategoryName(r.categoria ?? "");
    if (!name || name === "-") continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

function toMoney(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const s = value.toFixed(2).replace(".", ",");
    return `R$${s}`;
  }
  const raw = typeof value === "string" ? value.trim() : String(value ?? "").trim();
  if (!raw) return "";
  const normalized = raw.replace(/\s/g, "").replace(/^R\$/i, "").trim();
  const numeric = normalized.replace(/\./g, "").replace(",", ".");
  const n = Number(numeric);
  if (Number.isFinite(n)) {
    return `R$${normalized}`;
  }
  return raw;
}

function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function parseCsvLine(line: string) {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] ?? "";
    if (ch === '"') {
      const next = line[i + 1] ?? "";
      if (inQuotes && next === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

function detectColumnMap(headers: unknown[]) {
  const idx: Record<string, number> = {};
  for (let i = 0; i < headers.length; i++) {
    const h = normalizeHeader(headers[i]);
    if (!h) continue;
    if (idx.item == null && (h === "item" || h === "insumo" || h.includes("nome"))) idx.item = i;
    if (idx.medida == null && (h === "medida" || h === "unidade" || h.includes("unid"))) idx.medida = i;
    if (
      idx.custoMedio == null &&
      (h.includes("custo medio") || h.includes("custo_medio") || (h.includes("custo") && !h.includes("custo total")) || h.includes("preco"))
    )
      idx.custoMedio = i;
    if (idx.categoria == null && h.includes("categoria")) idx.categoria = i;
    if (idx.especificacao == null && h.includes("especificacao")) idx.especificacao = i;
    if (idx.ocultar == null && (h.includes("ocultar") || h.includes("oculto"))) idx.ocultar = i;
  }
  return idx;
}

function parseRowsFromTable(table: unknown[][]) {
  const safe = table.filter((r) => Array.isArray(r) && r.some((c) => String(c ?? "").trim() !== ""));
  if (!safe.length) return [];

  const map = detectColumnMap(safe[0] ?? []);
  const hasHeader = map.item != null || map.medida != null || map.custoMedio != null || map.categoria != null || map.especificacao != null;
  const startIndex = hasHeader ? 1 : 0;

  const fallback = { ocultar: 0, item: 1, medida: 2, custoMedio: 3, categoria: 4, especificacao: 5 };
  const getIndex = (key: keyof typeof fallback) => (map[key] != null ? map[key]! : fallback[key]);

  const out: InsumoRow[] = [];
  for (let i = startIndex; i < safe.length; i++) {
    const row = safe[i] ?? [];
    const item = String(row[getIndex("item")] ?? "").trim();
    if (!item) continue;
    const ocultarRaw = row[getIndex("ocultar")];
    const ocultar =
      typeof ocultarRaw === "boolean"
        ? ocultarRaw
        : ["1", "true", "sim", "yes", "y"].includes(String(ocultarRaw ?? "").trim().toLowerCase());

    out.push({
      id: String(out.length + 1),
      ocultar: Boolean(ocultar),
      item,
      medida: String(row[getIndex("medida")] ?? "").trim() || "-",
      custoMedio: toMoney(row[getIndex("custoMedio")]) || "-",
      categoria: String(row[getIndex("categoria")] ?? "").trim() || "-",
      especificacao: String(row[getIndex("especificacao")] ?? "").trim() || "-",
    });
  }
  return out;
}

function parseCurrencyToNumber(value: string) {
  const raw = String(value ?? "").replace(/\s/g, "").replace(/^R\$/, "").trim();
  if (!raw || raw === "-") return NaN;
  const normalized = raw.replace(/\./g, "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
}

function formatMoneyDraft(input: string) {
  const digits = String(input ?? "").replace(/\D/g, "");
  if (!digits) return "";
  const cents = Number.parseInt(digits, 10);
  return (cents / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function SortIcon({ dir }: { dir: "asc" | "desc" }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
      {dir === "asc" ? <path d="M7 14 12 9l5 5H7Z" fill="currentColor" /> : <path d="M7 10h10l-5 5-5-5Z" fill="currentColor" />}
    </svg>
  );
}

function IconCube() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 2 3.5 6.75v10.5L12 22l8.5-4.75V6.75L12 2Zm0 2.3 6.2 3.45L12 11.2 5.8 7.75 12 4.3Zm-6.7 5.1L11 12.6v7.1l-5.7-3.2V9.4Zm13.4 0v7.1L13 19.7v-7.1l5.7-3.2Z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M10.5 3a7.5 7.5 0 1 1 4.6 13.4l4.3 4.3-1.4 1.4-4.3-4.3A7.5 7.5 0 0 1 10.5 3Zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconUpload() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 7 8l1.4 1.4L11 6.8V15h2V6.8l2.6 2.6L17 8l-5-5Z" fill="currentColor" />
      <path d="M5 19h14v2H5v-2Z" fill="currentColor" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M11 5h2v14h-2V5Z" fill="currentColor" />
      <path d="M5 11h14v2H5v-2Z" fill="currentColor" />
    </svg>
  );
}

function IconEdit() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 17.3V20h2.7l9.9-9.9-2.7-2.7L4 17.3Zm16.8-10.8a.75.75 0 0 0 0-1.1l-2.2-2.2a.75.75 0 0 0-1.1 0l-1.7 1.7 3.3 3.3 1.7-1.7Z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M9 3h6l1 2h4v2H4V5h4l1-2Zm1 7h2v9h-2v-9Zm4 0h2v9h-2v-9ZM6 8h12l-1 13H7L6 8Z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9.2 16.6 4.9 12.3l1.4-1.4 2.9 2.9 8.5-8.5 1.4 1.4-9.9 9.9Z" fill="currentColor" />
    </svg>
  );
}

export default function InsumosClient() {
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isNewItemOpen, setIsNewItemOpen] = useState(false);
  const [isEditItemOpen, setIsEditItemOpen] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [isDeleteItemOpen, setIsDeleteItemOpen] = useState(false);
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);
  const [deletingItemName, setDeletingItemName] = useState<string>("");
  const [bulkDeleteMode, setBulkDeleteMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [dataRows, setDataRows] = useState<InsumoRow[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const rowsReadyRef = useRef(false);
  const prevIdsRef = useRef<Set<string>>(new Set());
  const pendingDeleteIdsRef = useRef<Set<string>>(new Set());
  const syncTimeoutRef = useRef<number | null>(null);
  const categoriesReadyRef = useRef(false);

  const [newItemName, setNewItemName] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [newSpec, setNewSpec] = useState("");
  const [newUnit, setNewUnit] = useState("");
  const [newInitialCost, setNewInitialCost] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [isCategoriesOpen, setIsCategoriesOpen] = useState(false);
  const [categoryNewDraft, setCategoryNewDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("Todas");

  useEffect(() => {
    (async () => {
      try {
        const dbRows = await loadInsumosFromSupabase();
        if (dbRows.length) {
          const mapped = dbRows.map((s, idx) => ({
            id: String(s.id || idx + 1),
            ocultar: Boolean(s.ocultar),
            item: String(s.item ?? "").trim(),
            medida: String(s.medida ?? "").trim() || "Und",
            custoMedio: String(s.custoMedio ?? "").trim() || "-",
            categoria: String(s.categoria ?? "").trim() || "-",
            especificacao: String(s.especificacao ?? "").trim() || "-",
          }));
          rowsReadyRef.current = true;
          prevIdsRef.current = new Set(mapped.map((r) => r.id));
          setDataRows(mapped);
          const saved = readInsumoCategoriasFromStore();
          const fromRows = getUniqueCategoriesFromRows(mapped);
          const merged: string[] = [];
          const seen = new Set<string>();
          for (const c of [...saved, ...fromRows]) {
            const name = normalizeCategoryName(c);
            if (!name || name === "-") continue;
            const key = name.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            merged.push(name);
          }
          setCategories(merged);
          categoriesReadyRef.current = true;
          writeInsumosToStore(dbRows);
          return;
        }
      } catch {}

      const stored = readInsumosFromStore();
      if (stored.length) {
        const mapped = stored.map((s, idx) => ({
          id: String(s.id || idx + 1),
          ocultar: Boolean(s.ocultar),
          item: String(s.item ?? "").trim(),
          medida: String(s.medida ?? "").trim() || "Und",
          custoMedio: String(s.custoMedio ?? "").trim() || "-",
          categoria: String(s.categoria ?? "").trim() || "-",
          especificacao: String(s.especificacao ?? "").trim() || "-",
        }));
        rowsReadyRef.current = true;
        prevIdsRef.current = new Set(mapped.map((r) => r.id));
        setDataRows(mapped);
        const saved = readInsumoCategoriasFromStore();
        const fromRows = getUniqueCategoriesFromRows(mapped);
        const merged: string[] = [];
        const seen = new Set<string>();
        for (const c of [...saved, ...fromRows]) {
          const name = normalizeCategoryName(c);
          if (!name || name === "-") continue;
          const key = name.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push(name);
        }
        setCategories(merged);
        categoriesReadyRef.current = true;
        return;
      }

      rowsReadyRef.current = true;
      prevIdsRef.current = new Set();
      setDataRows([]);
      setCategories(readInsumoCategoriasFromStore());
      categoriesReadyRef.current = true;
    })();
  }, []);

  useEffect(() => {
    if (!categoriesReadyRef.current) return;
    writeInsumoCategoriasToStore(categories);
  }, [categories]);

  useEffect(() => {
    if (!rowsReadyRef.current) return;
    writeInsumosToStore(
      dataRows.map((r) => ({
        id: r.id,
        item: r.item,
        medida: r.medida,
        custoMedio: r.custoMedio,
        categoria: r.categoria,
        especificacao: r.especificacao,
        ocultar: r.ocultar,
      })),
    );
  }, [dataRows]);

  useEffect(() => {
    if (!rowsReadyRef.current) return;

    const nextIds = new Set(dataRows.map((r) => r.id));
    for (const id of prevIdsRef.current) {
      if (!nextIds.has(id)) pendingDeleteIdsRef.current.add(id);
    }
    for (const id of nextIds) {
      if (pendingDeleteIdsRef.current.has(id)) pendingDeleteIdsRef.current.delete(id);
    }
    prevIdsRef.current = nextIds;

    if (syncTimeoutRef.current) window.clearTimeout(syncTimeoutRef.current);
    syncTimeoutRef.current = window.setTimeout(() => {
      const deleteIds = Array.from(pendingDeleteIdsRef.current);
      pendingDeleteIdsRef.current.clear();
      const storeRows = dataRows.map((r) => ({
        id: r.id,
        item: r.item,
        medida: r.medida,
        custoMedio: r.custoMedio,
        categoria: r.categoria,
        especificacao: r.especificacao,
        ocultar: r.ocultar,
      }));
      void syncInsumosToSupabase(storeRows, deleteIds).catch(() => {});
    }, 450);
  }, [dataRows]);

  useEffect(() => {
    const fromRows = getUniqueCategoriesFromRows(dataRows);
    if (!fromRows.length) return;
    setCategories((prev) => {
      const seen = new Set(prev.map((c) => c.toLowerCase()));
      const next = [...prev];
      for (const c of fromRows) {
        const key = c.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        next.push(c);
      }
      return next;
    });
  }, [dataRows]);
  const [editingCategoryOriginal, setEditingCategoryOriginal] = useState<string | null>(null);
  const [editingCategoryDraft, setEditingCategoryDraft] = useState("");
  const [isDeleteCategoryOpen, setIsDeleteCategoryOpen] = useState(false);
  const [deletingCategoryName, setDeletingCategoryName] = useState("");
  const [deletingCategoryCount, setDeletingCategoryCount] = useState(0);
  const [sortKey, setSortKey] = useState<null | "item" | "medida" | "custoMedio" | "categoria" | "especificacao">(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [columnOrder, setColumnOrder] = useState<Array<"item" | "medida" | "custoMedio" | "categoria" | "especificacao">>([
    "item",
    "medida",
    "custoMedio",
    "categoria",
    "especificacao",
  ]);
  const [draggingColumn, setDraggingColumn] = useState<null | "item" | "medida" | "custoMedio" | "categoria" | "especificacao">(null);

  function toggleOcultar(id: string) {
    setDataRows((prev) => prev.map((r) => (r.id === id ? { ...r, ocultar: !r.ocultar } : r)));
  }

  async function onImport() {
    if (importing) return;
    if (!selectedFile) {
      fileInputRef.current?.click();
      return;
    }

    setImporting(true);
    try {
      const name = selectedFile.name.toLowerCase();
      let table: unknown[][] = [];

      if (name.endsWith(".csv")) {
        const text = await selectedFile.text();
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
        table = lines.map(parseCsvLine);
      } else if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
        const XLSX = await import("xlsx");
        const buf = await selectedFile.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const sheetName = wb.SheetNames[0] ?? "";
        const ws = sheetName ? wb.Sheets[sheetName] : null;
        if (!ws) throw new Error("Planilha inválida.");
        table = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as unknown[][];
      } else {
        throw new Error("Formato não suportado. Use .xlsx, .xls ou .csv");
      }

      const imported = parseRowsFromTable(table);
      if (!imported.length) throw new Error("Nenhum item encontrado na planilha.");
      setDataRows(imported);
      setCategories((prev) => {
        const seen = new Set(prev.map((c) => c.toLowerCase()));
        const next = [...prev];
        for (const r of imported) {
          const name = normalizeCategoryName(r.categoria ?? "");
          if (!name || name === "-") continue;
          const key = name.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            next.push(name);
          }
        }
        return next;
      });
      setIsImportOpen(false);
      setSelectedFile(null);
      setSelectedFileName(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }

  function downloadTemplateCsv() {
    const sep = ";";
    const rows = [
      ["Item", "Medida", "Custo Médio", "Categoria", "Especificação", "Ocultar"],
      ["Álcool", "L", "4,39", "Limpeza", "-", "false"],
      ["Amido de milho", "Kg", "38,15", "Matéria Prima", "-", "false"],
    ];
    const csv = "\uFEFF" + rows.map((r) => r.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(sep)).join("\n");
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), "modelo-importacao-insumos.csv");
  }

  async function downloadTemplateXlsx() {
    const XLSX = await import("xlsx");
    const unitOptions = ["Und", "Kg", "g", "L", "ml"];
    const categoryOptions = categories
      .map((c) => normalizeCategoryName(c))
      .filter((c) => c && c !== "-")
      .slice(0, 50)
      .map((c) => c.replaceAll('"', "").replaceAll(",", " "));
    const categoryFormula = categoryOptions.length ? `"${categoryOptions.join(",")}"` : '"-"';
    const rows = [
      ["Item", "Medida", "Custo Médio", "Categoria", "Especificação", "Ocultar"],
      ["Álcool", "L", "4,39", "Limpeza", "-", false],
      ["Amido de milho", "Kg", "38,15", "Matéria Prima", "-", false],
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Insumos");
    (ws as any)["!dataValidation"] = [
      { type: "list", allowBlank: 1, sqref: "B2:B500", formulas: [`"${unitOptions.join(",")}"`] },
      { type: "list", allowBlank: 1, sqref: "D2:D500", formulas: [categoryFormula] },
      { type: "list", allowBlank: 1, sqref: "F2:F500", formulas: ['"FALSE,TRUE"'] },
    ];
    const array = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    downloadBlob(new Blob([array], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "modelo-importacao-insumos.xlsx");
  }

  function openNewItem() {
    setIsImportOpen(false);
    setIsEditItemOpen(false);
    setEditingItemId(null);
    setIsCategoriesOpen(false);
    setBulkDeleteMode(false);
    setSelectedIds(new Set());
    setNewItemName("");
    setNewCategory("");
    setNewSpec("");
    setNewUnit("");
    setNewInitialCost("");
    setIsNewItemOpen(true);
  }

  function saveNewItem() {
    const item = newItemName.trim();
    if (!item) return;
    const medida = newUnit.trim() || "-";
    const categoria = normalizeCategoryName(newCategory) || "-";
    const especificacao = newSpec.trim() || "-";
    const custoMedio = newInitialCost.trim() ? (newInitialCost.trim().startsWith("R$") ? newInitialCost.trim() : `R$${newInitialCost.trim()}`) : "-";

    if (categoria !== "-") {
      setCategories((prev) => {
        const key = categoria.toLowerCase();
        if (prev.some((c) => c.toLowerCase() === key)) return prev;
        return [...prev, categoria];
      });
    }

    setDataRows((prev) => [
      {
        id: String(prev.length + 1),
        ocultar: false,
        item,
        medida,
        custoMedio,
        categoria,
        especificacao,
      },
      ...prev,
    ]);
    setIsNewItemOpen(false);
  }

  function openEditItem(row: InsumoRow) {
    setIsImportOpen(false);
    setIsNewItemOpen(false);
    setIsDeleteItemOpen(false);
    setDeletingItemId(null);
    setDeletingItemName("");
    setIsCategoriesOpen(false);
    setBulkDeleteMode(false);
    setSelectedIds(new Set());
    setEditingItemId(row.id);
    setNewItemName(row.item);
    setNewCategory(row.categoria === "-" ? "" : row.categoria);
    setNewSpec(row.especificacao === "-" ? "" : row.especificacao);
    setNewUnit(row.medida === "-" ? "" : row.medida);
    setNewInitialCost(String(row.custoMedio ?? "").replace(/^R\$\s?/, "").trim().replace(".", ","));
    setIsEditItemOpen(true);

    const categoria = normalizeCategoryName(row.categoria ?? "");
    if (categoria && categoria !== "-") {
      setCategories((prev) => {
        const key = categoria.toLowerCase();
        if (prev.some((c) => c.toLowerCase() === key)) return prev;
        return [...prev, categoria];
      });
    }
  }

  function openDeleteItem(row: InsumoRow) {
    setIsImportOpen(false);
    setIsNewItemOpen(false);
    setIsEditItemOpen(false);
    setEditingItemId(null);
    setBulkDeleteMode(false);
    setSelectedIds(new Set());
    setDeletingItemId(row.id);
    setDeletingItemName(row.item);
    setIsDeleteItemOpen(true);
  }

  function confirmDeleteItem() {
    const id = deletingItemId;
    if (!id) return;
    setDataRows((prev) => prev.filter((r) => r.id !== id));
    setIsDeleteItemOpen(false);
    setDeletingItemId(null);
    setDeletingItemName("");
  }

  function saveEditItem() {
    const id = editingItemId;
    if (!id) return;
    const item = newItemName.trim();
    if (!item) return;
    const medida = newUnit.trim() || "-";
    const categoria = normalizeCategoryName(newCategory) || "-";
    const especificacao = newSpec.trim() || "-";
    const custoMedio = newInitialCost.trim() ? (newInitialCost.trim().startsWith("R$") ? newInitialCost.trim() : `R$${newInitialCost.trim()}`) : "-";

    if (categoria !== "-") {
      setCategories((prev) => {
        const key = categoria.toLowerCase();
        if (prev.some((c) => c.toLowerCase() === key)) return prev;
        return [...prev, categoria];
      });
    }

    setDataRows((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              item,
              medida,
              categoria,
              especificacao,
              custoMedio,
            }
          : r,
      ),
    );
    setIsEditItemOpen(false);
    setEditingItemId(null);
  }

  const categoryCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of dataRows) {
      const name = normalizeCategoryName(r.categoria ?? "");
      if (!name || name === "-") continue;
      map.set(name, (map.get(name) ?? 0) + 1);
    }
    return map;
  }, [dataRows]);

  const categoriesSorted = useMemo(() => {
    const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });
    return [...categories].filter((c) => normalizeCategoryName(c).toLowerCase() !== "todas").sort((a, b) => collator.compare(a, b));
  }, [categories]);

  function openCategories() {
    setCategoryNewDraft("");
    setEditingCategoryOriginal(null);
    setEditingCategoryDraft("");
    setIsDeleteCategoryOpen(false);
    setDeletingCategoryName("");
    setDeletingCategoryCount(0);
    setIsCategoriesOpen(true);
  }

  function addCategory() {
    const name = normalizeCategoryName(categoryNewDraft);
    if (!name) return;

    const existsKey = name.toLowerCase();
    setCategories((prev) => {
      if (prev.some((c) => c.toLowerCase() === existsKey)) return prev;
      return [...prev, name];
    });
    setCategoryNewDraft("");
  }

  function editCategory(name: string) {
    setIsCategoriesOpen(true);
    setEditingCategoryOriginal(name);
    setEditingCategoryDraft(name);
  }

  function cancelEditCategory() {
    setEditingCategoryOriginal(null);
    setEditingCategoryDraft("");
  }

  function confirmEditCategory() {
    const from = editingCategoryOriginal;
    if (!from) return;
    const name = normalizeCategoryName(editingCategoryDraft);
    if (!name) return;

    const existsKey = name.toLowerCase();
    const fromKey = from.toLowerCase();
    if (fromKey !== existsKey && categories.some((c) => c.toLowerCase() === existsKey)) {
      window.alert("Já existe uma categoria com esse nome.");
      return;
    }

    setCategories((prev) => prev.map((c) => (c === from ? name : c)));
    setDataRows((prev) => prev.map((r) => (r.categoria === from ? { ...r, categoria: name } : r)));
    if (newCategory === from) setNewCategory(name);
    cancelEditCategory();
  }

  function openDeleteCategory(name: string) {
    setDeletingCategoryName(name);
    setDeletingCategoryCount(categoryCounts.get(name) ?? 0);
    setIsDeleteCategoryOpen(true);
  }

  function cancelDeleteCategory() {
    setIsDeleteCategoryOpen(false);
    setDeletingCategoryName("");
    setDeletingCategoryCount(0);
  }

  function confirmDeleteCategory() {
    const name = deletingCategoryName;
    if (!name) return;
    const count = deletingCategoryCount;
    setCategories((prev) => prev.filter((c) => c !== name));
    if (count) setDataRows((prev) => prev.map((r) => (r.categoria === name ? { ...r, categoria: "-" } : r)));
    if (newCategory === name) setNewCategory("");
    if (editingCategoryOriginal === name) cancelEditCategory();
    cancelDeleteCategory();
  }

  const selectedCount = selectedIds.size;
  const allSelected = dataRows.length > 0 && dataRows.every((r) => selectedIds.has(r.id));

  function toggleBulkMode() {
    setIsImportOpen(false);
    setIsNewItemOpen(false);
    setIsEditItemOpen(false);
    setEditingItemId(null);
    setBulkDeleteMode((v) => {
      const next = !v;
      if (!next) setSelectedIds(new Set());
      return next;
    });
  }

  function toggleRowSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      if (dataRows.length && dataRows.every((r) => prev.has(r.id))) return new Set();
      return new Set(dataRows.map((r) => r.id));
    });
  }

  function deleteSelected() {
    if (!selectedIds.size) return;
    setDataRows((prev) => prev.filter((r) => !selectedIds.has(r.id)));
    setSelectedIds(new Set());
    setBulkDeleteMode(false);
  }

  function openBulkDeleteConfirm() {
    setIsBulkDeleteOpen(true);
  }

  function confirmBulkDelete() {
    deleteSelected();
    setIsBulkDeleteOpen(false);
  }

  useEffect(() => {
    if (!bulkDeleteMode) setIsBulkDeleteOpen(false);
  }, [bulkDeleteMode]);

  function toggleSort(key: "item" | "medida" | "custoMedio" | "categoria" | "especificacao") {
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

  function onColumnDrop(target: "item" | "medida" | "custoMedio" | "categoria" | "especificacao") {
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

  const visibleRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filteredByQuery = q
      ? dataRows.filter((r) => `${r.item} ${r.categoria} ${r.especificacao}`.toLowerCase().includes(q))
      : dataRows;

    const cat = normalizeCategoryName(categoryFilter);
    const filtered =
      cat && cat.toLowerCase() !== "todas"
        ? filteredByQuery.filter((r) => normalizeCategoryName(r.categoria ?? "").toLowerCase() === cat.toLowerCase())
        : filteredByQuery;

    if (!sortKey) return filtered;
    const decorated = filtered.map((r, i) => ({ r, i }));
    const dir = sortDir === "asc" ? 1 : -1;
    const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });
    decorated.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "custoMedio") {
        const av = parseCurrencyToNumber(a.r.custoMedio);
        const bv = parseCurrencyToNumber(b.r.custoMedio);
        const aBad = Number.isNaN(av);
        const bBad = Number.isNaN(bv);
        if (aBad && bBad) cmp = 0;
        else if (aBad) cmp = 1;
        else if (bBad) cmp = -1;
        else cmp = av === bv ? 0 : av < bv ? -1 : 1;
      } else {
        const av = String(a.r[sortKey] ?? "");
        const bv = String(b.r[sortKey] ?? "");
        cmp = collator.compare(av, bv);
      }
      if (!cmp) cmp = a.i - b.i;
      return cmp * dir;
    });
    return decorated.map((d) => d.r);
  }, [categoryFilter, dataRows, searchQuery, sortDir, sortKey]);

  const gridTemplateColumns = useMemo(() => {
    const widths: Record<"ocultar" | "item" | "medida" | "custoMedio" | "categoria" | "especificacao" | "acoes", string> = {
      ocultar: "84px",
      item: "1.7fr",
      medida: "0.5fr",
      custoMedio: "0.6fr",
      categoria: "0.8fr",
      especificacao: "1fr",
      acoes: "120px",
    };
    return ["ocultar", ...columnOrder, "acoes"].map((k) => widths[k as keyof typeof widths]).join(" ");
  }, [columnOrder]);

  const totalItens = useMemo(() => dataRows.length, [dataRows.length]);
  const totalOcultados = useMemo(() => dataRows.filter((r) => Boolean(r.ocultar)).length, [dataRows]);

  return (
    <div className={dash.dashboard}>
      <AppSidebar active="insumos" />

      <main className={dash.content}>
        <section className={styles.header}>
          <div className={styles.headerIcon}>
            <IconCube />
          </div>
          <div className={styles.headerText}>
            <h1 className={styles.title}>Insumos</h1>
            <p className={styles.subtitle}>Aqui você cadastra e gerencia todos os insumos do seu estoque.</p>
          </div>
        </section>

        <section className={styles.kpis}>
          <div className={styles.kpiCard}>
            <div className={styles.kpiIcon}>
              <IconCube />
            </div>
            <div className={styles.kpiBody}>
              <div className={styles.kpiValue}>{totalItens}</div>
              <div className={styles.kpiLabel}>TOTAL ITENS</div>
            </div>
          </div>

          <div className={styles.kpiCard}>
            <div className={styles.kpiIconMuted}>
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Zm10 4.5A4.5 4.5 0 1 0 12 7.5a4.5 4.5 0 0 0 0 9Z"
                  fill="currentColor"
                />
                <path d="M3 3 21 21l-1.4 1.4L1.6 4.4 3 3Z" fill="currentColor" />
              </svg>
            </div>
            <div className={styles.kpiBody}>
              <div className={styles.kpiValue}>{totalOcultados}</div>
              <div className={styles.kpiLabel}>OCULTADOS DO CMV</div>
            </div>
          </div>

          <div className={styles.kpiCard}>
            <div className={styles.kpiIcon}>
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M4 4h16v16H4V4Zm2 4h12V6H6v2Zm0 4h12v-2H6v2Zm0 4h8v-2H6v2Z"
                  fill="currentColor"
                />
              </svg>
            </div>
            <div className={styles.kpiBody}>
              <div className={styles.kpiValueRow}>
                <span className={styles.kpiValue}>{categories.length}</span>
                <button
                  type="button"
                  className={styles.kpiLink}
                  onClick={openCategories}
                >
                  Ver Categorias
                </button>
              </div>
              <div className={styles.kpiLabel}>CATEGORIAS</div>
            </div>
          </div>
        </section>

        <section className={styles.filters}>
          <div className={styles.search}>
            <span className={styles.searchIcon}>
              <IconSearch />
            </span>
            <input
              className={styles.searchInput}
              placeholder="Pesquise por itens..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <select className={styles.select} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="Todas">Todas</option>
            {categoriesSorted.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.importBtn}
              onClick={() => {
                setIsNewItemOpen(false);
                setBulkDeleteMode(false);
                setSelectedIds(new Set());
                setIsImportOpen(true);
              }}
            >
              <IconUpload />
              Importar
            </button>
            <button type="button" className={styles.newBtn} onClick={openNewItem}>
              <IconPlus />
              Novo Item
            </button>
            <button
              type="button"
              className={styles.bulkDeleteBtn}
              onClick={() => {
                if (!bulkDeleteMode) {
                  toggleBulkMode();
                  return;
                }
                if (!selectedCount) {
                  toggleBulkMode();
                  return;
                }
                openBulkDeleteConfirm();
              }}
            >
              {bulkDeleteMode ? (selectedCount ? `Excluir (${selectedCount})` : "Cancelar") : "Excluir vários"}
            </button>
          </div>
        </section>

        <div className={styles.tableWrap}>
          <section className={styles.table}>
            <div className={styles.tableHead} style={{ gridTemplateColumns }}>
              <div className={styles.thSmall}>Ocultar</div>

              {columnOrder.map((col) => {
                const label =
                  col === "item"
                    ? "Item"
                    : col === "medida"
                      ? "Medida"
                      : col === "custoMedio"
                        ? "Custo Médio"
                        : col === "categoria"
                          ? "Categoria"
                          : "Especificação";
                const thClass = col === "item" ? styles.thItem : col === "especificacao" ? styles.thGrow : styles.th;
                return (
                  <div
                    key={col}
                    className={`${thClass} ${styles.thDraggable}`}
                    draggable
                    onDragStart={(e) => {
                      setDraggingColumn(col);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", col);
                    }}
                    onDragEnd={() => setDraggingColumn(null)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => onColumnDrop(col)}
                  >
                    <div className={styles.thInner}>
                      {col === "item" && bulkDeleteMode ? (
                        <label className={styles.headSelect}>
                          <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
                          <span />
                        </label>
                      ) : null}
                      <button type="button" className={styles.thBtn} onClick={() => toggleSort(col)}>
                        {label} {sortKey === col ? <SortIcon dir={sortDir} /> : null}
                      </button>
                    </div>
                  </div>
                );
              })}

              <div className={styles.thActions}>Ações</div>
            </div>

            {!visibleRows.length ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyTitle}>Nenhum insumo cadastrado</div>
                <div className={styles.emptyText}>Clique em “Novo Item” ou “Importar” para começar.</div>
              </div>
            ) : (
              visibleRows.map((r) => (
                <div key={r.id} className={styles.tr} style={{ gridTemplateColumns }}>
                  <div className={styles.tdSmall}>
                    <label className={styles.toggle}>
                      <input type="checkbox" checked={r.ocultar} onChange={() => toggleOcultar(r.id)} />
                      <span className={styles.toggleTrack} aria-hidden />
                    </label>
                  </div>

                  {columnOrder.map((col) => {
                    if (col === "item") {
                      const itemHref = `/dashboard?itemId=${encodeURIComponent(r.id)}&tab=entradas`;
                      return (
                        <div key={col}>
                          {bulkDeleteMode ? (
                            <div className={styles.tdItem}>
                              <input
                                type="checkbox"
                                className={styles.rowSelect}
                                checked={selectedIds.has(r.id)}
                                onChange={() => toggleRowSelected(r.id)}
                                aria-label={`Selecionar ${r.item}`}
                              />
                              <span className={styles.itemIcon}>
                                <IconCube />
                              </span>
                              <span className={styles.itemName}>{r.item}</span>
                            </div>
                          ) : (
                            <Link href={itemHref} className={`${styles.tdItem} ${styles.tdItemLink}`} aria-label={`Abrir detalhes do item ${r.item}`}>
                              <span className={styles.itemIcon}>
                                <IconCube />
                              </span>
                              <span className={styles.itemName}>{r.item}</span>
                            </Link>
                          )}
                        </div>
                      );
                    }
                    if (col === "medida") return <div key={col} className={styles.td}>{r.medida}</div>;
                    if (col === "custoMedio") return <div key={col} className={styles.tdStrong}>{r.custoMedio}</div>;
                    if (col === "categoria") return <div key={col} className={styles.td}>{r.categoria}</div>;
                    return (
                      <div key={col} className={styles.tdMuted}>
                        {r.especificacao}
                      </div>
                    );
                  })}

                <div className={styles.tdActions}>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    aria-label="Editar"
                    onClick={() => openEditItem(r)}
                    disabled={bulkDeleteMode}
                  >
                    <IconEdit />
                  </button>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    aria-label="Excluir"
                    disabled={bulkDeleteMode}
                    onClick={() => openDeleteItem(r)}
                  >
                    <IconTrash />
                  </button>
                </div>
              </div>
              ))
            )}
          </section>
        </div>

        {isDeleteItemOpen ? (
          <div className={styles.modalOverlay} role="presentation" onClick={() => setIsDeleteItemOpen(false)}>
            <div className={styles.modal} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitle}>Excluir Item?</div>
                <button type="button" className={styles.modalClose} aria-label="Fechar" onClick={() => setIsDeleteItemOpen(false)}>
                  ×
                </button>
              </div>

              <div className={styles.confirmBody}>
                <div className={styles.confirmIcon}>
                  <IconTrash />
                </div>
                <div className={styles.confirmText}>
                  Caso exclua o item <strong>“{deletingItemName}”</strong> não poderá recuperá-lo.
                </div>
              </div>

              <div className={styles.confirmActions}>
                <button type="button" className={styles.confirmDelete} onClick={confirmDeleteItem}>
                  Excluir
                </button>
                <button type="button" className={styles.confirmCancel} onClick={() => setIsDeleteItemOpen(false)}>
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {isBulkDeleteOpen ? (
          <div className={styles.modalOverlay} role="presentation" onClick={() => setIsBulkDeleteOpen(false)}>
            <div className={styles.modal} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitle}>Excluir Itens?</div>
                <button type="button" className={styles.modalClose} aria-label="Fechar" onClick={() => setIsBulkDeleteOpen(false)}>
                  ×
                </button>
              </div>

              <div className={styles.confirmBody}>
                <div className={styles.confirmIcon}>
                  <IconTrash />
                </div>
                <div className={styles.confirmText}>
                  Caso exclua {selectedCount === 1 ? <>o item selecionado</> : <>{selectedCount} itens selecionados</>} não poderá recuperá-
                  {selectedCount === 1 ? "lo" : "los"}.
                </div>
              </div>

              <div className={styles.confirmActions}>
                <button type="button" className={styles.confirmDelete} onClick={confirmBulkDelete}>
                  Excluir
                </button>
                <button type="button" className={styles.confirmCancel} onClick={() => setIsBulkDeleteOpen(false)}>
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {isImportOpen ? (
          <div className={styles.modalOverlay} role="presentation" onClick={() => setIsImportOpen(false)}>
            <div className={styles.modal} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitle}>Importar Itens por Planilha</div>
                <button type="button" className={styles.modalClose} aria-label="Fechar" onClick={() => setIsImportOpen(false)}>
                  ×
                </button>
              </div>

              <div className={styles.modalBody}>
                <div className={styles.notice}>
                  <div className={styles.noticeTitle}>Importante:</div>
                  <div className={styles.noticeText}>
                    • Informe apenas categorias já cadastradas e unidades de medida válidas (Und, Kg, g, L).
                    <br />• Atenção ao uso correto de letras maiúsculas e minúsculas e espaços para evitar erros na importação.
                  </div>
                </div>

                <div className={styles.templateRow}>
                  <button type="button" className={styles.templateBtn} onClick={downloadTemplateXlsx}>
                    Baixar planilha modelo (.xlsx)
                  </button>
                  <button type="button" className={styles.templateBtn} onClick={downloadTemplateCsv}>
                    Baixar modelo (.csv)
                  </button>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className={styles.fileInput}
                  onChange={(e) => {
                    const file = e.currentTarget.files?.[0] ?? null;
                    setSelectedFileName(file?.name ?? null);
                    setSelectedFile(file);
                  }}
                />

                {selectedFileName ? <div className={styles.fileName}>Arquivo selecionado: {selectedFileName}</div> : null}
              </div>

              <div className={styles.modalFooter}>
                <button type="button" className={styles.modalCancel} onClick={() => setIsImportOpen(false)}>
                  Encerrar
                </button>
                <button type="button" className={styles.modalPrimary} onClick={onImport} disabled={importing}>
                  {selectedFile ? (importing ? "Importando..." : "Importar") : "Selecionar planilha"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {isNewItemOpen ? (
          <div className={styles.modalOverlay} role="presentation">
            <div className={styles.modal} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitle}>Cadastro de Item</div>
                <button type="button" className={styles.modalClose} aria-label="Fechar" onClick={() => setIsNewItemOpen(false)}>
                  ×
                </button>
              </div>

              <div className={styles.formBody}>
                <div className={styles.formField}>
                  <div className={styles.formLabel}>Nome do Item</div>
                  <input
                    className={styles.formInput}
                    placeholder="Ex: Carne Bovina"
                    value={newItemName}
                    onChange={(e) => setNewItemName(e.target.value)}
                  />
                </div>

                <div className={styles.formField}>
                  <div className={styles.formLabelRow}>
                    <div className={styles.formLabel}>Categoria</div>
                    <button type="button" className={styles.addCategory} onClick={openCategories}>
                      ADD Categoria
                    </button>
                  </div>
                  <select className={styles.formSelect} value={newCategory} onChange={(e) => setNewCategory(e.target.value)}>
                    <option value="">Selecione</option>
                    {categoriesSorted.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div className={styles.formField}>
                  <div className={styles.formLabel}>Especificação</div>
                  <input
                    className={styles.formInput}
                    placeholder='Ex: "Item para produção de receita X."'
                    value={newSpec}
                    onChange={(e) => setNewSpec(e.target.value)}
                  />
                </div>

                <div className={styles.formField}>
                  <div className={styles.formLabel}>Unidade de Medida</div>
                  <select className={styles.formSelect} value={newUnit} onChange={(e) => setNewUnit(e.target.value)}>
                    <option value="">Selecione</option>
                    <option value="Und">Und</option>
                    <option value="Kg">Kg</option>
                    <option value="g">g</option>
                    <option value="L">L</option>
                    <option value="ml">ml</option>
                  </select>
                </div>

                <div className={styles.formField}>
                  <div className={styles.formLabel}>Custo Inicial</div>
                  <div className={styles.moneyRow}>
                    <div className={styles.moneyPrefix}>R$</div>
                    <input
                      className={styles.moneyInput}
                      placeholder="0,00"
                      inputMode="decimal"
                      value={newInitialCost}
                      onChange={(e) => setNewInitialCost(formatMoneyDraft(e.target.value))}
                      onBlur={(e) => setNewInitialCost(formatMoneyDraft(e.target.value))}
                    />
                  </div>
                </div>
              </div>

              <div className={styles.modalFooter}>
                <button
                  type="button"
                  className={styles.modalPrimaryWide}
                  onClick={saveNewItem}
                  disabled={!newItemName.trim() || !newCategory.trim() || !newSpec.trim() || !newUnit.trim() || !newInitialCost.trim()}
                >
                  Salvar
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {isEditItemOpen ? (
          <div className={styles.modalOverlay} role="presentation">
            <div className={styles.modal} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitle}>Editar Item</div>
                <button type="button" className={styles.modalClose} aria-label="Fechar" onClick={() => setIsEditItemOpen(false)}>
                  ×
                </button>
              </div>

              <div className={styles.formBody}>
                <div className={styles.formField}>
                  <div className={styles.formLabel}>Nome do Item</div>
                  <input
                    className={styles.formInput}
                    placeholder="Ex: Carne Bovina"
                    value={newItemName}
                    onChange={(e) => setNewItemName(e.target.value)}
                  />
                </div>

                <div className={styles.formField}>
                  <div className={styles.formLabelRow}>
                    <div className={styles.formLabel}>Categoria</div>
                    <button type="button" className={styles.addCategory} onClick={openCategories}>
                      ADD Categoria
                    </button>
                  </div>
                  <select className={styles.formSelect} value={newCategory} onChange={(e) => setNewCategory(e.target.value)}>
                    <option value="">Selecione</option>
                    {categoriesSorted.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div className={styles.formField}>
                  <div className={styles.formLabel}>Especificação</div>
                  <input
                    className={styles.formInput}
                    placeholder='Ex: "Item para produção de receita X."'
                    value={newSpec}
                    onChange={(e) => setNewSpec(e.target.value)}
                  />
                </div>

                <div className={styles.formField}>
                  <div className={styles.formLabel}>Unidade de Medida</div>
                  <select className={styles.formSelect} value={newUnit} onChange={(e) => setNewUnit(e.target.value)}>
                    <option value="">Selecione</option>
                    {newUnit && !["Und", "Kg", "g", "L", "ml"].includes(newUnit) ? <option value={newUnit}>{newUnit}</option> : null}
                    <option value="Und">Und</option>
                    <option value="Kg">Kg</option>
                    <option value="g">g</option>
                    <option value="L">L</option>
                    <option value="ml">ml</option>
                  </select>
                </div>

                <div className={styles.formField}>
                  <div className={styles.formLabel}>Custo Inicial</div>
                  <div className={styles.moneyRow}>
                    <div className={styles.moneyPrefix}>R$</div>
                    <input
                      className={styles.moneyInput}
                      placeholder="0,00"
                      inputMode="decimal"
                      value={newInitialCost}
                      onChange={(e) => setNewInitialCost(formatMoneyDraft(e.target.value))}
                      onBlur={(e) => setNewInitialCost(formatMoneyDraft(e.target.value))}
                    />
                  </div>
                </div>
              </div>

              <div className={styles.modalFooter}>
                <button
                  type="button"
                  className={styles.modalPrimaryWide}
                  onClick={saveEditItem}
                  disabled={!newItemName.trim() || !newCategory.trim() || !newSpec.trim() || !newUnit.trim() || !newInitialCost.trim()}
                >
                  Salvar
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {isCategoriesOpen ? (
          <div className={styles.modalOverlay} role="presentation" onClick={() => setIsCategoriesOpen(false)}>
            <div className={`${styles.modal} ${styles.categoriesModal}`} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitle}>Categorias de Itens</div>
                <button type="button" className={styles.modalClose} aria-label="Fechar" onClick={() => setIsCategoriesOpen(false)}>
                  ×
                </button>
              </div>

              <div className={styles.categoriesBody}>
                <div className={styles.categoriesLabel}>Nome da Categoria</div>
                <div className={styles.categoriesRow}>
                  <input
                    className={styles.categoriesInput}
                    placeholder="Ex: Proteínas"
                    value={categoryNewDraft}
                    onChange={(e) => setCategoryNewDraft(e.target.value)}
                  />
                  <button type="button" className={styles.categoriesAddBtn} onClick={addCategory} disabled={!normalizeCategoryName(categoryNewDraft)}>
                    <IconPlus /> ADD
                  </button>
                </div>
                <div className={styles.categoriesDivider} />

                <div className={styles.categoriesList}>
                  {categoriesSorted.map((c) => (
                    <div key={c} className={styles.categoryItem}>
                      {editingCategoryOriginal === c ? (
                        <>
                          <input
                            className={styles.categoryInlineInput}
                            value={editingCategoryDraft}
                            onChange={(e) => setEditingCategoryDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") confirmEditCategory();
                              if (e.key === "Escape") cancelEditCategory();
                            }}
                            autoFocus
                          />
                          <div className={styles.categoryCount} />
                          <div className={styles.categoryActions}>
                            <button
                              type="button"
                              className={`${styles.categoryIconBtn} ${styles.categoryIconBtnConfirm}`}
                              aria-label="Confirmar edição"
                              onClick={confirmEditCategory}
                              disabled={!normalizeCategoryName(editingCategoryDraft)}
                            >
                              <IconCheck />
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className={styles.categoryName}>{c}</div>
                          <div className={styles.categoryCount}>{categoryCounts.get(c) ?? 0}</div>
                          <div className={styles.categoryActions}>
                            <button type="button" className={styles.categoryIconBtn} aria-label="Editar categoria" onClick={() => editCategory(c)}>
                              <IconEdit />
                            </button>
                            <button type="button" className={styles.categoryIconBtn} aria-label="Excluir categoria" onClick={() => openDeleteCategory(c)}>
                              <IconTrash />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {isDeleteCategoryOpen ? (
          <div className={styles.modalOverlay} role="presentation" onClick={cancelDeleteCategory}>
            <div className={styles.modal} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitle}>Excluir Categoria?</div>
                <button type="button" className={styles.modalClose} aria-label="Fechar" onClick={cancelDeleteCategory}>
                  ×
                </button>
              </div>

              <div className={styles.confirmBody}>
                <div className={styles.confirmIcon}>
                  <IconTrash />
                </div>
                <div className={styles.confirmText}>
                  Caso exclua a categoria <strong>“{deletingCategoryName}”</strong> não poderá recuperá-la.
                  {deletingCategoryCount ? (
                    <>
                      <br />
                      Existem <strong>{deletingCategoryCount}</strong> itens nessa categoria; eles ficarão sem categoria.
                    </>
                  ) : null}
                </div>
              </div>

              <div className={styles.confirmActions}>
                <button type="button" className={styles.confirmDelete} onClick={confirmDeleteCategory}>
                  Excluir
                </button>
                <button type="button" className={styles.confirmCancel} onClick={cancelDeleteCategory}>
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
