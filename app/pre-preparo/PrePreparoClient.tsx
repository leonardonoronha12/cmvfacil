"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import dash from "../dashboard/dashboard.module.css";
import AppSidebar from "../components/AppSidebar";
import SystemToast from "../components/SystemToast";
import { readEntradasFromStore, subscribeEntradas, type EntradaStoreRow } from "../lib/entradasStore";
import { loadFornecedoresStateFromSupabase } from "../lib/fornecedoresSupabase";
import { subscribeFornecedorEquivalencias, writeFornecedorEquivalenciasMap, type FornecedorEquivalenciasMap } from "../lib/fornecedoresStore";
import { readInsumosFromStore, subscribeInsumos, type InsumoStoreItem, writeInsumosToStore } from "../lib/insumosStore";
import { loadInsumosStateFromSupabase, saveInsumosStateToSupabase } from "../lib/insumosSupabase";
import { readInsumoCategoriasFromStore, subscribeInsumoCategorias, writeInsumoCategoriasToStore } from "../lib/insumoCategoriasStore";
import { loadPrePreparoFromSupabase, savePrePreparoToSupabase } from "../lib/prePreparoSupabase";
import { loadPrePreparoEtiquetasFromSupabase, savePrePreparoEtiquetasToSupabase } from "../lib/prePreparoEtiquetasSupabase";
import type { PrePreparoEtiquetaRow } from "../lib/prePreparoEtiquetasStore";
import ft from "../fichas-tecnicas/fichas-tecnicas.module.css";
import insumosStyles from "../insumos/insumos.module.css";
import styles from "./pre-preparo.module.css";

type PrePreparoRow = {
  id: string;
  categoria: string;
  receita: string;
  custoTotal: string;
  rendimento: string;
  custoUnitario: string;
  validadeDias?: number;
  ingredientes?: IngredienteRow[];
  modoPreparo?: string;
};

type IngredienteRow = {
  id: string;
  item: string;
  quantidade: string;
  unidade: string;
  custoCents: number;
};

function IconPrep() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M7 4h10v2H7V4Zm-2 4h14v2H5V8Zm1 4h12l-1 8H7l-1-8Zm3-7h6v1H9V9Z"
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

function IconLabel() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M3 12V6.5A2.5 2.5 0 0 1 5.5 4H14l7 7-9.5 9.5a2 2 0 0 1-2.8 0L3 14.8V12Zm4.8-4.3a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6Z"
        fill="currentColor"
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

function IconDots() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 10.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z" fill="currentColor" />
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

function IconCubeOutline() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2 3.5 6.75v10.5L12 22l8.5-4.75V6.75L12 2Z" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 22V11.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.5 6.75 12 11.2l8.5-4.45" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function IconEdit() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 17.3V20h2.7l9.9-9.9-2.7-2.7L4 17.3Zm16.8-10.8a.75.75 0 0 0 0-1.1l-2.2-2.2a.75.75 0 0 0-1.1 0l-1.7 1.7 3.3 3.3 1.7-1.7Z"
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

function IconTrash() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 3h6l1 2h4v2H4V5h4l1-2Z" fill="currentColor" />
      <path d="M6 8h12l-1 13H7L6 8Z" fill="currentColor" />
    </svg>
  );
}

function IconEtiqueta() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M7 9V7h2M17 7h-2M17 17v-2M7 17h2"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path d="M9 12h6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="2 3" />
    </svg>
  );
}

function IconPdf() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M14 3v6h6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <text x="8.2" y="17.2" fontSize="6.5" fontWeight="800" fill="currentColor">
        PDF
      </text>
    </svg>
  );
}

function IconTrashOutline() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 3h6l1 2h4v2H4V5h4l1-2Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M6 8h12l-1 13H7L6 8Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M10 11v7M14 11v7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function toTitleCase(value: string) {
  const s = value.trim().toLowerCase();
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function normalizeCategoryName(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function formatCurrencyBRLFromCents(valueCents: number) {
  const value = valueCents / 100;
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function parseCurrencyBRLToCents(value: string) {
  const s = value.replace(/[^\d,.-]/g, "").trim();
  if (!s) return 0;
  const neg = s.includes("-");
  const cleaned = s.replace(/-/g, "");
  const parts = cleaned.split(",");
  const intPart = parts[0].replace(/\./g, "").replace(/[^\d]/g, "") || "0";
  const decPart = (parts[1] ?? "").replace(/[^\d]/g, "").padEnd(2, "0").slice(0, 2);
  const cents = Number.parseInt(intPart, 10) * 100 + Number.parseInt(decPart || "0", 10);
  return neg ? -cents : clampNonNegativeInt(cents);
}

function parsePtNumber(value: string) {
  const raw = value.trim();
  if (!raw) return 0;
  const normalized = raw.replace(/\./g, "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function parseDecimalInput(value: string) {
  const normalized = String(value ?? "").replace(/\./g, "").replace(",", ".");
  const num = Number(normalized);
  return Number.isFinite(num) ? num : 0;
}

function formatDecimal3(value: number) {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}

function formatMoney(value: number) {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDecimalDraft(input: string, maxDecimals = 3) {
  const raw = String(input ?? "").replace(/[^\d,]/g, "");
  if (!raw) return "";
  const hasLeadingComma = raw.startsWith(",");
  const [intRaw = "", decRaw = ""] = raw.split(",", 2);
  const intDigits = intRaw.replace(/\D/g, "");
  const decDigits = decRaw.replace(/\D/g, "").slice(0, maxDecimals);
  const intValue = intDigits ? Number.parseInt(intDigits, 10).toLocaleString("pt-BR") : "0";
  if (hasLeadingComma) return decDigits ? `0,${decDigits}` : "0,";
  if (raw.includes(",")) return `${intValue},${decDigits}`;
  return intValue;
}

function formatDecimalFixedDraft(input: string, maxDecimals = 3) {
  const value = parseDecimalInput(input);
  return value > 0
    ? value.toLocaleString("pt-BR", {
        minimumFractionDigits: maxDecimals,
        maximumFractionDigits: maxDecimals,
      })
    : `0,${"0".repeat(maxDecimals)}`;
}

function parseMoneyLabel(value?: string) {
  const raw = String(value ?? "").replace(/[^\d,.-]/g, "").trim();
  if (!raw) return 0;
  return parseDecimalInput(raw);
}

function formatQtyLabel(value: string, unidade: string) {
  const qty = parseDecimalInput(value);
  if (!Number.isFinite(qty)) return `0 ${unidade}`;
  const label = Number.isInteger(qty) ? String(qty) : qty.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 3 });
  return `${label} ${unidade}`;
}

function DetailsPlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5V19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M5 12H19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function DetailsSearchMiniIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M10.5 4.5A6 6 0 1 0 10.5 16.5A6 6 0 0 0 10.5 4.5Z" stroke="currentColor" strokeWidth="1.8" />
      <path d="M15 15L19.5 19.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function DetailsChevronDoubleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7.5 7.5L12 12L16.5 7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7.5 12.5L12 17L16.5 12.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DetailsTrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5.5 7.5H18.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M9.5 4.75H14.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M8 7.5V17.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M12 7.5V17.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M16 7.5V17.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M6.5 7.5V18C6.5 18.5523 6.94772 19 7.5 19H16.5C17.0523 19 17.5 18.5523 17.5 18V7.5" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function DetailsPdfIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 4.5H14.5L18 8V19A1.5 1.5 0 0 1 16.5 20.5H7A1.5 1.5 0 0 1 5.5 19V6A1.5 1.5 0 0 1 7 4.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M14 4.5V8H17.5" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M8 15.5H9.4C10.3 15.5 10.9 14.9 10.9 14C10.9 13.1 10.3 12.5 9.4 12.5H8V16.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12.5 16.8V12.5H13.7C14.9 12.5 15.7 13.4 15.7 14.65C15.7 15.9 14.9 16.8 13.7 16.8H12.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17.2 16.8V12.5H19.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17.2 14.6H19.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function DetailsEditIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4.5 19.5H8L18.2 9.3C18.98 8.52 18.98 7.26 18.2 6.48L17.52 5.8C16.74 5.02 15.48 5.02 14.7 5.8L4.5 16V19.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M13.5 7L17 10.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function DetailsIconCalendarSmall() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6.75 4.5H17.25V19.5H6.75V4.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M12 8.25V14.25" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M9.75 12L12 14.25L14.25 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DetailsCheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5.5 12.5L10 17L18.5 8.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DetailsXIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 7L17 17" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M17 7L7 17" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

function formatBRLValueFromCents(valueCents: number) {
  const v = Math.abs(valueCents);
  const intPart = Math.floor(v / 100);
  const dec = String(v % 100).padStart(2, "0");
  const intLabel = String(intPart).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${valueCents < 0 ? "-" : ""}${intLabel},${dec}`;
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

function normalizeUnit(value: string) {
  return value.trim().toLowerCase();
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

const PREPREPARO_HIDE_KEY = "cmvfacil.prepreparo.hidden.v1";

function readPrePreparoHiddenMap(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  const raw = window.localStorage.getItem(PREPREPARO_HIDE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed ?? {})) out[k] = Boolean(v);
    return out;
  } catch {
    return {};
  }
}

function writePrePreparoHiddenMap(map: Record<string, boolean>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PREPREPARO_HIDE_KEY, JSON.stringify(map ?? {}));
}

function convertQty(qty: number, fromUnit: string, toUnit: string) {
  const from = normalizeUnit(fromUnit);
  const to = normalizeUnit(toUnit);
  if (!from || !to || from === to) return qty;
  if (from === "g" && to === "kg") return qty / 1000;
  if (from === "kg" && to === "g") return qty * 1000;
  if (from === "ml" && to === "l") return qty / 1000;
  if (from === "l" && to === "ml") return qty * 1000;
  return NaN;
}

function formatPtQty(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (Math.abs(value - Math.round(value)) < 1e-9) return String(Math.round(value));
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function clampNonNegativeInt(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

function formatDateLabel(d: Date) {
  const day = String(d.getDate()).padStart(2, "0");
  const month = d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
  const year = d.getFullYear();
  return `${day} ${month}, ${year}`;
}

function formatDateNumeric(d: Date) {
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
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
    fev: 1,
    fevereiro: 1,
    feb: 1,
    mar: 2,
    março: 2,
    marco: 2,
    abr: 3,
    abril: 3,
    apr: 3,
    mai: 4,
    maio: 4,
    may: 4,
    jun: 5,
    junho: 5,
    jul: 6,
    julho: 6,
    ago: 7,
    agosto: 7,
    aug: 7,
    set: 8,
    setembro: 8,
    sep: 8,
    out: 9,
    outubro: 9,
    oct: 9,
    nov: 10,
    novembro: 10,
    dez: 11,
    dezembro: 11,
    dec: 11,
  };
  const month = monthMap[monRaw];
  if (month === undefined) return null;
  const d = new Date(year, month, day);
  if (d.getFullYear() !== year || d.getMonth() !== month || d.getDate() !== day) return null;
  return d;
}

function parseRecipeUnitCost(row: PrePreparoRow) {
  const unitCostLabel = String(row.custoUnitario ?? "").trim();
  const direct = unitCostLabel.match(/R\$\s*([\d.,]+)\s*\/\s*([A-Za-zÀ-ÿ]+)/i);
  if (direct) {
    return {
      cents: clampNonNegativeInt(parseCurrencyBRLToCents(String(direct[1] ?? ""))),
      unit: String(direct[2] ?? "").trim() || "Und",
    };
  }
  const totalCents = clampNonNegativeInt(parseCurrencyBRLToCents(row.custoTotal));
  const { qty, unit } = parseQtyLabel(row.rendimento);
  if (!qty || !totalCents) return null;
  return {
    cents: clampNonNegativeInt(Math.round(totalCents / qty)),
    unit: unit || "Und",
  };
}

function computeEtiquetaCostCents(row: PrePreparoRow, quantidade: number, unidade: string) {
  if (!Number.isFinite(quantidade) || quantidade <= 0) return 0;
  const unitCost = parseRecipeUnitCost(row);
  if (!unitCost || unitCost.cents <= 0) return 0;
  const qtyInCostUnit = unidade ? convertQty(quantidade, unidade, unitCost.unit) : quantidade;
  const finalQty = Number.isFinite(qtyInCostUnit) && qtyInCostUnit > 0 ? qtyInCostUnit : quantidade;
  return clampNonNegativeInt(Math.round(unitCost.cents * finalQty));
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, delta: number) {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}

function IconPlusCircle() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 8v8M8 12h8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconTrashSmall() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 3h6l1 2h4v2H4V5h4l1-2Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M6 8h12l-1 13H7L6 8Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M10 11v7M14 11v7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconChevronDownDouble() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 7.5 12 12.5l5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 12 12 17l5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function PrePreparoClient() {
  const toastTimerRef = useRef<number | null>(null);
  const savePrePreparoTimeoutRef = useRef<number | null>(null);
  const saveEtiquetasTimeoutRef = useRef<number | null>(null);
  const prePreparoLoadedRef = useRef(false);
  const etiquetasLoadedRef = useRef(false);
  const prePreparoSaveErrorShownRef = useRef(false);
  const etiquetasSaveErrorShownRef = useRef(false);
  const prePreparoLoadErrorShownRef = useRef(false);
  const etiquetasLoadErrorShownRef = useRef(false);
  const [isMounted, setIsMounted] = useState(false);
  const [toast, setToast] = useState<{ title: string; message: string; tone: "success" | "error" } | null>(null);
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("Categorias");
  const [rows, setRows] = useState<PrePreparoRow[]>([]);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuWrapRef = useRef<HTMLDivElement | null>(null);
  const [detailsRecipeId, setDetailsRecipeId] = useState<string | null>(null);
  const [detailsTab, setDetailsTab] = useState<"ingredientes" | "preparo" | "etiquetas">("ingredientes");
  const [detailIngredientId, setDetailIngredientId] = useState("");
  const [detailIngredientQty, setDetailIngredientQty] = useState("0,000");
  const [rowEditId, setRowEditId] = useState<string | null>(null);
  const [rowEditIngredientId, setRowEditIngredientId] = useState("");
  const [rowEditQty, setRowEditQty] = useState("0,000");
  const [isEditingPrep, setIsEditingPrep] = useState(false);
  const [prepDraft, setPrepDraft] = useState("");
  const [isEditingYield, setIsEditingYield] = useState(false);
  const [yieldDraftQty, setYieldDraftQty] = useState("0,000");
  const [yieldDraftUnit, setYieldDraftUnit] = useState("Kg");
  const yieldEditWrapRef = useRef<HTMLDivElement | null>(null);
  const [hiddenMap, setHiddenMap] = useState<Record<string, boolean>>(() => readPrePreparoHiddenMap());
  const [insumosStore, setInsumosStore] = useState<InsumoStoreItem[]>([]);
  const [insumoCategorias, setInsumoCategorias] = useState<string[]>(() => readInsumoCategoriasFromStore());
  const [entradasRows, setEntradasRows] = useState<EntradaStoreRow[]>([]);
  const [equivalenciasMap, setEquivalenciasMap] = useState<FornecedorEquivalenciasMap>({});
  const [etiquetasRows, setEtiquetasRows] = useState<PrePreparoEtiquetaRow[]>([]);

  function showToast(message: string, type: "success" | "error", durationMs = 4500) {
    setToast({ title: type === "success" ? "Sucesso" : "Erro", message, tone: type });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, durationMs);
  }

  function supabaseSaveErrorMessage(err: unknown) {
    const msg = (err instanceof Error ? err.message : String(err ?? "")).trim();
    if (!msg) return "Não foi possível salvar no Supabase.";
    if (msg === "unauthorized" || msg.includes("401")) return "Sessão expirada. Faça login novamente.";
    if (msg.toLowerCase().includes("does not exist")) return "Tabela do Supabase não existe (execute o setup do Supabase).";
    return `Não foi possível salvar no Supabase (${msg}).`;
  }

  function supabaseLoadErrorMessage(err: unknown) {
    const msg = (err instanceof Error ? err.message : String(err ?? "")).trim();
    if (!msg) return "Não foi possível carregar do Supabase.";
    if (msg === "unauthorized" || msg.includes("401")) return "Sessão expirada. Faça login novamente.";
    if (msg.toLowerCase().includes("does not exist")) return "Tabela do Supabase não existe (execute o setup do Supabase).";
    return `Não foi possível carregar do Supabase (${msg}).`;
  }

  const [isNewRecipeOpen, setIsNewRecipeOpen] = useState(false);
  const [newRecipeStep, setNewRecipeStep] = useState<1 | 2 | 3>(1);
  const [newRecipeName, setNewRecipeName] = useState("");
  const [newRecipeSpec, setNewRecipeSpec] = useState("");
  const [newRecipeCategory, setNewRecipeCategory] = useState("");
  const [newRecipeUnit, setNewRecipeUnit] = useState("");
  const [newRecipeValidity, setNewRecipeValidity] = useState("7");
  const [newRecipeValidityUnit, setNewRecipeValidityUnit] = useState("Dia(s)");
  const newRecipeFileRef = useRef<HTMLInputElement | null>(null);
  const [newRecipeIngredients, setNewRecipeIngredients] = useState<IngredienteRow[]>([]);
  const [ingredientQuery, setIngredientQuery] = useState("");
  const [ingredientQty, setIngredientQty] = useState("0,000");
  const [ingredientUnit, setIngredientUnit] = useState("Und");
  const [ingredientCost, setIngredientCost] = useState("0,00");
  const [newRecipeYield, setNewRecipeYield] = useState("0,000");
  const [newRecipeYieldUnit, setNewRecipeYieldUnit] = useState("Kg");

  const [isCategoriasOpen, setIsCategoriasOpen] = useState(false);
  const [categoryModalTarget, setCategoryModalTarget] = useState<"new" | "edit">("new");
  const [categoryNewDraft, setCategoryNewDraft] = useState("");
  const [editingCategoryOriginal, setEditingCategoryOriginal] = useState<string | null>(null);
  const [editingCategoryDraft, setEditingCategoryDraft] = useState("");
  const [isDeleteCategoryOpen, setIsDeleteCategoryOpen] = useState(false);
  const [deletingCategoryName, setDeletingCategoryName] = useState("");
  const [deletingCategoryCount, setDeletingCategoryCount] = useState(0);

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftCategory, setDraftCategory] = useState("");
  const [draftSpec, setDraftSpec] = useState("");
  const [draftUnit, setDraftUnit] = useState("Kg");
  const [draftValidity, setDraftValidity] = useState("7");
  const [draftValidityUnit, setDraftValidityUnit] = useState("Dia(s)");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [isEtiquetaOpen, setIsEtiquetaOpen] = useState(false);
  const [etiquetaRecipeId, setEtiquetaRecipeId] = useState<string | null>(null);
  const [etiquetaRecipeQuery, setEtiquetaRecipeQuery] = useState("");
  const [isRecipeOpen, setIsRecipeOpen] = useState(false);
  const recipeWrapRef = useRef<HTMLDivElement | null>(null);
  const [etiquetaResponsavel, setEtiquetaResponsavel] = useState("");
  const [etiquetaQtd, setEtiquetaQtd] = useState("1,000");
  const [etiquetaUnidade, setEtiquetaUnidade] = useState("Kg");
  const [etiquetaDataProd, setEtiquetaDataProd] = useState(() => formatDateLabel(new Date()));
  const [etiquetaDataVal, setEtiquetaDataVal] = useState(() => formatDateLabel(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)));
  const [openEtiquetaCalendar, setOpenEtiquetaCalendar] = useState<"prod" | "val" | null>(null);
  const [etiquetaMonth, setEtiquetaMonth] = useState(() => startOfMonth(new Date()));
  const [etiquetaCalendarAnchor, setEtiquetaCalendarAnchor] = useState<{ x: number; y: number; place: "below" | "above" } | null>(null);
  const etiquetaProdWrapRef = useRef<HTMLDivElement | null>(null);
  const etiquetaValWrapRef = useRef<HTMLDivElement | null>(null);
  const etiquetaCalendarRef = useRef<HTMLDivElement | null>(null);

  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingName, setDeletingName] = useState("");
  const [isIngredientMenuOpen, setIsIngredientMenuOpen] = useState(false);
  const ingredientWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (newRecipeValidityUnit !== "Dia(s)") setNewRecipeValidityUnit("Dia(s)");
  }, [newRecipeValidityUnit]);

  function openCategoriasModal(target: "new" | "edit") {
    setCategoryModalTarget(target);
    setCategoryNewDraft("");
    setEditingCategoryOriginal(null);
    setEditingCategoryDraft("");
    setIsDeleteCategoryOpen(false);
    setDeletingCategoryName("");
    setDeletingCategoryCount(0);
    setIsCategoriasOpen(true);
  }

  const categoryCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of insumosStore) {
      const name = toTitleCase(normalizeCategoryName(String(r.categoria ?? "")));
      if (!name || name === "-") continue;
      map.set(name, (map.get(name) ?? 0) + 1);
    }
    return map;
  }, [insumosStore]);

  const categoriesSorted = useMemo(() => {
    const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });
    return [...insumoCategorias].filter((c) => normalizeCategoryName(c).toLowerCase() !== "todas").sort((a, b) => collator.compare(a, b));
  }, [insumoCategorias]);

  async function persistInsumosCategories(nextCategories: string[], applyRowRename?: { from: string; to: string }, applyRowDelete?: string) {
    const latest = await loadInsumosStateFromSupabase().catch(() => null);
    const baseRows = latest?.rows?.length ? latest.rows : readInsumosFromStore();
    const rows = baseRows.map((r) => {
      const cat = toTitleCase(normalizeCategoryName(String(r.categoria ?? "")));
      if (applyRowRename && cat.toLowerCase() === applyRowRename.from.toLowerCase()) return { ...r, categoria: applyRowRename.to };
      if (applyRowDelete && cat.toLowerCase() === applyRowDelete.toLowerCase()) return { ...r, categoria: "-" };
      return r;
    });
    writeInsumosToStore(rows as any);
    setInsumosStore(rows as any);
    await saveInsumosStateToSupabase({ rows, categories: nextCategories });
  }

  async function addCategoriaFromModal() {
    const name = toTitleCase(normalizeCategoryName(categoryNewDraft.trim()));
    if (!name || name === "-") return;
    const existsKey = name.toLowerCase();
    const nextCategories = insumoCategorias.some((c) => c.toLowerCase() === existsKey) ? insumoCategorias : [...insumoCategorias, name];
    setInsumoCategorias(nextCategories);
    writeInsumoCategoriasToStore(nextCategories);
    setCategoryNewDraft("");

    if (categoryModalTarget === "new") setNewRecipeCategory(name);
    else setDraftCategory(name);

    try {
      await persistInsumosCategories(nextCategories);
      showToast("Categoria adicionada!", "success");
    } catch (err) {
      showToast(supabaseSaveErrorMessage(err), "error");
    }
  }

  function editCategoria(name: string) {
    setEditingCategoryOriginal(name);
    setEditingCategoryDraft(name);
  }

  function cancelEditCategoria() {
    setEditingCategoryOriginal(null);
    setEditingCategoryDraft("");
  }

  async function confirmEditCategoria() {
    const from = editingCategoryOriginal;
    if (!from) return;
    const name = toTitleCase(normalizeCategoryName(editingCategoryDraft.trim()));
    if (!name) return;

    const existsKey = name.toLowerCase();
    const fromKey = from.toLowerCase();
    if (fromKey !== existsKey && insumoCategorias.some((c) => c.toLowerCase() === existsKey)) {
      window.alert("Já existe uma categoria com esse nome.");
      return;
    }

    const nextCategories = insumoCategorias.map((c) => (c === from ? name : c));
    setInsumoCategorias(nextCategories);
    writeInsumoCategoriasToStore(nextCategories);
    setRows((prev) => prev.map((r) => (r.categoria === from ? { ...r, categoria: name } : r)));
    if (draftCategory === from) setDraftCategory(name);
    if (newRecipeCategory === from) setNewRecipeCategory(name);
    cancelEditCategoria();

    try {
      await persistInsumosCategories(nextCategories, { from, to: name });
      showToast("Categoria atualizada!", "success");
    } catch (err) {
      showToast(supabaseSaveErrorMessage(err), "error");
    }
  }

  function openDeleteCategoria(name: string) {
    setDeletingCategoryName(name);
    setDeletingCategoryCount(categoryCounts.get(name) ?? 0);
    setIsDeleteCategoryOpen(true);
  }

  function cancelDeleteCategoria() {
    setIsDeleteCategoryOpen(false);
    setDeletingCategoryName("");
    setDeletingCategoryCount(0);
  }

  async function confirmDeleteCategoria() {
    const name = deletingCategoryName;
    if (!name) return;
    const nextCategories = insumoCategorias.filter((c) => c !== name);
    setInsumoCategorias(nextCategories);
    writeInsumoCategoriasToStore(nextCategories);
    setRows((prev) => prev.map((r) => (r.categoria === name ? { ...r, categoria: "-" } : r)));
    if (draftCategory === name) setDraftCategory("");
    if (newRecipeCategory === name) setNewRecipeCategory("");
    if (editingCategoryOriginal === name) cancelEditCategoria();
    cancelDeleteCategoria();

    try {
      await persistInsumosCategories(nextCategories, undefined, name);
      showToast("Categoria excluída!", "success");
    } catch (err) {
      showToast(supabaseSaveErrorMessage(err), "error");
    }
  }

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (draftValidityUnit !== "Dia(s)") setDraftValidityUnit("Dia(s)");
  }, [draftValidityUnit]);

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
      setInsumosStore(readInsumosFromStore());
      setInsumoCategorias(readInsumoCategoriasFromStore());
    })();
    const unsubInsumos = subscribeInsumos((rows) => setInsumosStore(rows));
    const unsubCats = subscribeInsumoCategorias((rows) => setInsumoCategorias(rows));
    return () => {
      unsubInsumos();
      unsubCats();
    };
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const dbRows = await loadPrePreparoFromSupabase();
        setRows(dbRows as any);
        prePreparoLoadErrorShownRef.current = false;
        prePreparoLoadedRef.current = true;
      } catch (err) {
        if (!prePreparoLoadErrorShownRef.current) {
          prePreparoLoadErrorShownRef.current = true;
          showToast(supabaseLoadErrorMessage(err), "error");
        }
      }
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const dbRows = await loadPrePreparoEtiquetasFromSupabase();
        setEtiquetasRows(dbRows);
        etiquetasLoadErrorShownRef.current = false;
        etiquetasLoadedRef.current = true;
      } catch (err) {
        if (!etiquetasLoadErrorShownRef.current) {
          etiquetasLoadErrorShownRef.current = true;
          showToast(supabaseLoadErrorMessage(err), "error");
        }
      }
    })();
  }, []);

  useEffect(() => {
    if (!prePreparoLoadedRef.current) return;
    if (savePrePreparoTimeoutRef.current) window.clearTimeout(savePrePreparoTimeoutRef.current);
    savePrePreparoTimeoutRef.current = window.setTimeout(() => {
      void savePrePreparoToSupabase(rows as any)
        .then(() => {
          prePreparoSaveErrorShownRef.current = false;
        })
        .catch(async () => {
          try {
            await new Promise((r) => window.setTimeout(r, 700));
            await savePrePreparoToSupabase(rows as any);
            prePreparoSaveErrorShownRef.current = false;
          } catch (err2) {
            if (!prePreparoSaveErrorShownRef.current) {
              prePreparoSaveErrorShownRef.current = true;
              showToast(supabaseSaveErrorMessage(err2), "error");
            }
          }
        });
    }, 700);
  }, [rows]);

  useEffect(() => {
    if (!etiquetasLoadedRef.current) return;
    if (saveEtiquetasTimeoutRef.current) window.clearTimeout(saveEtiquetasTimeoutRef.current);
    saveEtiquetasTimeoutRef.current = window.setTimeout(() => {
      void savePrePreparoEtiquetasToSupabase(etiquetasRows)
        .then(() => {
          etiquetasSaveErrorShownRef.current = false;
        })
        .catch(async () => {
          try {
            await new Promise((r) => window.setTimeout(r, 700));
            await savePrePreparoEtiquetasToSupabase(etiquetasRows);
            etiquetasSaveErrorShownRef.current = false;
          } catch (err2) {
            if (!etiquetasSaveErrorShownRef.current) {
              etiquetasSaveErrorShownRef.current = true;
              showToast(supabaseSaveErrorMessage(err2), "error");
            }
          }
        });
    }, 700);
  }, [etiquetasRows]);

  useEffect(() => {
    writePrePreparoHiddenMap(hiddenMap);
  }, [hiddenMap]);

  useEffect(() => {
    if (!detailsRecipeId) return;
    setDetailIngredientId("");
    setDetailIngredientQty("0,000");
    setRowEditId(null);
    setRowEditIngredientId("");
    setRowEditQty("0,000");
    setIsEditingPrep(false);
    setPrepDraft("");
    setIsEditingYield(false);
    setYieldDraftQty("0,000");
    setYieldDraftUnit("Kg");
  }, [detailsRecipeId]);

  useEffect(() => {
    if (!isEditingYield) return;
    function onDown(e: MouseEvent) {
      const el = yieldEditWrapRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      saveYieldEdit();
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [detailsRecipeId, isEditingYield, yieldDraftQty, yieldDraftUnit]);

  useEffect(() => {
    setEntradasRows(readEntradasFromStore());
    return subscribeEntradas((rows) => setEntradasRows(rows));
  }, []);

  useEffect(() => {
    (async () => {
      let nextEq: FornecedorEquivalenciasMap = {};
      try {
        const db = await loadFornecedoresStateFromSupabase();
        const hasDb = Object.keys(db.info).length || Object.keys(db.produtos).length || Object.keys(db.equivalencias).length;
        if (hasDb) nextEq = db.equivalencias;
      } catch {}
      writeFornecedorEquivalenciasMap(nextEq);
      setEquivalenciasMap(nextEq);
    })();
    return subscribeFornecedorEquivalencias((m) => setEquivalenciasMap(m));
  }, []);

  useEffect(() => {
    if (!openMenuId) return;
    function onDown(e: MouseEvent) {
      const el = menuWrapRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      setOpenMenuId(null);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [openMenuId]);

  useEffect(() => {
    if (!isRecipeOpen) return;
    function onDown(e: MouseEvent) {
      const el = recipeWrapRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      setIsRecipeOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [isRecipeOpen]);

  useEffect(() => {
    if (!openEtiquetaCalendar) return;
    function onDown(e: MouseEvent) {
      const p = etiquetaProdWrapRef.current;
      const v = etiquetaValWrapRef.current;
      const c = etiquetaCalendarRef.current;
      if (!p && !v && !c) return;
      if (e.target instanceof Node && ((p && p.contains(e.target)) || (v && v.contains(e.target)) || (c && c.contains(e.target)))) return;
      setOpenEtiquetaCalendar(null);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [openEtiquetaCalendar]);

  useEffect(() => {
    if (!isIngredientMenuOpen) return;
    function onDown(e: MouseEvent) {
      const el = ingredientWrapRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      setIsIngredientMenuOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [isIngredientMenuOpen]);

  const insumosByName = useMemo(() => {
    const map = new Map<string, InsumoStoreItem>();
    for (const i of insumosStore) map.set(i.item.toLowerCase(), i);
    return map;
  }, [insumosStore]);

  const insumosByKey = useMemo(() => {
    const map = new Map<string, InsumoStoreItem>();
    const dup = new Set<string>();
    for (const i of insumosStore) {
      const key = normalizeNameKey(i.item);
      if (!key) continue;
      if (map.has(key)) dup.add(key);
      else map.set(key, i);
    }
    for (const k of dup) map.delete(k);
    return map;
  }, [insumosStore]);

  const resolveInsumoFromQuery = useMemo(() => {
    const items = insumosStore.map((i) => i);
    return (q: string) => {
      const raw = q.trim();
      if (!raw) return null;
      const direct = insumosByName.get(raw.toLowerCase());
      if (direct) return direct;
      const key = normalizeNameKey(raw);
      if (key) {
        const byKey = insumosByKey.get(key);
        if (byKey) return byKey;
        if (key.length >= 4) {
          const candidates = items.filter((i) => normalizeNameKey(i.item).includes(key));
          if (candidates.length === 1) return candidates[0];
        }
      }
      return null;
    };
  }, [insumosByKey, insumosByName, insumosStore]);

  const averageCostByInsumo = useMemo(() => {
    const acc = new Map<string, { sumCents: number; sumQty: number; unit: string }>();
    for (const e of entradasRows) {
      const fornecedorKey = String(e.fornecedor ?? "").trim().toUpperCase();
      for (const it of e.itensNota ?? []) {
        const { qty, unit } = parseQtyLabel(it.quantidadeLabel);
        if (!qty) continue;
        const subtotalCents = parseCurrencyBRLToCents(it.subtotalLabel);
        if (!subtotalCents) continue;
        const map = equivalenciasMap[fornecedorKey]?.find((m) => m.nomeNaNota.toLowerCase() === it.nome.toLowerCase()) ?? null;
        if (map) {
          const eqName = String(map.insumoEquivalente ?? "").trim();
          if (!eqName) continue;
          const ins = insumosByName.get(eqName.toLowerCase()) ?? insumosByKey.get(normalizeNameKey(eqName));
          const baseUnit = String(map.equivalenteUnidade ?? ins?.medida ?? "").trim();
          const fromOk = !unit || normalizeUnit(unit) === normalizeUnit(String(map.unidadeNaNota ?? ""));
          if (!fromOk) continue;
          const factor = parsePtNumber(String(map.equivalenteQuantidade ?? ""));
          if (!factor) continue;
          const qtyEq = qty * factor;
          const targetUnit = String(ins?.medida ?? baseUnit).trim();
          const qtyInTarget = baseUnit && targetUnit ? convertQty(qtyEq, baseUnit, targetUnit) : qtyEq;
          if (!Number.isFinite(qtyInTarget) || qtyInTarget <= 0) continue;
          const key = eqName.toLowerCase();
          const cur = acc.get(key) ?? { sumCents: 0, sumQty: 0, unit: targetUnit || baseUnit || "Und" };
          acc.set(key, { sumCents: cur.sumCents + subtotalCents, sumQty: cur.sumQty + qtyInTarget, unit: cur.unit });
          continue;
        }

        const ins = insumosByName.get(it.nome.toLowerCase()) ?? insumosByKey.get(normalizeNameKey(it.nome));
        if (!ins) continue;
        const targetUnit = String(ins.medida ?? "Und").trim();
        const qtyInTarget = unit ? convertQty(qty, unit, targetUnit) : qty;
        if (!Number.isFinite(qtyInTarget) || qtyInTarget <= 0) continue;
        const key = ins.item.toLowerCase();
        const cur = acc.get(key) ?? { sumCents: 0, sumQty: 0, unit: targetUnit };
        acc.set(key, { sumCents: cur.sumCents + subtotalCents, sumQty: cur.sumQty + qtyInTarget, unit: cur.unit });
      }
    }
    return acc;
  }, [entradasRows, equivalenciasMap, insumosByKey, insumosByName]);

  useEffect(() => {
    if (!insumosStore.length) return;
    setRows((prev) => {
      let changed = false;
      const next = prev.map((row) => {
        const ingredientes = row.ingredientes ?? [];
        if (!ingredientes.length) return row;
        let ingredientesChanged = false;
        const nextIngredientes = ingredientes.map((ing) => {
          const byName = insumosByName.get(String(ing.item ?? "").toLowerCase());
          const byKey = insumosByKey.get(normalizeNameKey(String(ing.item ?? "")));
          const ins = byName ?? byKey ?? null;
          if (!ins) return ing;
          const qty = parseDecimalInput(String(ing.quantidade ?? ""));
          if (!(qty > 0)) return ing;
          const stats = averageCostByInsumo.get(ins.item.toLowerCase()) ?? null;
          const unitForCost = String(stats?.unit ?? ins.medida ?? "Und").trim() || "Und";
          const unitCents =
            stats && stats.sumQty > 0 && stats.sumCents > 0
              ? clampNonNegativeInt(Math.round(stats.sumCents / stats.sumQty))
              : clampNonNegativeInt(parseCurrencyBRLToCents(String(ins.custoMedio ?? "")));
          if (unitCents <= 0) return ing;
          const fromUnit = String(ing.unidade ?? unitForCost).trim() || unitForCost;
          const qtyInCostUnit = fromUnit && unitForCost ? convertQty(qty, fromUnit, unitForCost) : qty;
          const finalQty = Number.isFinite(qtyInCostUnit) && qtyInCostUnit > 0 ? qtyInCostUnit : qty;
          const costCents = clampNonNegativeInt(Math.round(unitCents * finalQty));
          if (costCents === clampNonNegativeInt(ing.custoCents)) return ing;
          ingredientesChanged = true;
          return { ...ing, custoCents: costCents, unidade: fromUnit };
        });
        if (!ingredientesChanged) return row;
        changed = true;
        const totalCents = nextIngredientes.reduce((sum, r) => sum + clampNonNegativeInt(r.custoCents), 0);
        const yieldParsed = parseQtyLabel(row.rendimento);
        const yieldQty = yieldParsed.qty;
        const yieldUnit = yieldParsed.unit || "Und";
        const totalLabel = formatCurrencyBRLFromCents(totalCents);
        const unitCost = yieldQty > 0 ? totalCents / 100 / yieldQty : 0;
        const unitCostLabel = `${unitCost.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} / ${yieldUnit}`;
        return { ...row, ingredientes: nextIngredientes, custoTotal: totalLabel, custoUnitario: unitCostLabel };
      });
      return changed ? next : prev;
    });
  }, [averageCostByInsumo, insumosByKey, insumosByName, insumosStore.length]);

  useEffect(() => {
    const resolved = resolveInsumoFromQuery(ingredientQuery);
    if (resolved) {
      const targetUnit = String(resolved.medida ?? "Und").trim() || "Und";
      if (ingredientUnit !== targetUnit) setIngredientUnit(targetUnit);
    }

    const ins = resolved;
    if (!ins) {
      setIngredientCost("0,00");
      return;
    }
    const qty = parsePtNumber(ingredientQty);
    if (!qty) {
      setIngredientCost("0,00");
      return;
    }
    const stats = averageCostByInsumo.get(ins.item.toLowerCase());
    if (stats && stats.sumQty > 0 && stats.sumCents > 0) {
      const qtyInTarget = ingredientUnit ? convertQty(qty, ingredientUnit, stats.unit) : qty;
      if (Number.isFinite(qtyInTarget) && qtyInTarget > 0) {
        const cents = clampNonNegativeInt(Math.round((stats.sumCents * qtyInTarget) / stats.sumQty));
        setIngredientCost(formatBRLValueFromCents(cents));
        return;
      }
    }

    const insUnitCostCents = clampNonNegativeInt(parseCurrencyBRLToCents(String(ins.custoMedio ?? "")));
    if (insUnitCostCents <= 0) {
      setIngredientCost("0,00");
      return;
    }
    const baseUnit = String(ins.medida ?? "Und").trim() || "Und";
    const qtyInBase = ingredientUnit ? convertQty(qty, ingredientUnit, baseUnit) : qty;
    if (!Number.isFinite(qtyInBase) || qtyInBase <= 0) {
      setIngredientCost("0,00");
      return;
    }
    const cents = clampNonNegativeInt(Math.round(insUnitCostCents * qtyInBase));
    setIngredientCost(formatBRLValueFromCents(cents));
  }, [averageCostByInsumo, ingredientQty, ingredientQuery, ingredientUnit, resolveInsumoFromQuery]);

  const ingredientSuggestions = useMemo(() => {
    const list = insumosStore.map((i) => i.item);
    const q = ingredientQuery.trim().toLowerCase();
    const filtered = q ? list.filter((n) => n.toLowerCase().includes(q)) : list;
    return filtered.slice(0, 10);
  }, [ingredientQuery, insumosStore]);

  function openEditModal(row: PrePreparoRow) {
    setEditingId(row.id);
    setDraftName(row.receita);
    const from = toTitleCase(normalizeCategoryName(String(row.categoria ?? "")));
    const match = recipeCategories.find((c) => c.toLowerCase() === from.toLowerCase()) ?? "";
    setDraftCategory(match);
    setDraftSpec("");
    setDraftUnit("Kg");
    setDraftValidity("7");
    setDraftValidityUnit("Dia(s)");
    setIsEditOpen(true);
  }

  function openNewRecipeModal() {
    setNewRecipeStep(1);
    setNewRecipeName("");
    setNewRecipeSpec("");
    setNewRecipeCategory("");
    setNewRecipeUnit("");
    setNewRecipeValidity("7");
    setNewRecipeValidityUnit("Dia(s)");
    setNewRecipeIngredients([]);
    setIngredientQuery("");
    setIngredientQty("0,000");
    setIngredientUnit("Und");
    setIngredientCost("0,00");
    setNewRecipeYield("0,000");
    setNewRecipeYieldUnit("Kg");
    setIsNewRecipeOpen(true);
    if (newRecipeFileRef.current) newRecipeFileRef.current.value = "";
  }

  function openEtiquetaModal(row?: PrePreparoRow | null) {
    const base = new Date();
    setEtiquetaQtd("1,000");
    setEtiquetaDataProd(formatDateLabel(base));
    setOpenEtiquetaCalendar(null);
    setEtiquetaMonth(startOfMonth(base));
    if (row) {
      setEtiquetaRecipeId(row.id);
      setEtiquetaRecipeQuery(row.receita);
      setEtiquetaUnidade("Kg");
      setEtiquetaDataVal(formatDateLabel(new Date(base.getTime() + 7 * 24 * 60 * 60 * 1000)));
    } else {
      setEtiquetaRecipeId(null);
      setEtiquetaRecipeQuery("");
      setEtiquetaUnidade("Und");
      setEtiquetaDataVal(formatDateLabel(base));
    }
    setIsEtiquetaOpen(true);
    setIsRecipeOpen(false);
  }

  function openEtiquetaCalendarAt(kind: "prod" | "val") {
    const now = new Date();
    setEtiquetaMonth(startOfMonth(now));
    setOpenEtiquetaCalendar(kind);
    const wrap = kind === "prod" ? etiquetaProdWrapRef.current : etiquetaValWrapRef.current;
    const target = (wrap?.querySelector("input") as HTMLElement | null) ?? wrap;
    const rect = target?.getBoundingClientRect?.();
    if (!rect) return;
    const estimatedHeight = 320;
    const place: "below" | "above" = rect.bottom + 6 + estimatedHeight > window.innerHeight - 10 ? "above" : "below";
    setEtiquetaCalendarAnchor({
      x: rect.left + rect.width / 2,
      y: place === "below" ? rect.bottom + 6 : rect.top - 6,
      place,
    });
  }

  function renderEtiquetaCalendar(kind: "prod" | "val") {
    if (!etiquetaCalendarAnchor) return null;
    const selectedLabel = kind === "prod" ? etiquetaDataProd : etiquetaDataVal;
    const selected = parseDateLabelLoose(selectedLabel);
    const place = etiquetaCalendarAnchor.place;
    return (
      <div
        ref={etiquetaCalendarRef}
        className={styles.calendarPopover}
        role="dialog"
        aria-label={kind === "prod" ? "Selecionar data de produção" : "Selecionar data de validade"}
        style={{
          position: "fixed",
          left: etiquetaCalendarAnchor.x,
          top: etiquetaCalendarAnchor.y,
          transform: place === "above" ? "translate(-50%, -100%)" : "translateX(-50%)",
          zIndex: 2000,
        }}
      >
        <div className={styles.calendarHeader}>
          <button type="button" className={styles.calNavBtn} aria-label="Mês anterior" onClick={() => setEtiquetaMonth((m) => addMonths(m, -1))}>
            ◀
          </button>
          <div className={styles.calTitle}>
            <span className={styles.calMonthName}>
              {["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"][etiquetaMonth.getMonth()]}
            </span>{" "}
            <span className={styles.calYear}>{etiquetaMonth.getFullYear()}</span>
          </div>
          <button type="button" className={styles.calNavBtn} aria-label="Próximo mês" onClick={() => setEtiquetaMonth((m) => addMonths(m, 1))}>
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
            const first = startOfMonth(etiquetaMonth);
            const start = first.getDay();
            const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
            const prevDaysInMonth = new Date(first.getFullYear(), first.getMonth(), 0).getDate();
            const cells: Array<JSX.Element> = [];

            for (let i = 0; i < start; i += 1) {
              const day = prevDaysInMonth - (start - 1 - i);
              cells.push(
                <button key={`pm-${kind}-${i}`} type="button" className={`${styles.calDay} ${styles.calDayMuted}`} disabled>
                  {day}
                </button>,
              );
            }

            for (let day = 1; day <= daysInMonth; day += 1) {
              const d = new Date(first.getFullYear(), first.getMonth(), day);
              const isSelected =
                selected && d.getFullYear() === selected.getFullYear() && d.getMonth() === selected.getMonth() && d.getDate() === selected.getDate();
              cells.push(
                <button
                  type="button"
                  key={`d-${kind}-${day}`}
                  className={isSelected ? `${styles.calDay} ${styles.calDayOn}` : styles.calDay}
                  onClick={() => {
                    if (kind === "prod") {
                      setEtiquetaDataProd(formatDateLabel(d));
                      if (etiquetaValidityDays) setEtiquetaDataVal(formatDateLabel(new Date(d.getTime() + etiquetaValidityDays * 24 * 60 * 60 * 1000)));
                    } else {
                      setEtiquetaDataVal(formatDateLabel(d));
                    }
                    setOpenEtiquetaCalendar(null);
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
                <button key={`nm-${kind}-${i}`} type="button" className={`${styles.calDay} ${styles.calDayMuted}`} disabled>
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
              if (kind === "prod") {
                setEtiquetaDataProd(formatDateLabel(t));
                if (etiquetaValidityDays) setEtiquetaDataVal(formatDateLabel(new Date(t.getTime() + etiquetaValidityDays * 24 * 60 * 60 * 1000)));
              } else {
                setEtiquetaDataVal(formatDateLabel(t));
              }
              setEtiquetaMonth(startOfMonth(t));
            }}
          >
            <span className={styles.dotBlue} aria-hidden />
            hoje
          </button>
          <button
            type="button"
            className={styles.calFooterBtn}
            onClick={() => {
              if (kind === "prod") setEtiquetaDataProd("");
              else setEtiquetaDataVal("");
            }}
          >
            <span className={styles.dotRed} aria-hidden />
            limpar
          </button>
          <button type="button" className={styles.calFooterBtn} onClick={() => setOpenEtiquetaCalendar(null)}>
            <span className={styles.xMark} aria-hidden>
              ×
            </span>
            fechar
          </button>
        </div>
      </div>
    );
  }

  function openDeleteModal(row: PrePreparoRow) {
    setDeletingId(row.id);
    setDeletingName(row.receita);
    setIsDeleteOpen(true);
  }

  function confirmDelete() {
    const id = deletingId;
    if (!id) return;
    setRows((prev) => prev.filter((r) => r.id !== id));
    setIsDeleteOpen(false);
    setDeletingId(null);
    setDeletingName("");
    setOpenMenuId(null);
  }

  function recomputeRowMetrics(row: PrePreparoRow) {
    const totalCents = (row.ingredientes ?? []).reduce((sum, r) => sum + clampNonNegativeInt(r.custoCents), 0);
    const yieldParsed = parseQtyLabel(row.rendimento);
    const yieldQty = yieldParsed.qty;
    const yieldUnit = yieldParsed.unit || "Und";
    const totalLabel = formatCurrencyBRLFromCents(totalCents);
    const unitCost = yieldQty > 0 ? totalCents / 100 / yieldQty : 0;
    const unitCostLabel = `${unitCost.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} / ${yieldUnit}`;
    return { ...row, custoTotal: totalLabel, custoUnitario: unitCostLabel };
  }

  function getPdfRow(base: PrePreparoRow) {
    if (detailsRecipeId && base.id === detailsRecipeId) {
      const rendimento =
        isEditingYield && parseDecimalInput(yieldDraftQty) > 0
          ? `${formatDecimalFixedDraft(yieldDraftQty, 3)} ${yieldDraftUnit.trim() || "Und"}`
          : base.rendimento;
      const modoPreparo = isEditingPrep ? prepDraft : base.modoPreparo;
      return recomputeRowMetrics({ ...base, rendimento, modoPreparo });
    }
    return recomputeRowMetrics(base);
  }

  function updateDetailsRow(next: PrePreparoRow) {
    setRows((prev) => prev.map((r) => (r.id === next.id ? recomputeRowMetrics(next) : r)));
  }

  function startYieldEdit() {
    if (!detailsRow) return;
    const parsed = parseQtyLabel(detailsRow.rendimento);
    setYieldDraftQty(formatDecimalFixedDraft(String(parsed.qty || 0), 3));
    setYieldDraftUnit((parsed.unit || "Und").trim() || "Und");
    setIsEditingYield(true);
  }

  function saveYieldEdit() {
    if (!detailsRow) return;
    const qty = parseDecimalInput(yieldDraftQty);
    if (!(qty > 0)) {
      showToast("Informe um rendimento válido para salvar.", "error");
      return;
    }
    const unit = yieldDraftUnit.trim() || "Und";
    const nextLabel = `${formatDecimalFixedDraft(yieldDraftQty, 3)} ${unit}`;
    updateDetailsRow({ ...detailsRow, rendimento: nextLabel });
    setIsEditingYield(false);
    showToast("Rendimento salvo.", "success");
  }

  function addDetailIngredientRow() {
    if (!detailsRow || !selectedDetailIngredient) return;
    const qty = parseDecimalInput(detailIngredientQty);
    if (!(qty > 0)) return;
    const nextQty = formatDecimalFixedDraft(detailIngredientQty, 3);
    const costCents = clampNonNegativeInt(Math.round(detailIngredientCost * 100));
    const nextRow: IngredienteRow = {
      id: String(Date.now()),
      item: selectedDetailIngredient.item,
      quantidade: nextQty,
      unidade: selectedDetailIngredient.medida || "Und",
      custoCents: costCents,
    };
    const prevList = detailsRow.ingredientes ?? [];
    const nextList = [...prevList, nextRow];
    updateDetailsRow({ ...detailsRow, ingredientes: nextList });
    setDetailIngredientId("");
    setDetailIngredientQty("0,000");
  }

  function startRowEdit(row: IngredienteRow) {
    setDetailsTab("ingredientes");
    setRowEditId(row.id);
    const found = ingredientOptions.find((i) => normalizeNameKey(i.item) === normalizeNameKey(row.item)) ?? null;
    setRowEditIngredientId(found?.id ?? "");
    setRowEditQty(formatDecimalFixedDraft(row.quantidade, 3));
  }

  function cancelRowEdit() {
    setRowEditId(null);
    setRowEditIngredientId("");
    setRowEditQty("0,000");
  }

  function saveRowEdit() {
    if (!detailsRow) return;
    const id = rowEditId;
    if (!id) return;
    const selected = ingredientOptions.find((i) => i.id === rowEditIngredientId) ?? null;
    if (!selected) return;
    const qty = parseDecimalInput(rowEditQty);
    if (!(qty > 0)) return;
    const nextQty = formatDecimalFixedDraft(rowEditQty, 3);
    const stats = averageCostByInsumo.get(selected.item.toLowerCase()) ?? null;
    const unitCents =
      stats && stats.sumQty > 0 && stats.sumCents > 0 ? clampNonNegativeInt(Math.round(stats.sumCents / stats.sumQty)) : clampNonNegativeInt(Math.round(parseMoneyLabel(selected.custoMedio) * 100));
    const fromUnit = String(selected.medida ?? "Und").trim() || "Und";
    const qtyInStatsUnit = stats?.unit ? convertQty(qty, fromUnit, stats.unit) : qty;
    const finalQty = Number.isFinite(qtyInStatsUnit) && qtyInStatsUnit > 0 ? qtyInStatsUnit : qty;
    const costCents = clampNonNegativeInt(Math.round(unitCents * finalQty));
    const prevList = detailsRow.ingredientes ?? [];
    const nextList = prevList.map((r) =>
      r.id === id ? { ...r, item: selected.item, quantidade: nextQty, unidade: selected.medida || "Und", custoCents: costCents } : r
    );
    updateDetailsRow({ ...detailsRow, ingredientes: nextList });
    cancelRowEdit();
  }

  function removeDetailIngredientRow(id: string) {
    if (!detailsRow) return;
    const prevList = detailsRow.ingredientes ?? [];
    const nextList = prevList.filter((r) => r.id !== id);
    updateDetailsRow({ ...detailsRow, ingredientes: nextList });
    if (rowEditId === id) cancelRowEdit();
  }

  function startPrepEdit() {
    if (!detailsRow) return;
    setPrepDraft(detailsRow.modoPreparo ?? "");
    setIsEditingPrep(true);
  }

  function cancelPrepEdit() {
    if (!detailsRow) return;
    setPrepDraft(detailsRow.modoPreparo ?? "");
    setIsEditingPrep(false);
  }

  function savePrepEdit() {
    if (!detailsRow) return;
    updateDetailsRow({ ...detailsRow, modoPreparo: prepDraft });
    setIsEditingPrep(false);
  }

  function toggleDetailsHidden() {
    if (!detailsRow) return;
    const id = detailsRow.id;
    const nextHidden = !Boolean(hiddenMap[id]);
    setHiddenMap((prev) => {
      const next = { ...(prev ?? {}) };
      next[id] = nextHidden;
      return next;
    });
    showToast(nextHidden ? "Ocultado do CMV Real." : "Desocultado do CMV Real.", "success");
  }

  const insumoCategories = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    const push = (raw: string) => {
      const key = String(raw ?? "").trim();
      if (!key || key === "-") return;
      const name = toTitleCase(normalizeCategoryName(key));
      if (!name) return;
      const k = name.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      out.push(name);
    };
    for (const c of insumoCategorias) push(c);
    for (const i of insumosStore) push(String(i.categoria ?? ""));
    return out;
  }, [insumoCategorias, insumosStore]);

  const recipeCategories = useMemo(() => {
    const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });
    return [...insumoCategories].sort((a, b) => collator.compare(a, b));
  }, [insumoCategories]);

  useEffect(() => {
    if (!recipeCategories.length) return;
    setRows((prev) => {
      let changed = false;
      const next = prev.map((r) => {
        const from = toTitleCase(normalizeCategoryName(String(r.categoria ?? "")));
        const match = recipeCategories.find((c) => c.toLowerCase() === from.toLowerCase()) ?? "-";
        if (r.categoria === match) return r;
        changed = true;
        return { ...r, categoria: match };
      });
      return changed ? next : prev;
    });
  }, [recipeCategories]);

  useEffect(() => {
    if (selectedCategory === "Categorias") return;
    if (!recipeCategories.includes(selectedCategory)) setSelectedCategory("Categorias");
  }, [recipeCategories, selectedCategory]);

  useEffect(() => {
    if (!draftCategory) return;
    if (!recipeCategories.includes(draftCategory)) setDraftCategory("");
  }, [draftCategory, recipeCategories]);

  useEffect(() => {
    if (!newRecipeCategory) return;
    if (!recipeCategories.includes(newRecipeCategory)) setNewRecipeCategory("");
  }, [newRecipeCategory, recipeCategories]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let filtered = rows;
    if (selectedCategory !== "Categorias") filtered = filtered.filter((r) => r.categoria === selectedCategory);
    if (!q) return filtered;
    return filtered.filter((r) => `${r.categoria} ${r.receita}`.toLowerCase().includes(q));
  }, [query, rows, selectedCategory]);

  const detailsRow = useMemo(() => {
    if (!detailsRecipeId) return null;
    return rows.find((r) => r.id === detailsRecipeId) ?? null;
  }, [detailsRecipeId, rows]);

  const detailsEtiquetas = useMemo(() => {
    if (!detailsRecipeId) return [];
    return etiquetasRows
      .filter((e) => e.recipeId === detailsRecipeId)
      .slice()
      .sort((a, b) => {
        const ad = parseDateLabelLoose(String(a.dataProducao ?? "")) ?? parseDateLabelLoose(String(a.dataValidade ?? ""));
        const bd = parseDateLabelLoose(String(b.dataProducao ?? "")) ?? parseDateLabelLoose(String(b.dataValidade ?? ""));
        const at = ad ? new Date(ad.getFullYear(), ad.getMonth(), ad.getDate()).getTime() : 0;
        const bt = bd ? new Date(bd.getFullYear(), bd.getMonth(), bd.getDate()).getTime() : 0;
        if (bt !== at) return bt - at;
        const aid = Number.parseInt(String(a.id ?? ""), 10);
        const bid = Number.parseInt(String(b.id ?? ""), 10);
        if (Number.isFinite(bid) && Number.isFinite(aid) && bid !== aid) return bid - aid;
        return String(b.id ?? "").localeCompare(String(a.id ?? ""), "pt-BR");
      });
  }, [detailsRecipeId, etiquetasRows]);

  const ingredientOptions = useMemo(() => insumosStore.filter((row) => !row.ocultar), [insumosStore]);

  const selectedDetailIngredient = useMemo(
    () => ingredientOptions.find((row) => row.id === detailIngredientId) ?? null,
    [detailIngredientId, ingredientOptions]
  );

  const detailIngredientCost = useMemo(() => {
    if (!selectedDetailIngredient) return 0;
    const qty = parseDecimalInput(detailIngredientQty);
    const stats = averageCostByInsumo.get(selectedDetailIngredient.item.toLowerCase()) ?? null;
    if (stats && stats.sumQty > 0 && stats.sumCents > 0) {
      const qtyInStatsUnit = stats.unit ? convertQty(qty, String(selectedDetailIngredient.medida ?? "Und"), stats.unit) : qty;
      const finalQty = Number.isFinite(qtyInStatsUnit) && qtyInStatsUnit > 0 ? qtyInStatsUnit : qty;
      return (stats.sumCents / stats.sumQty / 100) * finalQty;
    }
    return qty * parseMoneyLabel(selectedDetailIngredient.custoMedio);
  }, [averageCostByInsumo, detailIngredientQty, selectedDetailIngredient]);

  const selectedRowEditIngredient = useMemo(
    () => ingredientOptions.find((row) => row.id === rowEditIngredientId) ?? null,
    [ingredientOptions, rowEditIngredientId]
  );

  const rowEditCost = useMemo(() => {
    if (!selectedRowEditIngredient) return 0;
    const qty = parseDecimalInput(rowEditQty);
    const stats = averageCostByInsumo.get(selectedRowEditIngredient.item.toLowerCase()) ?? null;
    if (stats && stats.sumQty > 0 && stats.sumCents > 0) {
      const qtyInStatsUnit = stats.unit ? convertQty(qty, String(selectedRowEditIngredient.medida ?? "Und"), stats.unit) : qty;
      const finalQty = Number.isFinite(qtyInStatsUnit) && qtyInStatsUnit > 0 ? qtyInStatsUnit : qty;
      return (stats.sumCents / stats.sumQty / 100) * finalQty;
    }
    return qty * parseMoneyLabel(selectedRowEditIngredient.custoMedio);
  }, [averageCostByInsumo, rowEditQty, selectedRowEditIngredient]);

  const detailsIngredientsTotalCents = useMemo(() => {
    return (detailsRow?.ingredientes ?? []).reduce((sum, r) => sum + clampNonNegativeInt(r.custoCents), 0);
  }, [detailsRow?.ingredientes]);

  const detailsYield = useMemo(() => {
    const parsed = detailsRow ? parseQtyLabel(detailsRow.rendimento) : { qty: 0, unit: "" };
    return { qty: parsed.qty, unit: parsed.unit || "Und" };
  }, [detailsRow?.rendimento, detailsRow]);

  const detailsIsHidden = useMemo(() => {
    if (!detailsRow) return false;
    return Boolean(hiddenMap[detailsRow.id]);
  }, [detailsRow?.id, detailsRow, hiddenMap]);

  const detailsValidityLabel = useMemo(() => {
    const days = detailsRow?.validadeDias ?? 7;
    return `${days} Dia(s)`;
  }, [detailsRow?.validadeDias]);

  const detailsUltimaEntradaLabel = useMemo(() => {
    if (!detailsRow) return "-";
    const keys = new Set((detailsRow.ingredientes ?? []).map((i) => normalizeNameKey(i.item)));
    let latest: Date | null = null;
    for (const nota of entradasRows) {
      const d = parseDateLabelLoose(nota.dataLancamento);
      if (!d) continue;
      const itens = nota.itensNota ?? [];
      const hit = itens.some((it) => keys.has(normalizeNameKey(it.nome)));
      if (!hit) continue;
      if (!latest || d.getTime() > latest.getTime()) latest = d;
    }
    return latest ? formatDateLabel(latest) : "-";
  }, [detailsRow, entradasRows]);

  const detailsUltimaEtiquetaLabel = useMemo(() => {
    const latest = detailsEtiquetas[0];
    if (!latest) return "-";
    return String(latest.dataProducao ?? "").trim() || String(latest.dataValidade ?? "").trim() || "-";
  }, [detailsEtiquetas]);

  const etiquetaRecipeOptions = useMemo(() => {
    const q = etiquetaRecipeQuery.trim().toLowerCase();
    const base = rows;
    if (!q) return base;
    return base.filter((r) => r.receita.toLowerCase().includes(q));
  }, [etiquetaRecipeQuery, rows]);

  const etiquetaSelectedRecipe = useMemo(() => {
    if (!etiquetaRecipeId) return null;
    return rows.find((r) => r.id === etiquetaRecipeId) ?? null;
  }, [etiquetaRecipeId, rows]);

  const etiquetaValidityDays = useMemo(() => (etiquetaRecipeId ? 7 : 0), [etiquetaRecipeId]);

  const recipeTotalCents = useMemo(() => {
    return newRecipeIngredients.reduce((sum, r) => sum + clampNonNegativeInt(r.custoCents), 0);
  }, [newRecipeIngredients]);

  const recipeYieldValue = useMemo(() => parsePtNumber(newRecipeYield), [newRecipeYield]);

  const recipeUnitCost = useMemo(() => {
    if (!recipeYieldValue) return 0;
    return recipeTotalCents / 100 / recipeYieldValue;
  }, [recipeTotalCents, recipeYieldValue]);

  const canGoNextRecipe = useMemo(() => {
    if (newRecipeStep !== 1) return true;
    return Boolean(newRecipeName.trim() && newRecipeSpec.trim() && newRecipeCategory && newRecipeUnit && newRecipeValidity.trim());
  }, [newRecipeCategory, newRecipeName, newRecipeSpec, newRecipeStep, newRecipeUnit, newRecipeValidity]);

  const canGoNextRecipeStep2 = useMemo(() => {
    if (newRecipeStep !== 2) return false;
    const yieldValue = parsePtNumber(newRecipeYield);
    return Boolean(newRecipeIngredients.length && Number.isFinite(yieldValue) && yieldValue > 0);
  }, [newRecipeIngredients.length, newRecipeStep, newRecipeYield]);

  const canSaveRecipe = useMemo(() => {
    return Boolean(newRecipeName.trim() && newRecipeSpec.trim() && newRecipeCategory && newRecipeUnit && newRecipeIngredients.length && recipeYieldValue > 0);
  }, [newRecipeCategory, newRecipeIngredients.length, newRecipeName, newRecipeSpec, newRecipeUnit, recipeYieldValue]);

  async function downloadEtiquetaPdf(label: {
    receita: string;
    responsavel: string;
    quantidade: string;
    unidade: string;
    dataProducao: string;
    dataValidade: string;
  }) {
    const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
    const doc = await PDFDocument.create();

    const pageW = 420;
    const pageH = 260;
    const page = doc.addPage([pageW, pageH]);

    const font = await doc.embedFont(StandardFonts.Helvetica);
    const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

    const margin = 22;
    const title = String(label.receita ?? "").trim() || "Etiqueta";
    const qtyLabel = `${String(label.quantidade ?? "").trim() || "0"} ${String(label.unidade ?? "").trim() || "Und"}`.trim();
    const responsavel = String(label.responsavel ?? "").trim() || "-";
    const prod = parseDateLabelLoose(String(label.dataProducao ?? "")) ?? null;
    const val = parseDateLabelLoose(String(label.dataValidade ?? "")) ?? null;
    const prodLabel = prod ? formatDateNumeric(prod) : "-";
    const valLabel = val ? formatDateNumeric(val) : "-";

    page.drawRectangle({
      x: margin,
      y: margin,
      width: pageW - margin * 2,
      height: pageH - margin * 2,
      borderColor: rgb(0.78, 0.8, 0.82),
      borderWidth: 1.2,
    });

    const headerY = pageH - margin - 32;
    page.drawText(title, { x: margin + 16, y: headerY, size: 18, font: fontBold, color: rgb(0.06, 0.09, 0.16) });
    page.drawText(qtyLabel, {
      x: pageW - margin - 16 - fontBold.widthOfTextAtSize(qtyLabel, 16),
      y: headerY + 2,
      size: 16,
      font: fontBold,
      color: rgb(0.06, 0.09, 0.16),
    });

    const lineY = headerY - 14;
    page.drawLine({ start: { x: margin + 16, y: lineY }, end: { x: pageW - margin - 16, y: lineY }, thickness: 1.2, color: rgb(0.82, 0.84, 0.86) });

    let y = lineY - 28;
    const labelSize = 12;
    const valueSize = 12;
    const leftX = margin + 16;
    const rightX = pageW - margin - 16;

    function drawRow(name: string, value: string) {
      page.drawText(name, { x: leftX, y, size: labelSize, font: fontBold, color: rgb(0.06, 0.09, 0.16) });
      const v = String(value ?? "").trim() || "-";
      page.drawText(v, { x: rightX - font.widthOfTextAtSize(v, valueSize), y, size: valueSize, font: fontBold, color: rgb(0.06, 0.09, 0.16) });
      y -= 22;
    }

    drawRow("Responsável:", responsavel);
    drawRow("Data Produção:", prodLabel);
    drawRow("Data de Validade:", valLabel);

    page.drawLine({ start: { x: margin + 16, y: y + 6 }, end: { x: pageW - margin - 16, y: y + 6 }, thickness: 1.2, color: rgb(0.82, 0.84, 0.86) });

    const now = new Date();
    const footer = `Impresso em ${formatDateNumeric(now)} às ${now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} · Por CMV Fácil`;
    page.drawText(footer, { x: margin + 16, y: margin + 12, size: 9, font, color: rgb(0.4, 0.43, 0.46) });

    const bytes = await doc.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safeName = title.toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/(^-|-$)/g, "") || "etiqueta";
    a.download = `etiqueta-${safeName}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function saveEtiqueta() {
    if (!etiquetaSelectedRecipe) return;
    if (!etiquetasLoadedRef.current) {
      showToast("Aguarde carregar as etiquetas do Supabase.", "error");
      return;
    }
    const quantidade = parsePtNumber(etiquetaQtd);
    const dataProducao = parseDateLabelLoose(etiquetaDataProd);
    const dataValidade = parseDateLabelLoose(etiquetaDataVal);
    if (!Number.isFinite(quantidade) || quantidade <= 0 || !dataProducao || !dataValidade) return;
    const custoCents = computeEtiquetaCostCents(etiquetaSelectedRecipe, quantidade, etiquetaUnidade);
    const next = {
      id: String(Date.now()),
      recipeId: etiquetaSelectedRecipe.id,
      receita: etiquetaSelectedRecipe.receita,
      responsavel: etiquetaResponsavel.trim(),
      quantidade: formatPtQty(quantidade),
      unidade: etiquetaUnidade.trim() || "Und",
      custo: formatCurrencyBRLFromCents(custoCents),
      dataProducao: formatDateLabel(dataProducao),
      dataValidade: formatDateLabel(dataValidade),
      wasteStatus: "pending" as const,
    };
    setEtiquetasRows((prev) => [next, ...prev]);
    setIsEtiquetaOpen(false);
    void downloadEtiquetaPdf(next)
      .then(() => showToast("Etiqueta salva e PDF baixado.", "success"))
      .catch(() => showToast("Etiqueta salva, mas não foi possível gerar o PDF.", "error"));
  }

  async function downloadFichaTecnica(row: PrePreparoRow) {
    const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");

    const doc = await PDFDocument.create();
    const page = doc.addPage([595.28, 841.89]);
    const { width, height } = page.getSize();

    const font = await doc.embedFont(StandardFonts.Helvetica);
    const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

    const marginX = 40;
    const now = new Date();
    const updated = `Última Atualização: ${formatDateNumeric(now)} às ${now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;

    function wrapText(value: string, maxWidth: number, size: number) {
      const safe = String(value ?? "").replaceAll("\r\n", "\n").replaceAll("\r", "\n");
      const paragraphs = safe.split("\n");
      const lines: string[] = [];
      for (const p of paragraphs) {
        const raw = p.trim();
        if (!raw) {
          lines.push("");
          continue;
        }
        const words = raw.split(/\s+/g);
        let current = "";
        for (const w of words) {
          const next = current ? `${current} ${w}` : w;
          if (font.widthOfTextAtSize(next, size) <= maxWidth) {
            current = next;
            continue;
          }
          if (current) lines.push(current);
          current = w;
        }
        if (current) lines.push(current);
      }
      while (lines.length && lines[lines.length - 1] === "") lines.pop();
      return lines;
    }

    const title = row.receita;
    const validade = row.validadeDias ?? 7;
    const categoria = toTitleCase(normalizeCategoryName(String(row.categoria ?? "")));
    const totalCents = row.ingredientes?.length ? row.ingredientes.reduce((s, i) => s + clampNonNegativeInt(i.custoCents), 0) : parseCurrencyBRLToCents(row.custoTotal);
    const totalStr = formatCurrencyBRLFromCents(totalCents);
    const rendimentoLabel = String(row.rendimento ?? "").trim();
    const rendimentoParsed = parseQtyLabel(rendimentoLabel);
    const rendimentoQty = rendimentoParsed.qty;
    const rendimentoUnit = (rendimentoParsed.unit || "Und").trim() || "Und";
    const unitCost = rendimentoQty > 0 ? totalCents / 100 / rendimentoQty : 0;
    const unitStr = `${unitCost.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} / ${rendimentoUnit}`;
    const modoPreparoText = String(row.modoPreparo ?? "").trim() || "-";

    const ingredientes = (row.ingredientes && row.ingredientes[0] ? row.ingredientes : [
      { id: "1", item: "-", quantidade: "-", unidade: "-", custoCents: totalCents },
    ]) as IngredienteRow[];

    page.drawCircle({
      x: marginX + 10,
      y: height - 54,
      size: 18,
      color: rgb(0.02, 0.62, 0.36),
    });
    page.drawText("cmvfácil", { x: marginX + 34, y: height - 60, size: 20, font: fontBold, color: rgb(0.01, 0.01, 0.01) });
    page.drawText(updated, {
      x: width / 2 - font.widthOfTextAtSize(updated, 10) / 2,
      y: height - 50,
      size: 10,
      font,
      color: rgb(0.2, 0.2, 0.2),
    });

    page.drawRectangle({
      x: marginX,
      y: height - 140,
      width: 360,
      height: 44,
      color: rgb(0.93, 0.94, 0.94),
      borderRadius: 10,
    } as any);
    page.drawText(title, { x: marginX + 14, y: height - 126, size: 14, font: fontBold, color: rgb(0.01, 0.01, 0.01) });

    page.drawRectangle({ x: width - marginX - 150, y: height - 220, width: 150, height: 160, color: rgb(0.95, 0.95, 0.95), borderRadius: 12 } as any);
    page.drawRectangle({ x: width - marginX - 104, y: height - 178, width: 20, height: 92, color: rgb(1, 0.26, 0.35), borderRadius: 8 } as any);
    page.drawRectangle({ x: width - marginX - 78, y: height - 192, width: 26, height: 120, color: rgb(1, 0.55, 0.5), borderRadius: 10 } as any);
    page.drawRectangle({ x: width - marginX - 48, y: height - 212, width: 32, height: 156, color: rgb(1, 0.18, 0.33), borderRadius: 12 } as any);

    const infoX = marginX;
    let infoY = height - 182;
    const lineGap = 16;
    function drawInfo(label: string, value: string) {
      page.drawText(label, { x: infoX, y: infoY, size: 10, font: fontBold, color: rgb(0.01, 0.01, 0.01) });
      page.drawText(value, { x: infoX + 78, y: infoY, size: 10, font, color: rgb(0.01, 0.01, 0.01) });
      infoY -= lineGap;
    }

    drawInfo("Validade:", `${validade} Dia(s)`);
    drawInfo("Categoria:", categoria || "-");
    drawInfo("Custo Total:", totalStr);
    drawInfo("Custo Unitário:", unitStr);

    page.drawLine({ start: { x: marginX, y: height - 300 }, end: { x: width - marginX, y: height - 300 }, thickness: 1.5, color: rgb(0.35, 0.35, 0.35) });

    page.drawText("Modo de Preparo:", { x: marginX, y: height - 340, size: 11, font: fontBold, color: rgb(0.01, 0.01, 0.01) });

    const prepFontSize = 10;
    const prepLineH = 14;
    const prepMaxWidth = width - marginX * 2;
    const prepLinesAll = wrapText(modoPreparoText, prepMaxWidth, prepFontSize);
    const prepMaxLines = 6;
    const prepLines = prepLinesAll.length > prepMaxLines ? [...prepLinesAll.slice(0, prepMaxLines - 1), "…"] : prepLinesAll;
    let prepY = height - 360;
    for (const line of prepLines) {
      if (!line) {
        prepY -= prepLineH;
        continue;
      }
      page.drawText(line, { x: marginX, y: prepY, size: prepFontSize, font, color: rgb(0.2, 0.2, 0.2) });
      prepY -= prepLineH;
    }

    const ingredientsTitleY = prepY - 18;
    page.drawText(`Ingredientes (Rende: ${formatDecimal3(rendimentoQty)} ${rendimentoUnit}):`, {
      x: marginX,
      y: ingredientsTitleY,
      size: 11,
      font: fontBold,
      color: rgb(0.01, 0.01, 0.01),
    });

    const tableX = marginX;
    const rowH = 28;
    const tableY = ingredientsTitleY - rowH - 12;
    const tableW = width - marginX * 2;
    const colItem = tableW * 0.45;
    const colQtd = tableW * 0.27;
    const colCost = tableW - colItem - colQtd;

    page.drawRectangle({ x: tableX, y: tableY, width: tableW, height: rowH, color: rgb(0.95, 0.95, 0.95), borderColor: rgb(0.35, 0.35, 0.35), borderWidth: 1 });
    page.drawText("Item", { x: tableX + 10, y: tableY + 9, size: 10, font: fontBold, color: rgb(0.01, 0.01, 0.01) });
    page.drawText("Qtd", { x: tableX + colItem + 10, y: tableY + 9, size: 10, font: fontBold, color: rgb(0.01, 0.01, 0.01) });
    page.drawText("Custo", { x: tableX + colItem + colQtd + 10, y: tableY + 9, size: 10, font: fontBold, color: rgb(0.01, 0.01, 0.01) });

    let y = tableY - rowH;
    for (const ing of ingredientes.slice(0, 10)) {
      page.drawRectangle({ x: tableX, y, width: tableW, height: rowH, borderColor: rgb(0.35, 0.35, 0.35), borderWidth: 1, color: rgb(1, 1, 1) });
      page.drawLine({ start: { x: tableX + colItem, y }, end: { x: tableX + colItem, y: y + rowH }, thickness: 1, color: rgb(0.35, 0.35, 0.35) });
      page.drawLine({ start: { x: tableX + colItem + colQtd, y }, end: { x: tableX + colItem + colQtd, y: y + rowH }, thickness: 1, color: rgb(0.35, 0.35, 0.35) });

      page.drawText(ing.item, { x: tableX + 10, y: y + 9, size: 10, font, color: rgb(0.2, 0.2, 0.2) });
      page.drawText(`${ing.quantidade} ${ing.unidade}`, { x: tableX + colItem + 10, y: y + 9, size: 10, font, color: rgb(0.2, 0.2, 0.2) });
      page.drawText(formatCurrencyBRLFromCents(ing.custoCents), { x: tableX + colItem + colQtd + 10, y: y + 9, size: 10, font, color: rgb(0.2, 0.2, 0.2) });
      y -= rowH;
    }

    const bytes = await doc.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ficha-tecnica-${row.receita.toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/(^-|-$)/g, "")}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className={dash.dashboard}>
      <AppSidebar active="pre-preparo" />
      {isMounted && toast
        ? createPortal(
            <SystemToast title={toast.title} message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />,
            document.body
          )
        : null}

      <main className={dash.content}>
        {detailsRow ? (
          <div className={ft.pageFrameWide}>
            <section className={`${dash.itemDetails} ${ft.detailsPage}`}>
              <div className={`${dash.itemDetailsTop} ${ft.detailsHeader}`}>
                <button
                  type="button"
                  className={`${dash.itemBack} ${ft.detailsBackBtn}`}
                  onClick={() => {
                    setDetailsRecipeId(null);
                    setDetailsTab("ingredientes");
                  }}
                >
                  <span className={`${dash.itemBackIcon} ${ft.detailsBackIcon}`}>←</span>
                  <span className={`${dash.itemBackText} ${ft.detailsBackText}`}>{`Detalhes do Item / ${detailsRow.receita}`}</span>
                </button>
                <div className={`${dash.itemMoreWrap} ${ft.detailsMoreWrap}`}>
                  <button type="button" className={`${dash.itemMore} ${ft.detailsMoreBtn}`} aria-label="Mais opções">
                    ⋮
                  </button>
                </div>
              </div>

              <div className={`${dash.itemDetailsGrid} ${ft.detailsLayout}`}>
                <div className={`${dash.itemDetailsMain} ${ft.detailsMain}`}>
                  <div className={`${dash.itemDetailsTabs} ${ft.detailsTabs}`}>
                    <button
                      type="button"
                      className={detailsTab === "ingredientes" ? `${dash.itemTabActive} ${ft.detailsTabActive}` : `${dash.itemTab} ${ft.detailsTab}`}
                      onClick={() => setDetailsTab("ingredientes")}
                    >
                      Ingredientes
                    </button>
                    <button
                      type="button"
                      className={detailsTab === "preparo" ? `${dash.itemTabActive} ${ft.detailsTabActive}` : `${dash.itemTab} ${ft.detailsTab}`}
                      onClick={() => setDetailsTab("preparo")}
                    >
                      Modo de Preparo
                    </button>
                    <button
                      type="button"
                      className={detailsTab === "etiquetas" ? `${dash.itemTabActive} ${ft.detailsTabActive}` : `${dash.itemTab} ${ft.detailsTab}`}
                      onClick={() => setDetailsTab("etiquetas")}
                    >
                      Etiquetas
                    </button>
                  </div>

                  {detailsTab === "ingredientes" ? (
                    <div className={`${dash.itemDetailsBody} ${ft.detailsPanel}`}>
                      <div className={ft.detailsSectionTitle}>Lista de Ingredientes</div>

                      <div className={ft.detailsIngredientBox}>
                        <div className={ft.detailsIngredientHead}>
                          <div>Item</div>
                          <div>Quantidade</div>
                          <div>Custo</div>
                        </div>

                        <div className={ft.detailsIngredientEntry}>
                          <label className={ft.detailsItemSelectWrap}>
                            <span className={ft.detailsItemSearchIcon}>
                              <DetailsSearchMiniIcon />
                            </span>
                            <select
                              value={detailIngredientId}
                              onChange={(e) => {
                                setDetailIngredientId(e.target.value);
                              }}
                              className={ft.detailsItemSelect}
                            >
                              <option value="">Pesquise por itens...</option>
                              {ingredientOptions.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.item}
                                </option>
                              ))}
                            </select>
                          </label>

                          <span className={ft.detailsInlineGroup}>
                            <input
                              type="text"
                              className={ft.detailsInlineInput}
                              value={detailIngredientQty}
                              inputMode="decimal"
                              onChange={(e) => setDetailIngredientQty(formatDecimalDraft(e.target.value, 3))}
                              onBlur={(e) => setDetailIngredientQty(formatDecimalFixedDraft(e.target.value, 3))}
                            />
                            <span className={ft.detailsInlineSuffix}>{selectedDetailIngredient?.medida || "Und"}</span>
                          </span>

                          <span className={`${ft.detailsInlineGroup} ${ft.detailsInlineGroupPrefix}`}>
                            <span className={ft.detailsInlinePrefix}>R$</span>
                            <input type="text" className={ft.detailsInlineInput} value={formatDecimal3(detailIngredientCost)} readOnly />
                          </span>

                          <button
                            type="button"
                            className={ft.detailsAddBtn}
                            onClick={addDetailIngredientRow}
                            disabled={!selectedDetailIngredient || parseDecimalInput(detailIngredientQty) <= 0}
                          >
                            <DetailsPlusIcon />
                          </button>
                        </div>
                      </div>

                      <div className={ft.detailsDividerIcon}>
                        <DetailsChevronDoubleIcon />
                      </div>

                      <div className={ft.detailsList}>
                        {(detailsRow.ingredientes ?? []).map((row) => (
                          rowEditId === row.id ? (
                            <div key={row.id} className={ft.detailsListRow}>
                              <label className={ft.detailsItemSelectWrap}>
                                <span className={ft.detailsItemSearchIcon}>
                                  <DetailsSearchMiniIcon />
                                </span>
                                <select value={rowEditIngredientId} onChange={(e) => setRowEditIngredientId(e.target.value)} className={ft.detailsItemSelect}>
                                  <option value="">Pesquise por itens...</option>
                                  {ingredientOptions.map((item) => (
                                    <option key={item.id} value={item.id}>
                                      {item.item}
                                    </option>
                                  ))}
                                </select>
                              </label>

                              <span className={ft.detailsInlineGroup}>
                                <input
                                  type="text"
                                  className={ft.detailsInlineInput}
                                  value={rowEditQty}
                                  inputMode="decimal"
                                  onChange={(e) => setRowEditQty(formatDecimalDraft(e.target.value, 3))}
                                  onBlur={(e) => setRowEditQty(formatDecimalFixedDraft(e.target.value, 3))}
                                />
                                <span className={ft.detailsInlineSuffix}>{selectedRowEditIngredient?.medida || row.unidade || "Und"}</span>
                              </span>

                              <span className={`${ft.detailsInlineGroup} ${ft.detailsInlineGroupPrefix}`}>
                                <span className={ft.detailsInlinePrefix}>R$</span>
                                <input type="text" className={ft.detailsInlineInput} value={formatDecimal3(rowEditCost)} readOnly />
                              </span>

                              <button
                                type="button"
                                className={ft.detailsEditRowBtn}
                                onClick={saveRowEdit}
                                disabled={!selectedRowEditIngredient || parseDecimalInput(rowEditQty) <= 0}
                                aria-label={`Salvar ${row.item}`}
                              >
                                <DetailsCheckIcon />
                              </button>
                              <button type="button" className={ft.detailsTrashBtn} onClick={cancelRowEdit} aria-label={`Cancelar ${row.item}`}>
                                <DetailsXIcon />
                              </button>
                            </div>
                          ) : (
                            <div key={row.id} className={ft.detailsListRow}>
                              <div className={ft.detailsListItem}>{row.item}</div>
                              <div className={ft.detailsListQty}>{formatQtyLabel(row.quantidade, row.unidade)}</div>
                              <div className={ft.detailsListCost}>{formatMoney(row.custoCents / 100)}</div>
                              <button type="button" className={ft.detailsEditRowBtn} onClick={() => startRowEdit(row)} aria-label={`Editar ${row.item}`}>
                                <DetailsEditIcon />
                              </button>
                              <button type="button" className={ft.detailsTrashBtn} onClick={() => removeDetailIngredientRow(row.id)} aria-label={`Remover ${row.item}`}>
                                <DetailsTrashIcon />
                              </button>
                            </div>
                          )
                        ))}
                      </div>

                      <div className={ft.detailsDividerIconBottom}>
                        <DetailsChevronDoubleIcon />
                      </div>

                      <div className={ft.detailsBottomRow}>
                        <div className={ft.detailsYieldCard}>
                          <div>
                            <div className={ft.yieldTitle}>Quanto Rende?</div>
                            <div className={ft.yieldHint}>Informe quanto essa receita irá render em média após o preparo.</div>
                          </div>
                          <div
                            ref={yieldEditWrapRef}
                            className={ft.detailsYieldMeta}
                            role="button"
                            tabIndex={0}
                            style={!isEditingYield ? { cursor: "pointer" } : undefined}
                            onClick={() => {
                              if (isEditingYield) return;
                              startYieldEdit();
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                if (isEditingYield) saveYieldEdit();
                                else startYieldEdit();
                              }
                            }}
                          >
                            {isEditingYield ? (
                              <>
                                <input
                                  className={ft.detailsYieldInput}
                                  value={yieldDraftQty}
                                  onChange={(e) => setYieldDraftQty(formatDecimalDraft(e.target.value, 3))}
                                  onBlur={(e) => setYieldDraftQty(formatDecimalFixedDraft(e.target.value, 3))}
                                  onPointerDown={(e) => {
                                    e.preventDefault();
                                    e.currentTarget.focus();
                                    e.currentTarget.select();
                                  }}
                                  onFocus={(e) => e.currentTarget.select()}
                                  inputMode="numeric"
                                  autoFocus
                                />
                                <select className={ft.detailsYieldSuffix} value={yieldDraftUnit} onChange={(e) => setYieldDraftUnit(e.target.value)}>
                                  <option value="Kg">Kg</option>
                                  <option value="g">g</option>
                                  <option value="L">L</option>
                                  <option value="ml">ml</option>
                                  <option value="Un">Un</option>
                                  <option value="Und">Und</option>
                                </select>
                              </>
                            ) : (
                              <>
                                <div className={ft.detailsYieldInput}>{formatDecimal3(detailsYield.qty)}</div>
                                <div className={ft.detailsYieldSuffix}>{detailsYield.unit}</div>
                              </>
                            )}
                          </div>
                        </div>

                        <div className={ft.detailsTotalsCard}>
                          <div className={ft.detailsTotalCol}>
                            <span>Custo Total:</span>
                            <strong>{formatMoney(detailsIngredientsTotalCents / 100)}</strong>
                          </div>
                          <div className={ft.detailsTotalCol}>
                            <span>Custo Unitário:</span>
                            <strong>{`${formatMoney(detailsYield.qty > 0 ? detailsIngredientsTotalCents / 100 / detailsYield.qty : 0)} / ${detailsYield.unit}`}</strong>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : detailsTab === "preparo" ? (
                    <div className={`${dash.itemDetailsBody} ${ft.detailsPanel}`}>
                      <div className={ft.detailsPrepHeader}>
                        <div className={ft.detailsSectionTitle}>Modo de Preparo</div>
                        {!isEditingPrep ? (
                          <button type="button" className={ft.detailsEditBtn} onClick={startPrepEdit}>
                            editar
                          </button>
                        ) : null}
                      </div>

                      {isEditingPrep ? (
                        <>
                          <textarea
                            className={ft.detailsPrepTextarea}
                            placeholder="Escreva o modo de preparo deste item..."
                            value={prepDraft}
                            onChange={(e) => setPrepDraft(e.target.value)}
                          />
                          <div className={ft.detailsPrepActions}>
                            <button type="button" className={ft.detailsSaveTextBtn} onClick={savePrepEdit}>
                              Salvar
                            </button>
                            <button type="button" className={ft.detailsCancelTextBtn} onClick={cancelPrepEdit}>
                              Cancelar
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className={ft.detailsPrepSaved}>{detailsRow.modoPreparo || "Escreva o modo de preparo deste item..."}</div>
                      )}
                    </div>
                  ) : (
                    <div className={`${dash.itemDetailsBody} ${ft.detailsPanel}`}>
                      <div className={ft.detailsSectionTitle}>{`Etiquetas (${detailsEtiquetas.length})`}</div>
                      <div className={ft.detailsList}>
                        {detailsEtiquetas.map((e) => (
                          <div key={e.id} className={ft.detailsListRow}>
                            <div className={ft.detailsListItem}>
                              <div>{`Produção: ${e.dataProducao || "-"}`}</div>
                              <div>{`Validade: ${e.dataValidade || "-"}`}</div>
                            </div>
                            <div className={ft.detailsListQty}>{`${e.quantidade} ${e.unidade}`}</div>
                            <div className={ft.detailsListCost}>{e.responsavel || "-"}</div>
                            <div />
                            <div />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <aside className={`${dash.itemDetailsAside} ${ft.detailsSidebar}`}>
                  <div className={ft.detailsSidebarCard}>
                    <div className={ft.detailsPreviewBox}>
                      <div className={ft.detailsPreviewFallback}>
                        <div className={ft.previewTopBar} />
                        <div className={ft.previewThumbGrid}>
                          <span className={ft.previewThumbMain} />
                          <span className={ft.previewThumbSide} />
                        </div>
                      </div>
                    </div>
                    <div className={`${dash.itemAsideTitle} ${ft.detailsSidebarTitle}`}>{detailsRow.receita}</div>
                    <div className={`${dash.itemAsideMeta} ${ft.detailsSidebarMeta}`}>Pré-Preparo</div>

                    <div className={dash.itemAsideRow}>
                      <div className={dash.itemAsideLabel}>Ocultar do CMV Real</div>
                      <button type="button" className={detailsIsHidden ? dash.itemToggleOn : dash.itemToggleOff} onClick={toggleDetailsHidden}>
                        <span />
                      </button>
                    </div>

                    <button type="button" className={ft.detailsReturnBtn} onClick={() => void downloadFichaTecnica(getPdfRow(detailsRow))}>
                      <DetailsPdfIcon />
                      Baixar Ficha Técnica
                    </button>

                    <div className={dash.itemAsideKpis}>
                      <div className={dash.itemAsideKpi}>
                        <div className={dash.itemAsideKpiIcon}>
                          <DetailsIconCalendarSmall />
                        </div>
                        <div className={dash.itemAsideKpiText}>
                          <div className={dash.itemAsideKpiLabel}>Prazo de Validade Padrão</div>
                          <div className={dash.itemAsideKpiValue}>{detailsValidityLabel}</div>
                        </div>
                      </div>
                      <div className={dash.itemAsideKpi}>
                        <div className={dash.itemAsideKpiIcon}>
                          <DetailsIconCalendarSmall />
                        </div>
                        <div className={dash.itemAsideKpiText}>
                          <div className={dash.itemAsideKpiLabel}>Última Entrada</div>
                          <div className={dash.itemAsideKpiValue}>{detailsUltimaEntradaLabel}</div>
                        </div>
                      </div>
                      <div className={dash.itemAsideKpi}>
                        <div className={dash.itemAsideKpiIcon}>
                          <DetailsIconCalendarSmall />
                        </div>
                        <div className={dash.itemAsideKpiText}>
                          <div className={dash.itemAsideKpiLabel}>Última Etiqueta</div>
                          <div className={dash.itemAsideKpiValue}>{detailsUltimaEtiquetaLabel}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </aside>
              </div>
            </section>
          </div>
        ) : (
          <>
            <section className={styles.header}>
              <div className={styles.headerIcon}>
                <IconPrep />
              </div>
              <div className={styles.headerText}>
                <h1 className={styles.title}>Pré-preparo</h1>
                <p className={styles.subtitle}>Acompanhe com precisão o custo de cada receita usando fichas de ingredientes detalhadas.</p>
              </div>
            </section>

            <section className={styles.toolbar}>
              <div className={styles.filters}>
                <div className={styles.search}>
                  <span className={styles.searchIcon}>
                    <IconSearch />
                  </span>
                  <input className={styles.searchInput} placeholder="Pesquise por receitas..." value={query} onChange={(e) => setQuery(e.target.value)} />
                </div>
                <select className={styles.select} value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)}>
                  <option value="Categorias">Categorias</option>
                  {recipeCategories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={() => {
                    openEtiquetaModal(null);
                  }}
                >
                  <IconLabel />
                  Nova Etiqueta
                </button>
                <button type="button" className={styles.primaryBtn} onClick={openNewRecipeModal}>
                  <IconPlus />
                  Nova Receita
                </button>
              </div>
            </section>

            <section className={styles.board}>
              {visible[0] ? (
                visible.map((r) => (
                  <div
                    key={r.id}
                    className={styles.recipeCard}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setOpenMenuId(null);
                      setDetailsTab("ingredientes");
                      setDetailsRecipeId(r.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.preventDefault();
                      setOpenMenuId(null);
                      setDetailsTab("ingredientes");
                      setDetailsRecipeId(r.id);
                    }}
                  >
                    <div className={styles.recipeTop}>
                      <div className={styles.recipeLeft}>
                        <div className={styles.recipeIcon} aria-hidden>
                          <IconCubeOutline />
                        </div>
                        <div className={styles.recipeMeta}>
                          <div className={styles.recipeCategory}>{r.categoria}</div>
                          <div className={styles.recipeName}>{r.receita}</div>
                          <div className={styles.recipeDash}>-</div>
                        </div>
                      </div>
                      <div className={styles.menuWrap} ref={openMenuId === r.id ? menuWrapRef : undefined} onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className={styles.dotsBtn}
                          aria-label="Opções"
                          onClick={() => setOpenMenuId((prev) => (prev === r.id ? null : r.id))}
                        >
                          <IconDots />
                        </button>
                        {openMenuId === r.id ? (
                          <div className={styles.menu} role="menu" aria-label="Opções da receita">
                            <button
                              type="button"
                              className={styles.menuItem}
                              role="menuitem"
                              onClick={() => {
                                setOpenMenuId(null);
                                openEditModal(r);
                              }}
                            >
                              <span className={styles.menuIcon} aria-hidden>
                                <IconEdit />
                              </span>
                              Editar
                            </button>
                            <button
                              type="button"
                              className={styles.menuItem}
                              role="menuitem"
                              onClick={() => {
                                setOpenMenuId(null);
                                openEtiquetaModal(r);
                              }}
                            >
                              <span className={styles.menuIcon} aria-hidden>
                                <IconEtiqueta />
                              </span>
                              Nova Etiqueta
                            </button>
                            <button
                              type="button"
                              className={styles.menuItem}
                              role="menuitem"
                              onClick={() => {
                                setOpenMenuId(null);
                                void downloadFichaTecnica(getPdfRow(r));
                              }}
                            >
                              <span className={styles.menuIcon} aria-hidden>
                                <IconPdf />
                              </span>
                              Ficha Técnica
                            </button>
                            <button
                              type="button"
                              className={styles.menuItem}
                              role="menuitem"
                              onClick={() => {
                                setOpenMenuId(null);
                                openDeleteModal(r);
                              }}
                            >
                              <span className={styles.menuIcon} aria-hidden>
                                <IconTrashOutline />
                              </span>
                              Excluir
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className={styles.recipeStats}>
                      <div className={styles.statRow}>
                        <div className={styles.statLabel}>Custo Total:</div>
                        <div className={styles.statValue}>{r.custoTotal}</div>
                      </div>
                      <div className={styles.statRow}>
                        <div className={styles.statLabel}>Rendimento:</div>
                        <div className={styles.statValue}>{r.rendimento}</div>
                      </div>
                      <div className={styles.statRow}>
                        <div className={styles.statLabel}>Custo Unitário:</div>
                        <div className={styles.statValue}>{r.custoUnitario}</div>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className={styles.emptyBoard}>Sem receitas cadastradas</div>
              )}
            </section>

            <section className={styles.footer}>
              <div>{`${visible.length} resultado(s) encontrado(s)`}</div>
              <div className={styles.pagination}>
                <button type="button" className={styles.pageBtn} disabled aria-label="Primeira página">
                  «
                </button>
                <button type="button" className={styles.pageBtn} disabled aria-label="Página anterior">
                  ‹
                </button>
                <div className={styles.pageInfo}>1 de 1</div>
                <button type="button" className={styles.pageBtn} disabled aria-label="Próxima página">
                  ›
                </button>
                <button type="button" className={styles.pageBtn} disabled aria-label="Última página">
                  »
                </button>
              </div>
            </section>
          </>
        )}

        {isEditOpen ? (
          <div className={styles.modalOverlay} role="presentation" onClick={() => setIsEditOpen(false)}>
            <div className={styles.modal} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitle}>Editar Item</div>
                <button type="button" className={styles.modalClose} aria-label="Fechar" onClick={() => setIsEditOpen(false)}>
                  ×
                </button>
              </div>

              <div className={styles.modalBody}>
                <div className={styles.imageRow}>
                  <div className={styles.imageBox} onClick={() => fileInputRef.current?.click()} role="button" tabIndex={0}>
                    Enviar Imagem
                  </div>
                  <div className={styles.imageHint}>Tamanho recomendado: 600 × 600 px</div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className={styles.fileInput}
                    onChange={() => {
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                  />
                </div>

                <div className={styles.formField}>
                  <div className={styles.formLabel}>Nome do Item</div>
                  <input className={styles.formInput} value={draftName} onChange={(e) => setDraftName(e.target.value)} />
                </div>

                <div className={styles.formField}>
                  <div className={styles.formLabelRow}>
                    <div className={styles.formLabel}>Categoria</div>
                    <button type="button" className={styles.addCategoryBtn} onClick={() => openCategoriasModal("edit")}>
                      Add categoria
                    </button>
                  </div>
                  <select className={styles.formSelect} value={draftCategory} onChange={(e) => setDraftCategory(e.target.value)}>
                    {!recipeCategories.length ? (
                      <option value="">Sem categorias</option>
                    ) : null}
                    {recipeCategories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div className={styles.formField}>
                  <div className={styles.formLabel}>Especificação</div>
                  <input className={styles.formInput} placeholder="Escreva algo..." value={draftSpec} onChange={(e) => setDraftSpec(e.target.value)} />
                </div>

                <div className={styles.formField}>
                  <div className={styles.formLabel}>Unidade de Medida</div>
                  <select className={styles.formSelect} value={draftUnit} onChange={(e) => setDraftUnit(e.target.value)}>
                    <option value="Kg">Kg</option>
                    <option value="g">g</option>
                    <option value="L">L</option>
                    <option value="ml">ml</option>
                    <option value="Un">Un</option>
                  </select>
                </div>

                <div className={styles.formField}>
                  <div className={styles.formLabel}>
                    Prazo de Validade <span className={styles.optional}>(opcional)</span>
                  </div>
                  <div className={styles.validityRow}>
                    <input className={styles.validityInput} inputMode="numeric" value={draftValidity} onChange={(e) => setDraftValidity(e.target.value)} />
                    <select className={styles.validitySelect} value={draftValidityUnit} onChange={() => {}} disabled>
                      <option value="Dia(s)">Dia(s)</option>
                    </select>
                  </div>
                  <div className={styles.helper}>Esse prazo será considerado para todos os futuros registros deste item.</div>
                </div>
              </div>

              <div className={styles.modalFooter}>
                <button
                  type="button"
                  className={styles.saveBtn}
                  onClick={() => {
                    if (!editingId) return;
                    const name = draftName.trim();
                    if (!name) return;
                    setRows((prev) => prev.map((r) => (r.id === editingId ? { ...r, receita: name, categoria: draftCategory } : r)));
                    setIsEditOpen(false);
                    setEditingId(null);
                  }}
                >
                  Salvar
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {isEtiquetaOpen ? (
          <div className={styles.modalOverlay} role="presentation" onClick={() => setIsEtiquetaOpen(false)}>
            <div className={`${styles.modal} ${styles.etiquetaModal}`} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitle}>Nova Etiqueta</div>
                <button type="button" className={styles.modalClose} aria-label="Fechar" onClick={() => setIsEtiquetaOpen(false)}>
                  ×
                </button>
              </div>

              <div className={styles.etiquetaBody}>
                <div className={styles.formField}>
                  <div className={styles.formLabel}>Receita</div>
                  <div className={styles.recipeSelectWrap} ref={recipeWrapRef}>
                    <div
                      className={styles.recipeSelect}
                      onClick={() => setIsRecipeOpen((p) => !p)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") setIsRecipeOpen((p) => !p);
                      }}
                    >
                      <span className={styles.recipeSelectIcon} aria-hidden>
                        <IconSearch />
                      </span>
                      <input
                        className={styles.recipeSelectInput}
                        placeholder="Pesquise por itens..."
                        value={etiquetaRecipeQuery}
                        onChange={(e) => {
                          setEtiquetaRecipeQuery(e.target.value);
                          setIsRecipeOpen(true);
                        }}
                        onFocus={() => setIsRecipeOpen(true)}
                      />
                      <span className={styles.recipeSelectChevron} aria-hidden>
                        ▾
                      </span>
                    </div>
                    {isRecipeOpen ? (
                      <div className={styles.recipeDropdown} role="listbox" aria-label="Receitas">
                        {etiquetaRecipeOptions.length ? (
                          etiquetaRecipeOptions.map((r) => (
                            <button
                              key={r.id}
                              type="button"
                              className={styles.recipeOption}
                              onClick={() => {
                                setEtiquetaRecipeId(r.id);
                                setEtiquetaRecipeQuery(r.receita);
                                setEtiquetaUnidade("Kg");
                                const base = new Date();
                                setEtiquetaDataProd(formatDateLabel(base));
                                setEtiquetaDataVal(formatDateLabel(new Date(base.getTime() + 7 * 24 * 60 * 60 * 1000)));
                                setIsRecipeOpen(false);
                              }}
                            >
                              {r.receita}
                            </button>
                          ))
                        ) : (
                          <div className={styles.emptyText}>
                            Cadastre uma receita no Pré-preparo para depois selecionar aqui e gerar a etiqueta.
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className={styles.formField}>
                  <div className={styles.formLabel}>Responsável</div>
                  <input
                    className={styles.formInput}
                    placeholder="Digite o nome..."
                    value={etiquetaResponsavel}
                    onChange={(e) => setEtiquetaResponsavel(e.target.value)}
                  />
                </div>

                <div className={styles.formField}>
                  <div className={styles.formLabel}>Qtd. Produzida</div>
                  <div className={styles.qtyWrap}>
                    <input
                      className={styles.qtyInput}
                      value={etiquetaQtd}
                      onChange={(e) => setEtiquetaQtd(formatDecimalDraft(e.target.value, 3))}
                      onBlur={(e) => setEtiquetaQtd(formatDecimalFixedDraft(e.target.value, 3))}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.currentTarget.focus();
                        e.currentTarget.select();
                      }}
                      onFocus={(e) => e.currentTarget.select()}
                      inputMode="numeric"
                    />
                    <div className={styles.qtyUnit}>{etiquetaUnidade}</div>
                  </div>
                </div>

                <div className={styles.datesHeader}>
                  <div className={styles.datesHeaderCol}>
                    <div className={styles.formLabel}>Data Produção</div>
                    <div className={styles.datesHint}>Hoje</div>
                  </div>
                  <div className={styles.datesHeaderColRight}>
                    <div className={styles.formLabel}>Data de Validade</div>
                    <div className={styles.datesHint}>{`${etiquetaValidityDays} Dia(s)`}</div>
                  </div>
                </div>

                <div className={styles.datesRow}>
                  <div className={styles.dateWrap} ref={etiquetaProdWrapRef}>
                    <input
                      className={styles.formInput}
                      value={etiquetaDataProd}
                      onChange={(e) => setEtiquetaDataProd(e.target.value)}
                      onFocus={() => openEtiquetaCalendarAt("prod")}
                      onClick={() => openEtiquetaCalendarAt("prod")}
                    />
                  </div>

                  <div className={styles.dateWrap} ref={etiquetaValWrapRef}>
                    <input
                      className={styles.formInput}
                      value={etiquetaDataVal}
                      onChange={(e) => setEtiquetaDataVal(e.target.value)}
                      onFocus={() => openEtiquetaCalendarAt("val")}
                      onClick={() => openEtiquetaCalendarAt("val")}
                    />
                  </div>
                </div>

                <div className={styles.obs}>{`OBS: O prazo de validade padrão do item selecionado é de ${etiquetaValidityDays} Dia(s).`}</div>

                <div className={styles.previewWrap}>
                  <div className={styles.previewTitle}>PRÉ-VISUALIZAÇÃO</div>
                  <div className={styles.previewPaper}>
                    <div className={styles.previewTopRow}>
                      <div className={styles.previewName}>{etiquetaSelectedRecipe ? etiquetaSelectedRecipe.receita : "Selecione uma receita"}</div>
                      <div className={styles.previewQty}>
                        {etiquetaSelectedRecipe ? `${etiquetaQtd} ${etiquetaUnidade}` : `0 ${etiquetaUnidade}`}
                      </div>
                    </div>
                    <div className={styles.previewHr} />
                    <div className={styles.previewLine}>
                      <div className={styles.previewLabel}>Responsável:</div>
                      <div className={styles.previewValue}>{etiquetaResponsavel}</div>
                    </div>
                    <div className={styles.previewLine}>
                      <div className={styles.previewLabel}>Data Produção:</div>
                      <div className={styles.previewValue}>{(() => {
                        const d = parseDateLabelLoose(etiquetaDataProd);
                        return d ? formatDateNumeric(d) : "-";
                      })()}</div>
                    </div>
                    <div className={styles.previewLine}>
                      <div className={styles.previewLabel}>Data de Validade:</div>
                      <div className={styles.previewValue}>{(() => {
                        const d = parseDateLabelLoose(etiquetaDataVal);
                        return d ? formatDateNumeric(d) : "-";
                      })()}</div>
                    </div>
                    <div className={styles.previewHr} />
                    <div className={styles.previewFooter}>
                      {(() => {
                        const now = new Date();
                        return `Impresso em ${formatDateNumeric(now)} às ${now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} · Por CMV Fácil · #F2G24KY`;
                      })()}
                    </div>
                  </div>
                </div>
              </div>

              <div className={styles.etiquetaFooter}>
                <button
                  type="button"
                  className={styles.printBtn}
                  disabled={!etiquetaRecipeId}
                  onClick={saveEtiqueta}
                >
                  Salvar e Imprimir
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {isMounted && openEtiquetaCalendar ? createPortal(renderEtiquetaCalendar(openEtiquetaCalendar), document.body) : null}

        {isDeleteOpen ? (
          <div className={styles.modalOverlay} role="presentation" onClick={() => setIsDeleteOpen(false)}>
            <div className={`${styles.modal} ${styles.confirmModal}`} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitle}>Excluir Receita?</div>
                <button type="button" className={styles.modalClose} aria-label="Fechar" onClick={() => setIsDeleteOpen(false)}>
                  ×
                </button>
              </div>

              <div className={styles.confirmBody}>
                <div className={styles.confirmIcon} aria-hidden>
                  <IconTrashOutline />
                </div>
                <div className={styles.confirmText}>
                  Caso exclua a receita <strong>&quot;{deletingName}&quot;</strong> não poderá recuperá-la.
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
          </div>
        ) : null}

        {isNewRecipeOpen ? (
          <div className={styles.modalOverlay} role="presentation" onClick={() => setIsNewRecipeOpen(false)}>
            <div className={`${styles.modal} ${styles.recipeModal}`} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitle}>Cadastro de Receita (Pré-preparo)</div>
                <button type="button" className={styles.modalClose} aria-label="Fechar" onClick={() => setIsNewRecipeOpen(false)}>
                  ×
                </button>
              </div>

              <div className={styles.recipeBody}>
                <div className={styles.stepRow}>
                  <div className={styles.stepText}>{`${newRecipeStep} de 3`}</div>
                  <div className={styles.stepBars} aria-hidden>
                    <div className={newRecipeStep >= 1 ? `${styles.stepBar} ${styles.stepBarOn}` : styles.stepBar} />
                    <div className={newRecipeStep >= 2 ? `${styles.stepBar} ${styles.stepBarOn}` : styles.stepBar} />
                    <div className={newRecipeStep >= 3 ? `${styles.stepBar} ${styles.stepBarOn}` : styles.stepBar} />
                  </div>
                </div>

                {newRecipeStep === 1 ? (
                  <>
                    <div className={styles.imageRow}>
                      <div className={styles.imageBox} onClick={() => newRecipeFileRef.current?.click()} role="button" tabIndex={0}>
                        Enviar Imagem
                      </div>
                      <div className={styles.imageHint}>Tamanho recomendado: 600 × 600 px</div>
                      <input
                        ref={newRecipeFileRef}
                        type="file"
                        accept="image/*"
                        className={styles.fileInput}
                        onChange={() => {
                          if (newRecipeFileRef.current) newRecipeFileRef.current.value = "";
                        }}
                      />
                    </div>

                    <div className={styles.formField}>
                      <div className={styles.formLabel}>Nome da Receita</div>
                      <input
                        className={styles.formInput}
                        placeholder="Ex: Maionese da casa"
                        value={newRecipeName}
                        onChange={(e) => setNewRecipeName(e.target.value)}
                      />
                    </div>

                    <div className={styles.formField}>
                      <div className={styles.formLabel}>Especificação</div>
                      <input
                        className={styles.formInput}
                        placeholder="Descreva como será usado..."
                        value={newRecipeSpec}
                        onChange={(e) => setNewRecipeSpec(e.target.value)}
                      />
                    </div>

                    <div className={styles.grid2}>
                      <div className={styles.formField}>
                        <div className={styles.formLabelRow}>
                          <div className={styles.formLabel}>Categoria</div>
                          <button type="button" className={styles.addCategoryBtn} onClick={() => openCategoriasModal("new")}>
                            Add categoria
                          </button>
                        </div>
                        <select className={styles.formSelect} value={newRecipeCategory} onChange={(e) => setNewRecipeCategory(e.target.value)}>
                          <option value="">Selecione</option>
                          {recipeCategories.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className={styles.formField}>
                        <div className={styles.formLabel}>Unidade de Medida</div>
                        <select className={styles.formSelect} value={newRecipeUnit} onChange={(e) => setNewRecipeUnit(e.target.value)}>
                          <option value="">Selecione</option>
                          <option value="Kg">Kg</option>
                          <option value="g">g</option>
                          <option value="L">L</option>
                          <option value="ml">ml</option>
                          <option value="Un">Un</option>
                        </select>
                      </div>
                    </div>

                    <div className={styles.formField}>
                      <div className={styles.formLabel}>
                        Prazo de Validade <span className={styles.optional}>(opcional)</span>
                      </div>
                      <div className={styles.validityRow}>
                        <input className={styles.validityInput} inputMode="numeric" value={newRecipeValidity} onChange={(e) => setNewRecipeValidity(e.target.value)} />
                      <select className={styles.validitySelect} value={newRecipeValidityUnit} onChange={() => {}} disabled>
                        <option value="Dia(s)">Dia(s)</option>
                        </select>
                      </div>
                      <div className={styles.helper}>Este prazo será considerado para todas as etiquetas desse item.</div>
                    </div>
                  </>
                ) : newRecipeStep === 2 ? (
                  <>
                    <div className={styles.stepTitle}>Ingredientes Utilizados</div>
                    <div className={styles.stepSubtitle}>
                      Adicione os itens que compõem esta receita, com suas respectivas quantidades.
                    </div>

                    <div className={styles.ingredientsBox}>
                      <div className={styles.ingredientsHead}>
                        <div className={styles.ingredientsHeadItem}>Item</div>
                        <div className={styles.ingredientsHeadQty}>Quantidade</div>
                        <div className={styles.ingredientsHeadCost}>Custo</div>
                      </div>

                      <div className={styles.ingredientsRow}>
                        <div className={styles.ingredientWrap} ref={ingredientWrapRef}>
                          <div className={styles.ingredientItem}>
                          <span className={styles.ingredientSearchIcon} aria-hidden>
                            <IconSearch />
                          </span>
                          <input
                            className={styles.ingredientItemInput}
                            placeholder="Pesquise por itens..."
                            value={ingredientQuery}
                            onChange={(e) => {
                              setIngredientQuery(e.target.value);
                              setIsIngredientMenuOpen(true);
                            }}
                            onFocus={() => setIsIngredientMenuOpen(true)}
                          />
                          <button
                            type="button"
                            className={styles.ingredientChevronBtn}
                            aria-label="Abrir lista de insumos"
                            onClick={() => setIsIngredientMenuOpen((v) => !v)}
                          >
                            ▾
                          </button>
                          </div>

                          {isIngredientMenuOpen ? (
                            <div className={styles.ingredientDropdown} role="listbox" aria-label="Insumos cadastrados">
                              {ingredientSuggestions.map((name) => (
                                <button
                                  key={name}
                                  type="button"
                                  className={styles.ingredientOption}
                                  onClick={() => {
                                    setIngredientQuery(name);
                                    setIngredientUnit(insumosByName.get(name.toLowerCase())?.medida ?? "Und");
                                    setIsIngredientMenuOpen(false);
                                  }}
                                >
                                  {name}
                                </button>
                              ))}
                              {!ingredientSuggestions[0] ? <div className={styles.ingredientEmpty}>Nenhum insumo encontrado</div> : null}
                            </div>
                          ) : null}
                        </div>

                        <div className={styles.ingredientQtyWrap}>
                          <input
                            className={styles.ingredientQtyInput}
                            value={ingredientQty}
                            onChange={(e) => setIngredientQty(formatDecimalDraft(e.target.value, 3))}
                            onBlur={(e) => setIngredientQty(formatDecimalFixedDraft(e.target.value, 3))}
                            onPointerDown={(e) => {
                              e.preventDefault();
                              e.currentTarget.focus();
                              e.currentTarget.select();
                            }}
                            onFocus={(e) => e.currentTarget.select()}
                            inputMode="numeric"
                          />
                          <div className={styles.ingredientQtyUnit}>{ingredientUnit}</div>
                        </div>

                        <div className={styles.ingredientCostWrap}>
                          <div className={styles.ingredientCostPrefix}>R$</div>
                          <input className={styles.ingredientCostInput} value={ingredientCost} readOnly />
                        </div>

                        <button
                          type="button"
                          className={styles.ingredientAddBtn}
                          aria-label="Adicionar ingrediente"
                          onClick={() => {
                            const item = ingredientQuery.trim();
                            if (!item) return;
                            const cents = clampNonNegativeInt(parseCurrencyBRLToCents(ingredientCost));
                            const qty = ingredientQty.replace(/[^\d,]/g, "").trim() || "0";
                            setNewRecipeIngredients((prev) => [
                              ...prev,
                              { id: String(prev.length + 1), item, quantidade: qty, unidade: ingredientUnit, custoCents: cents },
                            ]);
                            setIngredientQuery("");
                            setIngredientQty("0,000");
                            setIngredientUnit("Und");
                            setIngredientCost("0,00");
                          }}
                        >
                          <IconPlusCircle />
                        </button>
                      </div>

                      <div className={styles.ingredientsDividerIcon} aria-hidden>
                        <IconChevronDownDouble />
                      </div>

                      {newRecipeIngredients.map((ing) => (
                        <div key={ing.id} className={styles.ingredientsListRow}>
                          <div className={styles.ingredientsListItem}>{ing.item}</div>
                          <div className={styles.ingredientsListQty}>{`${ing.quantidade} ${ing.unidade}`}</div>
                          <div className={styles.ingredientsListCost}>{formatCurrencyBRLFromCents(ing.custoCents)}</div>
                          <button
                            type="button"
                            className={styles.ingredientsTrashBtn}
                            aria-label="Remover"
                            onClick={() => setNewRecipeIngredients((prev) => prev.filter((r) => r.id !== ing.id))}
                          >
                            <IconTrashSmall />
                          </button>
                        </div>
                      ))}

                      <div className={styles.ingredientsTotal}>
                        <div>Custo Total</div>
                        <div>{formatCurrencyBRLFromCents(recipeTotalCents)}</div>
                      </div>
                    </div>

                    <div className={styles.yieldRow}>
                      <div className={styles.yieldText}>
                        <div className={styles.yieldTitle}>Quanto Rende?</div>
                        <div className={styles.yieldSubtitle}>Informe quanto essa receita irá render em média após o preparo.</div>
                      </div>
                      <div className={styles.yieldInputWrap}>
                        <input
                          className={styles.yieldInput}
                          value={newRecipeYield}
                          onChange={(e) => setNewRecipeYield(formatDecimalDraft(e.target.value, 3))}
                          onBlur={(e) => setNewRecipeYield(formatDecimalFixedDraft(e.target.value, 3))}
                          onPointerDown={(e) => {
                            e.preventDefault();
                            e.currentTarget.focus();
                            e.currentTarget.select();
                          }}
                          onFocus={(e) => e.currentTarget.select()}
                          inputMode="numeric"
                        />
                        <div className={styles.yieldUnit}>{newRecipeYieldUnit}</div>
                      </div>
                    </div>
                  </>
                ) : newRecipeStep === 3 ? (
                  <>
                    <div className={styles.stepTitle}>Resumo</div>
                    <div className={styles.stepSubtitle}>Confira abaixo o resumo da sua receita antes de finalizar o cadastro.</div>

                    <div className={styles.summaryCard}>
                      <div className={styles.summaryTop}>
                        <div className={styles.summaryIcon} aria-hidden>
                          <IconCubeOutline />
                        </div>
                        <div className={styles.summaryMeta}>
                          <div className={styles.summaryName}>{newRecipeName || "-"}</div>
                          <div className={styles.summarySpec}>{newRecipeSpec || "-"}</div>
                        </div>
                      </div>

                      <div className={styles.summaryStats}>
                        <div className={styles.summaryRow}>
                          <div className={styles.summaryLabel}>Custo Total:</div>
                          <div className={styles.summaryValue}>{formatCurrencyBRLFromCents(recipeTotalCents)}</div>
                        </div>
                        <div className={styles.summaryRow}>
                          <div className={styles.summaryLabel}>Rendimento:</div>
                          <div className={styles.summaryValue}>{`${formatPtQty(recipeYieldValue)}${newRecipeYieldUnit}`}</div>
                        </div>
                        <div className={styles.summaryRow}>
                          <div className={styles.summaryLabel}>Custo Unitário:</div>
                          <div className={styles.summaryValueBig}>
                            {`${recipeUnitCost.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} / ${newRecipeYieldUnit}`}
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className={styles.recipeStepPlaceholder} />
                )}
              </div>

              <div className={styles.recipeFooter}>
                <button
                  type="button"
                  className={styles.recipeCancelBtn}
                  onClick={() => {
                    if (newRecipeStep === 1) {
                      setIsNewRecipeOpen(false);
                      return;
                    }
                    setNewRecipeStep((s) => (s === 3 ? 2 : 1));
                  }}
                >
                  {newRecipeStep === 1 ? "Cancelar" : "Voltar"}
                </button>
                <button
                  type="button"
                  className={styles.recipeNextBtn}
                  disabled={newRecipeStep === 1 ? !canGoNextRecipe : newRecipeStep === 2 ? !canGoNextRecipeStep2 : false}
                  onClick={() => {
                    if (newRecipeStep === 1 && !canGoNextRecipe) return;
                    if (newRecipeStep === 2 && !canGoNextRecipeStep2) return;
                    if (newRecipeStep === 3) {
                      if (!canSaveRecipe) {
                        window.alert("Preencha o rendimento da receita para liberar o salvamento.");
                        setNewRecipeStep(2);
                        return;
                      }
                      const nextId = String(Date.now());
                      const totalLabel = formatCurrencyBRLFromCents(recipeTotalCents);
                      const rendimentoLabel = `${formatPtQty(recipeYieldValue)}${newRecipeYieldUnit}`;
                      const unitCostLabel = `${recipeUnitCost.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} / ${newRecipeYieldUnit}`;
                      setRows((prev) => [
                        {
                          id: nextId,
                          categoria: newRecipeCategory,
                          receita: newRecipeName.trim(),
                          custoTotal: totalLabel,
                          rendimento: rendimentoLabel,
                          custoUnitario: unitCostLabel,
                          validadeDias: clampNonNegativeInt(Number.parseInt(newRecipeValidity.replace(/[^\d]/g, "") || "0", 10)) || 7,
                          modoPreparo: "",
                          ingredientes: newRecipeIngredients,
                        },
                        ...prev,
                      ]);
                      setSelectedCategory("Categorias");
                      setQuery("");
                      setIsNewRecipeOpen(false);
                      return;
                    }
                    setNewRecipeStep((s) => (s === 1 ? 2 : s === 2 ? 3 : 3));
                  }}
                >
                  {newRecipeStep === 3 ? "Salvar" : "Próximo"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {isCategoriasOpen ? (
          <div className={insumosStyles.modalOverlay} role="presentation" onClick={() => setIsCategoriasOpen(false)} style={{ zIndex: 10000 }}>
            <div className={`${insumosStyles.modal} ${insumosStyles.categoriesModal}`} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className={insumosStyles.modalHeader}>
                <div className={insumosStyles.modalTitle}>Categorias de Itens</div>
                <button type="button" className={insumosStyles.modalClose} aria-label="Fechar" onClick={() => setIsCategoriasOpen(false)}>
                  ×
                </button>
              </div>

              <div className={insumosStyles.categoriesBody}>
                <div className={insumosStyles.categoriesLabel}>Nome da Categoria</div>
                <div className={insumosStyles.categoriesRow}>
                  <input
                    className={insumosStyles.categoriesInput}
                    placeholder="Ex: Proteínas"
                    value={categoryNewDraft}
                    onChange={(e) => setCategoryNewDraft(e.target.value)}
                  />
                  <button type="button" className={insumosStyles.categoriesAddBtn} onClick={() => void addCategoriaFromModal()} disabled={!normalizeCategoryName(categoryNewDraft)}>
                    <IconPlus /> ADD
                  </button>
                </div>
                <div className={insumosStyles.categoriesDivider} />

                <div className={insumosStyles.categoriesList}>
                  {categoriesSorted.map((c) => (
                    <div key={c} className={insumosStyles.categoryItem}>
                      {editingCategoryOriginal === c ? (
                        <>
                          <input
                            className={insumosStyles.categoryInlineInput}
                            value={editingCategoryDraft}
                            onChange={(e) => setEditingCategoryDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void confirmEditCategoria();
                              if (e.key === "Escape") cancelEditCategoria();
                            }}
                            autoFocus
                          />
                          <div className={insumosStyles.categoryCount} />
                          <div className={insumosStyles.categoryActions}>
                            <button
                              type="button"
                              className={`${insumosStyles.categoryIconBtn} ${insumosStyles.categoryIconBtnConfirm}`}
                              aria-label="Confirmar edição"
                              onClick={() => void confirmEditCategoria()}
                              disabled={!normalizeCategoryName(editingCategoryDraft)}
                            >
                              <IconCheck />
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className={insumosStyles.categoryName}>{c}</div>
                          <div className={insumosStyles.categoryCount}>{categoryCounts.get(c) ?? 0}</div>
                          <div className={insumosStyles.categoryActions}>
                            <button type="button" className={insumosStyles.categoryIconBtn} aria-label="Editar categoria" onClick={() => editCategoria(c)}>
                              <IconEdit />
                            </button>
                            <button type="button" className={insumosStyles.categoryIconBtn} aria-label="Excluir categoria" onClick={() => openDeleteCategoria(c)}>
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
          <div className={insumosStyles.modalOverlay} role="presentation" onClick={cancelDeleteCategoria} style={{ zIndex: 10000 }}>
            <div className={insumosStyles.modal} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className={insumosStyles.modalHeader}>
                <div className={insumosStyles.modalTitle}>Excluir Categoria?</div>
                <button type="button" className={insumosStyles.modalClose} aria-label="Fechar" onClick={cancelDeleteCategoria}>
                  ×
                </button>
              </div>

              <div className={insumosStyles.confirmBody}>
                <div className={insumosStyles.confirmIcon}>
                  <IconTrash />
                </div>
                <div className={insumosStyles.confirmText}>
                  Caso exclua a categoria <strong>“{deletingCategoryName}”</strong> não poderá recuperá-la.
                  {deletingCategoryCount ? (
                    <>
                      <br />
                      Existem <strong>{deletingCategoryCount}</strong> itens nessa categoria; eles ficarão sem categoria.
                    </>
                  ) : null}
                </div>
              </div>

              <div className={insumosStyles.confirmActions}>
                <button type="button" className={insumosStyles.confirmDelete} onClick={() => void confirmDeleteCategoria()}>
                  Excluir
                </button>
                <button type="button" className={insumosStyles.confirmCancel} onClick={cancelDeleteCategoria}>
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
