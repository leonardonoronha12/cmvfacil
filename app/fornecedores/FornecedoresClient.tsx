"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import dash from "../dashboard/dashboard.module.css";
import SystemToast from "../components/SystemToast";
import LoadingSpinner from "../components/LoadingSpinner";
import useCappedLoading from "../components/useCappedLoading";
import usePagination from "../components/usePagination";
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
  type FornecedorInfoMap,
  type FornecedorEquivalenciasMap,
  type FornecedorProdutos,
} from "../lib/fornecedoresStore";
import { loadFornecedoresStateFromSupabase, saveFornecedoresStateToSupabase } from "../lib/fornecedoresSupabase";
import { loadInsumosFromSupabase } from "../lib/insumosSupabase";
import { readInsumosFromStore, subscribeInsumos, writeInsumosToStore, type InsumoStoreItem } from "../lib/insumosStore";
import { QaModePanel } from "../lib/qaMode";
import styles from "./fornecedores.module.css";
import { maskPhoneBR } from "../lib/masks";

type FornecedorRow = {
  id: string;
  fornecedor: string;
  itens: number;
  vendedorNome: string;
  whatsapp: string;
  endereco: string;
};

function looksLikeItemId(value: string) {
  const s = String(value ?? "").trim();
  if (!s) return false;
  if (/^\d{10,}$/.test(s)) return true;
  return /^\d{8,}x\d{6,}$/.test(s);
}

function isStableFornecedorKey(key: string) {
  const s = String(key ?? "").trim();
  if (!s) return false;
  if (s.toLowerCase().startsWith("db:")) return true;
  if (/^\d{10,}$/.test(s)) return true;
  return /^\d{8,}x\d{6,}$/i.test(s);
}

function normalizeFornecedorKey(key: string) {
  const s = String(key ?? "").trim();
  if (!s) return "";
  if (s.toLowerCase().startsWith("db:")) return `db:${s.slice(3).trim().toLowerCase()}`;
  return isStableFornecedorKey(s) ? s : s.toUpperCase();
}

function getProdutosForKey(map: FornecedorProdutos, key: string) {
  const raw = String(key ?? "").trim();
  if (!raw) return [];
  const norm = normalizeFornecedorKey(raw);
  return map[norm] ?? map[raw] ?? map[raw.toUpperCase()] ?? map[raw.toLowerCase()] ?? [];
}

function getEquivalenciasForKey(map: FornecedorEquivalenciasMap, key: string) {
  const raw = String(key ?? "").trim();
  if (!raw) return [];
  const norm = normalizeFornecedorKey(raw);
  return map[norm] ?? map[raw] ?? map[raw.toUpperCase()] ?? map[raw.toLowerCase()] ?? [];
}

function keyVariants(rawKey: string) {
  const raw = String(rawKey ?? "").trim();
  const norm = normalizeFornecedorKey(raw);
  const s = new Set<string>();
  for (const v of [raw, norm, raw.toUpperCase(), raw.toLowerCase(), norm.toUpperCase(), norm.toLowerCase()]) {
    const t = String(v ?? "").trim();
    if (t) s.add(t);
  }
  return { norm, variants: Array.from(s.values()) };
}

function setProdutosForKey(map: FornecedorProdutos, rawKey: string, list: string[]) {
  const { norm, variants } = keyVariants(rawKey);
  if (!norm) return map;
  const next: FornecedorProdutos = { ...map };
  for (const k of variants) {
    if (k !== norm && Object.prototype.hasOwnProperty.call(next, k)) delete (next as any)[k];
  }
  if (list.length) next[norm] = list;
  else if (Object.prototype.hasOwnProperty.call(next, norm)) delete (next as any)[norm];
  return next;
}

function setEquivalenciasForKey(map: FornecedorEquivalenciasMap, rawKey: string, list: any[]) {
  const { norm, variants } = keyVariants(rawKey);
  if (!norm) return map;
  const next: FornecedorEquivalenciasMap = { ...map };
  for (const k of variants) {
    if (k !== norm && Object.prototype.hasOwnProperty.call(next, k)) delete (next as any)[k];
  }
  if (list.length) next[norm] = list as any;
  else if (Object.prototype.hasOwnProperty.call(next, norm)) delete (next as any)[norm];
  return next;
}

function IconBox() {
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

function SortIcon({ dir }: { dir: "asc" | "desc" }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
      {dir === "asc" ? <path d="M7 14 12 9l5 5H7Z" fill="currentColor" /> : <path d="M7 10h10l-5 5-5-5Z" fill="currentColor" />}
    </svg>
  );
}

function IconUser() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm-7 9a7 7 0 0 1 14 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconPin() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 21s7-5.1 7-11a7 7 0 1 0-14 0c0 5.9 7 11 7 11Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path d="M12 10.5a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z" fill="currentColor" opacity="0.15" />
    </svg>
  );
}

type ColumnKey = "fornecedor" | "itens" | "whatsapp" | "endereco";

function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}+/gu, "")
    .replace(/\s+/g, " ");
}

function parseCsvLine(line: string, delimiter: "," | ";") {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] ?? "";
    if (ch === '"') {
      const next = line[i + 1] ?? "";
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && ch === delimiter) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map((c) => c.trim());
}

function parseSupplierRowsFromTable(table: unknown[][]) {
  const safe = table.filter((r) => Array.isArray(r) && r.some((c) => String(c ?? "").trim() !== ""));
  if (!safe.length) return [];

  const header = safe[0] ?? [];
  const headerMap = new Map<string, number>();
  header.forEach((h, i) => {
    const key = normalizeHeader(h);
    if (!key) return;
    if (!headerMap.has(key)) headerMap.set(key, i);
  });

  const hasHeader = ["fornecedor", "fornecedores", "supplier"].some((k) => headerMap.has(k));
  const startIndex = hasHeader ? 1 : 0;

  let idxFornecedor = 0;
  let idxItens = -1;
  let idxVendedorNome = -1;
  let idxWhatsapp = -1;
  let idxEndereco = -1;

  if (hasHeader) {
    idxFornecedor = headerMap.get("fornecedor") ?? headerMap.get("fornecedores") ?? 0;
    idxItens = headerMap.get("itens") ?? headerMap.get("items") ?? -1;
    idxEndereco = headerMap.get("endereco") ?? headerMap.get("endereço") ?? headerMap.get("address") ?? -1;

    const whatsappKey =
      headerMap.get("whatsapp") ?? headerMap.get("telefone") ?? headerMap.get("celular") ?? headerMap.get("phone") ?? null;
    const vendedorNomeKey =
      headerMap.get("contato") ??
      headerMap.get("nome vendedor") ??
      headerMap.get("vendedor nome") ??
      headerMap.get("vendedor_nome") ??
      null;

    if (whatsappKey !== null) {
      idxWhatsapp = whatsappKey;
      idxVendedorNome = vendedorNomeKey ?? (headerMap.get("vendedor") ?? -1);
    } else {
      idxWhatsapp = headerMap.get("vendedor") ?? -1;
      idxVendedorNome = vendedorNomeKey ?? -1;
    }
  } else {
    const sample = safe[startIndex] ?? [];
    idxFornecedor = 0;
    if (sample.length >= 4) {
      idxItens = 1;
      idxWhatsapp = 2;
      idxEndereco = 3;
    } else if (sample.length === 3) {
      idxWhatsapp = 1;
      idxEndereco = 2;
    } else if (sample.length === 2) {
      idxEndereco = 1;
    }
  }

  const out: FornecedorRow[] = [];
  for (let i = startIndex; i < safe.length; i++) {
    const row = safe[i] ?? [];
    const fornecedor = String(row[idxFornecedor] ?? "").trim();
    if (!fornecedor) continue;
    const itensRaw = idxItens >= 0 ? String(row[idxItens] ?? "").trim() : "";
    const itens = itensRaw ? Number.parseInt(itensRaw.replace(/[^\d]/g, "") || "0", 10) : 0;
    const vendedorNome = idxVendedorNome >= 0 ? String(row[idxVendedorNome] ?? "").trim() || "-" : "-";
    const whatsapp = idxWhatsapp >= 0 ? String(row[idxWhatsapp] ?? "").trim() || "-" : "-";
    const endereco = idxEndereco >= 0 ? String(row[idxEndereco] ?? "").trim() || "-" : "-";
    out.push({
      id: String(out.length + 1),
      fornecedor,
      itens: Number.isFinite(itens) ? itens : 0,
      vendedorNome,
      whatsapp,
      endereco,
    });
  }
  return out;
}

export default function FornecedoresClient() {
  const TOMBSTONE_KEY = "__CMVFACIL_DELETED_SUPPLIERS__";
  const [isMounted, setIsMounted] = useState(false);
  const [isLoadingTable, setIsLoadingTable] = useState(() => Object.keys(readFornecedorInfoMap()).length === 0);
  const [sourceMeta, setSourceMeta] = useState<{ source: "legacy" | "compat"; readOnly: boolean }>({ source: "legacy", readOnly: false });
  const toastTimerRef = useRef<number | null>(null);
  const [toast, setToast] = useState<{ title: string; message: string; tone: "success" | "error" } | null>(null);
  const [rows, setRows] = useState<FornecedorRow[]>([]);
  const [query, setQuery] = useState("");
  const isReadOnly = Boolean(sourceMeta.readOnly);

  const [sortKey, setSortKey] = useState<null | ColumnKey>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [columnOrder, setColumnOrder] = useState<ColumnKey[]>(["fornecedor", "itens", "whatsapp", "endereco"]);
  const [draggingColumn, setDraggingColumn] = useState<null | ColumnKey>(null);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isProdutosOpen, setIsProdutosOpen] = useState(false);
  const [prodFornecedorKey, setProdFornecedorKey] = useState<string | null>(null);
  const [prodFornecedorLabel, setProdFornecedorLabel] = useState<string>("");
  const [prodVendedor, setProdVendedor] = useState<string>("");
  const [prodEndereco, setProdEndereco] = useState<string>("");
  const [produtosMap, setProdutosMap] = useState<FornecedorProdutos>(() => readFornecedorProdutosMap());
  const [infoMap, setInfoMap] = useState<FornecedorInfoMap>(() => readFornecedorInfoMap());
  const [equivalenciasMap, setEquivalenciasMap] = useState<FornecedorEquivalenciasMap>(() => readFornecedorEquivalenciasMap());
  const fornecedoresReadyRef = useRef(false);
  const fornecedoresSyncTimeoutRef = useRef<number | null>(null);
  const fornecedoresPersistedSnapshotRef = useRef("");
  const fornecedoresLoadErrorShownRef = useRef(false);
  const fornecedoresSaveErrorShownRef = useRef(false);
  const fornecedoresIncrementalMutexRef = useRef<Map<string, Promise<void>>>(new Map());
  const fornecedoresIncrementalNonceRef = useRef(0);
  const [insumosStore, setInsumosStore] = useState<InsumoStoreItem[]>([]);
  const [produtoDraft, setProdutoDraft] = useState("");
  const [produtoQuery, setProdutoQuery] = useState("");
  const [isProdutoMenuOpen, setIsProdutoMenuOpen] = useState(false);
  const produtoMenuRef = useRef<HTMLDivElement | null>(null);
  const produtoDropdownRef = useRef<HTMLDivElement | null>(null);
  const produtoInputRef = useRef<HTMLInputElement | null>(null);
  const produtosBodyRef = useRef<HTMLDivElement | null>(null);
  const [produtoDropdownRect, setProdutoDropdownRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const [isVincOpen, setIsVincOpen] = useState(false);
  const [vincNomeOriginal, setVincNomeOriginal] = useState("");
  const [vincNomeNota, setVincNomeNota] = useState("");
  const [vincUnidadeNota, setVincUnidadeNota] = useState("Und");
  const [vincInsumoEq, setVincInsumoEq] = useState("");
  const [vincEqQtd, setVincEqQtd] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draftFornecedor, setDraftFornecedor] = useState("");
  const [draftVendedorNome, setDraftVendedorNome] = useState("");
  const [draftWhatsapp, setDraftWhatsapp] = useState("");
  const [draftEndereco, setDraftEndereco] = useState("");

  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteName, setDeleteName] = useState("");

  const [isImportOpen, setIsImportOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const markDirty = (ms = 6000) => {
    try {
      window.sessionStorage.setItem("cmvfacil:fornecedores:v1:dirtyUntilMs", String(Date.now() + ms));
    } catch {}
  };
  const getTombstones = (map: FornecedorProdutos) => {
    const k = TOMBSTONE_KEY;
    const raw = (map as any)?.[k];
    const list = Array.isArray(raw) ? raw : [];
    return list.map((x) => String(x ?? "").trim()).filter(Boolean);
  };
  const withTombstones = (map: FornecedorProdutos, tombstones: string[]) => {
    const next: FornecedorProdutos = { ...map };
    if (tombstones.length) next[TOMBSTONE_KEY] = Array.from(new Set(tombstones.map((x) => String(x ?? "").trim()).filter(Boolean)));
    else delete (next as any)[TOMBSTONE_KEY];
    return next;
  };

  function showToast(message: string, type: "success" | "error", durationMs = 4500) {
    setToast({ title: type === "success" ? "Sucesso" : "Erro", message, tone: type });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, durationMs);
  }

  useEffect(() => {
    setIsMounted(true);
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  function toggleSort(key: ColumnKey) {
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

  function onColumnDrop(target: ColumnKey) {
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

  const gridTemplateColumns = useMemo(() => {
    const widths: Record<ColumnKey | "acoes", string> = {
      fornecedor: "2fr",
      itens: "0.7fr",
      whatsapp: "1fr",
      endereco: "1.5fr",
      acoes: "120px",
    };
    return [...columnOrder, "acoes"].map((k) => widths[k as keyof typeof widths]).join(" ");
  }, [columnOrder]);

  useEffect(() => {
    (async () => {
      let nextInfo: FornecedorInfoMap = {};
      let nextProdutos: FornecedorProdutos = {};
      let nextEq: FornecedorEquivalenciasMap = {};
      try {
        const db = await loadFornecedoresStateFromSupabase();
        if ((db as any)?.meta) setSourceMeta((db as any).meta);
        const hasDb = Object.keys(db.info).length || Object.keys(db.produtos).length || Object.keys(db.equivalencias).length;
        if (hasDb) {
          nextInfo = db.info;
          nextProdutos = db.produtos;
          nextEq = db.equivalencias;
        }
      } catch (err) {
        if (!fornecedoresLoadErrorShownRef.current) {
          fornecedoresLoadErrorShownRef.current = true;
          const msg = err instanceof Error ? err.message : String(err ?? "");
          showToast(`Não foi possível carregar fornecedores do Supabase. ${msg || ""}`.trim(), "error", 9000);
        }
      }

      writeFornecedorInfoMap(nextInfo);
      writeFornecedorProdutosMap(nextProdutos);
      writeFornecedorEquivalenciasMap(nextEq);
      setInfoMap(nextInfo);
      setProdutosMap(nextProdutos);
      setEquivalenciasMap(nextEq);
      fornecedoresPersistedSnapshotRef.current = JSON.stringify({ info: nextInfo, produtos: nextProdutos, equivalencias: nextEq });
      fornecedoresReadyRef.current = true;
      setIsLoadingTable(false);
    })();

    const u1 = subscribeFornecedorInfo((m) => setInfoMap(m));
    const u2 = subscribeFornecedorProdutos((m) => setProdutosMap(m));
    const u3 = subscribeFornecedorEquivalencias((m) => setEquivalenciasMap(m));
    return () => {
      u1();
      u2();
      u3();
    };
  }, []);

  useEffect(() => {
    if (!fornecedoresReadyRef.current) return;
    if (isReadOnly) return;
    const snapshot = JSON.stringify({ info: infoMap, produtos: produtosMap, equivalencias: equivalenciasMap });
    if (snapshot === fornecedoresPersistedSnapshotRef.current) return;
    if (fornecedoresSyncTimeoutRef.current) window.clearTimeout(fornecedoresSyncTimeoutRef.current);
    fornecedoresSyncTimeoutRef.current = window.setTimeout(() => {
      void saveFornecedoresStateToSupabase({ info: infoMap, produtos: produtosMap, equivalencias: equivalenciasMap }).then(() => {
        fornecedoresPersistedSnapshotRef.current = snapshot;
        fornecedoresSaveErrorShownRef.current = false;
      }).catch((err) => {
        if (fornecedoresSaveErrorShownRef.current) return;
        fornecedoresSaveErrorShownRef.current = true;
        const msg = err instanceof Error ? err.message : String(err ?? "");
        showToast(`Não foi possível salvar fornecedores no Supabase. ${msg || ""}`.trim(), "error", 9000);
      });
    }, 450);
  }, [equivalenciasMap, infoMap, isReadOnly, produtosMap]);

  useEffect(() => {
    const nextList: FornecedorRow[] = [];
    for (const [key, info] of Object.entries(infoMap)) {
      const fornecedorLabel = info.fornecedor || key;
      const itens = getProdutosForKey(produtosMap, key).length || 0;
      nextList.push({
        id: key,
        fornecedor: fornecedorLabel,
        itens,
        vendedorNome: info.vendedor || "-",
        whatsapp: info.whatsapp || "-",
        endereco: info.endereco || "-",
      });
    }
    setRows(nextList);
  }, [infoMap, produtosMap]);

  useEffect(() => {
    setInsumosStore(readInsumosFromStore());
    void (async () => {
      try {
        const dbRows = await loadInsumosFromSupabase();
        if (dbRows.length) writeInsumosToStore(dbRows);
      } catch {}
    })();
    return subscribeInsumos((rows) => setInsumosStore(rows));
  }, []);

  useEffect(() => {
    if (!fornecedoresReadyRef.current) return;
    if (!insumosStore.length) return;
    const nameById = new Map<string, string>();
    for (const i of insumosStore) {
      const id = String(i.id ?? "").trim();
      const name = String(i.item ?? "").trim();
      if (id && name && !nameById.has(id)) nameById.set(id, name);
    }
    let changed = false;
    const next: FornecedorProdutos = {};
    for (const [k, listRaw] of Object.entries(produtosMap)) {
      const key = normalizeFornecedorKey(k);
      const list = Array.isArray(listRaw) ? listRaw : [];
      const out: string[] = [];
      for (const raw of list) {
        const v = String(raw ?? "").trim();
        if (!v) {
          changed = true;
          continue;
        }
        const mapped = looksLikeItemId(v) ? nameById.get(v) : null;
        const label = mapped || v;
        if (mapped) changed = true;
        if (!out.some((x) => x.toLowerCase() === label.toLowerCase())) out.push(label);
      }
      if (!key) continue;
      if (key !== String(k ?? "").trim()) changed = true;
      if (out.length) next[key] = out;
      if (!out.length && list.length) changed = true;
    }
    if (!changed) return;
    writeFornecedorProdutosMap(next);
    setProdutosMap(next);
  }, [insumosStore, produtosMap]);

  useEffect(() => {
    if (!isProdutoMenuOpen) return;
    function onDown(e: MouseEvent) {
      const el = produtoMenuRef.current;
      const dl = produtoDropdownRef.current;
      if (!el && !dl) return;
      if (e.target instanceof Node && ((el && el.contains(e.target)) || (dl && dl.contains(e.target)))) return;
      setIsProdutoMenuOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [isProdutoMenuOpen]);

  const syncProdutoDropdownRect = () => {
    const el = produtoInputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setProdutoDropdownRect({ left: r.left, top: r.bottom + 6, width: r.width });
  };

  useEffect(() => {
    if (!isProdutoMenuOpen) {
      setProdutoDropdownRect(null);
      return;
    }
    syncProdutoDropdownRect();
    function onMove() {
      syncProdutoDropdownRect();
    }
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    const body = produtosBodyRef.current;
    body?.addEventListener("scroll", onMove);
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
      body?.removeEventListener("scroll", onMove);
    };
  }, [isProdutoMenuOpen, isProdutosOpen]);

  const produtosFornecedor = useMemo(() => {
    const key = (prodFornecedorKey ?? "").trim();
    if (!key) return [];
    return getProdutosForKey(produtosMap, key);
  }, [prodFornecedorKey, produtosMap]);

  const insumosByName = useMemo(() => {
    const map = new Map<string, InsumoStoreItem>();
    for (const i of insumosStore) map.set(i.item.toLowerCase(), i);
    return map;
  }, [insumosStore]);

  const suggestions = useMemo(() => {
    const list = insumosStore.map((i) => i.item);
    const q = produtoQuery.trim().toLowerCase();
    const filtered = q ? list.filter((n) => n.toLowerCase().includes(q)) : list;
    return filtered.slice(0, 8);
  }, [insumosStore, produtoQuery]);

  function openVinculacao(name: string) {
    if (isReadOnly) {
      showToast("Modo somente leitura.", "error");
      return;
    }
    const keyRaw = (prodFornecedorKey ?? "").trim();
    const list = getEquivalenciasForKey(equivalenciasMap, keyRaw);
    const existing = list.find((m) => m.nomeNaNota.toLowerCase() === name.toLowerCase()) ?? null;
    const defaultEq = name && insumosByName.get(name.toLowerCase()) ? name : insumosStore[0]?.item ?? "";
    setVincNomeOriginal(name);
    setVincNomeNota(name);
    setVincUnidadeNota(existing?.unidadeNaNota || "Und");
    setVincInsumoEq(existing?.insumoEquivalente || defaultEq);
    setVincEqQtd(existing?.equivalenteQuantidade || "");
    setIsVincOpen(true);
  }

  async function saveVinculacao() {
    if (isReadOnly) {
      showToast("Modo somente leitura.", "error");
      return;
    }
    const fornecedorKeyRaw = (prodFornecedorKey ?? "").trim();
    const fornecedorKey = normalizeFornecedorKey(fornecedorKeyRaw);
    if (!fornecedorKey) return;
    const nomeNaNota = vincNomeNota.trim();
    const unidadeNaNota = vincUnidadeNota.trim() || "Und";
    const insumoEquivalente = vincInsumoEq.trim();
    if (!nomeNaNota || !insumoEquivalente) return;
    const equivalenteUnidade = insumosByName.get(insumoEquivalente.toLowerCase())?.medida ?? "Und";
    const originalName = vincNomeOriginal.trim();
    const existingList = getEquivalenciasForKey(equivalenciasMap, fornecedorKeyRaw);
    const existing = existingList.find((m) => m.nomeNaNota.toLowerCase() === (originalName || nomeNaNota).toLowerCase()) ?? null;
    const nextItem = {
      id: existing?.id ?? String(Date.now()),
      nomeNaNota,
      unidadeNaNota,
      insumoEquivalente,
      equivalenteQuantidade: vincEqQtd.trim() || "1",
      equivalenteUnidade,
    };
    const oldName = originalName;

    const curProdutos = getProdutosForKey(produtosMap, fornecedorKeyRaw);
    const hasNomeNaNota = curProdutos.some((x) => x.toLowerCase() === nomeNaNota.toLowerCase());
    let nextProdutos = produtosMap;

    if (!oldName && !hasNomeNaNota) {
      const nextList = [...curProdutos, nomeNaNota];
      nextProdutos = setProdutosForKey(produtosMap, fornecedorKeyRaw, nextList);
    } else if (oldName && oldName.toLowerCase() !== nomeNaNota.toLowerCase()) {
      const replaced = curProdutos.map((x) => (x.toLowerCase() === oldName.toLowerCase() ? nomeNaNota : x));
      const dedup: string[] = [];
      for (const n of replaced) {
        if (!dedup.some((d) => d.toLowerCase() === n.toLowerCase())) dedup.push(n);
      }
      nextProdutos = setProdutosForKey(produtosMap, fornecedorKeyRaw, dedup);
    }

    const curEq = existingList;
    const filtered = curEq.filter(
      (x) => x.nomeNaNota.toLowerCase() !== nomeNaNota.toLowerCase() && x.nomeNaNota.toLowerCase() !== oldName.toLowerCase(),
    );
    const nextEq = setEquivalenciasForKey(equivalenciasMap, fornecedorKeyRaw, [...filtered, nextItem] as any[]);

    const mutexKey = `upsert:${fornecedorKey.toLowerCase()}:${nomeNaNota.toLowerCase()}`;
    const mutex = fornecedoresIncrementalMutexRef.current;
    if (mutex.has(mutexKey)) return;

    const prevProdutos = produtosMap;
    const prevEq = equivalenciasMap;
    const prevSnapshot = fornecedoresPersistedSnapshotRef.current;
    const nextSnapshot = JSON.stringify({ info: infoMap, produtos: nextProdutos, equivalencias: nextEq });

    writeFornecedorProdutosMap(nextProdutos);
    setProdutosMap(nextProdutos);
    writeFornecedorEquivalenciasMap(nextEq);
    setEquivalenciasMap(nextEq);
    if (fornecedoresSyncTimeoutRef.current) {
      window.clearTimeout(fornecedoresSyncTimeoutRef.current);
      fornecedoresSyncTimeoutRef.current = null;
    }
    fornecedoresPersistedSnapshotRef.current = nextSnapshot;
    setVincNomeOriginal(nomeNaNota);
    setIsVincOpen(false);
    const nonce = ++fornecedoresIncrementalNonceRef.current;

    let task: Promise<void> | undefined;
    task = (async () => {
      try {
        const res = await fetch("/api/fornecedores", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "upsert_product",
            supplier_key: fornecedorKey,
            product: {
              oldName,
              name: nomeNaNota,
              unit: unidadeNaNota,
              equivalentItemName: insumoEquivalente,
              factor: vincEqQtd.trim() || "1",
              equivalentUnit: equivalenteUnidade,
            },
          }),
        });
        if (nonce !== fornecedoresIncrementalNonceRef.current) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = (await res.json().catch(() => ({ ok: true }))) as any;
        if (!payload?.ok) throw new Error("rejected");
        fornecedoresPersistedSnapshotRef.current = JSON.stringify({ info: infoMap, produtos: nextProdutos, equivalencias: nextEq });
        showToast("Produto atualizado com sucesso.", "success");
      } catch (err) {
        if (nonce !== fornecedoresIncrementalNonceRef.current) return;
        writeFornecedorProdutosMap(prevProdutos);
        setProdutosMap(prevProdutos);
        writeFornecedorEquivalenciasMap(prevEq);
        setEquivalenciasMap(prevEq);
        fornecedoresPersistedSnapshotRef.current = prevSnapshot;
        setVincNomeOriginal(originalName);
        setIsVincOpen(true);
        const msg = err instanceof Error ? err.message : String(err ?? "");
        showToast(`Não foi possível editar o produto. Tente novamente. ${msg}`.trim(), "error", 9000);
      } finally {
        if (task !== undefined && mutex.get(mutexKey) === task) mutex.delete(mutexKey);
      }
    })();
    mutex.set(mutexKey, task);
  }

  function openProdutos(row: FornecedorRow) {
    const key = String(row.id ?? "").trim();
    if (!key) return;
    setProdFornecedorKey(normalizeFornecedorKey(key));
    setProdFornecedorLabel(row.fornecedor);
    setProdVendedor(row.vendedorNome || "-");
    setProdEndereco(row.endereco || "-");
    setProdutoDraft("");
    setProdutoQuery("");
    setIsProdutoMenuOpen(false);
    setProdutoDropdownRect(null);
    setIsProdutosOpen(true);
  }

  function addProduto() {
    if (isReadOnly) {
      showToast("Modo somente leitura.", "error");
      return;
    }
    const keyRaw = (prodFornecedorKey ?? "").trim();
    const key = normalizeFornecedorKey(keyRaw);
    const item = (produtoDraft || produtoQuery).trim();
    if (!key) return;
    if (!item) {
      setProdutoDraft("");
      setProdutoQuery("");
      setIsProdutoMenuOpen(false);
      setProdutoDropdownRect(null);
      openVinculacao("");
      return;
    }
    const curList = getProdutosForKey(produtosMap, keyRaw);
    const has = curList.some((x) => x.toLowerCase() === item.toLowerCase());
    if (has) {
      openVinculacao(curList.find((x) => x.toLowerCase() === item.toLowerCase()) ?? item);
      return;
    }

    const mutexKey = `add:${key.toLowerCase()}:${item.toLowerCase()}`;
    const mutex = fornecedoresIncrementalMutexRef.current;
    if (mutex.has(mutexKey)) return;

    const nextProdutos: FornecedorProdutos = setProdutosForKey(produtosMap, keyRaw, [...curList, item]);
    const prevProdutos = produtosMap;
    const prevSnapshot = fornecedoresPersistedSnapshotRef.current;
    const nextSnapshot = JSON.stringify({ info: infoMap, produtos: nextProdutos, equivalencias: equivalenciasMap });

    writeFornecedorProdutosMap(nextProdutos);
    setProdutosMap(nextProdutos);
    if (fornecedoresSyncTimeoutRef.current) {
      window.clearTimeout(fornecedoresSyncTimeoutRef.current);
      fornecedoresSyncTimeoutRef.current = null;
    }
    fornecedoresPersistedSnapshotRef.current = nextSnapshot;
    setProdutoDraft("");
    setProdutoQuery("");
    setIsProdutoMenuOpen(false);
    setProdutoDropdownRect(null);
    const nonce = ++fornecedoresIncrementalNonceRef.current;

    let task: Promise<void> | undefined;
    task = (async () => {
      try {
        const res = await fetch("/api/fornecedores", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "upsert_product",
            supplier_key: key,
            product: {
              name: item,
            },
          }),
        });
        if (nonce !== fornecedoresIncrementalNonceRef.current) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = (await res.json().catch(() => ({ ok: true }))) as any;
        if (!payload?.ok) throw new Error("rejected");
        fornecedoresPersistedSnapshotRef.current = JSON.stringify({ info: infoMap, produtos: nextProdutos, equivalencias: equivalenciasMap });
        openVinculacao(item);
      } catch (err) {
        if (nonce !== fornecedoresIncrementalNonceRef.current) return;
        writeFornecedorProdutosMap(prevProdutos);
        setProdutosMap(prevProdutos);
        fornecedoresPersistedSnapshotRef.current = prevSnapshot;
        const msg = err instanceof Error ? err.message : String(err ?? "");
        showToast(`Erro ao adicionar produto. Tente novamente. ${msg}`.trim(), "error", 9000);
      } finally {
        if (task !== undefined && mutex.get(mutexKey) === task) mutex.delete(mutexKey);
      }
    })();
    mutex.set(mutexKey, task);
  }

  async function removeProduto(item: string) {
    if (isReadOnly) {
      showToast("Modo somente leitura.", "error");
      return;
    }
    const keyRaw = (prodFornecedorKey ?? "").trim();
    const key = normalizeFornecedorKey(keyRaw);
    if (!key) return;

    const mutexKey = `del:${key.toLowerCase()}:${item.toLowerCase()}`;
    const mutex = fornecedoresIncrementalMutexRef.current;
    if (mutex.has(mutexKey)) return;

    const cur = getProdutosForKey(produtosMap, keyRaw);
    const nextList = cur.filter((x) => x.toLowerCase() !== item.toLowerCase());
    const nextProdutos: FornecedorProdutos = setProdutosForKey(produtosMap, keyRaw, nextList);
    const nextEq = setEquivalenciasForKey(
      equivalenciasMap,
      keyRaw,
      getEquivalenciasForKey(equivalenciasMap, keyRaw).filter((x) => x.nomeNaNota.toLowerCase() !== item.toLowerCase()),
    );
    const prevProdutos = produtosMap;
    const prevEq = equivalenciasMap;
    const prevSnapshot = fornecedoresPersistedSnapshotRef.current;
    const nextSnapshot = JSON.stringify({ info: infoMap, produtos: nextProdutos, equivalencias: nextEq });

    writeFornecedorProdutosMap(nextProdutos);
    setProdutosMap(nextProdutos);
    writeFornecedorEquivalenciasMap(nextEq);
    setEquivalenciasMap(nextEq);
    if (fornecedoresSyncTimeoutRef.current) {
      window.clearTimeout(fornecedoresSyncTimeoutRef.current);
      fornecedoresSyncTimeoutRef.current = null;
    }
    fornecedoresPersistedSnapshotRef.current = nextSnapshot;
    const nonce = ++fornecedoresIncrementalNonceRef.current;

    let task: Promise<void> | undefined;
    task = (async () => {
      try {
        const res = await fetch("/api/fornecedores", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "delete_product",
            supplier_key: key,
            product_name: item,
          }),
        });
        if (nonce !== fornecedoresIncrementalNonceRef.current) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = (await res.json().catch(() => ({ ok: true }))) as any;
        if (!payload?.ok) throw new Error("rejected");
        fornecedoresPersistedSnapshotRef.current = JSON.stringify({ info: infoMap, produtos: nextProdutos, equivalencias: nextEq });
        showToast("Produto excluído com sucesso.", "success");
      } catch (err) {
        if (nonce !== fornecedoresIncrementalNonceRef.current) return;
        writeFornecedorProdutosMap(prevProdutos);
        setProdutosMap(prevProdutos);
        writeFornecedorEquivalenciasMap(prevEq);
        setEquivalenciasMap(prevEq);
        fornecedoresPersistedSnapshotRef.current = prevSnapshot;
        const msg = err instanceof Error ? err.message : String(err ?? "");
        showToast(`Não foi possível excluir o produto. Tente novamente. ${msg}`.trim(), "error", 9000);
      } finally {
        if (task !== undefined && mutex.get(mutexKey) === task) mutex.delete(mutexKey);
      }
    })();
    mutex.set(mutexKey, task);
  }

  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? rows.filter((r) => `${r.fornecedor} ${r.vendedorNome} ${r.whatsapp} ${r.endereco}`.toLowerCase().includes(q))
      : rows;
    if (!sortKey) return filtered;

    const decorated = filtered.map((r, i) => ({ r, i }));
    const dir = sortDir === "asc" ? 1 : -1;
    const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

    decorated.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "itens") {
        cmp = a.r.itens === b.r.itens ? 0 : a.r.itens < b.r.itens ? -1 : 1;
      } else {
        cmp = collator.compare(String(a.r[sortKey] ?? ""), String(b.r[sortKey] ?? ""));
      }
      if (!cmp) cmp = a.i - b.i;
      return cmp * dir;
    });

    return decorated.map((d) => d.r);
  }, [query, rows, sortDir, sortKey]);

  const pagination = usePagination({
    items: visibleRows,
    pageSize: 20,
    resetKey: `${query}|${sortKey}|${sortDir}|${rows.length}`,
  });

  const tableLoading = useCappedLoading(isLoadingTable);

  const qaUi = useMemo(() => {
    return {
      filters: { query },
      sort: { sortKey, sortDir, columnOrder },
      rendered: {
        rowsCount: pagination.pageItems.length,
        rows: pagination.pageItems.map((r) => ({
          id: r.id,
          fornecedor: r.fornecedor,
          itens: r.itens,
          vendedorNome: r.vendedorNome,
          whatsapp: r.whatsapp,
          endereco: r.endereco,
        })),
      },
    };
  }, [columnOrder, pagination.pageItems, query, sortDir, sortKey]);

  function openNew() {
    if (isReadOnly) {
      showToast("Modo somente leitura.", "error");
      return;
    }
    setEditingId(null);
    setEditingKey(null);
    setDraftFornecedor("");
    setDraftVendedorNome("");
    setDraftWhatsapp("");
    setDraftEndereco("");
    setIsFormOpen(true);
  }

  function openEdit(row: FornecedorRow) {
    if (isReadOnly) {
      showToast("Modo somente leitura.", "error");
      return;
    }
    setEditingId(row.id);
    setEditingKey(String(row.id ?? "").trim());
    setDraftFornecedor(row.fornecedor);
    setDraftVendedorNome(row.vendedorNome === "-" ? "" : row.vendedorNome);
    setDraftWhatsapp(row.whatsapp === "-" ? "" : row.whatsapp);
    setDraftEndereco(row.endereco);
    setIsFormOpen(true);
  }

  function saveForm() {
    if (isReadOnly) {
      showToast("Modo somente leitura.", "error");
      return;
    }
    const fornecedor = draftFornecedor.trim();
    if (!fornecedor) return;
    const vendedorNome = draftVendedorNome.trim() || "-";
    const whatsapp = draftWhatsapp.trim() || "-";
    const endereco = draftEndereco.trim() || "-";
    const key = fornecedor.toUpperCase();
    const infoPayload = {
      fornecedor,
      vendedor: vendedorNome === "-" ? "" : vendedorNome,
      whatsapp: whatsapp === "-" ? "" : whatsapp,
      endereco: endereco === "-" ? "" : endereco,
    };
    markDirty();
    const curTombstones = new Set(getTombstones(produtosMap).map((x) => x.toUpperCase()));
    curTombstones.delete(key.toUpperCase());
    const nextProdutosBase = withTombstones(produtosMap, Array.from(curTombstones));

    if (!editingId) {
      const nextInfo = { ...infoMap, [key]: infoPayload };
      setInfoMap(nextInfo);
      writeFornecedorInfoMap(nextInfo);
      const nextProdutos = nextProdutosBase;
      setProdutosMap(nextProdutos);
      writeFornecedorProdutosMap(nextProdutos);
      setQuery("");
      setSortKey(null);
      setSortDir("asc");
      setIsFormOpen(false);
      return;
    }

    const prevKey = (editingKey ?? "").trim();
    if (prevKey && prevKey !== key) {
      const nextInfo = { ...infoMap };
      delete nextInfo[prevKey];
      nextInfo[key] = infoPayload;
      setInfoMap(nextInfo);
      writeFornecedorInfoMap(nextInfo);

      const prevProdutos = nextProdutosBase[prevKey] ?? [];
      const curProdutos = nextProdutosBase[key] ?? [];
      const mergedProdutos: string[] = [];
      for (const item of [...curProdutos, ...prevProdutos]) {
        if (!mergedProdutos.some((x) => x.toLowerCase() === item.toLowerCase())) mergedProdutos.push(item);
      }
      const nextProdutos = { ...nextProdutosBase };
      delete nextProdutos[prevKey];
      nextProdutos[key] = mergedProdutos;
      setProdutosMap(nextProdutos);
      writeFornecedorProdutosMap(nextProdutos);

      const prevEq = equivalenciasMap[prevKey] ?? [];
      const curEq = equivalenciasMap[key] ?? [];
      const mergedEqMap = new Map<string, (typeof curEq)[number]>();
      for (const row of [...curEq, ...prevEq]) {
        mergedEqMap.set(row.id, row);
      }
      const nextEq = { ...equivalenciasMap };
      delete nextEq[prevKey];
      nextEq[key] = Array.from(mergedEqMap.values());
      setEquivalenciasMap(nextEq);
      writeFornecedorEquivalenciasMap(nextEq);

      if (prodFornecedorKey === prevKey) {
        setProdFornecedorKey(key);
        setProdFornecedorLabel(fornecedor);
      }
    } else {
      const nextInfo = { ...infoMap, [key]: infoPayload };
      setInfoMap(nextInfo);
      writeFornecedorInfoMap(nextInfo);
      const nextProdutos = nextProdutosBase;
      setProdutosMap(nextProdutos);
      writeFornecedorProdutosMap(nextProdutos);
    }

    setQuery("");
    setIsFormOpen(false);
    setEditingId(null);
    setEditingKey(null);
  }

  function openDelete(row: FornecedorRow) {
    if (isReadOnly) {
      showToast("Modo somente leitura.", "error");
      return;
    }
    setDeleteId(row.id);
    setDeleteName(row.fornecedor);
    setIsDeleteOpen(true);
  }

  function confirmDelete() {
    if (isReadOnly) {
      showToast("Modo somente leitura.", "error");
      return;
    }
    const id = deleteId;
    if (!id) return;
    const key = String(id).trim();
    if (!key) return;
    markDirty();
    const tombstones = new Set(getTombstones(produtosMap).map((x) => x.toUpperCase()));
    tombstones.add(key.toUpperCase());
    const nextInfo = { ...infoMap };
    delete nextInfo[key];
    const nextProdutosBase = { ...produtosMap };
    delete (nextProdutosBase as any)[key];
    const nextProdutos = withTombstones(nextProdutosBase, Array.from(tombstones));
    const nextEq = { ...equivalenciasMap };
    delete (nextEq as any)[key];

    writeFornecedorInfoMap(nextInfo);
    writeFornecedorProdutosMap(nextProdutos);
    writeFornecedorEquivalenciasMap(nextEq);
    setInfoMap(nextInfo);
    setProdutosMap(nextProdutos);
    setEquivalenciasMap(nextEq);

    if (prodFornecedorKey === key) {
      setIsProdutosOpen(false);
      setProdFornecedorKey(null);
      setProdFornecedorLabel("");
      setProdVendedor("");
      setProdEndereco("");
    }
    setIsDeleteOpen(false);
    setDeleteId(null);
    setDeleteName("");
    showToast("Fornecedor excluído.", "success");
    if (fornecedoresSyncTimeoutRef.current) window.clearTimeout(fornecedoresSyncTimeoutRef.current);
    fornecedoresSyncTimeoutRef.current = null;
    void saveFornecedoresStateToSupabase({ info: nextInfo, produtos: nextProdutos, equivalencias: nextEq }).catch(() => showToast("Erro ao salvar no banco de dados.", "error"));
  }

  const resultsText = `${pagination.totalItems} resultado(s) encontrado(s)`;

  async function importFile(file: File) {
    if (importing) return;
    setImportError(null);
    setImporting(true);
    try {
      const name = file.name.toLowerCase();
      let table: unknown[][] = [];

      if (name.endsWith(".csv")) {
        const text = await file.text();
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
        const first = lines[0] ?? "";
        const delimiter: "," | ";" = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ";" : ",";
        table = lines.map((l) => parseCsvLine(l, delimiter));
      } else if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
        const XLSX = await import("xlsx");
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const sheetName = wb.SheetNames[0] ?? "";
        const ws = sheetName ? wb.Sheets[sheetName] : null;
        if (!ws) throw new Error("Planilha inválida.");
        table = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as unknown[][];
      } else {
        throw new Error("Formato não suportado. Use .xlsx, .xls ou .csv");
      }

      const imported = parseSupplierRowsFromTable(table);
      if (!imported.length) throw new Error("Nenhum fornecedor encontrado na planilha.");
      const nextInfo: FornecedorInfoMap = {};
      for (const r of imported) {
        const fornecedor = String(r.fornecedor ?? "").trim();
        if (!fornecedor) continue;
        const key = fornecedor.toUpperCase();
        const vendedor = String(r.vendedorNome ?? "").trim();
        const whatsapp = String(r.whatsapp ?? "").trim();
        const endereco = String(r.endereco ?? "").trim();
        nextInfo[key] = {
          fornecedor,
          vendedor: vendedor && vendedor !== "-" ? vendedor : "",
          whatsapp: whatsapp && whatsapp !== "-" ? whatsapp : "",
          endereco: endereco && endereco !== "-" ? endereco : "",
        };
      }
      const keepKeys = new Set(Object.keys(nextInfo));
      const tombstones = new Set(getTombstones(produtosMap).map((x) => x.toUpperCase()));
      for (const k of keepKeys) tombstones.delete(String(k ?? "").trim().toUpperCase());
      const nextProdutos: FornecedorProdutos = withTombstones({}, Array.from(tombstones));
      for (const [k, list] of Object.entries(produtosMap)) {
        if (!keepKeys.has(k)) continue;
        nextProdutos[k] = list;
      }
      const nextEq: FornecedorEquivalenciasMap = {};
      for (const [k, list] of Object.entries(equivalenciasMap)) {
        if (!keepKeys.has(k)) continue;
        nextEq[k] = list;
      }

      writeFornecedorInfoMap(nextInfo);
      writeFornecedorProdutosMap(nextProdutos);
      writeFornecedorEquivalenciasMap(nextEq);
      setInfoMap(nextInfo);
      setProdutosMap(nextProdutos);
      setEquivalenciasMap(nextEq);
      setIsImportOpen(false);
      showToast("Fornecedores importados e salvos.", "success");
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
      setDragOver(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <>
      <main className={dash.content}>
        <div className={dash.pageFrame}>
        <QaModePanel screen="fornecedores" ui={qaUi} />
        <section className={styles.header}>
          <div className={styles.headerIcon}>
            <IconBox />
          </div>
          <div className={styles.headerText}>
            <h1 className={styles.title}>Fornecedores</h1>
            <p className={styles.subtitle}>Consulte e cadastre fornecedores, além dos produtos que cada um vende.</p>
          </div>
        </section>

        <section className={styles.toolbar}>
          <div className={styles.search}>
            <span className={styles.searchIcon}>
              <IconSearch />
            </span>
            <input
              className={styles.searchInput}
              placeholder="Pesquise por fornecedor..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.importBtn}
              disabled={isReadOnly}
              onClick={() => {
                if (isReadOnly) {
                  showToast("Modo somente leitura.", "error");
                  return;
                }
                setImportError(null);
                setIsImportOpen(true);
              }}
            >
              <IconUpload />
              Importar
            </button>
            <button type="button" className={styles.newBtn} onClick={openNew} disabled={isReadOnly}>
              <IconPlus />
              Novo Fornecedor
            </button>
          </div>
        </section>

        <div className={styles.tableWrap}>
          <section className={styles.table} style={{ position: "relative" }} data-qa-grid="fornecedores">
            {tableLoading.show ? (
              <div className={dash.loadingOverlay}>
                <LoadingSpinner />
              </div>
            ) : null}
            <div className={styles.tableHead} style={{ gridTemplateColumns }}>
              {columnOrder.map((col) => {
                const label = col === "fornecedor" ? "Fornecedor" : col === "itens" ? "Itens" : col === "whatsapp" ? "Vendedor" : "Endereço";
                return (
                  <div
                    key={col}
                    className={`${styles.th} ${styles.thDraggable}`}
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
                    <button type="button" className={styles.thBtn} onClick={() => toggleSort(col)}>
                      {label} {sortKey === col ? <SortIcon dir={sortDir} /> : null}
                    </button>
                  </div>
                );
              })}
              <div className={styles.thActions}>Ações</div>
            </div>

            {!tableLoading.show && !pagination.pageItems.length ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyTitle}>Nenhum fornecedor cadastrado</div>
                <div className={styles.emptyText}>Clique em “Novo Fornecedor” ou importe uma planilha para começar.</div>
              </div>
            ) : (
              pagination.pageItems.map((r) => (
                <div key={r.id} className={styles.tr} style={{ gridTemplateColumns }} data-qa-grid-row data-qa-row-id={r.id}>
                  {columnOrder.map((col) => {
                    if (col === "fornecedor") {
                      return (
                        <button key={col} type="button" className={styles.supplierCellBtn} onClick={() => openProdutos(r)} data-qa-grid-cell>
                          <span className={styles.supplierIcon} aria-hidden>
                            <IconBox />
                          </span>
                          <span className={styles.supplierName}>{r.fornecedor}</span>
                        </button>
                      );
                    }
                    if (col === "itens")
                      return (
                        <div key={col} className={styles.td} data-qa-grid-cell>
                          {`${r.itens} item${r.itens === 1 ? "" : "s"}`}
                        </div>
                      );
                    if (col === "whatsapp")
                      return (
                        <div key={col} className={styles.td} data-qa-grid-cell>
                          {r.whatsapp && r.whatsapp !== "-" ? <span className={styles.vendorLink}>{r.whatsapp}</span> : <span className={styles.tdMuted}>-</span>}
                          {r.vendedorNome && r.vendedorNome !== "-" ? <div className={styles.vendorMuted}>{r.vendedorNome}</div> : null}
                        </div>
                      );
                    return (
                      <div key={col} className={styles.tdMuted} data-qa-grid-cell>
                        {r.endereco || "-"}
                      </div>
                    );
                  })}

                  <div className={styles.tdActions}>
                    <button
                      type="button"
                      className={styles.iconBtn}
                      aria-label="Editar"
                      disabled={isReadOnly}
                      onClick={(e) => {
                        if (isReadOnly) {
                          showToast("Modo somente leitura.", "error");
                          return;
                        }
                        e.stopPropagation();
                        openEdit(r);
                      }}
                    >
                      <IconEdit />
                    </button>
                    <button
                      type="button"
                      className={styles.iconBtn}
                      aria-label="Excluir"
                      disabled={isReadOnly}
                      onClick={(e) => {
                        if (isReadOnly) {
                          showToast("Modo somente leitura.", "error");
                          return;
                        }
                        e.stopPropagation();
                        openDelete(r);
                      }}
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
          <div>{resultsText}</div>
          <div className={styles.pagination}>
            <button
              type="button"
              className={styles.pageBtn}
              disabled={pagination.page <= 1}
              aria-label="Primeira página"
              onClick={() => pagination.setPage(1)}
            >
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

        {isMounted && isFormOpen
          ? createPortal(
              <div className={styles.modalOverlay} role="presentation" onClick={() => setIsFormOpen(false)}>
                <div className={styles.modal} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitle}>{editingId ? "Editar Fornecedor" : "Cadastro de Fornecedor"}</div>
                <button type="button" className={styles.modalClose} aria-label="Fechar" onClick={() => setIsFormOpen(false)}>
                  ×
                </button>
              </div>

              <div className={styles.formBody}>
                <div className={styles.formField}>
                  <div className={styles.formLabel}>Nome do Fornecedor</div>
                  <input
                    data-tour="supplier-name"
                    className={styles.formInput}
                    placeholder="Ex: Mercado X"
                    value={draftFornecedor}
                    onChange={(e) => setDraftFornecedor(e.target.value)}
                  />
                </div>

                <div className={styles.formRow2}>
                  <div className={styles.formField}>
                    <div className={styles.formLabel}>Vendedor</div>
                    <input
                      className={styles.formInput}
                      placeholder="Ex: João Silva"
                      value={draftVendedorNome}
                      onChange={(e) => setDraftVendedorNome(e.target.value)}
                    />
                  </div>

                  <div className={styles.formField}>
                    <div className={styles.formLabel}>WhatsApp</div>
                    <div className={styles.prefixWrap}>
                      <div className={styles.prefixBox}>+55</div>
                      <div className={styles.prefixInputWrap}>
                        <input
                          className={styles.prefixInput}
                          placeholder="(00) 00000-0000"
                          inputMode="tel"
                          value={draftWhatsapp}
                          onChange={(e) => setDraftWhatsapp(maskPhoneBR(e.target.value))}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className={styles.formField}>
                  <div className={styles.formLabel}>Endereço</div>
                  <input
                    className={styles.formInput}
                    placeholder="Ex: rua x, bairro y"
                    value={draftEndereco}
                    onChange={(e) => setDraftEndereco(e.target.value)}
                  />
                </div>
              </div>

              <div className={styles.modalFooter}>
                <button
                  type="button"
                  data-tour="supplier-save"
                  className={styles.modalPrimaryWide}
                  onClick={saveForm}
                  disabled={!draftFornecedor.trim()}
                >
                  Salvar
                </button>
              </div>
            </div>
              </div>,
              document.body,
            )
          : null}

        {isMounted && isDeleteOpen
          ? createPortal(
              <div className={styles.modalOverlay} role="presentation" onClick={() => setIsDeleteOpen(false)}>
                <div className={styles.modal} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitle}>Excluir Fornecedor?</div>
                <button type="button" className={styles.modalClose} aria-label="Fechar" onClick={() => setIsDeleteOpen(false)}>
                  ×
                </button>
              </div>

              <div className={styles.confirmBody}>
                <div className={styles.confirmIcon}>
                  <IconTrash />
                </div>
                <div className={styles.confirmText}>
                  Caso exclua o fornecedor <strong>“{deleteName}”</strong> não poderá recuperá-lo.
                </div>
              </div>

              <div className={styles.confirmActions}>
                <button type="button" className={styles.confirmDelete} onClick={confirmDelete}>
                  Excluir
                </button>
                <button type="button" className={styles.confirmCancel} onClick={() => setIsDeleteOpen(false)}>
                  Cancelar
                </button>
              </div>
            </div>
              </div>,
              document.body,
            )
          : null}

        {isMounted && isImportOpen
          ? createPortal(
              <div
                className={styles.modalOverlay}
                role="presentation"
                onClick={() => {
                  if (!importing) setIsImportOpen(false);
                }}
              >
                <div className={`${styles.modal} ${styles.importModal}`} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitle}>Importar Fornecedores por Planilha</div>
                <button type="button" className={styles.modalClose} aria-label="Fechar" onClick={() => setIsImportOpen(false)} disabled={importing}>
                  ×
                </button>
              </div>

              <div className={styles.importBody}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className={styles.fileInput}
                  onChange={(e) => {
                    const file = e.currentTarget.files?.[0] ?? null;
                    if (!file) return;
                    void importFile(file);
                  }}
                />

                <div
                  className={dragOver ? `${styles.dropzone} ${styles.dropzoneActive}` : styles.dropzone}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files?.[0] ?? null;
                    if (!file) return;
                    void importFile(file);
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
                  }}
                >
                  <div className={styles.dropzoneInner}>
                    <div className={styles.dropIcon} aria-hidden>
                      <IconUpload />
                    </div>
                    <div className={styles.dropTitle}>
                      {importing ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                          <LoadingSpinner size={16} />
                          Importando...
                        </span>
                      ) : (
                        "Arraste e solte seu arquivo aqui"
                      )}
                    </div>
                    <div className={styles.dropHint}>Formatos aceitos: CSV, XLSX</div>
                    <button type="button" className={styles.dropBtn} onClick={() => fileInputRef.current?.click()} disabled={importing}>
                      {importing ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                          <LoadingSpinner size={16} />
                          Importando...
                        </span>
                      ) : (
                        "Selecionar Arquivo"
                      )}
                    </button>
                  </div>
                </div>

                {importError ? <div className={styles.importError}>{importError}</div> : null}

                <a className={styles.downloadLink} href="/fornecedores/fornecedores-modelo.xlsx" download>
                  Baixar Planilha Modelo
                </a>
              </div>
            </div>
              </div>,
              document.body,
            )
          : null}

        {isMounted && isProdutosOpen && prodFornecedorKey
          ? createPortal(
              <div
                className={styles.modalOverlay}
                role="presentation"
                onClick={() => {
                  setIsProdutosOpen(false);
                  setProdFornecedorKey(null);
                  setProdFornecedorLabel("");
                }}
              >
                <div className={`${styles.modal} ${styles.produtosModal}`} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitle}>{prodFornecedorLabel || prodFornecedorKey}</div>
                <button
                  type="button"
                  className={styles.modalClose}
                  aria-label="Fechar"
                  onClick={() => {
                    setIsProdutosOpen(false);
                    setProdFornecedorKey(null);
                    setProdFornecedorLabel("");
                  }}
                >
                  ×
                </button>
              </div>

              <div className={styles.produtosTop}>
                <div className={styles.produtosTopCard}>
                  <div className={styles.produtosTopIcon} aria-hidden>
                    <IconUser />
                  </div>
                  <div className={styles.produtosTopText}>
                    <div className={styles.produtosTopLabel}>Vendedor</div>
                    <div className={styles.produtosTopValue}>{prodVendedor || "-"}</div>
                  </div>
                </div>

                <div className={styles.produtosTopCard}>
                  <div className={styles.produtosTopIcon} aria-hidden>
                    <IconPin />
                  </div>
                  <div className={styles.produtosTopText}>
                    <div className={styles.produtosTopLabel}>Endereço</div>
                    <div className={styles.produtosTopValue}>{prodEndereco || "-"}</div>
                  </div>
                </div>
              </div>

              <div className={styles.produtosBody} ref={produtosBodyRef}>
                <div className={styles.produtosTitle}>{`Produtos do Fornecedor (${produtosFornecedor.length})`}</div>
                <div className={styles.produtosSub}>
                  Vincule os produtos a este fornecedor para facilitar o registro de compras e a seleção de itens nas notas.
                </div>

                <div className={styles.produtosAddRow}>
                  <div className={styles.produtoPickWrap} ref={produtoMenuRef}>
                    <div className={styles.produtoPick}>
                      <span className={styles.produtoPickIcon} aria-hidden>
                        <IconSearch />
                      </span>
                      <input
                        className={styles.produtoPickInput}
                        placeholder="Pesquise por itens..."
                        value={produtoQuery}
                        onChange={(e) => {
                          setProdutoQuery(e.target.value);
                          setProdutoDraft("");
                          setIsProdutoMenuOpen(true);
                        }}
                        onFocus={() => setIsProdutoMenuOpen(true)}
                        ref={produtoInputRef}
                      />
                      <button
                        type="button"
                        className={styles.produtoPickChevron}
                        aria-label="Abrir lista"
                        onClick={() => {
                          setIsProdutoMenuOpen((v) => !v);
                          setTimeout(() => syncProdutoDropdownRect(), 0);
                        }}
                      >
                        ▾
                      </button>
                    </div>
                  </div>

                  <button type="button" className={styles.produtoAddBtn} onClick={addProduto}>
                    + ADD
                  </button>
                </div>

                {isProdutoMenuOpen && produtoDropdownRect ? (
                  <div
                    className={styles.produtoDropdownFixed}
                    ref={produtoDropdownRef}
                    role="listbox"
                    aria-label="Insumos do sistema"
                    style={{ left: produtoDropdownRect.left, top: produtoDropdownRect.top, width: produtoDropdownRect.width }}
                  >
                    {suggestions.map((name) => (
                      <button
                        key={name}
                        type="button"
                        className={styles.produtoOption}
                        onClick={() => {
                          setProdutoDraft(name);
                          setProdutoQuery(name);
                          setIsProdutoMenuOpen(false);
                          setProdutoDropdownRect(null);
                        }}
                      >
                        {name}
                      </button>
                    ))}
                    {!suggestions[0] ? <div className={styles.produtoEmpty}>Nenhum insumo encontrado</div> : null}
                  </div>
                ) : null}

                <div className={styles.produtosList}>
                  {produtosFornecedor.map((name) => (
                    <div
                      key={name}
                      className={styles.produtosRow}
                      role="button"
                      tabIndex={0}
                      onClick={() => openVinculacao(name)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") openVinculacao(name);
                      }}
                    >
                      <div className={styles.produtosNameWrap}>
                        <div className={styles.produtosName}>{name}</div>
                        {(() => {
                          const eqLabel = (() => {
                            const key = (prodFornecedorKey ?? "").trim();
                            const map = equivalenciasMap[key]?.find((m) => m.nomeNaNota.toLowerCase() === name.toLowerCase()) ?? null;
                            const eq = map?.insumoEquivalente ?? (insumosByName.get(name.toLowerCase()) ? name : "");
                            if (!eq) return "";
                            const qty = String(map?.equivalenteQuantidade ?? "").trim();
                            if (!qty) return eq;
                            const unit = String(map?.equivalenteUnidade ?? insumosByName.get(eq.toLowerCase())?.medida ?? "").trim();
                            return unit ? `${eq} - ${qty} ${unit}` : `${eq} - ${qty}`;
                          })();
                          return eqLabel ? <div className={styles.produtosEq}>{eqLabel}</div> : null;
                        })()}
                      </div>
                      <div className={styles.produtosActions}>
                      <button
                        type="button"
                        className={styles.produtosTrash}
                        aria-label={`Editar ${name}`}
                        disabled={isReadOnly}
                        onClick={(e) => {
                          e.stopPropagation();
                          openVinculacao(name);
                        }}
                      >
                        <IconEdit />
                      </button>
                      <button
                        type="button"
                        className={styles.produtosTrash}
                        aria-label="Remover"
                        disabled={isReadOnly}
                        onClick={(e) => {
                          if (isReadOnly) {
                            showToast("Modo somente leitura.", "error");
                            return;
                          }
                          e.stopPropagation();
                          removeProduto(name);
                        }}
                      >
                        <IconTrash />
                      </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
              </div>,
              document.body,
            )
          : null}

        {isMounted && isProdutosOpen && prodFornecedorKey && isVincOpen
          ? createPortal(
              <div className={styles.modalOverlay} role="presentation" onClick={() => setIsVincOpen(false)}>
                <div className={`${styles.modal} ${styles.vincModal}`} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitle}>Configurar Vinculação</div>
                <button type="button" className={styles.modalClose} aria-label="Fechar" onClick={() => setIsVincOpen(false)}>
                  ×
                </button>
              </div>

              <div className={styles.formBody}>
                <div className={styles.formField}>
                  <div className={styles.formLabel}>Nome na nota</div>
                  <input
                    className={styles.formInput}
                    value={vincNomeNota}
                    onChange={(e) => setVincNomeNota(e.target.value)}
                    autoFocus
                    onFocus={(e) => e.currentTarget.select()}
                  />
                </div>

                <div className={styles.formRow2}>
                  <div className={styles.formField}>
                    <div className={styles.formLabel}>Unidade de Medida na nota</div>
                    <select className={styles.formInput} value={vincUnidadeNota} onChange={(e) => setVincUnidadeNota(e.target.value)}>
                      {["Und", "Kg", "g", "L", "Pacote", "Caixa", "Fardo", "Rolo", "Bisnaga", "Frasco"].map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className={styles.formField}>
                    <div className={styles.formLabel}>Insumo equivalente</div>
                    <select className={styles.formInput} value={vincInsumoEq} onChange={(e) => setVincInsumoEq(e.target.value)}>
                      {(insumosStore[0] ? insumosStore.map((i) => i.item) : ["Bacon Fatiado"]).map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className={styles.mapHint}>
                  <div className={styles.mapHintLine}>
                    {`1${vincUnidadeNota || "Und"} de ${vincNomeNota.trim() || "(nome na nota)"} equivale a `}
                    <input className={styles.mapHintInput} value={vincEqQtd} onChange={(e) => setVincEqQtd(e.target.value)} placeholder="____" />
                    {` ${insumosByName.get(vincInsumoEq.toLowerCase())?.medida ?? "Und"} de ${vincInsumoEq || "(insumo)"}`}
                  </div>
                </div>
              </div>

              <div className={styles.modalFooter}>
                <button type="button" className={styles.modalCancel} onClick={() => setIsVincOpen(false)}>
                  Cancelar
                </button>
                <button type="button" className={styles.modalPrimary} onClick={saveVinculacao} disabled={!vincNomeNota.trim() || !vincInsumoEq.trim()}>
                  Salvar
                </button>
              </div>
            </div>
              </div>,
              document.body,
            )
          : null}

        </div>
        {isMounted && toast
          ? createPortal(
              <SystemToast title={toast.title} message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />,
              document.body,
            )
          : null}
      </main>
    </>
  );
}
