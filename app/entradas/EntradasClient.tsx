"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import dash from "../dashboard/dashboard.module.css";
import LoadingSpinner from "../components/LoadingSpinner";
import SystemToast from "../components/SystemToast";
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
  type FornecedorEquivalenciasMap,
  type FornecedorItemEquivalencia,
  type FornecedorInfoMap,
  type FornecedorInfo,
  type FornecedorProdutos,
} from "../lib/fornecedoresStore";
import { loadFornecedoresStateFromSupabase, saveFornecedoresStateToSupabase } from "../lib/fornecedoresSupabase";
import { readEntradasFromStore, writeEntradasToStore } from "../lib/entradasStore";
import {
  deleteEntradaFromSupabase,
  deleteEntradasFromSupabase,
  loadEntradasStateFromSupabase,
  loadEntradasFromSupabase,
  upsertEntradaToSupabase,
  upsertEntradasBatchToSupabase,
} from "../lib/entradasSupabase";
import { readInsumosFromStore, subscribeInsumos, writeInsumosToStore, type InsumoStoreItem } from "../lib/insumosStore";
import { loadInsumosFromSupabase } from "../lib/insumosSupabase";
import { buildUserScopedId, requireUserScopePrefix } from "../lib/userScope";
import { loadMeFromApi, readMeFromStore, subscribeMe } from "../lib/meStore";
import { QaModePanel } from "../lib/qaMode";
import { maskPhoneBR } from "../lib/masks";
import styles from "./entradas.module.css";

// #region debug-point reporter
const __DBG_SESSION_ID = "entradas-auth-hydration";
const __DBG_RUN_ID = "prod";
function __dbgSend(hypothesisId: string, location: string, msg: string, data: unknown) {
  try {
    void fetch("/api/debug/event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: __DBG_SESSION_ID, runId: __DBG_RUN_ID, hypothesisId, location, msg, data, ts: Date.now() }),
    }).catch(() => {});
  } catch {}
}
// #endregion

// #region debug-point console-hook
let __dbgConsoleHooked = false;
if (typeof window !== "undefined" && !__dbgConsoleHooked) {
  __dbgConsoleHooked = true;
  try {
    const origError = console.error.bind(console);
    const origWarn = console.warn.bind(console);
    console.error = (...args: any[]) => {
      try {
        const text = args.map((x) => (typeof x === "string" ? x : x instanceof Error ? `${x.name}: ${x.message}` : JSON.stringify(x))).join(" ");
        if (text.toLowerCase().includes("hydration") || text.includes("#425") || text.includes("#423") || text.includes("#329")) {
          __dbgSend("h3", "app/entradas/EntradasClient.tsx:console.error", "console_error", { text });
        }
      } catch {}
      origError(...args);
    };
    console.warn = (...args: any[]) => {
      try {
        const text = args.map((x) => (typeof x === "string" ? x : x instanceof Error ? `${x.name}: ${x.message}` : JSON.stringify(x))).join(" ");
        if (text.toLowerCase().includes("hydration") || text.includes("#425") || text.includes("#423") || text.includes("#329")) {
          __dbgSend("h3", "app/entradas/EntradasClient.tsx:console.warn", "console_warn", { text });
        }
      } catch {}
      origWarn(...args);
    };
  } catch {}
}
// #endregion

// #region debug-point window-error
let __dbgWindowHooked = false;
if (typeof window !== "undefined" && !__dbgWindowHooked) {
  __dbgWindowHooked = true;
  try {
    window.addEventListener("error", (e) => {
      try {
        __dbgSend("h1", "app/entradas/EntradasClient.tsx:window.error", "window_error", {
          message: (e as any)?.message ?? null,
          filename: (e as any)?.filename ?? null,
          lineno: (e as any)?.lineno ?? null,
          colno: (e as any)?.colno ?? null,
          stack: (e as any)?.error?.stack ?? null,
        });
      } catch {}
    });
    window.addEventListener("unhandledrejection", (e) => {
      try {
        const reason = (e as any)?.reason;
        __dbgSend("h2", "app/entradas/EntradasClient.tsx:window.unhandledrejection", "unhandled_rejection", {
          message: reason?.message ?? String(reason ?? ""),
          stack: reason?.stack ?? null,
        });
      } catch {}
    });
  } catch {}
}
// #endregion

type EntradaRow = {
  id: string;
  numero: string;
  dataLancamento: string;
  fornecedor: string;
  fornecedorNome?: string;
  valorNota: string;
  itens: string;
  responsavel: string;
  dataCriacao: string;
  itensNota?: NotaItem[];
};

type NotaItem = {
  id: string;
  itemId?: string;
  nome: string;
  quantidadeLabel: string;
  subtotalLabel: string;
  custoUnitarioLabel: string;
};

type FornecedorItemMap = {
  id: string;
  nomeNaNota: string;
  unidadeNaNota: string;
  insumoEquivalente: string;
  equivalenteQuantidade: string;
  equivalenteUnidade: string;
};

type EntradaTableColumn = "dataLancamento" | "fornecedor" | "valorNota" | "responsavel" | "dataCriacao";

type FornecedorSelectOption = {
  key: string;
  label: string;
};

function looksLikeUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function looksLikeBubbleId(value: string) {
  const s = String(value ?? "").trim();
  if (!s) return false;
  if (s.length < 12) return false;
  if (!/^\d/.test(s)) return false;
  return /^[0-9]+x[0-9x]+$/i.test(s);
}

function sanitizeUiLabel(value: string) {
  return String(value ?? "").replace(/[\u200B-\u200D\uFEFF\u00A0]/g, " ").trim();
}

function normalizeNotaItemName(value: unknown) {
  const raw = sanitizeUiLabel(String(value ?? ""));
  if (!raw) return "";
  const k = raw.toLowerCase();
  if (k === "false" || k === "true" || k === "null" || k === "undefined") return "";
  return raw;
}

function normalizeImportHeader(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseCsvImportLine(line: string, delimiter: string) {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === delimiter && !quoted) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

function downloadEntradaFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function resolveNotaItemDisplayName(it: unknown, insumosById: Map<string, string>) {
  const obj = it && typeof it === "object" ? (it as any) : null;
  const nomeRaw = normalizeNotaItemName(obj?.nome);
  const itemIdRaw = sanitizeUiLabel(String(obj?.itemId ?? obj?.item_id ?? obj?.insumoId ?? obj?.insumo_id ?? ""));
  const id = itemIdRaw || (looksLikeBubbleId(nomeRaw) ? nomeRaw : "");
  const resolved = id ? insumosById.get(id) ?? "" : "";
  if (resolved) return resolved;
  if (nomeRaw && !looksLikeBubbleId(nomeRaw)) return nomeRaw;
  return nomeRaw || "-";
}

function normalizeLookupKey(v: string) {
  return sanitizeUiLabel(v)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isDbKey(value: string) {
  return String(value ?? "").trim().toLowerCase().startsWith("db:");
}

function canonicalDbKey(value: string) {
  const raw = sanitizeUiLabel(value);
  if (!raw) return "";
  if (!isDbKey(raw)) return raw;
  const id = sanitizeUiLabel(raw.slice(3)).toLowerCase();
  return id ? `db:${id}` : "";
}

function resolveFornecedorKey(fornecedorRaw: string, fornecedorInfoMap: FornecedorInfoMap) {
  const raw = sanitizeUiLabel(fornecedorRaw);
  if (!raw) return "";
  const db = canonicalDbKey(raw);
  if (isDbKey(db)) return db;
  const rawNoSuffix = sanitizeUiLabel(raw.split("/")[0] ?? raw);
  const lookup = normalizeLookupKey(rawNoSuffix);
  if (lookup) {
    for (const [k, info] of Object.entries(fornecedorInfoMap)) {
      const label = sanitizeUiLabel((info as any)?.fornecedor ?? "");
      if (label && normalizeLookupKey(label) === lookup) return canonicalDbKey(k);
    }
  }
  return rawNoSuffix.toUpperCase();
}

function resolveFornecedorDisplay(fornecedorRaw: string, fornecedorInfoMap: FornecedorInfoMap) {
  const raw = sanitizeUiLabel(fornecedorRaw);
  if (!raw) return "-";
  const rawNoSuffix = sanitizeUiLabel(raw.split("/")[0] ?? raw);
  const resolvedKey = resolveFornecedorKey(rawNoSuffix, fornecedorInfoMap);
  const rawUpper = raw.toUpperCase();
  const rawNoSuffixUpper = rawNoSuffix.toUpperCase();
  let info = (resolvedKey && fornecedorInfoMap[resolvedKey]) || fornecedorInfoMap[rawUpper] || fornecedorInfoMap[rawNoSuffixUpper] || null;
  let scanKey = "";
  if (!info && isDbKey(rawNoSuffix)) {
    const target = canonicalDbKey(rawNoSuffix);
    for (const [k, v] of Object.entries(fornecedorInfoMap)) {
      if (!k) continue;
      if (canonicalDbKey(k) !== target) continue;
      info = v as any;
      scanKey = k;
      break;
    }
  }
  const labelFromState = info && typeof info === "object" ? sanitizeUiLabel((info as any).fornecedor ?? "") : "";
  if (isDbKey(rawNoSuffix) && (!labelFromState || canonicalDbKey(labelFromState) === canonicalDbKey(rawNoSuffix))) {
    const target = canonicalDbKey(rawNoSuffix);
    let best = "";
    for (const [k, v] of Object.entries(fornecedorInfoMap)) {
      if (!k) continue;
      if (canonicalDbKey(k) !== target) continue;
      const lbl = v && typeof v === "object" ? sanitizeUiLabel((v as any).fornecedor ?? "") : "";
      if (!lbl) continue;
      if (!isDbKey(lbl) && canonicalDbKey(lbl) !== target) {
        best = lbl;
        break;
      }
      if (!best) best = lbl;
    }
    if (best && !isDbKey(best) && canonicalDbKey(best) !== target) return best;
  }
  if (isDbKey(rawNoSuffix) && (!labelFromState || canonicalDbKey(labelFromState) === canonicalDbKey(rawNoSuffix))) {
    __dbgSend(
      "h4",
      "app/entradas/EntradasClient.tsx:resolveFornecedorDisplay",
      "fornecedor_display_unresolved_db",
      {
        fornecedorRaw,
        raw,
        rawNoSuffix,
        resolvedKey,
        labelFromState,
        hasDirectKey: Boolean(resolvedKey && fornecedorInfoMap[resolvedKey]),
        hasUpperKey: Boolean(fornecedorInfoMap[rawUpper] || fornecedorInfoMap[rawNoSuffixUpper]),
        scanKey,
        infoKeys: Object.keys(fornecedorInfoMap).length,
        sampleKeys: Object.keys(fornecedorInfoMap).slice(0, 8),
      },
    );
  }
  return labelFromState || rawNoSuffix || raw;
}

function resolveResponsavelDisplay(responsavelRaw: string, currentUserFullName: string, currentUserEmail: string) {
  const raw = sanitizeUiLabel(responsavelRaw);
  if (!raw) return "-";
  const name = sanitizeUiLabel(currentUserFullName);
  const email = sanitizeUiLabel(currentUserEmail);
  if (raw.includes("@")) {
    if (name && email && raw.toLowerCase() === email.toLowerCase()) return name;
    return raw;
  }
  if (looksLikeBubbleId(raw) || looksLikeUuid(raw)) {
    if (name) return name;
    if (email) return email;
  }
  return raw;
}

function IconEntrada() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path d="M8 8h8M8 12h8M8 16h6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
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

function IconCalendar() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M7 4v2M17 4v2M6 8h12M6 6h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
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

function IconPencil() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 17.3V20h2.7l9.9-9.9-2.7-2.7L4 17.3Zm16.8-10.8a.75.75 0 0 0 0-1.1l-2.2-2.2a.75.75 0 0 0-1.1 0l-1.7 1.7 3.3 3.3 1.7-1.7Z"
        fill="currentColor"
      />
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

function IconTrashOutlineBig() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 3h6l1 2h4v2H4V5h4l1-2Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M6 8h12l-1 13H7L6 8Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M10 11v7M14 11v7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function SortMark({ dir }: { dir: "asc" | "desc" }) {
  return <span>{dir === "asc" ? "^" : "v"}</span>;
}

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

function formatDateLabelPT(d: Date) {
  const day = String(d.getDate()).padStart(2, "0");
  const year = d.getFullYear();
  const month = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"][d.getMonth()];
  return `${day} ${month}, ${year}`;
}

function formatDateLabelNoCommaPT(d: Date) {
  const day = String(d.getDate()).padStart(2, "0");
  const year = d.getFullYear();
  const month = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"][d.getMonth()];
  return `${day} ${month} ${year}`;
}

function parseDateLabelLoose(value: string) {
  const raw = value.trim();
  if (!raw) return null;
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

function normalizeDateLabelPT(value: string) {
  const raw = value.trim();
  const d =
    parseDateLabelLoose(raw) ||
    (/^[A-Za-z]/.test(raw) && Number.isFinite(new Date(raw).getTime()) ? new Date(raw) : null);
  return d ? formatDateLabelPT(d) : value.trim();
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, delta: number) {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
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

function parsePtNumber(input: string) {
  const s = input.replace(/[^\d,.-]/g, "").trim();
  if (!s) return 0;
  const neg = s.includes("-");
  const cleaned = s.replace(/-/g, "");
  const normalized = cleaned.replace(/\./g, "").replace(",", ".");
  const n = Number.parseFloat(normalized);
  if (!Number.isFinite(n)) return 0;
  return neg ? -n : n;
}

function parseQtyLabel(input: string) {
  const raw = input.trim();
  if (!raw) return { qty: 0, unit: "" };
  const m = raw.match(/^([0-9.,-]+)\s*([A-Za-zÀ-ÿ]+)?$/);
  if (!m) return { qty: parsePtNumber(raw), unit: "" };
  const qty = parsePtNumber(m[1] ?? "");
  const unit = String(m[2] ?? "").trim();
  return { qty, unit };
}

function formatMaskedPtInput(value: string, decimals: number) {
  const n = parsePtNumber(value);
  return formatPtNumber(n, decimals);
}

function selectAllSoon(el: HTMLInputElement) {
  window.setTimeout(() => {
    try {
      el.setSelectionRange(0, el.value.length);
    } catch {}
  }, 0);
}

function formatPtNumber(value: number, decimals: number) {
  const neg = value < 0;
  const v = Math.abs(value);
  const fixed = v.toFixed(decimals);
  const [intRaw, decRaw] = fixed.split(".");
  const intLabel = String(intRaw ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const dec = String(decRaw ?? "").padEnd(decimals, "0").slice(0, decimals);
  return `${neg ? "-" : ""}${intLabel},${dec}`;
}

function formatBrlFromCents(cents: number) {
  const v = Math.abs(cents);
  const intPart = Math.floor(v / 100);
  const dec = String(v % 100).padStart(2, "0");
  const intLabel = String(intPart).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${cents < 0 ? "-" : ""}R$${intLabel},${dec}`;
}

function IconTruck() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M3 7h11v10H3V7Zm11 3h4l3 3v4h-7v-7Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M7 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm12 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" fill="currentColor" opacity="0.15" />
      <path
        d="M7 19h.01M19 19h.01"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
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

function IconPlusCircle() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export default function EntradasClient() {
  const [isLoadingTable, setIsLoadingTable] = useState(true);
  const [sourceMeta, setSourceMeta] = useState<{ source: "legacy" | "compat"; readOnly: boolean }>({ source: "legacy", readOnly: false });
  const [query, setQuery] = useState("");
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [columnOrder, setColumnOrder] = useState<EntradaTableColumn[]>(["dataLancamento", "fornecedor", "valorNota", "responsavel", "dataCriacao"]);
  const [draggingColumn, setDraggingColumn] = useState<EntradaTableColumn | null>(null);
  const [sortKey, setSortKey] = useState<EntradaTableColumn | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [isPeriodCalendarOpen, setIsPeriodCalendarOpen] = useState(false);
  const [periodPicking, setPeriodPicking] = useState<"start" | "end">("start");
  const [periodMonth, setPeriodMonth] = useState(() => startOfMonth(new Date()));
  const periodWrapRef = useRef<HTMLDivElement | null>(null);
  const [rows, setRows] = useState<EntradaRow[]>([]);
  const rowsReadyRef = useRef(false);
  const [customFornecedores, setCustomFornecedores] = useState<string[]>([]);
  const [toast, setToast] = useState<{ title: string; message: string; tone: "success" | "error" } | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftFornecedor, setDraftFornecedor] = useState("");
  const [draftDataLancamento, setDraftDataLancamento] = useState("");
  const [isEditCalendarOpen, setIsEditCalendarOpen] = useState(false);
  const [editMonth, setEditMonth] = useState(() => startOfMonth(new Date()));
  const editWrapRef = useRef<HTMLDivElement | null>(null);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingDate, setDeletingDate] = useState<string>("");
  const [bulkDeleteMode, setBulkDeleteMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false);
  const [isNewOpen, setIsNewOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number; stage: string } | null>(null);
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const [newFornecedor, setNewFornecedor] = useState("");
  const [newDataReceb, setNewDataReceb] = useState(() => formatDateLabelPT(new Date()));
  const [isRecebCalendarOpen, setIsRecebCalendarOpen] = useState(false);
  const [recebMonth, setRecebMonth] = useState(() => startOfMonth(new Date()));
  const recebWrapRef = useRef<HTMLDivElement | null>(null);
  const [isCreatingNota, setIsCreatingNota] = useState(false);
  const [isAddFornecedorOpen, setIsAddFornecedorOpen] = useState(false);
  const [addFornecedorName, setAddFornecedorName] = useState("");
  const [addFornecedorVendedor, setAddFornecedorVendedor] = useState("");
  const [addFornecedorWhatsapp, setAddFornecedorWhatsapp] = useState("");
  const [addFornecedorEndereco, setAddFornecedorEndereco] = useState("");
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [detailItemName, setDetailItemName] = useState("");
  const [detailQty, setDetailQty] = useState("0,000");
  const [detailUnit, setDetailUnit] = useState("Und");
  const [detailSubtotal, setDetailSubtotal] = useState("0,00");
  const [detailUnitCost, setDetailUnitCost] = useState("0,000");
  const [isItemMenuOpen, setIsItemMenuOpen] = useState(false);
  const itemMenuRef = useRef<HTMLDivElement | null>(null);
  const [fornecedorItemMap, setFornecedorItemMap] = useState<FornecedorEquivalenciasMap>({});
  const [isAddFornecedorItemOpen, setIsAddFornecedorItemOpen] = useState(false);
  const [mapNomeNota, setMapNomeNota] = useState("");
  const [mapUnidadeNota, setMapUnidadeNota] = useState("Und");
  const [mapInsumoEq, setMapInsumoEq] = useState("");
  const [mapEqQtd, setMapEqQtd] = useState("");
  const [insumosStore, setInsumosStore] = useState<InsumoStoreItem[]>([]);
  const [fornecedorInfoMap, setFornecedorInfoMap] = useState<FornecedorInfoMap>({});
  const [fornecedorProdutosMap, setFornecedorProdutosMap] = useState<FornecedorProdutos>({});
  const [fornecedorDbLabelCache, setFornecedorDbLabelCache] = useState<Record<string, string>>({});
  const fornecedorDbLabelInFlightRef = useRef<Set<string>>(new Set());
  const [isFornecedorProdutosOpen, setIsFornecedorProdutosOpen] = useState(false);
  const [fornecedorModalKey, setFornecedorModalKey] = useState<string | null>(null);
  const [fornecedorModalLabel, setFornecedorModalLabel] = useState<string>("");
  const [fornecedorProdutosSearch, setFornecedorProdutosSearch] = useState("");
  const [fornecedorProdutosPick, setFornecedorProdutosPick] = useState("");
  const fornecedoresReadyRef = useRef(false);
  const fornecedoresSyncTimeoutRef = useRef<number | null>(null);
  const fornecedoresLoadErrorShownRef = useRef(false);
  const fornecedoresSaveErrorShownRef = useRef(false);
  const [isMounted, setIsMounted] = useState(false);
  const [currentUserEmail, setCurrentUserEmail] = useState("");
  const [currentUserFullName, setCurrentUserFullName] = useState("");
  const [companyId, setCompanyId] = useState("");
  const isReadOnly = Boolean(sourceMeta.readOnly);
  const isCompatSource = sourceMeta.source === "compat";
  const authReady = Boolean(currentUserEmail);
  const dbgAuthOnceRef = useRef(false);
  const dbgGateOnceRef = useRef(false);

  useEffect(() => {
    if (!isReadOnly) return;
    setBulkDeleteMode(false);
    setSelectedIds({});
    setIsBulkDeleteOpen(false);
  }, [isReadOnly]);

  function showToast(message: string, type: "success" | "error", durationMs = 6000) {
    setToast({ title: type === "success" ? "Sucesso" : "Erro", message, tone: type });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, durationMs);
  }

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    const applyFromStore = () => {
      const me = readMeFromStore();
      const email = String(me?.email ?? "").trim();
      const fullName = String(me?.nomeCompleto ?? "").trim() || `${String(me?.nome ?? "").trim()} ${String(me?.sobrenome ?? "").trim()}`.trim();
      const cid = String((me as any)?.companyId ?? "").trim();
      setCurrentUserEmail(email);
      setCurrentUserFullName(fullName);
      setCompanyId(cid);
      if (!dbgAuthOnceRef.current) {
        dbgAuthOnceRef.current = true;
        __dbgSend("h1", "app/entradas/EntradasClient.tsx:meStore", "me_store_snapshot", {
          email: email || null,
          fullName: fullName || null,
          companyId: cid || null,
          hasMe: Boolean(me),
          keys: me ? Object.keys(me as any).slice(0, 30) : [],
        });
      }
    };
    applyFromStore();
    void loadMeFromApi()
      .catch((err) => {
        __dbgSend("h2", "app/entradas/EntradasClient.tsx:loadMeFromApi", "load_me_error", { message: err instanceof Error ? err.message : String(err ?? "") });
      })
      .finally(() => {
        dbgAuthOnceRef.current = false;
        applyFromStore();
      });
    return subscribeMe(() => applyFromStore());
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const start = parseDateLabelLoose(dateStart);
    const end = parseDateLabelLoose(dateEnd);
    const filtered = rows.filter((r) => {
      const fornLabel = displayFornecedorRow(r);
      if (q && !fornLabel.toLowerCase().includes(q)) return false;
      if (!start && !end) return true;
      const d = parseDateLabelLoose(r.dataLancamento);
      if (!d) return true;
      if (start && d.getTime() < start.getTime()) return false;
      if (end && d.getTime() > end.getTime()) return false;
      return true;
    });
    if (!sortKey) return filtered;
    const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });
    const direction = sortDir === "asc" ? 1 : -1;
    const decorated = filtered.map((row, index) => ({ row, index }));
    decorated.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "dataLancamento":
        case "dataCriacao": {
          const aTime = parseDateLabelLoose(a.row[sortKey])?.getTime() ?? 0;
          const bTime = parseDateLabelLoose(b.row[sortKey])?.getTime() ?? 0;
          cmp = aTime - bTime;
          break;
        }
        case "fornecedor":
          cmp = collator.compare(displayFornecedorRow(a.row), displayFornecedorRow(b.row));
          break;
        case "responsavel":
          cmp = collator.compare(
            resolveResponsavelDisplay(a.row.responsavel, currentUserFullName, currentUserEmail),
            resolveResponsavelDisplay(b.row.responsavel, currentUserFullName, currentUserEmail),
          );
          break;
        case "valorNota":
          cmp = parseBrlToCents(a.row.valorNota) - parseBrlToCents(b.row.valorNota);
          break;
      }
      if (!cmp) cmp = a.index - b.index;
      return cmp * direction;
    });
    return decorated.map(({ row }) => row);
  }, [currentUserEmail, currentUserFullName, dateEnd, dateStart, fornecedorDbLabelCache, fornecedorInfoMap, query, rows, sortDir, sortKey]);
  const canRender = Boolean(isMounted && authReady);
  if (!canRender && isMounted && !dbgGateOnceRef.current) {
    dbgGateOnceRef.current = true;
    __dbgSend("h1", "app/entradas/EntradasClient.tsx:gate", "auth_gate_blocked", {
      isMounted,
      authReady,
      companyId: companyId || null,
      email: currentUserEmail || null,
      fullName: currentUserFullName || null,
      pathname: typeof window !== "undefined" ? window.location.pathname : null,
      host: typeof window !== "undefined" ? window.location.host : null,
    });
  }

  const pagination = usePagination({
    items: visible,
    pageSize: 20,
    resetKey: `${query}|${dateStart}|${dateEnd}|${sortKey}|${sortDir}|${rows.length}`,
  });

  const tableLoading = useCappedLoading(isLoadingTable);

  useEffect(() => {
    if (!bulkDeleteMode) return;
    setSelectedIds({});
    setIsBulkDeleteOpen(false);
  }, [bulkDeleteMode, query, dateStart, dateEnd, sortKey, sortDir]);

  function displayFornecedor(raw: string) {
    const dbKey = canonicalDbKey(raw);
    const cached = dbKey && isDbKey(dbKey) ? String(fornecedorDbLabelCache[dbKey] ?? "").trim() : "";
    return cached || resolveFornecedorDisplay(raw, fornecedorInfoMap);
  }

  function displayFornecedorRow(row: { fornecedor: string; fornecedorNome?: string }) {
    const override = sanitizeUiLabel(String((row as any)?.fornecedorNome ?? ""));
    if (override && !isDbKey(canonicalDbKey(override))) return override;
    return displayFornecedor(row.fornecedor);
  }

  useEffect(() => {
    if (!isMounted) return;
    const missing: string[] = [];
    for (const r of rows) {
      const raw = sanitizeUiLabel(r?.fornecedor ?? "");
      if (!raw) continue;
      const key = canonicalDbKey(raw);
      if (!key || !isDbKey(key)) continue;
      if (fornecedorDbLabelCache[key]) continue;
      const current = resolveFornecedorDisplay(raw, fornecedorInfoMap);
      if (isDbKey(current)) missing.push(key);
    }
    const unique = Array.from(new Set(missing));
    const pick = unique.filter((k) => !fornecedorDbLabelInFlightRef.current.has(k)).slice(0, 5);
    if (!pick.length) return;
    for (const k of pick) {
      fornecedorDbLabelInFlightRef.current.add(k);
      __dbgSend("h3", "app/entradas/EntradasClient.tsx:fornecedorDbLabel:fetch", "fornecedor_label_fetch_start", { key: k });
      void fetch(`/api/fornecedores?diag=1&fornecedorLabel=${encodeURIComponent(k)}`)
        .then(async (r) => {
          const status = r.status;
          const payload = await r.json().catch(() => null);
          return { status, payload };
        })
        .then(({ status, payload }) => {
          const diagResolved = payload && typeof payload === "object" ? String((payload as any)?.diag?.fornecedorResolvedKey ?? "") : "";
          const diagLabel = payload && typeof payload === "object" ? sanitizeUiLabel(String((payload as any)?.diag?.fornecedorResolvedLabel ?? "")) : "";
          const row = payload && typeof payload === "object" ? (payload as any).row : null;
          const infoMap = row && typeof row === "object" ? (row as any).info : null;

          let direct: any = null;
          if (infoMap && typeof infoMap === "object") {
            const candidates = [diagResolved, k, k.toUpperCase()].map((x) => String(x ?? "").trim()).filter(Boolean);
            for (const c of candidates) {
              direct = (infoMap as any)[c];
              if (direct) break;
            }
            if (!direct) {
              const target = canonicalDbKey(k);
              for (const [kk, vv] of Object.entries(infoMap as any)) {
                if (canonicalDbKey(kk) !== target) continue;
                direct = vv;
                break;
              }
            }
          }

          const labelFromDiag = diagLabel && !isDbKey(canonicalDbKey(diagLabel)) ? diagLabel : "";
          const labelFromInfo = direct && typeof direct === "object" ? sanitizeUiLabel(String((direct as any).fornecedor ?? "")) : "";
          const label = labelFromDiag || labelFromInfo;
          __dbgSend("h4", "app/entradas/EntradasClient.tsx:fornecedorDbLabel:fetch", "fornecedor_label_fetch_result", {
            key: k,
            status,
            diagResolved: diagResolved || null,
            hasRow: Boolean(row),
            hasInfo: Boolean(infoMap && typeof infoMap === "object"),
            label: label || null,
          });
          if (!label) return;
          if (isDbKey(canonicalDbKey(label))) return;
          setFornecedorDbLabelCache((prev) => (prev[k] ? prev : { ...prev, [k]: label }));
        })
        .finally(() => {
          fornecedorDbLabelInFlightRef.current.delete(k);
        });
    }
  }, [fornecedorDbLabelCache, fornecedorInfoMap, isMounted, rows]);

  const visibleIdSet = useMemo(() => new Set(pagination.pageItems.map((r) => r.id)), [pagination.pageItems]);
  const selectedList = useMemo(() => {
    const ids = Object.keys(selectedIds).filter((id) => Boolean(selectedIds[id]));
    return ids.filter((id) => visibleIdSet.has(id));
  }, [selectedIds, visibleIdSet]);
  const selectedCount = selectedList.length;
  const allVisibleSelected = pagination.pageItems.length > 0 && pagination.pageItems.every((row) => Boolean(selectedIds[row.id]));

  const qaUi = useMemo(() => {
    return {
      meta: sourceMeta,
      filters: { query, dateStart, dateEnd },
      sort: { sortKey, sortDir, columnOrder },
      rendered: {
        rowsCount: pagination.pageItems.length,
        totalRowsCount: pagination.totalItems,
        rows: pagination.pageItems.map((r) => ({
          id: r.id,
          numero: r.numero,
          dataLancamento: r.dataLancamento,
          fornecedor: displayFornecedorRow(r),
          valorNota: r.valorNota,
          responsavel: resolveResponsavelDisplay(r.responsavel, currentUserFullName, currentUserEmail),
          dataCriacao: r.dataCriacao,
          itens: r.itens,
        })),
      },
      details: pagination.pageItems.map((r) => ({
        id: r.id,
        numero: r.numero,
        itensNota: (r.itensNota ?? []).map((it) => ({
          id: it.id,
          itemId: (it as any)?.itemId ?? undefined,
          nome: it.nome,
          quantidadeLabel: it.quantidadeLabel,
          custoUnitarioLabel: it.custoUnitarioLabel,
          subtotalLabel: it.subtotalLabel,
          unidade: (it as any)?.unidade ?? undefined,
          ocultarCmv: Boolean((it as any)?.ocultarCmv),
        })),
      })),
    };
  }, [
    columnOrder,
    currentUserEmail,
    currentUserFullName,
    dateEnd,
    dateStart,
    fornecedorDbLabelCache,
    fornecedorInfoMap,
    pagination.pageItems,
    pagination.totalItems,
    query,
    sortDir,
    sortKey,
    sourceMeta,
  ]);

  function toggleSort(key: EntradaTableColumn) {
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

  function onColumnDrop(target: EntradaTableColumn) {
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
    const widths: Record<EntradaTableColumn | "acoes" | "select", string> = {
      select: "44px",
      dataLancamento: "220px",
      fornecedor: "minmax(220px, 1fr)",
      valorNota: "160px",
      responsavel: "220px",
      dataCriacao: "160px",
      acoes: "110px",
    };
    const orderedColumns: Array<EntradaTableColumn | "acoes" | "select"> = bulkDeleteMode ? ["select", ...columnOrder, "acoes"] : [...columnOrder, "acoes"];
    return orderedColumns.map((column) => widths[column]).join(" ");
  }, [bulkDeleteMode, columnOrder]);

  function renderCell(row: EntradaRow, column: EntradaTableColumn) {
    if (column === "dataLancamento") {
      return (
        <div className={styles.tdDate}>
          <div className={styles.rowIcon}>
            <IconEntrada />
          </div>
          <div className={styles.td}>{row.dataLancamento}</div>
        </div>
      );
    }
    if (column === "valorNota") {
      return (
        <div className={styles.tdValue}>
          <div className={styles.valueTop}>{row.valorNota}</div>
          <div className={styles.valueSub}>{row.itens}</div>
        </div>
      );
    }
    if (column === "fornecedor") {
      return <div className={styles.td}>{displayFornecedorRow(row)}</div>;
    }
    if (column === "responsavel") {
      return <div className={styles.tdStrong}>{resolveResponsavelDisplay(row.responsavel, currentUserFullName, currentUserEmail)}</div>;
    }
    if (column === "dataCriacao") {
      return <div className={styles.tdStrong}>{row.dataCriacao}</div>;
    }
    return <div className={styles.td}>{row[column]}</div>;
  }

  function toggleSelectAllVisible() {
    if (isReadOnly) {
      showToast("Modo somente leitura.", "error");
      return;
    }
    setSelectedIds((prev) => {
      const next: Record<string, boolean> = { ...prev };
      if (allVisibleSelected) {
        for (const row of pagination.pageItems) delete next[row.id];
      } else {
        for (const row of pagination.pageItems) next[row.id] = true;
      }
      return next;
    });
  }

  function toggleRowSelected(id: string) {
    if (isReadOnly) {
      showToast("Modo somente leitura.", "error");
      return;
    }
    setSelectedIds((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = true;
      return next;
    });
  }

  function confirmBulkDelete() {
    if (isReadOnly) {
      showToast("Modo somente leitura.", "error");
      return;
    }
    if (!selectedList.length) return;
    const ids = [...selectedList];
    setRows((prev) => prev.filter((r) => !ids.includes(r.id)));
    setSelectedIds({});
    setIsBulkDeleteOpen(false);
    setBulkDeleteMode(false);
    showToast(ids.length === 1 ? "Nota excluída!" : "Notas excluídas!", "success");
    void deleteEntradasFromSupabase(ids).catch((err) => {
      showToast(err instanceof Error ? err.message : "Falha ao excluir notas.", "error");
    });
  }

  const detailsRow = useMemo(() => {
    if (!detailsId) return null;
    return rows.find((r) => r.id === detailsId) ?? null;
  }, [detailsId, rows]);

  const insumosByName = useMemo(() => {
    const map = new Map<string, InsumoStoreItem>();
    for (const i of insumosStore) map.set(i.item.toLowerCase(), i);
    return map;
  }, [insumosStore]);

  const insumosById = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of insumosStore) map.set(String(i.id ?? "").trim(), String(i.item ?? "").trim());
    return map;
  }, [insumosStore]);

  const fornecedorItensNaNota = useMemo(() => {
    const fornecedorRaw = (detailsRow?.fornecedor ?? "").trim();
    const fornecedorKey = fornecedorRaw ? resolveFornecedorKey(fornecedorRaw, fornecedorInfoMap) : "";
    if (!fornecedorKey) return [];
    const out = (fornecedorItemMap[fornecedorKey] ?? []).filter((m) => Boolean(normalizeNotaItemName(m.nomeNaNota)));
    if (!out.length && fornecedorRaw) {
      __dbgSend(
        "h1",
        "app/entradas/EntradasClient.tsx:fornecedorItensNaNota",
        "fornecedor_item_map_empty",
        {
          fornecedorRaw,
          fornecedorKey,
          fornecedorKeyUpper: fornecedorRaw.toUpperCase(),
          hasInfoKey: Boolean(fornecedorInfoMap[fornecedorKey]),
          infoKeys: Object.keys(fornecedorInfoMap).length,
          eqKeys: Object.keys(fornecedorItemMap).length,
          eqLenByKey: (fornecedorItemMap as any)[fornecedorKey]?.length ?? 0,
          eqLenByUpper: (fornecedorItemMap as any)[fornecedorRaw.toUpperCase()]?.length ?? 0,
        },
      );
    }
    return out;
  }, [detailsRow?.fornecedor, fornecedorInfoMap, fornecedorItemMap]);

  const fornecedorProdutos = useMemo(() => {
    const fornecedorRaw = (detailsRow?.fornecedor ?? "").trim();
    const fornecedorKey = fornecedorRaw ? resolveFornecedorKey(fornecedorRaw, fornecedorInfoMap) : "";
    if (!fornecedorKey) return [];
    const out = (fornecedorProdutosMap[fornecedorKey] ?? []).map((p) => normalizeNotaItemName(p)).filter(Boolean);
    if (!out.length && fornecedorRaw) {
      const lookup = normalizeLookupKey(displayFornecedor(fornecedorRaw));
      const candidates = lookup
        ? Object.entries(fornecedorInfoMap)
            .filter(([, info]) => normalizeLookupKey(String((info as any)?.fornecedor ?? "")) === lookup)
            .map(([k]) => k)
            .slice(0, 12)
        : [];
      __dbgSend(
        "h2",
        "app/entradas/EntradasClient.tsx:fornecedorProdutos",
        "fornecedor_produtos_map_empty",
        {
          fornecedorRaw,
          fornecedorKey,
          fornecedorKeyUpper: fornecedorRaw.toUpperCase(),
          display: displayFornecedor(fornecedorRaw),
          candidates,
          hasInfoKey: Boolean(fornecedorInfoMap[fornecedorKey]),
          produtosKeys: Object.keys(fornecedorProdutosMap).length,
          produtosLenByKey: (fornecedorProdutosMap as any)[fornecedorKey]?.length ?? 0,
          produtosLenByUpper: (fornecedorProdutosMap as any)[fornecedorRaw.toUpperCase()]?.length ?? 0,
        },
      );
    }
    return out;
  }, [detailsRow?.fornecedor, fornecedorInfoMap, fornecedorProdutosMap]);

  const fornecedorProdutosMerged = useMemo(() => {
    const set = new Set<string>();
    const out: string[] = [];
    for (const p of fornecedorProdutos) {
      const name = normalizeNotaItemName(p);
      if (!name) continue;
      const k = name.toLowerCase();
      if (set.has(k)) continue;
      set.add(k);
      out.push(name);
    }
    for (const m of fornecedorItensNaNota) {
      const name = normalizeNotaItemName(m.nomeNaNota);
      if (!name) continue;
      const k = name.toLowerCase();
      if (set.has(k)) continue;
      set.add(k);
      out.push(name);
    }
    return out;
  }, [fornecedorItensNaNota, fornecedorProdutos]);

  const fornecedorModalProdutosMerged = useMemo(() => {
    const keyRaw = (fornecedorModalKey ?? "").trim();
    const key = keyRaw ? resolveFornecedorKey(keyRaw, fornecedorInfoMap) : "";
    if (!key) return [];
    const set = new Set<string>();
    const out: string[] = [];
    for (const p of fornecedorProdutosMap[key] ?? []) {
      const name = normalizeNotaItemName(p);
      if (!name) continue;
      const k = name.toLowerCase();
      if (set.has(k)) continue;
      set.add(k);
      out.push(name);
    }
    for (const m of fornecedorItemMap[key] ?? []) {
      const name = normalizeNotaItemName(m.nomeNaNota);
      if (!name) continue;
      const k = name.toLowerCase();
      if (set.has(k)) continue;
      set.add(k);
      out.push(name);
    }
    return out;
  }, [fornecedorInfoMap, fornecedorItemMap, fornecedorModalKey, fornecedorProdutosMap]);

  const filteredNotaItems = useMemo(() => {
    const list = fornecedorItensNaNota;
    const q = detailItemName.trim().toLowerCase();
    if (!q) return list.slice(0, 6);
    return list.filter((m) => m.nomeNaNota.toLowerCase().includes(q)).slice(0, 6);
  }, [detailItemName, fornecedorItensNaNota]);

  const filteredFornecedorProdutos = useMemo(() => {
    const list = fornecedorProdutos;
    const q = detailItemName.trim().toLowerCase();
    if (!q) return list.slice(0, 6);
    return list.filter((n) => n.toLowerCase().includes(q)).slice(0, 6);
  }, [detailItemName, fornecedorProdutos]);

  const canAddNotaItem = useMemo(() => {
    if (!normalizeNotaItemName(detailItemName)) return false;
    const qty = parsePtNumber(detailQty);
    if (!Number.isFinite(qty) || qty <= 0) return false;
    const subtotalCents = parseBrlToCents(detailSubtotal);
    if (!Number.isFinite(subtotalCents) || subtotalCents <= 0) return false;
    return true;
  }, [detailItemName, detailQty, detailSubtotal]);

  const fornecedorOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: FornecedorSelectOption[] = [];

    for (const [k, info] of Object.entries(fornecedorInfoMap)) {
      const key = canonicalDbKey(k);
      const label = sanitizeUiLabel(String((info as any)?.fornecedor ?? "")) || sanitizeUiLabel(k);
      if (!key || !label) continue;
      const skey = key.toLowerCase();
      if (seen.has(skey)) continue;
      seen.add(skey);
      out.push({ key, label });
    }

    for (const r of rows) {
      const raw = String((r as any)?.fornecedor ?? "").trim();
      if (!raw) continue;
      const key = resolveFornecedorKey(raw, fornecedorInfoMap);
      const label = displayFornecedor(raw);
      if (!key || !label) continue;
      const skey = key.toLowerCase();
      if (seen.has(skey)) continue;
      seen.add(skey);
      out.push({ key, label });
    }

    for (const v of customFornecedores) {
      const raw = v.trim();
      if (!raw) continue;
      const key = resolveFornecedorKey(raw, fornecedorInfoMap);
      const label = raw;
      if (!key || !label) continue;
      const skey = key.toLowerCase();
      if (seen.has(skey)) continue;
      seen.add(skey);
      out.push({ key, label });
    }

    return out;
  }, [customFornecedores, fornecedorDbLabelCache, fornecedorInfoMap, rows]);

  function downloadEntradasTemplateCsv() {
    const headers = ["Número da Nota", "Data de Lançamento", "Fornecedor", "Responsável", "Data de Criação", "Item", "Quantidade", "Unidade", "Subtotal"];
    const example = ["NF-1001", "27/07/2026", "Fornecedor Exemplo", "Nome do responsável", "27/07/2026", "Farinha de Trigo", "10,000", "Kg", "389,00"];
    const csv = `\uFEFF${[headers, example].map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(";")).join("\n")}`;
    downloadEntradaFile(new Blob([csv], { type: "text/csv;charset=utf-8" }), "modelo-planilha-entradas.csv");
  }

  async function downloadEntradasTemplateXlsx() {
    const XLSX = await import("xlsx");
    const data = [
      ["Número da Nota", "Data de Lançamento", "Fornecedor", "Responsável", "Data de Criação", "Item", "Quantidade", "Unidade", "Subtotal"],
      ["NF-1001", "27/07/2026", "Fornecedor Exemplo", "Nome do responsável", "27/07/2026", "Farinha de Trigo", "10,000", "Kg", "389,00"],
      ["NF-1001", "27/07/2026", "Fornecedor Exemplo", "Nome do responsável", "27/07/2026", "Muçarela", "5,000", "Kg", "171,70"],
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    (ws as any)["!cols"] = [{ wch: 18 }, { wch: 20 }, { wch: 28 }, { wch: 24 }, { wch: 18 }, { wch: 32 }, { wch: 14 }, { wch: 12 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Entradas");
    const output = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    downloadEntradaFile(new Blob([output], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "modelo-planilha-entradas.xlsx");
  }

  async function importEntradasFile() {
    if (isImporting) return;
    if (!importFile) {
      importFileRef.current?.click();
      return;
    }
    setIsImporting(true);
    setImportProgress({ current: 0, total: 0, stage: "Lendo a planilha..." });
    try {
      let table: unknown[][] = [];
      const lower = importFile.name.toLowerCase();
      if (lower.endsWith(".csv")) {
        const text = await importFile.text();
        const lines = text.split(/\r?\n/).filter((line) => line.trim());
        const first = lines[0] ?? "";
        const delimiter = (first.match(/;/g)?.length ?? 0) >= (first.match(/,/g)?.length ?? 0) ? ";" : ",";
        table = lines.map((line) => parseCsvImportLine(line, delimiter));
      } else if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
        const XLSX = await import("xlsx");
        const workbook = XLSX.read(await importFile.arrayBuffer(), { type: "array", cellDates: true });
        const sheet = workbook.Sheets[workbook.SheetNames[0] ?? ""];
        if (!sheet) throw new Error("Planilha inválida.");
        table = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, dateNF: "dd/mm/yyyy" }) as unknown[][];
      } else {
        throw new Error("Formato não suportado. Use .xlsx, .xls ou .csv.");
      }
      if (table.length < 2) throw new Error("A planilha não possui linhas para importar.");

      const headers = (table[0] ?? []).map(normalizeImportHeader);
      const find = (...names: string[]) => headers.findIndex((header) => names.includes(header));
      const findFirstAvailable = (...names: string[]) => {
        for (const name of names) {
          const position = headers.indexOf(name);
          if (position >= 0) return position;
        }
        return -1;
      };
      const isNativeBubbleExport = headers.includes("nota_id_custom_notas_fiscais");
      const index = {
        numero: find(
          "numero_da_nota",
          "numero_nota",
          "numero",
          "nota",
          "nota_id",
          "nota_id_custom_notas_fiscais",
          "codigo",
          "nf",
        ),
        data: find(
          "data_de_lancamento",
          "data_lancamento",
          "data_lan_amento_date",
          "data_lancamento_date",
          "data_de_recebimento",
          "data_recebimento",
          "data",
        ),
        fornecedor: findFirstAvailable(
          "fornecedor_nome_migracao",
          "fornecedor_nome_migracao_text",
          "fornecedor_nome_migra_o",
          "fornecedor_nome_migra_o_text",
          "fornecedor",
          "nome_fornecedor",
          "fornecedor_id",
          "fornecedor_id_custom_fornecedores",
          "supplier",
          "supplier_id",
        ),
        responsavel: find("responsavel", "criado_por", "usuario"),
        criacao: find("data_de_criacao", "data_criacao", "created_date"),
        item: findFirstAvailable(
          "item_nome_migracao",
          "item_nome_migracao_text",
          "item_nome_migra_o",
          "item_nome_migra_o_text",
          "item",
          "nome_do_item",
          "nome_item",
          "item_id",
          "item_id_custom_itens",
          "produto",
          "produto_id",
          "insumo",
          "insumo_id",
        ),
        quantidade: find("quantidade", "quantidade_number", "qtd", "quantity"),
        unidade: find("unidade", "medida", "unit"),
        subtotal: find("subtotal", "subtotal_number", "valor_total_item", "valor_item", "total"),
      };
      if (index.data < 0 || index.fornecedor < 0 || index.item < 0 || index.quantidade < 0 || index.subtotal < 0) {
        throw new Error("Colunas obrigatórias: Data de Lançamento, Fornecedor, Item, Quantidade e Subtotal.");
      }

      type ImportGroup = { numero: string; data: string; fornecedor: string; responsavel: string; criacao: string; itens: NotaItem[] };
      const groups = new Map<string, ImportGroup>();
      for (let line = 1; line < table.length; line += 1) {
        const cells = table[line] ?? [];
        const read = (column: number) => (column >= 0 ? String(cells[column] ?? "").trim() : "");
        const numeroRaw = read(index.numero);
        const itemRaw = read(index.item);
        if (isNativeBubbleExport && (!numeroRaw || !itemRaw)) continue;
        const fornecedor = read(index.fornecedor) || "SEM FORNECEDOR";
        const item = normalizeNotaItemName(insumosById.get(itemRaw) || itemRaw);
        const data = normalizeDateLabelPT(read(index.data));
        const quantity = parsePtNumber(read(index.quantidade));
        const subtotalCents = parseBrlToCents(read(index.subtotal));
        if (!fornecedor && !item && !data) continue;
        if (!fornecedor || !item || !data || !(quantity > 0) || !(subtotalCents > 0)) {
          throw new Error(`Linha ${line + 1}: fornecedor, data, item, quantidade ou subtotal inválido.`);
        }
        const numero = numeroRaw || `IMPORT-${line}`;
        const unidade =
          read(index.unidade) ||
          (itemRaw
            ? insumosStore.find((entry) => String(entry.id ?? "").trim() === itemRaw)?.medida
            : "") ||
          "Und";
        const key = `${numero.toLowerCase()}|${data}|${fornecedor.toLowerCase()}`;
        const group =
          groups.get(key) ??
          ({
            numero,
            data,
            fornecedor,
            responsavel: read(index.responsavel),
            criacao: normalizeDateLabelPT(read(index.criacao)) || data,
            itens: [],
          } satisfies ImportGroup);
        group.itens.push({
          id: `${Date.now()}-${line}`,
          nome: item,
          quantidadeLabel: `${formatPtNumber(quantity, 3)}${unidade}`,
          subtotalLabel: formatBrlFromCents(subtotalCents),
          custoUnitarioLabel: `R$${formatPtNumber(subtotalCents / 100 / quantity, 3)}/${unidade}`,
        });
        groups.set(key, group);
      }
      if (!groups.size) throw new Error("Nenhuma entrada válida encontrada.");

      const imported: EntradaRow[] = [];
      const importIdPrefix = await requireUserScopePrefix();
      const importRunId = Date.now();
      setImportProgress({ current: 0, total: groups.size, stage: "Preparando as notas..." });
      for (const group of groups.values()) {
        const id = `${importIdPrefix}import-${importRunId}-${imported.length}`;
        const total = group.itens.reduce((sum, item) => sum + parseBrlToCents(item.subtotalLabel), 0);
        imported.push({
          id,
          numero: group.numero,
          dataLancamento: group.data,
          fornecedor: resolveFornecedorKey(group.fornecedor, fornecedorInfoMap) || group.fornecedor.toUpperCase(),
          fornecedorNome: resolveFornecedorDisplay(group.fornecedor, fornecedorInfoMap),
          valorNota: formatBrlFromCents(total),
          itens: `${group.itens.length} ${group.itens.length === 1 ? "Item" : "Itens"}`,
          responsavel: group.responsavel,
          dataCriacao: group.criacao,
          itensNota: group.itens,
        });
      }
      const batchSize = 40;
      let saved = 0;
      for (let offset = 0; offset < imported.length; offset += batchSize) {
        const batch = imported.slice(offset, offset + batchSize);
        setImportProgress({
          current: saved,
          total: imported.length,
          stage: `Enviando notas ${offset + 1} a ${Math.min(offset + batch.length, imported.length)}...`,
        });
        let lastError: unknown = null;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          try {
            await upsertEntradasBatchToSupabase(batch as unknown as any[]);
            lastError = null;
            break;
          } catch (error) {
            lastError = error;
            if (attempt < 3) {
              setImportProgress({
                current: saved,
                total: imported.length,
                stage: `Reconectando e tentando novamente (${attempt}/3)...`,
              });
              await new Promise((resolve) => window.setTimeout(resolve, attempt * 700));
            }
          }
        }
        if (lastError) throw lastError;
        saved += batch.length;
        setImportProgress({
          current: saved,
          total: imported.length,
          stage: saved === imported.length ? "Finalizando..." : `${saved} notas importadas`,
        });
      }
      const previousIds = rows.map((row) => String(row.id ?? "").trim()).filter(Boolean);
      if (previousIds.length) await deleteEntradasFromSupabase(previousIds);
      setRows(imported);
      setIsImportOpen(false);
      setImportFile(null);
      if (importFileRef.current) importFileRef.current.value = "";
      showToast(`${imported.length} nota(s) importada(s) com sucesso.`, "success", 7000);
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), "error", 9000);
    } finally {
      setIsImporting(false);
      setImportProgress(null);
    }
  }

  function openNewModal() {
    if (isReadOnly) {
      showToast("Modo somente leitura.", "error");
      return;
    }
    setNewFornecedor("");
    setNewDataReceb(formatDateLabelPT(new Date()));
    setIsRecebCalendarOpen(false);
    setRecebMonth(startOfMonth(new Date()));
    setIsNewOpen(true);
  }

  function confirmNew() {
    if (isReadOnly) {
      showToast("Modo somente leitura.", "error");
      return;
    }
    const fornecedor = newFornecedor.trim();
    const dataReceb = normalizeDateLabelPT(newDataReceb);
    if (!fornecedor || !dataReceb) {
      showToast("Preencha fornecedor e data.", "error");
      return;
    }
    if (isCreatingNota) return;
    const now = new Date();
    let maxN = 0;
    for (const r of rows) {
      const n = Number.parseInt(r.numero.replace(/[^\d]/g, "") || "0", 10);
      if (n > maxN) maxN = n;
    }
    const numero = `#${maxN + 1 || 1}`;
    setQuery("");
    showToast("Salvando nota...", "success", 6000);
    const d = parseDateLabelLoose(dataReceb);
    if (d) {
      const currentStart = parseDateLabelLoose(dateStart);
      const currentEnd = parseDateLabelLoose(dateEnd);
      if (currentStart && d.getTime() < currentStart.getTime()) setDateStart(formatDateLabelNoCommaPT(d));
      if (currentEnd && d.getTime() > currentEnd.getTime()) setDateEnd(formatDateLabelNoCommaPT(d));
    }
    void (async () => {
      try {
        const id = await buildUserScopedId(String(Date.now()));
        const fornecedorKey = resolveFornecedorKey(fornecedor, fornecedorInfoMap);
        __dbgSend(
          "h3",
          "app/entradas/EntradasClient.tsx:confirmNew",
          "confirm_new",
          {
            selectedValue: fornecedor,
            fornecedorKey,
            display: displayFornecedor(fornecedor),
            hasInfoKey: Boolean(fornecedorInfoMap[fornecedorKey]),
            produtosLenByKey: (fornecedorProdutosMap as any)[fornecedorKey]?.length ?? 0,
            eqLenByKey: (fornecedorItemMap as any)[fornecedorKey]?.length ?? 0,
            produtosKeys: Object.keys(fornecedorProdutosMap).length,
            eqKeys: Object.keys(fornecedorItemMap).length,
          },
        );
        const newRow: EntradaRow = {
          id,
          numero,
          dataLancamento: dataReceb,
          fornecedor: fornecedorKey || fornecedor.toUpperCase(),
          valorNota: "R$0,00",
          itens: "0 Itens",
          responsavel: "",
          dataCriacao: formatDateLabelPT(now),
          itensNota: [],
        };
        setRows((prev) => [newRow, ...prev]);
        setIsNewOpen(false);
        openDetailsModal(newRow);
        setIsCreatingNota(true);
        await upsertEntradaToSupabase(newRow as unknown as any);
        showToast("Nota criada!", "success", 6000);
        void (async () => {
          try {
            const dbRows = await loadEntradasFromSupabase();
            if (dbRows[0]) {
              setRows((prev) => {
                const prevById = new Map(prev.map((p) => [p.id, p]));
                const next = dbRows.map((r) => {
                  const normalized = { ...(r as unknown as EntradaRow), dataLancamento: normalizeDateLabelPT(r.dataLancamento) } as EntradaRow;
                  const existing = prevById.get(normalized.id);
                  const prevLen = existing?.itensNota?.length ?? 0;
                  const nextLen = normalized?.itensNota?.length ?? 0;
                  if (existing && prevLen > nextLen) return existing;
                  return normalized;
                });
                return next as unknown as EntradaRow[];
              });
            }
          } catch {}
        })();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        showToast(`Erro ao salvar no banco de dados: ${msg}`, "error", 8000);
      } finally {
        setIsCreatingNota(false);
      }
    })();
  }

  useEffect(() => {
    if (!isRecebCalendarOpen) return;
    function onDown(e: MouseEvent) {
      const el = recebWrapRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      setIsRecebCalendarOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [isRecebCalendarOpen]);

  useEffect(() => {
    if (!isPeriodCalendarOpen) return;
    function onDown(e: MouseEvent) {
      const el = periodWrapRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      setIsPeriodCalendarOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [isPeriodCalendarOpen]);

  useEffect(() => {
    if (!authReady) return;
    setInsumosStore(readInsumosFromStore());
    void (async () => {
      try {
        const dbRows = await loadInsumosFromSupabase();
        if (dbRows.length) writeInsumosToStore(dbRows);
      } catch {}
    })();
    return subscribeInsumos((rows) => setInsumosStore(rows));
  }, [authReady]);

  useEffect(() => {
    if (!authReady) return;
    rowsReadyRef.current = false;
    setIsLoadingTable(true);
    (async () => {
      try {
        const db = await loadEntradasStateFromSupabase();
        if ((db as any)?.meta) setSourceMeta((db as any).meta);
        if (db.rows[0]) {
          setRows(db.rows.map((r) => ({ ...(r as unknown as EntradaRow), dataLancamento: normalizeDateLabelPT(r.dataLancamento) })) as unknown as EntradaRow[]);
          rowsReadyRef.current = true;
          setIsLoadingTable(false);
          return;
        }
      } catch {}
      const stored = readEntradasFromStore([] as unknown as any) as unknown as EntradaRow[];
      setRows(stored.map((r) => ({ ...r, dataLancamento: normalizeDateLabelPT(r.dataLancamento) })));
      rowsReadyRef.current = true;
      setIsLoadingTable(false);
    })();
  }, [authReady]);

  useEffect(() => {
    if (!rowsReadyRef.current) return;
    writeEntradasToStore(rows as unknown as any);
  }, [rows]);

  useEffect(() => {
    if (!authReady) return;
    (async () => {
      let nextInfo: FornecedorInfoMap = {};
      let nextProdutos: FornecedorProdutos = {};
      let nextEq: FornecedorEquivalenciasMap = {};
      try {
        const db = await loadFornecedoresStateFromSupabase();
        const hasDb = Object.keys(db.info).length || Object.keys(db.produtos).length || Object.keys(db.equivalencias).length;
        if (hasDb) {
          nextInfo = db.info;
          nextProdutos = db.produtos;
          nextEq = db.equivalencias;
        }
      } catch {
        if (!fornecedoresLoadErrorShownRef.current) {
          fornecedoresLoadErrorShownRef.current = true;
          showToast("Não foi possível carregar fornecedores do Supabase. Verifique login e se a tabela fornecedores_state existe (/setup-supabase).", "error", 9000);
        }
      }

      writeFornecedorInfoMap(nextInfo);
      writeFornecedorProdutosMap(nextProdutos);
      writeFornecedorEquivalenciasMap(nextEq);
      setFornecedorInfoMap(nextInfo);
      setFornecedorProdutosMap(nextProdutos);
      setFornecedorItemMap(nextEq);
      fornecedoresReadyRef.current = true;
    })();

    const u1 = subscribeFornecedorInfo((m) => setFornecedorInfoMap(m));
    const u2 = subscribeFornecedorProdutos((m) => setFornecedorProdutosMap(m));
    const u3 = subscribeFornecedorEquivalencias((m) => setFornecedorItemMap(m));
    return () => {
      u1();
      u2();
      u3();
    };
  }, [authReady]);

  useEffect(() => {
    if (!fornecedoresReadyRef.current) return;
    if (isReadOnly) return;
    if (fornecedoresSyncTimeoutRef.current) window.clearTimeout(fornecedoresSyncTimeoutRef.current);
    fornecedoresSyncTimeoutRef.current = window.setTimeout(() => {
      void saveFornecedoresStateToSupabase({ info: fornecedorInfoMap, produtos: fornecedorProdutosMap, equivalencias: fornecedorItemMap }).catch(() => {
        if (fornecedoresSaveErrorShownRef.current) return;
        fornecedoresSaveErrorShownRef.current = true;
        showToast("Não foi possível salvar fornecedores no Supabase. Verifique login e se a tabela fornecedores_state existe (/setup-supabase).", "error", 9000);
      });
    }, 450);
  }, [fornecedorInfoMap, fornecedorItemMap, fornecedorProdutosMap, isReadOnly]);

  useEffect(() => {
    if (isReadOnly) return;
    const current = readFornecedorInfoMap();
    const next: FornecedorInfoMap = { ...current };
    let changed = false;
    const addIfMissing = (raw: unknown) => {
      const fornecedor = String(raw ?? "").trim();
      if (!fornecedor) return;
      if (isDbKey(canonicalDbKey(fornecedor)) || looksLikeUuid(fornecedor) || looksLikeBubbleId(fornecedor)) return;
      const key = fornecedor.toUpperCase();
      if (next[key]) return;
      const info: FornecedorInfo = { fornecedor, vendedor: "", whatsapp: "", endereco: "" };
      next[key] = info;
      changed = true;
    };
    for (const r of rows) addIfMissing((r as any)?.fornecedor);
    for (const f of customFornecedores) addIfMissing(f);

    for (const [k, info] of Object.entries(next)) {
      const kk = String(k ?? "").trim();
      if (!kk) continue;
      if (!isDbKey(canonicalDbKey(kk))) continue;
      const label = info && typeof info === "object" ? String((info as any)?.fornecedor ?? "").trim() : "";
      if (isDbKey(canonicalDbKey(label)) || canonicalDbKey(label) === canonicalDbKey(kk) || label === kk) {
        delete next[k];
        changed = true;
      }
    }
    if (changed) writeFornecedorInfoMap(next);
  }, [customFornecedores, isReadOnly, rows]);

  useEffect(() => {
    const qty = parsePtNumber(detailQty);
    const subtotal = parseBrlToCents(detailSubtotal) / 100;
    if (!qty || !Number.isFinite(qty) || qty <= 0 || !subtotal || !Number.isFinite(subtotal) || subtotal <= 0) {
      if (detailUnitCost !== "0,000") setDetailUnitCost("0,000");
      return;
    }
    const unit = subtotal / qty;
    const next = formatPtNumber(unit, 3);
    if (next !== detailUnitCost) setDetailUnitCost(next);
  }, [detailQty, detailSubtotal]);

  useEffect(() => {
    if (!isItemMenuOpen) return;
    function onDown(e: MouseEvent) {
      const el = itemMenuRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      setIsItemMenuOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [isItemMenuOpen]);

  function confirmAddFornecedor() {
    if (isReadOnly) {
      showToast("Modo somente leitura.", "error");
      return;
    }
    const name = addFornecedorName.trim();
    if (!name) {
      showToast("Informe o nome do fornecedor.", "error");
      return;
    }
    setCustomFornecedores((prev) => {
      const k = name.toLowerCase();
      const has = prev.some((p) => p.toLowerCase() === k);
      return has ? prev : [...prev, name];
    });
    setNewFornecedor(name.toUpperCase());
    setIsAddFornecedorOpen(false);
    setAddFornecedorName("");
    setAddFornecedorVendedor("");
    setAddFornecedorWhatsapp("");
    setAddFornecedorEndereco("");

    setFornecedorInfoMap((prev) => {
      const next = {
        ...prev,
        [name.toUpperCase()]: {
          fornecedor: name,
          vendedor: addFornecedorVendedor.trim(),
          whatsapp: addFornecedorWhatsapp.trim(),
          endereco: addFornecedorEndereco.trim(),
        },
      };
      writeFornecedorInfoMap(next);
      return next;
    });
    showToast("Fornecedor cadastrado!", "success");
  }

  function openEditModal(row: EntradaRow) {
    if (isReadOnly) {
      showToast("Modo somente leitura.", "error");
      return;
    }
    setEditingId(row.id);
    setDraftFornecedor(displayFornecedorRow(row));
    setDraftDataLancamento(row.dataLancamento);
    const parsed = parseDateLabelLoose(row.dataLancamento) ?? new Date();
    setEditMonth(startOfMonth(parsed));
    setIsEditCalendarOpen(false);
    setIsEditOpen(true);
  }

  function confirmEdit() {
    if (isReadOnly) {
      showToast("Modo somente leitura.", "error");
      return;
    }
    const id = editingId;
    if (!id) return;
    const dataLancamento = normalizeDateLabelPT(draftDataLancamento);
    if (!dataLancamento) {
      showToast("Preencha a data de lançamento.", "error");
      return;
    }
    const base = rows.find((r) => r.id === id);
    if (!base) return;
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, dataLancamento } : r)));
    void upsertEntradaToSupabase({ ...base, dataLancamento } as unknown as any).catch(() => {});
    setIsEditOpen(false);
    setEditingId(null);
    setIsEditCalendarOpen(false);
    showToast("Alterações salvas!", "success");
  }

  function openDeleteModal(row: EntradaRow) {
    if (isReadOnly) {
      showToast("Modo somente leitura.", "error");
      return;
    }
    setDeletingId(row.id);
    setDeletingDate(formatDateNumericLoose(row.dataLancamento));
    setIsDeleteOpen(true);
  }

  function confirmDelete() {
    if (isReadOnly) {
      showToast("Modo somente leitura.", "error");
      return;
    }
    const id = deletingId;
    if (!id) return;
    setRows((prev) => prev.filter((r) => r.id !== id));
    void deleteEntradaFromSupabase(id).catch(() => {});
    setIsDeleteOpen(false);
    setDeletingId(null);
    setDeletingDate("");
  }

  function openDetailsModal(row: EntradaRow) {
    setDetailsId(row.id);
    setDetailItemName("");
    setDetailQty("0,000");
    setDetailUnit("Und");
    setDetailSubtotal("0,00");
    setDetailUnitCost("0,000");
    setIsItemMenuOpen(false);
    setIsDetailsOpen(true);
  }

  function openFornecedorProdutosModal() {
    if (isReadOnly) {
      showToast("Modo somente leitura.", "error");
      return;
    }
    const fornecedorRaw = (detailsRow?.fornecedor ?? "").trim();
    if (!fornecedorRaw) return;
    setFornecedorModalKey(resolveFornecedorKey(fornecedorRaw, fornecedorInfoMap));
    setFornecedorModalLabel(displayFornecedor(fornecedorRaw));
    setFornecedorProdutosSearch("");
    setFornecedorProdutosPick("");
    setIsFornecedorProdutosOpen(true);
    setIsDetailsOpen(false);
  }

  function openConfigurarVinculacao(nomeNaNota: string) {
    if (isReadOnly) {
      showToast("Modo somente leitura.", "error");
      return;
    }
    const fornecedorKeyRaw = (fornecedorModalKey || (detailsRow?.fornecedor ?? "")).trim();
    const fornecedorKey = fornecedorKeyRaw ? resolveFornecedorKey(fornecedorKeyRaw, fornecedorInfoMap) : "";
    const name = nomeNaNota.trim();
    if (!fornecedorKey) return;
    const existing = fornecedorItemMap[fornecedorKey]?.find((m) => m.nomeNaNota.toLowerCase() === name.toLowerCase()) ?? null;
    setMapNomeNota(name);
    setMapUnidadeNota(existing?.unidadeNaNota || "Und");
    setMapInsumoEq(existing?.insumoEquivalente || (insumosStore[0]?.item ?? "").trim());
    setMapEqQtd(existing?.equivalenteQuantidade || "");
    setIsAddFornecedorItemOpen(true);
  }

  function addProdutoToFornecedor(nome: string) {
    if (isReadOnly) {
      showToast("Modo somente leitura.", "error");
      return;
    }
    const fornecedorKeyRaw = (fornecedorModalKey ?? "").trim();
    const fornecedor = fornecedorKeyRaw ? resolveFornecedorKey(fornecedorKeyRaw, fornecedorInfoMap) : "";
    const item = nome.trim();
    if (!fornecedor || !item) return;
    setFornecedorProdutosMap((prev) => {
      const cur = prev[fornecedor] ?? [];
      const has = cur.some((x) => x.toLowerCase() === item.toLowerCase());
      const next: FornecedorProdutos = { ...prev, [fornecedor]: has ? cur : [...cur, item] };
      writeFornecedorProdutosMap(next);
      return next;
    });
  }

  function removeProdutoFromFornecedor(nome: string) {
    if (isReadOnly) {
      showToast("Modo somente leitura.", "error");
      return;
    }
    const fornecedorKeyRaw = (fornecedorModalKey ?? "").trim();
    const fornecedor = fornecedorKeyRaw ? resolveFornecedorKey(fornecedorKeyRaw, fornecedorInfoMap) : "";
    const item = nome.trim();
    if (!fornecedor || !item) return;
    setFornecedorProdutosMap((prev) => {
      const cur = prev[fornecedor] ?? [];
      const nextList = cur.filter((x) => x.toLowerCase() !== item.toLowerCase());
      const next: FornecedorProdutos = { ...prev, [fornecedor]: nextList };
      writeFornecedorProdutosMap(next);
      return next;
    });
    setFornecedorItemMap((prev) => {
      const cur = prev[fornecedor] ?? [];
      const nextList = cur.filter((m) => m.nomeNaNota.toLowerCase() !== item.toLowerCase());
      const next: FornecedorEquivalenciasMap = { ...prev, [fornecedor]: nextList };
      writeFornecedorEquivalenciasMap(next);
      return next;
    });
  }

  function openAddItemFornecedor() {
    if (isReadOnly) {
      showToast("Modo somente leitura.", "error");
      return;
    }
    setMapNomeNota("");
    setMapUnidadeNota("Und");
    setMapInsumoEq((insumosStore[0]?.item ?? "").trim());
    setMapEqQtd("");
    setIsAddFornecedorItemOpen(true);
  }

  function confirmAddItemFornecedor() {
    if (isReadOnly) {
      showToast("Modo somente leitura.", "error");
      return;
    }
    const fornecedorRaw = (detailsRow?.fornecedor ?? "").trim();
    const fornecedor = fornecedorRaw ? resolveFornecedorKey(fornecedorRaw, fornecedorInfoMap) : "";
    if (!fornecedor) return;
    const nomeNaNota = mapNomeNota.trim();
    const unidadeNaNota = mapUnidadeNota.trim() || "Und";
    const insumoEquivalente = mapInsumoEq.trim();
    if (!nomeNaNota || !insumoEquivalente) {
      showToast("Preencha nome na nota e insumo equivalente.", "error");
      return;
    }
    const equivalenteUnidade = insumosByName.get(insumoEquivalente.toLowerCase())?.medida ?? "Und";
    const novo: FornecedorItemEquivalencia = {
      id: String(Date.now()),
      nomeNaNota,
      unidadeNaNota,
      insumoEquivalente,
      equivalenteQuantidade: mapEqQtd.trim(),
      equivalenteUnidade,
    };
    setFornecedorItemMap((prev) => {
      const cur = prev[fornecedor] ?? [];
      const next: FornecedorEquivalenciasMap = { ...prev, [fornecedor]: [...cur, novo] };
      writeFornecedorEquivalenciasMap(next);
      return next;
    });
    setFornecedorProdutosMap((prev) => {
      const cur = prev[fornecedor] ?? [];
      const has = cur.some((x) => x.toLowerCase() === nomeNaNota.toLowerCase());
      const next: FornecedorProdutos = { ...prev, [fornecedor]: has ? cur : [...cur, nomeNaNota] };
      writeFornecedorProdutosMap(next);
      return next;
    });
    setDetailItemName(nomeNaNota);
    setDetailUnit(unidadeNaNota);
    setIsAddFornecedorItemOpen(false);
    setIsItemMenuOpen(false);
    showToast("Vínculo salvo!", "success");
  }

  function confirmAddNotaItem() {
    if (isReadOnly) {
      showToast("Modo somente leitura.", "error");
      return;
    }
    const id = detailsId;
    if (!id) return;
    const nome = normalizeNotaItemName(detailItemName);
    if (!nome) {
      showToast("Selecione um item válido.", "error");
      return;
    }
    const subtotalCents = parseBrlToCents(detailSubtotal);
    const qty = parsePtNumber(detailQty);
    const unitDerived = qty > 0 ? subtotalCents / 100 / qty : 0;
    const unitCostLabel = qty > 0 && subtotalCents > 0 ? `R$${formatPtNumber(unitDerived, 3)}/${detailUnit}` : `R$0,000/${detailUnit}`;
    const newItem: NotaItem = {
      id: String(Date.now()),
      nome,
      quantidadeLabel: `${detailQty}${detailUnit}`,
      subtotalLabel: formatBrlFromCents(subtotalCents),
      custoUnitarioLabel: unitCostLabel,
    };
    if (!qty || !Number.isFinite(qty) || qty <= 0 || !subtotalCents || !Number.isFinite(subtotalCents) || subtotalCents <= 0) {
      showToast("Preencha quantidade e subtotal.", "error");
      return;
    }

    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const items = r.itensNota ? [...r.itensNota, newItem] : [newItem];
        const total = items.reduce((acc, it) => acc + parseBrlToCents(it.subtotalLabel), 0);
        return { ...r, itensNota: items, itens: `${items.length} ${items.length === 1 ? "Item" : "Itens"}`, valorNota: formatBrlFromCents(total) };
      }),
    );
    if (detailsRow) {
      const items = detailsRow.itensNota ? [...detailsRow.itensNota, newItem] : [newItem];
      const total = items.reduce((acc, it) => acc + parseBrlToCents(it.subtotalLabel), 0);
      void upsertEntradaToSupabase(
        { ...detailsRow, itensNota: items, itens: `${items.length} ${items.length === 1 ? "Item" : "Itens"}`, valorNota: formatBrlFromCents(total) } as unknown as any,
      ).catch(() => {});
    }
    const fornecedorRaw = (detailsRow?.fornecedor ?? "").trim();
    const fornecedor = fornecedorRaw ? resolveFornecedorKey(fornecedorRaw, fornecedorInfoMap) : "";
    if (fornecedor) {
      setFornecedorProdutosMap((prev) => {
        const cur = prev[fornecedor] ?? [];
        const has = cur.some((x) => x.toLowerCase() === nome.toLowerCase());
        const next: FornecedorProdutos = { ...prev, [fornecedor]: has ? cur : [...cur, nome] };
        writeFornecedorProdutosMap(next);
        return next;
      });
    }
    setDetailItemName("");
    setDetailQty("0,000");
    setDetailUnit("Und");
    setDetailSubtotal("0,00");
    setDetailUnitCost("0,000");
    showToast("Item adicionado!", "success");
  }

  function deleteNotaItem(itemId: string) {
    if (isReadOnly) {
      showToast("Modo somente leitura.", "error");
      return;
    }
    const id = detailsId;
    if (!id) return;
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const items = (r.itensNota ?? []).filter((it) => it.id !== itemId);
        const total = items.reduce((acc, it) => acc + parseBrlToCents(it.subtotalLabel), 0);
        return { ...r, itensNota: items, itens: `${items.length} ${items.length === 1 ? "Item" : "Itens"}`, valorNota: formatBrlFromCents(total) };
      }),
    );
    if (detailsRow) {
      const items = (detailsRow.itensNota ?? []).filter((it) => it.id !== itemId);
      const total = items.reduce((acc, it) => acc + parseBrlToCents(it.subtotalLabel), 0);
      void upsertEntradaToSupabase(
        { ...detailsRow, itensNota: items, itens: `${items.length} ${items.length === 1 ? "Item" : "Itens"}`, valorNota: formatBrlFromCents(total) } as unknown as any,
      ).catch(() => {});
    }
    showToast("Item removido.", "success");
  }

  return (
    <>
      {isMounted && toast
        ? createPortal(
            <SystemToast title={toast.title} message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />,
            document.body,
          )
        : null}

      <main className={dash.content}>
        <div className={dash.pageFrame}>
          {!canRender ? (
            <section className={styles.header}>
              <div className={styles.headerIcon}>
                <IconEntrada />
              </div>
              <div className={styles.headerText}>
                <h1 className={styles.title}>Entradas</h1>
                <p className={styles.subtitle}>Carregando autenticação…</p>
              </div>
            </section>
          ) : (
            <>
              <QaModePanel screen="entradas" ui={qaUi} />
              <section className={styles.header}>
                <div className={styles.headerIcon}>
                  <IconEntrada />
                </div>
                <div className={styles.headerText}>
                  <h1 className={styles.title}>Entradas</h1>
                  <p className={styles.subtitle}>
                    Registre suas compras criando notas e relacionando os produtos adquiridos para controlar suas entradas.
                  </p>
                </div>
              </section>

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

        <section className={styles.toolbar}>
          <div className={styles.search}>
            <span className={styles.searchIcon} aria-hidden>
              <IconSearch />
            </span>
            <input
              className={styles.searchInput}
              placeholder="Pesquise por fornecedor..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className={styles.period}>
            <div className={styles.periodLabel}>Período de Lançamento:</div>
            <div
              className={styles.periodInputWrap}
              ref={periodWrapRef}
              onClick={() => {
                if (isPeriodCalendarOpen) return;
                const parsed = parseDateLabelLoose(dateEnd) ?? parseDateLabelLoose(dateStart) ?? new Date();
                setPeriodMonth(startOfMonth(parsed));
                setPeriodPicking("start");
                setIsPeriodCalendarOpen(true);
              }}
            >
              <span className={styles.periodIcon} aria-hidden>
                <IconCalendar />
              </span>
              <input
                className={styles.periodInput}
                value={dateStart && dateEnd ? `${dateStart}, ${dateEnd}` : "Todo período"}
                onChange={() => {}}
                readOnly
                aria-label="Período de Lançamento"
                onFocus={() => {
                  const parsed = parseDateLabelLoose(dateEnd) ?? parseDateLabelLoose(dateStart) ?? new Date();
                  setPeriodMonth(startOfMonth(parsed));
                  setPeriodPicking("start");
                  setIsPeriodCalendarOpen(true);
                }}
              />

              {isPeriodCalendarOpen ? (
                <div
                  className={styles.calendarPopover}
                  role="dialog"
                  aria-label="Selecionar período"
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                >
                  <div className={styles.calendarHeader}>
                    <button type="button" className={styles.calNavBtn} aria-label="Mês anterior" onClick={() => setPeriodMonth((m) => addMonths(m, -1))}>
                      ◀
                    </button>
                    <div className={styles.calTitle}>
                      <span className={styles.calMonthName}>
                        {
                          [
                            "janeiro",
                            "fevereiro",
                            "março",
                            "abril",
                            "maio",
                            "junho",
                            "julho",
                            "agosto",
                            "setembro",
                            "outubro",
                            "novembro",
                            "dezembro",
                          ][periodMonth.getMonth()]
                        }
                      </span>{" "}
                      <span className={styles.calYear}>{periodMonth.getFullYear()}</span>
                    </div>
                    <button type="button" className={styles.calNavBtn} aria-label="Próximo mês" onClick={() => setPeriodMonth((m) => addMonths(m, 1))}>
                      ▶
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
                      const first = startOfMonth(periodMonth);
                      const start = first.getDay();
                      const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
                      const prevDaysInMonth = new Date(first.getFullYear(), first.getMonth(), 0).getDate();
                      const selectedStart = parseDateLabelLoose(dateStart);
                      const selectedEnd = parseDateLabelLoose(dateEnd);
                      const cells: Array<JSX.Element> = [];

                      for (let i = 0; i < start; i += 1) {
                        const day = prevDaysInMonth - (start - 1 - i);
                        cells.push(
                          <button key={`pm-${i}`} type="button" className={`${styles.calDay} ${styles.calDayMuted}`} disabled>
                            {day}
                          </button>,
                        );
                      }

                      for (let day = 1; day <= daysInMonth; day += 1) {
                        const d = new Date(first.getFullYear(), first.getMonth(), day);
                        const isStart =
                          selectedStart &&
                          d.getFullYear() === selectedStart.getFullYear() &&
                          d.getMonth() === selectedStart.getMonth() &&
                          d.getDate() === selectedStart.getDate();
                        const isEnd =
                          selectedEnd &&
                          d.getFullYear() === selectedEnd.getFullYear() &&
                          d.getMonth() === selectedEnd.getMonth() &&
                          d.getDate() === selectedEnd.getDate();
                        const isRange =
                          selectedStart &&
                          selectedEnd &&
                          d.getTime() > selectedStart.getTime() &&
                          d.getTime() < selectedEnd.getTime();
                        const className = isStart || isEnd ? `${styles.calDay} ${styles.calDayOn}` : isRange ? `${styles.calDay} ${styles.calDayRange}` : styles.calDay;

                        cells.push(
                          <button
                            type="button"
                            key={`d-${day}`}
                            className={className}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (periodPicking === "start") {
                                setDateStart(formatDateLabelNoCommaPT(d));
                                if (selectedEnd && d.getTime() > selectedEnd.getTime()) setDateEnd(formatDateLabelNoCommaPT(d));
                                setPeriodPicking("end");
                                return;
                              }
                              const currentStart = parseDateLabelLoose(dateStart);
                              if (currentStart && d.getTime() < currentStart.getTime()) {
                                setDateEnd(formatDateLabelNoCommaPT(currentStart));
                                setDateStart(formatDateLabelNoCommaPT(d));
                              } else {
                                setDateEnd(formatDateLabelNoCommaPT(d));
                              }
                              setIsPeriodCalendarOpen(false);
                            }}
                          >
                            {day}
                          </button>,
                        );
                      }
                      const total = cells.length;
                      const rem = total % 7;
                      const pad = rem === 0 ? 0 : 7 - rem;
                      for (let i = 0; i < pad; i += 1) {
                        cells.push(
                          <button key={`nm-${i}`} type="button" className={`${styles.calDay} ${styles.calDayMuted}`} disabled>
                            {i + 1}
                          </button>,
                        );
                      }
                      return cells;
                    })()}
                  </div>

                  <div className={styles.calFooter}>
                    <button
                      type="button"
                      className={styles.calFooterBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        setPeriodPicking("start");
                      }}
                    >
                      <span className={styles.dotBlue} aria-hidden />
                      início
                    </button>
                    <button
                      type="button"
                      className={styles.calFooterBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        setPeriodPicking("end");
                      }}
                    >
                      <span className={styles.dotRed} aria-hidden />
                      fim
                    </button>
                    <button
                      type="button"
                      className={styles.calFooterBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDateStart("");
                        setDateEnd("");
                        setPeriodPicking("start");
                        setIsPeriodCalendarOpen(false);
                      }}
                    >
                      limpar
                    </button>
                    <button
                      type="button"
                      className={styles.calFooterBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsPeriodCalendarOpen(false);
                      }}
                    >
                      <span className={styles.xMark} aria-hidden>
                        ×
                      </span>
                      fechar
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className={styles.toolbarActions}>
            {bulkDeleteMode ? (
              <>
                <button
                  type="button"
                  className={styles.dangerBtn}
                  disabled={isReadOnly || selectedCount === 0}
                  onClick={() => {
                    if (isReadOnly) {
                      showToast("Modo somente leitura.", "error");
                      return;
                    }
                    if (!selectedCount) return;
                    setIsBulkDeleteOpen(true);
                  }}
                >
                  <IconTrash />
                  {`Excluir (${selectedCount})`}
                </button>
                <button
                  type="button"
                  className={styles.ghostBtn}
                  onClick={() => {
                    setBulkDeleteMode(false);
                    setSelectedIds({});
                    setIsBulkDeleteOpen(false);
                  }}
                >
                  Cancelar
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  disabled={isReadOnly}
                  onClick={() => {
                    if (isReadOnly) {
                      showToast("Modo somente leitura.", "error");
                      return;
                    }
                    setImportFile(null);
                    setIsImportOpen(true);
                  }}
                >
                  Importar
                </button>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  disabled={isReadOnly || visible.length === 0}
                  onClick={() => {
                    if (isReadOnly) {
                      showToast("Modo somente leitura.", "error");
                      return;
                    }
                    if (!visible.length) return;
                    setBulkDeleteMode(true);
                    setSelectedIds({});
                    setIsBulkDeleteOpen(false);
                  }}
                >
                  <IconTrash />
                  Excluir várias
                </button>
                <button
                  type="button"
                  className={styles.primaryBtn}
                  disabled={isReadOnly}
                  onClick={() => {
                    if (isReadOnly) {
                      showToast("Modo somente leitura.", "error");
                      return;
                    }
                    openNewModal();
                  }}
                >
                  <IconPlus />
                  Nova Nota
                </button>
              </>
            )}
          </div>
        </section>

        <section className={styles.tableCard} style={{ position: "relative" }} data-qa-grid="entradas">
          {tableLoading.show ? (
            <div className={dash.loadingOverlay}>
              <LoadingSpinner />
            </div>
          ) : null}
          <div className={styles.tableHead} style={{ gridTemplateColumns: tableGridTemplateColumns }}>
            {bulkDeleteMode ? (
              <label className={styles.selectHead} onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAllVisible} disabled={isReadOnly} />
              </label>
            ) : null}
            {columnOrder.map((column) => {
              const label =
                column === "dataLancamento"
                  ? "Data de Lançamento"
                  : column === "fornecedor"
                    ? "Fornecedor"
                    : column === "valorNota"
                      ? "Valor da Nota"
                      : column === "responsavel"
                        ? "Responsável"
                        : "Data de Criação";
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
            <div className={styles.thActions}>Ações</div>
          </div>

          <div className={styles.tableBody} data-qa-grid="entradas:rows">
            {!pagination.totalItems ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyTitle}>Nenhuma nota cadastrada</div>
                <div className={styles.emptyText}>Clique em “Nova Nota” para começar.</div>
              </div>
            ) : (
              pagination.pageItems.map((r) => (
                <div
                  key={r.id}
                  className={styles.tr}
                  role="button"
                  tabIndex={0}
                  style={{ gridTemplateColumns: tableGridTemplateColumns }}
                  onClick={() => (bulkDeleteMode ? toggleRowSelected(r.id) : openDetailsModal(r))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      if (bulkDeleteMode) toggleRowSelected(r.id);
                      else openDetailsModal(r);
                    }
                  }}
                  data-qa-grid-row
                  data-qa-row-id={r.id}
                >
                {bulkDeleteMode ? (
                  <label className={styles.selectCell} onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={Boolean(selectedIds[r.id])}
                      onChange={() => toggleRowSelected(r.id)}
                      disabled={isReadOnly}
                      aria-label="Selecionar nota"
                    />
                  </label>
                ) : null}
                {columnOrder.map((column) => (
                  <div key={column} className={styles.tableCellWrap}>
                    {renderCell(r, column)}
                  </div>
                ))}
                <div
                  className={styles.tdActions}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    className={styles.actionBtn}
                    aria-label="Editar"
                    onClick={(e) => {
                      e.stopPropagation();
                    if (isReadOnly) {
                      showToast("Modo somente leitura.", "error");
                      return;
                    }
                    if (bulkDeleteMode) {
                      showToast("Saia do modo de seleção para editar.", "error");
                      return;
                    }
                    openEditModal(r);
                    }}
                  disabled={isReadOnly || bulkDeleteMode}
                  >
                    <IconPencil />
                  </button>
                  <button
                    type="button"
                    className={styles.actionBtn}
                    aria-label="Excluir"
                    onClick={(e) => {
                      e.stopPropagation();
                    if (isReadOnly) {
                      showToast("Modo somente leitura.", "error");
                      return;
                    }
                    if (bulkDeleteMode) {
                      showToast("Saia do modo de seleção para excluir.", "error");
                      return;
                    }
                    openDeleteModal(r);
                    }}
                  disabled={isReadOnly || bulkDeleteMode}
                  >
                    <IconTrash />
                  </button>
                </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className={styles.footer}>
          <div>{`${pagination.totalItems} resultado(s) encontrado(s)`}</div>
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
        </section>

        {isEditOpen ? (
          <div
            className={styles.modalOverlay}
            role="presentation"
            onClick={() => {
              setIsEditOpen(false);
              setIsEditCalendarOpen(false);
            }}
          >
            <div className={`${styles.modal} ${styles.editModal}`} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitle}>Editar Nota</div>
                <button
                  type="button"
                  className={styles.modalClose}
                  aria-label="Fechar"
                  onClick={() => {
                    setIsEditOpen(false);
                    setIsEditCalendarOpen(false);
                  }}
                >
                  ×
                </button>
              </div>

              <div className={styles.modalBody}>
                <div className={styles.notice}>
                  <div className={styles.noticeIcon} aria-hidden>
                    ?
                  </div>
                  <div className={styles.noticeText}>Crie uma nota para adicionar a lista de itens adquiridos.</div>
                </div>

                <div className={styles.formField}>
                  <div className={styles.formLabel}>Fornecedor</div>
                  <select className={styles.formSelect} value={draftFornecedor} onChange={() => {}} disabled>
                    <option value={draftFornecedor}>{draftFornecedor || "-"}</option>
                  </select>
                </div>

                <div className={styles.formField}>
                  <div className={styles.formLabel}>Data de Lançamento</div>
                  <div className={styles.dateWrap} ref={editWrapRef}>
                    <input
                      className={styles.formInput}
                      value={draftDataLancamento}
                      onChange={() => {}}
                      readOnly
                      onFocus={() => {
                        const parsed = parseDateLabelLoose(draftDataLancamento) ?? new Date();
                        setEditMonth(startOfMonth(parsed));
                        setIsEditCalendarOpen(true);
                      }}
                      onClick={() => {
                        const parsed = parseDateLabelLoose(draftDataLancamento) ?? new Date();
                        setEditMonth(startOfMonth(parsed));
                        setIsEditCalendarOpen(true);
                      }}
                    />

                    {isEditCalendarOpen ? (
                      <div className={styles.calendarPopover} role="dialog" aria-label="Selecionar data">
                        <div className={styles.calendarHeader}>
                          <button type="button" className={styles.calNavBtn} aria-label="Mês anterior" onClick={() => setEditMonth((m) => addMonths(m, -1))}>
                            ◀
                          </button>
                          <div className={styles.calTitle}>
                            <span className={styles.calMonthName}>
                              {
                                [
                                  "janeiro",
                                  "fevereiro",
                                  "março",
                                  "abril",
                                  "maio",
                                  "junho",
                                  "julho",
                                  "agosto",
                                  "setembro",
                                  "outubro",
                                  "novembro",
                                  "dezembro",
                                ][editMonth.getMonth()]
                              }
                            </span>{" "}
                            <span className={styles.calYear}>{editMonth.getFullYear()}</span>
                          </div>
                          <button type="button" className={styles.calNavBtn} aria-label="Próximo mês" onClick={() => setEditMonth((m) => addMonths(m, 1))}>
                            ▶
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
                            const first = startOfMonth(editMonth);
                            const start = first.getDay();
                            const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
                            const prevDaysInMonth = new Date(first.getFullYear(), first.getMonth(), 0).getDate();
                            const selected = parseDateLabelLoose(draftDataLancamento);
                            const cells: Array<JSX.Element> = [];

                            for (let i = 0; i < start; i += 1) {
                              const day = prevDaysInMonth - (start - 1 - i);
                              cells.push(
                                <button key={`pm-${i}`} type="button" className={`${styles.calDay} ${styles.calDayMuted}`} disabled>
                                  {day}
                                </button>,
                              );
                            }

                            for (let day = 1; day <= daysInMonth; day += 1) {
                              const d = new Date(first.getFullYear(), first.getMonth(), day);
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
                                    setDraftDataLancamento(formatDateLabelPT(d));
                                    setIsEditCalendarOpen(false);
                                  }}
                                >
                                  {day}
                                </button>,
                              );
                            }
                            const total = cells.length;
                            const rem = total % 7;
                            const pad = rem === 0 ? 0 : 7 - rem;
                            for (let i = 0; i < pad; i += 1) {
                              cells.push(
                                <button key={`nm-${i}`} type="button" className={`${styles.calDay} ${styles.calDayMuted}`} disabled>
                                  {i + 1}
                                </button>,
                              );
                            }
                            return cells;
                          })()}
                        </div>

                        <div className={styles.calFooter}>
                          <button
                            type="button"
                            className={styles.calFooterBtn}
                            onClick={() => {
                              const t = new Date();
                              setDraftDataLancamento(formatDateLabelPT(t));
                              setEditMonth(startOfMonth(t));
                            }}
                          >
                            <span className={styles.dotBlue} aria-hidden />
                            hoje
                          </button>
                          <button
                            type="button"
                            className={styles.calFooterBtn}
                            onClick={() => {
                              setDraftDataLancamento("");
                            }}
                          >
                            <span className={styles.dotRed} aria-hidden />
                            limpar
                          </button>
                          <button type="button" className={styles.calFooterBtn} onClick={() => setIsEditCalendarOpen(false)}>
                            <span className={styles.xMark} aria-hidden>
                              ×
                            </span>
                            fechar
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className={styles.modalFooter}>
                <button type="button" className={styles.saveBtn} disabled={isReadOnly || !draftDataLancamento.trim()} onClick={confirmEdit}>
                  Salvar edição
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {isDeleteOpen ? (
          <div className={styles.modalOverlay} role="presentation" onClick={() => setIsDeleteOpen(false)}>
            <div className={`${styles.modal} ${styles.confirmModal}`} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitle}>Excluir Nota?</div>
                <button type="button" className={styles.modalClose} aria-label="Fechar" onClick={() => setIsDeleteOpen(false)}>
                  ×
                </button>
              </div>

              <div className={styles.confirmBody}>
                <div className={styles.confirmIcon} aria-hidden>
                  <IconTrashOutlineBig />
                </div>
                <div className={styles.confirmText}>
                  Caso exclua a nota do dia <strong>{deletingDate || "-"}</strong> não poderá recuperá-la.
                </div>
              </div>

              <div className={styles.confirmActions}>
                <button type="button" className={styles.confirmDelete} onClick={confirmDelete} disabled={isReadOnly}>
                  Excluir
                </button>
                <button
                  type="button"
                  className={styles.confirmCancel}
                  onClick={() => {
                    setIsDeleteOpen(false);
                    setDeletingId(null);
                    setDeletingDate("");
                  }}
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {isBulkDeleteOpen ? (
          <div className={styles.modalOverlay} role="presentation" onClick={() => setIsBulkDeleteOpen(false)}>
            <div className={`${styles.modal} ${styles.confirmModal}`} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitle}>{`Excluir ${selectedCount} ${selectedCount === 1 ? "Nota" : "Notas"}?`}</div>
                <button type="button" className={styles.modalClose} aria-label="Fechar" onClick={() => setIsBulkDeleteOpen(false)}>
                  ×
                </button>
              </div>

              <div className={styles.confirmBody}>
                <div className={styles.confirmIcon} aria-hidden>
                  <IconTrashOutlineBig />
                </div>
                <div className={styles.confirmText}>{`Você está prestes a excluir ${selectedCount} ${selectedCount === 1 ? "nota" : "notas"}. Essa ação não pode ser desfeita.`}</div>
              </div>

              <div className={styles.confirmActions}>
                <button type="button" className={styles.confirmDelete} onClick={confirmBulkDelete} disabled={isReadOnly || selectedCount === 0}>
                  Excluir
                </button>
                <button type="button" className={styles.confirmCancel} onClick={() => setIsBulkDeleteOpen(false)}>
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {isMounted && isDetailsOpen && detailsRow
          ? createPortal(
              <div className={styles.modalOverlay} role="presentation" onClick={() => setIsDetailsOpen(false)}>
                <div className={`${styles.modal} ${styles.detailsModal}`} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className={styles.detailsHeader}>
                <div className={styles.detailsTitle}>{`Detalhes da Nota ${detailsRow.numero}`}</div>
                <button type="button" className={styles.modalClose} aria-label="Fechar" onClick={() => setIsDetailsOpen(false)}>
                  ×
                </button>
              </div>

              <div className={styles.detailsBody}>
                <aside className={styles.detailsSide}>
                  <button type="button" className={styles.sideRowBtn} onClick={openFornecedorProdutosModal} disabled={isReadOnly}>
                    <div className={styles.sideIcon} aria-hidden>
                      <IconTruck />
                    </div>
                    <div className={styles.sideText}>
                      <div className={styles.sideLabel}>Fornecedor</div>
                      <div className={styles.sideValue}>{displayFornecedorRow(detailsRow)}</div>
                    </div>
                  </button>

                  <div className={styles.sideRow}>
                    <div className={styles.sideIcon} aria-hidden>
                      <IconCalendar />
                    </div>
                    <div className={styles.sideText}>
                      <div className={styles.sideLabel}>Lançamento em</div>
                      <div className={styles.sideValue}>{detailsRow.dataLancamento}</div>
                    </div>
                  </div>

                  <div className={styles.sideRow}>
                    <div className={styles.sideAvatar} aria-hidden>
                      <IconUser />
                    </div>
                    <div className={styles.sideText}>
                      <div className={styles.sideLabel}>Responsável</div>
                      <div className={styles.sideValue}>{resolveResponsavelDisplay(detailsRow.responsavel, currentUserFullName, currentUserEmail)}</div>
                    </div>
                  </div>
                </aside>

                <section className={styles.detailsMain}>
                  <div className={styles.detailsHead}>
                    <div className={styles.detailsHeadTitle}>Itens da Nota</div>
                    <div className={styles.detailsHeadSub}>Adicione abaixo os itens que fazem parte desta nota.</div>
                  </div>

                  <div className={styles.itemsAdd}>
                    <div className={styles.itemsAddLabels}>
                      <div>Item</div>
                      <div>Quantidade</div>
                      <div>Subtotal</div>
                      <div>Custo Unitário</div>
                      <div />
                    </div>

                    <div className={styles.itemsAddRow}>
                      <div className={styles.itemSearchWrap} ref={itemMenuRef}>
                        <div className={styles.itemSearch}>
                          <span className={styles.itemSearchIcon} aria-hidden>
                            <IconSearch />
                          </span>
                          <input
                            className={styles.itemSearchInput}
                            placeholder="Pesquise por itens..."
                            value={detailItemName}
                            onChange={(e) => {
                              setDetailItemName(e.target.value);
                              setIsItemMenuOpen(true);
                            }}
                            onFocus={() => setIsItemMenuOpen(true)}
                          />
                          <button
                            type="button"
                            className={styles.itemChevronBtn}
                            aria-label="Abrir lista de itens"
                            onClick={() => setIsItemMenuOpen((v) => !v)}
                          >
                            ▾
                          </button>
                        </div>

                        {isItemMenuOpen ? (
                          <div className={styles.itemDropdown} role="listbox" aria-label="Insumos do fornecedor">
                            <div className={styles.itemOptions}>
                              {filteredNotaItems.map((m) => (
                                <button
                                  key={m.id}
                                  type="button"
                                  className={styles.itemOption}
                                  onClick={() => {
                                    setDetailItemName(normalizeNotaItemName(m.nomeNaNota) || "");
                                    setDetailUnit(m.unidadeNaNota);
                                    setIsItemMenuOpen(false);
                                  }}
                                >
                                  {normalizeNotaItemName(m.nomeNaNota) || "-"}
                                </button>
                              ))}
                              {filteredFornecedorProdutos
                                .filter((name) => !filteredNotaItems.some((m) => m.nomeNaNota.toLowerCase() === name.toLowerCase()))
                                .map((name) => (
                                  <button
                                    key={`p-${name}`}
                                    type="button"
                                    className={styles.itemOption}
                                    onClick={() => {
                                      setDetailItemName(normalizeNotaItemName(name) || "");
                                      const fornecedorRaw = (detailsRow?.fornecedor ?? "").trim();
                                      const fornecedorKey = fornecedorRaw ? resolveFornecedorKey(fornecedorRaw, fornecedorInfoMap) : "";
                                      const map = fornecedorKey ? (fornecedorItemMap[fornecedorKey] ?? []) : [];
                                      const existing = map.find((m) => m.nomeNaNota.toLowerCase() === name.toLowerCase()) ?? null;
                                      setDetailUnit(existing?.unidadeNaNota || "Und");
                                      setIsItemMenuOpen(false);
                                    }}
                                  >
                                    {normalizeNotaItemName(name) || "-"}
                                  </button>
                                ))}
                              {!filteredNotaItems[0] && !filteredFornecedorProdutos[0] ? (
                                <div className={styles.itemEmpty}>Nenhum item do fornecedor encontrado</div>
                              ) : null}
                            </div>

                            <div className={styles.itemActions}>
                              <button
                                type="button"
                                className={styles.itemAddBtn}
                                disabled={isReadOnly}
                                onClick={() => {
                                  setIsItemMenuOpen(false);
                                  openAddItemFornecedor();
                                }}
                              >
                                + Adicionar novo item do fornecedor
                              </button>
                              <button
                                type="button"
                                className={styles.itemManageBtn}
                                disabled={isReadOnly}
                                onClick={() => {
                                  setIsItemMenuOpen(false);
                                  openFornecedorProdutosModal();
                                }}
                              >
                                Gerenciar produtos do fornecedor
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>

                      <div className={styles.qtyWrap}>
                        <input
                          className={styles.qtyInput}
                          inputMode="decimal"
                          pattern="[0-9.,]*"
                          value={detailQty}
                          onKeyDown={(e) => {
                            if (e.ctrlKey || e.metaKey || e.altKey) return;
                            const k = e.key;
                            if (k.length !== 1) return;
                            if (!/[0-9,\.]/.test(k)) e.preventDefault();
                          }}
                          onMouseDown={(e) => {
                            const el = e.currentTarget;
                            e.preventDefault();
                            el.focus();
                            selectAllSoon(el);
                          }}
                          onMouseUp={(e) => e.preventDefault()}
                          onTouchStart={(e) => {
                            const el = e.currentTarget;
                            e.preventDefault();
                            el.focus();
                            selectAllSoon(el);
                          }}
                          onFocus={(e) => {
                            const next = formatMaskedPtInput(detailQty, 3);
                            if (next !== detailQty) setDetailQty(next);
                            selectAllSoon(e.currentTarget);
                          }}
                          onBlur={() => {
                            const next = formatMaskedPtInput(detailQty, 3);
                            if (next !== detailQty) setDetailQty(next);
                          }}
                          onChange={(e) => setDetailQty(e.target.value)}
                        />
                        <div className={styles.qtyUnit}>{detailUnit}</div>
                      </div>

                      <div className={styles.moneyWrap}>
                        <div className={styles.moneyPrefix}>R$</div>
                        <input
                          className={styles.moneyInput}
                          inputMode="decimal"
                          pattern="[0-9.,]*"
                          value={detailSubtotal}
                          onKeyDown={(e) => {
                            if (e.ctrlKey || e.metaKey || e.altKey) return;
                            const k = e.key;
                            if (k.length !== 1) return;
                            if (!/[0-9,\.]/.test(k)) e.preventDefault();
                          }}
                          onMouseDown={(e) => {
                            const el = e.currentTarget;
                            e.preventDefault();
                            el.focus();
                            selectAllSoon(el);
                          }}
                          onMouseUp={(e) => e.preventDefault()}
                          onTouchStart={(e) => {
                            const el = e.currentTarget;
                            e.preventDefault();
                            el.focus();
                            selectAllSoon(el);
                          }}
                          onFocus={(e) => {
                            const next = formatMaskedPtInput(detailSubtotal, 2);
                            if (next !== detailSubtotal) setDetailSubtotal(next);
                            selectAllSoon(e.currentTarget);
                          }}
                          onBlur={() => {
                            const next = formatMaskedPtInput(detailSubtotal, 2);
                            if (next !== detailSubtotal) setDetailSubtotal(next);
                          }}
                          onChange={(e) => setDetailSubtotal(e.target.value)}
                        />
                      </div>

                      <div className={styles.moneyWrap}>
                        <div className={styles.moneyPrefix}>R$</div>
                        <input className={styles.moneyInput} value={detailUnitCost} readOnly />
                      </div>

                      <button
                        type="button"
                        className={canAddNotaItem ? `${styles.plusBtn} ${styles.plusBtnOn}` : styles.plusBtn}
                        aria-label="Adicionar item"
                        disabled={isReadOnly || !canAddNotaItem}
                        onClick={confirmAddNotaItem}
                      >
                        <IconPlusCircle />
                      </button>
                    </div>
                  </div>

                  <div className={styles.itemsDivider} aria-hidden>
                    <div className={styles.itemsDividerIcon}>⌄⌄</div>
                  </div>

                  <div className={styles.itemsList} data-qa-grid="entradas:itens">
                    {(detailsRow.itensNota ?? []).map((it) => (
                      <div key={it.id} className={styles.itemsRow} data-qa-grid-row data-qa-row-id={it.id}>
                        <div className={styles.itemsNameWrap} data-qa-grid-cell>
                          <div className={styles.itemsName}>{resolveNotaItemDisplayName(it, insumosById)}</div>
                          <div className={styles.itemsEq}>
                            {(() => {
                              const raw = (detailsRow.fornecedor ?? "").trim();
                              const key = raw ? resolveFornecedorKey(raw, fornecedorInfoMap) : "";
                              const nome = resolveNotaItemDisplayName(it, insumosById);
                              if (!nome) return "-";
                              const map = fornecedorItemMap[key]?.find((m) => m.nomeNaNota.toLowerCase() === nome.toLowerCase()) ?? null;
                              const eq = map?.insumoEquivalente ?? (insumosByName.get(nome.toLowerCase()) ? nome : "");
                              return eq || "-";
                            })()}
                          </div>
                        </div>
                        <div className={styles.itemsQty} data-qa-grid-cell>
                          {(() => {
                            const raw = (detailsRow.fornecedor ?? "").trim();
                            const key = raw ? resolveFornecedorKey(raw, fornecedorInfoMap) : "";
                            const nome = resolveNotaItemDisplayName(it, insumosById);
                            if (!nome) return it.quantidadeLabel;
                            const map = fornecedorItemMap[key]?.find((m) => m.nomeNaNota.toLowerCase() === nome.toLowerCase()) ?? null;
                            const factor = map ? parsePtNumber(map.equivalenteQuantidade) : 0;
                            if (!map || !factor) return it.quantidadeLabel;
                            const { qty } = parseQtyLabel(it.quantidadeLabel);
                            const eqQty = qty * factor;
                            const eqUnit = map.equivalenteUnidade || insumosByName.get((map.insumoEquivalente || "").toLowerCase())?.medida || "Und";
                            const decimals = eqUnit.toLowerCase() === "und" ? 0 : 3;
                            return (
                              <>
                                <div className={styles.itemsQtyMain}>{it.quantidadeLabel}</div>
                                <div className={styles.itemsQtySub}>{`${formatPtNumber(eqQty, decimals)} ${eqUnit}`}</div>
                              </>
                            );
                          })()}
                        </div>
                        <div className={styles.itemsPrice} data-qa-grid-cell>
                          <div className={styles.itemsSubtotal}>{it.subtotalLabel}</div>
                          <div className={styles.itemsUnitCost}>
                            {(() => {
                              const raw = (detailsRow.fornecedor ?? "").trim();
                              const key = raw ? resolveFornecedorKey(raw, fornecedorInfoMap) : "";
                              const nome = resolveNotaItemDisplayName(it, insumosById);
                              if (!nome) return it.custoUnitarioLabel;
                              const map = fornecedorItemMap[key]?.find((m) => m.nomeNaNota.toLowerCase() === nome.toLowerCase()) ?? null;
                              const factor = map ? parsePtNumber(map.equivalenteQuantidade) : 0;
                              if (!map || !factor) return it.custoUnitarioLabel;
                              const { qty } = parseQtyLabel(it.quantidadeLabel);
                              const eqQty = qty * factor;
                              const eqUnit = map.equivalenteUnidade || insumosByName.get((map.insumoEquivalente || "").toLowerCase())?.medida || "Und";
                              const subtotalCents = parseBrlToCents(it.subtotalLabel);
                              const unitDerived = eqQty > 0 ? subtotalCents / 100 / eqQty : 0;
                              return eqQty > 0 && subtotalCents > 0 ? `R$${formatPtNumber(unitDerived, 3)}/${eqUnit}` : `R$0,000/${eqUnit}`;
                            })()}
                          </div>
                        </div>
                        <button type="button" className={styles.itemsTrash} aria-label="Remover item" onClick={() => deleteNotaItem(it.id)} disabled={isReadOnly}>
                          <IconTrash />
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              </div>

              <div className={styles.detailsFooter}>
                <div className={styles.totalLeft}>TOTAL</div>
                <div className={styles.totalRight}>
                  <div className={styles.totalCount}>{`(${(detailsRow.itensNota ?? []).length} Itens)`}</div>
                  <div className={styles.totalValue}>
                    {formatBrlFromCents((detailsRow.itensNota ?? []).reduce((acc, it) => acc + parseBrlToCents(it.subtotalLabel), 0))}
                  </div>
                </div>
              </div>
            </div>
              </div>,
              document.body,
            )
          : null}

        {isMounted && isImportOpen
          ? createPortal(
              <div className={styles.modalOverlay} role="presentation" onClick={() => { if (!isImporting) setIsImportOpen(false); }}>
                <div className={`${styles.modal} ${styles.importModal}`} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
                  <div className={styles.modalHeader}>
                    <div className={styles.modalTitle}>Importar Entradas por Planilha</div>
                    <button type="button" className={styles.modalClose} aria-label="Fechar" disabled={isImporting} onClick={() => setIsImportOpen(false)}>
                      ×
                    </button>
                  </div>
                  <div className={styles.modalBody}>
                    <div className={styles.notice}>
                      <span className={styles.noticeIcon}>!</span>
                      <div className={styles.noticeText}>
                        Cada linha representa um item. Repita o número da nota, a data e o fornecedor para agrupar vários itens na mesma entrada.
                      </div>
                    </div>
                    <div className={styles.importTemplateRow}>
                      <button type="button" className={styles.secondaryBtn} onClick={() => void downloadEntradasTemplateXlsx()}>
                        Baixar modelo (.xlsx)
                      </button>
                      <button type="button" className={styles.secondaryBtn} onClick={downloadEntradasTemplateCsv}>
                        Baixar modelo (.csv)
                      </button>
                    </div>
                    <input
                      ref={importFileRef}
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      className={styles.importFileInput}
                      onChange={(event) => setImportFile(event.currentTarget.files?.[0] ?? null)}
                    />
                    {importFile ? <div className={styles.importFileName}>Arquivo selecionado: {importFile.name}</div> : null}
                    {importProgress ? (
                      <div className={styles.importProgressPanel} aria-live="polite">
                        <div className={styles.importProgressHeader}>
                          <span>{importProgress.stage}</span>
                          <strong>
                            {importProgress.total > 0
                              ? `${Math.round((importProgress.current / importProgress.total) * 100)}%`
                              : "Preparando"}
                          </strong>
                        </div>
                        <div
                          className={styles.importProgressTrack}
                          role="progressbar"
                          aria-valuemin={0}
                          aria-valuemax={importProgress.total || 1}
                          aria-valuenow={importProgress.current}
                        >
                          <div
                            className={styles.importProgressFill}
                            style={{
                              width:
                                importProgress.total > 0
                                  ? `${Math.max(2, (importProgress.current / importProgress.total) * 100)}%`
                                  : "12%",
                            }}
                          />
                        </div>
                        <div className={styles.importProgressCount}>
                          {importProgress.total > 0
                            ? `${importProgress.current.toLocaleString("pt-BR")} de ${importProgress.total.toLocaleString("pt-BR")} notas`
                            : "Organizando os dados do arquivo"}
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <div className={`${styles.modalFooter} ${styles.importFooter}`}>
                    <button type="button" className={styles.ghostBtn} disabled={isImporting} onClick={() => setIsImportOpen(false)}>
                      Encerrar
                    </button>
                    <button type="button" className={styles.primaryBtn} disabled={isImporting} onClick={() => void importEntradasFile()}>
                      {isImporting ? "Importando..." : importFile ? "Importar" : "Selecionar planilha"}
                    </button>
                  </div>
                </div>
              </div>,
              document.body,
            )
          : null}

        {isNewOpen ? (
          <div className={styles.modalOverlay} role="presentation" onClick={() => setIsNewOpen(false)}>
            <div className={`${styles.modal} ${styles.newModal}`} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitle}>Nova Nota</div>
                <button type="button" className={styles.modalClose} aria-label="Fechar" onClick={() => setIsNewOpen(false)}>
                  ×
                </button>
              </div>

              <div className={styles.modalBody}>
                <div className={styles.notice}>
                  <div className={styles.noticeIcon} aria-hidden>
                    ?
                  </div>
                  <div className={styles.noticeText}>Crie uma nota para adicionar a lista de itens adquiridos.</div>
                </div>

                <div className={styles.formField}>
                  <div className={styles.formLabelRow}>
                    <div className={styles.formLabel}>Fornecedor</div>
                    <button
                      type="button"
                      className={styles.addLink}
                      onClick={() => {
                        setAddFornecedorName("");
                        setAddFornecedorVendedor("");
                        setAddFornecedorWhatsapp("");
                        setAddFornecedorEndereco("");
                        setIsAddFornecedorOpen(true);
                      }}
                    >
                      ADD Fornecedor
                    </button>
                  </div>
                  <select className={styles.formSelect} value={newFornecedor} onChange={(e) => setNewFornecedor(e.target.value)}>
                    <option value="">Selecione</option>
                    {fornecedorOptions.map((opt) => (
                      <option key={opt.key} value={opt.key}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className={styles.formField}>
                  <div className={styles.formLabel}>Data de Recebimento</div>
                  <div className={styles.dateWrap} ref={recebWrapRef}>
                    <input
                      className={styles.formInput}
                      value={newDataReceb}
                      onChange={(e) => setNewDataReceb(e.target.value)}
                      onFocus={() => {
                        const parsed = parseDateLabelLoose(newDataReceb) ?? new Date();
                        setRecebMonth(startOfMonth(parsed));
                        setIsRecebCalendarOpen(true);
                      }}
                      onClick={() => {
                        const parsed = parseDateLabelLoose(newDataReceb) ?? new Date();
                        setRecebMonth(startOfMonth(parsed));
                        setIsRecebCalendarOpen(true);
                      }}
                    />

                    {isRecebCalendarOpen ? (
                      <div className={styles.calendarPopover} role="dialog" aria-label="Selecionar data">
                        <div className={styles.calendarHeader}>
                          <button type="button" className={styles.calNavBtn} aria-label="Mês anterior" onClick={() => setRecebMonth((m) => addMonths(m, -1))}>
                            ◀
                          </button>
                          <div className={styles.calTitle}>
                            <span className={styles.calMonthName}>
                              {
                                [
                                  "janeiro",
                                  "fevereiro",
                                  "março",
                                  "abril",
                                  "maio",
                                  "junho",
                                  "julho",
                                  "agosto",
                                  "setembro",
                                  "outubro",
                                  "novembro",
                                  "dezembro",
                                ][recebMonth.getMonth()]
                              }
                            </span>{" "}
                            <span className={styles.calYear}>{recebMonth.getFullYear()}</span>
                          </div>
                          <button type="button" className={styles.calNavBtn} aria-label="Próximo mês" onClick={() => setRecebMonth((m) => addMonths(m, 1))}>
                            ▶
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
                            const first = startOfMonth(recebMonth);
                            const start = first.getDay();
                            const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
                            const prevDaysInMonth = new Date(first.getFullYear(), first.getMonth(), 0).getDate();
                            const selected = parseDateLabelLoose(newDataReceb);
                            const cells: Array<JSX.Element> = [];

                            for (let i = 0; i < start; i += 1) {
                              const day = prevDaysInMonth - (start - 1 - i);
                              cells.push(
                                <button key={`pm-${i}`} type="button" className={`${styles.calDay} ${styles.calDayMuted}`} disabled>
                                  {day}
                                </button>,
                              );
                            }

                            for (let day = 1; day <= daysInMonth; day += 1) {
                              const d = new Date(first.getFullYear(), first.getMonth(), day);
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
                                    setNewDataReceb(formatDateLabelPT(d));
                                    setIsRecebCalendarOpen(false);
                                  }}
                                >
                                  {day}
                                </button>,
                              );
                            }
                            const total = cells.length;
                            const rem = total % 7;
                            const pad = rem === 0 ? 0 : 7 - rem;
                            for (let i = 0; i < pad; i += 1) {
                              cells.push(
                                <button key={`nm-${i}`} type="button" className={`${styles.calDay} ${styles.calDayMuted}`} disabled>
                                  {i + 1}
                                </button>,
                              );
                            }
                            return cells;
                          })()}
                        </div>

                        <div className={styles.calFooter}>
                          <button
                            type="button"
                            className={styles.calFooterBtn}
                            onClick={() => {
                              const t = new Date();
                              setNewDataReceb(formatDateLabelPT(t));
                              setRecebMonth(startOfMonth(t));
                            }}
                          >
                            <span className={styles.dotBlue} aria-hidden />
                            hoje
                          </button>
                          <button
                            type="button"
                            className={styles.calFooterBtn}
                            onClick={() => {
                              setNewDataReceb("");
                            }}
                          >
                            <span className={styles.dotRed} aria-hidden />
                            limpar
                          </button>
                          <button type="button" className={styles.calFooterBtn} onClick={() => setIsRecebCalendarOpen(false)}>
                            <span className={styles.xMark} aria-hidden>
                              ×
                            </span>
                            fechar
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className={styles.modalFooter}>
                <button
                  type="button"
                  className={styles.saveBtn}
                  disabled={isReadOnly || isCreatingNota || !newFornecedor.trim() || !newDataReceb.trim()}
                  onClick={confirmNew}
                >
                  {isCreatingNota ? "Criando..." : "Criar nota"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {isAddFornecedorOpen ? (
          <div className={styles.modalOverlay} role="presentation" onClick={() => setIsAddFornecedorOpen(false)}>
            <div className={`${styles.modal} ${styles.addFornecedorModal}`} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className={styles.cadHeader}>
                <button type="button" className={styles.backBtn} aria-label="Voltar" onClick={() => setIsAddFornecedorOpen(false)}>
                  ←
                </button>
                <div className={styles.cadTitle}>Cadastro de Fornecedor</div>
              </div>

              <div className={styles.modalBody}>
                <div className={styles.formField}>
                  <div className={styles.formLabel}>Nome do Fornecedor</div>
                  <input className={styles.formInput} placeholder="Ex: Mercado X" value={addFornecedorName} onChange={(e) => setAddFornecedorName(e.target.value)} />
                </div>

                <div className={styles.grid2}>
                  <div className={styles.formField}>
                    <div className={styles.formLabel}>Vendedor</div>
                    <input
                      className={styles.formInput}
                      placeholder="Ex: João Silva"
                      value={addFornecedorVendedor}
                      onChange={(e) => setAddFornecedorVendedor(e.target.value)}
                    />
                  </div>

                  <div className={styles.formField}>
                    <div className={styles.formLabel}>WhatsApp</div>
                    <div className={styles.phoneRow}>
                      <div className={styles.phonePrefix}>+55</div>
                      <input
                        className={styles.phoneInput}
                        placeholder="(00) 00000-0000"
                        value={addFornecedorWhatsapp}
                        onChange={(e) => setAddFornecedorWhatsapp(maskPhoneBR(e.target.value))}
                      />
                    </div>
                  </div>
                </div>

                <div className={styles.formField}>
                  <div className={styles.formLabel}>Endereço</div>
                  <input
                    className={styles.formInput}
                    placeholder="Ex: rua x, bairro y"
                    value={addFornecedorEndereco}
                    onChange={(e) => setAddFornecedorEndereco(e.target.value)}
                  />
                </div>
              </div>

              <div className={styles.modalFooter}>
                <button type="button" className={styles.saveBtn} disabled={isReadOnly || !addFornecedorName.trim()} onClick={confirmAddFornecedor}>
                  Cadastrar
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {isAddFornecedorItemOpen ? (
          <div className={styles.modalOverlay} role="presentation" onClick={() => setIsAddFornecedorItemOpen(false)}>
            <div className={`${styles.modal} ${styles.mapItemModal}`} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitle}>Configurar Vinculação</div>
                <button type="button" className={styles.modalClose} aria-label="Fechar" onClick={() => setIsAddFornecedorItemOpen(false)}>
                  ×
                </button>
              </div>

              <div className={styles.modalBody}>
                <div className={styles.formField}>
                  <div className={styles.formLabel}>Nome na nota</div>
                  <input className={styles.formInput} value={mapNomeNota} onChange={(e) => setMapNomeNota(e.target.value)} />
                </div>

                <div className={styles.formField}>
                  <div className={styles.formLabel}>Unidade de Medida na nota</div>
                  <select className={styles.formSelect} value={mapUnidadeNota} onChange={(e) => setMapUnidadeNota(e.target.value)}>
                    {["Und", "Kg", "g", "L", "Pacote", "Caixa", "Fardo", "Rolo", "Bisnaga", "Frasco"].map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>

                <div className={styles.formField}>
                  <div className={styles.formLabel}>Insumo equivalente</div>
                  <select className={styles.formSelect} value={mapInsumoEq} onChange={(e) => setMapInsumoEq(e.target.value)}>
                    {(insumosStore[0] ? insumosStore.map((i) => i.item) : ["Pão Brioche"]).map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className={styles.mapHint}>
                  <div className={styles.mapHintLine}>
                    {`1${mapUnidadeNota || "Und"} de ${mapNomeNota.trim() || "(nome na nota)"} equivale a `}
                    <input className={styles.mapHintInput} value={mapEqQtd} onChange={(e) => setMapEqQtd(e.target.value)} placeholder="____" />
                    {` ${insumosByName.get(mapInsumoEq.toLowerCase())?.medida ?? "Und"} de ${mapInsumoEq || "(insumo)"}`}
                  </div>
                </div>
              </div>

              <div className={styles.confirmActions}>
                <button type="button" className={styles.confirmCancel} onClick={() => setIsAddFornecedorItemOpen(false)}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className={styles.confirmSave}
                  disabled={isReadOnly || !mapNomeNota.trim() || !mapInsumoEq.trim()}
                  onClick={confirmAddItemFornecedor}
                >
                  Salvar
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {isMounted && isFornecedorProdutosOpen && fornecedorModalKey
          ? createPortal(
              <div
                className={styles.modalOverlay}
                role="presentation"
                onClick={() => {
                  setIsFornecedorProdutosOpen(false);
                  setFornecedorModalKey(null);
                  setFornecedorModalLabel("");
                }}
              >
                <div className={`${styles.modal} ${styles.fornecedorProdutosModal}`} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitle}>{fornecedorModalLabel || fornecedorModalKey}</div>
                <button
                  type="button"
                  className={styles.modalClose}
                  aria-label="Fechar"
                  onClick={() => {
                    setIsFornecedorProdutosOpen(false);
                    setFornecedorModalKey(null);
                    setFornecedorModalLabel("");
                  }}
                >
                  ×
                </button>
              </div>

              <div className={styles.fornecedorTop}>
                <div className={styles.fornecedorTopCard}>
                  <div className={styles.fornecedorTopIcon} aria-hidden>
                    <IconUser />
                  </div>
                  <div className={styles.fornecedorTopText}>
                    <div className={styles.fornecedorTopLabel}>Vendedor</div>
                    <div className={styles.fornecedorTopValue}>{fornecedorInfoMap[fornecedorModalKey]?.vendedor || "-"}</div>
                  </div>
                </div>

                <div className={styles.fornecedorTopCard}>
                  <div className={styles.fornecedorTopIcon} aria-hidden>
                    <IconCalendar />
                  </div>
                  <div className={styles.fornecedorTopText}>
                    <div className={styles.fornecedorTopLabel}>Endereço</div>
                    <div className={styles.fornecedorTopValue}>{fornecedorInfoMap[fornecedorModalKey]?.endereco || "-"}</div>
                  </div>
                </div>
              </div>

              <div className={styles.fornecedorSection}>
                <div className={styles.fornecedorSectionTitle}>{`Produtos do Fornecedor (${fornecedorModalProdutosMerged.length})`}</div>
                <div className={styles.fornecedorSectionSub}>
                  Vincule os produtos a este fornecedor para facilitar o registro de compras e a seleção de itens nas notas.
                </div>

                <div className={styles.fornecedorAddRow}>
                  <div className={styles.fornecedorSearch}>
                    <span className={styles.itemSearchIcon} aria-hidden>
                      <IconSearch />
                    </span>
                    <input
                      className={styles.itemSearchInput}
                      placeholder="Pesquise por itens..."
                      value={fornecedorProdutosSearch}
                      onChange={(e) => setFornecedorProdutosSearch(e.target.value)}
                      onFocus={() => {
                        if (!fornecedorProdutosPick && insumosStore[0]) setFornecedorProdutosPick(insumosStore[0].item);
                      }}
                    />
                    <span className={styles.itemSearchChevron} aria-hidden>
                      ▾
                    </span>
                  </div>

                  <button
                    type="button"
                    className={styles.fornecedorAddBtn}
                    onClick={() => {
                      const q = fornecedorProdutosSearch.trim();
                      const pick = fornecedorProdutosPick.trim();
                      const name = q || pick;
                      addProdutoToFornecedor(name);
                      if (name) openConfigurarVinculacao(name);
                      setFornecedorProdutosSearch("");
                    }}
                  >
                    + ADD
                  </button>
                </div>

                <div className={styles.fornecedorList}>
                  {fornecedorModalProdutosMerged
                    .filter((n) => (fornecedorProdutosSearch.trim() ? n.toLowerCase().includes(fornecedorProdutosSearch.trim().toLowerCase()) : true))
                    .map((name) => (
                      <div key={name} className={styles.fornecedorItemRow}>
                        <button
                          type="button"
                          className={styles.fornecedorItemOpenBtn}
                          aria-label="Configurar vinculação"
                          onClick={() => {
                            openConfigurarVinculacao(name);
                          }}
                        >
                          <div className={styles.fornecedorItemNameWrap}>
                            <div className={styles.fornecedorItemName}>{name}</div>
                            <div className={styles.fornecedorItemEq}>
                              {(() => {
                                const raw = (fornecedorModalKey ?? "").trim();
                                const key = raw ? resolveFornecedorKey(raw, fornecedorInfoMap) : "";
                                const map = fornecedorItemMap[key]?.find((m) => m.nomeNaNota.toLowerCase() === name.toLowerCase()) ?? null;
                                const eq = map?.insumoEquivalente ?? (insumosByName.get(name.toLowerCase()) ? name : "");
                                if (!eq) return "-";
                                const qty = String(map?.equivalenteQuantidade ?? "").trim();
                                if (!qty) return eq;
                                const unit = String(map?.equivalenteUnidade ?? insumosByName.get(eq.toLowerCase())?.medida ?? "").trim();
                                return unit ? `${eq} - ${qty} ${unit}` : `${eq} - ${qty}`;
                              })()}
                            </div>
                          </div>
                        </button>
                        <button
                          type="button"
                          className={styles.fornecedorItemTrash}
                          aria-label="Remover"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeProdutoFromFornecedor(name);
                          }}
                        >
                          <IconTrash />
                        </button>
                      </div>
                    ))}
                </div>
              </div>
            </div>
              </div>,
              document.body,
            )
          : null}
            </>
          )}
        </div>
      </main>
    </>
  );
}
