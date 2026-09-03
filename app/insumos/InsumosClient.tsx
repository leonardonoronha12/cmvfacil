"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import dash from "../dashboard/dashboard.module.css";
import SystemToast from "../components/SystemToast";
import LoadingSpinner from "../components/LoadingSpinner";
import useCappedLoading from "../components/useCappedLoading";
import usePagination from "../components/usePagination";
import { readInsumosFromStore, writeInsumosToStore, type InsumoStoreItem } from "../lib/insumosStore";
import { readInsumoCategoriasFromStore, writeInsumoCategoriasToStore } from "../lib/insumoCategoriasStore";
import {
  checkInsumoUsage,
  checkInsumosUsageBatch,
  deleteInsumoFromSupabase,
  deleteInsumosBatchFromSupabase,
  loadInsumosStateFromSupabase,
  saveInsumosStateToSupabase,
  type InsumosStatePayload,
} from "../lib/insumosSupabase";
import { readEntradasFromStore, subscribeEntradas, writeEntradasToStore, type EntradaStoreRow } from "../lib/entradasStore";
import { loadEntradasFromSupabase } from "../lib/entradasSupabase";
import { readFornecedorEquivalenciasMap, subscribeFornecedorEquivalencias, writeFornecedorEquivalenciasMap, type FornecedorEquivalenciasMap } from "../lib/fornecedoresStore";
import { loadFornecedoresStateFromSupabase } from "../lib/fornecedoresSupabase";
import { readSectorsFromStore, subscribeSectors, writeSectorsToStore, type SectorRow } from "../lib/sectorsStore";
import {
  deleteSectorFromSupabase,
  loadSectorsFromSupabase,
  saveItemSectorsToSupabase,
  saveSectorToSupabase,
} from "../lib/sectorsSupabase";
import { QaModePanel } from "../lib/qaMode";
import styles from "./insumos.module.css";

type InsumoRow = {
  id: string;
  ocultar: boolean;
  item: string;
  medida: string;
  custoMedio: string;
  categoria: string;
  especificacao: string;
  sectorIds?: string[];
};

function isUuidValue(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value ?? "").trim());
}

function normalizeCategoryName(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeSectorName(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 80);
}

function getSectorItemCount(sectorId: string, links: Array<{ itemId: string; sectorId: string }>): number {
  let c = 0;
  for (const l of links) if (l.sectorId === sectorId) c++;
  return c;
}

function resolveSectorNamesToIds(
  names: string[] | undefined,
  sectors: SectorRow[],
): string[] {
  if (!names?.length) return [];
  const byName = new Map<string, string>();
  for (const s of sectors) byName.set(normalizeSectorName(s.name).toLowerCase(), s.id);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const key = normalizeSectorName(raw).toLowerCase();
    if (!key) continue;
    const id = byName.get(key);
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

function canonicalItemId(value: unknown): string {
  return String(value ?? "").trim().replace(/^db:/i, "");
}

function buildItemSectorIds(
  dataRows: InsumoRow[],
  loadedLinks: Array<{ itemId: string; sectorId: string }>,
  loadedSectors: SectorRow[],
  geralId: string | null,
): Map<string, string[]> {
  const byItem = new Map<string, string[]>();
  for (const r of dataRows) {
    if (r.sectorIds?.length) {
      const ids = resolveSectorNamesToIds(r.sectorIds, loadedSectors);
      if (ids.length) {
        byItem.set(r.id, ids);
        continue;
      }
    }
    const rowItemId = canonicalItemId(r.id);
    const fromLinks = loadedLinks.filter((l) => canonicalItemId(l.itemId) === rowItemId).map((l) => l.sectorId);
    const uniq = Array.from(new Set(fromLinks)).filter(Boolean);
    if (uniq.length) byItem.set(r.id, uniq);
    else if (geralId) byItem.set(r.id, [geralId]);
  }
  return byItem;
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
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function detectCsvDelimiter(line: string) {
  let inQuotes = false;
  let commas = 0;
  let semis = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] ?? "";
    if (ch === '"') {
      const next = line[i + 1] ?? "";
      if (inQuotes && next === '"') {
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (inQuotes) continue;
    if (ch === ",") commas++;
    else if (ch === ";") semis++;
  }
  return semis >= commas ? ";" : ",";
}

function parseCsvLine(line: string, delimiter: "," | ";" = ",") {
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
    if (ch === delimiter && !inQuotes) {
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
    if (idx.setores == null && (h.includes("setor") || h.includes("sector") || h.includes("area") || h.includes("ambiente"))) idx.setores = i;
  }
  return idx;
}

function parseRowsFromTable(table: unknown[][]) {
  const safe = table.filter((r) => Array.isArray(r) && r.some((c) => String(c ?? "").trim() !== ""));
  if (!safe.length) return [];

  const map = detectColumnMap(safe[0] ?? []);
  const hasHeader = map.item != null || map.medida != null || map.custoMedio != null || map.categoria != null || map.especificacao != null || map.setores != null;
  const startIndex = hasHeader ? 1 : 0;

  const fallback = { item: 0, medida: 1, custoMedio: 2, categoria: 3, especificacao: 4, ocultar: 5 };
  const getIndex = (key: keyof typeof fallback) => (map[key] != null ? map[key]! : fallback[key]);
  const sectorIdx = map.setores ?? null;

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

    const sectorNamesRaw = sectorIdx != null ? String(row[sectorIdx] ?? "").trim() : "";
    let sectorNames: string[] | undefined = undefined;
    if (sectorNamesRaw) {
      sectorNames = sectorNamesRaw
        .split(/[|;,]/g)
        .map((s) => s.replace(/\s+/g, " ").trim())
        .filter(Boolean);
    }

    out.push({
      id: String(out.length + 1),
      ocultar: Boolean(ocultar),
      item,
      medida: String(row[getIndex("medida")] ?? "").trim() || "-",
      custoMedio: toMoney(row[getIndex("custoMedio")]) || "-",
      categoria: String(row[getIndex("categoria")] ?? "").trim() || "-",
      especificacao: String(row[getIndex("especificacao")] ?? "").trim() || "-",
      sectorIds: sectorNames?.length ? sectorNames : undefined,
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

function parseBrlToCents(input: string) {
  const s = String(input ?? "").replace(/[^\d,.-]/g, "").trim();
  if (!s) return 0;
  const neg = s.includes("-");
  const cleaned = s.replace(/-/g, "");
  const parts = cleaned.split(",");
  const intPart = (parts[0] ?? "").replace(/\./g, "").replace(/[^\d]/g, "") || "0";
  const decPart = (parts[1] ?? "").replace(/[^\d]/g, "").padEnd(2, "0").slice(0, 2);
  const cents = Number.parseInt(intPart, 10) * 100 + Number.parseInt(decPart || "0", 10);
  return neg ? -cents : cents;
}

function formatBrlFromCents(cents: number) {
  const v = Math.abs(cents);
  const intPart = Math.floor(v / 100);
  const dec = String(v % 100).padStart(2, "0");
  const intLabel = String(intPart).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${cents < 0 ? "-" : ""}R$${intLabel},${dec}`;
}

function parsePtNumber(value: string) {
  const s = String(value ?? "").replace(/[^\d,.-]/g, "").trim();
  if (!s) return 0;
  const neg = s.includes("-");
  const cleaned = s.replace(/-/g, "");
  const parts = cleaned.split(",");
  const intPart = (parts[0] ?? "").replace(/\./g, "").replace(/[^\d]/g, "") || "0";
  const decPart = (parts[1] ?? "").replace(/[^\d]/g, "");
  const num = Number.parseFloat(`${intPart}.${decPart}`);
  return neg ? -num : num;
}

function parseQtyLabel(input: string) {
  const raw = String(input ?? "").trim();
  if (!raw) return { qty: 0, unit: "" };
  const m = raw.match(/^([0-9.,-]+)\s*([A-Za-zÀ-ÿ]+)?$/);
  if (!m) return { qty: parsePtNumber(raw), unit: "" };
  const qty = parsePtNumber(m[1] ?? "");
  const unit = String(m[2] ?? "").trim();
  return { qty, unit };
}

function normalizeKey(value: string) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
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
  const [mounted, setMounted] = useState(false);
  const [isLoadingTable, setIsLoadingTable] = useState(() => readInsumosFromStore().length === 0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isDeletingItem, setIsDeletingItem] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [sourceMeta, setSourceMeta] = useState<{ source: "legacy" | "compat"; readOnly: boolean }>({ source: "legacy", readOnly: false });
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isNewItemOpen, setIsNewItemOpen] = useState(false);
  const [isEditItemOpen, setIsEditItemOpen] = useState(false);
  const [isSavingEditItem, setIsSavingEditItem] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [isDeleteItemOpen, setIsDeleteItemOpen] = useState(false);
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);
  const [deletingItemName, setDeletingItemName] = useState<string>("");
  const [deletingItemUsage, setDeletingItemUsage] = useState<any>(null);
  const [bulkDeleteMode, setBulkDeleteMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [dataRows, setDataRows] = useState<InsumoRow[]>(() =>
    readInsumosFromStore().map((row) => ({
      id: row.id,
      ocultar: Boolean(row.ocultar),
      item: row.item,
      medida: row.medida || "Und",
      custoMedio: row.custoMedio || "-",
      categoria: row.categoria || "-",
      especificacao: row.especificacao || "-",
      sectorIds: row.sectorIds,
    })),
  );
  const [entradas, setEntradas] = useState<EntradaStoreRow[]>([]);
  const [fornecedorEquivalenciasMap, setFornecedorEquivalenciasMap] = useState<FornecedorEquivalenciasMap>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const rowsReadyRef = useRef(false);
  const loadFailedRef = useRef(false);
  const syncTimeoutRef = useRef<number | null>(null);
  const saveErrorShownRef = useRef(false);
  const persistedSnapshotRef = useRef("");
  const categoriesReadyRef = useRef(false);
  const [toast, setToast] = useState<{
    title: string;
    message: string;
    tone: "success" | "error";
    durationMs?: number;
    icon?: "success" | "error" | "loading";
  } | null>(null);

  const [newItemName, setNewItemName] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [newSpec, setNewSpec] = useState("");
  const [newUnit, setNewUnit] = useState("");
  const [newInitialCost, setNewInitialCost] = useState("");
  const [newSectorIds, setNewSectorIds] = useState<string[]>([]);
  const [editSectorIds, setEditSectorIds] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [isCategoriesOpen, setIsCategoriesOpen] = useState(false);
  const [categoryNewDraft, setCategoryNewDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("Todas");
  const [sectors, setSectors] = useState<SectorRow[]>([]);
  const sectorsReadyRef = useRef(false);
  const [itemSectorLinks, setItemSectorLinks] = useState<Array<{ itemId: string; sectorId: string }>>([]);
  const [isSectorsOpen, setIsSectorsOpen] = useState(false);
  const [sectorNewDraft, setSectorNewDraft] = useState("");
  const [editingSectorId, setEditingSectorId] = useState<string | null>(null);
  const [editingSectorDraft, setEditingSectorDraft] = useState("");
  const [isDeleteSectorOpen, setIsDeleteSectorOpen] = useState(false);
  const [deletingSectorId, setDeletingSectorId] = useState<string | null>(null);
  const [deletingSectorName, setDeletingSectorName] = useState("");
  const [deletingSectorLinks, setDeletingSectorLinks] = useState<{ itemLinks: number; counts: number }>({ itemLinks: 0, counts: 0 });
  const [sectorSearch, setSectorSearch] = useState("");
  const [sectorAction, setSectorAction] = useState<string | null>(null);
  const itemSectorSyncRef = useRef<number | null>(null);
  const isReadOnly = Boolean(sourceMeta.readOnly);
  const isCompatSource = sourceMeta.source === "compat";

  function showToast(message: string, type: "success" | "error", durationMs = 4500, title?: string, icon?: "success" | "error" | "loading") {
    setToast({ title: title ?? (type === "success" ? "Sucesso" : "Erro"), message, tone: type, durationMs, icon });
  }

  function saveErrorMessage(err: unknown) {
    const msg = (err instanceof Error ? err.message : String(err ?? "")).trim();
    if (!msg) return "Não foi possível salvar no Supabase.";
    if (msg === "unauthorized" || msg.includes("401")) return "Sessão expirada. Faça login novamente.";
    if (msg.includes("insumos_state") && msg.toLowerCase().includes("does not exist")) return "Tabela insumos_state não existe no Supabase.";
    return `Não foi possível salvar no Supabase (${msg}).`;
  }

  function deleteErrorMessage(err: unknown) {
    const payload = (err as any)?.payload;
    if (payload?.humanMessage && typeof payload.humanMessage === "string") return payload.humanMessage;
    const msg = (err instanceof Error ? err.message : String(err ?? "")).trim();
    if (!msg) return "Não foi possível excluir o insumo.";
    if (msg === "unauthorized" || msg.includes("401")) return "Sessão expirada. Faça login novamente.";
    if (msg === "compat_required") return "Sua sessão ainda não está no modo compat. Atualize a página e tente novamente.";
    if (msg.includes("conflict_links") || msg.includes("used_in_recipe")) {
      if (payload?.recipeNames && Array.isArray(payload.recipeNames) && payload.recipeNames.length > 0) {
        const list = payload.recipeNames.slice(0, 8).join(", ");
        return `Usado em receitas: ${list}. Não é possível excluir.`;
      }
      return "Esse insumo tem vínculos e não pode ser excluído diretamente.";
    }
    return `Não foi possível excluir o insumo (${msg}).`;
  }

  function isBootstrapRunning() {
    try {
      return window.sessionStorage.getItem("cmvfacil:bootstrapRunning:v5") === "1";
    } catch {
      return false;
    }
  }

  function maskToken(raw: string) {
    const t = String(raw ?? "").trim();
    if (!t) return "";
    if (t.length <= 10) return `${t.slice(0, 3)}…`;
    return `${t.slice(0, 6)}…${t.slice(-4)}`;
  }

  async function runAutoImportDiagnosis() {
    setAutoImportDiag((prev) => ({ ...prev, loading: false, error: "" }));
  }

  async function resumeAutoImport() {
    showToast("Importação automática desativada (modo CSV-only).", "error", 7000);
  }

  async function checkAutoImportStatusIfEmpty(nextRows: InsumoRow[], meta: { source: "legacy" | "compat"; readOnly: boolean }) {
    void nextRows;
    void meta;
  }

  function applyLoadedState(state: InsumosStatePayload) {
    const meta = state.meta ?? { source: "legacy" as const, readOnly: false };
    setSourceMeta(meta);

    const mapped = (state.rows ?? []).map((s, idx) => ({
      id: String(s.id || idx + 1),
      ocultar: Boolean(s.ocultar),
      item: String(s.item ?? "").trim(),
      medida: String(s.medida ?? "").trim() || "Und",
      custoMedio: String(s.custoMedio ?? "").trim() || "-",
      categoria: String(s.categoria ?? "").trim() || "-",
      especificacao: String(s.especificacao ?? "").trim() || "-",
    }));
    rowsReadyRef.current = true;
    setDataRows(mapped);

    const fromRows = getUniqueCategoriesFromRows(mapped);
    const merged: string[] = [];
    const seen = new Set<string>();
    for (const c of [...(state.categories ?? []), ...fromRows]) {
      const name = normalizeCategoryName(c);
      if (!name || name === "-") continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(name);
    }
    setCategories(merged);
    categoriesReadyRef.current = true;

    persistedSnapshotRef.current = JSON.stringify({
      rows: mapped.map((r) => ({
        id: r.id,
        item: r.item,
        medida: r.medida,
        custoMedio: r.custoMedio,
        categoria: r.categoria,
        especificacao: r.especificacao,
        ocultar: r.ocultar,
      })),
      categories: merged,
    });

    writeInsumosToStore(state.rows ?? []);
    writeInsumoCategoriasToStore(merged);

    return { mapped, meta };
  }

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        loadFailedRef.current = false;
        setLoadError(null);
        if (readInsumosFromStore().length) {
          setIsLoadingTable(false);
        }
        const state = await loadInsumosStateFromSupabase();
        applyLoadedState(state);
      } catch (err) {
        loadFailedRef.current = true;
        rowsReadyRef.current = false;
        categoriesReadyRef.current = false;
        const msg = err instanceof Error ? err.message : String(err);
        const message = msg.includes("missing_company")
          ? "Não foi possível identificar a empresa desta conta. Atualize a sessão ou entre novamente. Nenhum dado foi alterado."
          : `Não foi possível carregar os insumos. Detalhes: ${msg}`;
        setLoadError(message);
        showToast(message, "error", 9000);
      } finally {
        setIsLoadingTable(false);
      }
    })();
  }, []);

  useEffect(() => {
    setEntradas(readEntradasFromStore([]));
    void (async () => {
      try {
        const db = await loadEntradasFromSupabase();
        if (db.length) writeEntradasToStore(db);
      } catch {}
      setEntradas(readEntradasFromStore([]));
    })();
    return subscribeEntradas((rows) => setEntradas(rows));
  }, []);

  useEffect(() => {
    setFornecedorEquivalenciasMap(readFornecedorEquivalenciasMap());
    void (async () => {
      let nextEq: FornecedorEquivalenciasMap = {};
      try {
        const db = await loadFornecedoresStateFromSupabase();
        const hasDb = Object.keys(db.info).length || Object.keys(db.produtos).length || Object.keys(db.equivalencias).length;
        if (hasDb) nextEq = db.equivalencias;
      } catch {}
      writeFornecedorEquivalenciasMap(nextEq);
      setFornecedorEquivalenciasMap(nextEq);
    })();
    return subscribeFornecedorEquivalencias((m) => setFornecedorEquivalenciasMap(m));
  }, []);

  useEffect(() => {
    setSectors(readSectorsFromStore());
    void (async () => {
      try {
        const loaded = await loadSectorsFromSupabase();
        if (loaded.sectors.length) writeSectorsToStore(loaded.sectors);
        setSectors(loaded.sectors);
        setItemSectorLinks(loaded.itemLinks ?? []);
        sectorsReadyRef.current = true;
        if (rowsReadyRef.current) {
          setDataRows((prev) => {
            const geralId = loaded.sectors.find((s) => normalizeSectorName(s.name).toLowerCase() === "geral")?.id ?? null;
            const resolved = buildItemSectorIds(prev, loaded.itemLinks ?? [], loaded.sectors, geralId);
            return prev.map((r) => {
              const sec = resolved.get(r.id) ?? (geralId ? [geralId] : []);
              if (!sec.length || (r.sectorIds?.length && String(r.sectorIds) === String(sec))) return r;
              if (!r.sectorIds && sec.length === 1 && sec[0] === geralId) return r;
              return { ...r, sectorIds: sec };
            });
          });
        }
      } catch {}
    })();
    return subscribeSectors((rows) => setSectors(rows));
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
        sectorIds: r.sectorIds,
      })),
    );
  }, [dataRows]);

  useEffect(() => {
    if (loadFailedRef.current) return;
    if (!rowsReadyRef.current || !categoriesReadyRef.current) return;
    if (isReadOnly) return;
    if (isBootstrapRunning()) return;
    if (syncTimeoutRef.current) window.clearTimeout(syncTimeoutRef.current);
    if (itemSectorSyncRef.current) window.clearTimeout(itemSectorSyncRef.current);
    syncTimeoutRef.current = window.setTimeout(() => {
      const storeRows = dataRows.map((r) => ({
        id: r.id,
        item: r.item,
        medida: r.medida,
        custoMedio: r.custoMedio,
        categoria: r.categoria,
        especificacao: r.especificacao,
        ocultar: r.ocultar,
        sectorIds: r.sectorIds,
      }));
      const snapshot = JSON.stringify({
        rows: storeRows.map((r) => ({
          id: r.id,
          item: r.item,
          medida: r.medida,
          custoMedio: r.custoMedio,
          categoria: r.categoria,
          especificacao: r.especificacao,
          ocultar: r.ocultar,
        })),
        categories,
      });
      if (snapshot === persistedSnapshotRef.current) return;
      void saveInsumosStateToSupabase({ rows: storeRows as any, categories })
        .then(() => {
          persistedSnapshotRef.current = snapshot;
          saveErrorShownRef.current = false;
        })
        .catch((err) => {
          if (saveErrorShownRef.current) return;
          saveErrorShownRef.current = true;
          showToast(saveErrorMessage(err), "error");
        });
    }, 650);
    if (!sectorsReadyRef.current) return;
    itemSectorSyncRef.current = window.setTimeout(() => {
      const geralId = sectors.find((s) => normalizeSectorName(s.name).toLowerCase() === "geral")?.id ?? null;
      const payload: Array<{ itemId: string; sectorIds: string[] }> = [];
      for (const r of dataRows) {
        let ids = Array.isArray(r.sectorIds) ? r.sectorIds.filter((x) => isUuidValue(x)) : [];
        if (!ids.length && geralId) ids = [geralId];
        payload.push({ itemId: canonicalItemId(r.id), sectorIds: ids });
      }
      if (!payload.length) return;
      void saveItemSectorsToSupabase(payload)
        .then(() => {
          setItemSectorLinks(
            payload.flatMap((entry) => entry.sectorIds.map((sectorId) => ({ itemId: entry.itemId, sectorId }))),
          );
        })
        .catch((err) => {
          showToast(`Não foi possível salvar vínculos de setor (${err?.message ?? err}).`, "error");
        });
    }, 900);
  }, [dataRows, categories, isReadOnly, sectors]);

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
  const [isAutoImportDiagOpen, setIsAutoImportDiagOpen] = useState(false);
  const [autoImportDiag, setAutoImportDiag] = useState<{
    loading: boolean;
    meUserId: string;
    bubbleBaseUrl: string;
    bubbleTokenMasked: string;
    statusJson: any | null;
    error: string;
  }>({ loading: false, meUserId: "", bubbleBaseUrl: "", bubbleTokenMasked: "", statusJson: null, error: "" });

  function toggleOcultar(id: string) {
    if (isReadOnly) {
      showToast("Modo somente leitura.", "error");
      return;
    }
    setDataRows((prev) => {
      const nextRows = prev.map((r) => (r.id === id ? { ...r, ocultar: !r.ocultar } : r));
      const changed = nextRows.find((r) => r.id === id) ?? null;
      if (changed) showToast(changed.ocultar ? "Item ocultado do CMV Real." : "Item incluído no CMV Real.", "success");
      writeInsumosToStore(
        nextRows.map((r) => ({
          id: r.id,
          item: r.item,
          medida: r.medida,
          custoMedio: r.custoMedio,
          categoria: r.categoria,
          especificacao: r.especificacao,
          ocultar: r.ocultar,
        })),
      );
      if (isBootstrapRunning()) return nextRows;
      void saveInsumosStateToSupabase({
        rows: nextRows.map((r) => ({
          id: r.id,
          item: r.item,
          medida: r.medida,
          custoMedio: r.custoMedio,
          categoria: r.categoria,
          especificacao: r.especificacao,
          ocultar: r.ocultar,
        })) as any,
        categories,
      })
        .then(() => {
          saveErrorShownRef.current = false;
        })
        .catch((err) => {
          const desired = changed?.ocultar;
          void (async () => {
            try {
              await new Promise((r) => window.setTimeout(r, 700));
              await saveInsumosStateToSupabase({
                rows: nextRows.map((r) => ({
                  id: r.id,
                  item: r.item,
                  medida: r.medida,
                  custoMedio: r.custoMedio,
                  categoria: r.categoria,
                  especificacao: r.especificacao,
                  ocultar: r.ocultar,
                })) as any,
                categories,
              });
              saveErrorShownRef.current = false;
            } catch (err2) {
              if (typeof desired === "boolean") {
                setDataRows((cur) => {
                  const reverted = cur.map((r) => (r.id === id && r.ocultar === desired ? { ...r, ocultar: !desired } : r));
                  writeInsumosToStore(
                    reverted.map((r) => ({
                      id: r.id,
                      item: r.item,
                      medida: r.medida,
                      custoMedio: r.custoMedio,
                      categoria: r.categoria,
                      especificacao: r.especificacao,
                      ocultar: r.ocultar,
                    })),
                  );
                  return reverted;
                });
              }
              showToast(saveErrorMessage(err2), "error");
            }
          })();
        });
      return nextRows;
    });
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
        const delim = detectCsvDelimiter(lines[0] ?? "");
        table = lines.map((l) => parseCsvLine(l, delim));
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

      const importedRaw = parseRowsFromTable(table);
      if (!importedRaw.length) throw new Error("Nenhum item encontrado na planilha.");
      const imported = importedRaw.map((row, idx) => ({
        ...row,
        id: typeof crypto !== "undefined" && "randomUUID" in crypto ? (crypto as any).randomUUID() : `${Date.now()}-${idx}`,
      }));
      const mergedCategories = (() => {
        const seen = new Set(categories.map((c) => c.toLowerCase()));
        const next = [...categories];
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
      })();
      if (!isReadOnly && !isBootstrapRunning()) {
        try {
          await saveInsumosStateToSupabase({
            rows: imported.map((r) => ({
              id: r.id,
              item: r.item,
              medida: r.medida,
              custoMedio: r.custoMedio,
              categoria: r.categoria,
              especificacao: r.especificacao,
              ocultar: r.ocultar,
            })) as any,
            categories: mergedCategories,
          });
          persistedSnapshotRef.current = JSON.stringify({
            rows: imported.map((r) => ({
              id: r.id,
              item: r.item,
              medida: r.medida,
              custoMedio: r.custoMedio,
              categoria: r.categoria,
              especificacao: r.especificacao,
              ocultar: r.ocultar,
            })),
            categories: mergedCategories,
          });
          saveErrorShownRef.current = false;
          showToast(`Importação concluída: ${imported.length} item(ns).`, "success");
        } catch (err) {
          showToast(saveErrorMessage(err), "error");
          return;
        }
      }
      setDataRows(imported);
      setCategories(mergedCategories);
      setIsImportOpen(false);
      setSelectedFile(null);
      setSelectedFileName(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error", 8000);
    } finally {
      setImporting(false);
    }
  }

  async function downloadTemplateCsv() {
    try {
      const res = await fetch("/api/insumos-templates?kind=csv&download=1", { method: "GET" });
      if (res.ok) {
        const blob = await res.blob();
        const name = res.headers.get("x-template-filename")?.trim() || "modelo-planilha-insumos.csv";
        downloadBlob(blob, name);
        return;
      }
    } catch {}
    const sep = ";";
    const rows = [
      ["Item", "Medida", "Custo Médio", "Categoria", "Setores", "Especificação", "Ocultar"],
      ["Álcool", "L", "4,39", "Limpeza", "Geral", "-", "false"],
      ["Amido de milho", "Kg", "38,15", "Matéria Prima", "Geral|Cozinha", "-", "false"],
    ];
    const csv = "\uFEFF" + rows.map((r) => r.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(sep)).join("\n");
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), "modelo-planilha-insumos.csv");
  }

  async function downloadTemplateXlsx() {
    try {
      const res = await fetch("/api/insumos-templates?kind=xlsx&download=1", { method: "GET" });
      if (res.ok) {
        const blob = await res.blob();
        const name = res.headers.get("x-template-filename")?.trim() || "modelo-planilha-insumos.xlsx";
        downloadBlob(blob, name);
        return;
      }
    } catch {}
    const XLSX = await import("xlsx");
    const unitOptions = [
      "Und",
      "Un",
      "Kg",
      "g",
      "mg",
      "L",
      "ml",
      "Cx",
      "Pc",
      "Pct",
      "Fardo",
      "Saco",
      "Lata",
      "Garrafa",
      "Pote",
      "Balde",
      "Galão",
      "Caixa",
      "Pacote",
      "Bandeja",
      "Dúzia",
    ];
    const categoryOptions = categories
      .map((c) => normalizeCategoryName(c))
      .filter((c) => c && c !== "-")
      .slice(0, 50)
      .map((c) => c.replaceAll('"', "").replaceAll(",", " "));
    const sectorOptions = sectorsSorted
      .map((s) => normalizeSectorName(s.name))
      .filter(Boolean)
      .slice(0, 50)
      .map((c) => c.replaceAll('"', "").replaceAll(",", " ").replaceAll("|", " "));
    const categoryList = categoryOptions.length ? categoryOptions : ["-"];
    const sectorList = sectorOptions.length ? sectorOptions : ["Geral"];
    const listMax = Math.max(unitOptions.length, categoryOptions.length, sectorOptions.length, 1);
    const listRows: (string | null)[][] = [["Medidas", "Categorias", "Setores"]];
    for (let i = 0; i < listMax; i++) {
      listRows.push([unitOptions[i] ?? "", categoryList[i] ?? "", sectorList[i] ?? ""]);
    }
    const rows = [
      ["Item", "Medida", "Custo Médio", "Categoria", "Setores", "Especificação", "Ocultar"],
      ["Álcool", "L", "4,39", "Limpeza", "Geral", "-", false],
      ["Amido de milho", "Kg", "38,15", "Matéria Prima", "Geral|Cozinha", "-", false],
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wsLists = XLSX.utils.aoa_to_sheet(listRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Insumos");
    XLSX.utils.book_append_sheet(wb, wsLists, "Listas");
    const unitRef = `Listas!$A$2:$A$${unitOptions.length + 1}`;
    const catRef = `Listas!$B$2:$B$${categoryList.length + 1}`;
    const secRef = `Listas!$C$2:$C$${sectorList.length + 1}`;
    (wb as any).Workbook = {
      Names: [
        { Name: "Medidas", Ref: unitRef },
        { Name: "Categorias", Ref: catRef },
        { Name: "Setores", Ref: secRef },
      ],
    };
    (ws as any)["!dataValidation"] = [
      { type: "list", allowBlank: 1, sqref: "B2:B500", formulas: ["Medidas"] },
      { type: "list", allowBlank: 1, sqref: "D2:D500", formulas: ["Categorias"] },
      { type: "list", allowBlank: 1, sqref: "G2:G500", formulas: ['"FALSE,TRUE"'] },
    ];
    const array = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    downloadBlob(new Blob([array], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "modelo-planilha-insumos.xlsx");
  }

  function openNewItem() {
    if (isReadOnly) {
      showToast("Modo somente leitura.", "error");
      return;
    }
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
    setNewSectorIds(geralSector?.id ? [geralSector.id] : []);
    setIsNewItemOpen(true);
  }

  function saveNewItem() {
    if (isReadOnly) {
      showToast("Modo somente leitura.", "error");
      return;
    }
    const item = newItemName.trim();
    if (!item) return;
    const medida = newUnit.trim() || "-";
    const categoria = normalizeCategoryName(newCategory) || "-";
    const especificacao = newSpec.trim() || "-";
    const custoMedio = newInitialCost.trim() ? (newInitialCost.trim().startsWith("R$") ? newInitialCost.trim() : `R$${newInitialCost.trim()}`) : "-";
    const effectiveSectorIds = getEffectiveDraftIds("new");

    const nextCategories =
      categoria !== "-" && !categories.some((c) => c.toLowerCase() === categoria.toLowerCase()) ? [...categories, categoria] : categories;
    if (nextCategories !== categories) setCategories(nextCategories);

    const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? (crypto as any).randomUUID() : String(Date.now());
    const row: InsumoRow = {
      id,
      ocultar: false,
      item,
      medida,
      custoMedio,
      categoria,
      especificacao,
      sectorIds: effectiveSectorIds.length ? effectiveSectorIds : undefined,
    };
    setDataRows((prev) => {
      const nextRows = [row, ...prev];
      writeInsumosToStore(
        nextRows.map((r) => ({
          id: r.id,
          item: r.item,
          medida: r.medida,
          custoMedio: r.custoMedio,
          categoria: r.categoria,
          especificacao: r.especificacao,
          ocultar: r.ocultar,
          sectorIds: r.sectorIds,
        })),
      );
      void saveInsumosStateToSupabase({
        rows: nextRows.map((r) => ({
          id: r.id,
          item: r.item,
          medida: r.medida,
          custoMedio: r.custoMedio,
          categoria: r.categoria,
          especificacao: r.especificacao,
          ocultar: r.ocultar,
          sectorIds: r.sectorIds,
        })) as any,
        categories: nextCategories,
      })
        .then(() => {
          saveErrorShownRef.current = false;
        })
        .catch((err) => {
          showToast(saveErrorMessage(err), "error");
        });
      showToast("Insumo cadastrado!", "success");
      return nextRows;
    });
    setIsNewItemOpen(false);
  }

  function openEditItem(row: InsumoRow) {
    if (isReadOnly) {
      showToast("Modo somente leitura.", "error");
      return;
    }
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
    const rowItemId = canonicalItemId(row.id);
    const linksFor = itemSectorLinks.filter((l) => canonicalItemId(l.itemId) === rowItemId).map((l) => l.sectorId);
    const fallback = geralSector?.id ? [geralSector.id] : [];
    const editIds: string[] = (Array.isArray(row.sectorIds) ? row.sectorIds : []).filter((x) => isUuidValue(x));
    const merged = Array.from(new Set([...editIds, ...linksFor])).filter(Boolean);
    setEditSectorIds(merged.length ? merged : fallback);
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
    if (isReadOnly) {
      showToast("Modo somente leitura.", "error");
      return;
    }
    setIsImportOpen(false);
    setIsNewItemOpen(false);
    setIsEditItemOpen(false);
    setEditingItemId(null);
    setBulkDeleteMode(false);
    setSelectedIds(new Set());
    setDeletingItemId(row.id);
    setDeletingItemName(row.item);
    setDeletingItemUsage(null);
    setIsDeleteItemOpen(true);
    if (isCompatSource) {
      const raw = String(row.id ?? "").trim();
      const isDb = raw.startsWith("db:");
      const uuid = isDb ? raw.slice("db:".length) : raw;
      const bubbleId = !isDb && /^\d{6,}x\d{6,}$/.test(raw) ? raw : "";
      void (async () => {
        try {
          const usage = await checkInsumoUsage({
            id: isDb ? uuid : isUuidValue(uuid) ? uuid : undefined,
            bubbleId: bubbleId || undefined,
            source: "compat",
          });
          setDeletingItemUsage(usage);
        } catch (err) {
          try {
            const payload = (err as any)?.payload;
            if (payload && ((payload as any).error === "used_in_recipe" || (payload as any).humanMessage)) {
              setDeletingItemUsage({ ...(payload ?? {}), ok: false, hasRecipeLinks: true, suggestedAction: "block" });
            }
          } catch {}
        }
      })();
    }
  }

  async function confirmDeleteItem() {
    const id = deletingItemId;
    if (!id) return;
    if (isDeletingItem) return;

    const rowSnapshot = dataRows.find((r) => r.id === id) ?? null;
    const rowIndex = rowSnapshot ? dataRows.findIndex((r) => r.id === id) : -1;

    setIsDeletingItem(true);

    const rollbackVisual = () => {
      if (rowSnapshot) {
        setDataRows((prev) => {
          if (prev.some((r) => r.id === id)) return prev;
          const insertAt = rowIndex >= 0 ? Math.min(rowIndex, prev.length) : prev.length;
          const clone = prev.slice();
          clone.splice(insertAt, 0, rowSnapshot);
          return clone;
        });
      }
    };

    const buildDeleteErrorMessage = (err: unknown) => {
      const payload = (err as any)?.payload;
      if (payload?.humanMessage && typeof payload.humanMessage === "string") return payload.humanMessage;
      const rawErr = String((err as any)?.error ?? (err as any)?.message ?? "");
      if (rawErr.includes("conflict_links") || rawErr.includes("used_in_recipe")) {
        if (payload?.recipeNames && Array.isArray(payload.recipeNames) && payload.recipeNames.length > 0) {
          const list = payload.recipeNames.slice(0, 8).join(", ");
          return `Usado em receitas: ${list}. Não é possível excluir.`;
        }
        return "Esse insumo tem vínculos e não pode ser excluído diretamente.";
      }
      return saveErrorMessage(err);
    };

    const closeCleanup = () => {
      setIsDeleteItemOpen(false);
      setDeletingItemId(null);
      setDeletingItemName("");
      setDeletingItemUsage(null);
      setIsDeletingItem(false);
    };

    if (isCompatSource) {
      setDataRows((prev) => prev.filter((r) => r.id !== id));
      void (async () => {
        try {
          const raw = String(id ?? "").trim();
          const isDb = raw.startsWith("db:");
          const uuid = isDb ? raw.slice("db:".length) : raw;
          const bubbleId = !isDb && /^\d{6,}x\d{6,}$/.test(raw) ? raw : "";
          const res = await deleteInsumoFromSupabase({
            id: isDb ? uuid : isUuidValue(uuid) ? uuid : undefined,
            bubbleId: bubbleId || undefined,
            source: "compat",
          });
          const wasArchived = Boolean((res as any)?.archived) || (typeof (res as any)?.archivedCount === "number" && (res as any).archivedCount > 0);
          const countOk = (typeof (res as any)?.deletedCount === "number" ? (res as any).deletedCount : 0) + (wasArchived ? 1 : 0);
          if (!countOk) throw new Error("deletedCount=0");
          const nextRows = dataRows.filter((r) => r.id !== id);
          writeInsumosToStore(
            nextRows.map((r) => ({
              id: r.id,
              item: r.item,
              medida: r.medida,
              custoMedio: r.custoMedio,
              categoria: r.categoria,
              especificacao: r.especificacao,
              ocultar: r.ocultar,
            })),
          );
          const mergedCats = Array.from(
            new Set(
              [...categories, ...getUniqueCategoriesFromRows(nextRows)].map((x) => normalizeCategoryName(x)).filter(Boolean) as string[],
            ),
          ).sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base", numeric: true }));
          setCategories(mergedCats);
          writeInsumoCategoriasToStore(mergedCats);
          showToast(wasArchived ? "Item arquivado do catálogo." : "Item excluído.", "success");
          closeCleanup();
        } catch (err) {
          rollbackVisual();
          showToast(buildDeleteErrorMessage(err), "error");
          setIsDeletingItem(false);
        }
      })();
      return;
    }

    setDataRows((prev) => {
      const nextRows = prev.filter((r) => r.id !== id);
      writeInsumosToStore(
        nextRows.map((r) => ({
          id: r.id,
          item: r.item,
          medida: r.medida,
          custoMedio: r.custoMedio,
          categoria: r.categoria,
          especificacao: r.especificacao,
          ocultar: r.ocultar,
        })),
      );
      if (!isBootstrapRunning()) {
        void saveInsumosStateToSupabase({
          rows: nextRows.map((r) => ({
            id: r.id,
            item: r.item,
            medida: r.medida,
            custoMedio: r.custoMedio,
            categoria: r.categoria,
            especificacao: r.especificacao,
            ocultar: r.ocultar,
          })) as any,
          categories,
        })
          .then(() => {
            saveErrorShownRef.current = false;
            closeCleanup();
          })
          .catch((err) => {
            rollbackVisual();
            showToast(saveErrorMessage(err), "error");
            setIsDeletingItem(false);
          });
      } else {
        closeCleanup();
      }
      return nextRows;
    });
    showToast("Item excluído.", "success");
  }

  async function saveEditItem() {
    const id = editingItemId;
    if (!id || isSavingEditItem) return;
    const item = newItemName.trim();
    if (!item) return;
    const medida = newUnit.trim() || "-";
    const categoria = normalizeCategoryName(newCategory) || "-";
    const especificacao = newSpec.trim() || "-";
    const custoMedio = newInitialCost.trim() ? (newInitialCost.trim().startsWith("R$") ? newInitialCost.trim() : `R$${newInitialCost.trim()}`) : "-";
    const effectiveSectorIds = getEffectiveDraftIds("edit");

    const nextCategories =
      categoria !== "-" && !categories.some((c) => c.toLowerCase() === categoria.toLowerCase()) ? [...categories, categoria] : categories;
    const nextRows = dataRows.map((r) =>
        r.id === id
          ? {
              ...r,
              item,
              medida,
              categoria,
              especificacao,
              custoMedio,
              sectorIds: effectiveSectorIds.length ? effectiveSectorIds : r.sectorIds,
            }
          : r,
    );

    setIsSavingEditItem(true);
    try {
      await saveInsumosStateToSupabase({
        rows: nextRows.map((r) => ({
          id: r.id,
          item: r.item,
          medida: r.medida,
          custoMedio: r.custoMedio,
          categoria: r.categoria,
          especificacao: r.especificacao,
          ocultar: r.ocultar,
          sectorIds: r.sectorIds,
        })) as any,
        categories: nextCategories,
      });

      const snapshot = JSON.stringify({
        rows: nextRows.map((r) => ({
          id: r.id,
          item: r.item,
          medida: r.medida,
          custoMedio: r.custoMedio,
          categoria: r.categoria,
          especificacao: r.especificacao,
          ocultar: r.ocultar,
        })),
        categories: nextCategories,
      });
      persistedSnapshotRef.current = snapshot;
      saveErrorShownRef.current = false;
      setDataRows(nextRows);
      setCategories(nextCategories);
      setIsEditItemOpen(false);
      setEditingItemId(null);
      showToast("Item atualizado com sucesso.", "success");
    } catch (err) {
      showToast(saveErrorMessage(err), "error");
    } finally {
      setIsSavingEditItem(false);
    }
  }

  const categoryCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of dataRows) {
      const name = normalizeCategoryName(r.categoria ?? "");
      if (!name || name === "-") continue;
      const key = name.toLowerCase();
      map.set(key, (map.get(key) ?? 0) + 1);
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
    setDataRows((prev) => prev.map((r) => (normalizeCategoryName(r.categoria ?? "").toLowerCase() === fromKey ? { ...r, categoria: name } : r)));
    if (newCategory === from) setNewCategory(name);
    cancelEditCategory();
  }

  function openDeleteCategory(name: string) {
    if (isReadOnly) {
      showToast("Modo somente leitura.", "error");
      return;
    }
    const count = categoryCounts.get(name.toLowerCase()) ?? 0;
    if (count > 0) {
      showToast("Não é possível excluir uma categoria que possui itens vinculados.", "error");
      return;
    }
    setDeletingCategoryName(name);
    setDeletingCategoryCount(count);
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
    if (count > 0) {
      showToast("Não é possível excluir uma categoria que possui itens vinculados.", "error");
      cancelDeleteCategory();
      return;
    }
    setCategories((prev) => prev.filter((c) => c !== name));
    if (count) setDataRows((prev) => prev.map((r) => (normalizeCategoryName(r.categoria ?? "").toLowerCase() === name.toLowerCase() ? { ...r, categoria: "-" } : r)));
    if (newCategory === name) setNewCategory("");
    if (editingCategoryOriginal === name) cancelEditCategory();
    cancelDeleteCategory();
  }

  const sectorsSorted = useMemo(() => {
    const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });
    return [...sectors].sort((a, b) => {
      const aGeral = normalizeSectorName(a.name).toLowerCase() === "geral" ? 0 : 1;
      const bGeral = normalizeSectorName(b.name).toLowerCase() === "geral" ? 0 : 1;
      if (aGeral !== bGeral) return aGeral - bGeral;
      return collator.compare(a.name, b.name);
    });
  }, [sectors]);

  const sectorCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of dataRows) {
      if (r.sectorIds?.length) {
        for (const sid of r.sectorIds) {
          map.set(sid, (map.get(sid) ?? 0) + 1);
        }
      }
    }
    return map;
  }, [dataRows]);

  const geralSector = useMemo(
    () => sectorsSorted.find((s) => normalizeSectorName(s.name).toLowerCase() === "geral") ?? null,
    [sectorsSorted],
  );

  function openSectors() {
    if (isReadOnly) {
      showToast("Modo somente leitura.", "error");
      return;
    }
    setSectorNewDraft("");
    setEditingSectorId(null);
    setEditingSectorDraft("");
    setIsDeleteSectorOpen(false);
    setDeletingSectorId(null);
    setDeletingSectorName("");
    setDeletingSectorLinks({ itemLinks: 0, counts: 0 });
    setIsSectorsOpen(true);
  }

  function describeSectorError(code: string): string {
    switch (String(code ?? "")) {
      case "duplicate_sector":
        return "Já existe um setor com este nome na sua empresa.";
      case "missing_name":
        return "Informe o nome do setor.";
      case "missing_scope":
        return "Não foi possível identificar sua empresa. Recarregue e tente novamente.";
      case "not_found":
        return "Setor não encontrado.";
      case "cannot_delete_geral":
        return "Não é possível excluir o setor Geral.";
      case "sector_in_use":
        return "O setor está em uso e não pode ser excluído.";
      case "forbidden":
        return "Acesso negado. Contate o administrador.";
      default:
        return "";
    }
  }

  async function addSector() {
    const name = normalizeSectorName(sectorNewDraft);
    if (!name) return;
    if (sectorAction) return;
    const optimisticId = `optimistic:${Date.now()}`;
    const optimisticSector: SectorRow = { id: optimisticId, name };
    setSectorNewDraft("");
    setSectors((prev) => {
      const next = [...prev, optimisticSector];
      writeSectorsToStore(next);
      return next;
    });
    setSectorAction("create");
    try {
      const created = await saveSectorToSupabase({ name });
      setSectors((prev) => {
        const next = prev.map((sector) => (sector.id === optimisticId ? created : sector));
        writeSectorsToStore(next);
        return next;
      });
    } catch (err) {
      setSectors((prev) => {
        const next = prev.filter((sector) => sector.id !== optimisticId);
        writeSectorsToStore(next);
        return next;
      });
      setSectorNewDraft(name);
      const raw = String((err as any)?.message ?? String(err) ?? "");
      const msg = describeSectorError(raw) || `Não foi possível criar o setor (${raw}).`;
      showToast(msg, "error");
      return;
    } finally {
      setSectorAction(null);
    }
  }

  function editSector(row: SectorRow) {
    setEditingSectorId(row.id);
    setEditingSectorDraft(row.name);
  }

  function cancelEditSector() {
    setEditingSectorId(null);
    setEditingSectorDraft("");
  }

  async function confirmEditSector() {
    const id = editingSectorId;
    if (!id) return;
    const name = normalizeSectorName(editingSectorDraft);
    if (!name) return;
    if (sectorAction) return;
    const previousSector = sectors.find((sector) => sector.id === id);
    if (!previousSector) return;
    setSectors((prev) => {
      const next = prev.map((sector) => (sector.id === id ? { ...sector, name } : sector));
      writeSectorsToStore(next);
      return next;
    });
    cancelEditSector();
    setSectorAction(`edit:${id}`);
    try {
      const updated = await saveSectorToSupabase({ id, name });
      setSectors((prev) => {
        const next = prev.map((s) => (s.id === id ? { ...s, name: updated.name ?? s.name } : s));
        writeSectorsToStore(next);
        return next;
      });
    } catch (err) {
      setSectors((prev) => {
        const next = prev.map((sector) => (sector.id === id ? previousSector : sector));
        writeSectorsToStore(next);
        return next;
      });
      const raw = String((err as any)?.message ?? String(err) ?? "");
      const msg = describeSectorError(raw) || `Não foi possível renomear o setor (${raw}).`;
      showToast(msg, "error");
      return;
    } finally {
      setSectorAction(null);
    }
  }

  function openDeleteSector(row: SectorRow) {
    if (isReadOnly) {
      showToast("Modo somente leitura.", "error");
      return;
    }
    if (normalizeSectorName(row.name).toLowerCase() === "geral") {
      showToast("Não é possível excluir o setor Geral.", "error");
      return;
    }
    if (sectorAction) return;
    setDeletingSectorId(row.id);
    setDeletingSectorName(row.name);
    setDeletingSectorLinks({ itemLinks: sectorCounts.get(row.id) ?? 0, counts: 0 });
    setIsDeleteSectorOpen(true);
  }

  function cancelDeleteSector() {
    setIsDeleteSectorOpen(false);
    setDeletingSectorId(null);
    setDeletingSectorName("");
    setDeletingSectorLinks({ itemLinks: 0, counts: 0 });
  }

  async function confirmDeleteSector() {
    const id = deletingSectorId;
    if (!id) return;
    if (sectorAction) return;
    const previousSectors = sectors;
    const previousLinks = itemSectorLinks;
    const previousRows = dataRows;
    setSectors((prev) => {
      const next = prev.filter((sector) => sector.id !== id);
      writeSectorsToStore(next);
      return next;
    });
    setItemSectorLinks((prev) => prev.filter((link) => link.sectorId !== id));
    setDataRows((prev) => prev.map((row) => ({ ...row, sectorIds: row.sectorIds?.filter((sectorId) => sectorId !== id) })));
    cancelDeleteSector();
    setSectorAction(`delete:${id}`);
    try {
      await deleteSectorFromSupabase(id);
    } catch (err) {
      setSectors(previousSectors);
      writeSectorsToStore(previousSectors);
      setItemSectorLinks(previousLinks);
      setDataRows(previousRows);
      const raw = String((err as any)?.message ?? String(err) ?? "");
      showToast(describeSectorError(raw) || `Não foi possível excluir o setor (${raw}).`, "error");
    } finally {
      setSectorAction(null);
    }
  }

  function toggleDraftSectorId(target: "new" | "edit", id: string) {
    const setter = target === "new" ? setNewSectorIds : setEditSectorIds;
    const current = target === "new" ? newSectorIds : editSectorIds;
    setter((prev) => {
      const has = prev.includes(id);
      return has ? prev.filter((x) => x !== id) : [...prev, id];
    });
  }

  function getEffectiveDraftIds(target: "new" | "edit"): string[] {
    const raw = target === "new" ? newSectorIds : editSectorIds;
    const geral = geralSector?.id;
    const valid = raw.filter((x) => isUuidValue(x));
    if (!valid.length && geral) return [geral];
    return valid;
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
    if (isCompatSource) {
      void (async () => {
        try {
          const ids: string[] = [];
          const bubbleIds: string[] = [];
          for (const raw of Array.from(selectedIds)) {
            const s = String(raw ?? "").trim();
            if (!s) continue;
            if (s.startsWith("db:")) {
              const v = s.slice("db:".length);
              if (isUuidValue(v)) ids.push(v);
              continue;
            }
            if (/^\d{6,}x\d{6,}$/.test(s)) bubbleIds.push(s);
          }
          const res = await deleteInsumosBatchFromSupabase({ ids, bubbleIds, source: "compat" });
          const okCount = typeof (res as any)?.deletedCount === "number" ? (res as any).deletedCount : 0;
          const failed = Array.isArray((res as any)?.results) ? (res as any).results.filter((r: any) => !r?.ok) : [];
          const state = await loadInsumosStateFromSupabase(undefined, { source: "compat" });
          const meta = state.meta ?? { source: "legacy" as const, readOnly: false };
          setSourceMeta(meta);
          const mapped = (state.rows ?? []).map((s, idx) => ({
            id: String(s.id || idx + 1),
            ocultar: Boolean(s.ocultar),
            item: String(s.item ?? "").trim(),
            medida: String(s.medida ?? "").trim() || "Und",
            custoMedio: String(s.custoMedio ?? "").trim() || "-",
            categoria: String(s.categoria ?? "").trim() || "-",
            especificacao: String(s.especificacao ?? "").trim() || "-",
          }));
          setDataRows(mapped);
          const fromRows = getUniqueCategoriesFromRows(mapped);
          const merged: string[] = [];
          const seen = new Set<string>();
          for (const c of [...(state.categories ?? []), ...fromRows]) {
            const name = normalizeCategoryName(c);
            if (!name || name === "-") continue;
            const key = name.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            merged.push(name);
          }
          setCategories(merged);
          writeInsumosToStore(state.rows ?? []);
          writeInsumoCategoriasToStore(merged);
          if (failed.length) {
            const sample = String(failed[0]?.error ?? "falha").trim() || "falha";
            showToast(`Exclusão parcial: ${okCount} ok; ${failed.length} falha (${sample}).`, "error");
          } else {
            showToast(`${okCount} itens excluídos.`, "success");
          }
        } catch (err) {
          showToast(saveErrorMessage(err), "error");
        } finally {
          setSelectedIds(new Set());
          setBulkDeleteMode(false);
        }
      })();
      return;
    }
    setDataRows((prev) => {
      const nextRows = prev.filter((r) => !selectedIds.has(r.id));
      writeInsumosToStore(
        nextRows.map((r) => ({
          id: r.id,
          item: r.item,
          medida: r.medida,
          custoMedio: r.custoMedio,
          categoria: r.categoria,
          especificacao: r.especificacao,
          ocultar: r.ocultar,
        })),
      );
      if (isBootstrapRunning()) return nextRows;
      void saveInsumosStateToSupabase({
        rows: nextRows.map((r) => ({
          id: r.id,
          item: r.item,
          medida: r.medida,
          custoMedio: r.custoMedio,
          categoria: r.categoria,
          especificacao: r.especificacao,
          ocultar: r.ocultar,
        })) as any,
        categories,
      })
        .then(() => {
          saveErrorShownRef.current = false;
        })
        .catch((err) => {
          showToast(saveErrorMessage(err), "error");
        });
      return nextRows;
    });
    setSelectedIds(new Set());
    setBulkDeleteMode(false);
  }

  function openBulkDeleteConfirm() {
    setIsBulkDeleteOpen(true);
  }

  async function confirmBulkDelete() {
    if (!isCompatSource) {
      flushSync(() => {
        deleteSelected();
        setIsBulkDeleteOpen(false);
        showToast("Insumos excluídos com sucesso.", "success");
      });
      return;
    }
    if (!selectedIds.size) return;
    if (isBulkDeleting) return;
    setIsBulkDeleting(true);
    const rawIds = Array.from(selectedIds);
    const idsSet = new Set(rawIds);
    const rowsSnapshot = dataRows.filter((r) => idsSet.has(r.id));
    const prevRows = dataRows.slice();

    const rollbackLocal = () => {
      setDataRows(() => prevRows);
    };

    try {
      flushSync(() => {
        showToast(rawIds.length === 1 ? "Excluindo 1 item…" : `Excluindo ${rawIds.length} itens…`, "success", 12000, "Excluindo…", "loading");
        setIsBulkDeleteOpen(false);
        setSelectedIds(new Set());
        setBulkDeleteMode(false);
        setDataRows((prev) => prev.filter((r) => !idsSet.has(r.id)));
      });

      const ids: string[] = [];
      const bubbleIds: string[] = [];
      for (const raw of rawIds) {
        const s = String(raw ?? "").trim();
        if (!s) continue;
        if (s.startsWith("db:")) {
          const v = s.slice("db:".length);
          if (isUuidValue(v)) ids.push(v);
          continue;
        }
        if (/^\d{6,}x\d{6,}$/.test(s)) bubbleIds.push(s);
      }

      const res = await deleteInsumosBatchFromSupabase({ ids, bubbleIds, source: "compat" });
      const deletedOk = typeof (res as any)?.deletedCount === "number" ? (res as any).deletedCount : 0;
      const archivedOk = typeof (res as any)?.archivedCount === "number" ? (res as any).archivedCount : 0;
      const failures: any[] = Array.isArray((res as any)?.results) ? (res as any).results.filter((r: any) => !r?.ok) : [];
      if (failures.length) {
        showToast(
          deletedOk > 0 || archivedOk > 0
            ? `${deletedOk} excluído(s), ${archivedOk} arquivado(s). ${failures.length} não pode(m) ser processado(s).`
            : failures.length === 1
              ? "1 item não pode ser excluído ou arquivado."
              : `${failures.length} itens não podem ser excluídos ou arquivados.`,
          deletedOk || archivedOk ? "success" : "error",
        );
      } else {
        showToast(
          rawIds.length === 1
            ? archivedOk > 0
              ? "Insumo arquivado com sucesso."
              : "Insumo deletado com sucesso."
            : `${deletedOk} excluído(s) e ${archivedOk} arquivado(s) com sucesso.`,
          "success",
        );
      }
      const remainingRows = dataRows.filter((r) => !idsSet.has(r.id));
      writeInsumosToStore(
        remainingRows.map((r) => ({ id: r.id, item: r.item, medida: r.medida, custoMedio: r.custoMedio, categoria: r.categoria, especificacao: r.especificacao, ocultar: r.ocultar }))
      );
    } catch (err) {
      rollbackLocal();
      showToast(deleteErrorMessage(err), "error");
    } finally {
      setIsBulkDeleting(false);
    }
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

  const avgUnitCostCentsById = useMemo(() => {
    if (isReadOnly) return new Map<string, number>();
    const idByKey = new Map<string, string>();
    for (const row of dataRows) {
      const k = normalizeKey(row.item);
      if (!k || idByKey.has(k)) continue;
      idByKey.set(k, row.id);
    }
    const fornecedorKeyLookup = new Map<string, string>();
    for (const key of Object.keys(fornecedorEquivalenciasMap)) {
      const nk = normalizeKey(key);
      if (!nk || fornecedorKeyLookup.has(nk)) continue;
      fornecedorKeyLookup.set(nk, key);
    }
    const qtyById = new Map<string, number>();
    const centsById = new Map<string, number>();
    for (const e of entradas) {
      const fornecedorKey = fornecedorKeyLookup.get(normalizeKey(String(e.fornecedor ?? ""))) ?? String(e.fornecedor ?? "").trim().toUpperCase();
      const equivalencias = fornecedorEquivalenciasMap[fornecedorKey] ?? [];
      for (const it of e.itensNota ?? []) {
        const rawKey = normalizeKey(it.nome);
        let mappedKey = rawKey;
        let fator = 1;
        const eq = equivalencias.find((m) => normalizeKey(m.nomeNaNota) === rawKey) ?? null;
        if (eq) {
          mappedKey = normalizeKey(eq.insumoEquivalente);
          const f = parsePtNumber(String(eq.equivalenteQuantidade ?? ""));
          if (Number.isFinite(f) && f > 0) fator = f;
        }
        const id = idByKey.get(mappedKey);
        if (!id) continue;
        const { qty } = parseQtyLabel(it.quantidadeLabel ?? "");
        const qtyEq = qty * fator;
        if (!Number.isFinite(qtyEq) || qtyEq <= 0) continue;
        let sub = parseBrlToCents(it.subtotalLabel ?? "");
        if (!sub) {
          const unit = parseBrlToCents(it.custoUnitarioLabel ?? "");
          if (unit && qtyEq > 0) sub = Math.round(unit * qtyEq);
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
  }, [dataRows, entradas, fornecedorEquivalenciasMap, isReadOnly]);

  const displayCostLabelById = useMemo(() => {
    const out = new Map<string, string>();
    for (const r of dataRows) {
      const avgCents = avgUnitCostCentsById.get(r.id) ?? 0;
      if (avgCents > 0) out.set(r.id, formatBrlFromCents(avgCents));
      else out.set(r.id, r.custoMedio);
    }
    return out;
  }, [avgUnitCostCentsById, dataRows]);

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
        const aLabel = displayCostLabelById.get(a.r.id) ?? a.r.custoMedio;
        const bLabel = displayCostLabelById.get(b.r.id) ?? b.r.custoMedio;
        const av = parseCurrencyToNumber(aLabel);
        const bv = parseCurrencyToNumber(bLabel);
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
  }, [categoryFilter, dataRows, displayCostLabelById, searchQuery, sortDir, sortKey]);

  const pagination = usePagination({
    items: visibleRows,
    pageSize: 20,
    resetKey: `${searchQuery}|${categoryFilter}|${sortKey}|${sortDir}|${dataRows.length}`,
  });

  const tableLoading = useCappedLoading(isLoadingTable);

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

  const qaUi = useMemo(() => {
    const renderedRows = pagination.pageItems.map((r) => {
      const custoLabel = displayCostLabelById.get(r.id) ?? r.custoMedio;
      return {
        id: r.id,
        ocultar: Boolean(r.ocultar),
        item: r.item,
        medida: r.medida,
        custoMedio: custoLabel,
        categoria: r.categoria,
        especificacao: r.especificacao,
        selected: selectedIds.has(r.id),
      };
    });
    return {
      kpis: { totalItens, totalOcultados, categoriasCount: categories.length },
      filters: { searchQuery, categoryFilter },
      sort: { sortKey, sortDir, columnOrder },
      selection: { bulkDeleteMode, selectedCount, allSelected },
      rendered: { visibleRowsCount: pagination.totalItems, rows: renderedRows },
    };
  }, [
    allSelected,
    bulkDeleteMode,
    categories.length,
    categoryFilter,
    columnOrder,
    displayCostLabelById,
    pagination.pageItems,
    pagination.totalItems,
    searchQuery,
    selectedCount,
    selectedIds,
    sortDir,
    sortKey,
    totalItens,
    totalOcultados,
  ]);

  return (
    <>
      {toast ? (
        <SystemToast
          title={toast.title}
          message={toast.message}
          tone={toast.tone}
          icon={toast.icon}
          durationMs={toast.durationMs}
          onClose={() => setToast(null)}
        />
      ) : null}

      <main className={dash.content}>
        <div className={dash.pageFrame}>
          <QaModePanel screen="insumos" ui={qaUi} />
        <section className={styles.header}>
          <div className={styles.headerIcon}>
            <IconCube />
          </div>
          <div className={styles.headerText}>
            <h1 className={styles.title}>Insumos</h1>
            <p className={styles.subtitle}>Aqui você cadastra e gerencia todos os insumos do seu estoque.</p>
          </div>
        </section>

        {loadError ? <div className="cmv-alert cmv-alert-error">{loadError}</div> : null}

        {isCompatSource ? (
          <div
            style={{
              marginTop: 10,
              marginBottom: 14,
              padding: "10px 12px",
              borderRadius: 12,
              background: "#eef6ff",
              border: "1px solid #cfe6ff",
              color: "#1b3a57",
              fontSize: 13,
              fontWeight: 700,
              display: "none",
              justifyContent: "flex-end",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <span>{isReadOnly ? "Somente leitura" : "Editável"}</span>
          </div>
        ) : null}

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
                  disabled={isReadOnly}
                  onClick={() => {
                    if (isReadOnly) {
                      showToast("Modo somente leitura.", "error");
                      return;
                    }
                    openCategories();
                  }}
                >
                  <span data-tour="categories-open">Ver Categorias</span>
                </button>
              </div>
              <div className={styles.kpiLabel}>CATEGORIAS</div>
            </div>
          </div>

          <div className={styles.kpiCard}>
            <div className={styles.kpiIcon}>
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M3 3h8v8H3V3Zm10 0h8v8h-8V3ZM3 13h8v8H3v-8Zm10 2h8v-2h-8Zm0 4h8v-2h-8Zm0 4h8v-2h-8Z"
                  fill="currentColor"
                />
              </svg>
            </div>
            <div className={styles.kpiBody}>
              <div className={styles.kpiValueRow}>
                <span className={styles.kpiValue}>{sectorsSorted.length}</span>
                <button
                  type="button"
                  className={styles.kpiLink}
                  disabled={isReadOnly}
                  onClick={() => {
                    if (isReadOnly) {
                      showToast("Modo somente leitura.", "error");
                      return;
                    }
                    openSectors();
                  }}
                >
                  <span data-tour="sectors-open">Ver Setores</span>
                </button>
              </div>
              <div className={styles.kpiLabel}>SETORES</div>
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
              data-tour="insumos-import-open"
              className={styles.importBtn}
              disabled={isReadOnly}
              onClick={() => {
                if (isReadOnly) {
                  showToast("Modo somente leitura.", "error");
                  return;
                }
                setIsNewItemOpen(false);
                setBulkDeleteMode(false);
                setSelectedIds(new Set());
                setIsImportOpen(true);
              }}
            >
              <IconUpload />
              Importar
            </button>
            <button type="button" className={styles.newBtn} onClick={openNewItem} disabled={isReadOnly}>
              <IconPlus />
              Novo Item
            </button>
            <button
              type="button"
              className={styles.bulkDeleteBtn}
              disabled={isReadOnly}
              onClick={() => {
                if (isReadOnly) {
                  showToast("Modo somente leitura.", "error");
                  return;
                }
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
          {null}
          <section className={styles.table} style={{ position: "relative" }} data-qa-grid="insumos">
            {tableLoading.show ? (
              <div className={dash.loadingOverlay}>
                <LoadingSpinner />
              </div>
            ) : null}
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

            {!pagination.pageItems.length ? (
              isLoadingTable ? (
                <div className={styles.emptyState}>
                  <div className={styles.emptyTitle}>{tableLoading.timedOut ? "Carregamento em andamento" : "Carregando insumos..."}</div>
                  <div className={styles.emptyText}>
                    {tableLoading.timedOut ? "Ainda estamos carregando os insumos. Aguarde mais alguns segundos." : "Aguarde enquanto buscamos seus dados."}
                  </div>
                </div>
              ) : (
                <div className={styles.emptyState}>
                  <div className={styles.emptyTitle}>Nenhum insumo cadastrado</div>
                  <div className={styles.emptyText}>Clique em “Novo Item” ou “Importar” para começar.</div>
                </div>
              )
            ) : (
              pagination.pageItems.map((r) => (
                <div key={r.id} className={styles.tr} style={{ gridTemplateColumns }} data-qa-grid-row data-qa-row-id={r.id}>
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
                    if (col === "custoMedio") return <div key={col} className={styles.tdStrong}>{displayCostLabelById.get(r.id) ?? r.custoMedio}</div>;
                    if (col === "categoria") return (
                      <div key={col} className={styles.td}>
                        <div>{r.categoria}</div>
                        {(() => {
                          const ids = r.sectorIds ?? [];
                          const names = sectorsSorted
                            .filter((s) => ids.includes(s.id))
                            .map((s) => s.name);
                          if (!names.length) return null;
                          return (
                            <div
                              title={`Setores: ${names.join(", ")}`}
                              style={{
                                marginTop: 4,
                                fontSize: 10,
                                color: "#6b7280",
                                background: "#eef2ff",
                                padding: "2px 6px",
                                borderRadius: 4,
                                display: "inline-block",
                                lineHeight: 1.4,
                              }}
                            >
                              {names.length > 3
                                ? `${names.slice(0, 3).join(", ")} +${names.length - 3}`
                                : names.join(", ")}
                            </div>
                          );
                        })()}
                      </div>
                    );
                    return (
                      <div key={col} className={styles.tdMuted}>
                        {r.especificacao}
                      </div>
                    );
                  })}

                <div data-tour="insumo-actions" className={styles.tdActions}>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    aria-label="Editar"
                    onClick={() => openEditItem(r)}
                    disabled={bulkDeleteMode || isReadOnly}
                  >
                    <IconEdit />
                  </button>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    aria-label="Excluir"
                    disabled={bulkDeleteMode || isReadOnly}
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

        <div className={styles.footer}>
          <div>{`${pagination.totalItems} resultado(s) encontrado(s)`}</div>
          <div className={styles.pagination}>
            <button type="button" className={styles.pageBtn} disabled={pagination.page <= 1} aria-label="Primeira página" onClick={() => pagination.setPage(1)}>
              «
            </button>
            <button
              type="button"
              className={styles.pageBtn}
              disabled={pagination.page <= 1}
              aria-label="Página anterior"
              onClick={() => pagination.setPage(Math.max(1, pagination.page - 1))}
            >
              ‹
            </button>
            <div className={styles.pageInfo}>
              {pagination.page} de {pagination.totalPages}
            </div>
            <button
              type="button"
              className={styles.pageBtn}
              disabled={pagination.page >= pagination.totalPages}
              aria-label="Próxima página"
              onClick={() => pagination.setPage(Math.min(pagination.totalPages, pagination.page + 1))}
            >
              ›
            </button>
            <button
              type="button"
              className={styles.pageBtn}
              disabled={pagination.page >= pagination.totalPages}
              aria-label="Última página"
              onClick={() => pagination.setPage(pagination.totalPages)}
            >
              »
            </button>
          </div>
        </div>

        {mounted && isDeleteItemOpen ? (
          createPortal(
          <div className={styles.modalOverlay} role="presentation" onClick={() => { if (!isDeletingItem) setIsDeleteItemOpen(false); }}>
            <div className={styles.modal} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitle}>
                  {deletingItemUsage?.suggestedAction === "block" ? "Não é possível excluir" : deletingItemUsage?.suggestedAction === "archive" ? "Arquivar item?" : "Excluir Item?"}
                </div>
                <button type="button" className={styles.modalClose} aria-label="Fechar" onClick={() => { if (!isDeletingItem) setIsDeleteItemOpen(false); }} disabled={isDeletingItem}>
                  ×
                </button>
              </div>

              <div className={styles.confirmBody}>
                <div className={styles.confirmIcon}>
                  <IconTrash />
                </div>
                <div className={styles.confirmText}>
                  {deletingItemUsage?.suggestedAction === "block" ? (
                    <>
                      <div style={{ marginBottom: 8 }}>
                        O item <strong>“{deletingItemName}”</strong> está sendo usado em receitas ou fichas técnicas e não pode ser removido do catálogo.
                      </div>
                      {deletingItemUsage?.recipeNames?.length > 0 ? (
                        <div style={{ fontSize: 13, color: "#92400e", background: "#fffbeb", padding: "10px 12px", borderRadius: 8, lineHeight: 1.45 }}>
                          <strong>Receitas que usam esse insumo:</strong>
                          <div style={{ marginTop: 4 }}>{deletingItemUsage.recipeNames.slice(0, 10).join(", ")}{deletingItemUsage.recipeNames.length > 10 ? ` (+${deletingItemUsage.recipeNames.length - 10})` : ""}</div>
                        </div>
                      ) : deletingItemUsage?.humanMessage ? (
                        <div style={{ fontSize: 13, color: "#92400e", background: "#fffbeb", padding: "10px 12px", borderRadius: 8, lineHeight: 1.45 }}>
                          {deletingItemUsage.humanMessage}
                        </div>
                      ) : null}
                    </>
                  ) : deletingItemUsage?.suggestedAction === "archive" ? (
                    <>
                      <div style={{ marginBottom: 8 }}>
                        O item <strong>“{deletingItemName}”</strong> tem histórico de uso (entradas, inventários, desperdícios, fornecedores, custos). Ele será <strong>arquivado/ocultado</strong> do catálogo ativo, mas todos os históricos permanecem íntegros e legíveis.
                      </div>
                      {Array.isArray(deletingItemUsage?.links) && deletingItemUsage.links.length > 0 ? (
                        <div style={{ fontSize: 13, color: "#1f2937", background: "#f3f4f6", padding: "10px 12px", borderRadius: 8, lineHeight: 1.45 }}>
                          <strong>Vínculos detectados:</strong>
                          <ul style={{ margin: "6px 0 0 20px", padding: 0 }}>
                            {deletingItemUsage.links.slice(0, 8).map((l: any, i: number) => (
                              <li key={i}>
                                {l.table === "invoice_items" ? `Entradas (${l.count} registro${l.count > 1 ? "s" : ""})` :
                                 l.table === "inventory_items" ? `Inventários (${l.count})` :
                                 l.table === "wastes" ? `Desperdícios (${l.count})` :
                                 l.table === "supplier_items" ? `Cadastros de fornecedor (${l.count})` :
                                 l.table === "shopping_list_items" ? `Listas de compras (${l.count})` :
                                 l.table === "avg_cost_events" ? `Histórico de custos (${l.count})` :
                                 `${l.table} (${l.count})`}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <>Caso exclua o item <strong>“{deletingItemName}”</strong> não poderá recuperá-lo.</>
                  )}
                </div>
              </div>

              <div className={styles.confirmActions}>
                <button
                  type="button"
                  className={styles.confirmDelete}
                  onClick={confirmDeleteItem}
                  disabled={isDeletingItem || deletingItemUsage?.suggestedAction === "block"}
                >
                  {isDeletingItem
                    ? deletingItemUsage?.suggestedAction === "archive"
                      ? "Arquivando…"
                      : "Excluindo…"
                    : deletingItemUsage?.suggestedAction === "archive"
                      ? "Arquivar item"
                      : "Excluir"}
                </button>
                <button type="button" className={styles.confirmCancel} onClick={() => setIsDeleteItemOpen(false)} disabled={isDeletingItem}>
                  Cancelar
                </button>
              </div>
            </div>
          </div>,
          document.body,
          )
        ) : null}

        {mounted && isBulkDeleteOpen ? (
          createPortal(
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
                <button type="button" className={styles.confirmDelete} onClick={confirmBulkDelete} disabled={isBulkDeleting}>
                  Excluir
                </button>
                <button type="button" className={styles.confirmCancel} onClick={() => setIsBulkDeleteOpen(false)}>
                  Cancelar
                </button>
              </div>
            </div>
          </div>,
          document.body,
          )
        ) : null}

        {mounted && isImportOpen ? (
          createPortal(
          <div className={styles.modalOverlay} role="presentation" onClick={() => setIsImportOpen(false)}>
            <div className={styles.modal} role="dialog" aria-modal="true" data-tour="insumos-import-dialog" onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitle}>Importar Itens por Planilha</div>
                <button type="button" className={styles.modalClose} aria-label="Fechar" data-tour="insumos-import-close" onClick={() => setIsImportOpen(false)}>
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
                  {selectedFile ? (
                    importing ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <LoadingSpinner size={16} />
                        Importando...
                      </span>
                    ) : (
                      "Importar"
                    )
                  ) : (
                    "Selecionar planilha"
                  )}
                </button>
              </div>
            </div>
          </div>,
          document.body,
          )
        ) : null}

        {mounted && isNewItemOpen ? (
          createPortal(
          <div className={styles.modalOverlay} role="presentation">
            <div className={styles.modal} role="dialog" aria-modal="true" data-tour="insumos-new-dialog" onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitle}>Cadastro de Item</div>
                <button type="button" className={styles.modalClose} aria-label="Fechar" data-tour="insumos-new-close" onClick={() => setIsNewItemOpen(false)}>
                  ×
                </button>
              </div>

              <div className={styles.formBody}>
                <div className={styles.formField}>
                  <div className={styles.formLabel}>Nome do Item</div>
                  <input
                    data-tour="insumos-name"
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
                  <select className={styles.formSelect} data-tour="insumos-category" value={newCategory} onMouseDown={(e) => {
                    if (categoriesSorted.length) return;
                    e.preventDefault();
                    openCategories();
                    window.dispatchEvent(new Event("cmv:tour:category-required"));
                  }} onChange={(e) => setNewCategory(e.target.value)}>
                    <option value="">Selecione</option>
                    {categoriesSorted.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div className={styles.formField}>
                  <div className={styles.formLabelRow}>
                    <div className={styles.formLabel}>Setores (múltiplo)</div>
                    <button type="button" className={styles.addCategory} onClick={openSectors}>
                      Gerenciar Setores
                    </button>
                  </div>
                  <input
                    className={styles.formInput}
                    placeholder="Pesquisar setor..."
                    value={sectorSearch}
                    onChange={(e) => setSectorSearch(e.target.value)}
                    style={{ marginBottom: 10 }}
                  />
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {(() => {
                      const q = sectorSearch.trim().toLowerCase();
                      const filtered = sectorsSorted.filter((s) => !q || normalizeSectorName(s.name).toLowerCase().includes(q));
                      const effective = getEffectiveDraftIds("new");
                      if (!filtered.length) {
                        return <div className={styles.tdMuted} style={{ fontSize: 12 }}>Nenhum setor encontrado. Clique em “Gerenciar Setores” para cadastrar.</div>;
                      }
                      return filtered.map((s) => {
                        const selected = effective.includes(s.id);
                        const isGeral = normalizeSectorName(s.name).toLowerCase() === "geral";
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => toggleDraftSectorId("new", s.id)}
                            style={{
                              border: "none",
                              padding: "6px 10px",
                              borderRadius: 999,
                              fontSize: 12,
                              cursor: "pointer",
                              background: selected ? (isGeral ? "#1f6feb" : "#2563eb") : "#eef2f7",
                              color: selected ? "#fff" : "#1f2937",
                              fontWeight: selected ? 600 : 400,
                              lineHeight: 1,
                              userSelect: "none",
                            }}
                          >
                            {selected ? "✓ " : ""}
                            {s.name}
                          </button>
                        );
                      });
                    })()}
                  </div>
                  {getEffectiveDraftIds("new").length <= 1 && !newSectorIds.length ? (
                    <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>Aviso: será usado o setor “Geral” automaticamente.</div>
                  ) : null}
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
                  <select className={styles.formSelect} data-tour="insumos-unit" value={newUnit} onChange={(e) => setNewUnit(e.target.value)}>
                    <option value="">Selecione</option>
                    <option value="Und">Und</option>
                    <option value="Kg">Kg</option>
                    <option value="g">g</option>
                    <option value="L">L</option>
                  </select>
                </div>

                <div className={styles.formField}>
                  <div className={styles.formLabel}>Custo Inicial</div>
                  <div className={styles.moneyRow}>
                    <div className={styles.moneyPrefix}>R$</div>
                    <input
                      data-tour="insumos-cost"
                      className={styles.moneyInput}
                      placeholder="0,00"
                      inputMode="decimal"
                      value={newInitialCost}
                      onChange={(e) => setNewInitialCost(formatMoneyDraft(e.target.value))}
                      onBlur={(e) => setNewInitialCost(formatMoneyDraft(e.target.value))}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        const el = e.currentTarget;
                        requestAnimationFrame(() => el.select());
                      }}
                      onFocus={(e) => {
                        const el = e.currentTarget;
                        requestAnimationFrame(() => el.select());
                      }}
                      onClick={(e) => {
                        const el = e.currentTarget;
                        requestAnimationFrame(() => el.select());
                      }}
                    />
                  </div>
                </div>
              </div>

              <div className={styles.modalFooter}>
                <button
                  type="button"
                  data-tour="insumos-save"
                  className={styles.modalPrimaryWide}
                  onClick={saveNewItem}
                  disabled={!newItemName.trim() || !newCategory.trim() || !newUnit.trim() || !newInitialCost.trim()}
                >
                  Salvar
                </button>
              </div>
            </div>
          </div>,
          document.body,
          )
        ) : null}

        {mounted && isEditItemOpen ? (
          createPortal(
          <div className={styles.modalOverlay} role="presentation">
            <div className={styles.modal} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitle}>Editar Item</div>
                <button
                  type="button"
                  className={styles.modalClose}
                  aria-label="Fechar"
                  onClick={() => setIsEditItemOpen(false)}
                  disabled={isSavingEditItem}
                >
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
                  <div className={styles.formLabelRow}>
                    <div className={styles.formLabel}>Setores (múltiplo)</div>
                    <button type="button" className={styles.addCategory} onClick={openSectors}>
                      Gerenciar Setores
                    </button>
                  </div>
                  <input
                    className={styles.formInput}
                    placeholder="Pesquisar setor..."
                    value={sectorSearch}
                    onChange={(e) => setSectorSearch(e.target.value)}
                    style={{ marginBottom: 10 }}
                  />
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {(() => {
                      const q = sectorSearch.trim().toLowerCase();
                      const filtered = sectorsSorted.filter((s) => !q || normalizeSectorName(s.name).toLowerCase().includes(q));
                      const effective = getEffectiveDraftIds("edit");
                      if (!filtered.length) {
                        return <div className={styles.tdMuted} style={{ fontSize: 12 }}>Nenhum setor encontrado. Clique em “Gerenciar Setores” para cadastrar.</div>;
                      }
                      return filtered.map((s) => {
                        const selected = effective.includes(s.id);
                        const isGeral = normalizeSectorName(s.name).toLowerCase() === "geral";
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => toggleDraftSectorId("edit", s.id)}
                            style={{
                              border: "none",
                              padding: "6px 10px",
                              borderRadius: 999,
                              fontSize: 12,
                              cursor: "pointer",
                              background: selected ? (isGeral ? "#1f6feb" : "#2563eb") : "#eef2f7",
                              color: selected ? "#fff" : "#1f2937",
                              fontWeight: selected ? 600 : 400,
                              lineHeight: 1,
                              userSelect: "none",
                            }}
                          >
                            {selected ? "✓ " : ""}
                            {s.name}
                          </button>
                        );
                      });
                    })()}
                  </div>
                  {getEffectiveDraftIds("edit").length <= 1 && !editSectorIds.length ? (
                    <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>Aviso: será usado o setor “Geral” automaticamente.</div>
                  ) : null}
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
                    {newUnit && !["Und", "Kg", "g", "L"].includes(newUnit) ? <option value={newUnit}>{newUnit}</option> : null}
                    <option value="Und">Und</option>
                    <option value="Kg">Kg</option>
                    <option value="g">g</option>
                    <option value="L">L</option>
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
                      onMouseDown={(e) => {
                        e.preventDefault();
                        const el = e.currentTarget;
                        requestAnimationFrame(() => el.select());
                      }}
                      onFocus={(e) => {
                        const el = e.currentTarget;
                        requestAnimationFrame(() => el.select());
                      }}
                      onClick={(e) => {
                        const el = e.currentTarget;
                        requestAnimationFrame(() => el.select());
                      }}
                    />
                  </div>
                </div>
              </div>

              <div className={styles.modalFooter}>
                <button
                  type="button"
                  className={styles.modalPrimaryWide}
                  onClick={() => void saveEditItem()}
                  disabled={isSavingEditItem || !newItemName.trim() || !newCategory.trim() || !newUnit.trim() || !newInitialCost.trim()}
                >
                  {isSavingEditItem ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </div>
          </div>,
          document.body,
          )
        ) : null}

        {mounted && isCategoriesOpen ? (
          createPortal(
          <div className={styles.modalOverlay} role="presentation" onClick={() => setIsCategoriesOpen(false)}>
            <div className={`${styles.modal} ${styles.categoriesModal}`} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitle}>Categorias de Itens</div>
                <button type="button" className={styles.modalClose} aria-label="Fechar" data-tour="categories-close" onClick={() => {
                  setIsCategoriesOpen(false);
                  if (isNewItemOpen) window.dispatchEvent(new Event("cmv:tour:category-return"));
                }}>
                  ×
                </button>
              </div>

              <div className={styles.categoriesBody}>
                <div className={styles.categoriesLabel}>Nome da Categoria</div>
                <div className={styles.categoriesRow}>
                  <input
                    data-tour="category-name"
                    className={styles.categoriesInput}
                    placeholder="Ex: Proteínas"
                    value={categoryNewDraft}
                    onChange={(e) => setCategoryNewDraft(e.target.value)}
                  />
                  <button type="button" data-tour="category-save" className={styles.categoriesAddBtn} onClick={addCategory} disabled={!normalizeCategoryName(categoryNewDraft)}>
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
                          <div className={styles.categoryCount}>{categoryCounts.get(c.toLowerCase()) ?? 0}</div>
                          <div className={styles.categoryActions}>
                            <button type="button" className={styles.categoryIconBtn} aria-label="Editar categoria" onClick={() => editCategory(c)}>
                              <IconEdit />
                            </button>
                            <button
                              type="button"
                              className={styles.categoryIconBtn}
                              aria-label="Excluir categoria"
                              onClick={() => openDeleteCategory(c)}
                              title={(categoryCounts.get(c.toLowerCase()) ?? 0) > 0 ? "Não é possível excluir: existem itens vinculados" : ""}
                            >
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
          </div>,
          document.body,
          )
        ) : null}

        {mounted && isDeleteCategoryOpen ? (
          createPortal(
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
          </div>,
          document.body,
          )
        ) : null}

        {mounted && isSectorsOpen ? (
          createPortal(
          <div className={styles.modalOverlay} role="presentation" onClick={() => setIsSectorsOpen(false)}>
            <div data-tour="sectors-modal" className={`${styles.modal} ${styles.categoriesModal}`} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitle}>Setores de Itens</div>
                <button data-tour="sectors-close" type="button" className={styles.modalClose} aria-label="Fechar" onClick={() => setIsSectorsOpen(false)}>
                  ×
                </button>
              </div>

              <div className={styles.categoriesBody}>
                <div className={styles.categoriesLabel}>Nome do Setor</div>
                <div className={styles.categoriesRow}>
                  <input
                    className={styles.categoriesInput}
                    placeholder="Ex: Salão, Bar, Cozinha"
                    value={sectorNewDraft}
                    onChange={(e) => setSectorNewDraft(e.target.value)}
                  />
                  <button
                    type="button"
                    className={styles.categoriesAddBtn}
                    onClick={addSector}
                    disabled={!normalizeSectorName(sectorNewDraft) || isReadOnly || sectorAction !== null}
                  >
                    <IconPlus /> ADD
                  </button>
                </div>
                <div className={styles.categoriesDivider} />

                <div className={styles.categoriesList}>
                  {sectorsSorted.map((s) => {
                    const count = sectorCounts.get(s.id) ?? 0;
                    const isGeral = normalizeSectorName(s.name).toLowerCase() === "geral";
                    return (
                      <div key={s.id} className={styles.categoryItem}>
                        {editingSectorId === s.id ? (
                          <>
                            <input
                              className={styles.categoryInlineInput}
                              value={editingSectorDraft}
                              onChange={(e) => setEditingSectorDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") confirmEditSector();
                                if (e.key === "Escape") cancelEditSector();
                              }}
                              autoFocus
                            />
                            <div className={styles.categoryCount} />
                            <div data-tour="sector-row-actions" className={styles.categoryActions}>
                              <button
                                type="button"
                                className={`${styles.categoryIconBtn} ${styles.categoryIconBtnConfirm}`}
                                aria-label="Confirmar edição"
                                onClick={confirmEditSector}
                                disabled={!normalizeSectorName(editingSectorDraft) || sectorAction === "create" || sectorAction === `check:${editingSectorId ?? ""}` || sectorAction === `delete:${editingSectorId ?? ""}`}
                              >
                                <IconCheck />
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className={styles.categoryName}>
                              {isGeral ? <strong style={{ color: "#1f6feb" }}>{s.name}</strong> : s.name}
                              {isGeral ? (
                                <span
                                  style={{
                                    marginLeft: 8,
                                    fontSize: 10,
                                    background: "#eef2ff",
                                    color: "#1f6feb",
                                    padding: "2px 6px",
                                    borderRadius: 999,
                                    fontWeight: 600,
                                  }}
                                >
                                  PADRÃO
                                </span>
                              ) : null}
                              {sectorAction === `check:${s.id}` ? (
                                <span
                                  style={{
                                    marginLeft: 8,
                                    fontSize: 10,
                                    background: "#f3f4f6",
                                    color: "#6b7280",
                                    padding: "2px 6px",
                                    borderRadius: 999,
                                    fontWeight: 500,
                                  }}
                                >
                                  Verificando…
                                </span>
                              ) : null}
                              {sectorAction === `delete:${s.id}` ? (
                                <span
                                  style={{
                                    marginLeft: 8,
                                    fontSize: 10,
                                    background: "#fef2f2",
                                    color: "#b91c1c",
                                    padding: "2px 6px",
                                    borderRadius: 999,
                                    fontWeight: 500,
                                  }}
                                >
                                  Excluindo…
                                </span>
                              ) : null}
                              {sectorAction === `edit:${s.id}` ? (
                                <span
                                  style={{
                                    marginLeft: 8,
                                    fontSize: 10,
                                    background: "#eff6ff",
                                    color: "#1d4ed8",
                                    padding: "2px 6px",
                                    borderRadius: 999,
                                    fontWeight: 500,
                                  }}
                                >
                                  Salvando…
                                </span>
                              ) : null}
                            </div>
                            <div className={styles.categoryCount}>{count}</div>
                            <div data-tour="sector-row-actions" className={styles.categoryActions}>
                              <button
                                type="button"
                                className={styles.categoryIconBtn}
                                aria-label="Editar setor"
                                onClick={() => editSector(s)}
                                disabled={isReadOnly || isGeral || sectorAction === "create" || sectorAction === `check:${s.id}` || sectorAction === `delete:${s.id}`}
                                title={isGeral ? "O setor Geral não pode ser renomeado." : ""}
                              >
                                <IconEdit />
                              </button>
                              <button
                                type="button"
                                className={styles.categoryIconBtn}
                                aria-label="Excluir setor"
                                disabled={isReadOnly || isGeral || sectorAction === "create" || sectorAction === `edit:${s.id}` || sectorAction === `check:${s.id}` || sectorAction === `delete:${s.id}`}
                                onClick={() => openDeleteSector(s)}
                                title={isGeral ? "O setor Geral não pode ser excluído." : count > 0 ? `Existem ${count} vínculo(s) neste setor.` : ""}
                              >
                                <IconTrash />
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>,
          document.body,
          )
        ) : null}

        {mounted && isDeleteSectorOpen ? (
          createPortal(
          <div className={styles.modalOverlay} role="presentation" onClick={cancelDeleteSector}>
            <div className={styles.modal} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitle}>Excluir Setor?</div>
                <button type="button" className={styles.modalClose} aria-label="Fechar" onClick={cancelDeleteSector}>
                  ×
                </button>
              </div>

              <div className={styles.confirmBody}>
                <div className={styles.confirmIcon}>
                  <IconTrash />
                </div>
                <div className={styles.confirmText}>
                  Caso exclua o setor <strong>“{deletingSectorName}”</strong> não poderá recuperá-lo.
                  {(deletingSectorLinks?.itemLinks ?? 0) > 0 || (deletingSectorLinks?.counts ?? 0) > 0 ? (
                    <>
                      <br />
                      Existem <strong>{deletingSectorLinks?.itemLinks ?? 0} vínculos em itens</strong>
                      {(deletingSectorLinks?.counts ?? 0) > 0 ? (
                        <> e <strong>{deletingSectorLinks?.counts} contagens em inventários</strong></>
                      ) : null}
                      . Esses vínculos serão perdidos.
                    </>
                  ) : null}
                </div>
              </div>

              <div className={styles.confirmActions}>
                <button type="button" className={styles.confirmDelete} onClick={confirmDeleteSector} disabled={sectorAction !== null}>
                  {sectorAction === `delete:${deletingSectorId}` ? "Excluindo..." : "Excluir"}
                </button>
                <button type="button" className={styles.confirmCancel} onClick={cancelDeleteSector}>
                  Cancelar
                </button>
              </div>
            </div>
          </div>,
          document.body,
          )
        ) : null}
        </div>
      </main>
    </>
  );
}
