"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";
import dash from "../dashboard/dashboard.module.css";
import SystemToast from "../components/SystemToast";
import LoadingSpinner from "../components/LoadingSpinner";
import { loadInsumosFromSupabase } from "../lib/insumosSupabase";
import { readInsumosFromStore, subscribeInsumos, writeInsumosToStore, type InsumoStoreItem } from "../lib/insumosStore";
import { readEntradasFromStore, subscribeEntradas, writeEntradasToStore, type EntradaStoreRow } from "../lib/entradasStore";
import { loadEntradasFromSupabase } from "../lib/entradasSupabase";
import { readFornecedorEquivalenciasMap, subscribeFornecedorEquivalencias, writeFornecedorEquivalenciasMap, type FornecedorEquivalenciasMap } from "../lib/fornecedoresStore";
import { loadFornecedoresStateFromSupabase } from "../lib/fornecedoresSupabase";
import { readFichasTecnicasFromStore, writeFichasTecnicasToStore } from "../lib/fichasTecnicasStore";
import { loadFichasTecnicasFromSupabase, loadFichasTecnicasStateFromSupabase, saveFichasTecnicasToSupabase, type FichaTecnicaCompatRecipe } from "../lib/fichasTecnicasSupabase";
import { readPrePreparoFromStore, subscribePrePreparo, writePrePreparoToStore, type PrePreparoStoreRow } from "../lib/prePreparoStore";
import { loadPrePreparoFromSupabase } from "../lib/prePreparoSupabase";
import { QaModePanel } from "../lib/qaMode";
import styles from "./fichas-tecnicas.module.css";

function isMissingTableError(err: unknown, table: string) {
  const msg = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  const t = table.toLowerCase();
  return msg.includes("could not find the table") && msg.includes(t);
}

type BcgType = "estrela" | "cavalo" | "quebra-cabeca" | "abacaxi";
type ThumbType = "burger" | "duplo" | "triplo";

type RecipeRow = {
  id: string;
  receita: string;
  precoVenda: string;
  precoVendaSub?: string;
  custoUnitario: string;
  cmvMeta: string;
  cmvAtual: string;
  cmvDelta: string;
  bcg: BcgType;
  thumb: ThumbType;
  recipeImage?: string;
  popularidade?: "alta" | "baixa";
  ingredientsTotal?: number;
  recipeYield?: number;
  ingredientRows?: ModalIngredientRow[];
  modoPreparo?: string;
};

type ModalIngredientRow = {
  id: string;
  ingredientId: string;
  item: string;
  quantidade: string;
  unidade: string;
  custoTotal: number;
};

type IngredientOption = {
  id: string;
  item: string;
  medida: string;
  custoMedio: string;
  kind: "insumo" | "prepreparo" | "ficha";
};

type SavedRecipeDetails = {
  rowId: string;
  recipeName: string;
  recipeImage: string;
  popularidade: string;
  precoVenda: number;
  cmvMeta: number;
  cmvAtual: number;
  ingredientsTotal: number;
  recipeYield: number;
  ingredientRows: ModalIngredientRow[];
  modoPreparo: string;
};

type EditRecipeDraft = {
  rowId: string;
  thumb: ThumbType;
  recipeName: string;
  precoVenda: string;
  cmvMeta: string;
  popularidade: string;
  custoUnitario: number;
};

type FichaTableColumn = "receita" | "precoVenda" | "custoUnitario" | "cmvMeta" | "cmvAtual" | "bcg";

const bcgInfo: Array<{
  key: BcgType;
  title: string;
  description: string;
  bullets: string[];
  icon: string;
}> = [
  {
    key: "estrela",
    title: "Estrela",
    description: "Produtos muito vendidos e altamente lucrativos.",
    bullets: ["Devem ser priorizados e destacados"],
    icon: "star",
  },
  {
    key: "cavalo",
    title: "Cavalo",
    description: "Produtos populares, mas com margem fraca.",
    bullets: ["Precisam de ajuste urgente"],
    icon: "horse",
  },
  {
    key: "quebra-cabeca",
    title: "Quebra-Cabeça",
    description: "Produtos lucrativos, porém com baixa procura.",
    bullets: ["Têm potencial para crescer. Melhore a divulgação."],
    icon: "puzzle",
  },
  {
    key: "abacaxi",
    title: "Abacaxi",
    description: "Produtos com baixa venda e baixa margem.",
    bullets: ["Candidatos à remoção ou reformulação."],
    icon: "pineapple",
  },
];

function HeaderIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M6.75 3H11.25" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M6.75 2.25H11.25C11.6642 2.25 12 2.58579 12 3V3.75H6V3C6 2.58579 6.33579 2.25 6.75 2.25Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M5.25 3.75H4.5C4.08579 3.75 3.75 4.08579 3.75 4.5V14.25C3.75 14.6642 4.08579 15 4.5 15H13.5C13.9142 15 14.25 14.6642 14.25 14.25V4.5C14.25 4.08579 13.9142 3.75 13.5 3.75H12.75" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6.75 7.5H11.25" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M10.5 4.5A6 6 0 1 0 10.5 16.5A6 6 0 0 0 10.5 4.5Z" stroke="currentColor" strokeWidth="1.8" />
      <path d="M15 15L19.5 19.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5V19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M5 12H19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="5" r="1.7" fill="currentColor" />
      <circle cx="12" cy="12" r="1.7" fill="currentColor" />
      <circle cx="12" cy="19" r="1.7" fill="currentColor" />
    </svg>
  );
}

function SortMark({ dir }: { dir: "asc" | "desc" }) {
  return <span>{dir === "asc" ? "^" : "v"}</span>;
}

function SearchMiniIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M10.5 4.5A6 6 0 1 0 10.5 16.5A6 6 0 0 0 10.5 4.5Z" stroke="currentColor" strokeWidth="1.8" />
      <path d="M15 15L19.5 19.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ChevronDoubleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7.5 7.5L12 12L16.5 7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7.5 12.5L12 17L16.5 12.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TrashIcon() {
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

function PdfIcon() {
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

function EditIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4.5 19.5H8L18.2 9.3C18.98 8.52 18.98 7.26 18.2 6.48L17.52 5.8C16.74 5.02 15.48 5.02 14.7 5.8L4.5 16V19.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M13.5 7L17 10.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5.5 12.5L10 17L18.5 8.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 7L17 17" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M17 7L7 17" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

function MetricPriceIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <ellipse cx="12" cy="7" rx="5.5" ry="2.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M6.5 7V11C6.5 12.4 8.96 13.5 12 13.5C15.04 13.5 17.5 12.4 17.5 11V7" stroke="currentColor" strokeWidth="1.7" />
      <path d="M6.5 11V15C6.5 16.4 8.96 17.5 12 17.5C15.04 17.5 17.5 16.4 17.5 15V11" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function MetricCmvIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5.5A6.5 6.5 0 1 1 5.5 12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M12 2.5V6.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M8.3 10.2L12 12L15.5 8.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MetricTargetIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="3.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 3.5V6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M12 18V20.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M20.5 12H18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M6 12H3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function EmptyBoxIcon() {
  return (
    <svg width="92" height="92" viewBox="0 0 92 92" fill="none" aria-hidden="true">
      <circle cx="46" cy="46" r="30" fill="#f4f6f6" />
      <path d="M30 36L46 30L62 36L54 58H38L30 36Z" fill="#ffffff" stroke="#d9dedd" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M38 33L46 27L54 33" stroke="#d9dedd" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="39" cy="49" r="1.5" fill="#8ea09e" />
      <circle cx="53" cy="49" r="1.5" fill="#8ea09e" />
      <path d="M41.5 54.5C42.8 53.3 44.2 52.75 46 52.75C47.8 52.75 49.2 53.3 50.5 54.5" stroke="#8ea09e" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function BcgIcon({ type }: { type: string }) {
  if (type === "star") {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 4.5L14.1 9L19 9.6L15.4 13.1L16.3 18L12 15.6L7.7 18L8.6 13.1L5 9.6L9.9 9L12 4.5Z" fill="currentColor" />
      </svg>
    );
  }
  if (type === "horse") {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M6 18V11L9 7H14L18 11V18H15V14H9V18H6Z" fill="currentColor" />
        <circle cx="10" cy="10" r="1" fill="#fff" />
      </svg>
    );
  }
  if (type === "puzzle") {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M10 4H7A2 2 0 0 0 5 6V9H7.2A1.8 1.8 0 1 1 7.2 12.6H5V18A2 2 0 0 0 7 20H12V17.8A1.8 1.8 0 1 1 14.6 17.8V20H17A2 2 0 0 0 19 18V13H16.8A1.8 1.8 0 1 1 16.8 10.4H19V6A2 2 0 0 0 17 4H14.6V6.2A1.8 1.8 0 1 1 12 6.2V4H10Z" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4C15 4 18 6.4 18 10.1C18 14.6 14.1 20 12 20C9.9 20 6 14.6 6 10.1C6 6.4 9 4 12 4Z" fill="currentColor" />
      <path d="M8.5 8.5C9.8 7 11.5 6.2 13.6 6.3" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function RecipeThumb({ type, src }: { type: ThumbType; src?: string }) {
  const url = String(src ?? "").trim();
  return (
    <div className={`${styles.thumb} ${type === "burger" ? styles.thumbBurger : type === "duplo" ? styles.thumbDuplo : styles.thumbTriplo}`}>
      {url ? (
        <img src={url} alt="" className={styles.thumbImg} />
      ) : type === "burger" ? (
        <span className={styles.thumbBurgerIcon}>🍔</span>
      ) : (
        <span className={styles.thumbText}>{type.toUpperCase()}</span>
      )}
    </div>
  );
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function parseDecimalInput(value: string) {
  const normalized = String(value ?? "").replace(/\./g, "").replace(",", ".");
  const num = Number(normalized);
  return Number.isFinite(num) ? num : 0;
}

function parseImportedDecimal(value: string) {
  const raw = String(value ?? "")
    .replace(/[^\d,.-]/g, "")
    .trim();
  if (!raw) return 0;
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
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

function formatMoneyDraft(input: string) {
  const digits = String(input ?? "").replace(/\D/g, "");
  if (!digits) return "0,00";
  const cents = Number.parseInt(digits, 10);
  return (cents / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPercent2(value: number) {
  return `${value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

function formatPercentDraft(input: string) {
  const digits = String(input ?? "").replace(/\D/g, "");
  if (!digits) return "0,00";
  const cents = Number.parseInt(digits, 10);
  const value = Math.min(cents / 100, 99);
  return value.toLocaleString("pt-BR", {
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

function popularityLabel(value: string) {
  switch (value) {
    case "alta":
      return "Popularidade Alta";
    case "baixa":
      return "Popularidade Baixa";
    case "Alta":
      return "Popularidade Alta";
    case "Baixa":
      return "Popularidade Baixa";
    default:
      return "Popularidade não informada";
  }
}

function normalizePopularidade(value: string) {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "alta" ? ("alta" as const) : ("baixa" as const);
}

function computeBcg(popularidade: "alta" | "baixa", cmvAtual: number, cmvMeta: number): BcgType {
  const above = cmvMeta > 0 ? cmvAtual > cmvMeta : cmvAtual > 0;
  if (popularidade === "alta") return above ? "cavalo" : "estrela";
  return above ? "abacaxi" : "quebra-cabeca";
}

function computeActionMenuRect(anchor: DOMRect, popWidth = 182, popHeight = 170) {
  const minLeft = 8;
  const maxLeft = Math.max(8, window.innerWidth - 8 - popWidth);
  const preferLeft = anchor.right - popWidth;
  const left = Math.min(maxLeft, Math.max(minLeft, Math.round(preferLeft)));
  const belowTop = Math.round(anchor.bottom + 8);
  const aboveTop = Math.round(anchor.top - 8 - popHeight);
  const top = belowTop + popHeight > window.innerHeight - 8 ? Math.max(8, aboveTop) : belowTop;
  return { left, top };
}

function parseMoneyLabel(value?: string) {
  const raw = String(value ?? "").replace(/[^\d,.-]/g, "").trim();
  if (!raw) return 0;
  return parseDecimalInput(raw);
}

function parseBrlToCents(value: string) {
  const s = String(value ?? "").replace(/[^\d,.-]/g, "").trim();
  if (!s) return 0;
  const neg = s.includes("-");
  const cleaned = s.replace(/-/g, "");
  const parts = cleaned.split(",");
  const intPart = (parts[0] ?? "").replace(/\./g, "").replace(/[^\d]/g, "") || "0";
  const decPart = (parts[1] ?? "").replace(/[^\d]/g, "").slice(0, 2).padEnd(2, "0");
  const cents = Number.parseInt(intPart, 10) * 100 + Number.parseInt(decPart || "0", 10);
  return neg ? -cents : cents;
}

function parseQtyLabel(input: string) {
  const raw = String(input ?? "").trim();
  if (!raw) return { qty: 0, unit: "" };
  const m = raw.match(/^([0-9.,-]+)\s*([A-Za-zÀ-ÿ]+)?$/);
  if (!m) return { qty: parseDecimalInput(raw), unit: "" };
  const qty = parseDecimalInput(m[1] ?? "");
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

function formatQtyLabel(value: string, unidade: string) {
  const qty = parseDecimalInput(value);
  if (!Number.isFinite(qty)) return `0 ${unidade}`;
  const label = Number.isInteger(qty)
    ? String(qty)
    : qty.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 3 });
  return `${label} ${unidade}`;
}

function calcRecipeMetrics(ingredientsTotal: number, recipeYield: number, precoVenda: number, cmvMeta: number) {
  const safeYield = recipeYield > 0 ? recipeYield : 0;
  const custoPorPorcao = safeYield > 0 ? ingredientsTotal / safeYield : 0;
  const cmvAtual = precoVenda > 0 ? (custoPorPorcao / precoVenda) * 100 : 0;
  const precoSugerido = cmvMeta > 0 ? custoPorPorcao / (cmvMeta / 100) : 0;
  return { custoPorPorcao, cmvAtual, precoSugerido };
}

function formatPdfDate(value: Date) {
  return value.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatDateLabel(value: Date) {
  const dd = String(value.getDate()).padStart(2, "0");
  const mm = String(value.getMonth() + 1).padStart(2, "0");
  const yyyy = String(value.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

function addDays(base: Date, days: number) {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

function parsePrePreparoUnitCost(row: Pick<PrePreparoStoreRow, "custoUnitario" | "custoTotal" | "rendimento">) {
  const unitCostLabel = String(row.custoUnitario ?? "").trim();
  const direct = unitCostLabel.match(/R\$\s*([\d.,]+)\s*\/\s*([A-Za-zÀ-ÿ]+)/i);
  if (direct) {
    return { cents: Math.max(0, parseBrlToCents(String(direct[1] ?? ""))), unit: String(direct[2] ?? "").trim() || "Und" };
  }
  const totalCents = Math.max(0, parseBrlToCents(String(row.custoTotal ?? "")));
  const { qty, unit } = parseQtyLabel(String(row.rendimento ?? ""));
  if (!(qty > 0) || !totalCents) return null;
  return { cents: Math.round(totalCents / qty), unit: unit || "Und" };
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function fetchSvgAsDataUrl(path: string) {
  const url = `${window.location.origin}${path}`;
  try {
    const res = await fetch(url, { cache: "force-cache" });
    if (!res.ok) return url;
    const svgText = await res.text();
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
  } catch {
    return url;
  }
}

async function renderSvgMarkupToPngDataUrl(svgMarkup: string, width: number, height: number, scale = 2) {
  return new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Nao foi possivel criar o canvas do PDF."));
        return;
      }
      ctx.scale(scale, scale);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      try {
        resolve(canvas.toDataURL("image/png"));
      } catch {
        reject(new Error("Nao foi possivel gerar a imagem do PDF."));
      }
    };
    img.onerror = () => reject(new Error("Nao foi possivel renderizar o layout do PDF."));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;
  });
}

async function dataUrlToUint8Array(dataUrl: string) {
  const res = await fetch(dataUrl);
  const buffer = await res.arrayBuffer();
  return new Uint8Array(buffer);
}

function buildFichaTecnicaPdfMarkup(params: {
  logoSrc: string;
  recipeName: string;
  precoVenda: string;
  previewSrc: string;
  updatedAt: string;
  validade: string;
  categoria: string;
  custoTotal: string;
  custoUnitario: string;
  precoSugerido: string;
  cmvMeta: string;
  modoPreparo: string;
  rendimento: string;
  ingredients: Array<{ item: string; qtd: string; custo: string }>;
}) {
  const logoSrc = escapeHtml(params.logoSrc);
  const previewSrc = escapeHtml(params.previewSrc);
  const ingredientRows = params.ingredients
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.item)}</td>
          <td>${escapeHtml(row.qtd)}</td>
          <td>${escapeHtml(row.custo)}</td>
        </tr>
      `
    )
    .join("");

  const previewMarkup = params.previewSrc
    ? `<img class="previewImage" src="${previewSrc}" alt="" />`
    : `
      <div class="previewFallback">
        <div class="previewBar"></div>
        <div class="previewBody">
          <div class="previewMain"></div>
          <div class="previewSide"></div>
        </div>
      </div>
    `;

  return `
    <div xmlns="http://www.w3.org/1999/xhtml" class="page">
      <style>
        * { box-sizing: border-box; }
        body { margin: 0; }
        .page {
          width: 595px;
          height: 842px;
          background: #ffffff;
          color: #101214;
          font-family: Arial, Helvetica, sans-serif;
          padding: 24px 18px 18px;
          position: relative;
        }
        .topRow {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
        }
        .logo {
          width: 118px;
          height: auto;
          display: block;
        }
        .updated {
          flex: 1;
          text-align: center;
          font-size: 10px;
          line-height: 12px;
          font-weight: 700;
          color: #2f3537;
          margin-top: 2px;
        }
        .hero {
          margin-top: 8px;
          display: grid;
          grid-template-columns: minmax(0, 1fr) 160px;
          gap: 14px;
          align-items: start;
        }
        .heroLeft {
          min-width: 0;
        }
        .titleBar {
          min-height: 38px;
          border-radius: 7px;
          background: #ecefef;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 0 12px;
        }
        .title {
          font-size: 12px;
          line-height: 14px;
          font-weight: 800;
          color: #101214;
        }
        .price {
          font-size: 12px;
          line-height: 14px;
          font-weight: 800;
          color: #101214;
        }
        .meta {
          margin-top: 12px;
          font-size: 10px;
          line-height: 17px;
          color: #101214;
        }
        .metaLine strong {
          font-weight: 800;
        }
        .previewWrap {
          width: 160px;
          height: 138px;
          border: 1px solid #d7dddd;
          background: #f2f4f4;
          overflow: hidden;
        }
        .previewImage {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .previewFallback {
          width: 100%;
          height: 100%;
          background: #ffffff;
          padding: 10px;
        }
        .previewBar {
          height: 12px;
          border-radius: 999px;
          background: linear-gradient(90deg, #18b663 0%, #003b43 100%);
        }
        .previewBody {
          margin-top: 8px;
          display: grid;
          grid-template-columns: 1fr 28px;
          gap: 8px;
          height: 92px;
        }
        .previewMain,
        .previewSide {
          background: #eef1f1;
          border: 1px solid #d9dedd;
        }
        .rule {
          margin-top: 10px;
          border-top: 1px solid #666c6e;
        }
        .sectionTitle {
          margin-top: 12px;
          font-size: 10px;
          line-height: 12px;
          font-weight: 800;
          color: #101214;
        }
        .sectionText {
          margin-top: 4px;
          font-size: 10px;
          line-height: 12px;
          color: #101214;
          white-space: pre-wrap;
        }
        .ingredientsTitle {
          margin-top: 26px;
          font-size: 10px;
          line-height: 12px;
          font-weight: 800;
          color: #101214;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 8px;
          font-size: 10px;
          line-height: 12px;
          color: #101214;
        }
        th, td {
          border: 1px solid #8b8f91;
          text-align: left;
          padding: 4px 8px;
          height: 22px;
          vertical-align: middle;
        }
        th {
          background: #ecefef;
          font-weight: 800;
        }
        .pageNumber {
          position: absolute;
          right: 14px;
          bottom: 14px;
          font-size: 10px;
          line-height: 12px;
          color: #101214;
        }
      </style>
      <div class="topRow">
        <img class="logo" src="${logoSrc}" alt="cmvFácil" />
        <div class="updated">${escapeHtml(params.updatedAt)}</div>
      </div>
      <div class="hero">
        <div class="heroLeft">
          <div class="titleBar">
            <div class="title">${escapeHtml(params.recipeName)}</div>
            <div class="price">${escapeHtml(params.precoVenda)}</div>
          </div>
          <div class="meta">
            <div class="metaLine"><strong>Validade:</strong> ${escapeHtml(params.validade)}</div>
            <div class="metaLine"><strong>Categoria:</strong> ${escapeHtml(params.categoria)}</div>
            <div class="metaLine"><strong>Custo Total:</strong> ${escapeHtml(params.custoTotal)}</div>
            <div class="metaLine"><strong>Custo Unitário:</strong> ${escapeHtml(params.custoUnitario)}</div>
            <div class="metaLine"><strong>Preço de Venda Sugerido (CMV = ${escapeHtml(params.cmvMeta)}):</strong> ${escapeHtml(params.precoSugerido)}</div>
          </div>
        </div>
        <div class="previewWrap">${previewMarkup}</div>
      </div>
      <div class="rule"></div>
      <div class="sectionTitle">Modo de Preparo:</div>
      <div class="sectionText">${escapeHtml(params.modoPreparo || "-")}</div>
      <div class="ingredientsTitle">Ingredientes (Rende: ${escapeHtml(params.rendimento)}):</div>
      <table>
        <thead>
          <tr>
            <th style="width:45%">Item</th>
            <th style="width:27%">Qtd</th>
            <th style="width:28%">Custo</th>
          </tr>
        </thead>
        <tbody>
          ${ingredientRows}
        </tbody>
      </table>
      <div class="pageNumber">1 de 1</div>
    </div>
  `;
}

function badgeClass(type: BcgType) {
  switch (type) {
    case "estrela":
      return styles.badgeEstrela;
    case "cavalo":
      return styles.badgeCavalo;
    case "quebra-cabeca":
      return styles.badgeQuebra;
    default:
      return styles.badgeAbacaxi;
  }
}

export default function FichasTecnicasClient({
  initialSourceMeta,
}: {
  initialSourceMeta?: { source: "legacy" | "compat"; readOnly: boolean };
}) {
  const searchParams = useSearchParams();
  const openedFromQueryRef = useRef(false);
  const bcgNormalizedRef = useRef(false);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const saveTimeoutRef = useRef<number | null>(null);
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const saveErrorShownRef = useRef(false);
  const loadErrorShownRef = useRef(false);
  const missingTablesShownRef = useRef(false);
  const [isSupabaseFichasEnabled, setIsSupabaseFichasEnabled] = useState(true);
  const [isLoadingTable, setIsLoadingTable] = useState(true);
  const [sourceMeta, setSourceMeta] = useState<{ source: "legacy" | "compat"; readOnly: boolean }>(() => {
    return initialSourceMeta ?? { source: "legacy", readOnly: false };
  });
  const [compatRecipes, setCompatRecipes] = useState<FichaTecnicaCompatRecipe[]>([]);
  const [selectedCompatRecipeId, setSelectedCompatRecipeId] = useState<string | null>(null);
  const isCompatSource = sourceMeta.source === "compat";
  const isReadOnly = Boolean(sourceMeta.readOnly);
  const showCompatSplitView = isCompatSource && String(searchParams.get("view") ?? "").trim().toLowerCase() === "split";
  const [toast, setToast] = useState<{ title: string; message: string; tone: "success" | "error" } | null>(null);
  const [tableRows, setTableRows] = useState<RecipeRow[]>(() => readFichasTecnicasFromStore([]) as unknown as RecipeRow[]);
  const [query, setQuery] = useState("");
  const [quadrante, setQuadrante] = useState("Quadrante");
  const [columnOrder, setColumnOrder] = useState<FichaTableColumn[]>([
    "receita",
    "precoVenda",
    "custoUnitario",
    "cmvMeta",
    "cmvAtual",
    "bcg",
  ]);
  const [draggingColumn, setDraggingColumn] = useState<FichaTableColumn | null>(null);
  const [sortKey, setSortKey] = useState<FichaTableColumn | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [insumos, setInsumos] = useState<InsumoStoreItem[]>([]);
  const [entradas, setEntradas] = useState<EntradaStoreRow[]>([]);
  const [fornecedorEquivalenciasMap, setFornecedorEquivalenciasMap] = useState<FornecedorEquivalenciasMap>({});
  const [prePreparoRows, setPrePreparoRows] = useState<PrePreparoStoreRow[]>([]);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createStep, setCreateStep] = useState<1 | 2 | 3>(1);
  const [recipeName, setRecipeName] = useState("");
  const [recipeImage, setRecipeImage] = useState<string>("");
  const [precoVenda, setPrecoVenda] = useState("0,00");
  const [cmvMetaDraft, setCmvMetaDraft] = useState("0,00");
  const [popularidade, setPopularidade] = useState("");
  const [selectedIngredientId, setSelectedIngredientId] = useState("");
  const [ingredientQty, setIngredientQty] = useState("0,000");
  const [recipeYield, setRecipeYield] = useState("1,000");
  const [ingredientRows, setIngredientRows] = useState<ModalIngredientRow[]>([]);
  const [editingIngredientRowId, setEditingIngredientRowId] = useState<string | null>(null);
  const [detailsRecipe, setDetailsRecipe] = useState<SavedRecipeDetails | null>(null);
  const [detailsViewTab, setDetailsViewTab] = useState<"ingredientes" | "preparo">("ingredientes");
  const [detailIngredientId, setDetailIngredientId] = useState("");
  const [detailIngredientQty, setDetailIngredientQty] = useState("0,000");
  const [detailsYieldDraft, setDetailsYieldDraft] = useState("1,000");
  const [rowEditId, setRowEditId] = useState<string | null>(null);
  const [rowEditIngredientId, setRowEditIngredientId] = useState("");
  const [rowEditQty, setRowEditQty] = useState("0,000");
  const [isEditingPrep, setIsEditingPrep] = useState(false);
  const [prepDraft, setPrepDraft] = useState("");
  const [actionMenuRowId, setActionMenuRowId] = useState<string | null>(null);
  const [actionMenuRect, setActionMenuRect] = useState<{ left: number; top: number } | null>(null);
  const [editDraft, setEditDraft] = useState<EditRecipeDraft | null>(null);
  const [deleteRow, setDeleteRow] = useState<RecipeRow | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number; stage: string } | null>(null);

  function showToast(message: string, type: "success" | "error", durationMs = 4500) {
    setToast({ title: type === "success" ? "Sucesso" : "Erro", message, tone: type });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, durationMs);
  }

  async function importFichasFiles(files: File[]) {
    if (isImporting || isReadOnly) return;
    if (!files.length) return;
    if (isLoadingTable) {
      showToast("Aguarde o carregamento das fichas técnicas antes de importar.", "error", 7000);
      return;
    }
    setIsImporting(true);
    setImportProgress({ current: 0, total: 1, stage: "Lendo a planilha..." });
    try {
      const XLSX = await import("xlsx");
      const normalizedRows: Array<{ get: (...keys: string[]) => string }> = [];
      for (const file of files) {
        const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", raw: true });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        if (!sheet) continue;
        const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
        normalizedRows.push(
          ...rawRows.map((raw) => {
            const values = Object.entries(raw).map(([key, value]) => [normalizeText(key), value] as const);
            const get = (...keys: string[]) => {
              for (const key of keys) {
                const found = values.find(([candidate]) => candidate === normalizeText(key));
                if (found) return String(found[1] ?? "").trim();
              }
              return "";
            };
            return { get };
          }),
        );
      }
      if (!normalizedRows.length) throw new Error("As planilhas não possuem dados válidos.");
      const recipes = normalizedRows.filter(({ get }) => {
        const flag = normalizeText(get("boolean_item_receita", "item_receita"));
        return flag === "true" || flag === "sim" || flag === "1";
      });
      if (!recipes.length) throw new Error("Nenhuma ficha técnica foi encontrada na planilha.");

      const ingredientRecordsById = new Map(
        normalizedRows
          .filter(({ get }) => get("unique id", "unique_id") && get("item_id", "ingrediente_nome", "item_nome"))
          .map(({ get }) => [get("unique id", "unique_id"), { get }] as const),
      );
      const ingredientOptionByName = new Map(ingredientOptions.map((option) => [normalizeText(option.item), option]));

      // Merge against the freshest persisted snapshot so a stale render can
      // never replace recipes that were still loading in the background.
      let baseRows = tableRows;
      if (isSupabaseFichasEnabled) {
        const currentState = await loadFichasTecnicasStateFromSupabase();
        if (currentState.meta?.source === "compat" || currentState.meta?.readOnly) {
          throw new Error("Esta origem de fichas técnicas está em modo somente leitura.");
        }
        const persistedRows = currentState.rows as unknown as RecipeRow[];
        if (persistedRows.length) baseRows = persistedRows;
      }

      const existingByName = new Map(baseRows.map((row) => [normalizeText(row.receita), row]));
      const imported: RecipeRow[] = [];
      const chunkSize = 25;
      for (let offset = 0; offset < recipes.length; offset += chunkSize) {
        const chunk = recipes.slice(offset, offset + chunkSize);
        for (const { get } of chunk) {
          const receita = get("nome", "receita");
          if (!receita) continue;
          const previous = existingByName.get(normalizeText(receita));
          const precoVendaNumber = parseImportedDecimal(get("preco_venda_total", "preco_venda", "preco venda"));
          const rendimentoNumber = Math.max(parseImportedDecimal(get("rendimento")) || 1, 0.000001);
          const custoTotalNumber = parseImportedDecimal(get("custo_total_receita", "custo_total"));
          const custoUnitarioNumber = custoTotalNumber / rendimentoNumber;
          const cmvMetaNumber = parseImportedDecimal(get("cmv_desejado", "cmv_meta"));
          const cmvAtualNumber = precoVendaNumber > 0 ? (custoUnitarioNumber / precoVendaNumber) * 100 : 0;
          const pop = normalizePopularidade(get("popularidade") || previous?.popularidade || "baixa");
          const bubbleId = get("unique id", "unique_id", "bubble_id");
          const linkedIngredientIds = get("lista_ingredientes", "ingredientes")
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean);
          const importedIngredientRows = linkedIngredientIds.flatMap((ingredientRecordId) => {
            const record = ingredientRecordsById.get(ingredientRecordId);
            if (!record) return [];
            const item = record.get("item_id", "ingrediente_nome", "item_nome");
            if (!item) return [];
            const option = ingredientOptionByName.get(normalizeText(item));
            const quantidadeNumber = parseImportedDecimal(record.get("quantidade"));
            const custo = Math.max(0, parseImportedDecimal(record.get("custo", "custo_total")));
            return [
              {
                id: `bubble:${ingredientRecordId}`,
                ingredientId: option?.id || `bubble-item:${normalizeText(item)}`,
                item,
                quantidade: quantidadeNumber.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 }),
                unidade: option?.medida || "Und",
                custoTotal: custo,
              } satisfies ModalIngredientRow,
            ];
          });
          const finalIngredientRows = importedIngredientRows.length ? importedIngredientRows : previous?.ingredientRows ?? [];
          const importedIngredientsTotal = importedIngredientRows.reduce((total, row) => total + row.custoTotal, 0);
          imported.push({
            id: previous?.id || (bubbleId ? `bubble:${bubbleId}` : crypto.randomUUID()),
            receita,
            precoVenda: formatMoney(precoVendaNumber),
            custoUnitario: formatMoney(custoUnitarioNumber),
            cmvMeta: `${cmvMetaNumber.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`,
            cmvAtual: `${formatPercent1(cmvAtualNumber)}%`,
            cmvDelta: buildCmvDeltaLabel(cmvAtualNumber, cmvMetaNumber),
            bcg: computeBcg(pop, cmvAtualNumber, cmvMetaNumber),
            thumb: previous?.thumb ?? "burger",
            recipeImage: get("imagem_receita", "imagem") || previous?.recipeImage,
            popularidade: pop,
            ingredientsTotal: importedIngredientRows.length ? importedIngredientsTotal : previous?.ingredientsTotal ?? custoTotalNumber,
            recipeYield: rendimentoNumber,
            ingredientRows: finalIngredientRows,
            modoPreparo: get("modo_preparo", "modo de preparo") || previous?.modoPreparo || "",
          });
        }
        setImportProgress({
          current: Math.min(offset + chunk.length, recipes.length),
          total: recipes.length,
          stage: "Preparando fichas técnicas...",
        });
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }

      if (!imported.length) throw new Error("Nenhuma ficha técnica com nome válido foi encontrada na planilha.");

      const importedNames = new Set(imported.map((row) => normalizeText(row.receita)));
      const merged = [...baseRows.filter((row) => !importedNames.has(normalizeText(row.receita))), ...imported];
      if (!merged.length) throw new Error("A importação foi interrompida para proteger as fichas existentes.");

      setImportProgress({ current: imported.length, total: imported.length, stage: "Salvando no banco de dados..." });
      if (isSupabaseFichasEnabled) await saveFichasTecnicasToSupabase(merged as any);
      writeFichasTecnicasToStore(merged as any);
      setTableRows(merged);
      setPage(1);
      showToast(`${imported.length} ficha(s) técnica(s) importada(s) com sucesso.`, "success", 7000);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Não foi possível importar a planilha.", "error", 8000);
    } finally {
      setIsImporting(false);
      setImportProgress(null);
      if (importFileRef.current) importFileRef.current.value = "";
    }
  }

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

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

  useEffect(() => {
    if (!actionMenuRowId) return;
    function onDown(e: MouseEvent) {
      const el = actionMenuRef.current;
      if (e.target instanceof Node && el?.contains(e.target)) return;
      setActionMenuRowId(null);
      setActionMenuRect(null);
    }
    function close() {
      setActionMenuRowId(null);
      setActionMenuRect(null);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [actionMenuRowId]);

  useEffect(() => {
    if (isCompatSource) return;
    setInsumos(readInsumosFromStore());
    void (async () => {
      try {
        const dbRows = await loadInsumosFromSupabase();
        if (dbRows.length) writeInsumosToStore(dbRows);
      } catch {}
    })();
    return subscribeInsumos(setInsumos);
  }, [isCompatSource]);

  useEffect(() => {
    if (isCompatSource) return;
    setEntradas(readEntradasFromStore([]));
    void (async () => {
      try {
        const db = await loadEntradasFromSupabase();
        if (db.length) writeEntradasToStore(db);
      } catch {}
      setEntradas(readEntradasFromStore([]));
    })();
    return subscribeEntradas(setEntradas);
  }, [isCompatSource]);

  useEffect(() => {
    if (isCompatSource) return;
    setPrePreparoRows(readPrePreparoFromStore([]));
    void (async () => {
      try {
        const db = await loadPrePreparoFromSupabase();
        if (db.length) writePrePreparoToStore(db);
      } catch {}
      setPrePreparoRows(readPrePreparoFromStore([]));
    })();
    return subscribePrePreparo(setPrePreparoRows);
  }, [isCompatSource]);

  useEffect(() => {
    if (isCompatSource) return;
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
    return subscribeFornecedorEquivalencias(setFornecedorEquivalenciasMap);
  }, [isCompatSource]);

  useEffect(() => {
    void (async () => {
      try {
        const st = await loadFichasTecnicasStateFromSupabase();
        if (st.meta) setSourceMeta(st.meta);
        if (st.meta?.source === "compat") {
          const recipes = (st.compat as any)?.recipes ?? [];
          const list = Array.isArray(recipes) ? (recipes as FichaTecnicaCompatRecipe[]) : [];
          setCompatRecipes(list);
          setSelectedCompatRecipeId(list[0]?.id ?? null);
          setTableRows(st.rows as unknown as RecipeRow[]);
          setIsSupabaseFichasEnabled(true);
          return;
        }
        const rows = st.rows as unknown as RecipeRow[];
        const stored = readFichasTecnicasFromStore([]) as unknown as RecipeRow[];
        const effective = rows.length ? rows : stored;
        setTableRows(effective);
        if (rows.length) writeFichasTecnicasToStore(rows as any);
        setIsSupabaseFichasEnabled(true);
      } catch (err) {
        setTableRows(readFichasTecnicasFromStore([]) as unknown as RecipeRow[]);
        if (isMissingTableError(err, "fichas_tecnicas_state")) {
          setIsSupabaseFichasEnabled(false);
          if (!missingTablesShownRef.current) {
            missingTablesShownRef.current = true;
            showToast("Tabela fichas_tecnicas_state não existe no Supabase. Abra /setup-supabase e rode o SQL (passo 3).", "error", 9000);
          }
          return;
        }
        if (!loadErrorShownRef.current) {
          loadErrorShownRef.current = true;
          showToast(err instanceof Error ? err.message : "Não foi possível carregar as fichas técnicas.", "error", 8000);
        }
      } finally {
        setIsLoadingTable(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (isCompatSource) return;
    if (openedFromQueryRef.current) return;
    const produto = (searchParams.get("produto") || searchParams.get("id") || "").trim();
    if (!produto) return;
    const row = tableRows.find((r) => String(r.id ?? "").trim() === produto) ?? null;
    if (!row) return;
    openedFromQueryRef.current = true;
    const v = (searchParams.get("v") || "").trim().toLowerCase();
    setDetailsRecipe(buildDetailsRecipeFromRow(row));
    setDetailsViewTab(v === "preparo" ? "preparo" : "ingredientes");
    setDetailIngredientId("");
    setDetailIngredientQty("0,000");
    cancelRowEdit();
    setIsEditingPrep(false);
    setPrepDraft("");
    setActionMenuRowId(null);
  }, [isCompatSource, searchParams, tableRows]);

  function setAndPersistTableRows(updater: (prev: RecipeRow[]) => RecipeRow[]) {
    setTableRows((prev) => {
      if (isReadOnly) return prev;
      const next = updater(prev);
      if (isCompatSource) return next;
      writeFichasTecnicasToStore(next);
      if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = window.setTimeout(() => {
        if (!isSupabaseFichasEnabled) return;
        void saveFichasTecnicasToSupabase(next as any).catch((err) => {
          if (!saveErrorShownRef.current) {
            saveErrorShownRef.current = true;
            showToast(err instanceof Error ? err.message : "Não foi possível salvar as fichas técnicas.", "error", 8000);
          }
        });
      }, 600);
      return next;
    });
  }

  useEffect(() => {
    if (isCompatSource) return;
    if (bcgNormalizedRef.current) return;
    if (!tableRows.length) return;
    bcgNormalizedRef.current = true;
    setAndPersistTableRows((prev) =>
      prev.map((row) => {
        const pop = row.popularidade ? normalizePopularidade(row.popularidade) : row.bcg === "estrela" || row.bcg === "cavalo" ? "alta" : "baixa";
        const cmvMetaValue = parseDecimalInput(String(row.cmvMeta).replace(/[^\d,.-]/g, ""));
        const cmvAtualValue = parseDecimalInput(String(row.cmvAtual).replace(/[^\d,.-]/g, ""));
        const bcg = computeBcg(pop, cmvAtualValue, cmvMetaValue);
        if (row.bcg === bcg && row.popularidade === pop) return row;
        return { ...row, bcg, popularidade: pop };
      }),
    );
  }, [isCompatSource, tableRows]);

  function formatPercent1(value: number) {
    return value.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  function buildCmvDeltaLabel(cmvAtual: number, cmvMeta: number) {
    const diff = cmvAtual - cmvMeta;
    const abs = Math.abs(diff);
    const suffix = diff > 0 ? "Maior" : diff < 0 ? "Menor" : "Igual";
    return `${formatPercent1(abs)}% ${suffix}`;
  }

  function persistDetails(next: SavedRecipeDetails) {
    setDetailsRecipe(next);
    const metrics = calcRecipeMetrics(next.ingredientsTotal, next.recipeYield, next.precoVenda, next.cmvMeta);
    const bcg = computeBcg(normalizePopularidade(next.popularidade), metrics.cmvAtual, next.cmvMeta);
    const cmvAtualLabel = `${formatPercent1(metrics.cmvAtual)}%`;
    const cmvMetaLabel = `${next.cmvMeta.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
    const custoUnitarioLabel = formatMoney(metrics.custoPorPorcao);
    const precoSugeridoLabel = metrics.precoSugerido > 0 ? formatMoney(metrics.precoSugerido) : undefined;
    setAndPersistTableRows((prev) =>
      prev.map((row) =>
        row.id === next.rowId
          ? {
              ...row,
              receita: next.recipeName,
              precoVenda: formatMoney(next.precoVenda),
              precoVendaSub: precoSugeridoLabel,
              custoUnitario: custoUnitarioLabel,
              cmvMeta: cmvMetaLabel,
              cmvAtual: cmvAtualLabel,
              cmvDelta: buildCmvDeltaLabel(metrics.cmvAtual, next.cmvMeta),
              bcg,
              recipeImage: next.recipeImage,
              popularidade: normalizePopularidade(next.popularidade),
              ingredientsTotal: next.ingredientsTotal,
              recipeYield: next.recipeYield,
              ingredientRows: next.ingredientRows,
              modoPreparo: next.modoPreparo,
            }
          : row,
      ),
    );
  }

  useEffect(() => {
    if (!detailsRecipe) {
      setDetailsYieldDraft("1,000");
      return;
    }
    setDetailsYieldDraft(formatDecimal3(detailsRecipe.recipeYield));
  }, [detailsRecipe]);

  function commitDetailsYield(nextValue: string) {
    if (!detailsRecipe) return;
    const yieldValue = parseDecimalInput(nextValue);
    const safeYield = yieldValue > 0 ? yieldValue : 1;
    const nextMetrics = calcRecipeMetrics(detailsRecipe.ingredientsTotal, safeYield, detailsRecipe.precoVenda, detailsRecipe.cmvMeta);
    persistDetails({
      ...detailsRecipe,
      recipeYield: safeYield,
      cmvAtual: nextMetrics.cmvAtual,
    });
    setDetailsYieldDraft(formatDecimal3(safeYield));
  }

  useEffect(() => {
    if (openedFromQueryRef.current) return;
    const open = (searchParams.get("open") ?? "").trim();
    if (!open) return;
    const key = normalizeText(open);
    const row =
      tableRows.find((r) => normalizeText(r.receita) === key) ??
      tableRows.find((r) => normalizeText(r.receita).includes(key) || key.includes(normalizeText(r.receita))) ??
      null;
    if (!row) return;
    setDetailsRecipe(buildDetailsRecipeFromRow(row));
    setDetailsViewTab("ingredientes");
    setActionMenuRowId(null);
    openedFromQueryRef.current = true;
  }, [searchParams, tableRows]);

  useEffect(() => {
    function handleWindowPointerDown(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-ft-action-menu]")) return;
      setActionMenuRowId(null);
    }

    window.addEventListener("mousedown", handleWindowPointerDown);
    return () => window.removeEventListener("mousedown", handleWindowPointerDown);
  }, []);

  const filteredRows = useMemo(() => {
    const q = normalizeText(query);
    const filtered = tableRows.filter((row) => {
      if (quadrante !== "Quadrante" && row.bcg !== quadrante) return false;
      if (q && !normalizeText(row.receita).includes(q)) return false;
      return true;
    });
    if (!sortKey) return filtered;

    const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });
    const direction = sortDir === "asc" ? 1 : -1;
    const decorated = filtered.map((row, index) => ({ row, index }));
    decorated.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "receita":
          cmp = collator.compare(a.row.receita, b.row.receita);
          break;
        case "precoVenda":
          cmp = parseMoneyLabel(a.row.precoVenda) - parseMoneyLabel(b.row.precoVenda);
          break;
        case "custoUnitario":
          cmp = parseMoneyLabel(a.row.custoUnitario) - parseMoneyLabel(b.row.custoUnitario);
          break;
        case "cmvMeta":
          cmp =
            parseDecimalInput(String(a.row.cmvMeta).replace(/[^\d,.-]/g, "")) -
            parseDecimalInput(String(b.row.cmvMeta).replace(/[^\d,.-]/g, ""));
          break;
        case "cmvAtual":
          cmp =
            parseDecimalInput(String(a.row.cmvAtual).replace(/[^\d,.-]/g, "")) -
            parseDecimalInput(String(b.row.cmvAtual).replace(/[^\d,.-]/g, ""));
          break;
        case "bcg": {
          const aLabel = bcgInfo.find((item) => item.key === a.row.bcg)?.title ?? a.row.bcg;
          const bLabel = bcgInfo.find((item) => item.key === b.row.bcg)?.title ?? b.row.bcg;
          cmp = collator.compare(aLabel, bLabel);
          break;
        }
      }
      if (!cmp) cmp = a.index - b.index;
      return cmp * direction;
    });
    return decorated.map(({ row }) => row);
  }, [query, quadrante, sortDir, sortKey, tableRows]);

  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const selectedCompatRecipe = useMemo(
    () =>
      selectedCompatRecipeId
        ? compatRecipes.find((r) => r.id === selectedCompatRecipeId) ?? null
        : compatRecipes[0]
          ? compatRecipes[0]
          : null,
    [compatRecipes, selectedCompatRecipeId],
  );

  const qaUi = useMemo(() => {
    if (isCompatSource) {
      return {
        meta: sourceMeta,
        rendered: {
          recipesCount: compatRecipes.length,
          recipes: compatRecipes.map((r) => ({
            id: r.id,
            bubble_id: r.bubble_id,
            receita: r.receita,
            categoria: r.categoria,
            unidade: r.unidade,
            rendimento: r.rendimento,
            validade: r.validade,
            precoVenda: r.precoVenda,
            custoTotal: r.custoTotal,
            custoUnitario: r.custoUnitario,
            cmvMeta: r.cmvMeta,
            cmvAtual: r.cmvAtual,
            quadrante: r.quadrante,
            ingredientesCount: Array.isArray(r.ingredientes) ? r.ingredientes.length : 0,
          })),
        },
        details: compatRecipes.map((r) => ({
          id: r.id,
          receita: r.receita,
          ingredientes: (r.ingredientes ?? []).map((it) => ({
            id: it.id,
            ingredientId: it.ingredientId,
            item: it.item,
            quantidade: it.quantidade,
            unidade: it.unidade,
            custo: it.custo,
          })),
        })),
      };
    }
    return {
      meta: sourceMeta,
      filters: { query, quadrante },
      sort: { sortKey, sortDir, columnOrder },
      pagination: { page, currentPage, pageSize, totalPages, filteredCount: filteredRows.length, pageRowsCount: pageRows.length },
      rendered: {
        rows: pageRows.map((r) => ({
          id: r.id,
          receita: r.receita,
          precoVenda: r.precoVenda,
          custoUnitario: r.custoUnitario,
          cmvMeta: r.cmvMeta,
          cmvAtual: r.cmvAtual,
          cmvDelta: r.cmvDelta,
          bcg: r.bcg,
          popularidade: r.popularidade ?? null,
        })),
      },
    };
  }, [columnOrder, compatRecipes, currentPage, filteredRows.length, isCompatSource, page, pageRows, quadrante, query, sortDir, sortKey, sourceMeta, totalPages]);

  function toggleSort(key: FichaTableColumn) {
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

  function onColumnDrop(target: FichaTableColumn) {
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
    const widths: Record<FichaTableColumn | "acoes", string> = {
      receita: "minmax(240px, 2.3fr)",
      precoVenda: "minmax(110px, 0.9fr)",
      custoUnitario: "minmax(110px, 0.9fr)",
      cmvMeta: "minmax(84px, 0.7fr)",
      cmvAtual: "minmax(96px, 0.8fr)",
      bcg: "minmax(130px, 1fr)",
      acoes: "72px",
    };
    const orderedColumns: Array<FichaTableColumn | "acoes"> = [...columnOrder, "acoes"];
    return orderedColumns.map((column) => widths[column]).join(" ");
  }, [columnOrder]);

  const counts = useMemo(() => {
    return {
      estrela: tableRows.filter((row) => row.bcg === "estrela").length,
      cavalo: tableRows.filter((row) => row.bcg === "cavalo").length,
      "quebra-cabeca": tableRows.filter((row) => row.bcg === "quebra-cabeca").length,
      abacaxi: tableRows.filter((row) => row.bcg === "abacaxi").length,
    };
  }, [tableRows]);

  const prePreparoIngredientData = useMemo(() => {
    const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });
    const options: IngredientOption[] = [];
    const unitCostCentsById = new Map<string, number>();
    for (const row of prePreparoRows) {
      const id = `prep:${row.id}`;
      const parsed = parsePrePreparoUnitCost(row);
      const unit = String(parsed?.unit ?? parseQtyLabel(String(row.rendimento ?? "")).unit ?? "Und").trim() || "Und";
      const unitCents = Math.max(0, parsed?.cents ?? 0);
      if (unitCents > 0) unitCostCentsById.set(id, unitCents);
      options.push({
        id,
        item: row.receita,
        medida: unit,
        custoMedio: unitCents ? formatMoney(unitCents / 100) : "0,00",
        kind: "prepreparo",
      });
    }
    options.sort((a, b) => collator.compare(a.item, b.item));
    return { options, unitCostCentsById };
  }, [prePreparoRows]);

  const insumoIngredientOptions = useMemo(() => {
    return insumos
      .filter((row) => !row.ocultar)
      .map((row) => ({
        id: row.id,
        item: row.item,
        medida: row.medida || "Und",
        custoMedio: row.custoMedio || "0,00",
        kind: "insumo" as const,
      }));
  }, [insumos]);

  const fichaIngredientOptions = useMemo(() => {
    const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });
    const list: IngredientOption[] = [];
    for (const row of tableRows) {
      if (detailsRecipe && String(detailsRecipe.rowId) === String(row.id)) continue;
      list.push({
        id: `ficha:${row.id}`,
        item: row.receita,
        medida: "Porção",
        custoMedio: row.custoUnitario || "0,00",
        kind: "ficha",
      });
    }
    list.sort((a, b) => collator.compare(a.item, b.item));
    return list;
  }, [detailsRecipe, tableRows]);

  const ingredientOptions = useMemo(
    () => [...insumoIngredientOptions, ...prePreparoIngredientData.options, ...fichaIngredientOptions],
    [fichaIngredientOptions, insumoIngredientOptions, prePreparoIngredientData.options],
  );

  const ingredientOptionGroups = useMemo(() => {
    return {
      insumos: insumoIngredientOptions,
      prePreparo: prePreparoIngredientData.options,
      fichas: fichaIngredientOptions,
    };
  }, [fichaIngredientOptions, insumoIngredientOptions, prePreparoIngredientData.options]);
  const avgUnitCostCentsById = useMemo(() => {
    const idByKey = new Map<string, string>();
    for (const i of insumos) {
      const k = normalizeKey(i.item);
      if (!k || idByKey.has(k)) continue;
      idByKey.set(k, i.id);
    }
    const keyLookup = new Map<string, string>();
    for (const key of Object.keys(fornecedorEquivalenciasMap)) {
      const nk = normalizeKey(key);
      if (!nk || keyLookup.has(nk)) continue;
      keyLookup.set(nk, key);
    }
    const qtyById = new Map<string, number>();
    const centsById = new Map<string, number>();
    for (const e of entradas) {
      const fornecedorKey = keyLookup.get(normalizeKey(String(e.fornecedor ?? ""))) ?? String(e.fornecedor ?? "").trim().toUpperCase();
      const equivalencias = fornecedorEquivalenciasMap[fornecedorKey] ?? [];
      for (const it of e.itensNota ?? []) {
        const rawKey = normalizeKey(it.nome);
        let mappedKey = rawKey;
        let fator = 1;
        const eq = equivalencias.find((m) => normalizeKey(m.nomeNaNota) === rawKey) ?? null;
        if (eq) {
          mappedKey = normalizeKey(eq.insumoEquivalente);
          const f = parseDecimalInput(String(eq.equivalenteQuantidade ?? ""));
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
    for (const [id, q] of qtyById.entries()) {
      const c = centsById.get(id) ?? 0;
      if (!q || !c) continue;
      out.set(id, c / q);
    }
    return out;
  }, [entradas, fornecedorEquivalenciasMap, insumos]);
  const selectedIngredient = useMemo(
    () => ingredientOptions.find((row) => row.id === selectedIngredientId) ?? null,
    [ingredientOptions, selectedIngredientId]
  );
  const selectedDetailIngredient = useMemo(
    () => ingredientOptions.find((row) => row.id === detailIngredientId) ?? null,
    [ingredientOptions, detailIngredientId]
  );
  const selectedRowEditIngredient = useMemo(
    () => ingredientOptions.find((row) => row.id === rowEditIngredientId) ?? null,
    [ingredientOptions, rowEditIngredientId]
  );
  const ingredientCost = useMemo(() => {
    if (!selectedIngredient) return 0;
    const unitCents =
      selectedIngredient.kind === "prepreparo"
        ? prePreparoIngredientData.unitCostCentsById.get(selectedIngredient.id) ?? Math.round(parseMoneyLabel(selectedIngredient.custoMedio) * 100)
        : selectedIngredient.kind === "ficha"
          ? Math.round(parseMoneyLabel(selectedIngredient.custoMedio) * 100)
        : avgUnitCostCentsById.get(selectedIngredient.id) ?? Math.round(parseMoneyLabel(selectedIngredient.custoMedio) * 100);
    return (parseDecimalInput(ingredientQty) * unitCents) / 100;
  }, [avgUnitCostCentsById, ingredientQty, prePreparoIngredientData.unitCostCentsById, selectedIngredient]);
  const detailIngredientCost = useMemo(() => {
    if (!selectedDetailIngredient) return 0;
    const unitCents =
      selectedDetailIngredient.kind === "prepreparo"
        ? prePreparoIngredientData.unitCostCentsById.get(selectedDetailIngredient.id) ?? Math.round(parseMoneyLabel(selectedDetailIngredient.custoMedio) * 100)
        : selectedDetailIngredient.kind === "ficha"
          ? Math.round(parseMoneyLabel(selectedDetailIngredient.custoMedio) * 100)
        : avgUnitCostCentsById.get(selectedDetailIngredient.id) ?? Math.round(parseMoneyLabel(selectedDetailIngredient.custoMedio) * 100);
    return (parseDecimalInput(detailIngredientQty) * unitCents) / 100;
  }, [avgUnitCostCentsById, detailIngredientQty, prePreparoIngredientData.unitCostCentsById, selectedDetailIngredient]);
  const rowEditCost = useMemo(() => {
    if (!selectedRowEditIngredient) return 0;
    const unitCents =
      selectedRowEditIngredient.kind === "prepreparo"
        ? prePreparoIngredientData.unitCostCentsById.get(selectedRowEditIngredient.id) ?? Math.round(parseMoneyLabel(selectedRowEditIngredient.custoMedio) * 100)
        : selectedRowEditIngredient.kind === "ficha"
          ? Math.round(parseMoneyLabel(selectedRowEditIngredient.custoMedio) * 100)
        : avgUnitCostCentsById.get(selectedRowEditIngredient.id) ?? Math.round(parseMoneyLabel(selectedRowEditIngredient.custoMedio) * 100);
    return (parseDecimalInput(rowEditQty) * unitCents) / 100;
  }, [avgUnitCostCentsById, prePreparoIngredientData.unitCostCentsById, rowEditQty, selectedRowEditIngredient]);
  const ingredientsTotal = useMemo(() => ingredientRows.reduce((sum, row) => sum + row.custoTotal, 0), [ingredientRows]);
  const priceValue = useMemo(() => parseDecimalInput(precoVenda), [precoVenda]);
  const cmvMetaValue = useMemo(() => parseDecimalInput(cmvMetaDraft), [cmvMetaDraft]);
  const recipeYieldValue = useMemo(() => parseDecimalInput(recipeYield), [recipeYield]);
  const createMetrics = useMemo(() => calcRecipeMetrics(ingredientsTotal, recipeYieldValue, priceValue, cmvMetaValue), [cmvMetaValue, ingredientsTotal, priceValue, recipeYieldValue]);
  const cmvAtualValue = createMetrics.cmvAtual;
  const cmvAbaixoMeta = cmvAtualValue <= cmvMetaValue;
  const canGoStep1 = Boolean(recipeName.trim() && Number.isFinite(priceValue) && priceValue > 0 && Number.isFinite(cmvMetaValue) && cmvMetaValue > 0 && popularidade);
  const canGoStep2 = ingredientRows.length > 0 && parseDecimalInput(recipeYield) > 0;

  function renderTableCell(row: RecipeRow, column: FichaTableColumn) {
    if (column === "receita") {
      return (
        <div className={styles.recipeCell}>
          <RecipeThumb type={row.thumb} src={row.recipeImage} />
          <div className={styles.recipeName}>{row.receita}</div>
        </div>
      );
    }
    if (column === "precoVenda") {
      return (
        <div className={styles.numericCell}>
          <div className={styles.mainValue}>{row.precoVenda}</div>
          <div className={styles.subValue}>{row.precoVendaSub || "-"}</div>
        </div>
      );
    }
    if (column === "custoUnitario") {
      return (
        <div className={styles.numericCell}>
          <div className={styles.mainValue}>{row.custoUnitario}</div>
          <div className={styles.subValue}>-</div>
        </div>
      );
    }
    if (column === "cmvMeta") {
      return <div className={styles.metaCell}>{row.cmvMeta}</div>;
    }
    if (column === "cmvAtual") {
      return (
        <div className={styles.cmvAtualCell}>
          <div className={row.cmvDelta.includes("Maior") ? styles.cmvPink : styles.cmvGreen}>{row.cmvAtual}</div>
          <div className={styles.subValue}>{row.cmvDelta}</div>
        </div>
      );
    }
    return (
      <div>
        <span className={`${styles.bcgBadge} ${badgeClass(row.bcg)}`}>
          <BcgIcon type={bcgInfo.find((item) => item.key === row.bcg)?.icon ?? "star"} />
          {bcgInfo.find((item) => item.key === row.bcg)?.title}
        </span>
      </div>
    );
  }

  function resetCreateModal() {
    setCreateStep(1);
    setRecipeName("");
    setRecipeImage("");
    setPrecoVenda("0,00");
    setCmvMetaDraft("0,00");
    setPopularidade("");
    setSelectedIngredientId("");
    setIngredientQty("0,000");
    setRecipeYield("1,000");
    setIngredientRows([]);
    setEditingIngredientRowId(null);
  }

  function openCreateModal() {
    if (isReadOnly) return;
    resetCreateModal();
    setIsCreateOpen(true);
  }

  function closeCreateModal() {
    setIsCreateOpen(false);
    resetCreateModal();
  }

  function addIngredientRow() {
    if (!selectedIngredient) return;
    const qty = parseDecimalInput(ingredientQty);
    if (qty <= 0) return;
    const formattedQty = formatDecimalFixedDraft(ingredientQty, 3);
    setIngredientRows((prev) => {
      const nextRow: ModalIngredientRow = {
        id: editingIngredientRowId ?? `${selectedIngredient.id}-${Date.now()}`,
        ingredientId: selectedIngredient.id,
        item: selectedIngredient.item,
        quantidade: formattedQty,
        unidade: selectedIngredient.medida || "Und",
        custoTotal: ingredientCost,
      };
      if (!editingIngredientRowId) return [...prev, nextRow];
      return prev.map((row) => (row.id === editingIngredientRowId ? nextRow : row));
    });
    setSelectedIngredientId("");
    setIngredientQty("0,000");
    setEditingIngredientRowId(null);
  }

  function removeIngredientRow(id: string) {
    setIngredientRows((prev) => prev.filter((row) => row.id !== id));
    if (editingIngredientRowId === id) {
      setSelectedIngredientId("");
      setIngredientQty("0,000");
      setEditingIngredientRowId(null);
    }
  }

  function editIngredientRow(row: ModalIngredientRow) {
    setSelectedIngredientId(row.ingredientId);
    setIngredientQty(row.quantidade);
    setEditingIngredientRowId(row.id);
  }

  function openSavedRecipeDetails() {
    const metrics = calcRecipeMetrics(ingredientsTotal, recipeYieldValue, priceValue, cmvMetaValue);
    const id = String(Date.now());
    const pop = normalizePopularidade(popularidade);
    const bcg: BcgType = computeBcg(pop, metrics.cmvAtual, cmvMetaValue);
    const cmvAtualLabel = `${formatPercent1(metrics.cmvAtual)}%`;
    const cmvMetaLabel = `${cmvMetaValue.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
    const custoUnitarioLabel = formatMoney(metrics.custoPorPorcao);
    const precoSugeridoLabel = metrics.precoSugerido > 0 ? formatMoney(metrics.precoSugerido) : undefined;
    setAndPersistTableRows((prev) => [
      {
        id,
        origin: "manual",
        receita: recipeName.trim() || "Sem nome",
        precoVenda: formatMoney(priceValue),
        precoVendaSub: precoSugeridoLabel,
        custoUnitario: custoUnitarioLabel,
        cmvMeta: cmvMetaLabel,
        cmvAtual: cmvAtualLabel,
        cmvDelta: buildCmvDeltaLabel(metrics.cmvAtual, cmvMetaValue),
        bcg,
        thumb: "burger",
        recipeImage,
        popularidade: pop,
        ingredientsTotal,
        recipeYield: recipeYieldValue,
        ingredientRows,
        modoPreparo: "",
      },
      ...prev,
    ]);
    setDetailsRecipe({
      rowId: id,
      recipeName: recipeName.trim() || "Sem nome",
      recipeImage,
      popularidade: pop,
      precoVenda: priceValue,
      cmvMeta: cmvMetaValue,
      cmvAtual: metrics.cmvAtual,
      ingredientsTotal,
      recipeYield: recipeYieldValue,
      ingredientRows,
      modoPreparo: "",
    });
    setDetailsViewTab("ingredientes");
    setDetailIngredientId("");
    setDetailIngredientQty("0,000");
    setRowEditId(null);
    setRowEditIngredientId("");
    setRowEditQty("0,000");
    setIsEditingPrep(false);
    setPrepDraft("");
    closeCreateModal();
  }

  function handleRecipeImageChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setRecipeImage(reader.result);
      }
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  }

  function addDetailIngredientRow() {
    if (!detailsRecipe || !selectedDetailIngredient) return;
    const qty = parseDecimalInput(detailIngredientQty);
    if (qty <= 0) return;
    const formattedQty = formatDecimalFixedDraft(detailIngredientQty, 3);
    const nextRows = [
      ...detailsRecipe.ingredientRows,
      {
        id: `${selectedDetailIngredient.id}-${Date.now()}`,
        ingredientId: selectedDetailIngredient.id,
        item: selectedDetailIngredient.item,
        quantidade: formattedQty,
        unidade: selectedDetailIngredient.medida || "Und",
        custoTotal: detailIngredientCost,
      },
    ];

    const nextTotal = nextRows.reduce((sum, row) => sum + row.custoTotal, 0);
    const nextMetrics = calcRecipeMetrics(nextTotal, detailsRecipe.recipeYield, detailsRecipe.precoVenda, detailsRecipe.cmvMeta);
    persistDetails({
      ...detailsRecipe,
      ingredientRows: nextRows,
      ingredientsTotal: nextTotal,
      cmvAtual: nextMetrics.cmvAtual,
    });
    setDetailIngredientId("");
    setDetailIngredientQty("0,000");
  }

  function cancelRowEdit() {
    setRowEditId(null);
    setRowEditIngredientId("");
    setRowEditQty("0,000");
  }

  function startRowEdit(row: ModalIngredientRow) {
    setRowEditId(row.id);
    setRowEditIngredientId(row.ingredientId);
    setRowEditQty(row.quantidade);
  }

  function saveRowEdit() {
    if (!detailsRecipe) return;
    if (!rowEditId) return;
    if (!selectedRowEditIngredient) return;
    const qty = parseDecimalInput(rowEditQty);
    if (qty <= 0) return;
    const formattedQty = formatDecimalFixedDraft(rowEditQty, 3);

    const nextRows = detailsRecipe.ingredientRows.map((row) =>
      row.id === rowEditId
        ? {
            ...row,
            ingredientId: selectedRowEditIngredient.id,
            item: selectedRowEditIngredient.item,
            quantidade: formattedQty,
            unidade: selectedRowEditIngredient.medida || "Und",
            custoTotal: rowEditCost,
          }
        : row
    );

    const nextTotal = nextRows.reduce((sum, row) => sum + row.custoTotal, 0);
    const nextMetrics = calcRecipeMetrics(nextTotal, detailsRecipe.recipeYield, detailsRecipe.precoVenda, detailsRecipe.cmvMeta);
    persistDetails({
      ...detailsRecipe,
      ingredientRows: nextRows,
      ingredientsTotal: nextTotal,
      cmvAtual: nextMetrics.cmvAtual,
    });
    cancelRowEdit();
  }

  function removeDetailIngredientRow(id: string) {
    if (!detailsRecipe) return;
    const nextRows = detailsRecipe.ingredientRows.filter((row) => row.id !== id);
    const nextTotal = nextRows.reduce((sum, row) => sum + row.custoTotal, 0);
    const nextMetrics = calcRecipeMetrics(nextTotal, detailsRecipe.recipeYield, detailsRecipe.precoVenda, detailsRecipe.cmvMeta);
    persistDetails({
      ...detailsRecipe,
      ingredientRows: nextRows,
      ingredientsTotal: nextTotal,
      cmvAtual: nextMetrics.cmvAtual,
    });
    if (rowEditId === id) cancelRowEdit();
  }

  function startPrepEdit() {
    setPrepDraft(detailsRecipe?.modoPreparo ?? "");
    setIsEditingPrep(true);
  }

  function cancelPrepEdit() {
    setPrepDraft(detailsRecipe?.modoPreparo ?? "");
    setIsEditingPrep(false);
  }

  function savePrepEdit() {
    if (!detailsRecipe) return;
    persistDetails({
      ...detailsRecipe,
      modoPreparo: prepDraft.trim(),
    });
    setIsEditingPrep(false);
  }

  function toggleQuadranteFilter(next: BcgType) {
    setQuadrante((prev) => (prev === next ? "Quadrante" : next));
    setPage(1);
  }

  function openRowDetails(row: RecipeRow) {
    setDetailsRecipe(buildDetailsRecipeFromRow(row));
    setDetailsViewTab("ingredientes");
    setDetailIngredientId("");
    setDetailIngredientQty("0,000");
    cancelRowEdit();
    setIsEditingPrep(false);
    setPrepDraft("");
    setActionMenuRowId(null);
  }

  function openEditModal(row: RecipeRow) {
    if (isReadOnly) return;
    const pop = row.popularidade ? normalizePopularidade(row.popularidade) : row.bcg === "estrela" || row.bcg === "cavalo" ? "alta" : "baixa";
    setEditDraft({
      rowId: row.id,
      thumb: row.thumb,
      recipeName: row.receita,
      precoVenda: parseMoneyLabel(row.precoVenda).toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
      cmvMeta: parseDecimalInput(String(row.cmvMeta).replace(/[^\d,.-]/g, "")).toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
      popularidade: pop === "alta" ? "Alta" : "Baixa",
      custoUnitario: parseMoneyLabel(row.custoUnitario),
    });
    setActionMenuRowId(null);
  }

  function closeEditModal() {
    setEditDraft(null);
  }

  function openDeleteModal(row: RecipeRow) {
    if (isReadOnly) return;
    setDeleteRow(row);
    setActionMenuRowId(null);
  }

  function closeDeleteModal() {
    setDeleteRow(null);
  }

  function removeTableRow(rowId: string) {
    if (isReadOnly) return;
    setAndPersistTableRows((prev) => prev.filter((row) => row.id !== rowId));
    setActionMenuRowId(null);
  }

  function saveEditedRow() {
    if (isReadOnly) return;
    if (!editDraft) return;
    const precoVendaValue = parseDecimalInput(editDraft.precoVenda);
    const cmvMetaValue = parseDecimalInput(editDraft.cmvMeta);
    const pop = normalizePopularidade(editDraft.popularidade);
    const cmvAtualValue = precoVendaValue > 0 ? (editDraft.custoUnitario / precoVendaValue) * 100 : 0;
    const bcg = computeBcg(pop, cmvAtualValue, cmvMetaValue);
    const precoSugeridoValue = cmvMetaValue > 0 ? editDraft.custoUnitario / (cmvMetaValue / 100) : 0;

    setAndPersistTableRows((prev) =>
      prev.map((row) =>
        row.id === editDraft.rowId
          ? {
              ...row,
              receita: editDraft.recipeName.trim() || row.receita,
              precoVenda: formatMoney(precoVendaValue),
              precoVendaSub: precoSugeridoValue > 0 ? formatMoney(precoSugeridoValue) : row.precoVendaSub,
              cmvMeta: `${cmvMetaValue.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`,
              cmvAtual: `${formatPercent1(cmvAtualValue)}%`,
              cmvDelta: buildCmvDeltaLabel(cmvAtualValue, cmvMetaValue),
              bcg,
              popularidade: pop,
            }
          : row
      )
    );
    if (detailsRecipe && detailsRecipe.rowId === editDraft.rowId) {
      persistDetails({
        ...detailsRecipe,
        recipeName: editDraft.recipeName.trim() || detailsRecipe.recipeName,
        precoVenda: precoVendaValue,
        cmvMeta: cmvMetaValue,
        cmvAtual: cmvAtualValue,
        popularidade: pop,
      });
    }
    setEditDraft(null);
  }

  function buildDetailsRecipeFromRow(row: RecipeRow): SavedRecipeDetails {
    const precoVendaValue = parseMoneyLabel(row.precoVenda);
    const custoUnitarioValue = parseMoneyLabel(row.custoUnitario);
    const cmvMetaRow = parseDecimalInput(String(row.cmvMeta).replace(/[^\d,.-]/g, ""));
    const cmvAtualRow = parseDecimalInput(String(row.cmvAtual).replace(/[^\d,.-]/g, ""));
    const pop = row.popularidade ? normalizePopularidade(row.popularidade) : row.bcg === "estrela" || row.bcg === "cavalo" ? "alta" : "baixa";
    const recipeYield = Number.isFinite(row.recipeYield) && (row.recipeYield ?? 0) > 0 ? (row.recipeYield as number) : 1;
    const storedIngredientRows = Array.isArray(row.ingredientRows) && row.ingredientRows.length ? row.ingredientRows : null;
    const ingredientsTotal =
      Number.isFinite(row.ingredientsTotal) && (row.ingredientsTotal ?? -1) >= 0
        ? (row.ingredientsTotal as number)
        : custoUnitarioValue * recipeYield;

    return {
      rowId: row.id,
      recipeName: row.receita,
      recipeImage: row.recipeImage || "",
      popularidade: pop,
      precoVenda: precoVendaValue,
      cmvMeta: cmvMetaRow,
      cmvAtual: cmvAtualRow,
      ingredientsTotal,
      recipeYield,
      ingredientRows:
        storedIngredientRows ??
        [
          {
            id: `${row.id}-base`,
            ingredientId: "",
            item: row.receita,
            quantidade: "1",
            unidade: "Und",
            custoTotal: custoUnitarioValue,
          },
        ],
      modoPreparo: row.modoPreparo || "",
    };
  }

  async function downloadFichaTecnicaPdf(recipeArg?: SavedRecipeDetails) {
    const recipe = recipeArg ?? detailsRecipe;
    if (!recipe) return;
    const filename = `ficha-tecnica-${recipe.recipeName.toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/(^-|-$)/g, "") || "receita"}.pdf`;
    const previewTab = window.open("about:blank", "_blank");
    if (previewTab) {
      previewTab.document.title = "Gerando PDF...";
      previewTab.document.body.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
      previewTab.document.body.style.padding = "24px";
      previewTab.document.body.innerText = "Gerando o PDF da ficha técnica...";
    }

    try {
      const { PDFDocument } = await import("pdf-lib");
      const logoSrc = await fetchSvgAsDataUrl("/dashboard/ml7hdudz-jry958l.svg");
      const previewSrcRaw = String(recipe.recipeImage ?? "").trim();
      const previewSrc =
        !previewSrcRaw
          ? ""
          : previewSrcRaw.startsWith("data:") || previewSrcRaw.startsWith("blob:") || previewSrcRaw.startsWith("/") || previewSrcRaw.startsWith(window.location.origin)
            ? previewSrcRaw
            : "";
      const now = new Date();
      const updatedAt = `Última Atualização: ${formatPdfDate(now)} às ${now.toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      })}`;
      const recipeYieldLabel = `${formatDecimal3(recipe.recipeYield)} porções`;
      const metrics = calcRecipeMetrics(recipe.ingredientsTotal, recipe.recipeYield, recipe.precoVenda, recipe.cmvMeta);

      const markup = buildFichaTecnicaPdfMarkup({
        logoSrc,
        recipeName: recipe.recipeName,
        precoVenda: formatMoney(recipe.precoVenda),
        previewSrc,
        updatedAt,
        validade: "1 Dia(s)",
        categoria: popularityLabel(recipe.popularidade),
        custoTotal: formatMoney(recipe.ingredientsTotal),
        custoUnitario: `${formatMoney(metrics.custoPorPorcao)}/porção`,
        precoSugerido: formatMoney(metrics.precoSugerido),
        cmvMeta: formatPercent2(recipe.cmvMeta),
        modoPreparo: recipe.modoPreparo || "-",
        rendimento: recipeYieldLabel,
        ingredients: recipe.ingredientRows.map((row) => ({
          item: row.item,
          qtd: formatQtyLabel(row.quantidade, row.unidade),
          custo: formatMoney(row.custoTotal),
        })),
      });

      const svgMarkup = `
        <svg xmlns="http://www.w3.org/2000/svg" width="595" height="842" viewBox="0 0 595 842">
          <foreignObject x="0" y="0" width="595" height="842">${markup}</foreignObject>
        </svg>
      `;

      const pngDataUrl = await renderSvgMarkupToPngDataUrl(svgMarkup, 595, 842, 2);
      const pngBytes = await dataUrlToUint8Array(pngDataUrl);

      const doc = await PDFDocument.create();
      const page = doc.addPage([595.28, 841.89]);
      const image = await doc.embedPng(pngBytes);
      page.drawImage(image, { x: 0, y: 0, width: 595.28, height: 841.89 });

      const bytes = await doc.save();
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);

      if (previewTab) {
        previewTab.document.title = filename;
        previewTab.location.href = url;
      }

      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 20_000);
    } catch (err) {
      if (previewTab) {
        previewTab.document.title = "Erro ao gerar PDF";
        previewTab.document.body.innerText = "Não foi possível gerar o PDF da ficha técnica. Tente novamente.";
      }
      showToast(`Não foi possível gerar o PDF. (${err instanceof Error ? err.message : String(err)})`, "error", 9000);
    }
  }

  return (
    <>
      {toast ? <SystemToast title={toast.title} message={toast.message} tone={toast.tone} onClose={() => setToast(null)} /> : null}
      {showCompatSplitView ? (
        <main className={dash.content}>
          <div className={styles.pageFrameWide}>
            <QaModePanel screen="fichas-tecnicas" ui={qaUi} />
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

              <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 14, alignItems: "start" }}>
                <section style={{ border: "1px solid #eef1f1", background: "#ffffff", borderRadius: 14, padding: 12, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 900, color: "#01040e", marginBottom: 10 }}>{`Fichas (${compatRecipes.length})`}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, overflow: "auto", maxHeight: "calc(100vh - 260px)" }} data-qa-grid="fichas-tecnicas">
                    {compatRecipes.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => setSelectedCompatRecipeId(r.id)}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          border: "1px solid #eef1f1",
                          background: r.id === (selectedCompatRecipe?.id ?? "") ? "#00282d" : "#f1f3f3",
                          color: r.id === (selectedCompatRecipe?.id ?? "") ? "#ffffff" : "#01040e",
                          borderRadius: 12,
                          padding: "10px 10px",
                          fontWeight: 900,
                          fontSize: 11,
                          display: "flex",
                          flexDirection: "column",
                          gap: 4,
                        }}
                        data-qa-grid-row
                        data-qa-row-id={r.id}
                      >
                        <span>{r.receita}</span>
                        <span style={{ fontWeight: 700, opacity: r.id === (selectedCompatRecipe?.id ?? "") ? 0.75 : 0.7 }}>{`${r.categoria} · ${r.quadrante}`}</span>
                      </button>
                    ))}
                    {compatRecipes[0] ? null : (
                      <div style={{ padding: 14, textAlign: "center", color: "#95a8a6", fontWeight: 800 }}>Sem fichas</div>
                    )}
                  </div>
                </section>

                <section style={{ border: "1px solid #eef1f1", background: "#ffffff", borderRadius: 14, padding: 12, minWidth: 0 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ fontSize: 14, fontWeight: 900, color: "#01040e" }}>{selectedCompatRecipe?.receita ?? "Ficha Técnica"}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#95a8a6" }}>
                      {selectedCompatRecipe ? `${selectedCompatRecipe.categoria} · ${selectedCompatRecipe.quadrante}` : "Selecione uma ficha para ver os detalhes."}
                    </div>
                  </div>

                  {selectedCompatRecipe ? (
                    <>
                      <div style={{ marginTop: 12, overflow: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                          <tbody>
                            {[
                              ["Unidade", selectedCompatRecipe.unidade],
                              ["Rendimento", selectedCompatRecipe.rendimento],
                              ["Preço de venda", selectedCompatRecipe.precoVenda],
                              ["Preço sugerido", selectedCompatRecipe.precoSugerido],
                              ["Custo total", selectedCompatRecipe.custoTotal],
                              ["Custo unitário", selectedCompatRecipe.custoUnitario],
                              ["CMV meta", selectedCompatRecipe.cmvMeta],
                              ["CMV atual", selectedCompatRecipe.cmvAtual],
                              ["Quadrante", selectedCompatRecipe.quadrante],
                            ].map(([k, v]) => (
                              <tr key={k}>
                                <td style={{ padding: "8px 8px", borderBottom: "1px solid #f1f3f3", fontWeight: 900, whiteSpace: "nowrap" }}>{k}</td>
                                <td style={{ padding: "8px 8px", borderBottom: "1px solid #f1f3f3", fontWeight: 700 }}>{v}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <div style={{ marginTop: 14, fontSize: 12, fontWeight: 900, color: "#01040e" }}>{`Ingredientes (${selectedCompatRecipe.ingredientes.length})`}</div>
                      <div style={{ marginTop: 10, overflow: "auto" }} data-qa-grid="fichas-tecnicas:ingredientes">
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                          <thead>
                            <tr>
                              <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid #eef1f1", fontWeight: 900 }}>Item</th>
                              <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid #eef1f1", fontWeight: 900 }}>Qtd</th>
                              <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid #eef1f1", fontWeight: 900 }}>Unid</th>
                              <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid #eef1f1", fontWeight: 900 }}>Custo</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedCompatRecipe.ingredientes.map((it) => (
                              <tr key={it.id} data-qa-grid-row data-qa-row-id={it.id}>
                                <td style={{ padding: "10px 8px", borderBottom: "1px solid #f1f3f3", fontWeight: 800 }}>{it.item}</td>
                                <td style={{ padding: "10px 8px", borderBottom: "1px solid #f1f3f3", fontWeight: 700 }}>{it.quantidade}</td>
                                <td style={{ padding: "10px 8px", borderBottom: "1px solid #f1f3f3", fontWeight: 700 }}>{it.unidade}</td>
                                <td style={{ padding: "10px 8px", borderBottom: "1px solid #f1f3f3", fontWeight: 900 }}>{it.custo}</td>
                              </tr>
                            ))}
                            {selectedCompatRecipe.ingredientes[0] ? null : (
                              <tr>
                                <td colSpan={4} style={{ padding: 18, textAlign: "center", color: "#95a8a6", fontWeight: 800 }}>
                                  Sem ingredientes
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>

                      <div style={{ marginTop: 14, fontSize: 12, fontWeight: 900, color: "#01040e" }}>Modo de preparo</div>
                      <div style={{ marginTop: 10, padding: 12, borderRadius: 12, border: "1px solid #eef1f1", background: "#fbfbfb", fontSize: 12, fontWeight: 700, whiteSpace: "pre-wrap" }}>
                        {selectedCompatRecipe.modoPreparo || "-"}
                      </div>
                    </>
                  ) : null}
                </section>
              </div>
            </div>
        </main>
      ) : (
        <main className={dash.content}>
          <div className={styles.pageFrameWide}>
          {detailsRecipe ? (
            <section className={`${dash.itemDetails} ${styles.detailsPage}`}>
              <div className={`${dash.itemDetailsTop} ${styles.detailsHeader}`}>
                <button type="button" className={`${dash.itemBack} ${styles.detailsBackBtn}`} onClick={() => setDetailsRecipe(null)}>
                  <span className={`${dash.itemBackIcon} ${styles.detailsBackIcon}`}>←</span>
                  <span className={`${dash.itemBackText} ${styles.detailsBackText}`}>{`Detalhes do Item / ${detailsRecipe.recipeName}`}</span>
                </button>
                <div className={`${dash.itemMoreWrap} ${styles.detailsMoreWrap}`}>
                  <button type="button" className={`${dash.itemMore} ${styles.detailsMoreBtn}`} aria-label="Mais opções">
                    ⋮
                  </button>
                </div>
              </div>

              <div className={`${dash.itemDetailsGrid} ${styles.detailsLayout}`}>
                <div className={`${dash.itemDetailsMain} ${styles.detailsMain}`}>
                  <div className={`${dash.itemDetailsTabs} ${styles.detailsTabs}`}>
                    <button
                      type="button"
                      className={detailsViewTab === "ingredientes" ? `${dash.itemTabActive} ${styles.detailsTabActive}` : `${dash.itemTab} ${styles.detailsTab}`}
                      onClick={() => setDetailsViewTab("ingredientes")}
                    >
                      Ingredientes
                    </button>
                    <button
                      type="button"
                      className={detailsViewTab === "preparo" ? `${dash.itemTabActive} ${styles.detailsTabActive}` : `${dash.itemTab} ${styles.detailsTab}`}
                      onClick={() => setDetailsViewTab("preparo")}
                    >
                      Modo de Preparo
                    </button>
                  </div>

                  {detailsViewTab === "ingredientes" ? (
                    <div className={`${dash.itemDetailsBody} ${styles.detailsPanel}`}>
                      <div className={styles.detailsSectionTitle}>Lista de Ingredientes</div>

                      <div className={styles.detailsIngredientBox}>
                        <div className={styles.detailsIngredientHead}>
                          <div>Item</div>
                          <div>Quantidade</div>
                          <div>Custo</div>
                        </div>

                        <div className={styles.detailsIngredientEntry}>
                          <label className={styles.detailsItemSelectWrap}>
                            <span className={styles.detailsItemSearchIcon}>
                              <SearchMiniIcon />
                            </span>
                            <select value={detailIngredientId} onChange={(e) => setDetailIngredientId(e.target.value)} className={styles.detailsItemSelect}>
                              <option value="">Pesquise por itens...</option>
                          {ingredientOptionGroups.insumos.length ? (
                            <optgroup label="Insumos">
                              {ingredientOptionGroups.insumos.map((item) => (
                                <option key={`insumo:${item.id}`} value={item.id}>
                                  {item.item}
                                </option>
                              ))}
                            </optgroup>
                          ) : null}
                          {ingredientOptionGroups.prePreparo.length ? (
                            <optgroup label="Pré-preparo">
                              {ingredientOptionGroups.prePreparo.map((item) => (
                                <option key={`prep:${item.id}`} value={item.id}>
                                  {item.item}
                                </option>
                              ))}
                            </optgroup>
                          ) : null}
                          {ingredientOptionGroups.fichas.length ? (
                            <optgroup label="Fichas Técnicas">
                              {ingredientOptionGroups.fichas.map((item) => (
                                <option key={`ficha:${item.id}`} value={item.id}>
                                  {item.item}
                                </option>
                              ))}
                            </optgroup>
                          ) : null}
                            </select>
                          </label>

                          <span className={styles.detailsInlineGroup}>
                            <input
                              type="text"
                              className={styles.detailsInlineInput}
                              value={detailIngredientQty}
                              inputMode="decimal"
                              pattern="[0-9.,]*"
                              onMouseDown={(e) => {
                                const el = e.currentTarget;
                                e.preventDefault();
                                el.focus();
                                requestAnimationFrame(() => el.select());
                              }}
                              onMouseUp={(e) => e.preventDefault()}
                              onTouchStart={(e) => {
                                const el = e.currentTarget;
                                e.preventDefault();
                                el.focus();
                                requestAnimationFrame(() => el.select());
                              }}
                              onFocus={(e) => {
                                if (/^0,0+$/.test(e.currentTarget.value.trim())) setDetailIngredientQty("");
                                e.currentTarget.select();
                              }}
                              onChange={(e) => setDetailIngredientQty(formatDecimalDraft(e.target.value, 3))}
                              onBlur={(e) => setDetailIngredientQty(formatDecimalFixedDraft(e.target.value, 3))}
                            />
                            <span className={styles.detailsInlineSuffix}>{selectedDetailIngredient?.medida || "Und"}</span>
                          </span>

                          <span className={`${styles.detailsInlineGroup} ${styles.detailsInlineGroupPrefix}`}>
                            <span className={styles.detailsInlinePrefix}>R$</span>
                            <input type="text" className={styles.detailsInlineInput} value={formatDecimal3(detailIngredientCost)} readOnly />
                          </span>

                          <button
                            type="button"
                            className={styles.detailsAddBtn}
                            onClick={addDetailIngredientRow}
                            disabled={!selectedDetailIngredient || parseDecimalInput(detailIngredientQty) <= 0}
                          >
                            <PlusIcon />
                          </button>
                        </div>
                      </div>

                      <div className={styles.detailsDividerIcon}>
                        <ChevronDoubleIcon />
                      </div>

                      <div className={styles.detailsList}>
                        {detailsRecipe.ingredientRows.map((row) =>
                          rowEditId === row.id ? (
                            <div key={row.id} className={styles.detailsListRow}>
                              <label className={styles.detailsItemSelectWrap}>
                                <span className={styles.detailsItemSearchIcon}>
                                  <SearchMiniIcon />
                                </span>
                                <select
                                  value={rowEditIngredientId}
                                  onChange={(e) => setRowEditIngredientId(e.target.value)}
                                  className={styles.detailsItemSelect}
                                >
                                  <option value="">Pesquise por itens...</option>
                                  {ingredientOptionGroups.insumos.length ? (
                                    <optgroup label="Insumos">
                                      {ingredientOptionGroups.insumos.map((item) => (
                                        <option key={`insumo:${item.id}`} value={item.id}>
                                          {item.item}
                                        </option>
                                      ))}
                                    </optgroup>
                                  ) : null}
                                  {ingredientOptionGroups.prePreparo.length ? (
                                    <optgroup label="Pré-preparo">
                                      {ingredientOptionGroups.prePreparo.map((item) => (
                                        <option key={`prep:${item.id}`} value={item.id}>
                                          {item.item}
                                        </option>
                                      ))}
                                    </optgroup>
                                  ) : null}
                                  {ingredientOptionGroups.fichas.length ? (
                                    <optgroup label="Fichas Técnicas">
                                      {ingredientOptionGroups.fichas.map((item) => (
                                        <option key={`ficha:${item.id}`} value={item.id}>
                                          {item.item}
                                        </option>
                                      ))}
                                    </optgroup>
                                  ) : null}
                                </select>
                              </label>

                              <span className={styles.detailsInlineGroup}>
                                <input
                                  type="text"
                                  className={styles.detailsInlineInput}
                                  value={rowEditQty}
                                  inputMode="decimal"
                                  pattern="[0-9.,]*"
                                  onMouseDown={(e) => {
                                    const el = e.currentTarget;
                                    e.preventDefault();
                                    el.focus();
                                    requestAnimationFrame(() => el.select());
                                  }}
                                  onMouseUp={(e) => e.preventDefault()}
                                  onTouchStart={(e) => {
                                    const el = e.currentTarget;
                                    e.preventDefault();
                                    el.focus();
                                    requestAnimationFrame(() => el.select());
                                  }}
                                  onFocus={(e) => {
                                    if (/^0,0+$/.test(e.currentTarget.value.trim())) setRowEditQty("");
                                    e.currentTarget.select();
                                  }}
                                  onChange={(e) => setRowEditQty(formatDecimalDraft(e.target.value, 3))}
                                  onBlur={(e) => setRowEditQty(formatDecimalFixedDraft(e.target.value, 3))}
                                />
                                <span className={styles.detailsInlineSuffix}>{selectedRowEditIngredient?.medida || row.unidade || "Und"}</span>
                              </span>

                              <span className={`${styles.detailsInlineGroup} ${styles.detailsInlineGroupPrefix}`}>
                                <span className={styles.detailsInlinePrefix}>R$</span>
                                <input type="text" className={styles.detailsInlineInput} value={formatDecimal3(rowEditCost)} readOnly />
                              </span>

                              <button
                                type="button"
                                className={styles.detailsEditRowBtn}
                                onClick={saveRowEdit}
                                disabled={!selectedRowEditIngredient || parseDecimalInput(rowEditQty) <= 0}
                                aria-label={`Salvar ${row.item}`}
                              >
                                <CheckIcon />
                              </button>
                              <button type="button" className={styles.detailsTrashBtn} onClick={cancelRowEdit} aria-label={`Cancelar ${row.item}`}>
                                <XIcon />
                              </button>
                            </div>
                          ) : (
                            <div key={row.id} className={styles.detailsListRow}>
                              <div className={styles.detailsListItem}>{row.item}</div>
                              <div className={styles.detailsListQty}>{formatQtyLabel(row.quantidade, row.unidade)}</div>
                              <div className={styles.detailsListCost}>{formatMoney(row.custoTotal)}</div>
                              <button type="button" className={styles.detailsEditRowBtn} onClick={() => startRowEdit(row)} aria-label={`Editar ${row.item}`}>
                                <EditIcon />
                              </button>
                              <button type="button" className={styles.detailsTrashBtn} onClick={() => removeDetailIngredientRow(row.id)} aria-label={`Remover ${row.item}`}>
                                <TrashIcon />
                              </button>
                            </div>
                          )
                        )}
                      </div>

                      <div className={styles.detailsDividerIconBottom}>
                        <ChevronDoubleIcon />
                      </div>

                      <div className={styles.detailsBottomRow}>
                        <div className={styles.detailsYieldCard}>
                          <div>
                            <div className={styles.yieldTitle}>Quanto Rende?</div>
                            <div className={styles.yieldHint}>Informe quanto essa receita irá render em média após o preparo.</div>
                          </div>
                          <div className={styles.detailsYieldMeta}>
                            <input
                              type="text"
                              className={styles.detailsYieldInput}
                              inputMode="decimal"
                              pattern="[0-9.,]*"
                              value={detailsYieldDraft}
                              onMouseDown={(e) => {
                                const el = e.currentTarget;
                                e.preventDefault();
                                el.focus();
                                requestAnimationFrame(() => el.select());
                              }}
                              onMouseUp={(e) => e.preventDefault()}
                              onTouchStart={(e) => {
                                const el = e.currentTarget;
                                e.preventDefault();
                                el.focus();
                                requestAnimationFrame(() => el.select());
                              }}
                              onFocus={(e) => {
                                if (/^0,0+$/.test(e.currentTarget.value.trim())) setDetailsYieldDraft("");
                                e.currentTarget.select();
                              }}
                              onChange={(e) => setDetailsYieldDraft(formatDecimalDraft(e.target.value, 3))}
                              onBlur={(e) => commitDetailsYield(formatDecimalFixedDraft(e.target.value, 3))}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                              }}
                            />
                            <div className={styles.detailsYieldSuffix}>Porções</div>
                          </div>
                        </div>

                        <div className={styles.detailsTotalsCard}>
                          <div className={styles.detailsTotalCol}>
                            <span>Custo Total:</span>
                            <strong>{formatMoney(detailsRecipe.ingredientsTotal)}</strong>
                          </div>
                          <div className={styles.detailsTotalCol}>
                            <span>Custo Unitário:</span>
                            <strong>{`${formatMoney(calcRecipeMetrics(detailsRecipe.ingredientsTotal, detailsRecipe.recipeYield, detailsRecipe.precoVenda, detailsRecipe.cmvMeta).custoPorPorcao)} / porção`}</strong>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : detailsViewTab === "preparo" ? (
                    <div className={`${dash.itemDetailsBody} ${styles.detailsPanel}`}>
                      <div className={styles.detailsPrepHeader}>
                        <div className={styles.detailsSectionTitle}>Modo de Preparo</div>
                        {!isEditingPrep ? (
                          <button type="button" className={styles.detailsEditBtn} onClick={startPrepEdit}>
                            editar
                          </button>
                        ) : null}
                      </div>

                      {isEditingPrep ? (
                        <>
                          <textarea
                            className={styles.detailsPrepTextarea}
                            placeholder="Escreva o modo de preparo deste item..."
                            value={prepDraft}
                            onChange={(e) => setPrepDraft(e.target.value)}
                          />
                          <div className={styles.detailsPrepActions}>
                            <button type="button" className={styles.detailsSaveTextBtn} onClick={savePrepEdit}>
                              Salvar
                            </button>
                            <button type="button" className={styles.detailsCancelTextBtn} onClick={cancelPrepEdit}>
                              Cancelar
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className={styles.detailsPrepSaved}>
                          {detailsRecipe.modoPreparo || "Escreva o modo de preparo deste item..."}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>

                <aside className={`${dash.itemDetailsAside} ${styles.detailsSidebar}`}>
                  <div className={`${dash.itemAsideCard} ${styles.detailsSidebarCard}`}>
                    <div className={styles.detailsPreviewBox}>
                      {detailsRecipe.recipeImage ? (
                        <img src={detailsRecipe.recipeImage} alt="Pré-visualização da receita" className={styles.detailsPreviewImage} />
                      ) : (
                        <div className={styles.detailsPreviewFallback}>
                          <div className={styles.previewTopBar} />
                          <div className={styles.previewThumbGrid}>
                            <span className={styles.previewThumbMain} />
                            <span className={styles.previewThumbSide} />
                          </div>
                        </div>
                      )}
                    </div>
                    <div className={`${dash.itemAsideTitle} ${styles.detailsSidebarTitle}`}>{detailsRecipe.recipeName}</div>
                    <div className={`${dash.itemAsideMeta} ${styles.detailsSidebarMeta}`}>{popularityLabel(detailsRecipe.popularidade)}</div>
                    <div className={`${dash.itemAsideSubmeta} ${styles.detailsSidebarSubmeta}`}>Ficha Técnica</div>
                    <button type="button" className={styles.detailsReturnBtn} onClick={() => void downloadFichaTecnicaPdf()}>
                      <PdfIcon />
                      Baixar Ficha Técnica
                    </button>
                    <div className={detailsRecipe.cmvAtual <= detailsRecipe.cmvMeta ? styles.detailsMetaBadgeGreen : styles.detailsMetaBadgePink}>
                      {detailsRecipe.cmvAtual <= detailsRecipe.cmvMeta ? "CMV ABAIXO DA META" : "CMV ACIMA DA META"}
                    </div>

                    <div className={styles.detailsSummaryList}>
                      <div className={styles.detailsSummaryMetric}>
                        <span className={styles.detailsSummaryIcon}>
                          <MetricPriceIcon />
                        </span>
                        <span className={styles.detailsSummaryText}>
                          <span className={styles.detailsSummaryLabel}>Preço de Venda</span>
                          <strong>{formatMoney(detailsRecipe.precoVenda)}</strong>
                        </span>
                      </div>
                      <div className={styles.detailsSummaryMetric}>
                        <span className={styles.detailsSummaryIcon}>
                          <MetricCmvIcon />
                        </span>
                        <span className={styles.detailsSummaryText}>
                          <span className={styles.detailsSummaryLabel}>CMV Atual</span>
                          <strong>{formatPercent2(detailsRecipe.cmvAtual)}</strong>
                        </span>
                      </div>
                      <div className={styles.detailsSummaryMetric}>
                        <span className={styles.detailsSummaryIcon}>
                          <MetricTargetIcon />
                        </span>
                        <span className={styles.detailsSummaryText}>
                          <span className={styles.detailsSummaryLabel}>CMV Meta</span>
                          <strong>{formatPercent2(detailsRecipe.cmvMeta)}</strong>
                        </span>
                      </div>
                      <div className={styles.detailsSummaryMetric}>
                        <span className={styles.detailsSummaryIcon}>
                          <MetricPriceIcon />
                        </span>
                        <span className={styles.detailsSummaryText}>
                          <span className={styles.detailsSummaryLabel}>Preço Sugerido</span>
                          <strong>{formatMoney(calcRecipeMetrics(detailsRecipe.ingredientsTotal, detailsRecipe.recipeYield, detailsRecipe.precoVenda, detailsRecipe.cmvMeta).precoSugerido)}</strong>
                        </span>
                      </div>
                    </div>
                  </div>
                </aside>
              </div>
            </section>
          ) : (
            <>
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
          <section className={styles.headerRow}>
            <div className={styles.titleWrap}>
              <span className={styles.titleIcon}>
                <HeaderIcon />
              </span>
              <div>
                <div className={styles.titleLine}>
                  <h1 className={styles.pageTitle}>Fichas Técnicas</h1>
                  <span className={styles.newBadge}>NOVO</span>
                </div>
                <p className={styles.pageSubtitle}>Acompanhe com precisão os custos e margem de cada receita do seu cardápio.</p>
              </div>
            </div>

            {isReadOnly ? null : (
              <div className={styles.headerActions}>
                <input
                  ref={importFileRef}
                  type="file"
                  multiple
                  accept=".csv,.xlsx,.xls,text/csv"
                  className={styles.hiddenFileInput}
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    if (files.length) void importFichasFiles(files);
                  }}
                />
                <button
                  type="button"
                  className={styles.importButton}
                  disabled={isImporting || isLoadingTable}
                  onClick={() => importFileRef.current?.click()}
                >
                  {isImporting ? "Importando..." : isLoadingTable ? "Carregando..." : "Importar planilha"}
                </button>
                <button type="button" className={styles.newButton} onClick={openCreateModal} disabled={isImporting || isLoadingTable}>
                  <PlusIcon />
                  Nova Ficha Técnica
                </button>
              </div>
            )}
          </section>

          {importProgress ? (
            <section className={styles.importProgressPanel} aria-live="polite">
              <div className={styles.importProgressHeader}>
                <span>{importProgress.stage}</span>
                <strong>{Math.round((importProgress.current / Math.max(importProgress.total, 1)) * 100)}%</strong>
              </div>
              <div className={styles.importProgressTrack}>
                <div
                  className={styles.importProgressFill}
                  style={{ width: `${Math.max(2, (importProgress.current / Math.max(importProgress.total, 1)) * 100)}%` }}
                />
              </div>
              <div className={styles.importProgressCount}>
                {importProgress.current.toLocaleString("pt-BR")} de {importProgress.total.toLocaleString("pt-BR")} fichas
              </div>
            </section>
          ) : null}

          <QaModePanel screen="fichas-tecnicas" ui={qaUi} />

          <section className={styles.filtersRow}>
            <label className={styles.searchField}>
              <span className={styles.searchIcon}>
                <SearchIcon />
              </span>
              <input
                type="text"
                placeholder="Pesquise por receitas..."
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
              />
            </label>

            <select
              className={styles.select}
              value={quadrante}
              onChange={(e) => {
                setQuadrante(e.target.value);
                setPage(1);
              }}
            >
              <option value="Quadrante">Quadrante</option>
              <option value="estrela">Estrela</option>
              <option value="cavalo">Cavalo</option>
              <option value="quebra-cabeca">Quebra-Cabeça</option>
              <option value="abacaxi">Abacaxi</option>
            </select>
          </section>

          {tableRows.length === 0 ? (
            <section className={styles.emptyState}>
              <div className={styles.emptyStateCard}>
                <div className={styles.emptyStateTitle}>Nenhuma ficha técnica cadastrada</div>
                <div className={styles.emptyStateText}>Cadastre sua primeira ficha técnica para acompanhar custos e CMV do cardápio.</div>
                {isReadOnly ? null : (
                  <button type="button" className={styles.newButton} onClick={openCreateModal}>
                    <PlusIcon />
                    Nova Ficha Técnica
                  </button>
                )}
              </div>
            </section>
          ) : (
            <>
              <section className={styles.matrixSection}>
                <p className={styles.matrixTitle}>Entenda os status da matriz BCG</p>
                <div className={styles.matrixGrid}>
                  {bcgInfo.map((card) => (
                    <article
                      key={card.key}
                      className={`${styles.matrixCard} ${quadrante === card.key ? styles.matrixCardActive : ""}`}
                      role="button"
                      tabIndex={0}
                      aria-pressed={quadrante === card.key}
                      onClick={() => toggleQuadranteFilter(card.key)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggleQuadranteFilter(card.key);
                        }
                      }}
                    >
                      <div className={styles.matrixHead}>
                        <span className={`${styles.matrixIcon} ${badgeClass(card.key)}`}>
                          <BcgIcon type={card.icon} />
                        </span>
                        <span className={styles.matrixName}>{`${card.title} (${counts[card.key]})`}</span>
                      </div>
                      <p className={styles.matrixDescription}>{card.description}</p>
                      <ul className={styles.matrixList}>
                        {card.bullets.map((bullet) => (
                          <li key={bullet}>{bullet}</li>
                        ))}
                      </ul>
                      <div className={styles.matrixTags}>
                        <span className={styles.tagGreen}>↑ Popularidade</span>
                        <span className={styles.tagPink}>{card.key === "estrela" || card.key === "quebra-cabeca" ? "↓ CMV" : "↑ CMV"}</span>
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <section className={styles.tableCard} style={{ position: "relative" }} data-qa-grid="fichas-tecnicas">
                {isLoadingTable ? (
                  <div className={dash.loadingOverlay}>
                    <LoadingSpinner />
                  </div>
                ) : null}
                <div className={styles.tableHeader} style={{ gridTemplateColumns: tableGridTemplateColumns }}>
                  {columnOrder.map((column) => {
                    const label =
                      column === "receita"
                        ? "Receita"
                        : column === "precoVenda"
                          ? "Preço de Venda"
                          : column === "custoUnitario"
                            ? "Custo Unitário"
                            : column === "cmvMeta"
                              ? "CMV Meta"
                              : column === "cmvAtual"
                                ? "CMV Atual"
                                : "Matriz BCG";
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
                  <div className={styles.tableActionsHead}>Ações</div>
                </div>

                <div className={styles.tableBody} data-qa-grid="fichas-tecnicas:rows">
                  {pageRows.map((row) => (
                    <div
                      key={row.id}
                      className={styles.tableRow}
                      role="button"
                      tabIndex={0}
                      onClick={() => openRowDetails(row)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openRowDetails(row);
                        }
                      }}
                      style={{ gridTemplateColumns: tableGridTemplateColumns }}
                      data-qa-grid-row
                      data-qa-row-id={row.id}
                    >
                      {columnOrder.map((column) => (
                        <div key={column} className={styles.tableCellWrap}>
                          {renderTableCell(row, column)}
                        </div>
                      ))}
                      <div className={styles.actionsCell} data-ft-action-menu onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className={styles.actionBtn}
                          aria-label={`Ações da receita ${row.receita}`}
                          aria-expanded={actionMenuRowId === row.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            const anchor = e.currentTarget;
                            const anchorRect = anchor?.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
                            setActionMenuRowId((prev) => {
                              const next = prev === row.id ? null : row.id;
                              if (!next) {
                                setActionMenuRect(null);
                                return null;
                              }
                              if (anchorRect) setActionMenuRect(computeActionMenuRect(anchorRect));
                              else setActionMenuRect(null);
                              return next;
                            });
                          }}
                        >
                          <DotsIcon />
                        </button>
                        {actionMenuRowId === row.id ? (
                          actionMenuRect
                            ? createPortal(
                                <div
                                  ref={actionMenuRef}
                                  className={styles.actionMenu}
                                  style={{ position: "fixed", left: actionMenuRect.left, top: actionMenuRect.top, right: "auto" }}
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <button type="button" className={styles.actionMenuItem} onClick={() => openEditModal(row)}>
                                    <span className={styles.actionMenuIcon}>
                                      <EditIcon />
                                    </span>
                                    <span>Editar</span>
                                  </button>
                                  <button
                                    type="button"
                                    className={styles.actionMenuItem}
                                    onClick={() => {
                                      setActionMenuRowId(null);
                                      setActionMenuRect(null);
                                      void downloadFichaTecnicaPdf(buildDetailsRecipeFromRow(row));
                                    }}
                                  >
                                    <span className={styles.actionMenuIcon}>
                                      <PdfIcon />
                                    </span>
                                    <span>Ficha Técnica</span>
                                  </button>
                                  <button type="button" className={styles.actionMenuItem} onClick={() => openDeleteModal(row)}>
                                    <span className={styles.actionMenuIcon}>
                                      <TrashIcon />
                                    </span>
                                    <span>Excluir</span>
                                  </button>
                                </div>,
                                document.body,
                              )
                            : null
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className={styles.footerRow}>
                <div className={styles.resultsText}>{`${filteredRows.length} resultado(s) encontrado(s)`}</div>
                <div className={styles.pagination}>
                  <button type="button" className={styles.pageBtn} disabled={currentPage === 1} onClick={() => setPage(1)}>
                    {"<<"}
                  </button>
                  <button
                    type="button"
                    className={styles.pageBtn}
                    disabled={currentPage === 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    {"<"}
                  </button>
                  <span className={styles.pageInfo}>{`${currentPage} de ${totalPages}`}</span>
                  <button
                    type="button"
                    className={styles.pageBtn}
                    disabled={currentPage === totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    {">"}
                  </button>
                  <button type="button" className={styles.pageBtn} disabled={currentPage === totalPages} onClick={() => setPage(totalPages)}>
                    {">>"}
                  </button>
                </div>
              </section>
            </>
          )}
            </>
          )}
          </div>
          </main>
      )}

      {mounted && isCreateOpen && !isReadOnly ? (
        createPortal(
        <div className={styles.modalOverlay} role="presentation">
          <div className={styles.modalCard} role="dialog" aria-modal="true" aria-labelledby="nova-ficha-title">
            <div className={styles.modalHeader}>
              <h2 id="nova-ficha-title" className={styles.modalTitle}>
                Cadastro de Receita (Item do Cardápio)
              </h2>
              <button type="button" className={styles.modalClose} aria-label="Fechar" onClick={closeCreateModal}>
                ×
              </button>
            </div>

            <div className={styles.modalBody}>
              <div className={styles.stepRow}>
                <span className={styles.stepText}>{`${createStep} de 3`}</span>
                <span className={`${styles.stepBar} ${createStep >= 1 ? styles.stepBarActive : ""}`} />
                <span className={`${styles.stepBar} ${createStep >= 2 ? styles.stepBarActive : ""}`} />
                <span className={`${styles.stepBar} ${createStep >= 3 ? styles.stepBarActive : ""}`} />
              </div>

              {createStep === 1 ? (
                <>
                  <div className={styles.heroRow}>
                    <label className={styles.imageUpload}>
                      <input type="file" accept="image/*" className={styles.hiddenInput} onChange={handleRecipeImageChange} />
                      {recipeImage ? (
                        <img src={recipeImage} alt="Pré-visualização da receita" className={styles.imagePreview} />
                      ) : (
                        <span>Enviar Imagem</span>
                      )}
                    </label>
                    <div className={styles.imageHint}>Tamanho recomendado: 600 x 600 px</div>
                  </div>

                  <div className={styles.formBlock}>
                    <label className={styles.fieldBlock}>
                      <span className={styles.fieldLabel}>Nome da Receita</span>
                      <input
                        type="text"
                        className={styles.textInput}
                        placeholder="Ex: Maionese da casa"
                        value={recipeName}
                        onChange={(e) => setRecipeName(e.target.value)}
                      />
                    </label>

                    <div className={styles.formGrid}>
                      <label className={styles.fieldBlock}>
                        <span className={styles.fieldLabel}>Preço de Venda</span>
                        <div className={`${styles.inputGroup} ${styles.inputGroupPrefix}`}>
                          <span className={styles.inputPrefix}>R$</span>
                          <input
                            type="text"
                            className={styles.groupInput}
                            inputMode="decimal"
                            value={precoVenda}
                            onMouseDown={(e) => {
                              if (document.activeElement !== e.currentTarget) {
                                e.preventDefault();
                                e.currentTarget.focus();
                                e.currentTarget.select();
                              }
                            }}
                            onFocus={(e) => {
                              if (e.currentTarget.value.trim() === "0,00") setPrecoVenda("");
                              e.currentTarget.select();
                            }}
                            onChange={(e) => setPrecoVenda(formatMoneyDraft(e.target.value))}
                          />
                        </div>
                      </label>

                      <label className={styles.fieldBlock}>
                        <span className={styles.fieldLabel}>CMV Meta</span>
                        <div className={`${styles.inputGroup} ${styles.inputGroupSuffix}`}>
                          <input
                            type="text"
                            className={styles.groupInput}
                            inputMode="decimal"
                            value={cmvMetaDraft}
                            onMouseDown={(e) => {
                              if (document.activeElement !== e.currentTarget) {
                                e.preventDefault();
                                e.currentTarget.focus();
                                e.currentTarget.select();
                              }
                            }}
                            onFocus={(e) => {
                              if (e.currentTarget.value.trim() === "0,00") setCmvMetaDraft("");
                              e.currentTarget.select();
                            }}
                            onChange={(e) => setCmvMetaDraft(formatPercentDraft(e.target.value))}
                          />
                          <span className={styles.inputSuffix}>%</span>
                        </div>
                      </label>

                      <label className={styles.fieldBlock}>
                        <span className={styles.fieldLabel}>Popularidade</span>
                        <select className={styles.modalSelect} value={popularidade} onChange={(e) => setPopularidade(e.target.value)}>
                          <option value="">Selecione</option>
                          <option value="alta">Alta</option>
                          <option value="baixa">Baixa</option>
                        </select>
                      </label>
                    </div>
                  </div>
                </>
              ) : null}

              {createStep === 2 ? (
                <div className={styles.stepTwoWrap}>
                  <div className={styles.stepTwoHeader}>
                    <div className={styles.stepTwoTitle}>Ingredientes Utilizados</div>
                    <div className={styles.stepTwoSubtitle}>Adicione os itens que compõem esta receita, com suas respectivas quantidades.</div>
                  </div>

                  <div className={styles.ingredientsCard}>
                    <div className={styles.ingredientsLabels}>
                      <span>Item</span>
                      <span>Quantidade</span>
                      <span>Custo</span>
                    </div>
                    <div className={styles.ingredientsEntry}>
                      <label className={styles.itemSelectWrap}>
                        <span className={styles.itemSelectIcon}>
                          <SearchMiniIcon />
                        </span>
                        <select value={selectedIngredientId} onChange={(e) => setSelectedIngredientId(e.target.value)} className={styles.itemSelect}>
                          <option value="">Pesquise por itens...</option>
                          {ingredientOptionGroups.insumos.length ? (
                            <optgroup label="Insumos">
                              {ingredientOptionGroups.insumos.map((item) => (
                                <option key={`insumo:${item.id}`} value={item.id}>
                                  {item.item}
                                </option>
                              ))}
                            </optgroup>
                          ) : null}
                          {ingredientOptionGroups.prePreparo.length ? (
                            <optgroup label="Pré-preparo">
                              {ingredientOptionGroups.prePreparo.map((item) => (
                                <option key={`prep:${item.id}`} value={item.id}>
                                  {item.item}
                                </option>
                              ))}
                            </optgroup>
                          ) : null}
                          {ingredientOptionGroups.fichas.length ? (
                            <optgroup label="Fichas Técnicas">
                              {ingredientOptionGroups.fichas.map((item) => (
                                <option key={`ficha:${item.id}`} value={item.id}>
                                  {item.item}
                                </option>
                              ))}
                            </optgroup>
                          ) : null}
                        </select>
                      </label>

                      <span className={styles.inlineGroup}>
                        <input
                          type="text"
                          className={styles.inlineInput}
                          value={ingredientQty}
                          inputMode="decimal"
                          onMouseDown={(e) => {
                            if (document.activeElement !== e.currentTarget) {
                              e.preventDefault();
                              e.currentTarget.focus();
                              e.currentTarget.select();
                            }
                          }}
                          onFocus={(e) => {
                            if (/^0,0+$/.test(e.currentTarget.value.trim())) setIngredientQty("");
                            e.currentTarget.select();
                          }}
                          onChange={(e) => setIngredientQty(formatDecimalDraft(e.target.value, 3))}
                          onBlur={(e) => setIngredientQty(formatDecimalFixedDraft(e.target.value, 3))}
                        />
                        <span className={styles.inlineSuffix}>{selectedIngredient?.medida || "Und"}</span>
                      </span>

                      <span className={styles.inlineGroup}>
                        <span className={styles.inlinePrefix}>R$</span>
                        <input type="text" className={styles.inlineInput} value={formatDecimal3(ingredientCost)} readOnly />
                      </span>

                      <button type="button" className={styles.addBtn} onClick={addIngredientRow} disabled={!selectedIngredient || parseDecimalInput(ingredientQty) <= 0}>
                        {editingIngredientRowId ? <EditIcon /> : <PlusIcon />}
                      </button>
                    </div>
                  </div>

                  <div className={styles.collapseIcon}>
                    <ChevronDoubleIcon />
                  </div>

                  {ingredientRows.length ? (
                    <div className={styles.ingredientsList}>
                      {ingredientRows.map((row) => (
                        <div key={row.id} className={styles.ingredientRow}>
                          <div className={styles.ingredientItem}>{row.item}</div>
                          <div className={styles.ingredientQty}>{formatQtyLabel(row.quantidade, row.unidade)}</div>
                          <div className={styles.ingredientCost}>{formatMoney(row.custoTotal)}</div>
                          <button type="button" className={styles.editRowBtn} onClick={() => editIngredientRow(row)} aria-label={`Editar ${row.item}`}>
                            <EditIcon />
                          </button>
                          <button type="button" className={styles.deleteBtn} onClick={() => removeIngredientRow(row.id)} aria-label={`Remover ${row.item}`}>
                            <TrashIcon />
                          </button>
                        </div>
                      ))}

                      <div className={styles.totalBar}>
                        <span>Custo Total</span>
                        <strong>{formatMoney(ingredientsTotal)}</strong>
                      </div>
                    </div>
                  ) : (
                    <div className={styles.emptyIngredients}>
                      <EmptyBoxIcon />
                      <div className={styles.emptyText}>Ops... Nada aqui!</div>
                    </div>
                  )}
                </div>
              ) : null}

              {createStep === 3 ? (
                <div className={styles.stepThreeWrap}>
                  <div className={styles.stepTwoHeader}>
                    <div className={styles.stepTwoTitle}>Resumo</div>
                    <div className={styles.stepTwoSubtitle}>Confira abaixo o resumo da sua receita antes de finalizar o cadastro.</div>
                  </div>
                  <div className={styles.summaryCard}>
                    <div className={styles.summaryHero}>
                      <div className={styles.summaryPreview}>
                        {recipeImage ? (
                          <img src={recipeImage} alt="Pré-visualização da receita" className={styles.summaryPreviewImage} />
                        ) : (
                          <>
                            <div className={styles.previewTopBar} />
                            <div className={styles.previewThumbGrid}>
                              <span className={styles.previewThumbMain} />
                              <span className={styles.previewThumbSide} />
                            </div>
                          </>
                        )}
                      </div>
                      <div className={styles.summaryIdentity}>
                        <div className={styles.summaryRecipeName}>{recipeName || "-"}</div>
                        <div className={styles.summaryPopularity}>{popularityLabel(popularidade)}</div>
                      </div>
                    </div>

                    <div className={styles.summaryMetrics}>
                      <div className={styles.summaryLine}>
                        <span>Preço de Venda:</span>
                        <strong>{priceValue ? formatMoney(priceValue) : "-"}</strong>
                      </div>
                      <div className={styles.summaryLine}>
                        <span>Custo Unitário:</span>
                        <strong>{`${formatMoney(createMetrics.custoPorPorcao)} / porção`}</strong>
                      </div>
                      <div className={styles.summaryLine}>
                        <span>CMV Meta:</span>
                        <strong>{formatPercent2(cmvMetaValue)}</strong>
                      </div>
                      <div className={styles.summaryLine}>
                        <span>CMV Atual:</span>
                        <span className={styles.summaryCmvValue}>
                          <span className={cmvAbaixoMeta ? styles.summaryCmvBadgeGreen : styles.summaryCmvBadgePink}>
                            {cmvAbaixoMeta ? "ABAIXO DA META" : "ACIMA DA META"}
                          </span>
                          <strong className={cmvAbaixoMeta ? styles.summaryCmvGreen : styles.summaryCmvPink}>{formatPercent2(cmvAtualValue)}</strong>
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            {createStep === 1 ? (
              <div className={styles.modalFooter}>
                <button type="button" className={styles.cancelBtn} onClick={closeCreateModal}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className={`${styles.nextBtn} ${canGoStep1 ? styles.nextBtnActive : ""}`}
                  disabled={!canGoStep1}
                  onClick={() => setCreateStep(2)}
                >
                  Próximo
                </button>
              </div>
            ) : null}

            {createStep === 2 ? (
              <div className={styles.stepTwoFooter}>
                <div className={styles.yieldRow}>
                  <div>
                    <div className={styles.yieldTitle}>Quanto Rende?</div>
                    <div className={styles.yieldHint}>Informe quanto essa receita irá render em média após o preparo.</div>
                  </div>
                  <span className={styles.yieldInputWrap}>
                    <input
                      type="text"
                      className={styles.yieldInput}
                      inputMode="decimal"
                      value={recipeYield}
                      onMouseDown={(e) => {
                        if (document.activeElement !== e.currentTarget) {
                          e.preventDefault();
                          e.currentTarget.focus();
                          e.currentTarget.select();
                        }
                      }}
                      onFocus={(e) => {
                        if (/^0,0+$/.test(e.currentTarget.value.trim())) setRecipeYield("");
                        e.currentTarget.select();
                      }}
                      onChange={(e) => setRecipeYield(formatDecimalDraft(e.target.value, 3))}
                      onBlur={(e) => setRecipeYield(formatDecimalFixedDraft(e.target.value, 3))}
                    />
                    <span className={styles.yieldSuffix}>Porções</span>
                  </span>
                </div>

                <div className={styles.modalActions}>
                  <button type="button" className={styles.backBtn} onClick={() => setCreateStep(1)}>
                    Voltar
                  </button>
                  <button type="button" className={`${styles.nextBtn} ${canGoStep2 ? styles.nextBtnActive : ""}`} disabled={!canGoStep2} onClick={() => setCreateStep(3)}>
                    Próximo
                  </button>
                </div>
              </div>
            ) : null}

            {createStep === 3 ? (
              <div className={styles.modalFooter}>
                <button type="button" className={styles.backBtn} onClick={() => setCreateStep(2)}>
                  Voltar
                </button>
                <button type="button" className={`${styles.nextBtn} ${styles.nextBtnActive}`} onClick={openSavedRecipeDetails}>
                  Salvar
                </button>
              </div>
            ) : null}
          </div>
        </div>,
        document.body,
        )
      ) : null}

      {mounted && editDraft && !isReadOnly ? (
        createPortal(
        <div className={styles.modalOverlay} role="presentation">
          <div className={styles.modalCard} role="dialog" aria-modal="true" aria-labelledby="editar-ficha-title">
            <div className={styles.modalHeader}>
              <h2 id="editar-ficha-title" className={styles.modalTitle}>
                Cadastro de Receita (Item do Cardápio)
              </h2>
              <button type="button" className={styles.modalClose} aria-label="Fechar" onClick={closeEditModal}>
                ×
              </button>
            </div>

            <div className={styles.modalBody}>
              <div className={styles.stepRow}>
                <span className={styles.stepText}>1 de 3</span>
                <span className={`${styles.stepBar} ${styles.stepBarActive}`} />
                <span className={styles.stepBar} />
                <span className={styles.stepBar} />
              </div>

              <div className={styles.heroRow}>
                <div className={styles.imageUpload}>
                  <RecipeThumb type={editDraft.thumb} />
                </div>
                <div className={styles.imageHint}>Tamanho recomendado: 600 x 600 px</div>
              </div>

              <div className={styles.formBlock}>
                <label className={styles.fieldBlock}>
                  <span className={styles.fieldLabel}>Nome da Receita</span>
                  <input
                    type="text"
                    className={styles.textInput}
                    value={editDraft.recipeName}
                    onChange={(e) => setEditDraft((prev) => (prev ? { ...prev, recipeName: e.target.value } : prev))}
                  />
                </label>

                <div className={styles.formGrid}>
                  <label className={styles.fieldBlock}>
                    <span className={styles.fieldLabel}>Preço de Venda</span>
                    <div className={`${styles.inputGroup} ${styles.inputGroupPrefix}`}>
                      <span className={styles.inputPrefix}>R$</span>
                      <input
                        type="text"
                        className={styles.groupInput}
                        inputMode="decimal"
                        value={editDraft.precoVenda}
                        onMouseDown={(e) => {
                          if (document.activeElement !== e.currentTarget) {
                            e.preventDefault();
                            e.currentTarget.focus();
                            e.currentTarget.select();
                          }
                        }}
                        onFocus={(e) => {
                          if (e.currentTarget.value.trim() === "0,00") setEditDraft((prev) => (prev ? { ...prev, precoVenda: "" } : prev));
                          e.currentTarget.select();
                        }}
                        onChange={(e) => setEditDraft((prev) => (prev ? { ...prev, precoVenda: formatMoneyDraft(e.target.value) } : prev))}
                      />
                    </div>
                  </label>

                  <label className={styles.fieldBlock}>
                    <span className={styles.fieldLabel}>CMV Meta</span>
                    <div className={`${styles.inputGroup} ${styles.inputGroupSuffix}`}>
                      <input
                        type="text"
                        className={styles.groupInput}
                        inputMode="decimal"
                        value={editDraft.cmvMeta}
                        onMouseDown={(e) => {
                          if (document.activeElement !== e.currentTarget) {
                            e.preventDefault();
                            e.currentTarget.focus();
                            e.currentTarget.select();
                          }
                        }}
                        onFocus={(e) => {
                          if (e.currentTarget.value.trim() === "0,00") setEditDraft((prev) => (prev ? { ...prev, cmvMeta: "" } : prev));
                          e.currentTarget.select();
                        }}
                        onChange={(e) => setEditDraft((prev) => (prev ? { ...prev, cmvMeta: formatPercentDraft(e.target.value) } : prev))}
                      />
                      <span className={styles.inputSuffix}>%</span>
                    </div>
                  </label>

                  <label className={styles.fieldBlock}>
                    <span className={styles.fieldLabel}>Popularidade</span>
                    <select
                      className={styles.modalSelect}
                      value={editDraft.popularidade}
                      onChange={(e) => setEditDraft((prev) => (prev ? { ...prev, popularidade: e.target.value } : prev))}
                    >
                      <option value="Alta">Alta</option>
                      <option value="Baixa">Baixa</option>
                    </select>
                  </label>
                </div>

                <div className={styles.editSuggestedPrice}>{`Preço Sugerido: ${formatMoney(parseDecimalInput(editDraft.cmvMeta) > 0 ? editDraft.custoUnitario / (parseDecimalInput(editDraft.cmvMeta) / 100) : 0)}`}</div>
              </div>
            </div>

            <div className={styles.modalFooter}>
              <button type="button" className={styles.cancelBtn} onClick={closeEditModal}>
                Cancelar
              </button>
              <button type="button" className={`${styles.nextBtn} ${styles.nextBtnActive}`} onClick={saveEditedRow}>
                Salvar
              </button>
            </div>
          </div>
        </div>,
        document.body,
        )
      ) : null}

      {mounted && deleteRow && !isReadOnly ? (
        createPortal(
        <div className={styles.modalOverlay} role="presentation">
          <div className={styles.deleteModalCard} role="dialog" aria-modal="true" aria-labelledby="excluir-receita-title">
            <div className={styles.modalHeader}>
              <h2 id="excluir-receita-title" className={styles.deleteModalTitle}>
                Excluir Receita?
              </h2>
              <button type="button" className={styles.modalClose} aria-label="Fechar" onClick={closeDeleteModal}>
                ×
              </button>
            </div>

            <div className={styles.deleteModalBody}>
              <div className={styles.deleteIconWrap}>
                <TrashIcon />
              </div>
              <div className={styles.deleteMessage}>
                {`Caso exclua a receita "${deleteRow.receita}" não poderá recuperá-la.`}
              </div>
            </div>

            <div className={styles.deleteModalFooter}>
              <button
                type="button"
                className={styles.deleteConfirmBtn}
                onClick={() => {
                  removeTableRow(deleteRow.id);
                  closeDeleteModal();
                }}
              >
                Excluir
              </button>
              <button type="button" className={styles.deleteCancelBtn} onClick={closeDeleteModal}>
                Cancelar
              </button>
            </div>
          </div>
        </div>,
        document.body,
        )
      ) : null}
    </>
  );
}
