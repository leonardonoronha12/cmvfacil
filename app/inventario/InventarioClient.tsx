"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import dash from "../dashboard/dashboard.module.css";
import LoadingSpinner from "../components/LoadingSpinner";
import { loadInsumosStateFromSupabase } from "../lib/insumosSupabase";
import { readInsumosFromStore, subscribeInsumos, writeInsumosToStore, type InsumoStoreItem } from "../lib/insumosStore";
import { readInsumoCategoriasFromStore, subscribeInsumoCategorias, writeInsumoCategoriasToStore } from "../lib/insumoCategoriasStore";
import { loadPrePreparoFromSupabase } from "../lib/prePreparoSupabase";
import { readPrePreparoFromStore, subscribePrePreparo, writePrePreparoToStore, type PrePreparoStoreRow } from "../lib/prePreparoStore";
import { loadFichasTecnicasFromSupabase } from "../lib/fichasTecnicasSupabase";
import { readFichasTecnicasFromStore, subscribeFichasTecnicas, writeFichasTecnicasToStore, type FichaTecnicaRow } from "../lib/fichasTecnicasStore";
import { readInventarioFromStore, writeInventarioToStore, type InventarioCategoria, type InventarioContagem, type InventarioItemRow } from "../lib/inventarioStore";
import { deleteInventarioFromSupabase, loadInventarioStateFromSupabase, loadInventarioFromSupabase, upsertInventarioToSupabase, type InventarioCompatInventory } from "../lib/inventarioSupabase";
import { readSectorsFromStore, writeSectorsToStore, subscribeSectors, type SectorRow } from "../lib/sectorsStore";
import { loadSectorsFromSupabase, saveInventorySectorCountToSupabase } from "../lib/sectorsSupabase";
import { buildUserScopedId } from "../lib/userScope";
import { QaModePanel } from "../lib/qaMode";
import styles from "./inventario.module.css";

function IconBox() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M21 8v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8m18 0-9 5-9-5m18 0-9-5-9 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M10.5 3a7.5 7.5 0 1 0 4.64 13.4l4.48 4.48 1.41-1.41-4.48-4.48A7.5 7.5 0 0 0 10.5 3Zm0 2a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconPencil() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 20h4l10.5-10.5a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 16v4Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M13 6l5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 3h6l1 2h4v2H4V5h4l1-2Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M6 8h12l-1 13H7L6 8Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M10 11v7M14 11v7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, delta: number) {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}

function formatDateNumericPT(d: Date) {
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function parseDateNumericLoose(value: string) {
  const raw = value.trim();
  if (!raw) return null;
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const day = Number.parseInt(m[1], 10);
  const month = Number.parseInt(m[2], 10) - 1;
  const year = Number.parseInt(m[3], 10);
  const d = new Date(year, month, day);
  if (d.getFullYear() !== year || d.getMonth() !== month || d.getDate() !== day) return null;
  return d;
}

function normCatName(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeSectorName(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 80);
}

function parsePtNumber(value: string): number {
  const raw = (typeof value === "string" ? value : String(value ?? "")).replace(/[^\d,.-]/g, "").trim();
  if (!raw) return 0;
  const neg = raw.includes("-");
  const cleaned = raw.replace(/-/g, "");
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  const decimalIndex = Math.max(lastComma, lastDot);
  const integerDigits = (decimalIndex >= 0 ? cleaned.slice(0, decimalIndex) : cleaned).replace(/[^\d]/g, "") || "0";
  const decimalDigits = decimalIndex >= 0 ? cleaned.slice(decimalIndex + 1).replace(/[^\d]/g, "") : "";
  const normalized = `${neg ? "-" : ""}${integerDigits}${decimalIndex >= 0 ? `.${decimalDigits}` : ""}`;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function formatDecimal3Places(value: number): string {
  if (!Number.isFinite(value)) return "";
  const fixed = value.toFixed(3);
  const [intPart, decPart] = fixed.split(".");
  const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const dec = String(decPart ?? "000").slice(0, 3).padEnd(3, "0");
  const cleanDec = dec.replace(/0+$/, "");
  return `${intFormatted},${cleanDec || "000"}`;
}

function normalizeNameKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function prepInventoryId(id: string) {
  return `prep:${id}`;
}

function parseUnitFromPrePreparo(row: PrePreparoStoreRow) {
  const rendimento = String(row.rendimento ?? "").trim();
  const m1 = rendimento.match(/([A-Za-zÀ-ÿ]+)\s*$/);
  if (m1?.[1]) return m1[1].trim();
  const custoUnitario = String(row.custoUnitario ?? "").trim();
  const m2 = custoUnitario.match(/\/\s*([A-Za-zÀ-ÿ]+)\s*$/);
  if (m2?.[1]) return m2[1].trim();
  return "Und";
}

function sortContagensDesc(list: InventarioContagem[]) {
  const decorated = list.map((c, index) => ({
    c,
    index,
    t: parseDateNumericLoose(c.data)?.getTime() ?? Number.POSITIVE_INFINITY,
  }));
  decorated.sort((a, b) => {
    const cmp = b.t - a.t;
    if (cmp) return cmp;
    return a.index - b.index;
  });
  return decorated.map((d) => d.c);
}

function normalizeContagens(list: InventarioContagem[]) {
  return list.map((c) => {
    const categorias = (c.categorias ?? []).map((cat) => {
      const itens = cat.itens ?? [];
      const byId = new Map<string, { it: InventarioItemRow; index: number }>();
      for (let i = 0; i < itens.length; i += 1) {
        const it = itens[i];
        const id = String(it.id ?? "");
        if (!id) continue;
        const existing = byId.get(id);
        if (!existing) {
          byId.set(id, { it, index: i });
          continue;
        }
        if (it.removido) {
          if (!existing.it.removido) byId.set(id, { it, index: existing.index });
          continue;
        }
        const existingHas = Boolean(String(existing.it.estoqueFinal ?? "").trim());
        const nextHas = Boolean(String(it.estoqueFinal ?? "").trim());
        if (!existingHas && nextHas) byId.set(id, { it, index: existing.index });
      }
      const deduped = Array.from(byId.values())
        .sort((a, b) => a.index - b.index)
        .map((x) => x.it);
      return { ...cat, itens: deduped };
    });
    return { ...c, categorias };
  });
}

const initialContagens: InventarioContagem[] = [];

export default function InventarioClient() {
  const [mounted, setMounted] = useState(false);
  const [isLoadingInventario, setIsLoadingInventario] = useState(true);
  const [insumosStore, setInsumosStore] = useState<InsumoStoreItem[]>([]);
  const [insumoCategorias, setInsumoCategorias] = useState<string[]>(() => readInsumoCategoriasFromStore());
  const [prePreparoStore, setPrePreparoStore] = useState<PrePreparoStoreRow[]>(() => readPrePreparoFromStore([]));
  const [fichasTecnicasRows, setFichasTecnicasRows] = useState<FichaTecnicaRow[]>(() => readFichasTecnicasFromStore([]));
  const [contagens, setContagens] = useState<InventarioContagem[]>(initialContagens);
  const contagensReadyRef = useRef(false);
  const [sourceMeta, setSourceMeta] = useState<{ source: "legacy" | "compat"; readOnly: boolean }>({ source: "legacy", readOnly: false });
  const [compatInventories, setCompatInventories] = useState<InventarioCompatInventory[]>([]);
  const [selectedCompatInventoryId, setSelectedCompatInventoryId] = useState<string | null>(null);
  const isReadOnly = Boolean(sourceMeta.readOnly);
  const isCompatSource = sourceMeta.source === "compat";

  const [selectedContagemId, setSelectedContagemId] = useState<string | null>(initialContagens[0]?.id ?? null);
  const [query, setQuery] = useState("");
  const [categoriaFilter, setCategoriaFilter] = useState("Categorias pendentes");
  const [sectors, setSectors] = useState<SectorRow[]>(() => readSectorsFromStore());
  const [itemSectorLinks, setItemSectorLinks] = useState<Array<{ itemId: string; sectorId: string }>>([]);
  const [selectedSectorId, setSelectedSectorId] = useState<string>("Todos");
  const [sectorSaveErrorMsg, setSectorSaveErrorMsg] = useState<string>("");
  const sectorInventorySyncVersionRef = useRef(0);
  const sectorSavingLockRef = useRef<Set<string>>(new Set());
  type SaveStatus = "saving" | "saved" | "error";
  const [savingKeys, setSavingKeys] = useState<Record<string, SaveStatus>>({});
  const savingKeysRef = useRef<Record<string, SaveStatus>>({});
  useEffect(() => {
    savingKeysRef.current = savingKeys;
  }, [savingKeys]);
  function setKeySaving(inventoryId: string, itemId: string, sectorId: string, status: SaveStatus) {
    const k = `${inventoryId}|${itemId}|${sectorId}`;
    savingKeysRef.current = { ...savingKeysRef.current, [k]: status };
    setSavingKeys((prev) => ({ ...prev, [k]: status }));
  }
  function clearKeySaving(inventoryId: string, itemId: string, sectorId: string, delayMs = 900) {
    const k = `${inventoryId}|${itemId}|${sectorId}`;
    if (delayMs <= 0) {
      const next = { ...savingKeysRef.current };
      delete next[k];
      savingKeysRef.current = next;
      setSavingKeys(next);
      return;
    }
    window.setTimeout(() => {
      savingKeysRef.current = ((cur) => {
        if (!(k in cur)) return cur;
        const next = { ...cur };
        delete next[k];
        return next;
      })(savingKeysRef.current);
      setSavingKeys((prev) => {
        if (!(k in prev)) return prev;
        const next = { ...prev };
        delete next[k];
        return next;
      });
    }, delayMs);
  }
  function getKeySaving(inventoryId: string, itemId: string, sectorId: string | null): SaveStatus | null {
    if (!sectorId) return null;
    return savingKeysRef.current[`${inventoryId}|${itemId}|${sectorId}`] ?? null;
  }
  function buildOptimisticRow(origIt: InventarioItemRow, sectorId: string, cleanedValue: string, numericValue: number): InventarioItemRow {
    const sc: Record<string, string> = { ...(origIt.sectorCounts ?? {}) };
    if (cleanedValue !== "") {
      sc[sectorId] = formatDecimal3Places(numericValue);
    } else {
      delete sc[sectorId];
    }
    const totalNum = Object.values(sc).reduce((acc, v) => acc + parsePtNumber(String(v ?? "")), 0);
    const estoqueFinal = Object.keys(sc).length > 0 ? formatDecimal3Places(totalNum) : "";
    return { ...origIt, sectorCounts: sc, estoqueFinal };
  }

  const sectorsSorted = useMemo(() => {
    const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });
    return [...sectors].sort((a, b) => {
      const ag = normalizeSectorName(a.name).toLowerCase() === "geral" ? 0 : 1;
      const bg = normalizeSectorName(b.name).toLowerCase() === "geral" ? 0 : 1;
      if (ag !== bg) return ag - bg;
      return collator.compare(a.name, b.name);
    });
  }, [sectors]);

  const geralSector = useMemo<SectorRow | null>(() => sectorsSorted.find((s) => normalizeSectorName(s.name).toLowerCase() === "geral") ?? null, [sectorsSorted]);

  const knownSectorIds = useMemo(
    () =>
      new Set(
        sectorsSorted
          .filter((s) => normalizeSectorName(s.name).toLowerCase() !== "geral")
          .map((s) => String(s.id ?? "").trim())
          .filter(Boolean),
      ),
    [sectorsSorted],
  );
  function canonicalItemId(value: unknown): string {
    return String(value ?? "").trim().replace(/^db:/i, "");
  }
  function getItemSectorIds(r: InventarioItemRow): Set<string> {
    const out = new Set<string>();
    const explicitSectorIds = Array.isArray((r as any).sectorIds) ? ((r as any).sectorIds as any[]) : [];
    for (const s of explicitSectorIds) {
      const x = String(s ?? "").trim();
      if (x && knownSectorIds.has(x)) out.add(x);
    }
    const rowItemId = canonicalItemId(r.id);
    for (const link of itemSectorLinks) {
      if (canonicalItemId(link.itemId) !== rowItemId) continue;
      const sectorId = String(link.sectorId ?? "").trim();
      if (knownSectorIds.has(sectorId)) out.add(sectorId);
    }
    const sc = (r as any).sectorCounts as Record<string, string> | undefined;
    if (sc && typeof sc === "object") {
      for (const sid of Object.keys(sc)) {
        const key = String(sid ?? "").trim();
        if (!key) continue;
        if (!knownSectorIds.has(key)) continue;
        if (String(sc[sid] ?? "").trim()) out.add(key);
      }
    }
    return out;
  }
  function itemHasSectors(r: InventarioItemRow): boolean {
    return getItemSectorIds(r).size > 0;
  }

  function showSectorNotice(msg: string, isError = false) {
    setSectorSaveErrorMsg(msg);
    window.setTimeout(() => {
      setSectorSaveErrorMsg((cur) => (cur === msg ? "" : cur));
    }, isError ? 5500 : 2800);
  }


  const [isNewOpen, setIsNewOpen] = useState(false);
  const [newData, setNewData] = useState(() => formatDateNumericPT(new Date()));
  const [newError, setNewError] = useState("");
  const [editingContagemId, setEditingContagemId] = useState<string | null>(null);
  const [isNewCalOpen, setIsNewCalOpen] = useState(false);
  const [newCalMonth, setNewCalMonth] = useState(() => startOfMonth(new Date()));
  const newCalWrapRef = useRef<HTMLDivElement | null>(null);
  const [newCalRect, setNewCalRect] = useState<{ left: number; top: number } | null>(null);
  const [isDeleteContagemOpen, setIsDeleteContagemOpen] = useState(false);
  const [deleteContagemRow, setDeleteContagemRow] = useState<InventarioContagem | null>(null);

  const [menuContagemId, setMenuContagemId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuAnchorRef = useRef<HTMLButtonElement | null>(null);
  const datesListRef = useRef<HTMLDivElement | null>(null);
  const [menuRect, setMenuRect] = useState<{ left: number; top: number } | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const editInputRef = useRef<HTMLInputElement | null>(null);
  const editOriginalValueRef = useRef<string>("");
  const editCancelledRef = useRef(false);
  const [pendingDrafts, setPendingDrafts] = useState<Record<string, string>>({});
  const pendingDraftsRef = useRef<Record<string, string>>({});
  const pendingColBodyRef = useRef<HTMLDivElement | null>(null);

  const selectedContagem = useMemo(() => (selectedContagemId ? contagens.find((c) => c.id === selectedContagemId) ?? null : null), [contagens, selectedContagemId]);
  const selectedCompatInventory = useMemo(
    () => (selectedCompatInventoryId ? compatInventories.find((c) => c.id === selectedCompatInventoryId) ?? null : compatInventories[0] ?? null),
    [compatInventories, selectedCompatInventoryId],
  );

  const fichaTecnicaNameKeys = useMemo(() => {
    const set = new Set<string>();
    for (const r of fichasTecnicasRows) {
      const k = normalizeNameKey(String((r as any)?.receita ?? ""));
      if (k) set.add(k);
    }
    return set;
  }, [fichasTecnicasRows]);

  const inventoryCatalogIds = useMemo(() => {
    const ids = new Set<string>();
    for (const ins of insumosStore) {
      const id = String(ins.id ?? "").trim();
      if (id) ids.add(id);
    }
    for (const prep of prePreparoStore) {
      const id = String(prep.id ?? "").trim();
      if (id) ids.add(prepInventoryId(id));
    }
    return ids;
  }, [insumosStore, prePreparoStore]);

  const categorias = useMemo(() => {
    const base = ["Categorias pendentes"];
    const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });
    const names = (selectedContagem?.categorias ?? [])
      .map((c) => normCatName(String(c.nome ?? "")))
      .filter(Boolean)
      .filter((c) => c.toLowerCase() !== "todas");
    const seen = new Set<string>();
    const out: string[] = [];
    for (const n of names) {
      const k = n.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(n);
    }
    out.sort((a, b) => collator.compare(a, b));
    return [...base, ...out];
  }, [selectedContagem?.categorias]);

  const itemCategoryMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const cat of selectedContagem?.categorias ?? []) {
      const name = normCatName(String(cat.nome ?? "")) || "Sem categoria";
      for (const it of cat.itens ?? []) {
        const id = String(it.id ?? "");
        if (!id) continue;
        const itemKey = normalizeNameKey(String((it as any)?.item ?? ""));
        if (itemKey && fichaTecnicaNameKeys.has(itemKey) && !inventoryCatalogIds.has(id)) continue;
        map.set(id, name);
      }
    }
    return map;
  }, [fichaTecnicaNameKeys, inventoryCatalogIds, selectedContagem?.categorias]);

  const allItems = useMemo(() => {
    const list = selectedContagem?.categorias ?? [];
    const out: InventarioItemRow[] = [];
    const seen = new Set<string>();
    for (const cat of list) {
      for (const it of cat.itens ?? []) {
        if (it.removido) continue;
        const id = String(it.id ?? "");
        if (!id) continue;
        const itemKey = normalizeNameKey(String((it as any)?.item ?? ""));
        if (itemKey && fichaTecnicaNameKeys.has(itemKey) && !inventoryCatalogIds.has(id)) continue;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(it);
      }
    }
    return out;
  }, [fichaTecnicaNameKeys, inventoryCatalogIds, selectedContagem?.categorias]);

  const filteredItems = useMemo(() => {
    let rows = allItems;
    if (isCompatSource) {
      const q = query.trim().toLowerCase();
      const afterQuery = q ? rows.filter((r) => r.item.toLowerCase().includes(q)) : rows;
      if (categoriaFilter !== "Categorias pendentes") {
        const desired = normCatName(categoriaFilter).toLowerCase();
        return afterQuery.filter((r) => normCatName(itemCategoryMap.get(String(r.id ?? "")) ?? "Sem categoria").toLowerCase() === desired);
      }
      return afterQuery;
    }
    const inSelectedSectorMode = selectedSectorId && selectedSectorId !== "Todos";
    if (inSelectedSectorMode) {
      rows = rows.filter((r) => getItemSectorIds(r).has(String(selectedSectorId)));
    }
    const q = query.trim().toLowerCase();
    const afterQuery = q ? rows.filter((r) => r.item.toLowerCase().includes(q)) : rows;
    if (categoriaFilter !== "Categorias pendentes") {
      const desired = normCatName(categoriaFilter).toLowerCase();
      return afterQuery.filter((r) => normCatName(itemCategoryMap.get(String(r.id ?? "")) ?? "Sem categoria").toLowerCase() === desired);
    }
    return afterQuery;
  }, [allItems, categoriaFilter, isCompatSource, itemCategoryMap, query, selectedSectorId]);

  const pendentes = useMemo(() => filteredItems.filter((r) => !String(r.estoqueFinal ?? "").trim()), [filteredItems]);
  const contabilizados = useMemo(() => {
    const list = filteredItems.filter((r) => String(r.estoqueFinal ?? "").trim());
    const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });
    return [...list].sort((a, b) => collator.compare(a.item, b.item));
  }, [filteredItems]);

  const qaUi = useMemo(() => {
    if (isCompatSource) {
      return {
        meta: sourceMeta,
        selection: {
          selectedInventoryId: selectedCompatInventory?.id ?? null,
          selectedData: selectedCompatInventory?.dataContagem ?? null,
          inventoriesCount: compatInventories.length,
        },
        rendered: {
          inventoriesCount: compatInventories.length,
          inventories: compatInventories.map((inv) => ({
            id: inv.id,
            bubble_id: inv.bubble_id,
            dataContagem: inv.dataContagem,
            status: inv.status,
            responsavel: inv.responsavel,
            itensCount: Array.isArray(inv.itens) ? inv.itens.length : 0,
          })),
        },
        details: compatInventories.map((inv) => ({
          id: inv.id,
          dataContagem: inv.dataContagem,
          itens: (inv.itens ?? []).map((it) => ({
            id: it.id,
            itemId: it.itemId,
            item: it.item,
            categoria: it.categoria,
            unidade: it.unidade,
            quantidadeEsperada: it.quantidadeEsperada,
            quantidadeContada: it.quantidadeContada,
            diferenca: it.diferenca,
            custoMedio: it.custoMedio,
            valorDiferenca: it.valorDiferenca,
            ocultarCmv: Boolean(it.ocultarCmv),
          })),
        })),
      };
    }
    return {
      meta: sourceMeta,
      selection: { selectedContagemId, selectedData: selectedContagem?.data ?? null, contagensCount: contagens.length },
      filters: { query, categoriaFilter },
      rendered: {
        pendentes: pendentes.map((r) => ({
          id: r.id,
          item: r.item,
          categoria: itemCategoryMap.get(String(r.id ?? "")) ?? "Sem categoria",
          estoqueFinalInput: pendingDrafts[r.id] ?? r.estoqueFinal,
          unidade: r.unidade,
        })),
        contabilizados: contabilizados.map((r) => ({
          id: r.id,
          item: r.item,
          categoria: itemCategoryMap.get(String(r.id ?? "")) ?? "Sem categoria",
          estoqueFinal: r.estoqueFinal,
          unidade: r.unidade,
        })),
      },
    };
  }, [
    categoriaFilter,
    compatInventories,
    contagens.length,
    contabilizados,
    isCompatSource,
    itemCategoryMap,
    pendentes,
    pendingDrafts,
    query,
    selectedCompatInventory?.dataContagem,
    selectedCompatInventory?.id,
    selectedContagem?.data,
    selectedContagemId,
    sourceMeta,
  ]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setInsumosStore(readInsumosFromStore());
    setInsumoCategorias(readInsumoCategoriasFromStore());
    void (async () => {
      try {
        const state = await loadInsumosStateFromSupabase();
        if (state.rows.length) writeInsumosToStore(state.rows);
        if (state.categories.length) writeInsumoCategoriasToStore(state.categories);
        setInsumoCategorias(state.categories);
      } catch {}
    })();
    const u1 = subscribeInsumos((rows) => setInsumosStore(rows));
    const u2 = subscribeInsumoCategorias((rows) => setInsumoCategorias(rows));
    return () => {
      u1();
      u2();
    };
  }, []);

  useEffect(() => {
    setFichasTecnicasRows(readFichasTecnicasFromStore([]));
    void (async () => {
      try {
        const dbRows = await loadFichasTecnicasFromSupabase();
        if (dbRows.length) writeFichasTecnicasToStore(dbRows as any);
      } catch {}
      setFichasTecnicasRows(readFichasTecnicasFromStore([]));
    })();
    return subscribeFichasTecnicas((rows) => setFichasTecnicasRows(rows));
  }, []);

  useEffect(() => {
    setPrePreparoStore(readPrePreparoFromStore([]));
    void (async () => {
      try {
        const dbRows = await loadPrePreparoFromSupabase();
        if (dbRows.length) writePrePreparoToStore(dbRows as any);
      } catch {}
      setPrePreparoStore(readPrePreparoFromStore([]));
    })();
    return subscribePrePreparo((rows) => setPrePreparoStore(rows));
  }, []);

  useEffect(() => {
    pendingDraftsRef.current = pendingDrafts;
  }, [pendingDrafts]);

  useEffect(() => {
    setSectors(readSectorsFromStore());
    void (async () => {
      try {
        const loaded = await loadSectorsFromSupabase();
        if (loaded.sectors.length) writeSectorsToStore(loaded.sectors);
        setSectors(loaded.sectors);
        setItemSectorLinks(loaded.itemLinks ?? []);
      } catch {}
    })();
    return subscribeSectors((rows) => setSectors(rows));
  }, []);

  useEffect(() => {
    if (!selectedContagemId) {
      sectorInventorySyncVersionRef.current += 1;
      return;
    }
    if (isCompatSource) return;
    const version = ++sectorInventorySyncVersionRef.current;
    const invId = selectedContagemId;
    void (async () => {
      try {
        const geralId = geralSector?.id ?? sectorsSorted.find((s) => normalizeSectorName(s.name).toLowerCase() === "geral")?.id ?? null;
        const res = await fetch(`/api/inventario/sectors?inventoryId=${encodeURIComponent(invId)}`, { cache: "no-store" });
        let apiCounts: Array<{ inventory_id: string; item_id: string; sector_id: string; quantity: string; counted_by_user_id?: string | null; counted_at?: string | null }> = [];
        if (res.ok) {
          const json = await res.json().catch(() => ({}));
          apiCounts = Array.isArray(json?.counts) ? json.counts : [];
        }
        if (version !== sectorInventorySyncVersionRef.current) return;
        const byItemSector = new Map<string, Map<string, string>>();
        for (const row of apiCounts) {
          const perItem = byItemSector.get(row.item_id) ?? new Map<string, string>();
          perItem.set(row.sector_id, row.quantity);
          byItemSector.set(row.item_id, perItem);
        }
        const legacyUpsertPayload: Array<{ inventoryId: string; itemId: string; sectorId: string; quantity: string }> = [];
        setContagens((prev) => {
          const next = prev.map((c) => {
            if (c.id !== invId) return c;
            const categorias = (c.categorias ?? []).map((cat) => {
              const itens = (cat.itens ?? []).map((origIt) => {
                const itemKey = String(origIt.id);
                const inFlightForAnySector = Object.keys(savingKeysRef.current).some((k) => k.startsWith(`${invId}|${itemKey}|`));
                if (inFlightForAnySector) {
                  return origIt;
                }
                const it = { ...origIt };
                const perSector = byItemSector.get(itemKey) ?? new Map<string, string>();
                let sc: Record<string, string> = { ...(it.sectorCounts ?? {}) };
                for (const [sid, qty] of perSector.entries()) {
                  const sectorLockKey = `${invId}|${itemKey}|${sid}`;
                  if (savingKeysRef.current[sectorLockKey]) continue;
                  const v = typeof qty === "string" || typeof qty === "number" ? String(qty) : "";
                  if (v.trim()) sc[sid] = formatDecimal3Places(parsePtNumber(v));
                }
                const hasAnySc = Boolean(Object.keys(sc).length);
                const hasLegacyQty = Boolean(String(it.estoqueFinal ?? "").trim());
                if (!hasAnySc && hasLegacyQty && geralId) {
                  sc[geralId] = formatDecimal3Places(parsePtNumber(String(it.estoqueFinal ?? "")));
                  legacyUpsertPayload.push({ inventoryId: invId, itemId: itemKey, sectorId: geralId, quantity: String(it.estoqueFinal ?? "") });
                }
                it.sectorCounts = sc;
                const totalNum = Object.values(sc).reduce((acc, v) => acc + parsePtNumber(String(v ?? "")), 0);
                it.estoqueFinal = Object.keys(sc).length > 0 ? formatDecimal3Places(totalNum) : "";
                return it;
              });
              return { ...cat, itens };
            });
            return { ...c, categorias };
          });
          return normalizeContagens(next);
        });
        if (legacyUpsertPayload.length && geralId) {
          try {
            await fetch("/api/inventario/sectors", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ bulk: legacyUpsertPayload }),
              cache: "no-store",
            }).catch(() => {});
          } catch {}
        }
      } catch {}
    })();
    return () => {
      sectorInventorySyncVersionRef.current += 1;
    };
  }, [selectedContagemId, isCompatSource, geralSector?.id]);

  useEffect(() => {
    setPendingDrafts({});
    setEditingItemId(null);
    setEditingValue("");
  }, [selectedContagemId]);

  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();
    void (async () => {
      setIsLoadingInventario(true);
      try {
        const db = await loadInventarioStateFromSupabase();
        if (db.meta) setSourceMeta(db.meta);
        if (db.meta?.source === "compat") {
          const invs = (db.compat?.inventories ?? []) as InventarioCompatInventory[];
          setCompatInventories(invs);
          setSelectedCompatInventoryId(invs[0]?.id ?? null);
          setContagens(db.rows ?? []);
          setSelectedContagemId((db.rows ?? [])[0]?.id ?? null);
          contagensReadyRef.current = true;
          return;
        }
        if ((db.rows ?? [])[0]) {
          const sorted = sortContagensDesc(normalizeContagens(db.rows));
          setContagens(sorted);
          setSelectedContagemId(sorted[0]?.id ?? null);
          contagensReadyRef.current = true;
          return;
        }
      } catch {}
      const forcedCompat = typeof window !== "undefined" && String(new URLSearchParams(window.location.search).get("source") ?? "").trim().toLowerCase() === "compat";
      if (forcedCompat) {
        setContagens([]);
        setCompatInventories([]);
        setSelectedCompatInventoryId(null);
        setSelectedContagemId(null);
        contagensReadyRef.current = true;
        setSourceMeta({ source: "compat", readOnly: true });
        return;
      }
      const stored = readInventarioFromStore(initialContagens);
      const sortedStored = sortContagensDesc(normalizeContagens(stored));
      setContagens(sortedStored);
      setSelectedContagemId(sortedStored[0]?.id ?? null);
      contagensReadyRef.current = true;
    })()
      .catch(() => {})
      .finally(() => {
        const elapsed = Date.now() - startedAt;
        const remaining = Math.max(0, 350 - elapsed);
        if (remaining) {
          window.setTimeout(() => {
            if (!cancelled) setIsLoadingInventario(false);
          }, remaining);
          return;
        }
        if (!cancelled) setIsLoadingInventario(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!contagensReadyRef.current) return;
    if (isReadOnly) return;
    writeInventarioToStore(contagens);
  }, [contagens, isReadOnly]);

  useEffect(() => {
    if (!contagensReadyRef.current) return;
    if (isReadOnly) return;
    if (!insumosStore.length && !insumoCategorias.length && !prePreparoStore.length) return;
    setContagens((prev) => {
      let changed = false;
      const next = prev.map((c) => {
        const cid = c.id;
        const prevCats: InventarioCategoria[] = Array.isArray(c.categorias) ? c.categorias : [];
        const existingById = new Map<string, InventarioItemRow>();
        const existingCatById = new Map<string, string>();
        for (const cat of prevCats) {
          const catName = normCatName(String(cat.nome ?? "")) || "Sem categoria";
          for (const it of cat.itens ?? []) {
            const id = String(it.id ?? "");
            if (!id) continue;
            const itemKey = normalizeNameKey(String((it as any)?.item ?? ""));
            if (itemKey && fichaTecnicaNameKeys.has(itemKey) && !inventoryCatalogIds.has(id)) {
              changed = true;
              continue;
            }
            existingCatById.set(id, catName);
            const prevIt = existingById.get(id);
            if (!prevIt) {
              existingById.set(id, it);
              continue;
            }
            if (it.removido) {
              if (!prevIt.removido) existingById.set(id, it);
              continue;
            }
            const prevHas = Boolean(String(prevIt.estoqueFinal ?? "").trim());
            const nextHas = Boolean(String(it.estoqueFinal ?? "").trim());
            if (!prevHas && nextHas) existingById.set(id, it);
          }
        }

        const sourceById = new Map<string, { item: string; unidade: string; categoria: string }>();
        const desiredCatByKey = new Map<string, string>();
        function addDesiredCategory(nameRaw: string) {
          const name = normCatName(String(nameRaw ?? ""));
          if (!name || name === "-") return;
          const key = name.toLowerCase();
          if (!desiredCatByKey.has(key)) desiredCatByKey.set(key, name);
        }
        for (const c0 of insumoCategorias) addDesiredCategory(String(c0 ?? ""));
        for (const ins of insumosStore) {
          const catName = normCatName(String(ins.categoria ?? "")) || "Sem categoria";
          sourceById.set(String(ins.id), { item: String(ins.item ?? ""), unidade: String(ins.medida ?? "") || "Und", categoria: catName });
          addDesiredCategory(catName);
        }
        for (const prep of prePreparoStore) {
          const catName = normCatName(String(prep.categoria ?? "")) || "Sem categoria";
          sourceById.set(prepInventoryId(String(prep.id)), { item: String(prep.receita ?? ""), unidade: parseUnitFromPrePreparo(prep), categoria: catName });
          addDesiredCategory(catName);
        }

        for (const name of existingCatById.values()) addDesiredCategory(name);
        if (!desiredCatByKey.size) desiredCatByKey.set("sem categoria", "Sem categoria");

        const prevCatIdByName = new Map<string, string>();
        for (const cat of prevCats) {
          const nm = normCatName(String(cat.nome ?? ""));
          if (!nm) continue;
          const k = nm.toLowerCase();
          if (!prevCatIdByName.has(k)) prevCatIdByName.set(k, String(cat.id ?? ""));
        }

        const allIds = new Set<string>();
        for (const id of existingById.keys()) allIds.add(id);
        for (const id of sourceById.keys()) allIds.add(id);
        const itemsByCat = new Map<string, InventarioItemRow[]>();
        for (const id of allIds) {
          const src = sourceById.get(id) ?? null;
          const prevIt = existingById.get(id) ?? null;
          const categoria = src?.categoria ?? existingCatById.get(id) ?? "Sem categoria";
          const catKey = categoria.toLowerCase();
          const inFlight = cid && Object.keys(savingKeysRef.current).some((k) => k.startsWith(`${cid}|${id}|`));
          const baseRow = (prevIt ?? {}) as Partial<InventarioItemRow>;
          const nextRow: InventarioItemRow = inFlight
            ? {
                id,
                item: (src?.item ?? String(baseRow.item ?? "")) || String(baseRow.item ?? ""),
                unidade: ((src?.unidade ?? String(baseRow.unidade ?? "")) || "Und") || String(baseRow.unidade ?? ""),
                estoqueFinal: String(baseRow.estoqueFinal ?? ""),
                removido: baseRow.removido,
                sectorCounts: baseRow.sectorCounts ? { ...baseRow.sectorCounts } : undefined,
              }
            : {
                id,
                item: src?.item ?? String(baseRow.item ?? ""),
                unidade: (src?.unidade ?? String(baseRow.unidade ?? "")) || "Und",
                estoqueFinal: String(baseRow.estoqueFinal ?? ""),
                removido: baseRow.removido,
                sectorCounts: baseRow.sectorCounts ? { ...baseRow.sectorCounts } : undefined,
              };
          if (prevIt) {
            const prevCat = (existingCatById.get(id) ?? "Sem categoria").toLowerCase();
            if (prevCat !== catKey) changed = true;
            if (!inFlight && (String(prevIt.item ?? "") !== nextRow.item || String(prevIt.unidade ?? "") !== nextRow.unidade)) changed = true;
          } else {
            changed = true;
          }
          const list = itemsByCat.get(catKey) ?? [];
          list.push(nextRow);
          itemsByCat.set(catKey, list);
        }

        const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });
        const orderedCats = Array.from(desiredCatByKey.values()).sort((a, b) => collator.compare(a, b));
        const nextCats: InventarioCategoria[] = orderedCats.map((name) => {
          const key = name.toLowerCase();
          const itens = [...(itemsByCat.get(key) ?? [])].sort((a, b) => collator.compare(a.item, b.item));
          const hasPending = itens.some((it) => !it.removido && !String(it.estoqueFinal ?? "").trim());
          return {
            id: prevCatIdByName.get(key) || `cat-${Date.now()}-${key}`,
            nome: name,
            status: hasPending ? "pendente" : "concluida",
            itens,
          };
        });

        return { ...c, categorias: nextCats };
      });
      if (!changed) return prev;
      const sel = selectedContagemId ? next.find((x) => x.id === selectedContagemId) : null;
      if (sel) void upsertInventarioToSupabase(sel).catch(() => {});
      return next;
    });
  }, [fichaTecnicaNameKeys, insumoCategorias, insumosStore, inventoryCatalogIds, isReadOnly, prePreparoStore, selectedContagemId]);

  useEffect(() => {
    if (!menuContagemId) return;
    function onDown(e: MouseEvent) {
      const el = menuRef.current;
      const anchor = menuAnchorRef.current;
      if (e.target instanceof Node && ((el && el.contains(e.target)) || (anchor && anchor.contains(e.target)))) return;
      setMenuContagemId(null);
      setMenuRect(null);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [menuContagemId]);

  useEffect(() => {
    if (!isNewCalOpen) return;
    function onDown(e: MouseEvent) {
      const el = newCalWrapRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      setIsNewCalOpen(false);
      setNewCalRect(null);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [isNewCalOpen]);

  useEffect(() => {
    if (!isNewCalOpen) return;
    function close() {
      setIsNewCalOpen(false);
      setNewCalRect(null);
    }
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [isNewCalOpen]);

  useEffect(() => {
    if (!menuContagemId) return;
    function close() {
      setMenuContagemId(null);
      setMenuRect(null);
    }
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    datesListRef.current?.addEventListener("scroll", close);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      datesListRef.current?.removeEventListener("scroll", close);
    };
  }, [menuContagemId]);

  function openNew() {
    setNewData(formatDateNumericPT(new Date()));
    setNewError("");
    setEditingContagemId(null);
    setIsNewCalOpen(false);
    setNewCalMonth(startOfMonth(new Date()));
    setNewCalRect(null);
    setIsNewOpen(true);
  }

  function openEditContagem(id: string) {
    const row = contagens.find((c) => c.id === id) ?? null;
    if (!row) return;
    setNewData(row.data);
    setNewError("");
    setEditingContagemId(id);
    setSelectedContagemId(id);
    setIsNewCalOpen(false);
    setNewCalMonth(startOfMonth(parseDateNumericLoose(row.data) ?? new Date()));
    setNewCalRect(null);
    setIsNewOpen(true);
    setMenuContagemId(null);
    setMenuRect(null);
  }

  function confirmNew() {
    const data = newData.trim();
    if (!data) return;
    const exists = contagens.some((c) => c.data.trim() === data && c.id !== editingContagemId);
    if (exists) {
      setNewError("Já existe um inventário nessa data.");
      return;
    }
    if (editingContagemId) {
      const id = editingContagemId;
      setContagens((prev) => {
        const next = prev.map((c) => (c.id === id ? { ...c, data } : c));
        const updated = next.find((x) => x.id === id);
        if (updated) void upsertInventarioToSupabase(updated).catch(() => {});
        return sortContagensDesc(next);
      });
      setSelectedContagemId(id);
      setQuery("");
      setIsNewOpen(false);
      setEditingContagemId(null);
      return;
    }
    void (async () => {
      const id = await buildUserScopedId(`c-${Date.now()}`);
      const sourceById = new Map<string, { item: string; unidade: string; categoria: string }>();
      for (const ins of insumosStore) {
        const catName = normCatName(String(ins.categoria ?? "")) || "Sem categoria";
        sourceById.set(String(ins.id), { item: String(ins.item ?? ""), unidade: String(ins.medida ?? "") || "Und", categoria: catName });
      }
      for (const prep of prePreparoStore) {
        const catName = normCatName(String(prep.categoria ?? "")) || "Sem categoria";
        sourceById.set(prepInventoryId(String(prep.id)), { item: String(prep.receita ?? ""), unidade: parseUnitFromPrePreparo(prep), categoria: catName });
      }

      const itens: InventarioItemRow[] = Array.from(sourceById.entries()).map(([rowId, src]) => ({
        id: rowId,
        item: src.item,
        unidade: src.unidade,
        estoqueFinal: "",
      }));
      const byCat = new Map<string, InventarioItemRow[]>();
      const catSet = new Set<string>();
      for (const c0 of insumoCategorias) {
        const name = normCatName(String(c0 ?? ""));
        if (!name || name === "-") continue;
        catSet.add(name);
      }
      for (const it of itens) {
        const cat = sourceById.get(String(it.id))?.categoria ?? "Sem categoria";
        catSet.add(cat);
        const key = cat.toLowerCase();
        const list = byCat.get(key) ?? [];
        list.push(it);
        byCat.set(key, list);
      }
      const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });
      const cats = Array.from(catSet.values()).sort((a, b) => collator.compare(a, b));
      const categorias: InventarioCategoria[] = cats.map((name) => ({
        id: `cat-${Date.now()}-${name.toLowerCase()}`,
        nome: name,
        status: "pendente",
        itens: byCat.get(name.toLowerCase()) ?? [],
      }));
      const next: InventarioContagem = {
        id,
        data,
        categorias,
      };
      setContagens((prev) => sortContagensDesc([...prev, next]));
      setSelectedContagemId(id);
      setQuery("");
      setIsNewOpen(false);
      void upsertInventarioToSupabase(next).catch(() => {});
    })();
  }

  function resolveActiveSectorId(): string | null {
    if (selectedSectorId && selectedSectorId !== "Todos") return selectedSectorId;
    return geralSector?.id ?? sectorsSorted.find((s) => normalizeSectorName(s.name).toLowerCase() === "geral")?.id ?? null;
  }

  async function persistItemQtySectorThenState(inventoryId: string, itemId: string, desiredValueRaw: string, opts?: { skipLockCheck?: boolean }): Promise<boolean> {
    const sectorId = resolveActiveSectorId();
    const cleanedValue = String(desiredValueRaw ?? "").trim();
    const numericValue = parsePtNumber(cleanedValue);
    let optimisticApplied = false;
    let rollbackSnapshot: { inventoryId: string; itemId: string; sectorId: string; origRow: InventarioItemRow } | null = null;

    if (!sectorId) {
      const currentInventory = contagens.find((c) => c.id === inventoryId);
      const currentItem = currentInventory?.categorias
        ?.flatMap((cat) => cat.itens ?? [])
        .find((it) => it.id === itemId);
      if (!currentInventory || !currentItem || itemHasSectors(currentItem)) {
        showSectorNotice("Selecione um setor válido para salvar a contagem.", true);
        return false;
      }
      rollbackSnapshot = { inventoryId, itemId, sectorId: "__legacy_geral__", origRow: { ...currentItem } };
      setContagens((prev) => normalizeContagens(prev.map((c) => {
        if (c.id !== inventoryId) return c;
        return {
          ...c,
          categorias: (c.categorias ?? []).map((cat) => ({
            ...cat,
            itens: (cat.itens ?? []).map((it) => (it.id === itemId ? { ...it, estoqueFinal: cleanedValue } : it)),
          })),
        };
      })));
      optimisticApplied = true;
      try {
        const categorias = (currentInventory.categorias ?? []).map((cat) => ({
          ...cat,
          itens: (cat.itens ?? []).map((it) =>
            it.id === itemId ? { ...it, estoqueFinal: cleanedValue } : it,
          ),
        }));
        const updated = normalizeContagens([{ ...currentInventory, categorias }])[0];
        await upsertInventarioToSupabase(updated);
        return true;
      } catch (err: any) {
        const msg = String(err?.message ?? err ?? "Erro ao salvar contagem").slice(0, 160);
        showSectorNotice(`Falha na persistência: ${msg}`, true);
        if (optimisticApplied && rollbackSnapshot) {
          setContagens((prev) => normalizeContagens(prev.map((c) => {
            if (c.id !== inventoryId) return c;
            return {
              ...c,
              categorias: (c.categorias ?? []).map((cat) => ({
                ...cat,
                itens: (cat.itens ?? []).map((it) => (it.id === itemId ? rollbackSnapshot!.origRow : it)),
              })),
            };
          })));
        }
        return false;
      }
    }

    const lockKey = `${inventoryId}|${itemId}|${sectorId}`;
    if (!opts?.skipLockCheck && sectorSavingLockRef.current.has(lockKey)) return false;
    sectorSavingLockRef.current.add(lockKey);
    setKeySaving(inventoryId, itemId, sectorId, "saving");

    try {
      setContagens((prev) => {
        const next = prev.map((c) => {
          if (c.id !== inventoryId) return c;
          const categorias = (c.categorias ?? []).map((cat) => {
            const itens = (cat.itens ?? []).map((origIt) => {
              if (origIt.id !== itemId) return origIt;
              if (!rollbackSnapshot) rollbackSnapshot = { inventoryId, itemId, sectorId, origRow: { ...origIt, sectorCounts: origIt.sectorCounts ? { ...origIt.sectorCounts } : undefined } };
              return buildOptimisticRow(origIt, sectorId, cleanedValue, numericValue);
            });
            return { ...cat, itens };
          });
          return { ...c, categorias };
        });
        return normalizeContagens(next);
      });
      optimisticApplied = true;

      await saveInventorySectorCountToSupabase({
        inventoryId,
        itemId,
        sectorId,
        quantityRaw: desiredValueRaw,
      });
      setKeySaving(inventoryId, itemId, sectorId, "saved");
      clearKeySaving(inventoryId, itemId, sectorId, 700);
      return true;
    } catch (err: any) {
      const msg = String(err?.message ?? err ?? "Erro ao salvar contagem").slice(0, 160);
      showSectorNotice(`Falha na persistência: ${msg}`, true);
      setKeySaving(inventoryId, itemId, sectorId, "error");
      if (optimisticApplied && rollbackSnapshot) {
        setContagens((prev) => normalizeContagens(prev.map((c) => {
          if (c.id !== inventoryId) return c;
          return {
            ...c,
            categorias: (c.categorias ?? []).map((cat) => ({
              ...cat,
              itens: (cat.itens ?? []).map((it) => (it.id === itemId ? rollbackSnapshot!.origRow : it)),
            })),
          };
        })));
      }
      window.setTimeout(() => clearKeySaving(inventoryId, itemId, sectorId, 0), 2200);
      return false;
    } finally {
      sectorSavingLockRef.current.delete(lockKey);
    }
  }

  async function updateItemQty(itemId: string, value: string) {
    const cId = selectedContagem?.id;
    if (!cId) return;
    const ok = await persistItemQtySectorThenState(cId, itemId, value);
    if (!ok) {
      let fallback = "";
      const cats = selectedContagem?.categorias ?? [];
      for (let i = 0; i < cats.length; i += 1) {
        const it = (cats[i].itens ?? []).find((x) => x.id === itemId);
        if (it) {
          fallback = String(it.estoqueFinal ?? "");
          break;
        }
      }
      setEditingValue(fallback);
    }
  }

  async function commitPendingDraft(itemId: string) {
    if (!(itemId in pendingDraftsRef.current)) return;
    const value = String(pendingDraftsRef.current[itemId] ?? "").trim();
    const cId = selectedContagem?.id;
    if (!cId) return;
    setPendingDrafts((prev) => {
      if (!(itemId in prev)) return prev;
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
    void persistItemQtySectorThenState(cId, itemId, value);
  }

  function removeItem(itemId: string) {
    const cId = selectedContagem?.id;
    if (!cId) return;
    setContagens((prev) => {
      const next = prev.map((c) => {
        if (c.id !== cId) return c;
        const categorias = (c.categorias ?? []).map((cat) => ({
          ...cat,
          itens: (cat.itens ?? []).map((it) => (it.id === itemId ? { ...it, removido: true, estoqueFinal: "", sectorCounts: {} } : it)),
        }));
        return { ...c, categorias };
      });
      const updated = next.find((x) => x.id === cId);
      if (updated) void upsertInventarioToSupabase(updated).catch(() => {});
      return next;
    });
  }

  function uncountItem(itemId: string) {
    setEditingItemId(null);
    setEditingValue("");
    setPendingDrafts((prev) => {
      if (!(itemId in prev)) return prev;
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
    const cId = selectedContagem?.id;
    if (!cId) return;
    void persistItemQtySectorThenState(cId, itemId, "");
  }

  function deleteContagem(id: string) {
    setContagens((prev) => {
      const next = prev.filter((c) => c.id !== id);
      if (selectedContagemId === id) setSelectedContagemId(next[0]?.id ?? null);
      return next;
    });
    setMenuContagemId(null);
    setMenuRect(null);
    void deleteInventarioFromSupabase(id).catch(() => {});
  }

  function openDeleteContagem(id: string) {
    const row = contagens.find((c) => c.id === id) ?? null;
    if (!row) return;
    setMenuContagemId(null);
    setMenuRect(null);
    setDeleteContagemRow(row);
    setIsDeleteContagemOpen(true);
  }

  function confirmDeleteContagem() {
    const row = deleteContagemRow;
    if (!row) return;
    setIsDeleteContagemOpen(false);
    setDeleteContagemRow(null);
    deleteContagem(row.id);
  }

  async function generatePdf() {
    const c = selectedContagem;
    if (!c) return;
    const itens = pendentes;
    const insById = new Map(insumosStore.map((i) => [String(i.id), i]));
    const insByName = new Map(insumosStore.map((i) => [String(i.item ?? "").toLowerCase(), i]));
    const prepById = new Map(prePreparoStore.map((r) => [prepInventoryId(String(r.id)), r]));
    const prepByName = new Map(prePreparoStore.map((r) => [String(r.receita ?? "").toLowerCase(), r]));
    const win = window.open("", "_blank");
    if (!win) return;
    const logoPath = "/dashboard/ml7hdudz-jry958l.svg";
    const logoUrl = `${window.location.origin}${logoPath}`;
    let logoSrc = logoUrl;
    try {
      const res = await fetch(logoUrl, { cache: "force-cache" });
      if (res.ok) {
        const svgText = await res.text();
        logoSrc = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
      }
    } catch {}
    const esc = (v: unknown) =>
      String(v ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
    const html = `<!doctype html><html><head><meta charset="utf-8" />
      <title>${esc(`Inventário ${c.data}`)}</title>
      <style>
        @page { margin: 0; }
        @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
        :root { --text:#111827; --muted:#6b7280; --border:#cfd3d7; --head:#f3f4f6; }
        *{box-sizing:border-box;}
        html,body{height:100%;}
        body{font-family: Arial, sans-serif; color:var(--text); margin:0; padding:18mm; background:#fff;}
        .wrap{width:100%; max-width: 190mm; margin: 0 auto;}
        .top{display:flex; align-items:flex-start; justify-content:space-between; gap:18px;}
        .brandRow{display:flex; align-items:center; gap:10px;}
        .logo{height:24px; width:auto; display:block;}
        .title{font-size:20px; font-weight:900; margin:0; text-align:right;}
        .meta{display:flex; align-items:flex-end; justify-content:space-between; gap:16px; margin-top:8px;}
        .metaLeft{font-size:13px; font-weight:900;}
        .metaLeft span{font-weight:700; color:var(--text);}
        .metaRight{font-size:13px; font-weight:900;}
        .rule{height:1px; background:var(--border); margin:12px 0 14px;}
        table{width:100%; border-collapse:collapse; table-layout:fixed;}
        th,td{border:1px solid var(--border); padding:8px 10px; font-size:12px; line-height:16px;}
        th{background:var(--head); text-align:left; font-weight:900;}
        .colItem{width:46%;}
        .colCat{width:26%;}
        .colQty{width:16%;}
        .colUnit{width:12%;}
        .footer{margin-top:12px; display:flex; justify-content:flex-end; color:var(--muted); font-size:10px; font-weight:700;}
      </style></head><body>
      <div class="wrap">
        <div class="top">
          <div class="brandRow">
            <img class="logo" src="${esc(logoSrc)}" alt="cmvFácil" />
          </div>
          <div class="title">Contagem de Inventário</div>
        </div>
        <div class="meta">
          <div class="metaLeft">Data de Inventário:&nbsp;<span>${esc(c.data)}</span></div>
          <div class="metaRight">Itens Pendentes</div>
        </div>
        <div class="rule"></div>
        <table>
          <thead>
            <tr>
              <th class="colItem">Item</th>
              <th class="colCat">Categoria</th>
              <th class="colQty">Contagem</th>
              <th class="colUnit">Und</th>
            </tr>
          </thead>
          <tbody>
            ${itens
              .map((i) => {
                const keyId = String(i.id ?? "");
                const keyName = String(i.item ?? "").toLowerCase();
                const src = insById.get(keyId) ?? prepById.get(keyId) ?? insByName.get(keyName) ?? prepByName.get(keyName) ?? null;
                const cat = normCatName(String((src as any)?.categoria ?? "")) || "-";
                const unit = String(i.unidade ?? "").trim() || "Und";
                return `<tr><td>${esc(i.item)}</td><td>${esc(cat)}</td><td></td><td>${esc(unit)}</td></tr>`;
              })
              .join("")}
          </tbody>
        </table>
        <div class="footer"></div>
      </div>
      </body></html>`;
    win.document.open();
    win.document.write(html);
    win.document.close();
    const waitImages = () =>
      Promise.all(
        Array.from(win.document.images).map(
          (img) =>
            new Promise<void>((resolve) => {
              if (img.complete) return resolve();
              img.onload = () => resolve();
              img.onerror = () => resolve();
            }),
        ),
      );
    try {
      await waitImages();
    } catch {}
    win.focus();
    win.print();
  }

  return (
    <>
      <main className={dash.content}>
        <div className={dash.pageFrame}>
        <QaModePanel screen="inventario" ui={qaUi} />
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
              display: "flex",
              justifyContent: "flex-end",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <span>{isReadOnly ? "Somente leitura" : "Editável"}</span>
          </div>
        ) : null}
        <section className={styles.layout}>
          <div className={styles.left}>
            <button
              type="button"
              className={styles.newCountBtn}
              disabled={isReadOnly}
              onClick={() => {
                if (isReadOnly) return;
                openNew();
              }}
            >
              <img src="/dashboard/ml7hdudz-6qw4osi.svg" className={styles.newCountIcon} alt="" />
              Nova Contagem
            </button>

            <div className={styles.leftTop}>
              <div className={styles.leftTitle}>{isCompatSource ? `Inventários (${compatInventories.length})` : `Suas contagens (${contagens.length})`}</div>
            </div>

            <div className={styles.datesList} ref={datesListRef} data-qa-grid="inventario">
              {(isCompatSource ? compatInventories : contagens).map((c: any) => (
                <div
                  key={c.id}
                  className={styles.dateRow}
                  onDoubleClick={() => {
                    if (isReadOnly || isCompatSource) return;
                    openEditContagem(c.id);
                  }}
                >
                  <button
                    type="button"
                    className={
                      (isCompatSource ? c.id === selectedCompatInventoryId : c.id === selectedContagemId) ? `${styles.dateBtn} ${styles.dateBtnOn}` : styles.dateBtn
                    }
                    onClick={() => {
                      if (isCompatSource) {
                        setSelectedCompatInventoryId(c.id);
                        return;
                      }
                      setSelectedContagemId(c.id);
                      setQuery("");
                    }}
                    onDoubleClick={(e) => {
                      e.preventDefault();
                      if (isReadOnly || isCompatSource) return;
                      openEditContagem(c.id);
                    }}
                    data-qa-grid-row
                    data-qa-row-id={c.id}
                  >
                    <span>{isCompatSource ? c.dataContagem : c.data}</span>
                    {isCompatSource ? <span className={styles.dateMeta}>{`${c.status}${c.bubble_id ? ` · ${c.bubble_id}` : ""}`}</span> : null}
                  </button>
                  {isCompatSource ? null : (
                    <>
                      <button
                        type="button"
                        className={styles.moreBtn}
                        aria-label="Mais opções"
                        onClick={(e) => {
                          const next = menuContagemId === c.id ? null : c.id;
                          if (!next) {
                            setMenuContagemId(null);
                            setMenuRect(null);
                            return;
                          }
                          menuAnchorRef.current = e.currentTarget;
                          const r = e.currentTarget.getBoundingClientRect();
                          setMenuRect({ left: Math.max(8, r.right - 160), top: r.bottom + 6 });
                          setMenuContagemId(next);
                        }}
                      >
                        ⋮
                      </button>
                      {menuContagemId === c.id ? (
                        <div className={styles.moreMenu} ref={menuRef} role="menu" style={menuRect ? { left: menuRect.left, top: menuRect.top } : undefined}>
                          <button
                            type="button"
                            className={styles.moreItem}
                            onClick={() => {
                              setMenuContagemId(null);
                              setMenuRect(null);
                              openEditContagem(c.id);
                            }}
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            className={styles.moreItem}
                            onClick={() => {
                              openDeleteContagem(c.id);
                            }}
                          >
                            Excluir
                          </button>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              ))}
              {isCompatSource ? (compatInventories[0] ? null : <div className={styles.muted}>Sem inventários</div>) : contagens[0] ? null : <div className={styles.muted}>Sem contagens</div>}
            </div>
          </div>

          <div className={styles.right}>
            {isLoadingInventario ? (
              <div className={dash.loadingOverlay}>
                <LoadingSpinner />
              </div>
            ) : null}
            <div className={styles.rightHeader}>
              <div className={styles.rightTitleRow}>
                <div className={styles.rightTitle}>
                  <IconBox />{" "}
                  {isCompatSource
                    ? selectedCompatInventory
                      ? `Inventário de ${selectedCompatInventory.dataContagem}`
                      : "Inventário"
                    : selectedContagem
                      ? `Inventário de ${selectedContagem.data}`
                      : "Inventário"}
                </div>
                <button
                  type="button"
                  className={styles.pdfBtn}
                  onClick={() => void generatePdf()}
                  disabled={isCompatSource || !selectedContagem}
                >
                  <img src="/dashboard/ml7hdudz-vztdpis.svg" className={styles.pdfIcon} alt="" />
                  Gerar PDF
                </button>
              </div>
              <div className={styles.rightSubtitle}>
                {isCompatSource
                  ? selectedCompatInventory
                    ? `${selectedCompatInventory.status}${selectedCompatInventory.responsavel && selectedCompatInventory.responsavel !== "-" ? ` · ${selectedCompatInventory.responsavel}` : ""}`
                    : "Visualize o inventário selecionado."
                  : "Visualize a contagem da data selecionada."}
              </div>
            </div>

            {sectorSaveErrorMsg ? (
              <div
                style={{
                  marginTop: 10,
                  padding: "8px 12px",
                  borderRadius: 6,
                  background: sectorSaveErrorMsg.startsWith("Falha") || sectorSaveErrorMsg.includes("cancelado") ? "#fef2f2" : "#ecfdf5",
                  color: sectorSaveErrorMsg.startsWith("Falha") || sectorSaveErrorMsg.includes("cancelado") ? "#b91c1c" : "#047857",
                  border: `1px solid ${sectorSaveErrorMsg.startsWith("Falha") || sectorSaveErrorMsg.includes("cancelado") ? "#fecaca" : "#a7f3d0"}`,
                  fontSize: 12,
                  fontWeight: 600,
                }}
                role="status"
              >
                {sectorSaveErrorMsg}
              </div>
            ) : null}

            {isCompatSource ? null : (
              <div className={styles.topFilters}>
                <div className={styles.search}>
                  <span className={styles.searchIcon} aria-hidden>
                    <IconSearch />
                  </span>
                  <input className={styles.searchInput} placeholder="Pesquise por itens..." value={query} onChange={(e) => setQuery(e.target.value)} />
                </div>

                <select className={styles.select} value={categoriaFilter} onChange={(e) => setCategoriaFilter(e.target.value)}>
                  {categorias.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>

                <select
                  className={styles.select}
                  value={selectedSectorId}
                  onChange={(e) => {
                    setSelectedSectorId(e.target.value);
                    setEditingItemId(null);
                    setEditingValue("");
                  }}
                  style={{ minWidth: 150 }}
                >
                  <option value="Todos">Todos / Consolidado</option>
                  {sectorsSorted.filter((s) => normalizeSectorName(s.name).toLowerCase() !== "geral").map((s) => (
                    <option key={s.id} value={s.id}>
                      Setor: {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {!isCompatSource && selectedSectorId === "Todos" ? (
              <div
                style={{
                  marginTop: 6,
                  fontSize: 11,
                  color: "#92400e",
                  background: "#fffbeb",
                  border: "1px solid #fde68a",
                  padding: "6px 10px",
                  borderRadius: 6,
                  fontWeight: 600,
                }}
              >
                Itens com setores são contabilizados separadamente. Itens sem setor podem ser contados diretamente no Geral.
              </div>
            ) : null}

            {isCompatSource ? (
              <div className={styles.compatTableWrap} data-qa-grid="inventario:itens">
                <div className={styles.compatTableTitle}>{`Itens (${selectedCompatInventory?.itens?.length ?? 0})`}</div>
                <div className={styles.compatTableScroll}>
                  <table className={styles.compatTable}>
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Categoria</th>
                        <th>Unid</th>
                        <th>Qtd esp.</th>
                        <th>Qtd cont.</th>
                        <th>Dif.</th>
                        <th>Custo méd.</th>
                        <th>Valor dif.</th>
                        <th>Ocultar CMV</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(selectedCompatInventory?.itens ?? []).map((it) => (
                        <tr key={it.id} data-qa-grid-row data-qa-row-id={it.id}>
                          <td>{it.item}</td>
                          <td>{it.categoria}</td>
                          <td>{it.unidade}</td>
                          <td>{it.quantidadeEsperada}</td>
                          <td>{it.quantidadeContada}</td>
                          <td>{it.diferenca}</td>
                          <td>{it.custoMedio}</td>
                          <td>{it.valorDiferenca}</td>
                          <td>{it.ocultarCmv ? "Sim" : "Não"}</td>
                        </tr>
                      ))}
                      {selectedCompatInventory?.itens?.[0] ? null : (
                        <tr>
                          <td colSpan={9} className={styles.compatEmpty}>
                            Sem itens
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {isCompatSource ? null : (
            <div className={styles.cols}>
              <div className={styles.col}>
                <div className={styles.colHeadPending}>
                  Pendentes
                  {selectedSectorId !== "Todos" ? (
                    <span style={{ marginLeft: 10, fontSize: 11, fontWeight: 700, opacity: 0.85 }}>
                      · Setor: {sectorsSorted.find((s) => s.id === selectedSectorId)?.name ?? "-"}
                    </span>
                  ) : (
                    <span style={{ marginLeft: 10, fontSize: 11, fontWeight: 700, opacity: 0.75 }}>· Consolidado</span>
                  )}
                </div>
                <div className={styles.colBody} ref={pendingColBodyRef}>
                  {pendentes.map((r) => {
                    const sc: Record<string, string> = (r as any).sectorCounts ?? {};
                    const activeSectorValue =
                      selectedSectorId !== "Todos"
                        ? String(pendingDrafts[r.id] ?? sc[selectedSectorId] ?? "")
                        : String(pendingDrafts[r.id] ?? r.estoqueFinal ?? "");
                    const rowHasSectors = itemHasSectors(r);
                    const editDisabled = isReadOnly || (selectedSectorId === "Todos" && rowHasSectors);
                    const disabledReason = (() => {
                      if (!editDisabled) return "";
                      if (selectedSectorId === "Todos" && rowHasSectors) return "Item com setores: contabilize em um setor específico.";
                      if (isReadOnly) return "Somente leitura.";
                      return "";
                    })();
                    const cId = selectedContagem?.id ?? "";
                    const sId = resolveActiveSectorId();
                    const rowStatus = getKeySaving(cId, String(r.id ?? ""), sId);
                    const statusStyle: React.CSSProperties | undefined = rowStatus === "saving" ? { color: "#6b7280" } : rowStatus === "saved" ? { color: "#047857" } : rowStatus === "error" ? { color: "#b91c1c" } : undefined;
                    const statusLabel = rowStatus === "saving" ? "Salvando…" : rowStatus === "saved" ? "Salvo" : rowStatus === "error" ? "Erro ao salvar" : "";
                    return (
                    <div key={r.id} className={styles.itemRow}>
                      <div className={styles.itemLeft}>
                        <div className={styles.dotPending} aria-hidden />
                        <div className={styles.itemText}>
                          <div className={styles.itemTitle}>{r.item}</div>
                            <div className={styles.itemSub}>{itemCategoryMap.get(String(r.id ?? "")) ?? "Sem categoria"}</div>
                            {(() => {
                              const entries = Object.entries(sc).filter(([, v]) => String(v ?? "").trim());
                              if (!entries.length) return null;
                              const byId = new Map(sectorsSorted.map((s) => [s.id, s]));
                              return (
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: 4 }}>
                                  {entries.slice(0, 5).map(([sid, qty]) => {
                                    const s = byId.get(sid);
                                    const totalNum = Object.values(sc).reduce((a, v) => a + parsePtNumber(String(v ?? "")), 0);
                                    const isSel = selectedSectorId === sid;
                                    return (
                                      <span
                                        key={sid}
                                        title={s?.name ?? sid}
                                        style={{
                                          fontSize: 10,
                                          padding: "1px 6px",
                                          borderRadius: 999,
                                          background: isSel ? "#1f6feb" : "#eef2f7",
                                          color: isSel ? "#fff" : "#1f2937",
                                          fontWeight: isSel ? 700 : 600,
                                          lineHeight: 1.5,
                                        }}
                                      >
                                        {s?.name ?? "?"}: {String(qty).replace(/\.000$/, "").trim() || "0"}
                                        {totalNum > 0 && isSel ? ` · Σ ${formatDecimal3Places(totalNum)}` : ""}
                                      </span>
                                    );
                                  })}
                                  {entries.length > 5 ? (
                                    <span style={{ fontSize: 10, color: "#6b7280" }}>+{entries.length - 5}</span>
                                  ) : null}
                                </div>
                              );
                            })()}
                        </div>
                      </div>
                      <div className={styles.itemRight}>
                        <input
                          data-inv-pending={editDisabled ? "0" : "1"}
                          className={styles.qtyInput}
                          value={activeSectorValue}
                          disabled={editDisabled}
                          onChange={(e) => {
                            const value = e.target.value;
                            pendingDraftsRef.current = { ...pendingDraftsRef.current, [r.id]: value };
                            setPendingDrafts((prev) => ({ ...prev, [r.id]: value }));
                          }}
                          onBlur={() => { if (!editDisabled) commitPendingDraft(r.id); }}
                          onKeyDown={(e) => {
                            if (editDisabled) return;
                            if (e.key === "Enter") {
                              e.preventDefault();
                              const root = pendingColBodyRef.current;
                              const beforeInputs = Array.from(root?.querySelectorAll<HTMLInputElement>('input[data-inv-pending="1"]') ?? []);
                              const beforeIndex = beforeInputs.indexOf(e.currentTarget);
                              commitPendingDraft(r.id);
                              window.setTimeout(() => {
                                const afterInputs = Array.from(root?.querySelectorAll<HTMLInputElement>('input[data-inv-pending="1"]') ?? []);
                                if (!afterInputs.length) return;
                                const nextIndex = Math.max(0, Math.min(beforeIndex, afterInputs.length - 1));
                                const next = afterInputs[nextIndex];
                                next.focus();
                                requestAnimationFrame(() => next.select());
                              }, 0);
                            }
                            if (e.key === "Escape") {
                              e.preventDefault();
                              setPendingDrafts((prev) => {
                                if (!(r.id in prev)) return prev;
                                const next = { ...prev };
                                delete next[r.id];
                                return next;
                              });
                              e.currentTarget.blur();
                            }
                          }}
                          placeholder={editDisabled ? (rowHasSectors && selectedSectorId === "Todos" ? "Contar em setor" : "0") : "0"}
                          title={disabledReason}
                          style={editDisabled ? { background: "#f9fafb", color: "#6b7280", cursor: rowHasSectors && selectedSectorId === "Todos" ? "not-allowed" : "text" } : undefined}
                        />
                        <div className={styles.unitPill} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, minWidth: 44 }}>
                          <div>{r.unidade}</div>
                          {statusLabel ? (
                            <div style={{ fontSize: 10, fontWeight: 700, ...statusStyle, whiteSpace: "nowrap" }}>{statusLabel}</div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    );
                  })}
                  {pendentes[0] ? null : <div className={styles.emptyCol}>Sem itens pendentes</div>}
                </div>
              </div>

              <div className={styles.col}>
                <div className={styles.colHeadDone}>
                  Contabilizados
                  {selectedSectorId !== "Todos" ? (
                    <span style={{ marginLeft: 10, fontSize: 11, fontWeight: 700, opacity: 0.85 }}>
                      · Setor: {sectorsSorted.find((s) => s.id === selectedSectorId)?.name ?? "-"}
                    </span>
                  ) : null}
                </div>
                <div className={styles.colBody}>
                  {contabilizados.map((r) => {
                    const sc: Record<string, string> = (r as any).sectorCounts ?? {};
                    const sectorEntries = Object.entries(sc).filter(([, v]) => String(v ?? "").trim());
                    const byId = new Map(sectorsSorted.map((s) => [s.id, s]));
                    const totalNum = sectorEntries.reduce((a, [, v]) => a + parsePtNumber(String(v ?? "")), 0);
                    const rowHasSectors = itemHasSectors(r);
                    const editDisabled = isReadOnly || (selectedSectorId === "Todos" && rowHasSectors);
                    const disabledReason = (() => {
                      if (!editDisabled) return "";
                      if (selectedSectorId === "Todos" && rowHasSectors) return "Item com setores: contabilize em um setor específico.";
                      if (isReadOnly) return "Somente leitura.";
                      return "";
                    })();
                    const activeSectorDisplay =
                      selectedSectorId !== "Todos"
                        ? editingItemId === r.id
                          ? editingValue
                          : String(sc[selectedSectorId] ?? "")
                        : String(r.estoqueFinal ?? "");
                    const activeEditOriginal =
                      selectedSectorId !== "Todos" ? String(sc[selectedSectorId] ?? "") : String(r.estoqueFinal ?? "");
                    const cId = selectedContagem?.id ?? "";
                    const sId = resolveActiveSectorId();
                    const rowStatus = getKeySaving(cId, String(r.id ?? ""), sId);
                    const statusStyle: React.CSSProperties | undefined = rowStatus === "saving" ? { color: "#6b7280" } : rowStatus === "saved" ? { color: "#047857" } : rowStatus === "error" ? { color: "#b91c1c" } : undefined;
                    const statusLabel = rowStatus === "saving" ? "Salvando…" : rowStatus === "saved" ? "Salvo" : rowStatus === "error" ? "Erro ao salvar" : "";
                    return (
                    <div key={r.id} className={styles.itemRow}>
                      <div className={styles.itemLeft}>
                        <div className={styles.dotDone} aria-hidden>
                          ✓
                        </div>
                        <div className={styles.itemText}>
                          <div className={styles.itemTitle}>{r.item}</div>
                            <div className={styles.itemSub}>{itemCategoryMap.get(String(r.id ?? "")) ?? "Sem categoria"}</div>
                            {(() => {
                              if (!sectorEntries.length) return null;
                              return (
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: 4 }}>
                                  {sectorEntries.slice(0, 5).map(([sid, qty]) => {
                                    const s = byId.get(sid);
                                    const isSel = selectedSectorId === sid;
                                    return (
                                      <span
                                        key={sid}
                                        title={s?.name ?? sid}
                                        style={{
                                          fontSize: 10,
                                          padding: "1px 6px",
                                          borderRadius: 999,
                                          background: isSel ? "#1f6feb" : "#eef2f7",
                                          color: isSel ? "#fff" : "#1f2937",
                                          fontWeight: isSel ? 700 : 600,
                                          lineHeight: 1.5,
                                        }}
                                      >
                                        {s?.name ?? "?"}: {String(qty).replace(/\.000$/, "").trim() || "0"}
                                      </span>
                                    );
                                  })}
                                  {sectorEntries.length > 5 ? (
                                    <span style={{ fontSize: 10, color: "#6b7280" }}>+{sectorEntries.length - 5}</span>
                                  ) : null}
                                  {sectorEntries.length >= 1 && totalNum > 0 ? (
                                    <span
                                      style={{
                                        fontSize: 10,
                                        padding: "1px 6px",
                                        borderRadius: 999,
                                        background: "#fef3c7",
                                        color: "#92400e",
                                        fontWeight: 800,
                                        marginLeft: "auto",
                                      }}
                                      title="Total geral consolidado"
                                    >
                                      Σ {formatDecimal3Places(totalNum)} {r.unidade}
                                    </span>
                                  ) : null}
                                </div>
                              );
                            })()}
                        </div>
                      </div>
                      <div className={styles.itemRight}>
                        {editingItemId === r.id ? (
                          <>
                            <input
                              ref={editInputRef}
                              className={styles.qtyInput}
                              value={editingValue}
                              disabled={editDisabled}
                              onChange={(e) => setEditingValue(e.target.value)}
                              style={editDisabled ? { background: "#f9fafb", color: "#6b7280", cursor: rowHasSectors && selectedSectorId === "Todos" ? "not-allowed" : "text" } : undefined}
                              placeholder={editDisabled && rowHasSectors && selectedSectorId === "Todos" ? "Contar em setor" : undefined}
                              title={disabledReason}
                              onKeyDown={(e) => {
                                if (editDisabled) return;
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  editCancelledRef.current = false;
                                  updateItemQty(r.id, editingValue);
                                  setEditingItemId(null);
                                }
                                if (e.key === "Escape") {
                                  e.preventDefault();
                                  editCancelledRef.current = true;
                                  setEditingValue(editOriginalValueRef.current);
                                  setEditingItemId(null);
                                }
                              }}
                              onBlur={() => {
                                if (editDisabled) {
                                  setEditingItemId(null);
                                  return;
                                }
                                if (editCancelledRef.current) {
                                  editCancelledRef.current = false;
                                  setEditingItemId(null);
                                  return;
                                }
                                updateItemQty(r.id, editingValue);
                                setEditingItemId(null);
                              }}
                            />
                            <div className={styles.unitPill} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, minWidth: 44 }}>
                              <div>{r.unidade}</div>
                              {statusLabel ? (
                                <div style={{ fontSize: 10, fontWeight: 700, ...statusStyle, whiteSpace: "nowrap" }}>{statusLabel}</div>
                              ) : null}
                            </div>
                          </>
                        ) : (
                          <>
                            <div
                              className={styles.qtyLabel}
                              onClick={() => {
                                if (editDisabled) return;
                                editCancelledRef.current = false;
                                editOriginalValueRef.current = activeEditOriginal;
                                setEditingItemId(r.id);
                                setEditingValue(activeEditOriginal);
                                setTimeout(() => editInputRef.current?.focus(), 0);
                              }}
                              role="button"
                              tabIndex={editDisabled ? -1 : 0}
                              onKeyDown={(e) => {
                                if (editDisabled) return;
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  editCancelledRef.current = false;
                                  editOriginalValueRef.current = activeEditOriginal;
                                  setEditingItemId(r.id);
                                  setEditingValue(activeEditOriginal);
                                  setTimeout(() => editInputRef.current?.focus(), 0);
                                }
                              }}
                              style={editDisabled ? { cursor: "default", opacity: 0.85 } : undefined}
                              title={editDisabled ? disabledReason || "Selecione um setor específico para editar" : "Clique para editar"}
                            >
                              <div>
                                {editingItemId !== r.id && selectedSectorId !== "Todos" && sectorEntries.length > 1 ? (
                                  <div style={{ fontSize: 10, color: "#6b7280", fontWeight: 600, marginBottom: 2 }}>
                                    Setor atual · Total geral: {formatDecimal3Places(totalNum)} {r.unidade}
                                  </div>
                                ) : null}
                                <div>{`${activeSectorDisplay || "0"} ${r.unidade}`}</div>
                              </div>
                            </div>
                            <div className={styles.unitPill} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, minWidth: 44 }}>
                              <div>{r.unidade}</div>
                              {statusLabel ? (
                                <div style={{ fontSize: 10, fontWeight: 700, ...statusStyle, whiteSpace: "nowrap" }}>{statusLabel}</div>
                              ) : null}
                            </div>
                          </>
                        )}
                        <div className={styles.actions}>
                          <button
                            type="button"
                            className={styles.iconBtn}
                            aria-label="Editar"
                            disabled={editDisabled}
                            onMouseDown={(e) => {
                              if (editingItemId === r.id) e.preventDefault();
                            }}
                            onClick={() => {
                              if (editDisabled) return;
                              if (editingItemId === r.id) {
                                editCancelledRef.current = false;
                                updateItemQty(r.id, editingValue);
                                setEditingItemId(null);
                                return;
                              }
                              editCancelledRef.current = false;
                              editOriginalValueRef.current = activeEditOriginal;
                              setEditingItemId(r.id);
                              setEditingValue(activeEditOriginal);
                              setTimeout(() => editInputRef.current?.focus(), 0);
                            }}
                            title={editDisabled ? "Selecione um setor específico para editar" : ""}
                          >
                            <IconPencil />
                          </button>
                          <button
                            type="button"
                            className={styles.iconBtn}
                            aria-label="Zerar contagem"
                            onMouseDown={(e) => {
                              if (editingItemId === r.id) e.preventDefault();
                            }}
                            onClick={() => uncountItem(r.id)}
                            title="Zerar contagem do item/setor"
                          >
                            <IconTrash />
                          </button>
                        </div>
                      </div>
                    </div>
                    );
                  })}
                  {contabilizados[0] ? null : <div className={styles.emptyCol}>Sem itens contabilizados</div>}
                </div>
              </div>
            </div>
            )}
          </div>
        </section>

        {mounted && isNewOpen && !isCompatSource
          ? createPortal(
              <div className={styles.modalOverlay} role="dialog" aria-modal="true">
            <div className={styles.modal}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitle}>{editingContagemId ? "Editar Data" : "Nova Contagem"}</div>
                <button type="button" className={styles.modalClose} onClick={() => setIsNewOpen(false)} aria-label="Fechar">
                  ×
                </button>
              </div>
              <div className={styles.modalBody}>
                <div className={styles.field}>
                  <div className={styles.label}>Data da Contagem</div>
                  <div className={styles.calendarWrap} ref={newCalWrapRef}>
                    <input
                      className={styles.input}
                      value={newData}
                      onChange={(e) => setNewData(e.target.value)}
                      onClick={(e) => {
                        const r = e.currentTarget.getBoundingClientRect();
                        setNewCalRect({ left: Math.max(8, r.left + r.width / 2 - 180), top: r.bottom + 6 });
                        setNewCalMonth(startOfMonth(parseDateNumericLoose(newData) ?? new Date()));
                        setIsNewCalOpen(true);
                      }}
                      onFocus={(e) => {
                        const r = e.currentTarget.getBoundingClientRect();
                        setNewCalRect({ left: Math.max(8, r.left + r.width / 2 - 180), top: r.bottom + 6 });
                        setNewCalMonth(startOfMonth(parseDateNumericLoose(newData) ?? new Date()));
                        setIsNewCalOpen(true);
                      }}
                      placeholder="DD/MM/AAAA"
                    />

                    {isNewCalOpen ? (
                      <div className={styles.calendarPopover} style={newCalRect ? { left: newCalRect.left, top: newCalRect.top } : undefined}>
                        <div className={styles.calendarHeader}>
                          <button type="button" className={styles.calNavBtn} onClick={() => setNewCalMonth((d) => addMonths(d, -1))} aria-label="Mês anterior">
                            ‹
                          </button>
                          <div className={styles.calTitle}>
                            <span className={styles.calMonthName}>
                              {["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"][
                                newCalMonth.getMonth()
                              ]}
                            </span>
                            <span className={styles.calYear}>{newCalMonth.getFullYear()}</span>
                          </div>
                          <button type="button" className={styles.calNavBtn} onClick={() => setNewCalMonth((d) => addMonths(d, 1))} aria-label="Próximo mês">
                            ›
                          </button>
                        </div>

                        <div className={styles.calDow}>
                          {["dom", "seg", "ter", "qua", "qui", "sex", "sab"].map((d) => (
                            <div key={d} className={styles.calDowCell}>
                              {d}
                            </div>
                          ))}
                        </div>

                        <div className={styles.calGrid}>
                          {(() => {
                            const selected = parseDateNumericLoose(newData);
                            const monthStart = startOfMonth(newCalMonth);
                            const firstDow = monthStart.getDay();
                            const nextMonth = addMonths(monthStart, 1);
                            const daysInMonth = Math.round((nextMonth.getTime() - monthStart.getTime()) / 86400000);
                            const cells: JSX.Element[] = [];
                            for (let i = 0; i < firstDow; i++) {
                              cells.push(<div key={`e-${i}`} className={styles.calEmpty} />);
                            }
                            for (let day = 1; day <= daysInMonth; day++) {
                              const d = new Date(monthStart.getFullYear(), monthStart.getMonth(), day);
                              const isSelected =
                                selected &&
                                d.getFullYear() === selected.getFullYear() &&
                                d.getMonth() === selected.getMonth() &&
                                d.getDate() === selected.getDate();
                              cells.push(
                                <button
                                  type="button"
                                  key={`d-${day}`}
                                  className={isSelected ? `${styles.calDay} ${styles.calDayOn}` : styles.calDay}
                                  onClick={() => {
                                    setNewData(formatDateNumericPT(d));
                                    setIsNewCalOpen(false);
                                    setNewCalRect(null);
                                  }}
                                >
                                  {day}
                                </button>,
                              );
                            }
                            const total = cells.length;
                            const remainder = total % 7;
                            if (remainder) {
                              const pad = 7 - remainder;
                              for (let i = 0; i < pad; i++) cells.push(<div key={`p-${i}`} className={styles.calEmptyMuted} />);
                            }
                            return cells;
                          })()}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
                {newError ? <div className={styles.formError}>{newError}</div> : null}
              </div>
              <div className={styles.modalFooter}>
                <button type="button" className={`${styles.primaryBtn} ${styles.primaryBtnWide}`} onClick={confirmNew} disabled={!newData.trim()}>
                  {editingContagemId ? "Salvar" : "Começar"}
                </button>
              </div>
            </div>
          </div>,
              document.body,
            )
          : null}

        {mounted && isDeleteContagemOpen && deleteContagemRow && !isCompatSource
          ? createPortal(
              <div
                className={styles.modalOverlay}
                role="dialog"
                aria-modal="true"
                onClick={() => {
                  setIsDeleteContagemOpen(false);
                  setDeleteContagemRow(null);
                }}
              >
                <div className={`${styles.modal} ${styles.confirmModal}`} onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitle}>Excluir Contagem?</div>
                <button
                  type="button"
                  className={styles.modalClose}
                  onClick={() => {
                    setIsDeleteContagemOpen(false);
                    setDeleteContagemRow(null);
                  }}
                  aria-label="Fechar"
                >
                  ×
                </button>
              </div>

              <div className={styles.confirmBody}>
                <div className={styles.confirmIcon} aria-hidden>
                  <IconTrash />
                </div>
                <div className={styles.confirmText}>
                  Caso exclua a contagem do dia <strong>{deleteContagemRow.data}</strong> não poderá recuperá-la.
                </div>
              </div>

              <div className={styles.confirmActions}>
                <button type="button" className={styles.confirmDelete} onClick={confirmDeleteContagem}>
                  Excluir
                </button>
                <button
                  type="button"
                  className={styles.confirmCancel}
                  onClick={() => {
                    setIsDeleteContagemOpen(false);
                    setDeleteContagemRow(null);
                  }}
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>,
              document.body,
            )
          : null}
        </div>
      </main>
    </>
  );
}
