"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import dash from "../dashboard/dashboard.module.css";
import SystemToast from "../components/SystemToast";
import LoadingSpinner from "../components/LoadingSpinner";
import {
  loadDesperdiciosStateFromSupabase,
  loadDesperdiciosFromSupabase,
  deleteDesperdicioFromSupabase,
  upsertDesperdicioToSupabase,
  type DesperdicioCompatRow,
} from "../lib/desperdiciosSupabase";
import { readDesperdiciosFromStore, writeDesperdiciosToStore, type DesperdicioRow } from "../lib/desperdiciosStore";
import {
  readDesperdicioMotivosFromStore,
  subscribeDesperdicioMotivos,
  writeDesperdicioMotivosToStore,
  type DesperdicioMotivoRow,
} from "../lib/desperdiciosMotivosStore";
import { readInsumosFromStore, subscribeInsumos, writeInsumosToStore, type InsumoStoreItem } from "../lib/insumosStore";
import { loadInsumosFromSupabase } from "../lib/insumosSupabase";
import { readEntradasFromStore, subscribeEntradas, writeEntradasToStore, type EntradaStoreRow } from "../lib/entradasStore";
import { loadEntradasFromSupabase } from "../lib/entradasSupabase";
import { readFornecedorEquivalenciasMap, subscribeFornecedorEquivalencias, writeFornecedorEquivalenciasMap, type FornecedorEquivalenciasMap } from "../lib/fornecedoresStore";
import { loadFornecedoresStateFromSupabase } from "../lib/fornecedoresSupabase";
import { loadFichasTecnicasFromSupabase } from "../lib/fichasTecnicasSupabase";
import { readFichasTecnicasFromStore, subscribeFichasTecnicas, writeFichasTecnicasToStore, type FichaTecnicaRow } from "../lib/fichasTecnicasStore";
import { loadPrePreparoFromSupabase } from "../lib/prePreparoSupabase";
import { readPrePreparoFromStore, subscribePrePreparo, writePrePreparoToStore, type PrePreparoStoreRow } from "../lib/prePreparoStore";
import { loadPrePreparoEtiquetasFromSupabase, savePrePreparoEtiquetasToSupabase } from "../lib/prePreparoEtiquetasSupabase";
import { readPrePreparoEtiquetasFromStore, subscribePrePreparoEtiquetas, type PrePreparoEtiquetaRow, writePrePreparoEtiquetasToStore } from "../lib/prePreparoEtiquetasStore";
import { getExpiredPrePreparoEtiquetaDesperdicioSync, getEtiquetaIdFromWasteId, isPrePreparoEtiquetaWasteId } from "../lib/prePreparoEtiquetasToDesperdicios";
import { buildUserScopedId, requireUserScopePrefix } from "../lib/userScope";
import { QaModePanel } from "../lib/qaMode";
import styles from "./desperdicios.module.css";

function formatDateNumericLoose(value: string) {
  const raw = value.trim();
  const m = raw.match(/^(\d{1,2})\s*([A-Za-zÀ-ÿ]{3,})[,\s]+(\d{4})$/);
  if (!m) return raw;
  const day = String(Number.parseInt(m[1], 10)).padStart(2, "0");
  const monRaw = m[2].toLowerCase().replace(".", "");
  const year = m[3];
  const monthMap: Record<string, string> = {
    jan: "01",
    janeiro: "01",
    feb: "02",
    fev: "02",
    fevereiro: "02",
    mar: "03",
    março: "03",
    marco: "03",
    apr: "04",
    abr: "04",
    abril: "04",
    may: "05",
    mai: "05",
    maio: "05",
    jun: "06",
    junho: "06",
    jul: "07",
    julho: "07",
    aug: "08",
    ago: "08",
    agosto: "08",
    sep: "09",
    set: "09",
    setembro: "09",
    oct: "10",
    out: "10",
    outubro: "10",
    nov: "11",
    novembro: "11",
    dec: "12",
    dez: "12",
    dezembro: "12",
  };
  const mm = monthMap[monRaw] ?? "";
  if (!mm) return raw;
  return `${day}/${mm}/${year}`;
}

function parseBrlToCents(input: string) {
  const s = input.replace(/[^\d,.-]/g, "").trim();
  if (!s) return 0;
  const neg = s.includes("-");
  const cleaned = s.replace(/-/g, "");
  const parts = cleaned.split(",");
  const intPart = parts[0].replace(/\./g, "").replace(/[^\d]/g, "") || "0";
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
  const s = value.replace(/[^\d,.-]/g, "").trim();
  if (!s) return 0;
  const neg = s.includes("-");
  const cleaned = s.replace(/-/g, "");
  const parts = cleaned.split(",");
  const intPart = (parts[0] ?? "").replace(/\./g, "").replace(/[^\d]/g, "") || "0";
  const decPart = (parts[1] ?? "").replace(/[^\d]/g, "");
  const num = Number.parseFloat(`${intPart}.${decPart}`);
  return neg ? -num : num;
}

function sanitizeUiLabel(value: unknown) {
  return String(value ?? "").replace(/[\u200B-\u200D\uFEFF\u00A0]/g, " ").trim();
}

function extractBubbleThingIdToken(value: string) {
  const s = sanitizeUiLabel(value);
  if (!s) return "";
  const m1 = s.match(/\b\d{10,}\b/);
  if (m1?.[0]) return m1[0];
  const m2 = s.match(/\b\d{8,}x\d{6,}\b/i);
  if (m2?.[0]) return m2[0];
  return "";
}

function looksLikeBubbleThingId(value: string) {
  return Boolean(extractBubbleThingIdToken(value));
}

function looksLikeSerializedIdArray(value: string) {
  const s = sanitizeUiLabel(value);
  if (!s.startsWith("[") || !s.endsWith("]")) return false;
  try {
    const parsed = JSON.parse(s) as any;
    if (!Array.isArray(parsed)) return false;
    const items = parsed.map((x) => String(x ?? "")).filter(Boolean);
    if (!items.length) return false;
    return items.every((x) => Boolean(extractBubbleThingIdToken(x)));
  } catch {
    return false;
  }
}

function resolveItemLabel(itemRaw: unknown, insumos: InsumoStoreItem[], prePreparo: PrePreparoStoreRow[], fichas: FichaTecnicaRow[]) {
  const raw = sanitizeUiLabel(itemRaw);
  if (!raw) return "-";
  const id = extractBubbleThingIdToken(raw);
  if (!id) return raw;
  const ins =
    insumos.find((i) => extractBubbleThingIdToken(String(i.id ?? "").trim()) === id) ??
    insumos.find((i) => String(i.id ?? "").trim() === raw) ??
    null;
  if (ins?.item) return String(ins.item).trim() || raw;
  const prep =
    prePreparo.find((r) => extractBubbleThingIdToken(String(r.id ?? "").trim()) === id) ??
    prePreparo.find((r) => String(r.id ?? "").trim() === raw) ??
    null;
  if (prep?.receita) return String(prep.receita).trim() || raw;
  const ficha =
    fichas.find((r) => extractBubbleThingIdToken(String((r as any)?.id ?? "").trim()) === id) ??
    fichas.find((r) => String((r as any)?.id ?? "").trim() === raw) ??
    null;
  if (ficha && typeof (ficha as any).receita === "string" && String((ficha as any).receita).trim()) return String((ficha as any).receita).trim();
  return raw;
}

function normalizeMotivoOptionName(value: unknown) {
  const raw = sanitizeUiLabel(value);
  if (!raw) return "";
  if (looksLikeSerializedIdArray(raw)) return "";
  if (looksLikeBubbleThingId(raw)) return "";
  return raw;
}

function resolveMotivoLabel(motivoRaw: unknown, motivosStore: DesperdicioMotivoRow[]) {
  const raw = sanitizeUiLabel(motivoRaw);
  if (!raw) return "Sem motivo";
  if (looksLikeSerializedIdArray(raw)) return "Sem motivo";
  if (looksLikeBubbleThingId(raw)) return "Sem motivo";
  const mapped = motivosStore.find((m) => String(m.id ?? "").trim() === raw) ?? null;
  const name = mapped ? sanitizeUiLabel(mapped.nome) : "";
  return name || raw;
}

function cleanMotivosRows(input: DesperdicioMotivoRow[]) {
  const out: DesperdicioMotivoRow[] = [{ id: "protected-validade-vencida", nome: "Validade Vencida" }];
  const seen = new Set<string>([normalizeKey("Validade Vencida")]);
  for (const m of Array.isArray(input) ? input : []) {
    if (!m || typeof m !== "object") continue;
    const incomingId = sanitizeUiLabel((m as any).id);
    if (incomingId && incomingId.startsWith("default-")) continue;
    const nome = normalizeMotivoOptionName((m as any).nome);
    if (!nome) continue;
    const key = normalizeKey(nome);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const id = incomingId || `${Date.now()}-${out.length}`;
    out.push({ id, nome });
  }
  return out;
}

function motivosEquivalent(a: DesperdicioMotivoRow[], b: DesperdicioMotivoRow[]) {
  const ak = (Array.isArray(a) ? a : [])
    .map((m) => normalizeKey(normalizeMotivoOptionName((m as any)?.nome)))
    .filter(Boolean);
  const bk = (Array.isArray(b) ? b : [])
    .map((m) => normalizeKey(normalizeMotivoOptionName((m as any)?.nome)))
    .filter(Boolean);
  if (ak.length !== bk.length) return false;
  for (let i = 0; i < ak.length; i++) if (ak[i] !== bk[i]) return false;
  return true;
}

function formatQtyInput3(value: string) {
  const raw = String(value ?? "");
  const cleaned = raw.replace(/[^\d,.-]/g, "");
  if (!cleaned.trim()) return "";
  const neg = cleaned.includes("-");
  const s = cleaned.replace(/-/g, "").replace(/\./g, ",");
  const parts = s.split(",");
  const intPart = (parts[0] ?? "").replace(/[^\d]/g, "") || "0";
  const hasComma = s.includes(",");
  const decPart = hasComma ? (parts[1] ?? "").replace(/[^\d]/g, "").slice(0, 3) : "";
  const out = hasComma ? `${intPart},${decPart}` : intPart;
  return neg ? `-${out}` : out;
}

function formatMoneyInput2(value: string) {
  const raw = String(value ?? "");
  const cleaned = raw.replace(/[^\d,.-]/g, "");
  if (!cleaned.trim()) return "";
  const neg = cleaned.includes("-");
  const s = cleaned.replace(/-/g, "");
  const parts = s.split(",");
  const intPart = (parts[0] ?? "").replace(/\./g, "").replace(/[^\d]/g, "") || "0";
  const hasComma = s.includes(",");
  const decPart = hasComma ? (parts[1] ?? "").replace(/[^\d]/g, "").slice(0, 2) : "";
  const out = hasComma ? `${intPart},${decPart}` : intPart;
  return neg ? `-${out}` : out;
}

function formatPtNumber(value: number, decimals = 2) {
  const n = Number.isFinite(value) ? value : 0;
  return n.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, delta: number) {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}

function formatDateLabelLowerPT(d: Date) {
  const day = String(d.getDate()).padStart(2, "0");
  const year = d.getFullYear();
  const month = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][d.getMonth()];
  return `${day} ${month}, ${year}`;
}

function formatDateNumericPT(d: Date) {
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function supabaseErrorMessage(err: unknown, action: "salvar" | "carregar" | "excluir") {
  const msg = (err instanceof Error ? err.message : String(err ?? "")).trim();
  const base = action === "carregar" ? "Não foi possível carregar do Supabase." : action === "excluir" ? "Não foi possível excluir no Supabase." : "Não foi possível salvar no Supabase.";
  if (!msg) return base;
  if (msg === "unauthorized" || msg.includes("401")) return "Sessão expirada. Faça login novamente.";
  if (msg.toLowerCase().includes("does not exist")) return "Tabela do Supabase não existe (execute o setup do Supabase).";
  return `${base} (${msg}).`;
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

function parseDateLabelLoose(value: string) {
  const raw = value.trim();
  if (!raw) return null;
  const num = parseDateNumericLoose(raw);
  if (num) return num;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const year = Number.parseInt(iso[1], 10);
    const month = Number.parseInt(iso[2], 10) - 1;
    const day = Number.parseInt(iso[3], 10);
    const d = new Date(year, month, day);
    if (d.getFullYear() === year && d.getMonth() === month && d.getDate() === day) return d;
  }
  const m = raw.match(/^(\d{1,2})\s*([A-Za-zÀ-ÿ]{3,})[,\s]+(\d{4})$/);
  if (!m) return null;
  const day = Number.parseInt(m[1], 10);
  const monRaw = m[2].toLowerCase().replace(".", "");
  const year = Number.parseInt(m[3], 10);
  const monthMap: Record<string, number> = {
    jan: 0,
    janeiro: 0,
    feb: 1,
    fev: 1,
    fevereiro: 1,
    mar: 2,
    março: 2,
    marco: 2,
    apr: 3,
    abr: 3,
    abril: 3,
    may: 4,
    mai: 4,
    maio: 4,
    jun: 5,
    junho: 5,
    jul: 6,
    julho: 6,
    aug: 7,
    ago: 7,
    agosto: 7,
    sep: 8,
    set: 8,
    setembro: 8,
    oct: 9,
    out: 9,
    outubro: 9,
    nov: 10,
    novembro: 10,
    dec: 11,
    dez: 11,
    dezembro: 11,
  };
  const month = monthMap[monRaw];
  if (month === undefined) return null;
  const d = new Date(year, month, day);
  if (d.getFullYear() !== year || d.getMonth() !== month || d.getDate() !== day) return null;
  return d;
}

function hashCode7(input: string) {
  const s = String(input ?? "").trim();
  if (!s) return "";
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const base = Math.abs(h >>> 0).toString(36).toUpperCase();
  return base.padStart(7, "0").slice(0, 7);
}

function formatEtiquetaQtyLabel(qtyLabel: string, unitLabel: string) {
  const unit = String(unitLabel ?? "").trim() || "Und";
  const n = parsePtNumber(String(qtyLabel ?? ""));
  if (!Number.isFinite(n) || n <= 0) return `${String(qtyLabel ?? "").trim() || "0"} ${unit}`.trim();
  const isInt = Math.abs(n - Math.round(n)) < 1e-9;
  const qty = n.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: isInt ? 0 : 3 });
  return `${qty} ${unit}`.trim();
}

function formatEtiquetaCreatedMeta(e: { id: string; code?: string; createdAt?: string; dataProducao?: string }) {
  const code = String(e.code ?? "").trim() || hashCode7(String(e.id ?? ""));
  const created = e.createdAt ? new Date(e.createdAt) : null;
  if (created && Number.isFinite(created.getTime())) {
    const date = created.toLocaleDateString("pt-BR");
    const time = created.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    return `#${code} • Criado em ${date} às ${time}`;
  }
  const prod = String(e.dataProducao ?? "").trim();
  if (prod) return `#${code} • Produção ${prod}`;
  return `#${code}`;
}

function daysOverdueLabel(validadeLabel: string) {
  const validade = parseDateLabelLoose(validadeLabel);
  if (!validade) return "";
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const exp = new Date(validade.getFullYear(), validade.getMonth(), validade.getDate()).getTime();
  const diff = Math.floor((today - exp) / 86_400_000);
  return diff > 0 ? `VENCIDO HÁ ${diff}D` : "VENCIDO";
}

function IconWaste() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M7 6h10l-1 15H8L7 6Zm2-3h6l1 2H8l1-2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M10 10v8M14 10v8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconMoney() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 7h16a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M7 12h.01" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M17 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function IconTag() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M20 13l-7 7-10-10V3h7l10 10Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M7.5 7.5h.01" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function IconList() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 6h13M8 12h13M8 18h13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
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

function IconCheck() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconX() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function normalizeKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function isProtectedMotivo(nome: string) {
  return normalizeKey(nome) === "validade vencida";
}

type DesperdicioTableColumn = "data" | "item" | "quantidade" | "custo" | "motivo";

function SortMark({ dir }: { dir: "asc" | "desc" }) {
  return <span>{dir === "asc" ? "^" : "v"}</span>;
}

export default function DesperdiciosClient({
  initialSourceMeta,
}: {
  initialSourceMeta?: { source: "legacy" | "compat"; readOnly: boolean };
}) {
  const toastTimerRef = useRef<number | null>(null);
  const [mounted, setMounted] = useState(false);
  const loadErrorShownRef = useRef(false);
  const saveErrorShownRef = useRef(false);
  const deleteErrorShownRef = useRef(false);
  const [isLoadingTable, setIsLoadingTable] = useState(false);
  const [rows, setRows] = useState<DesperdicioRow[]>([]);
  const [sourceMeta, setSourceMeta] = useState<{ source: "legacy" | "compat"; readOnly: boolean }>(() => {
    return initialSourceMeta ?? { source: "legacy", readOnly: false };
  });
  const [compatRows, setCompatRows] = useState<DesperdicioCompatRow[]>([]);
  const rowsReadyRef = useRef(false);
  const etiquetasSyncRunRef = useRef(0);
  const [userScopePrefix, setUserScopePrefix] = useState<string>("");
  const [toast, setToast] = useState<{ title: string; message: string; tone: "success" | "error" } | null>(null);
  const [query, setQuery] = useState("");
  const [motivoFilter, setMotivoFilter] = useState("Motivo");
  const [periodo, setPeriodo] = useState("");
  const [columnOrder, setColumnOrder] = useState<DesperdicioTableColumn[]>(["data", "item", "quantidade", "custo", "motivo"]);
  const [draggingColumn, setDraggingColumn] = useState<DesperdicioTableColumn | null>(null);
  const [sortKey, setSortKey] = useState<DesperdicioTableColumn | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const isReadOnly = Boolean(sourceMeta.readOnly);
  const isCompatSource = sourceMeta.source === "compat";
  // #region debug-point A:reporter
  const __dbg = (hypothesisId: string, msg: string, data?: Record<string, unknown>) => {
    fetch("http://127.0.0.1:7777/event", {
      method: "POST",
      body: JSON.stringify({
        sessionId: "desperdicios-sidebar-freeze",
        runId: "post",
        hypothesisId,
        location: "DesperdiciosClient",
        msg: `[DEBUG] ${msg}`,
        data: data ?? {},
        ts: Date.now(),
      }),
    }).catch(() => {});
  };
  // #endregion

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const src = String(params.get("source") ?? "").trim().toLowerCase();
      if (src === "compat") {
        setSourceMeta({ source: "compat", readOnly: true });
        return;
      }
      if (src === "legacy") {
        setSourceMeta({ source: "legacy", readOnly: false });
      }
    } catch {}
  }, []);

  const [insumosStore, setInsumosStore] = useState<InsumoStoreItem[]>([]);
  const [entradasRows, setEntradasRows] = useState<EntradaStoreRow[]>([]);
  const [equivalenciasMap, setEquivalenciasMap] = useState<FornecedorEquivalenciasMap>({});
  const [fichasTecnicas, setFichasTecnicas] = useState<FichaTecnicaRow[]>([]);
  const [prePreparoStore, setPrePreparoStore] = useState<PrePreparoStoreRow[]>([]);
  const [prePreparoEtiquetas, setPrePreparoEtiquetas] = useState<PrePreparoEtiquetaRow[]>([]);
  const [motivosStore, setMotivosStore] = useState<DesperdicioMotivoRow[]>([]);
  const [isMotivosOpen, setIsMotivosOpen] = useState(false);
  const [editingMotivoId, setEditingMotivoId] = useState<string | null>(null);
  const [newMotivoDraft, setNewMotivoDraft] = useState("");
  const [editingMotivoDraft, setEditingMotivoDraft] = useState("");
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [confirmType, setConfirmType] = useState<"desperdicio" | "motivo">("desperdicio");
  const [confirmDesperdicio, setConfirmDesperdicio] = useState<DesperdicioRow | null>(null);
  const [confirmMotivo, setConfirmMotivo] = useState<DesperdicioMotivoRow | null>(null);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingEtiquetaId, setEditingEtiquetaId] = useState<string | null>(null);
  const [draftData, setDraftData] = useState(() => formatDateLabelLowerPT(new Date()));
  const [draftItem, setDraftItem] = useState("");
  const [draftUnitCost, setDraftUnitCost] = useState("0,00");
  const [draftQty, setDraftQty] = useState("0,00");
  const [draftQtyUnit, setDraftQtyUnit] = useState("Und");
  const [draftMotivo, setDraftMotivo] = useState("Validade Vencida");
  const [isDataCalOpen, setIsDataCalOpen] = useState(false);
  const [dataCalMonth, setDataCalMonth] = useState(() => startOfMonth(new Date()));
  const dataCalWrapRef = useRef<HTMLDivElement | null>(null);
  const dataCalPopRef = useRef<HTMLDivElement | null>(null);
  const [dataCalRect, setDataCalRect] = useState<{ left: number; top: number } | null>(null);
  const [isPeriodoCalOpen, setIsPeriodoCalOpen] = useState(false);
  const [periodoCalMonth, setPeriodoCalMonth] = useState(() => startOfMonth(new Date()));
  const periodoCalWrapRef = useRef<HTMLDivElement | null>(null);

  function showToast(message: string, type: "success" | "error", durationMs = 6000) {
    setToast({ title: type === "success" ? "Sucesso" : "Erro", message, tone: type });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, durationMs);
  }

  useEffect(() => {
    // #region debug-point B:mount
    __dbg("B", "mount", { href: window.location.href });
    // #endregion
    setMounted(true);
  }, []);

  useEffect(() => {
    return () => {
      // #region debug-point B:unmount
      __dbg("B", "unmount", { href: window.location.href });
      // #endregion
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  // #region debug-point A:input-capture
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      try {
        const target = e.target as Element | null;
        const isInSidebar = Boolean(target?.closest?.(`.${dash.menuLateral}`));
        const nearSidebar = e.clientX <= 240;
        if (!isInSidebar && !nearSidebar) return;
        const top = document.elementFromPoint(e.clientX, e.clientY) as Element | null;
        const topStyle = top ? window.getComputedStyle(top) : null;
        __dbg("A", "pointerdown", {
          x: e.clientX,
          y: e.clientY,
          isInSidebar,
          topTag: top?.tagName ?? "",
          topId: (top as any)?.id ?? "",
          topClass: (top as any)?.className ? String((top as any)?.className).slice(0, 200) : "",
          topPos: topStyle?.position ?? "",
          topZ: topStyle?.zIndex ?? "",
          topPointer: topStyle?.pointerEvents ?? "",
        });
      } catch {}
    };

    const onError = (ev: ErrorEvent) => {
      __dbg("D", "window-error", { message: String(ev.message ?? ""), filename: String(ev.filename ?? ""), lineno: ev.lineno, colno: ev.colno });
    };

    const onRejection = (ev: PromiseRejectionEvent) => {
      const reason = (ev as any)?.reason;
      __dbg("D", "unhandledrejection", { reason: reason instanceof Error ? reason.message : String(reason ?? "") });
    };

    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection as any);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection as any);
    };
  }, []);
  // #endregion

  useEffect(() => {
    void requireUserScopePrefix()
      .then((prefix) => setUserScopePrefix(prefix))
      .catch(() => setUserScopePrefix(""));
  }, []);
  const [periodoRangeStart, setPeriodoRangeStart] = useState<Date | null>(null);
  const [periodoRangeEnd, setPeriodoRangeEnd] = useState<Date | null>(null);
  const editMotivoInputRef = useRef<HTMLInputElement | null>(null);

  const motivos = useMemo(() => {
    const stored = motivosStore.map((m) => normalizeMotivoOptionName(m.nome)).filter(Boolean);
    const storedNonProtected = stored.filter((n) => !isProtectedMotivo(n));
    const base = storedNonProtected.length
      ? ["Validade Vencida", ...storedNonProtected]
      : ["Validade Vencida", "Erro operacional", "Sobra do dia", "Item avariado (Fornecedor)", "Pedido retornou pra loja", "Talos de Produção", "Outro"];
    const uniq: string[] = [];
    const seen = new Set<string>();
    for (const m of ["Sem motivo", ...base]) {
      const v = sanitizeUiLabel(m);
      const k = v.toLowerCase();
      if (!v || seen.has(k)) continue;
      seen.add(k);
      uniq.push(v);
    }
    return uniq;
  }, [motivosStore]);

  const integratedRows = useMemo(() => rows, [rows]);

  const kpiRows = useMemo(() => {
    let filtered = integratedRows;
    if (motivoFilter !== "Motivo") filtered = filtered.filter((r) => resolveMotivoLabel(r.motivo, motivosStore) === motivoFilter);
    const p = periodo.trim();
    if (p) {
      const parts = p.split("-").map((x) => x.trim()).filter(Boolean);
      const a = parseDateNumericLoose(parts[0] ?? p);
      const b = parts[1] ? parseDateNumericLoose(parts[1]) : null;
      const start = a ? new Date(a.getFullYear(), a.getMonth(), a.getDate()) : null;
      const end = b ? new Date(b.getFullYear(), b.getMonth(), b.getDate()) : start;
      if (!start || !end) return filtered;
      const min = start.getTime() <= end.getTime() ? start.getTime() : end.getTime();
      const max = start.getTime() <= end.getTime() ? end.getTime() : start.getTime();
      filtered = filtered.filter((r) => {
        const d = parseDateNumericLoose(formatDateNumericLoose(r.data));
        if (!d) return false;
        const t = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        return t >= min && t <= max;
      });
    }
    return filtered;
  }, [integratedRows, motivoFilter, motivosStore, periodo]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let filtered = q
      ? integratedRows.filter((r) => {
          const itemLabel = resolveItemLabel(r.item, insumosStore, prePreparoStore, fichasTecnicas);
          const motivoLabel = resolveMotivoLabel(r.motivo, motivosStore);
          return `${r.data} ${itemLabel} ${motivoLabel}`.toLowerCase().includes(q);
        })
      : integratedRows;
    if (motivoFilter !== "Motivo") filtered = filtered.filter((r) => resolveMotivoLabel(r.motivo, motivosStore) === motivoFilter);
    const p = periodo.trim();
    if (p) {
      const parts = p.split("-").map((x) => x.trim()).filter(Boolean);
      const a = parseDateNumericLoose(parts[0] ?? p);
      const b = parts[1] ? parseDateNumericLoose(parts[1]) : null;
      const start = a ? new Date(a.getFullYear(), a.getMonth(), a.getDate()) : null;
      const end = b ? new Date(b.getFullYear(), b.getMonth(), b.getDate()) : start;
      if (!start || !end) return filtered;
      const min = start.getTime() <= end.getTime() ? start.getTime() : end.getTime();
      const max = start.getTime() <= end.getTime() ? end.getTime() : start.getTime();
      filtered = filtered.filter((r) => {
        const d = parseDateNumericLoose(formatDateNumericLoose(r.data));
        if (!d) return false;
        const t = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        return t >= min && t <= max;
      });
    }
    if (!sortKey) return filtered;
    const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });
    const direction = sortDir === "asc" ? 1 : -1;
    const decorated = filtered.map((row, index) => ({ row, index }));
    decorated.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "data": {
          const aTime = parseDateLabelLoose(a.row.data)?.getTime() ?? 0;
          const bTime = parseDateLabelLoose(b.row.data)?.getTime() ?? 0;
          cmp = aTime - bTime;
          break;
        }
        case "item":
        case "motivo":
          cmp = collator.compare(a.row[sortKey], b.row[sortKey]);
          break;
        case "quantidade":
          cmp = parsePtNumber(a.row.quantidade) - parsePtNumber(b.row.quantidade);
          break;
        case "custo":
          cmp = parseBrlToCents(a.row.custo) - parseBrlToCents(b.row.custo);
          break;
      }
      if (!cmp) cmp = a.index - b.index;
      return cmp * direction;
    });
    return decorated.map(({ row }) => row);
  }, [fichasTecnicas, insumosStore, integratedRows, motivoFilter, motivosStore, periodo, prePreparoStore, query, sortDir, sortKey]);

  const qaUi = useMemo(() => {
    if (isCompatSource) {
      return {
        meta: sourceMeta,
        rendered: {
          rowsCount: compatRows.length,
          rows: compatRows.map((r) => ({
            id: r.id,
            bubble_id: r.bubble_id,
            data: r.data,
            item: r.item,
            itemId: r.itemId,
            quantidade: r.quantidade,
            unidade: r.unidade,
            custoUnitario: r.custoUnitario,
            custoTotal: r.custoTotal,
            motivo: r.motivo,
            motivoId: r.motivoId,
            etiqueta: r.etiqueta,
            etiquetaId: r.etiquetaId,
          })),
        },
      };
    }
    return {
      meta: sourceMeta,
      filters: { query, motivoFilter, periodo },
      sort: { sortKey, sortDir, columnOrder },
      rendered: {
        rowsCount: visible.length,
        rows: visible.map((r) => ({
          id: r.id,
          data: r.data,
          item: resolveItemLabel(r.item, insumosStore, prePreparoStore, fichasTecnicas),
          quantidade: r.quantidade,
          custo: r.custo,
          motivo: resolveMotivoLabel(r.motivo, motivosStore),
          isEtiquetaVencida: isPrePreparoEtiquetaWasteId(r.id),
        })),
      },
    };
  }, [columnOrder, compatRows, fichasTecnicas, insumosStore, isCompatSource, motivoFilter, motivosStore, periodo, prePreparoStore, query, sortDir, sortKey, sourceMeta, visible]);

  function toggleSort(key: DesperdicioTableColumn) {
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

  function onColumnDrop(target: DesperdicioTableColumn) {
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

  const tableGridTemplateColumns = useMemo(() => {
    const widths: Record<DesperdicioTableColumn | "acoes", string> = {
      data: "130px",
      item: "minmax(220px, 1fr)",
      quantidade: "120px",
      custo: "130px",
      motivo: "minmax(200px, 1fr)",
      acoes: "110px",
    };
    const orderedColumns: Array<DesperdicioTableColumn | "acoes"> = [...columnOrder, "acoes"];
    return orderedColumns.map((column) => widths[column]).join(" ");
  }, [columnOrder]);

  function renderTableCell(row: DesperdicioRow, column: DesperdicioTableColumn) {
    if (column === "data") {
      return <div className={styles.muted}>{formatDateNumericLoose(row.data)}</div>;
    }
    if (column === "item") {
      return (
        <div className={styles.itemCell}>
          <div className={styles.itemDot} aria-hidden />
          <div className={styles.itemName}>{resolveItemLabel(row.item, insumosStore, prePreparoStore, fichasTecnicas)}</div>
        </div>
      );
    }
    if (column === "quantidade") {
      return <div>{row.quantidade || "-"}</div>;
    }
    if (column === "custo") {
      return (
        <div className={styles.costCell}>
          <div className={styles.costMain}>{row.custo || "-"}</div>
          <div className={styles.costSub}>{unitCostLabel(row) || "-"}</div>
        </div>
      );
    }
    return <div className={styles.muted}>{resolveMotivoLabel(row.motivo, motivosStore)}</div>;
  }

  const etiquetaWasteSummary = useMemo(() => {
    const now = new Date();
    const todayT = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const pending: PrePreparoEtiquetaRow[] = [];
    const launched: PrePreparoEtiquetaRow[] = [];
    let totalNotIgnored = 0;
    for (const e of prePreparoEtiquetas) {
      const validade = parseDateLabelLoose(e.dataValidade);
      if (!validade) continue;
      const t = new Date(validade.getFullYear(), validade.getMonth(), validade.getDate()).getTime();
      if (t >= todayT) continue;
      const status = (e.wasteStatus ?? "pending") as "pending" | "launched" | "ignored";
      if (status === "ignored") continue;
      totalNotIgnored += 1;
      if (status === "launched") launched.push(e);
      else pending.push(e);
    }
    const keyT = (row: PrePreparoEtiquetaRow) => {
      const d = parseDateLabelLoose(row.dataValidade);
      if (!d) return 0;
      return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    };
    pending.sort((a, b) => keyT(b) - keyT(a));
    return { totalNotIgnored, pending, launched };
  }, [prePreparoEtiquetas]);

  const totalCents = useMemo(() => kpiRows.reduce((acc, r) => acc + parseBrlToCents(r.custo), 0), [kpiRows]);
  const totalItems = useMemo(() => kpiRows.length, [kpiRows]);
  const totalMotivos = useMemo(() => {
    const set = new Set<string>();
    const base = motivosStore[0] ? motivosStore.map((m) => m.nome) : motivos;
    for (const nome of base) {
      const v = String(nome ?? "").trim();
      if (!v) continue;
      set.add(v.toLowerCase());
    }
    for (const r of kpiRows) {
      const v = String(r.motivo ?? "").trim();
      if (!v) continue;
      set.add(v.toLowerCase());
    }
    return set.size;
  }, [kpiRows, motivos, motivosStore]);
  const etiquetasVencidas = useMemo(() => etiquetaWasteSummary.totalNotIgnored, [etiquetaWasteSummary.totalNotIgnored]);

  const motivoCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of integratedRows) {
      const key = normalizeKey(resolveMotivoLabel(r.motivo, motivosStore)) || "sem-motivo";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [integratedRows, motivosStore]);

  function motivoLaunchCount(nome: string) {
    const key = normalizeKey(nome) || "sem-motivo";
    return motivoCounts.get(key) ?? 0;
  }

  function motivoLaunchCountLabel(count: number) {
    return `${count} ${count === 1 ? "lançamento" : "lançamentos"}`;
  }

  const chartData = useMemo(() => {
    const byMotivo = new Map<string, number>();
    for (const r of visible) {
      const k = resolveMotivoLabel(r.motivo, motivosStore);
      byMotivo.set(k, (byMotivo.get(k) ?? 0) + parseBrlToCents(r.custo));
    }
    const list = Array.from(byMotivo.entries()).map(([motivo, cents]) => ({ motivo, cents }));
    list.sort((a, b) => b.cents - a.cents);
    return list.slice(0, 5);
  }, [motivosStore, visible]);

  const chartMax = useMemo(() => Math.max(1, ...chartData.map((d) => d.cents)), [chartData]);
  const yMax = useMemo(() => {
    const v = Math.ceil(chartMax / 100);
    const step = 70;
    const rounded = Math.ceil(v / step) * step;
    return Math.max(step * 4, rounded);
  }, [chartMax]);
  const yTicks = useMemo(() => [yMax, Math.round((yMax * 3) / 4), Math.round(yMax / 2), Math.round(yMax / 4), 0], [yMax]);

  const suggestions = useMemo(() => {
    const list = [...insumosStore.map((i) => i.item), ...prePreparoStore.map((r) => r.receita), ...fichasTecnicas.map((r) => r.receita)];
    const q = draftItem.trim().toLowerCase();
    if (!q) return list.slice(0, 6);
    return list.filter((n) => n.toLowerCase().includes(q)).slice(0, 6);
  }, [draftItem, fichasTecnicas, insumosStore, prePreparoStore]);

  const itemOptions = useMemo(() => {
    const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });
    const uniqSorted = (values: string[]) => {
      const set = new Set<string>();
      for (const v of values) {
        const s = String(v ?? "").trim();
        if (!s) continue;
        set.add(s);
      }
      return Array.from(set).sort(collator.compare);
    };
    return {
      insumos: uniqSorted(insumosStore.map((i) => i.item)),
      prePreparo: uniqSorted(prePreparoStore.map((p) => p.receita)),
      fichas: uniqSorted(fichasTecnicas.map((f) => f.receita)),
    };
  }, [fichasTecnicas, insumosStore, prePreparoStore]);

  useEffect(() => {
    if (isReadOnly) return;
    const initial = readInsumosFromStore();
    setInsumosStore(initial);
    let cancelled = false;
    const timer = !initial.length
      ? window.setTimeout(() => {
          void (async () => {
            try {
              const dbRows = await loadInsumosFromSupabase();
              if (!cancelled && dbRows.length) writeInsumosToStore(dbRows);
            } catch {}
          })();
        }, 900)
      : null;
    const unsub = subscribeInsumos((rows) => setInsumosStore(rows));
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      unsub();
    };
  }, [isReadOnly]);

  useEffect(() => {
    if (isReadOnly) return;
    const initial = readEntradasFromStore([]);
    setEntradasRows(initial);
    let cancelled = false;
    const timer = !initial.length
      ? window.setTimeout(() => {
          void (async () => {
            try {
              const db = await loadEntradasFromSupabase();
              if (!cancelled && db.length) writeEntradasToStore(db);
            } catch {}
            if (!cancelled) setEntradasRows(readEntradasFromStore([]));
          })();
        }, 1100)
      : null;
    const unsub = subscribeEntradas((rows) => setEntradasRows(rows));
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      unsub();
    };
  }, [isReadOnly]);

  useEffect(() => {
    if (isReadOnly) return;
    const initial = readFornecedorEquivalenciasMap();
    setEquivalenciasMap(initial);
    let cancelled = false;
    const timer = Object.keys(initial).length
      ? null
      : window.setTimeout(() => {
          void (async () => {
            let nextEq: FornecedorEquivalenciasMap = {};
            try {
              const db = await loadFornecedoresStateFromSupabase();
              const hasDb = Object.keys(db.info).length || Object.keys(db.produtos).length || Object.keys(db.equivalencias).length;
              if (hasDb) nextEq = db.equivalencias;
            } catch {}
            if (cancelled) return;
            writeFornecedorEquivalenciasMap(nextEq);
            setEquivalenciasMap(nextEq);
          })();
        }, 1400);
    const unsub = subscribeFornecedorEquivalencias((m) => setEquivalenciasMap(m));
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      unsub();
    };
  }, [isReadOnly]);

  useEffect(() => {
    if (isReadOnly) return;
    const initial = readFichasTecnicasFromStore([]);
    setFichasTecnicas(initial);
    let cancelled = false;
    const timer = !initial.length
      ? window.setTimeout(() => {
          void (async () => {
            try {
              const db = await loadFichasTecnicasFromSupabase();
              if (!cancelled && db.length) writeFichasTecnicasToStore(db);
            } catch {}
            if (!cancelled) setFichasTecnicas(readFichasTecnicasFromStore([]));
          })();
        }, 1100)
      : null;
    const unsub = subscribeFichasTecnicas((rows) => setFichasTecnicas(rows));
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      unsub();
    };
  }, [isReadOnly]);

  useEffect(() => {
    if (isReadOnly) return;
    const initial = readPrePreparoFromStore();
    setPrePreparoStore(initial);
    let cancelled = false;
    const timer = !initial.length
      ? window.setTimeout(() => {
          void (async () => {
            try {
              const db = await loadPrePreparoFromSupabase();
              if (!cancelled && db.length) writePrePreparoToStore(db as any);
            } catch {}
            if (!cancelled) setPrePreparoStore(readPrePreparoFromStore());
          })();
        }, 1400)
      : null;
    const unsub = subscribePrePreparo((rows) => setPrePreparoStore(rows));
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      unsub();
    };
  }, [isReadOnly]);

  useEffect(() => {
    if (isReadOnly) return;
    const initial = readPrePreparoEtiquetasFromStore();
    setPrePreparoEtiquetas(initial);
    let cancelled = false;
    const timer = !initial.length
      ? window.setTimeout(() => {
          void (async () => {
            try {
              const db = await loadPrePreparoEtiquetasFromSupabase();
              if (!cancelled && db.length) writePrePreparoEtiquetasToStore(db);
            } catch {}
            if (!cancelled) setPrePreparoEtiquetas(readPrePreparoEtiquetasFromStore());
          })();
        }, 1600)
      : null;
    const unsub = subscribePrePreparoEtiquetas((rows) => setPrePreparoEtiquetas(rows));
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      unsub();
    };
  }, [isReadOnly]);

  useEffect(() => {
    const stored = readDesperdicioMotivosFromStore();
    const cleaned = cleanMotivosRows(stored);
    setMotivosStore(cleaned);
    if (!motivosEquivalent(stored, cleaned)) writeDesperdicioMotivosToStore(cleaned);
    return subscribeDesperdicioMotivos((rows) => {
      const next = cleanMotivosRows(rows);
      setMotivosStore(next);
      if (!motivosEquivalent(rows, next)) writeDesperdicioMotivosToStore(next);
    });
  }, []);

  useEffect(() => {
    if (!isCompatSource) return;
    if (!compatRows.length) return;
    const fromCompat: DesperdicioMotivoRow[] = [];
    const seen = new Set<string>();
    for (const r of compatRows) {
      const id = String((r as any)?.motivoId ?? "").trim();
      const nome = String((r as any)?.motivo ?? "").trim();
      if (!nome) continue;
      const key = normalizeKey(nome);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      fromCompat.push({ id: id || key, nome });
    }
    if (!fromCompat.length) return;
    setMotivosStore((prev) => {
      const merged = cleanMotivosRows([...(prev ?? []), ...fromCompat]);
      writeDesperdicioMotivosToStore(merged);
      return merged;
    });
  }, [compatRows, isCompatSource]);

  const avgUnitCostCentsByInsumoId = useMemo(() => {
    const normItemKey = (value: string) =>
      normalizeKey(String(value ?? ""))
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .replace(/\s+/g, " ");
    const idByKey = new Map<string, string>();
    for (const i of insumosStore) {
      const k = normItemKey(i.item);
      if (!k || idByKey.has(k)) continue;
      idByKey.set(k, i.id);
    }
    const fornecedorKeyLookup = new Map<string, string>();
    for (const key of Object.keys(equivalenciasMap)) {
      const nk = normItemKey(key);
      if (!nk || fornecedorKeyLookup.has(nk)) continue;
      fornecedorKeyLookup.set(nk, key);
    }
    const qtyById = new Map<string, number>();
    const centsById = new Map<string, number>();
    for (const e of entradasRows) {
      const fornecedorKey = fornecedorKeyLookup.get(normItemKey(String(e.fornecedor ?? ""))) ?? String(e.fornecedor ?? "").trim().toUpperCase();
      const equivalencias = equivalenciasMap[fornecedorKey] ?? [];
      for (const it of e.itensNota ?? []) {
        const rawKey = normItemKey(it.nome);
        let mappedKey = rawKey;
        let fator = 1;
        const eq = equivalencias.find((m) => normItemKey(m.nomeNaNota) === rawKey) ?? null;
        if (eq) {
          mappedKey = normItemKey(eq.insumoEquivalente);
          const f = parsePtNumber(String(eq.equivalenteQuantidade ?? ""));
          if (Number.isFinite(f) && f > 0) fator = f;
        }
        const id = idByKey.get(mappedKey);
        if (!id) continue;
        const qtyEq = parsePtNumber(it.quantidadeLabel ?? "") * fator;
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
  }, [entradasRows, equivalenciasMap, insumosStore]);

  useEffect(() => {
    const nameKey = draftItem.trim().toLowerCase();
    if (!nameKey) return;
    const ins = insumosStore.find((i) => i.item.toLowerCase() === nameKey) ?? null;
    if (ins) {
      const avgCents = avgUnitCostCentsByInsumoId.get(ins.id) ?? 0;
      if (avgCents > 0) {
        const raw = formatBrlFromCents(avgCents).replace(/^R\$\s?/, "").trim();
        if (raw) setDraftUnitCost(raw);
        if (ins.medida) setDraftQtyUnit(String(ins.medida).trim().toUpperCase());
        return;
      }
      const raw = String(ins.custoMedio ?? "").replace(/^R\$\s?/, "").trim();
      if (raw) setDraftUnitCost(raw);
      if (ins.medida) setDraftQtyUnit(String(ins.medida).trim().toUpperCase());
      return;
    }
    const prep = prePreparoStore.find((r) => r.receita.toLowerCase() === nameKey) ?? null;
    if (prep) {
      const unitCostLabel = String(prep.custoUnitario ?? "").trim();
      const m = unitCostLabel.match(/R\$\s*([\d.,]+)\s*\/\s*([A-Za-zÀ-ÿ]+)/i);
      if (m) {
        const v = String(m[1] ?? "").trim();
        const u = String(m[2] ?? "").trim().toUpperCase();
        if (v) setDraftUnitCost(v);
        if (u) setDraftQtyUnit(u);
      }
      return;
    }
    const ficha = fichasTecnicas.find((r) => r.receita.toLowerCase() === nameKey) ?? null;
    if (!ficha) return;
    const unitCents = parseBrlToCents(String(ficha.custoUnitario ?? ""));
    if (unitCents <= 0) return;
    const raw = formatBrlFromCents(unitCents).replace(/^R\$\s?/, "").trim();
    if (raw) setDraftUnitCost(raw);
    setDraftQtyUnit("UND");
  }, [draftItem, avgUnitCostCentsByInsumoId, fichasTecnicas, insumosStore, prePreparoStore]);

  useEffect(() => {
    let cancelled = false;
    let done = false;
    const forcedCompat = typeof window !== "undefined" && String(new URLSearchParams(window.location.search).get("source") ?? "").trim().toLowerCase() === "compat";
    if (forcedCompat) {
      setSourceMeta({ source: "compat", readOnly: true });
      setCompatRows([]);
      setRows([]);
      rowsReadyRef.current = true;
      setIsLoadingTable(false);
      return;
    }
    setRows(readDesperdiciosFromStore([]));
    rowsReadyRef.current = true;
    setIsLoadingTable(false);
    const showTimer = window.setTimeout(() => {
      if (cancelled || done) return;
      setIsLoadingTable(true);
    }, 350);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const db = await loadDesperdiciosStateFromSupabase();
          if (cancelled) return;
          if (db.meta) setSourceMeta(db.meta);
          if (db.meta?.source === "compat") {
            const wastes = (db.compat as any)?.wastes ?? [];
            setCompatRows(Array.isArray(wastes) ? (wastes as DesperdicioCompatRow[]) : []);
            setRows(db.rows ?? []);
            return;
          }
          if ((db.rows ?? [])[0]) {
            setRows(db.rows);
            return;
          }
        } catch (err) {
          if (!loadErrorShownRef.current) {
            loadErrorShownRef.current = true;
          }
        } finally {
          done = true;
          window.clearTimeout(showTimer);
          if (!cancelled) setIsLoadingTable(false);
        }
      })();
    }, 50);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearTimeout(showTimer);
    };
  }, []);

  useEffect(() => {
    if (!rowsReadyRef.current) return;
    if (isReadOnly) return;
    setMotivosStore((prev) => {
      const base = Array.isArray(prev) ? prev : [];
      const seen = new Set(base.map((m) => String(m.nome ?? "").toLowerCase()));
      const next = [...base];
      let changed = false;
      for (const r of rows) {
        const nome = normalizeMotivoOptionName(r.motivo);
        if (!nome) continue;
        const key = nome.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        changed = true;
        next.push({ id: String(Date.now() + next.length), nome });
      }
      if (changed) writeDesperdicioMotivosToStore(next);
      return changed ? next : prev;
    });
  }, [isReadOnly, rows]);

  useEffect(() => {
    if (!rowsReadyRef.current) return;
    if (isReadOnly) return;
    writeDesperdiciosToStore(rows);
  }, [isReadOnly, rows]);

  useEffect(() => {
    if (!rowsReadyRef.current) return;
    if (isReadOnly) return;
    const wasteEtiquetaIds = new Set<string>();
    for (const r of rows) {
      if (!isPrePreparoEtiquetaWasteId(r.id)) continue;
      const etiquetaId = getEtiquetaIdFromWasteId(r.id);
      if (etiquetaId) wasteEtiquetaIds.add(etiquetaId);
    }
    if (wasteEtiquetaIds.size) {
      const needs = prePreparoEtiquetas.some((e) => wasteEtiquetaIds.has(e.id) && e.wasteStatus !== "launched");
      if (needs) {
        setPrePreparoEtiquetas((prev) => {
          let changed = false;
          const next = prev.map((e) => {
            if (!wasteEtiquetaIds.has(e.id)) return e;
            if (e.wasteStatus === "launched") return e;
            changed = true;
            return { ...e, wasteStatus: "launched" as const };
          });
          if (changed) writePrePreparoEtiquetasToStore(next);
          return changed ? next : prev;
        });
        return;
      }
    }
    if (!userScopePrefix) return;
    const sync = getExpiredPrePreparoEtiquetaDesperdicioSync(rows, prePreparoEtiquetas, new Date(), userScopePrefix);
    const changed =
      sync.merged.length !== rows.length ||
      sync.merged.some((row, index) => {
        const current = rows[index];
        return !current || current.id !== row.id || current.data !== row.data || current.item !== row.item || current.quantidade !== row.quantidade || current.custo !== row.custo || current.motivo !== row.motivo;
      });
    if (!changed) return;
    setRows(sync.merged);
    etiquetasSyncRunRef.current += 1;
    const runId = etiquetasSyncRunRef.current;
    void (async () => {
      for (const row of sync.upserts) {
        if (etiquetasSyncRunRef.current !== runId) return;
        try {
          await upsertDesperdicioToSupabase(row);
        } catch (err) {
          if (!saveErrorShownRef.current) {
            saveErrorShownRef.current = true;
          }
        }
        await new Promise<void>((resolve) => window.setTimeout(resolve, 30));
      }
      for (const row of sync.deletes) {
        if (etiquetasSyncRunRef.current !== runId) return;
        try {
          await deleteDesperdicioFromSupabase(row.id);
        } catch (err) {
          if (!deleteErrorShownRef.current) {
            deleteErrorShownRef.current = true;
          }
        }
        await new Promise<void>((resolve) => window.setTimeout(resolve, 30));
      }
    })();
  }, [isCompatSource, prePreparoEtiquetas, rows, userScopePrefix]);

  useEffect(() => {
    if (!isDataCalOpen) return;
    function onDown(e: MouseEvent) {
      const el = dataCalWrapRef.current;
      const pop = dataCalPopRef.current;
      if (e.target instanceof Node && (el?.contains(e.target) || pop?.contains(e.target))) return;
      setIsDataCalOpen(false);
      setDataCalRect(null);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [isDataCalOpen]);

  useEffect(() => {
    if (!isDataCalOpen) return;
    function close() {
      setIsDataCalOpen(false);
      setDataCalRect(null);
    }
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [isDataCalOpen]);

  useEffect(() => {
    if (!isPeriodoCalOpen) return;
    function onDown(e: MouseEvent) {
      const el = periodoCalWrapRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      setIsPeriodoCalOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [isPeriodoCalOpen]);

  useEffect(() => {
    if (!editingMotivoId) return;
    setTimeout(() => editMotivoInputRef.current?.focus(), 0);
  }, [editingMotivoId]);

  function computeCalendarRect(anchor: DOMRect, popWidth = 360, popHeight = 288) {
    const minLeft = 8;
    const maxLeft = Math.max(8, window.innerWidth - 8 - popWidth);
    const centeredLeft = anchor.left + anchor.width / 2 - popWidth / 2;
    const left = Math.min(maxLeft, Math.max(minLeft, Math.round(centeredLeft)));
    const belowTop = Math.round(anchor.bottom + 6);
    const aboveTop = Math.round(anchor.top - 6 - popHeight);
    const top = belowTop + popHeight > window.innerHeight - 8 ? Math.max(8, aboveTop) : belowTop;
    return { left, top };
  }

  function normalizeUnitLabel(value: string) {
    const v = String(value ?? "").trim().toLowerCase();
    if (v === "und" || v === "un" || v === "u") return "Und";
    if (v === "kg") return "Kg";
    if (v === "g") return "g";
    if (v === "l") return "L";
    if (v === "ml") return "ml";
    return "Und";
  }

  function parsePeriodoRange(value: string) {
    const raw = value.trim();
    if (!raw) return { start: null as Date | null, end: null as Date | null };
    const parts = raw.split("-").map((x) => x.trim()).filter(Boolean);
    const start = parseDateNumericLoose(parts[0] ?? raw);
    const end = parts[1] ? parseDateNumericLoose(parts[1]) : null;
    return { start, end };
  }

  function openNew() {
    setEditingId(null);
    setEditingEtiquetaId(null);
    setDraftData(formatDateLabelLowerPT(new Date()));
    setDraftItem("");
    setDraftUnitCost("0,00");
    setDraftQty("0,000");
    setDraftQtyUnit("Und");
    setDraftMotivo("Validade Vencida");
    setIsDataCalOpen(false);
    setDataCalRect(null);
    setDataCalMonth(startOfMonth(new Date()));
    setIsFormOpen(true);
  }

  function setEtiquetaWasteStatus(etiquetaId: string, status: "pending" | "launched" | "ignored") {
    setPrePreparoEtiquetas((prev) => {
      const next = prev.map((e) => (e.id === etiquetaId ? { ...e, wasteStatus: status } : e));
      writePrePreparoEtiquetasToStore(next);
      void savePrePreparoEtiquetasToSupabase(next).catch(() => {});
      return next;
    });
  }

  function launchAllEtiquetasPendentes() {
    if (!etiquetaWasteSummary.pending.length) return;
    const ids = new Set(etiquetaWasteSummary.pending.map((e) => e.id));
    setPrePreparoEtiquetas((prev) => {
      const next = prev.map((e) => (ids.has(e.id) ? { ...e, wasteStatus: "launched" as const } : e));
      writePrePreparoEtiquetasToStore(next);
      void savePrePreparoEtiquetasToSupabase(next).catch(() => {});
      return next;
    });
  }

  function ignoreAllEtiquetasPendentes() {
    if (!etiquetaWasteSummary.pending.length) return;
    const ids = new Set(etiquetaWasteSummary.pending.map((e) => e.id));
    setPrePreparoEtiquetas((prev) => {
      const next = prev.map((e) => (ids.has(e.id) ? { ...e, wasteStatus: "ignored" as const } : e));
      writePrePreparoEtiquetasToStore(next);
      void savePrePreparoEtiquetasToSupabase(next).catch(() => {});
      return next;
    });
  }

  function openMotivosModal(targetMotivo?: string | null) {
    setNewMotivoDraft(targetMotivo ?? "");
    setEditingMotivoId(null);
    setEditingMotivoDraft("");
    setIsMotivosOpen(true);
  }

  function addMotivo() {
    const nome = newMotivoDraft.trim();
    if (!nome) return;
    const key = normalizeKey(nome);
    setMotivosStore((prev) => {
      const exists = prev.some((m) => normalizeKey(m.nome) === key);
      if (exists) return prev;
      const next = [...prev, { id: String(Date.now()), nome }];
      writeDesperdicioMotivosToStore(next);
      return next;
    });
    setDraftMotivo(nome);
    setNewMotivoDraft("");
  }

  function startEditMotivo(row: DesperdicioMotivoRow) {
    if (isProtectedMotivo(row.nome)) return;
    setEditingMotivoId(row.id);
    setEditingMotivoDraft(row.nome);
  }

  function cancelEditMotivo() {
    setEditingMotivoId(null);
    setEditingMotivoDraft("");
  }

  function confirmEditMotivo() {
    const id = editingMotivoId;
    if (!id) return;
    const nome = editingMotivoDraft.trim();
    if (!nome) return;
    const key = normalizeKey(nome);
    setMotivosStore((prev) => {
      const exists = prev.some((m) => normalizeKey(m.nome) === key && m.id !== id);
      if (exists) return prev;
      const from = prev.find((m) => m.id === id)?.nome ?? "";
      const next = prev.map((m) => (m.id === id ? { ...m, nome } : m));
      if (from && normalizeKey(from) !== normalizeKey(nome)) {
        const fromKey = normalizeKey(from);
        setRows((rprev) => rprev.map((r) => (normalizeKey(String(r.motivo ?? "")) === fromKey ? { ...r, motivo: nome } : r)));
        if (normalizeKey(draftMotivo) === fromKey) setDraftMotivo(nome);
        if (normalizeKey(motivoFilter) === fromKey) setMotivoFilter(nome);
      }
      writeDesperdicioMotivosToStore(next);
      return next;
    });
    cancelEditMotivo();
  }

  function deleteMotivo(row: DesperdicioMotivoRow) {
    if (isProtectedMotivo(row.nome)) {
      window.alert("O motivo Validade Vencida não pode ser excluído.");
      return;
    }
    const count = motivoLaunchCount(row.nome);
    if (count > 0) {
      showToast("Não é possível excluir: existem lançamentos vinculados a este motivo.", "error");
      return;
    }
    const nameKey = normalizeKey(row.nome);
    setMotivosStore((prev) => {
      const next = prev.filter((m) => m.id !== row.id);
      writeDesperdicioMotivosToStore(next);
      return next;
    });
    setRows((prev) => prev.map((r) => (normalizeKey(String(r.motivo ?? "")) === nameKey ? { ...r, motivo: "" } : r)));
    if (normalizeKey(draftMotivo) === nameKey) setDraftMotivo("");
    if (normalizeKey(motivoFilter) === nameKey) setMotivoFilter("Motivo");
    if (editingMotivoId === row.id) {
      cancelEditMotivo();
    }
  }

  function openConfirmDeleteDesperdicio(row: DesperdicioRow) {
    setConfirmType("desperdicio");
    setConfirmDesperdicio(row);
    setConfirmMotivo(null);
    setIsConfirmOpen(true);
  }

  function openConfirmDeleteMotivo(row: DesperdicioMotivoRow) {
    if (isProtectedMotivo(row.nome)) {
      window.alert("O motivo Validade Vencida não pode ser excluído.");
      return;
    }
    const count = motivoLaunchCount(row.nome);
    if (count > 0) {
      showToast("Não é possível excluir: existem lançamentos vinculados a este motivo.", "error");
      return;
    }
    setConfirmType("motivo");
    setConfirmMotivo(row);
    setConfirmDesperdicio(null);
    setIsConfirmOpen(true);
  }

  function confirmDelete() {
    if (confirmType === "desperdicio") {
      if (confirmDesperdicio) {
        if (isPrePreparoEtiquetaWasteId(confirmDesperdicio.id)) {
          const etiquetaId = getEtiquetaIdFromWasteId(confirmDesperdicio.id);
          if (etiquetaId) setEtiquetaWasteStatus(etiquetaId, "ignored");
          setRows((prev) => prev.filter((r) => r.id !== confirmDesperdicio.id));
          void deleteDesperdicioFromSupabase(confirmDesperdicio.id).catch(() => {});
        } else {
          removeRow(confirmDesperdicio);
        }
      }
    } else {
      if (confirmMotivo) deleteMotivo(confirmMotivo);
    }
    setIsConfirmOpen(false);
    setConfirmDesperdicio(null);
    setConfirmMotivo(null);
  }

  function openEdit(row: DesperdicioRow) {
    setEditingId(row.id);
    const etiquetaId = getEtiquetaIdFromWasteId(row.id);
    setEditingEtiquetaId(etiquetaId);
    setDraftData(row.data);
    setDraftItem(row.item);
    const qtyMatch = (row.quantidade ?? "").match(/([\d.,]+)\s*([A-Za-zÀ-ÿ]+)/);
    const qtyValue = qtyMatch?.[1] ?? "0,000";
    const qtyUnit = (qtyMatch?.[2] ?? "Und").trim();
    setDraftQty(formatQtyInput3(qtyValue));
    setDraftQtyUnit(normalizeUnitLabel(qtyUnit || "Und"));
    const qtyNum = parsePtNumber(qtyValue);
    const totalCents = parseBrlToCents(row.custo ?? "");
    const unitCost = qtyNum > 0 ? totalCents / 100 / qtyNum : 0;
    setDraftUnitCost(formatPtNumber(unitCost, 2));
    const motivoLabel = normalizeMotivoOptionName(row.motivo);
    setDraftMotivo(motivoLabel || "Sem motivo");
    const parsed = parseDateLabelLoose(row.data);
    setDataCalMonth(startOfMonth(parsed ?? new Date()));
    setIsDataCalOpen(false);
    setDataCalRect(null);
    setIsFormOpen(true);
  }

  function saveForm() {
    const item = draftItem.trim();
    const data = draftData.trim();
    if (!item || !data) return;
    const qtyUnit = (draftQtyUnit || "Und").trim();
    const qtyNum = parsePtNumber(draftQty);
    const quantidade = `${draftQty.trim()} ${qtyUnit}`.trim();
    const unitCostCents = parseBrlToCents(draftUnitCost);
    const totalCents = Math.max(0, Math.round(unitCostCents * Math.max(0, qtyNum)));
    const custo = formatBrlFromCents(totalCents);
    const motivo = editingEtiquetaId ? "Validade Vencida" : draftMotivo.trim() || "Sem motivo";

    if (editingEtiquetaId) {
      const parsedValidade = parseDateLabelLoose(data);
      if (!parsedValidade) return;
      const etiquetaId = editingEtiquetaId;
      setPrePreparoEtiquetas((prev) => {
        const next = prev.map((e) =>
          e.id === etiquetaId
            ? { ...e, quantidade: draftQty.trim(), unidade: qtyUnit, custo, dataValidade: formatDateLabelLowerPT(parsedValidade), wasteStatus: "launched" as const }
            : e,
        );
        writePrePreparoEtiquetasToStore(next);
        return next;
      });
      setIsFormOpen(false);
      setEditingId(null);
      setEditingEtiquetaId(null);
      setQuery("");
      return;
    }

    if (!editingId) {
      void (async () => {
        const id = await buildUserScopedId(String(Date.now()));
        const r: DesperdicioRow = { id, data, item, quantidade, custo, motivo };
        setRows((prev) => [r, ...prev]);
        void upsertDesperdicioToSupabase(r).catch((err) => {
          if (!saveErrorShownRef.current) {
            saveErrorShownRef.current = true;
          }
        });
        setIsFormOpen(false);
        setQuery("");
        setMotivoFilter("Motivo");
      })();
      return;
    }

    const id = editingId;
    setRows((prev) => prev.map((x) => (x.id === id ? { ...x, data, item, quantidade, custo, motivo } : x)));
    void upsertDesperdicioToSupabase({ id, data, item, quantidade, custo, motivo }).catch((err) => {
      if (!saveErrorShownRef.current) {
        saveErrorShownRef.current = true;
      }
    });
    setIsFormOpen(false);
    setEditingId(null);
    setEditingEtiquetaId(null);
    setQuery("");
  }

  function removeRow(row: DesperdicioRow) {
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    void deleteDesperdicioFromSupabase(row.id).catch((err) => {
      if (!deleteErrorShownRef.current) {
        deleteErrorShownRef.current = true;
      }
    });
  }

  const unitCostLabel = (row: DesperdicioRow) => {
    const qtyRaw = row.quantidade ?? "";
    const m = qtyRaw.match(/([\d.,]+)\s*([A-Za-zÀ-ÿ]+)/);
    if (!m) return "";
    const qty = parsePtNumber(m[1] ?? "");
    const unit = (m[2] ?? "").trim();
    const cents = parseBrlToCents(row.custo ?? "");
    if (!qty || qty <= 0 || !cents) return "";
    const unitValue = cents / 100 / qty;
    return `R$${formatPtNumber(unitValue, 2)} / ${unit}`;
  };

  const formTotalLabel = useMemo(() => {
    const qty = Math.max(0, parsePtNumber(draftQty));
    const unitCostCents = parseBrlToCents(draftUnitCost);
    const total = Math.max(0, Math.round(unitCostCents * qty));
    return formatBrlFromCents(total);
  }, [draftQty, draftUnitCost]);

  return (
    <>
      {toast ? <SystemToast title={toast.title} message={toast.message} tone={toast.tone} onClose={() => setToast(null)} /> : null}

      <main className={dash.content}>
        <div className={dash.pageFrame}>
          <QaModePanel screen="desperdicios" ui={qaUi} />
        <section className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.headerIcon} aria-hidden>
              <IconWaste />
            </div>
            <div className={styles.titleWrap}>
              <div className={styles.titleRow}>
                <h1 className={styles.title}>Desperdícios</h1>
                <span className={styles.badge}>NOVO</span>
              </div>
              <p className={styles.subtitle}>Aqui você cadastra e gerencia todos os insumos que vão para o lixo.</p>
            </div>
          </div>
        </section>

        {isCompatSource ? (
          <>
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

            <section className={styles.tableCard} style={{ position: "relative" }} data-qa-grid="desperdicios">
              {isLoadingTable ? (
                <div className={dash.loadingOverlay}>
                  <LoadingSpinner />
                </div>
              ) : null}

              <div className={styles.tableBodyScroll}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid #eef1f1", fontWeight: 900 }}>Data</th>
                      <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid #eef1f1", fontWeight: 900 }}>Item</th>
                      <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid #eef1f1", fontWeight: 900 }}>Quantidade</th>
                      <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid #eef1f1", fontWeight: 900 }}>Unidade</th>
                      <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid #eef1f1", fontWeight: 900 }}>Custo unitário</th>
                      <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid #eef1f1", fontWeight: 900 }}>Custo total</th>
                      <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid #eef1f1", fontWeight: 900 }}>Motivo</th>
                      <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid #eef1f1", fontWeight: 900 }}>Etiqueta</th>
                    </tr>
                  </thead>
                  <tbody data-qa-grid="desperdicios:rows">
                    {compatRows.map((r) => (
                      <tr key={r.id} data-qa-grid-row data-qa-row-id={r.id}>
                        <td style={{ padding: "10px 8px", borderBottom: "1px solid #f1f3f3", fontWeight: 700 }}>{r.data}</td>
                        <td style={{ padding: "10px 8px", borderBottom: "1px solid #f1f3f3", fontWeight: 800 }}>{r.item}</td>
                        <td style={{ padding: "10px 8px", borderBottom: "1px solid #f1f3f3", fontWeight: 700 }}>{r.quantidadeNum}</td>
                        <td style={{ padding: "10px 8px", borderBottom: "1px solid #f1f3f3", fontWeight: 700 }}>{r.unidade}</td>
                        <td style={{ padding: "10px 8px", borderBottom: "1px solid #f1f3f3", fontWeight: 700 }}>{r.custoUnitario}</td>
                        <td style={{ padding: "10px 8px", borderBottom: "1px solid #f1f3f3", fontWeight: 900 }}>{r.custoTotal}</td>
                        <td style={{ padding: "10px 8px", borderBottom: "1px solid #f1f3f3", fontWeight: 700 }}>{r.motivo}</td>
                        <td style={{ padding: "10px 8px", borderBottom: "1px solid #f1f3f3", fontWeight: 700 }}>{r.etiqueta ?? "-"}</td>
                      </tr>
                    ))}
                    {compatRows[0] ? null : (
                      <tr>
                        <td colSpan={8} style={{ padding: 18, textAlign: "center", color: "#95a8a6", fontWeight: 800 }}>
                          Sem desperdícios
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : (
          <>
        <section className={styles.toolbar}>
          <div className={styles.kpis}>
            <div className={styles.kpiCard}>
              <div className={styles.kpiIcon} aria-hidden>
                <IconMoney />
              </div>
              <div className={styles.kpiMeta}>
                <div className={styles.kpiValue}>{formatBrlFromCents(totalCents)}</div>
                <div className={styles.kpiLabel}>TOTAL EM DESPERDÍCIO</div>
              </div>
            </div>
            <div className={styles.kpiCard}>
              <div className={styles.kpiIcon} aria-hidden>
                <IconTag />
              </div>
              <div className={styles.kpiMeta}>
                <div className={styles.kpiValue}>{etiquetasVencidas}</div>
                <div className={styles.kpiLabel}>ETIQUETAS VENCIDAS</div>
              </div>
            </div>
            <div className={styles.kpiCard}>
              <div className={styles.kpiIcon} aria-hidden>
                <IconList />
              </div>
              <div className={styles.kpiMeta}>
                <div className={styles.kpiValueRow}>
                  <div className={styles.kpiValue}>{totalMotivos}</div>
                  <button type="button" className={styles.kpiLink} onClick={() => openMotivosModal(null)}>
                    Ver Motivos
                  </button>
                </div>
                <div className={styles.kpiLabel}>MOTIVOS DESPERDÍCIO</div>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.filters}>
          <div className={styles.filtersLeft}>
            <div className={styles.search}>
              <span className={styles.searchIcon} aria-hidden>
                <IconSearch />
              </span>
              <input className={styles.searchInput} placeholder="Pesquise por itens..." value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>

            <select className={styles.select} value={motivoFilter} onChange={(e) => setMotivoFilter(e.target.value)}>
              <option value="Motivo">Motivo</option>
              {motivos.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>

            <div className={styles.calendarWrap} ref={periodoCalWrapRef}>
              <div
                className={styles.period}
                onMouseDown={() => {
                  const parsed = parsePeriodoRange(periodo);
                  setPeriodoRangeStart(parsed.start);
                  setPeriodoRangeEnd(parsed.end);
                  setPeriodoCalMonth(startOfMonth(parsed.start ?? parsed.end ?? new Date()));
                  setIsPeriodoCalOpen(true);
                }}
              >
                <span className={styles.periodIcon} aria-hidden>
                  <img src="/dashboard/ml7hdudz-0yzzssc.svg" alt="" />
                </span>
                <input
                  className={styles.periodInput}
                  placeholder="Período"
                  value={periodo}
                  onChange={(e) => setPeriodo(e.target.value)}
                  onClick={() => {
                    const parsed = parsePeriodoRange(periodo);
                    setPeriodoRangeStart(parsed.start);
                    setPeriodoRangeEnd(parsed.end);
                    setPeriodoCalMonth(startOfMonth(parsed.start ?? parsed.end ?? new Date()));
                    setIsPeriodoCalOpen(true);
                  }}
                  onFocus={() => {
                    const parsed = parsePeriodoRange(periodo);
                    setPeriodoRangeStart(parsed.start);
                    setPeriodoRangeEnd(parsed.end);
                    setPeriodoCalMonth(startOfMonth(parsed.start ?? parsed.end ?? new Date()));
                    setIsPeriodoCalOpen(true);
                  }}
                />
              </div>

              {isPeriodoCalOpen ? (
                <div className={styles.calendarPopover}>
                  <div className={styles.calendarHeader}>
                    <button type="button" className={styles.calNavBtn} onClick={() => setPeriodoCalMonth((d) => addMonths(d, -1))}>
                      ‹
                    </button>
                    <div className={styles.calTitle}>
                      <span className={styles.calMonthName}>
                        {["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"][
                          periodoCalMonth.getMonth()
                        ]}
                      </span>
                      <span className={styles.calYear}>{periodoCalMonth.getFullYear()}</span>
                    </div>
                    <button type="button" className={styles.calNavBtn} onClick={() => setPeriodoCalMonth((d) => addMonths(d, 1))}>
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
                      const start = periodoRangeStart;
                      const end = periodoRangeEnd;
                      const a = start && end ? (start.getTime() <= end.getTime() ? start : end) : start;
                      const b = start && end ? (start.getTime() <= end.getTime() ? end : start) : end;
                      const aTime = a ? new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime() : null;
                      const bTime = b ? new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime() : null;
                      const monthStart = startOfMonth(periodoCalMonth);
                      const firstDow = monthStart.getDay();
                      const nextMonth = addMonths(monthStart, 1);
                      const daysInMonth = Math.round((nextMonth.getTime() - monthStart.getTime()) / 86400000);
                      const cells: JSX.Element[] = [];
                      for (let i = 0; i < firstDow; i++) {
                        cells.push(<div key={`e-${i}`} className={styles.calEmpty} />);
                      }
                      for (let day = 1; day <= daysInMonth; day++) {
                        const d = new Date(monthStart.getFullYear(), monthStart.getMonth(), day);
                        const t = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
                        const isStart = aTime !== null && t === aTime;
                        const isEnd = bTime !== null && t === bTime;
                        const isBetween = aTime !== null && bTime !== null && t > aTime && t < bTime;
                        const cls = isStart || isEnd ? `${styles.calDay} ${styles.calDayOn}` : isBetween ? `${styles.calDay} ${styles.calDayRange}` : styles.calDay;
                        cells.push(
                          <button
                            type="button"
                            key={`d-${day}`}
                            className={cls}
                            onClick={() => {
                              if (!periodoRangeStart || periodoRangeEnd) {
                                setPeriodoRangeStart(d);
                                setPeriodoRangeEnd(null);
                                setPeriodo(formatDateNumericPT(d));
                                return;
                              }
                              const startD = periodoRangeStart;
                              const min = startD.getTime() <= d.getTime() ? startD : d;
                              const max = startD.getTime() <= d.getTime() ? d : startD;
                              setPeriodoRangeStart(min);
                              setPeriodoRangeEnd(max);
                              setPeriodo(`${formatDateNumericPT(min)} - ${formatDateNumericPT(max)}`);
                              setIsPeriodoCalOpen(false);
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

          <div className={styles.filtersRight}>
            <button type="button" className={styles.primaryBtn} onClick={openNew}>
              <img src="/dashboard/ml7hdudz-6qw4osi.svg" className={styles.primaryBtnIcon} alt="" />
              Desperdício
            </button>
          </div>
        </section>

        <section className={styles.chartCard}>
          <div className={styles.chartTop}>
            <div className={styles.chartTitle}>Resumo por motivo</div>
            <div className={styles.chartTools}>
              <button type="button" className={styles.toolBtn} aria-label="Diminuir zoom" disabled>
                −
              </button>
              <button type="button" className={styles.toolBtn} aria-label="Aumentar zoom" disabled>
                +
              </button>
              <button type="button" className={styles.toolBtn} aria-label="Buscar" disabled>
                <IconSearch />
              </button>
              <button type="button" className={styles.toolBtn} aria-label="Lista" disabled>
                <IconList />
              </button>
              <button type="button" className={styles.toolBtn} aria-label="Calendário" disabled>
                <img src="/dashboard/ml7hdudz-0yzzssc.svg" alt="" />
              </button>
            </div>
          </div>

          <div className={styles.chartArea}>
            <div className={styles.yAxis}>
              {yTicks.map((v) => (
                <div key={v} className={styles.yTick}>
                  {v}
                </div>
              ))}
            </div>
            <div className={styles.plot}>
              <div className={styles.grid}>
                {yTicks.map((_, i) => (
                  <div key={i} className={styles.gridLine} />
                ))}
              </div>
              <div className={styles.plotBars}>
                {(chartData[0] ? chartData : [{ motivo: "Sem dados", cents: 0 }]).map((d) => (
                  <div key={d.motivo} className={styles.barCol}>
                    <div className={styles.bar}>
                      <div className={styles.barOn} style={{ height: `${Math.round(((d.cents / 100) / yMax) * 100)}%` }} />
                    </div>
                    <div className={styles.barLabel}>{d.motivo}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {etiquetaWasteSummary.pending.length ? (
          <section className={styles.etiquetaPrompt}>
            <div className={styles.etiquetaPromptHeading}>
              {`Você possui ${etiquetaWasteSummary.pending.length} ${
                etiquetaWasteSummary.pending.length === 1 ? "Etiqueta vencida" : "Etiquetas vencidas"
              }`}
            </div>

            <div className={styles.etiquetaPromptCards}>
              {etiquetaWasteSummary.pending.map((e) => {
                const qtyLabel = formatEtiquetaQtyLabel(e.quantidade, e.unidade);
                const item = String(e.receita ?? "").trim() || "Item";
                const badge = daysOverdueLabel(String(e.dataValidade ?? ""));
                const meta = formatEtiquetaCreatedMeta(e);
                return (
                  <div key={e.id} className={styles.etiquetaPromptCard}>
                    <div className={styles.etiquetaPromptCardTop}>
                      <div className={styles.etiquetaPromptCardTitle}>{`${qtyLabel} - ${item}`}</div>
                      <div className={styles.etiquetaPromptCardBadge}>{badge}</div>
                    </div>
                    <div className={styles.etiquetaPromptCardMeta}>{meta}</div>

                    <div className={styles.etiquetaPromptCardLines}>
                      <div className={styles.etiquetaPromptCardLine}>
                        <div className={styles.etiquetaPromptCardLabel}>Responsável:</div>
                        <div className={styles.etiquetaPromptCardValue}>{String(e.responsavel ?? "").trim() || "-"}</div>
                      </div>
                      <div className={styles.etiquetaPromptCardLine}>
                        <div className={styles.etiquetaPromptCardLabel}>Data Produção:</div>
                        <div className={styles.etiquetaPromptCardValue}>{formatDateNumericLoose(String(e.dataProducao ?? "")) || "-"}</div>
                      </div>
                      <div className={styles.etiquetaPromptCardLine}>
                        <div className={`${styles.etiquetaPromptCardLabel} ${styles.etiquetaPromptCardDanger}`}>Data de Validade</div>
                        <div className={`${styles.etiquetaPromptCardValue} ${styles.etiquetaPromptCardDanger}`}>
                          {formatDateNumericLoose(String(e.dataValidade ?? "")) || "-"}
                        </div>
                      </div>
                    </div>

                    <div className={styles.etiquetaPromptCardBottom}>
                      <div className={styles.etiquetaPromptCardQuestion}>Marcar Desperdício?</div>
                      <div className={styles.etiquetaPromptCardChoice}>
                        <button type="button" className={styles.etiquetaPromptCardYes} onClick={() => setEtiquetaWasteStatus(e.id, "launched")}>
                          <IconCheck />
                          Sim
                        </button>
                        <button type="button" className={styles.etiquetaPromptCardNo} onClick={() => setEtiquetaWasteStatus(e.id, "ignored")}>
                          <IconX />
                          Não
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        <section className={styles.tableCard} style={{ position: "relative" }} data-qa-grid="desperdicios">
          {isLoadingTable ? (
            <div className={dash.loadingOverlay}>
              <LoadingSpinner />
            </div>
          ) : null}
          <div className={styles.tableHead} style={{ gridTemplateColumns: tableGridTemplateColumns }}>
            {columnOrder.map((column) => {
              const label =
                column === "data"
                  ? "Lançamento"
                  : column === "item"
                    ? "Item"
                    : column === "quantidade"
                      ? "Qtd"
                      : column === "custo"
                        ? "Custo"
                        : "Motivo";
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
            <div style={{ textAlign: "right" }}>Ações</div>
          </div>

          <div className={styles.tableBodyScroll}>
            {!visible.length ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyTitle}>Nenhum desperdício lançado</div>
                <div className={styles.emptyText}>Clique em “Novo Lançamento” para começar.</div>
              </div>
            ) : (
              visible.map((r) => {
                const isAutoEtiqueta = isPrePreparoEtiquetaWasteId(r.id);
                return (
                  <div
                    key={r.id}
                    className={styles.row}
                    style={{ gridTemplateColumns: tableGridTemplateColumns }}
                    data-qa-grid-row
                    data-qa-row-id={r.id}
                  >
                    {columnOrder.map((column) => (
                      <div key={column} className={styles.tableCellWrap}>
                        {renderTableCell(r, column)}
                      </div>
                    ))}
                    <div className={styles.actionsCell}>
                      <button
                        type="button"
                        className={styles.iconBtn}
                        aria-label="Editar"
                        onClick={() => openEdit(r)}
                        title={isAutoEtiqueta ? "Editar etiqueta vencida" : ""}
                      >
                        <IconPencil />
                      </button>
                      <button
                        type="button"
                        className={styles.iconBtn}
                        aria-label="Excluir"
                        onClick={() => openConfirmDeleteDesperdicio(r)}
                        title={isAutoEtiqueta ? "Excluir etiqueta vencida" : ""}
                      >
                        <IconTrash />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {mounted && isFormOpen ? (
          createPortal(
          <div className={styles.modalOverlay} role="dialog" aria-modal="true">
            <div className={styles.modal}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitle}>{editingEtiquetaId ? "Editar Etiqueta Vencida" : editingId ? "Editar Desperdício" : "Novo Desperdício"}</div>
                <button
                  type="button"
                  className={styles.modalClose}
                  onClick={() => {
                    setIsFormOpen(false);
                    setEditingId(null);
                    setEditingEtiquetaId(null);
                  }}
                  aria-label="Fechar"
                >
                  ×
                </button>
              </div>

              <div className={styles.modalBody}>
                <div className={styles.field}>
                  <div className={styles.label}>Item</div>
                  <select className={styles.input} value={draftItem} onChange={(e) => setDraftItem(e.target.value)} disabled={Boolean(editingEtiquetaId)}>
                    <option value="" disabled>
                      Ex: Carne Bovina
                    </option>
                    {itemOptions.insumos.length ? (
                      <optgroup label="Insumos">
                        {itemOptions.insumos.map((s) => (
                          <option key={`insumo:${s}`} value={s}>
                            {s}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                    {itemOptions.prePreparo.length ? (
                      <optgroup label="Pré-preparo">
                        {itemOptions.prePreparo.map((s) => (
                          <option key={`prepreparo:${s}`} value={s}>
                            {s}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                    {itemOptions.fichas.length ? (
                      <optgroup label="Fichas técnicas">
                        {itemOptions.fichas.map((s) => (
                          <option key={`ficha:${s}`} value={s}>
                            {s}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                    {!itemOptions.insumos.length && !itemOptions.prePreparo.length && !itemOptions.fichas.length ? <option value="Carne Bovina">Carne Bovina</option> : null}
                  </select>
                </div>

                <div className={styles.row2}>
                  <div className={styles.field}>
                    <div className={styles.label}>Custo Unitário</div>
                    <div className={styles.inputGroup}>
                      <div className={styles.prefix}>R$</div>
                      <input
                        className={styles.groupInput}
                        value={draftUnitCost}
                        inputMode="decimal"
                        pattern="[0-9.,-]*"
                        onKeyDown={(e) => {
                          if (e.ctrlKey || e.metaKey || e.altKey) return;
                          const k = e.key;
                          if (k.length !== 1) return;
                          if (!/[0-9,.\-]/.test(k)) e.preventDefault();
                        }}
                        onChange={(e) => setDraftUnitCost(formatMoneyInput2(e.target.value))}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.currentTarget.focus();
                          e.currentTarget.select();
                        }}
                        onMouseUp={(e) => e.preventDefault()}
                        onTouchStart={(e) => {
                          e.preventDefault();
                          e.currentTarget.focus();
                          e.currentTarget.select();
                        }}
                        onFocus={(e) => {
                          const el = e.currentTarget;
                          requestAnimationFrame(() => el.select());
                        }}
                        onBlur={() => {
                          const cents = parseBrlToCents(draftUnitCost);
                          const formatted = formatBrlFromCents(cents).replace(/^R\$\s?/, "").trim();
                          if (formatted && formatted !== draftUnitCost) setDraftUnitCost(formatted);
                        }}
                        placeholder="0,00"
                      />
                    </div>
                  </div>

                  <div className={styles.field}>
                    <div className={styles.label}>Qtd. Desperdiçada</div>
                    <div className={styles.inputGroup}>
                      <input
                        className={styles.groupInput}
                        value={draftQty}
                        onChange={(e) => setDraftQty(formatQtyInput3(e.target.value))}
                        inputMode="decimal"
                        pattern="[0-9.,-]*"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.currentTarget.focus();
                          e.currentTarget.select();
                        }}
                        onMouseUp={(e) => e.preventDefault()}
                        onTouchStart={(e) => {
                          e.preventDefault();
                          e.currentTarget.focus();
                          e.currentTarget.select();
                        }}
                        onFocus={(e) => {
                          const el = e.currentTarget;
                          requestAnimationFrame(() => el.select());
                        }}
                        placeholder="0,000"
                      />
                      <select className={styles.suffixSelect} value={draftQtyUnit} onChange={(e) => setDraftQtyUnit(e.target.value)}>
                        {["Und", "Kg", "g", "L"].map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div className={styles.field}>
                  <div className={styles.labelRow}>
                    <div className={styles.label}>Motivo</div>
                    <button type="button" className={styles.addLink} onClick={() => openMotivosModal(draftMotivo || null)} disabled={Boolean(editingEtiquetaId)}>
                      ADD Motivo
                    </button>
                  </div>
                  <select className={styles.input} value={draftMotivo} onChange={(e) => setDraftMotivo(e.target.value)} disabled={Boolean(editingEtiquetaId)}>
                    {motivos.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>

                <div className={styles.field}>
                  <div className={styles.label}>{editingEtiquetaId ? "Data de Validade" : "Data de Lançamento"}</div>
                  <div className={styles.calendarWrap} ref={dataCalWrapRef}>
                    <div className={styles.inputGroup}>
                      <button
                        type="button"
                        className={styles.prefixIconBtn}
                        onClick={() => {
                          const anchor = dataCalWrapRef.current?.querySelector("input")?.getBoundingClientRect() ?? null;
                          if (anchor) setDataCalRect(computeCalendarRect(anchor));
                          const parsed = parseDateLabelLoose(draftData);
                          setDataCalMonth(startOfMonth(parsed ?? new Date()));
                          setIsDataCalOpen((v) => {
                            const next = !v;
                            if (!next) setDataCalRect(null);
                            return next;
                          });
                        }}
                        aria-label="Abrir calendário"
                      >
                        <img src="/dashboard/ml7hdudz-0yzzssc.svg" alt="" />
                      </button>
                      <input
                        className={styles.groupInput}
                        value={draftData}
                        onChange={(e) => setDraftData(e.target.value)}
                        onClick={(e) => {
                          setDataCalRect(computeCalendarRect(e.currentTarget.getBoundingClientRect()));
                          const parsed = parseDateLabelLoose(draftData);
                          setDataCalMonth(startOfMonth(parsed ?? new Date()));
                          setIsDataCalOpen(true);
                        }}
                        onFocus={(e) => {
                          setDataCalRect(computeCalendarRect(e.currentTarget.getBoundingClientRect()));
                          const parsed = parseDateLabelLoose(draftData);
                          setDataCalMonth(startOfMonth(parsed ?? new Date()));
                          setIsDataCalOpen(true);
                        }}
                        placeholder="26 mar, 2026"
                      />
                    </div>
                    {isDataCalOpen ? (
                      createPortal(
                        <div
                          ref={dataCalPopRef}
                          className={styles.calendarPopover}
                          style={dataCalRect ? { position: "fixed", left: dataCalRect.left, top: dataCalRect.top, transform: "none" } : { position: "fixed" }}
                        >
                        <div className={styles.calendarHeader}>
                          <button type="button" className={styles.calNavBtn} onClick={() => setDataCalMonth((d) => addMonths(d, -1))}>
                            ‹
                          </button>
                          <div className={styles.calTitle}>
                            <span className={styles.calMonthName}>
                              {["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"][
                                dataCalMonth.getMonth()
                              ]}
                            </span>
                            <span className={styles.calYear}>{dataCalMonth.getFullYear()}</span>
                          </div>
                          <button type="button" className={styles.calNavBtn} onClick={() => setDataCalMonth((d) => addMonths(d, 1))}>
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
                            const selected = parseDateLabelLoose(draftData);
                            const monthStart = startOfMonth(dataCalMonth);
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
                                    setDraftData(formatDateLabelLowerPT(d));
                                    setIsDataCalOpen(false);
                                    setDataCalRect(null);
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
                        </div>,
                        document.body,
                      )
                    ) : null}
                  </div>
                </div>
              </div>

              <div className={styles.modalFooter}>
                <div className={styles.footerTotal}>
                  <div className={styles.footerTotalLabel}>Total Desperdiçado:</div>
                  <div className={styles.footerTotalValue}>{formTotalLabel}</div>
                </div>
                <button type="button" className={styles.primaryBtn} onClick={saveForm} disabled={!draftItem.trim() || !draftData.trim()}>
                  Salvar
                </button>
              </div>
            </div>
          </div>,
          document.body,
          )
        ) : null}

        {mounted && isMotivosOpen ? (
          createPortal(
          <div className={styles.modalOverlay} role="dialog" aria-modal="true" onClick={() => setIsMotivosOpen(false)}>
            <div className={`${styles.modal} ${styles.motivosModal}`} onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitle}>Motivos de Desperdícios</div>
                <button type="button" className={styles.modalClose} onClick={() => setIsMotivosOpen(false)} aria-label="Fechar">
                  ×
                </button>
              </div>

              <div className={styles.motivosBody}>
                <div className={styles.field}>
                  <div className={styles.label}>Descrição do Motivo</div>
                  <div className={styles.motivosAddRow}>
                    <input
                      className={styles.motivosInput}
                      placeholder='Ex: "Falta de Uso"'
                      value={newMotivoDraft}
                      onChange={(e) => setNewMotivoDraft(e.target.value)}
                    />
                    <button type="button" className={styles.motivosAddBtn} onClick={addMotivo} disabled={!newMotivoDraft.trim()}>
                      <span aria-hidden>＋</span> ADD
                    </button>
                  </div>
                </div>

                <div className={styles.motivosDivider} />

                <div className={styles.motivosList}>
                  {(() => {
                    const cleaned = motivosStore.filter((m) => !String(m.id ?? "").startsWith("default-"));
                    const hasCustom = cleaned.some((m) => !isProtectedMotivo(m.nome));
                    if (hasCustom) return cleaned;
                    const suggested = motivos
                      .filter((n) => normalizeKey(n) !== "sem motivo" && normalizeKey(n) !== "validade vencida")
                      .map((n, i) => ({ id: `suggested-${i + 1}`, nome: n }));
                    return [{ id: "protected-validade-vencida", nome: "Validade Vencida" }, ...suggested];
                  })().map((m) => (
                    <div key={m.id} className={styles.motivosRow}>
                      {editingMotivoId === m.id ? (
                        <>
                          <input
                            ref={editMotivoInputRef}
                            className={styles.motivosEditInput}
                            value={editingMotivoDraft}
                            onChange={(e) => setEditingMotivoDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                confirmEditMotivo();
                              }
                              if (e.key === "Escape") {
                                e.preventDefault();
                                cancelEditMotivo();
                              }
                            }}
                          />
                          <button
                            type="button"
                            className={styles.motivoConfirmBtn}
                            aria-label="Confirmar edição"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={confirmEditMotivo}
                          >
                            <IconCheck />
                          </button>
                        </>
                      ) : (
                        <>
                          <div className={styles.motivosName}>{normalizeMotivoOptionName(m.nome) || "Sem motivo"}</div>
                          <div className={styles.motivosRight}>
                            <div className={styles.motivosCount}>{motivoLaunchCountLabel(motivoLaunchCount(m.nome))}</div>
                            <div className={styles.motivosActions}>
                              <button
                                type="button"
                                className={styles.iconBtn}
                                aria-label="Editar"
                                onClick={() => startEditMotivo(m)}
                                disabled={isProtectedMotivo(m.nome)}
                                title={isProtectedMotivo(m.nome) ? "Não pode editar Validade Vencida" : ""}
                              >
                                <IconPencil />
                              </button>
                              <button
                                type="button"
                                className={styles.iconBtn}
                                aria-label="Excluir"
                                onClick={() => openConfirmDeleteMotivo(m)}
                                disabled={isProtectedMotivo(m.nome) || motivoLaunchCount(m.nome) > 0}
                                title={
                                  isProtectedMotivo(m.nome)
                                    ? "Não pode excluir Validade Vencida"
                                    : motivoLaunchCount(m.nome) > 0
                                      ? "Não é possível excluir: existem lançamentos vinculados"
                                      : ""
                                }
                              >
                                <IconTrash />
                              </button>
                            </div>
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

        {mounted && isConfirmOpen ? (
          createPortal(
          <div className={styles.modalOverlay} role="dialog" aria-modal="true" onClick={() => setIsConfirmOpen(false)}>
            <div className={`${styles.modal} ${styles.confirmModal}`} onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitle}>{confirmType === "desperdicio" ? "Excluir Desperdício?" : "Excluir Motivo?"}</div>
                <button type="button" className={styles.modalClose} onClick={() => setIsConfirmOpen(false)} aria-label="Fechar">
                  ×
                </button>
              </div>

              <div className={styles.confirmBody}>
                <div className={styles.confirmIcon} aria-hidden>
                  <IconTrash />
                </div>
                <div className={styles.confirmText}>
                  {confirmType === "desperdicio" && confirmDesperdicio ? (
                    <>
                      {`Caso exclua o registro de desperdício de `}
                      <strong>{`${confirmDesperdicio.quantidade || "-"} - ${confirmDesperdicio.item}`}</strong>
                      {` não poderá recuperá-lo.`}
                    </>
                  ) : confirmMotivo ? (
                    <>
                      {`Caso exclua o motivo `}
                      <strong>{confirmMotivo.nome}</strong>
                      {` não poderá recuperá-lo.`}
                    </>
                  ) : null}
                </div>
              </div>

              <div className={styles.confirmActions}>
                <button type="button" className={styles.confirmDelete} onClick={confirmDelete}>
                  Excluir
                </button>
                <button type="button" className={styles.confirmCancel} onClick={() => setIsConfirmOpen(false)}>
                  Cancelar
                </button>
              </div>
            </div>
          </div>,
          document.body,
          )
        ) : null}
          </>
        )}
        </div>
      </main>
    </>
  );
}
