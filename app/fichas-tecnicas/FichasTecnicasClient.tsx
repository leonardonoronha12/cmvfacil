"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import AppSidebar from "../components/AppSidebar";
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
import { loadFichasTecnicasFromSupabase, saveFichasTecnicasToSupabase } from "../lib/fichasTecnicasSupabase";
import {
  readFichasTecnicasEtiquetasFromStore,
  subscribeFichasTecnicasEtiquetas,
  writeFichasTecnicasEtiquetasToStore,
  type FichaTecnicaEtiquetaRow,
} from "../lib/fichasTecnicasEtiquetasStore";
import { loadFichasTecnicasEtiquetasFromSupabase, saveFichasTecnicasEtiquetasToSupabase } from "../lib/fichasTecnicasEtiquetasSupabase";
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
};

type ModalIngredientRow = {
  id: string;
  ingredientId: string;
  item: string;
  quantidade: string;
  unidade: string;
  custoTotal: number;
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

function RecipeThumb({ type }: { type: ThumbType }) {
  return (
    <div className={`${styles.thumb} ${type === "burger" ? styles.thumbBurger : type === "duplo" ? styles.thumbDuplo : styles.thumbTriplo}`}>
      {type === "burger" ? <span className={styles.thumbBurgerIcon}>🍔</span> : <span className={styles.thumbText}>{type.toUpperCase()}</span>}
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
            <div class="metaLine"><strong>Validade:</strong>&nbsp; ${escapeHtml(params.validade)}</div>
            <div class="metaLine"><strong>Categoria:</strong>&nbsp; ${escapeHtml(params.categoria)}</div>
            <div class="metaLine"><strong>Custo Total:</strong>&nbsp; ${escapeHtml(params.custoTotal)}</div>
            <div class="metaLine"><strong>Custo Unitário:</strong>&nbsp; ${escapeHtml(params.custoUnitario)}</div>
            <div class="metaLine"><strong>Preço de Venda Sugerido (CMV = ${escapeHtml(params.cmvMeta)}):</strong>&nbsp; ${escapeHtml(params.precoSugerido)}</div>
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

export default function FichasTecnicasClient() {
  const searchParams = useSearchParams();
  const openedFromQueryRef = useRef(false);
  const toastTimerRef = useRef<number | null>(null);
  const saveTimeoutRef = useRef<number | null>(null);
  const saveEtiquetasTimeoutRef = useRef<number | null>(null);
  const saveErrorShownRef = useRef(false);
  const loadErrorShownRef = useRef(false);
  const missingTablesShownRef = useRef(false);
  const [isSupabaseFichasEnabled, setIsSupabaseFichasEnabled] = useState(true);
  const [isSupabaseEtiquetasEnabled, setIsSupabaseEtiquetasEnabled] = useState(true);
  const [isLoadingTable, setIsLoadingTable] = useState(true);
  const [toast, setToast] = useState<{ title: string; message: string; tone: "success" | "error" } | null>(null);
  const [tableRows, setTableRows] = useState<RecipeRow[]>([]);
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
  const [detailsViewTab, setDetailsViewTab] = useState<"ingredientes" | "preparo" | "etiquetas">("ingredientes");
  const [detailIngredientId, setDetailIngredientId] = useState("");
  const [detailIngredientQty, setDetailIngredientQty] = useState("0,000");
  const [detailsYieldDraft, setDetailsYieldDraft] = useState("1,000");
  const [rowEditId, setRowEditId] = useState<string | null>(null);
  const [rowEditIngredientId, setRowEditIngredientId] = useState("");
  const [rowEditQty, setRowEditQty] = useState("0,000");
  const [isEditingPrep, setIsEditingPrep] = useState(false);
  const [prepDraft, setPrepDraft] = useState("");
  const [etiquetasRows, setEtiquetasRows] = useState<FichaTecnicaEtiquetaRow[]>(() => readFichasTecnicasEtiquetasFromStore([]));
  const [isEtiquetaOpen, setIsEtiquetaOpen] = useState(false);
  const [etiquetaResponsavel, setEtiquetaResponsavel] = useState("");
  const [etiquetaQtd, setEtiquetaQtd] = useState("1,000");
  const [etiquetaUnidade, setEtiquetaUnidade] = useState("Porção");
  const [etiquetaDataProd, setEtiquetaDataProd] = useState(() => formatDateLabel(new Date()));
  const [etiquetaDataVal, setEtiquetaDataVal] = useState(() => formatDateLabel(addDays(new Date(), 1)));
  const [actionMenuRowId, setActionMenuRowId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditRecipeDraft | null>(null);
  const [deleteRow, setDeleteRow] = useState<RecipeRow | null>(null);

  function showToast(message: string, type: "success" | "error", durationMs = 4500) {
    setToast({ title: type === "success" ? "Sucesso" : "Erro", message, tone: type });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, durationMs);
  }

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current);
      if (saveEtiquetasTimeoutRef.current) window.clearTimeout(saveEtiquetasTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    setInsumos(readInsumosFromStore());
    void (async () => {
      try {
        const dbRows = await loadInsumosFromSupabase();
        if (dbRows.length) writeInsumosToStore(dbRows);
      } catch {}
    })();
    return subscribeInsumos(setInsumos);
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
    return subscribeEntradas(setEntradas);
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
    return subscribeFornecedorEquivalencias(setFornecedorEquivalenciasMap);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const rows = await loadFichasTecnicasFromSupabase();
        setTableRows(rows as unknown as RecipeRow[]);
        writeFichasTecnicasToStore(rows as any);
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
    void (async () => {
      try {
        const rows = await loadFichasTecnicasEtiquetasFromSupabase();
        setEtiquetasRows(rows);
        writeFichasTecnicasEtiquetasToStore(rows);
        setIsSupabaseEtiquetasEnabled(true);
      } catch (err) {
        setEtiquetasRows(readFichasTecnicasEtiquetasFromStore([]));
        if (isMissingTableError(err, "fichas_tecnicas_etiquetas_state")) {
          setIsSupabaseEtiquetasEnabled(false);
          if (!missingTablesShownRef.current) {
            missingTablesShownRef.current = true;
            showToast("Tabela fichas_tecnicas_etiquetas_state não existe no Supabase. Abra /setup-supabase e rode o SQL (passo 3).", "error", 9000);
          }
          return;
        }
        showToast(err instanceof Error ? err.message : "Não foi possível carregar as etiquetas.", "error");
      }
    })();
    return subscribeFichasTecnicasEtiquetas(setEtiquetasRows);
  }, []);

  useEffect(() => {
    writeFichasTecnicasEtiquetasToStore(etiquetasRows);
    if (!isSupabaseEtiquetasEnabled) return;
    if (saveEtiquetasTimeoutRef.current) window.clearTimeout(saveEtiquetasTimeoutRef.current);
    saveEtiquetasTimeoutRef.current = window.setTimeout(() => {
      void saveFichasTecnicasEtiquetasToSupabase(etiquetasRows).catch((err) => {
        showToast(err instanceof Error ? err.message : "Não foi possível salvar as etiquetas.", "error");
      });
    }, 700);
  }, [etiquetasRows, isSupabaseEtiquetasEnabled]);

  function setAndPersistTableRows(updater: (prev: RecipeRow[]) => RecipeRow[]) {
    setTableRows((prev) => {
      const next = updater(prev);
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

  function formatPercent1(value: number) {
    return value.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  function buildCmvDeltaLabel(cmvAtual: number, cmvMeta: number) {
    const diff = cmvAtual - cmvMeta;
    const abs = Math.abs(diff);
    const suffix = diff > 0 ? "Maior" : diff < 0 ? "Menor" : "Igual";
    return `${formatPercent1(abs)}% ${suffix}`;
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
    setDetailsRecipe({
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

  const pageSize = 12;
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

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
      receita: "minmax(280px, 2.3fr)",
      precoVenda: "minmax(120px, 0.9fr)",
      custoUnitario: "minmax(120px, 0.9fr)",
      cmvMeta: "minmax(92px, 0.7fr)",
      cmvAtual: "minmax(110px, 0.8fr)",
      bcg: "minmax(150px, 1fr)",
      acoes: "88px",
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

  const ingredientOptions = useMemo(() => insumos.filter((row) => !row.ocultar), [insumos]);
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
      out.set(id, Math.round(c / q));
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
    const unitCents = avgUnitCostCentsById.get(selectedIngredient.id) ?? Math.round(parseMoneyLabel(selectedIngredient.custoMedio) * 100);
    return (parseDecimalInput(ingredientQty) * unitCents) / 100;
  }, [avgUnitCostCentsById, ingredientQty, selectedIngredient]);
  const detailIngredientCost = useMemo(() => {
    if (!selectedDetailIngredient) return 0;
    const unitCents = avgUnitCostCentsById.get(selectedDetailIngredient.id) ?? Math.round(parseMoneyLabel(selectedDetailIngredient.custoMedio) * 100);
    return (parseDecimalInput(detailIngredientQty) * unitCents) / 100;
  }, [avgUnitCostCentsById, detailIngredientQty, selectedDetailIngredient]);
  const rowEditCost = useMemo(() => {
    if (!selectedRowEditIngredient) return 0;
    const unitCents = avgUnitCostCentsById.get(selectedRowEditIngredient.id) ?? Math.round(parseMoneyLabel(selectedRowEditIngredient.custoMedio) * 100);
    return (parseDecimalInput(rowEditQty) * unitCents) / 100;
  }, [avgUnitCostCentsById, rowEditQty, selectedRowEditIngredient]);
  const ingredientsTotal = useMemo(() => ingredientRows.reduce((sum, row) => sum + row.custoTotal, 0), [ingredientRows]);
  const priceValue = useMemo(() => parseDecimalInput(precoVenda), [precoVenda]);
  const cmvMetaValue = useMemo(() => parseDecimalInput(cmvMetaDraft), [cmvMetaDraft]);
  const recipeYieldValue = useMemo(() => parseDecimalInput(recipeYield), [recipeYield]);
  const createMetrics = useMemo(() => calcRecipeMetrics(ingredientsTotal, recipeYieldValue, priceValue, cmvMetaValue), [cmvMetaValue, ingredientsTotal, priceValue, recipeYieldValue]);
  const cmvAtualValue = createMetrics.cmvAtual;
  const cmvAbaixoMeta = cmvAtualValue <= cmvMetaValue;
  const canGoStep1 = recipeName.trim().length > 0;
  const canGoStep2 = ingredientRows.length > 0 && parseDecimalInput(recipeYield) > 0;
  const detailsEtiquetas = useMemo(() => {
    if (!detailsRecipe) return [];
    return etiquetasRows.filter((e) => e.recipeId === detailsRecipe.rowId);
  }, [detailsRecipe, etiquetasRows]);

  function openEtiquetaModal() {
    if (!detailsRecipe) return;
    setEtiquetaResponsavel("");
    setEtiquetaQtd("1,000");
    setEtiquetaUnidade("Porção");
    const now = new Date();
    setEtiquetaDataProd(formatDateLabel(now));
    setEtiquetaDataVal(formatDateLabel(addDays(now, 1)));
    setIsEtiquetaOpen(true);
  }

  function confirmSaveEtiqueta() {
    if (!detailsRecipe) return;
    const responsavel = etiquetaResponsavel.trim();
    const quantidade = formatDecimalFixedDraft(etiquetaQtd, 3);
    const unidade = etiquetaUnidade.trim() || "Porção";
    if (!responsavel) {
      showToast("Informe o responsável.", "error");
      return;
    }
    const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? (crypto as any).randomUUID() : String(Date.now());
    const next: FichaTecnicaEtiquetaRow = {
      id,
      recipeId: detailsRecipe.rowId,
      receita: detailsRecipe.recipeName,
      responsavel,
      quantidade,
      unidade,
      dataProducao: etiquetaDataProd.trim(),
      dataValidade: etiquetaDataVal.trim(),
    };
    setEtiquetasRows((prev) => [next, ...prev]);
    setIsEtiquetaOpen(false);
    showToast("Etiqueta criada.", "success");
  }

  function renderTableCell(row: RecipeRow, column: FichaTableColumn) {
    if (column === "receita") {
      return (
        <div className={styles.recipeCell}>
          <RecipeThumb type={row.thumb} />
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
    const bcg: BcgType = popularidade === "alta" ? "estrela" : "abacaxi";
    const cmvAtualLabel = `${formatPercent1(metrics.cmvAtual)}%`;
    const cmvMetaLabel = `${cmvMetaValue.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
    const custoUnitarioLabel = formatMoney(metrics.custoPorPorcao);
    const precoSugeridoLabel = metrics.precoSugerido > 0 ? formatMoney(metrics.precoSugerido) : undefined;
    setAndPersistTableRows((prev) => [
      {
        id,
        receita: recipeName.trim() || "Sem nome",
        precoVenda: formatMoney(priceValue),
        precoVendaSub: precoSugeridoLabel,
        custoUnitario: custoUnitarioLabel,
        cmvMeta: cmvMetaLabel,
        cmvAtual: cmvAtualLabel,
        cmvDelta: buildCmvDeltaLabel(metrics.cmvAtual, cmvMetaValue),
        bcg,
        thumb: "burger",
      },
      ...prev,
    ]);
    setDetailsRecipe({
      rowId: id,
      recipeName: recipeName.trim() || "Sem nome",
      recipeImage,
      popularidade,
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
    setDetailsRecipe({
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
    setDetailsRecipe({
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
    setDetailsRecipe({
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
    setDetailsRecipe({
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
      popularidade: row.bcg === "estrela" || row.bcg === "cavalo" ? "Alta" : "Baixa",
      custoUnitario: parseMoneyLabel(row.custoUnitario),
    });
    setActionMenuRowId(null);
  }

  function closeEditModal() {
    setEditDraft(null);
  }

  function openDeleteModal(row: RecipeRow) {
    setDeleteRow(row);
    setActionMenuRowId(null);
  }

  function closeDeleteModal() {
    setDeleteRow(null);
  }

  function removeTableRow(rowId: string) {
    setAndPersistTableRows((prev) => prev.filter((row) => row.id !== rowId));
    setActionMenuRowId(null);
  }

  function saveEditedRow() {
    if (!editDraft) return;
    const precoVendaValue = parseDecimalInput(editDraft.precoVenda);
    const cmvMetaValue = parseDecimalInput(editDraft.cmvMeta);
    const bcgFromPopularity: BcgType = editDraft.popularidade === "Alta" ? "estrela" : "abacaxi";
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
              bcg: bcgFromPopularity,
            }
          : row
      )
    );
    setEditDraft(null);
  }

  function buildDetailsRecipeFromRow(row: RecipeRow): SavedRecipeDetails {
    const precoVendaValue = parseMoneyLabel(row.precoVenda);
    const custoUnitarioValue = parseMoneyLabel(row.custoUnitario);
    const cmvMetaRow = parseDecimalInput(String(row.cmvMeta).replace(/[^\d,.-]/g, ""));
    const cmvAtualRow = parseDecimalInput(String(row.cmvAtual).replace(/[^\d,.-]/g, ""));

    return {
      rowId: row.id,
      recipeName: row.receita,
      recipeImage: "",
      popularidade: row.bcg === "estrela" || row.bcg === "cavalo" ? "alta" : "baixa",
      precoVenda: precoVendaValue,
      cmvMeta: cmvMetaRow,
      cmvAtual: cmvAtualRow,
      ingredientsTotal: custoUnitarioValue,
      recipeYield: 1,
      ingredientRows: [
        {
          id: `${row.id}-base`,
          ingredientId: "",
          item: row.receita,
          quantidade: "1",
          unidade: "Und",
          custoTotal: custoUnitarioValue,
        },
      ],
      modoPreparo: "",
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
        previewSrc: recipe.recipeImage,
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
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch {
      if (previewTab) {
        previewTab.document.title = "Erro ao gerar PDF";
        previewTab.document.body.innerText = "Não foi possível gerar o PDF da ficha técnica. Tente novamente.";
      }
      window.alert("Não foi possível gerar o PDF da ficha técnica. Tente novamente.");
    }
  }

  return (
    <>
      <div className={dash.dashboard}>
        <AppSidebar active="fichas-tecnicas" />
        {toast ? <SystemToast title={toast.title} message={toast.message} tone={toast.tone} onClose={() => setToast(null)} /> : null}
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
                    <button
                      type="button"
                      className={detailsViewTab === "etiquetas" ? `${dash.itemTabActive} ${styles.detailsTabActive}` : `${dash.itemTab} ${styles.detailsTab}`}
                      onClick={() => setDetailsViewTab("etiquetas")}
                    >
                      Etiquetas
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
                              {ingredientOptions.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.item}
                                </option>
                              ))}
                            </select>
                          </label>

                          <span className={styles.detailsInlineGroup}>
                            <input
                              type="text"
                              className={styles.detailsInlineInput}
                              value={detailIngredientQty}
                              inputMode="decimal"
                              onMouseDown={(e) => {
                                if (document.activeElement !== e.currentTarget) {
                                  e.preventDefault();
                                  e.currentTarget.focus();
                                  e.currentTarget.select();
                                }
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
                                  {ingredientOptions.map((item) => (
                                    <option key={item.id} value={item.id}>
                                      {item.item}
                                    </option>
                                  ))}
                                </select>
                              </label>

                              <span className={styles.detailsInlineGroup}>
                                <input
                                  type="text"
                                  className={styles.detailsInlineInput}
                                  value={rowEditQty}
                                  inputMode="decimal"
                                  onMouseDown={(e) => {
                                    if (document.activeElement !== e.currentTarget) {
                                      e.preventDefault();
                                      e.currentTarget.focus();
                                      e.currentTarget.select();
                                    }
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
                              value={detailsYieldDraft}
                              onMouseDown={(e) => {
                                if (document.activeElement !== e.currentTarget) {
                                  e.preventDefault();
                                  e.currentTarget.focus();
                                  e.currentTarget.select();
                                }
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
                  ) : (
                    <div className={`${dash.itemDetailsBody} ${styles.detailsPanel}`}>
                      <div className={styles.detailsEtiquetasHeader}>
                        <div className={styles.detailsSectionTitle}>{`Etiquetas (${detailsEtiquetas.length})`}</div>
                        <button type="button" className={styles.detailsEtiquetaBtn} onClick={openEtiquetaModal}>
                          Nova Etiqueta
                        </button>
                      </div>
                      {detailsEtiquetas.length ? (
                        <div className={styles.detailsEtiquetasList}>
                          {detailsEtiquetas.map((e) => (
                            <div key={e.id} className={styles.detailsEtiquetaRow}>
                              <div>
                                <div className={styles.detailsEtiquetaTitle}>{e.responsavel || "-"}</div>
                                <div className={styles.detailsEtiquetaMeta}>{e.receita || detailsRecipe.recipeName}</div>
                              </div>
                              <div>
                                <div className={styles.detailsEtiquetaTitle}>{`${e.quantidade || "-"} ${e.unidade || ""}`}</div>
                                <div className={styles.detailsEtiquetaMeta}>{`Produção: ${e.dataProducao || "-"}`}</div>
                              </div>
                              <div>
                                <div className={styles.detailsEtiquetaTitle}>{e.dataValidade || "-"}</div>
                                <div className={styles.detailsEtiquetaMeta}>Validade</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className={styles.detailsEtiquetasEmpty}>Ops... Nada aqui!</div>
                      )}
                    </div>
                  )}
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

            <button type="button" className={styles.newButton} onClick={openCreateModal}>
              <PlusIcon />
              Nova Ficha Técnica
            </button>
          </section>

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
                <button type="button" className={styles.newButton} onClick={openCreateModal}>
                  <PlusIcon />
                  Nova Ficha Técnica
                </button>
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

              <section className={styles.tableCard} style={{ position: "relative" }}>
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

                <div className={styles.tableBody}>
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
                          onClick={() => setActionMenuRowId((prev) => (prev === row.id ? null : row.id))}
                        >
                          <DotsIcon />
                        </button>
                        {actionMenuRowId === row.id ? (
                          <div className={styles.actionMenu}>
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
                          </div>
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
      </div>

      {isEtiquetaOpen && detailsRecipe ? (
        <div className={styles.modalOverlay} role="presentation" onClick={() => setIsEtiquetaOpen(false)}>
          <div className={styles.modalCard} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Nova Etiqueta</h2>
              <button type="button" className={styles.modalClose} aria-label="Fechar" onClick={() => setIsEtiquetaOpen(false)}>
                ×
              </button>
            </div>

            <div className={styles.modalBody}>
              <div className={styles.formBlock}>
                <label className={styles.fieldBlock}>
                  <span className={styles.fieldLabel}>Responsável</span>
                  <input
                    type="text"
                    className={styles.textInput}
                    placeholder="Digite o nome..."
                    value={etiquetaResponsavel}
                    onChange={(e) => setEtiquetaResponsavel(e.target.value)}
                  />
                </label>

                <div className={styles.formGrid}>
                  <label className={styles.fieldBlock}>
                    <span className={styles.fieldLabel}>Quantidade</span>
                    <input
                      type="text"
                      className={styles.textInput}
                      value={etiquetaQtd}
                      inputMode="decimal"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.currentTarget.focus();
                        e.currentTarget.select();
                      }}
                      onChange={(e) => setEtiquetaQtd(formatDecimalDraft(e.target.value, 3))}
                      onBlur={(e) => setEtiquetaQtd(formatDecimalFixedDraft(e.target.value, 3))}
                    />
                  </label>
                  <label className={styles.fieldBlock}>
                    <span className={styles.fieldLabel}>Unidade</span>
                    <input
                      type="text"
                      className={styles.textInput}
                      value={etiquetaUnidade}
                      onChange={(e) => setEtiquetaUnidade(e.target.value)}
                    />
                  </label>
                </div>

                <div className={styles.formGrid}>
                  <label className={styles.fieldBlock}>
                    <span className={styles.fieldLabel}>Data Produção</span>
                    <input type="text" className={styles.textInput} value={etiquetaDataProd} onChange={(e) => setEtiquetaDataProd(e.target.value)} />
                  </label>
                  <label className={styles.fieldBlock}>
                    <span className={styles.fieldLabel}>Data Validade</span>
                    <input type="text" className={styles.textInput} value={etiquetaDataVal} onChange={(e) => setEtiquetaDataVal(e.target.value)} />
                  </label>
                </div>
              </div>
            </div>

            <div className={styles.modalFooter}>
              <button type="button" className={styles.cancelBtn} onClick={() => setIsEtiquetaOpen(false)}>
                Cancelar
              </button>
              <button type="button" className={`${styles.nextBtn} ${styles.nextBtnActive}`} onClick={confirmSaveEtiqueta}>
                Salvar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isCreateOpen ? (
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
                          {ingredientOptions.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.item}
                            </option>
                          ))}
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
        </div>
      ) : null}

      {editDraft ? (
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
        </div>
      ) : null}

      {deleteRow ? (
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
        </div>
      ) : null}
    </>
  );
}
