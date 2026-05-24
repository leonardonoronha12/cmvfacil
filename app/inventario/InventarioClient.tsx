"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dash from "../dashboard/dashboard.module.css";
import AppSidebar from "../components/AppSidebar";
import { loadInsumosStateFromSupabase } from "../lib/insumosSupabase";
import { readInsumosFromStore, subscribeInsumos, writeInsumosToStore, type InsumoStoreItem } from "../lib/insumosStore";
import { readInsumoCategoriasFromStore, subscribeInsumoCategorias, writeInsumoCategoriasToStore } from "../lib/insumoCategoriasStore";
import { readInventarioFromStore, writeInventarioToStore, type InventarioCategoria, type InventarioContagem, type InventarioItemRow } from "../lib/inventarioStore";
import { deleteInventarioFromSupabase, loadInventarioFromSupabase, upsertInventarioToSupabase } from "../lib/inventarioSupabase";
import { buildUserScopedId } from "../lib/userScope";
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
  const [insumosStore, setInsumosStore] = useState<InsumoStoreItem[]>([]);
  const [insumoCategorias, setInsumoCategorias] = useState<string[]>(() => readInsumoCategoriasFromStore());
  const [contagens, setContagens] = useState<InventarioContagem[]>(initialContagens);
  const contagensReadyRef = useRef(false);

  const [selectedContagemId, setSelectedContagemId] = useState<string | null>(initialContagens[0]?.id ?? null);
  const [query, setQuery] = useState("");
  const [categoriaFilter, setCategoriaFilter] = useState("Categorias pendentes");

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

  const selectedContagem = useMemo(() => (selectedContagemId ? contagens.find((c) => c.id === selectedContagemId) ?? null : null), [contagens, selectedContagemId]);

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
        map.set(id, name);
      }
    }
    return map;
  }, [selectedContagem?.categorias]);

  const allItems = useMemo(() => {
    const list = selectedContagem?.categorias ?? [];
    const out: InventarioItemRow[] = [];
    const seen = new Set<string>();
    for (const cat of list) {
      for (const it of cat.itens ?? []) {
        if (it.removido) continue;
        const id = String(it.id ?? "");
        if (!id) continue;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(it);
      }
    }
    const q = query.trim().toLowerCase();
    const afterQuery = q ? out.filter((r) => r.item.toLowerCase().includes(q)) : out;
    if (categoriaFilter !== "Categorias pendentes") {
      return afterQuery.filter((r) => (itemCategoryMap.get(String(r.id ?? "")) ?? "Sem categoria") === categoriaFilter);
    }
    return afterQuery;
  }, [categoriaFilter, itemCategoryMap, query, selectedContagem?.categorias]);

  const pendentes = useMemo(() => allItems.filter((r) => !String(r.estoqueFinal ?? "").trim()), [allItems]);
  const contabilizados = useMemo(() => {
    const list = allItems.filter((r) => String(r.estoqueFinal ?? "").trim());
    const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });
    return [...list].sort((a, b) => collator.compare(a.item, b.item));
  }, [allItems]);

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
    pendingDraftsRef.current = pendingDrafts;
  }, [pendingDrafts]);

  useEffect(() => {
    setPendingDrafts({});
    setEditingItemId(null);
    setEditingValue("");
  }, [selectedContagemId]);

  useEffect(() => {
    (async () => {
      try {
        const db = await loadInventarioFromSupabase();
        if (db[0]) {
          const sorted = sortContagensDesc(normalizeContagens(db));
          setContagens(sorted);
          setSelectedContagemId(sorted[0]?.id ?? null);
          contagensReadyRef.current = true;
          return;
        }
      } catch {}
      const stored = readInventarioFromStore(initialContagens);
      const sortedStored = sortContagensDesc(normalizeContagens(stored));
      setContagens(sortedStored);
      setSelectedContagemId(sortedStored[0]?.id ?? null);
      contagensReadyRef.current = true;
    })();
  }, []);

  useEffect(() => {
    if (!contagensReadyRef.current) return;
    writeInventarioToStore(contagens);
  }, [contagens]);

  useEffect(() => {
    if (!contagensReadyRef.current) return;
    if (!insumosStore.length && !insumoCategorias.length) return;
    setContagens((prev) => {
      let changed = false;
      const next = prev.map((c) => {
        const prevCats: InventarioCategoria[] = Array.isArray(c.categorias) ? c.categorias : [];
        const existingById = new Map<string, InventarioItemRow>();
        const existingCatById = new Map<string, string>();
        for (const cat of prevCats) {
          const catName = normCatName(String(cat.nome ?? "")) || "Sem categoria";
          for (const it of cat.itens ?? []) {
            const id = String(it.id ?? "");
            if (!id) continue;
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

        const insumoById = new Map<string, { item: string; unidade: string; categoria: string }>();
        const desiredCatSet = new Set<string>();
        for (const c0 of insumoCategorias) {
          const name = normCatName(String(c0 ?? ""));
          if (!name || name === "-") continue;
          desiredCatSet.add(name);
        }
        for (const ins of insumosStore) {
          const catName = normCatName(String(ins.categoria ?? "")) || "Sem categoria";
          insumoById.set(String(ins.id), { item: String(ins.item ?? ""), unidade: String(ins.medida ?? "") || "Und", categoria: catName });
          desiredCatSet.add(catName);
        }

        for (const name of existingCatById.values()) desiredCatSet.add(name);
        if (!desiredCatSet.size) desiredCatSet.add("Sem categoria");

        const prevCatIdByName = new Map<string, string>();
        for (const cat of prevCats) {
          const nm = normCatName(String(cat.nome ?? ""));
          if (!nm) continue;
          const k = nm.toLowerCase();
          if (!prevCatIdByName.has(k)) prevCatIdByName.set(k, String(cat.id ?? ""));
        }

        const allIds = new Set<string>();
        for (const id of existingById.keys()) allIds.add(id);
        for (const id of insumoById.keys()) allIds.add(id);

        const itemsByCat = new Map<string, InventarioItemRow[]>();
        for (const id of allIds) {
          const ins = insumoById.get(id) ?? null;
          const prevIt = existingById.get(id) ?? null;
          const categoria = ins?.categoria ?? existingCatById.get(id) ?? "Sem categoria";
          const catKey = categoria.toLowerCase();
          const nextRow: InventarioItemRow = {
            id,
            item: ins?.item ?? String(prevIt?.item ?? ""),
            unidade: (ins?.unidade ?? String(prevIt?.unidade ?? "")) || "Und",
            estoqueFinal: String(prevIt?.estoqueFinal ?? ""),
            removido: prevIt?.removido,
          };
          if (prevIt) {
            const prevCat = (existingCatById.get(id) ?? "Sem categoria").toLowerCase();
            if (prevCat !== catKey) changed = true;
            if (String(prevIt.item ?? "") !== nextRow.item || String(prevIt.unidade ?? "") !== nextRow.unidade) changed = true;
          } else {
            changed = true;
          }
          const list = itemsByCat.get(catKey) ?? [];
          list.push(nextRow);
          itemsByCat.set(catKey, list);
        }

        const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });
        const orderedCats = Array.from(desiredCatSet.values()).sort((a, b) => collator.compare(a, b));
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
  }, [insumoCategorias, insumosStore, selectedContagemId]);

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
      const itens: InventarioItemRow[] = (insumosStore[0] ? insumosStore : []).map((i) => ({
        id: i.id,
        item: i.item,
        unidade: i.medida,
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
        const ins = insumosStore.find((x) => x.id === it.id) ?? null;
        const cat = normCatName(String(ins?.categoria ?? "")) || "Sem categoria";
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

  function updateItemQty(itemId: string, value: string) {
    const cId = selectedContagem?.id;
    if (!cId) return;
    setContagens((prev) => {
      const next = prev.map((c) => {
        if (c.id !== cId) return c;
        const categorias = (c.categorias ?? []).map((cat) => ({ ...cat, itens: (cat.itens ?? []).map((it) => (it.id === itemId ? { ...it, estoqueFinal: value } : it)) }));
        return { ...c, categorias };
      });
      const normalized = normalizeContagens(next);
      const updated = normalized.find((x) => x.id === cId);
      if (updated) void upsertInventarioToSupabase(updated).catch(() => {});
      return normalized;
    });
  }

  function commitPendingDraft(itemId: string) {
    if (!(itemId in pendingDraftsRef.current)) return;
    const value = String(pendingDraftsRef.current[itemId] ?? "").trim();
    updateItemQty(itemId, value);
    setPendingDrafts((prev) => {
      if (!(itemId in prev)) return prev;
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  }

  function removeItem(itemId: string) {
    const cId = selectedContagem?.id;
    if (!cId) return;
    setContagens((prev) => {
      const next = prev.map((c) => {
        if (c.id !== cId) return c;
        const categorias = (c.categorias ?? []).map((cat) => ({
          ...cat,
          itens: (cat.itens ?? []).map((it) => (it.id === itemId ? { ...it, removido: true, estoqueFinal: "" } : it)),
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
    updateItemQty(itemId, "");
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
    const byId = new Map(insumosStore.map((i) => [String(i.id), i]));
    const byName = new Map(insumosStore.map((i) => [String(i.item ?? "").toLowerCase(), i]));
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
                const ins = byId.get(String(i.id)) ?? byName.get(String(i.item ?? "").toLowerCase()) ?? null;
                const cat = String(ins?.categoria ?? "").trim() || "-";
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
    <div className={dash.dashboard}>
      <AppSidebar active="inventario" />

      <main className={dash.content}>
        <section className={styles.layout}>
          <div className={styles.left}>
            <button type="button" className={styles.newCountBtn} onClick={openNew}>
              <img src="/dashboard/ml7hdudz-6qw4osi.svg" className={styles.newCountIcon} alt="" />
              Nova Contagem
            </button>

            <div className={styles.leftTop}>
              <div className={styles.leftTitle}>{`Suas contagens (${contagens.length})`}</div>
            </div>

            <div className={styles.datesList} ref={datesListRef}>
              {contagens.map((c) => (
                <div
                  key={c.id}
                  className={styles.dateRow}
                  onDoubleClick={() => openEditContagem(c.id)}
                >
                  <button
                    type="button"
                    className={c.id === selectedContagemId ? `${styles.dateBtn} ${styles.dateBtnOn}` : styles.dateBtn}
                    onClick={() => {
                      setSelectedContagemId(c.id);
                      setQuery("");
                    }}
                    onDoubleClick={(e) => {
                      e.preventDefault();
                      openEditContagem(c.id);
                    }}
                  >
                    <span>{c.data}</span>
                  </button>
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
                </div>
              ))}
              {contagens[0] ? null : <div className={styles.muted}>Sem contagens</div>}
            </div>
          </div>

          <div className={styles.right}>
            <div className={styles.rightHeader}>
              <div className={styles.rightTitleRow}>
                <div className={styles.rightTitle}>
                  <IconBox /> {selectedContagem ? `Inventário de ${selectedContagem.data}` : "Inventário"}
                </div>
                <button type="button" className={styles.pdfBtn} onClick={() => void generatePdf()} disabled={!selectedContagem}>
                  <img src="/dashboard/ml7hdudz-vztdpis.svg" className={styles.pdfIcon} alt="" />
                  Gerar PDF
                </button>
              </div>
              <div className={styles.rightSubtitle}>Visualize a contagem da data selecionada.</div>
            </div>

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
            </div>

            <div className={styles.cols}>
              <div className={styles.col}>
                <div className={styles.colHeadPending}>Pendentes</div>
                <div className={styles.colBody}>
                  {pendentes.map((r) => (
                    <div key={r.id} className={styles.itemRow}>
                      <div className={styles.itemLeft}>
                        <div className={styles.dotPending} aria-hidden />
                        <div className={styles.itemText}>
                          <div className={styles.itemTitle}>{r.item}</div>
                            <div className={styles.itemSub}>{itemCategoryMap.get(String(r.id ?? "")) ?? "Sem categoria"}</div>
                        </div>
                      </div>
                      <div className={styles.itemRight}>
                        <input
                          className={styles.qtyInput}
                          value={pendingDrafts[r.id] ?? r.estoqueFinal}
                          onChange={(e) => setPendingDrafts((prev) => ({ ...prev, [r.id]: e.target.value }))}
                          onBlur={() => commitPendingDraft(r.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              commitPendingDraft(r.id);
                              e.currentTarget.blur();
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
                          placeholder="0"
                        />
                        <div className={styles.unitPill}>{r.unidade}</div>
                        <div className={styles.actions}>
                          <button
                            type="button"
                            className={styles.iconBtn}
                            aria-label="Editar"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={(e) => {
                              const rowEl = e.currentTarget.closest(`.${styles.itemRight}`);
                              const input = rowEl?.querySelector("input");
                              if (input instanceof HTMLInputElement) input.focus();
                            }}
                          >
                            <IconPencil />
                          </button>
                          <button type="button" className={styles.iconBtn} aria-label="Excluir" onClick={() => removeItem(r.id)}>
                            <IconTrash />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {pendentes[0] ? null : <div className={styles.emptyCol}>Sem itens pendentes</div>}
                </div>
              </div>

              <div className={styles.col}>
                <div className={styles.colHeadDone}>Contabilizados</div>
                <div className={styles.colBody}>
                  {contabilizados.map((r) => (
                    <div key={r.id} className={styles.itemRow}>
                      <div className={styles.itemLeft}>
                        <div className={styles.dotDone} aria-hidden>
                          ✓
                        </div>
                        <div className={styles.itemText}>
                          <div className={styles.itemTitle}>{r.item}</div>
                            <div className={styles.itemSub}>{itemCategoryMap.get(String(r.id ?? "")) ?? "Sem categoria"}</div>
                        </div>
                      </div>
                      <div className={styles.itemRight}>
                        {editingItemId === r.id ? (
                          <>
                            <input
                              ref={editInputRef}
                              className={styles.qtyInput}
                              value={editingValue}
                              onChange={(e) => setEditingValue(e.target.value)}
                              onKeyDown={(e) => {
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
                                if (editCancelledRef.current) {
                                  editCancelledRef.current = false;
                                  setEditingItemId(null);
                                  return;
                                }
                                updateItemQty(r.id, editingValue);
                                setEditingItemId(null);
                              }}
                            />
                            <div className={styles.unitPill}>{r.unidade}</div>
                          </>
                        ) : (
                          <div
                            className={styles.qtyLabel}
                            onClick={() => {
                              editCancelledRef.current = false;
                              editOriginalValueRef.current = String(r.estoqueFinal ?? "");
                              setEditingItemId(r.id);
                              setEditingValue(String(r.estoqueFinal ?? ""));
                              setTimeout(() => editInputRef.current?.focus(), 0);
                            }}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                editCancelledRef.current = false;
                                editOriginalValueRef.current = String(r.estoqueFinal ?? "");
                                setEditingItemId(r.id);
                                setEditingValue(String(r.estoqueFinal ?? ""));
                                setTimeout(() => editInputRef.current?.focus(), 0);
                              }
                            }}
                          >
                            {`${r.estoqueFinal} ${r.unidade}`}
                          </div>
                        )}
                        <div className={styles.actions}>
                          <button
                            type="button"
                            className={styles.iconBtn}
                            aria-label="Editar"
                            onMouseDown={(e) => {
                              if (editingItemId === r.id) e.preventDefault();
                            }}
                            onClick={() => {
                              if (editingItemId === r.id) {
                                editCancelledRef.current = false;
                                updateItemQty(r.id, editingValue);
                                setEditingItemId(null);
                                return;
                              }
                              editCancelledRef.current = false;
                              editOriginalValueRef.current = String(r.estoqueFinal ?? "");
                              setEditingItemId(r.id);
                              setEditingValue(String(r.estoqueFinal ?? ""));
                              setTimeout(() => editInputRef.current?.focus(), 0);
                            }}
                          >
                            <IconPencil />
                          </button>
                          <button
                            type="button"
                            className={styles.iconBtn}
                            aria-label="Excluir"
                            onMouseDown={(e) => {
                              if (editingItemId === r.id) e.preventDefault();
                            }}
                            onClick={() => uncountItem(r.id)}
                          >
                            <IconTrash />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {contabilizados[0] ? null : <div className={styles.emptyCol}>Sem itens contabilizados</div>}
                </div>
              </div>
            </div>
          </div>
        </section>

        {isNewOpen ? (
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
          </div>
        ) : null}

        {isDeleteContagemOpen && deleteContagemRow ? (
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
          </div>
        ) : null}
      </main>
    </div>
  );
}
