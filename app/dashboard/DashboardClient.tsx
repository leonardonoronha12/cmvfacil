"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./dashboard.module.css";
import AppSidebar from "../components/AppSidebar";
import { readInsumosFromStore, subscribeInsumos, type InsumoStoreItem, writeInsumosToStore } from "../lib/insumosStore";
import { loadInsumosFromSupabase, syncInsumosToSupabase } from "../lib/insumosSupabase";
import { loadFornecedoresStateFromSupabase } from "../lib/fornecedoresSupabase";
import { readInventarioFromStore, subscribeInventario, type InventarioContagem, writeInventarioToStore } from "../lib/inventarioStore";
import { loadInventarioFromSupabase } from "../lib/inventarioSupabase";
import { readEntradasFromStore, subscribeEntradas, type EntradaStoreRow, writeEntradasToStore } from "../lib/entradasStore";
import { loadEntradasFromSupabase } from "../lib/entradasSupabase";
import { readDesperdiciosFromStore, subscribeDesperdicios, type DesperdicioRow, writeDesperdiciosToStore } from "../lib/desperdiciosStore";
import { loadDesperdiciosFromSupabase } from "../lib/desperdiciosSupabase";
import { readPrePreparoEtiquetasFromStore, subscribePrePreparoEtiquetas, type PrePreparoEtiquetaRow, writePrePreparoEtiquetasToStore } from "../lib/prePreparoEtiquetasStore";
import { buildExpiredPrePreparoEtiquetaDesperdicios } from "../lib/prePreparoEtiquetasToDesperdicios";
import { loadPrePreparoEtiquetasFromSupabase } from "../lib/prePreparoEtiquetasSupabase";
import { readDashboardCmvPrefsFromStore, writeDashboardCmvPrefsToStore } from "../lib/dashboardCmvPrefsStore";
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
  type FornecedorInfoMap,
  type FornecedorProdutos,
} from "../lib/fornecedoresStore";

type Row = {
  index: number;
  insumoId: string;
  item: string;
  categoria: string;
  initial: string;
  entradas: string;
  final: string;
  saidas: string;
  custo: string;
  cmv: string;
  cmvTone: "red" | "yellow" | "green";
};

type DashboardTableColumn = "item" | "initial" | "entradas" | "final" | "saidas" | "custo" | "cmv";

type PieSlice = {
  label: string;
  value: number;
  color: string;
};

const toneColors = {
  green: "#0ab86d",
  greenDark: "#059e5d",
  red: "#ff2f54",
  yellow: "#fbbf24",
  blue: "#3b82f6",
  purple: "#a855f7",
  pink: "#ec4899",
  mint: "#14b8a6",
  lime: "#84cc16",
  orange: "#f97316",
} as const;

const legendItems = [
  { label: "Revenda", tone: "green" },
  { label: "Limpeza", tone: "greenDark" },
  { label: "Hortifruti", tone: "red" },
  { label: "Matéria Prima", tone: "yellow" },
  { label: "Embalagens", tone: "blue" },
  { label: "Laticínios", tone: "purple" },
  { label: "Uso interno", tone: "mint" },
  { label: "Pizza", tone: "pink" },
  { label: "Pré-Preparo", tone: "lime" },
  { label: "Temperos", tone: "orange" },
] as const;

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function fmt(n: number) {
  return Number(n.toFixed(6));
}

function donutPath(cx: number, cy: number, rOuter: number, rInner: number, startAngle: number, endAngle: number) {
  const startOuter = polarToCartesian(cx, cy, rOuter, startAngle);
  const endOuter = polarToCartesian(cx, cy, rOuter, endAngle);
  const startInner = polarToCartesian(cx, cy, rInner, endAngle);
  const endInner = polarToCartesian(cx, cy, rInner, startAngle);

  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return [
    `M ${fmt(startOuter.x)} ${fmt(startOuter.y)}`,
    `A ${fmt(rOuter)} ${fmt(rOuter)} 0 ${largeArc} 1 ${fmt(endOuter.x)} ${fmt(endOuter.y)}`,
    `L ${fmt(startInner.x)} ${fmt(startInner.y)}`,
    `A ${fmt(rInner)} ${fmt(rInner)} 0 ${largeArc} 0 ${fmt(endInner.x)} ${fmt(endInner.y)}`,
    "Z",
  ].join(" ");
}

function PieChart({ slices, size = 220 }: { slices: PieSlice[]; size?: number }) {
  const validSlices = slices.filter((slice) => slice.value > 0);
  if (!validSlices.length) return null;
  const view = 240;
  const cx = view / 2;
  const cy = view / 2;
  const rOuter = 92;
  const rInner = 44;
  const total = validSlices.reduce((acc, s) => acc + s.value, 0) || 1;

  let start = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${view} ${view}`} role="img" aria-label="Distribuição por categoria">
      <g>
        {validSlices.map((s) => {
          const sweep = (s.value / total) * 360;
          const end = start + sweep;
          const d = donutPath(cx, cy, rOuter, rInner, start, end);
          start = end;
          const pct = (s.value / total) * 100;
          return (
            <path key={s.label} d={d} fill={s.color} stroke="#f1f3f3" strokeWidth="2">
              <title>{`${s.label}: ${formatBrlFromCents(s.value)} (${pct.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%)`}</title>
            </path>
          );
        })}
      </g>
      <circle cx={cx} cy={cy} r={rInner} fill="#f1f3f3" />
    </svg>
  );
}

function SortMark({ dir }: { dir: "asc" | "desc" }) {
  return <span>{dir === "asc" ? "^" : "v"}</span>;
}

function IconCubeOutline() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3.75L19.125 7.875V16.125L12 20.25L4.875 16.125V7.875L12 3.75Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M12 12L19.125 7.875" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M12 12L4.875 7.875" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M12 12V20.25" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function IconBasketOutline() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5.25 9.75H18.75L17.625 18.75H6.375L5.25 9.75Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M8.25 9.75L12 5.25L15.75 9.75" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.75 12.75V15.75" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M14.25 12.75V15.75" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function IconBoxOutline() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3.75L18.75 7.125V16.875L12 20.25L5.25 16.875V7.125L12 3.75Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M5.625 7.3125L12 10.5L18.375 7.3125" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M12 10.5V20.25" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function IconArrowDownOutline() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4.5V16.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M7.5 12.75L12 17.25L16.5 12.75" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconCalendarSmall() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6.75 4.5H17.25V19.5H6.75V4.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M12 8.25V14.25" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M9.75 12L12 14.25L14.25 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconMoneySmall() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <ellipse cx="10" cy="7.25" rx="5.25" ry="2.75" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4.75 7.25V10.75C4.75 12.2688 7.10051 13.5 10 13.5C12.8995 13.5 15.25 12.2688 15.25 10.75V7.25" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M7 12.9V15.1C7 16.4255 9.01522 17.5 11.5 17.5C13.9848 17.5 16 16.4255 16 15.1V11.9" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <ellipse cx="11.5" cy="15.1" rx="4.5" ry="2.4" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function IconTargetSmall() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="7.25" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 4V2.75" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M20 12H21.25" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconInfoSmall() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.25" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 10V16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="7.5" r="1" fill="currentColor" />
    </svg>
  );
}

function IconSparkSmall() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4.5L13.8 8.2L17.5 10L13.8 11.8L12 15.5L10.2 11.8L6.5 10L10.2 8.2L12 4.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function IconSidebarChart() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3.75C16.5563 3.75 20.25 7.44365 20.25 12C20.25 16.5563 16.5563 20.25 12 20.25" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M12 3.75V12L6.2 17.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 20.25C7.44365 20.25 3.75 16.5563 3.75 12C3.75 8.84027 5.52741 6.09574 8.13604 4.71624" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function IconSidebarChecklist() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M10.5 7.5H18.75" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M10.5 12H18.75" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M10.5 16.5H18.75" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M5.25 7.5L6.75 9L8.75 6.75" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.25 12L6.75 13.5L8.75 11.25" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.25 16.5L6.75 18L8.75 15.75" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconSidebarClipboard() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8.25 5.25H15.75V20.25H8.25V5.25Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M9.75 3.75H14.25V6H9.75V3.75Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M10.5 10.5H13.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M10.5 14.25H13.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function IconSidebarCube() {
  return <IconCubeOutline />;
}

function IconSidebarBowl() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5.25 11.25H18.75C18.4 15.3912 15.1455 18.75 11.9999 18.75C8.85452 18.75 5.6 15.3912 5.25 11.25Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M7.5 11.25C7.5 8.76472 9.51472 6.75 12 6.75C14.4853 6.75 16.5 8.76472 16.5 11.25" stroke="currentColor" strokeWidth="1.7" />
      <path d="M14.25 5.25C13.5 5.25 12.75 5.625 12.375 6.375" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function IconSidebarStore() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4.5 9.75H19.5V18.75H4.5V9.75Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M6 5.25H18L19.5 9.75H4.5L6 5.25Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M9 13.5H15" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function IconSidebarBasket() {
  return <IconBasketOutline />;
}

function IconSidebarLayers() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4.5L20.25 9L12 13.5L3.75 9L12 4.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M5.25 12.75L12 16.5L18.75 12.75" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.25 16.5L12 20.25L18.75 16.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconSidebarCookie() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M14.25 4.5C14.25 6.98528 16.2647 9 18.75 9C19.1642 9 19.5 9.33579 19.5 9.75C19.5 14.7206 15.4706 18.75 10.5 18.75C5.52944 18.75 1.5 14.7206 1.5 9.75C1.5 4.77944 5.52944 0.75 10.5 0.75C10.9142 0.75 11.25 1.08579 11.25 1.5C11.25 3.15685 12.5931 4.5 14.25 4.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <circle cx="7.5" cy="8.25" r="1" fill="currentColor" />
      <circle cx="8.25" cy="13.5" r="1" fill="currentColor" />
      <circle cx="12.75" cy="10.5" r="1" fill="currentColor" />
    </svg>
  );
}

function IconSidebarGear() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 9.25C10.4812 9.25 9.25 10.4812 9.25 12C9.25 13.5188 10.4812 14.75 12 14.75C13.5188 14.75 14.75 13.5188 14.75 12C14.75 10.4812 13.5188 9.25 12 9.25Z" stroke="currentColor" strokeWidth="1.7" />
      <path d="M19.5 13.25V10.75L17.4808 10.2115C17.3138 9.61231 17.0748 9.04155 16.7721 8.51022L17.8205 6.69231L16.0577 4.92949L14.2398 5.97788C13.7085 5.67524 13.1377 5.43619 12.5385 5.26923L12 3.25H9.5L8.96154 5.26923C8.36231 5.43619 7.79155 5.67524 7.26022 5.97788L5.44231 4.92949L3.67949 6.69231L4.72788 8.51022C4.42524 9.04155 4.18619 9.61231 4.01923 10.2115L2 10.75V13.25L4.01923 13.7885C4.18619 14.3877 4.42524 14.9585 4.72788 15.4898L3.67949 17.3077L5.44231 19.0705L7.26022 18.0221C7.79155 18.3248 8.36231 18.5638 8.96154 18.7308L9.5 20.75H12L12.5385 18.7308C13.1377 18.5638 13.7085 18.3248 14.2398 18.0221L16.0577 19.0705L17.8205 17.3077L16.7721 15.4898C17.0748 14.9585 17.3138 14.3877 17.4808 13.7885L19.5 13.25Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function IconSidebarChat() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7.5 18.75L4.5 21V18.75C3.25736 18.75 2.25 17.7426 2.25 16.5V7.5C2.25 6.25736 3.25736 5.25 4.5 5.25H19.5C20.7426 5.25 21.75 6.25736 21.75 7.5V16.5C21.75 17.7426 20.7426 18.75 19.5 18.75H7.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <circle cx="8.25" cy="12" r="1" fill="currentColor" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
      <circle cx="15.75" cy="12" r="1" fill="currentColor" />
    </svg>
  );
}

function IconAlertHide() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9.25" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8.5 8.5L15.5 15.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M15.5 8.5L8.5 15.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconAlertShow() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9.25" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8.5 12L11 14.5L15.5 9.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
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

function IconCheck() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20.3 6.7 9 18 3.7 12.7l1.4-1.4L9 15.2l9.9-9.9 1.4 1.4Z" fill="currentColor" />
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

function IconTrash() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4.5 7.5H19.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M9.75 3.75H14.25" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M6.75 7.5L7.5 18.75H16.5L17.25 7.5" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M10 10.5V15.75" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M14 10.5V15.75" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function IconBurgerBadge() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5.25 10.5C5.7 7.63604 8.43351 5.5 12 5.5C15.5665 5.5 18.3 7.63604 18.75 10.5H5.25Z" stroke="#111111" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.5 13.5H19.5" stroke="#111111" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M6.75 16.5H17.25C16.45 18.1 14.6 19.25 12 19.25C9.4 19.25 7.55 18.1 6.75 16.5Z" stroke="#111111" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.25 9H8.265" stroke="#111111" strokeWidth="2" strokeLinecap="round" />
      <path d="M11.25 8.25H11.265" stroke="#111111" strokeWidth="2" strokeLinecap="round" />
      <path d="M14.25 9H14.265" stroke="#111111" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

type LastCalc = {
  startIso: string;
  endIso: string;
  cmvPercent: number;
  revenueCents: number;
  computedAt: number;
};

const LAST_CALC_KEY = "cmvfacil.cmvreal.lastcalc.v1";

function readLastCalc(): LastCalc | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LAST_CALC_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastCalc>;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.startIso !== "string") return null;
    if (typeof parsed.endIso !== "string") return null;
    if (typeof parsed.cmvPercent !== "number" || !Number.isFinite(parsed.cmvPercent)) return null;
    if (typeof parsed.revenueCents !== "number" || !Number.isFinite(parsed.revenueCents)) return null;
    if (typeof parsed.computedAt !== "number" || !Number.isFinite(parsed.computedAt)) return null;
    return parsed as LastCalc;
  } catch {
    return null;
  }
}

function writeLastCalc(next: LastCalc) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_CALC_KEY, JSON.stringify(next));
  } catch {}
}

function normalizeKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
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

function formatBrlInput(input: string) {
  const cleaned = input.replace(/[^\d,.-]/g, "").trim();
  if (!cleaned) return "";
  return formatBrlFromCents(parseBrlToCents(cleaned));
}

function formatPercentInput(input: string) {
  const cleaned = input.replace(/[^\d,]/g, "").trim();
  if (!cleaned) return "";
  const value = parsePtNumber(cleaned);
  if (!Number.isFinite(value) || value <= 0) return "";
  const clamped = Math.min(99, value);
  return `${clamped.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function placeCaretBeforeCurrencyDecimals(input: HTMLInputElement | null) {
  if (!input) return;
  window.requestAnimationFrame(() => {
    const commaIndex = input.value.lastIndexOf(",");
    const pos = commaIndex >= 0 ? commaIndex : input.value.length;
    input.setSelectionRange(pos, pos);
  });
}

function placeCaretBeforePercentDecimals(input: HTMLInputElement | null) {
  if (!input) return;
  window.requestAnimationFrame(() => {
    const commaIndex = input.value.lastIndexOf(",");
    const percentIndex = input.value.lastIndexOf("%");
    const pos = commaIndex >= 0 ? commaIndex : percentIndex >= 0 ? percentIndex : input.value.length;
    input.setSelectionRange(pos, pos);
  });
}

function parseDateDDMMYYYY(value: string) {
  const raw = value.trim();
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

function toIsoDate(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
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

function formatQty(qty: number, unit: string) {
  const u = (unit || "").trim() || "Und";
  const abs = Math.abs(qty);
  const decimals = u.toLowerCase() === "kg" ? 3 : u.toLowerCase() === "l" ? 2 : 0;
  const v = Number.isFinite(qty) ? qty : 0;
  const label = abs === 0 ? "0" : v.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${label}${u}`;
}

function formatPercent1(value: number) {
  const v = Number.isFinite(value) ? value : 0;
  return `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function normalizeCategoryName(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export default function DashboardClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [startDate, setStartDate] = useState(() => readDashboardCmvPrefsFromStore().startDate);
  const [endDate, setEndDate] = useState(() => readDashboardCmvPrefsFromStore().endDate);
  const [revenue, setRevenue] = useState(() => readDashboardCmvPrefsFromStore().revenue);
  const [targetCmv, setTargetCmv] = useState(() => readDashboardCmvPrefsFromStore().targetCmv);
  const [insumos, setInsumos] = useState<InsumoStoreItem[]>([]);
  const [contagens, setContagens] = useState<InventarioContagem[]>([]);
  const [entradas, setEntradas] = useState<EntradaStoreRow[]>([]);
  const [desperdicios, setDesperdicios] = useState<DesperdicioRow[]>([]);
  const [prePreparoEtiquetas, setPrePreparoEtiquetas] = useState<PrePreparoEtiquetaRow[]>([]);
  const [tableQuery, setTableQuery] = useState("");
  const [tableCategoria, setTableCategoria] = useState("todas");
  const [tableColumnOrder, setTableColumnOrder] = useState<DashboardTableColumn[]>(["item", "initial", "entradas", "final", "saidas", "custo", "cmv"]);
  const [draggingTableColumn, setDraggingTableColumn] = useState<DashboardTableColumn | null>(null);
  const [tableSortKey, setTableSortKey] = useState<DashboardTableColumn | null>(null);
  const [tableSortDir, setTableSortDir] = useState<"asc" | "desc">("asc");
  const [isVariacaoOpen, setIsVariacaoOpen] = useState(false);
  const [lastCalc, setLastCalc] = useState<LastCalc | null>(null);
  const [calcError, setCalcError] = useState<string>("");
  const [historyItem, setHistoryItem] = useState<{ insumoId: string; item: string } | null>(null);
  const [detailsTab, setDetailsTab] = useState<"entradas" | "fornecedores">("entradas");
  const [hideAlert, setHideAlert] = useState<{ item: string; tone: "hide" | "show" } | null>(null);
  const [isItemMenuOpen, setIsItemMenuOpen] = useState(false);
  const [isEditItemOpen, setIsEditItemOpen] = useState(false);
  const [isDeleteItemOpen, setIsDeleteItemOpen] = useState(false);
  const [editItemName, setEditItemName] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editSpec, setEditSpec] = useState("");
  const [editUnit, setEditUnit] = useState("");
  const [editInitialCost, setEditInitialCost] = useState("");
  const [isCategoriesOpen, setIsCategoriesOpen] = useState(false);
  const [categoryNewDraft, setCategoryNewDraft] = useState("");
  const [extraCategories, setExtraCategories] = useState<string[]>([]);
  const [editingCategoryOriginal, setEditingCategoryOriginal] = useState<string | null>(null);
  const [editingCategoryDraft, setEditingCategoryDraft] = useState("");
  const [isDeleteCategoryOpen, setIsDeleteCategoryOpen] = useState(false);
  const [deletingCategoryName, setDeletingCategoryName] = useState("");
  const [deletingCategoryCount, setDeletingCategoryCount] = useState(0);
  const [fornecedorInfoMap, setFornecedorInfoMap] = useState<FornecedorInfoMap>({});
  const [fornecedorProdutosMap, setFornecedorProdutosMap] = useState<FornecedorProdutos>({});
  const [fornecedorEquivalenciasMap, setFornecedorEquivalenciasMap] = useState<FornecedorEquivalenciasMap>({});
  const [isFornecedorModalOpen, setIsFornecedorModalOpen] = useState(false);
  const [fornecedorModalKey, setFornecedorModalKey] = useState("");
  const [fornecedorModalLabel, setFornecedorModalLabel] = useState("");
  const [fornecedorModalVendedor, setFornecedorModalVendedor] = useState("");
  const [fornecedorModalEndereco, setFornecedorModalEndereco] = useState("");
  const [fornecedorProdutoQuery, setFornecedorProdutoQuery] = useState("");
  const [isFornecedorProdutoMenuOpen, setIsFornecedorProdutoMenuOpen] = useState(false);
  const historyRef = useRef<HTMLDivElement | null>(null);
  const itemMenuRef = useRef<HTMLDivElement | null>(null);
  const revenueInputRef = useRef<HTMLInputElement | null>(null);
  const targetCmvInputRef = useRef<HTMLInputElement | null>(null);
  const tableHeaderDidDragRef = useRef(false);
  const [calc, setCalc] = useState<{
    cmvPercent: number;
    deltaPp: number;
    initialCents: number;
    comprasCents: number;
    finalCents: number;
    saidasCents: number;
    revenueCents: number;
    desperdiciosCents: number;
    rows: Row[];
  } | null>(null);

  function closeHistoryPanel() {
    setHistoryItem(null);
    setDetailsTab("entradas");
    if (searchParams.get("itemId") || searchParams.get("item")) {
      router.replace(pathname, { scroll: false });
    }
  }

  useEffect(() => {
    (async () => {
      let insumosRows: InsumoStoreItem[] = [];
      try {
        const dbRows = await loadInsumosFromSupabase();
        if (dbRows.length) {
          insumosRows = dbRows;
          writeInsumosToStore(dbRows);
        }
      } catch {}

      if (!insumosRows.length) insumosRows = readInsumosFromStore();

      let infoRows: FornecedorInfoMap = {};
      let produtosRows: FornecedorProdutos = {};
      let equivalenciasRows: FornecedorEquivalenciasMap = {};
      try {
        const db = await loadFornecedoresStateFromSupabase();
        const hasDb = Object.keys(db.info).length || Object.keys(db.produtos).length || Object.keys(db.equivalencias).length;
        if (hasDb) {
          infoRows = db.info;
          produtosRows = db.produtos;
          equivalenciasRows = db.equivalencias;
        }
      } catch {}

      writeFornecedorInfoMap(infoRows);
      writeFornecedorProdutosMap(produtosRows);
      writeFornecedorEquivalenciasMap(equivalenciasRows);

      let contagensRows: InventarioContagem[] = [];
      try {
        contagensRows = await loadInventarioFromSupabase();
      } catch {}
      writeInventarioToStore(contagensRows);
      let entradasRows: EntradaStoreRow[] = [];
      try {
        const dbEntradas = await loadEntradasFromSupabase();
        if (dbEntradas.length) entradasRows = dbEntradas;
      } catch {}
      writeEntradasToStore(entradasRows);
      let desperdiciosRows: DesperdicioRow[] = [];
      try {
        desperdiciosRows = await loadDesperdiciosFromSupabase();
      } catch {}
      writeDesperdiciosToStore(desperdiciosRows);
      let etiquetasRows: PrePreparoEtiquetaRow[] = [];
      try {
        etiquetasRows = await loadPrePreparoEtiquetasFromSupabase();
      } catch {}
      writePrePreparoEtiquetasToStore(etiquetasRows);

      setInsumos(insumosRows);
      setContagens(contagensRows);
      setEntradas(entradasRows);
      setDesperdicios(desperdiciosRows);
      setPrePreparoEtiquetas(etiquetasRows);
      setFornecedorInfoMap(infoRows);
      setFornecedorProdutosMap(produtosRows);
      setFornecedorEquivalenciasMap(equivalenciasRows);
      setLastCalc(readLastCalc());
    })();
    const unsubInsumos = subscribeInsumos((rows) => setInsumos(rows));
    const unsubInv = subscribeInventario((rows) => setContagens(rows));
    const unsubEntradas = subscribeEntradas((rows) => setEntradas(rows));
    const unsubDesp = subscribeDesperdicios((rows) => setDesperdicios(rows));
    const unsubEtiquetas = subscribePrePreparoEtiquetas((rows) => setPrePreparoEtiquetas(rows));
    const unsubFornecedorInfo = subscribeFornecedorInfo((rows) => setFornecedorInfoMap(rows));
    const unsubFornecedorProdutos = subscribeFornecedorProdutos((rows) => setFornecedorProdutosMap(rows));
    const unsubFornecedorEquivalencias = subscribeFornecedorEquivalencias((rows) => setFornecedorEquivalenciasMap(rows));
    return () => {
      unsubInsumos();
      unsubInv();
      unsubEntradas();
      unsubDesp();
      unsubEtiquetas();
      unsubFornecedorInfo();
      unsubFornecedorProdutos();
      unsubFornecedorEquivalencias();
    };
  }, []);

  const desperdiciosIntegrados = useMemo(() => {
    const generated = buildExpiredPrePreparoEtiquetaDesperdicios(prePreparoEtiquetas);
    if (!generated.length) return desperdicios;
    const generatedIds = new Set(generated.map((row) => row.id));
    return [...generated, ...desperdicios.filter((row) => !generatedIds.has(row.id))];
  }, [desperdicios, prePreparoEtiquetas]);

  const fornecedorKeyLookup = useMemo(() => {
    const out = new Map<string, string>();
    for (const key of Object.keys(fornecedorEquivalenciasMap)) {
      const nk = normalizeKey(key);
      if (!nk || out.has(nk)) continue;
      out.set(nk, key);
    }
    return out;
  }, [fornecedorEquivalenciasMap]);

  function getEquivalenciasForFornecedor(fornecedor: string) {
    const k = normalizeKey(fornecedor);
    const mapped = fornecedorKeyLookup.get(k);
    return mapped ? fornecedorEquivalenciasMap[mapped] ?? [] : fornecedorEquivalenciasMap[fornecedor.trim().toUpperCase()] ?? [];
  }

  useEffect(() => {
    const itemId = searchParams.get("itemId")?.trim() ?? "";
    const itemName = searchParams.get("item")?.trim() ?? "";
    if (!itemId && !itemName) return;

    const matched =
      insumos.find((i) => i.id === itemId) ??
      insumos.find((i) => normalizeKey(i.item) === normalizeKey(itemName));

    if (!matched) return;

    setHistoryItem((prev) => {
      if (prev?.insumoId === matched.id && prev.item === matched.item) return prev;
      return { insumoId: matched.id, item: matched.item };
    });
    setDetailsTab(searchParams.get("tab") === "fornecedores" ? "fornecedores" : "entradas");
  }, [insumos, searchParams]);

  const inventoryOptions = useMemo(() => {
    const out: Array<{ iso: string; label: string; t: number }> = [];
    for (const c of contagens) {
      const hasAnyCountedItem = (c.categorias ?? []).some((cat) =>
        (cat.itens ?? []).some((it) => !Boolean((it as any).removido) && Boolean(String((it as any).estoqueFinal ?? "").trim())),
      );
      if (!hasAnyCountedItem) continue;
      const d = parseDateDDMMYYYY(c.data);
      if (!d) continue;
      const iso = toIsoDate(d);
      out.push({ iso, label: c.data, t: startOfDay(d).getTime() });
    }
    out.sort((a, b) => b.t - a.t);
    const seen = new Set<string>();
    const uniq: Array<{ iso: string; label: string; t: number }> = [];
    for (const x of out) {
      if (seen.has(x.iso)) continue;
      seen.add(x.iso);
      uniq.push(x);
    }
    return uniq;
  }, [contagens]);

  const periodOptions = useMemo(() => [...inventoryOptions].sort((a, b) => b.t - a.t), [inventoryOptions]);

  useEffect(() => {
    if (!periodOptions.length) return;
    setStartDate((prev) => (prev ? prev : periodOptions[periodOptions.length - 1]!.iso));
    setEndDate((prev) => (prev ? prev : periodOptions[0]!.iso));
  }, [periodOptions]);

  useEffect(() => {
    writeDashboardCmvPrefsToStore({ startDate, endDate, revenue, targetCmv });
  }, [endDate, revenue, startDate, targetCmv]);

  const canCalculate =
    inventoryOptions.length > 0 &&
    Boolean(startDate.trim()) &&
    Boolean(endDate.trim()) &&
    parseBrlToCents(revenue) > 0 &&
    parsePtNumber(targetCmv) >= 1 &&
    parsePtNumber(targetCmv) <= 99;

  function handleCalculate() {
    if (!canCalculate) {
      setCalcError("Preencha datas, faturamento e CMV meta para calcular.");
      return;
    }
    setCalcError("");
    const startOpt = inventoryOptions.find((o) => o.iso === startDate) ?? null;
    const endOpt = inventoryOptions.find((o) => o.iso === endDate) ?? null;
    if (!startOpt || !endOpt) {
      setCalcError("Cadastre pelo menos 2 inventários para calcular o CMV.");
      return;
    }

    const startD = parseDateDDMMYYYY(startOpt.label);
    const endD = parseDateDDMMYYYY(endOpt.label);
    if (!startD || !endD) {
      setCalcError("As datas de inventário precisam estar no formato DD/MM/AAAA.");
      return;
    }

    const startT = startOfDay(startD).getTime();
    const endT = startOfDay(endD).getTime();
    const minT = Math.min(startT, endT);
    const maxT = Math.max(startT, endT);

    const contagemStart = contagens.find((c) => c.data === startOpt.label) ?? null;
    const contagemEnd = contagens.find((c) => c.data === endOpt.label) ?? null;
    if (!contagemStart || !contagemEnd) {
      setCalcError("Não foi possível localizar os inventários selecionados.");
      return;
    }

    const initialById = new Map<string, number>();
    const finalById = new Map<string, number>();
    for (const cat of contagemStart.categorias ?? []) {
      for (const it of cat.itens ?? []) {
        if (Boolean((it as any).removido)) continue;
        initialById.set(it.id, parsePtNumber((it as any).estoqueFinal || "0"));
      }
    }
    for (const cat of contagemEnd.categorias ?? []) {
      for (const it of cat.itens ?? []) {
        if (Boolean((it as any).removido)) continue;
        finalById.set(it.id, parsePtNumber((it as any).estoqueFinal || "0"));
      }
    }

    const insumoIdByKey = new Map<string, string>();
    const ocultarByInsumoId = new Map<string, boolean>();
    for (const i of insumos) {
      ocultarByInsumoId.set(i.id, Boolean(i.ocultar));
      const key = normalizeKey(i.item);
      if (!key) continue;
      if (!insumoIdByKey.has(key)) insumoIdByKey.set(key, i.id);
    }

    const entradasQtyById = new Map<string, number>();
    const entradasCentsById = new Map<string, number>();
    let comprasCents = 0;
    for (const e of entradas) {
      const d = parseDateLabelLoose(e.dataLancamento);
      if (!d) continue;
      const t = startOfDay(d).getTime();
      if (t < minT || t > maxT) continue;

      if (e.itensNota?.length) {
        const equivalencias = getEquivalenciasForFornecedor(String(e.fornecedor ?? ""));
        for (const it of e.itensNota) {
          const rawKey = normalizeKey(it.nome);
          let mappedKey = rawKey;
          let fator = 1;
          const eq = equivalencias.find((m) => normalizeKey(m.nomeNaNota) === rawKey) ?? null;
          if (eq) {
            mappedKey = normalizeKey(eq.insumoEquivalente);
            const f = parsePtNumber(String(eq.equivalenteQuantidade ?? ""));
            if (Number.isFinite(f) && f > 0) fator = f;
          }
          const id = insumoIdByKey.get(mappedKey);
          const isHidden = id ? Boolean(ocultarByInsumoId.get(id)) : false;
          const { qty } = parseQtyLabel(it.quantidadeLabel ?? "");
          const qtyEq = qty * fator;
          if (id && !isHidden) entradasQtyById.set(id, (entradasQtyById.get(id) ?? 0) + qtyEq);

          let sub = parseBrlToCents(it.subtotalLabel ?? "");
          if (!sub) {
            const unit = parseBrlToCents(it.custoUnitarioLabel ?? "");
            if (unit && qtyEq > 0) sub = Math.round(unit * qtyEq);
          }

          if (sub && (!id || !isHidden)) comprasCents += sub;
          if (id && !isHidden && sub) entradasCentsById.set(id, (entradasCentsById.get(id) ?? 0) + sub);
        }
      } else {
        comprasCents += parseBrlToCents(e.valorNota ?? "");
      }
    }

    const computedRows: Row[] = [];
    let initialCents = 0;
    let finalCents = 0;
    let saidasCents = 0;

    const list = insumos.filter((i) => !i.ocultar).sort((a, b) => a.item.localeCompare(b.item, "pt-BR", { sensitivity: "base" }));
    for (const i of list) {
      const unit = i.medida || "Und";
      const initialQty = initialById.get(i.id) ?? 0;
      const finalQty = finalById.get(i.id) ?? 0;
      const entradasQty = entradasQtyById.get(i.id) ?? 0;
      const saidasQty = initialQty + entradasQty - finalQty;
      const custoInicialCents = parseBrlToCents(String(i.custoMedio ?? ""));
      const entradasCents = entradasCentsById.get(i.id) ?? 0;
      const initialValCents = Math.round(initialQty * custoInicialCents);
      const denomQty = initialQty + entradasQty;
      const custoMedioCents = denomQty > 0 ? Math.round((initialValCents + entradasCents) / denomQty) : custoInicialCents;
      const itemFinalCents = Math.round(finalQty * custoMedioCents);
      const itemSaidasCents = initialValCents + entradasCents - itemFinalCents;
      initialCents += initialValCents;
      finalCents += itemFinalCents;
      saidasCents += itemSaidasCents;

      const cmvTone: Row["cmvTone"] = saidasQty < 0 ? "red" : "green";

      computedRows.push({
        index: computedRows.length + 1,
        insumoId: i.id,
        item: i.item,
        categoria: i.categoria ?? "-",
        initial: formatQty(initialQty, unit),
        entradas: formatQty(entradasQty, unit),
        final: formatQty(finalQty, unit),
        saidas: formatQty(saidasQty, unit),
        custo: custoMedioCents ? formatBrlFromCents(custoMedioCents) : "-",
        cmv: custoMedioCents ? formatBrlFromCents(itemSaidasCents) : "-",
        cmvTone,
      });
    }

    const revenueCents = parseBrlToCents(revenue);
    const target = parsePtNumber(targetCmv);
    const cmvPercent = revenueCents > 0 ? (saidasCents / revenueCents) * 100 : 0;
    const deltaPp = cmvPercent - target;

    let desperdiciosCents = 0;
    for (const d of desperdiciosIntegrados) {
      const dd = parseDateLabelLoose(d.data);
      if (!dd) continue;
      const t = startOfDay(dd).getTime();
      if (t < minT || t > maxT) continue;
      desperdiciosCents += parseBrlToCents(d.custo ?? "");
    }

    const prev = readLastCalc();
    setLastCalc(prev);

    setCalc({
      cmvPercent,
      deltaPp,
      initialCents,
      comprasCents,
      finalCents,
      saidasCents,
      revenueCents,
      desperdiciosCents,
      rows: computedRows,
    });

    writeLastCalc({ startIso: startOpt.iso, endIso: endOpt.iso, cmvPercent, revenueCents, computedAt: Date.now() });
    setTableQuery("");
    setTableCategoria("todas");
    if (!searchParams.get("itemId") && !searchParams.get("item")) {
      setHistoryItem(null);
      setDetailsTab("entradas");
    }
  }

  const categorias = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const i of insumos.filter((x) => !x.ocultar)) {
      const c = String(i.categoria ?? "").trim();
      if (!c || c === "-") continue;
      const k = c.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(c);
    }
    out.sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));
    return out;
  }, [insumos]);

  const editCategories = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const c of [...categorias, ...extraCategories]) {
      const name = normalizeCategoryName(c);
      if (!name || name === "-") continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
    out.sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));
    return out;
  }, [categorias, extraCategories]);

  const categoryCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of editCategories) map.set(c, 0);
    for (const row of insumos) {
      const name = normalizeCategoryName(row.categoria ?? "");
      if (!name || name === "-") continue;
      map.set(name, (map.get(name) ?? 0) + 1);
    }
    return map;
  }, [editCategories, insumos]);

  const baseRows = useMemo(() => {
    if (calc?.rows?.length) return calc.rows;
    return [...insumos]
      .sort((a, b) => a.item.localeCompare(b.item, "pt-BR", { sensitivity: "base" }))
      .map((i, index) => {
        const unit = i.medida || "Und";
        const custoMedioCents = parseBrlToCents(String(i.custoMedio ?? ""));
        return {
          index: index + 1,
          insumoId: i.id,
          item: i.item,
          categoria: i.categoria ?? "-",
          initial: formatQty(0, unit),
          entradas: formatQty(0, unit),
          final: formatQty(0, unit),
          saidas: formatQty(0, unit),
          custo: custoMedioCents ? formatBrlFromCents(custoMedioCents) : "-",
          cmv: formatBrlFromCents(0),
          cmvTone: "green" as const,
        };
      });
  }, [calc?.rows, insumos]);

  const visibleRows = useMemo(() => {
    const base = baseRows;
    const q = tableQuery.trim().toLowerCase();
    const cat = tableCategoria.trim().toLowerCase();
    const filtered = base.filter((r) => {
      if (q && !`${r.item} ${r.categoria}`.toLowerCase().includes(q)) return false;
      if (cat && cat !== "todas" && r.categoria.toLowerCase() !== cat) return false;
      return true;
    });
    if (!tableSortKey) return filtered;

    const dir = tableSortDir === "asc" ? 1 : -1;
    const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });
    const decorated = filtered.map((row, index) => ({ row, index }));
    decorated.sort((a, b) => {
      let cmp = 0;
      switch (tableSortKey) {
        case "item":
          cmp = collator.compare(a.row.item, b.row.item);
          break;
        case "initial":
        case "entradas":
        case "final":
        case "saidas":
          cmp = parsePtNumber(a.row[tableSortKey]) - parsePtNumber(b.row[tableSortKey]);
          break;
        case "custo":
        case "cmv":
          cmp = parseBrlToCents(a.row[tableSortKey]) - parseBrlToCents(b.row[tableSortKey]);
          break;
      }
      if (!cmp) cmp = a.index - b.index;
      return cmp * dir;
    });
    return decorated.map((entry) => entry.row);
  }, [baseRows, tableCategoria, tableQuery, tableSortDir, tableSortKey]);

  function toggleTableSort(key: DashboardTableColumn) {
    if (tableSortKey !== key) {
      setTableSortKey(key);
      setTableSortDir("asc");
      return;
    }
    if (tableSortDir === "asc") {
      setTableSortDir("desc");
      return;
    }
    setTableSortKey(null);
    setTableSortDir("asc");
  }

  function beginTableColumnDrag(source: DashboardTableColumn) {
    tableHeaderDidDragRef.current = false;
    setDraggingTableColumn(source);
  }

  function moveTableColumn(source: DashboardTableColumn, target: DashboardTableColumn) {
    if (source === target) return;
    tableHeaderDidDragRef.current = true;
    setTableColumnOrder((prev) => {
      const from = prev.indexOf(source);
      const to = prev.indexOf(target);
      if (from === -1 || to === -1) return prev;
      const next = [...prev];
      next.splice(from, 1);
      next.splice(to, 0, source);
      return next;
    });
  }

  function onTableColumnDrop(target: DashboardTableColumn, event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const source = (event.dataTransfer.getData("text/plain") as DashboardTableColumn) || draggingTableColumn;
    if (!source) return;
    moveTableColumn(source, target);
    setDraggingTableColumn(null);
  }

  useEffect(() => {
    if (!draggingTableColumn) return;
    const clearDragging = () => setDraggingTableColumn(null);
    window.addEventListener("mouseup", clearDragging);
    window.addEventListener("dragend", clearDragging);
    return () => {
      window.removeEventListener("mouseup", clearDragging);
      window.removeEventListener("dragend", clearDragging);
    };
  }, [draggingTableColumn]);

  const tableGridTemplateColumns = useMemo(() => {
    const widths: Record<DashboardTableColumn, string> = {
      item: "minmax(220px, 1.8fr)",
      initial: "110px",
      entradas: "110px",
      final: "110px",
      saidas: "110px",
      custo: "110px",
      cmv: "110px",
    };
    return tableColumnOrder.map((column) => widths[column]).join(" ");
  }, [tableColumnOrder]);

  function renderDashboardCell(row: Row, column: DashboardTableColumn) {
    if (column === "item") {
      return (
        <div className={styles.rowGroup}>
          <div
            className={styles.rowItem}
            role="button"
            tabIndex={0}
            onClick={() => {
              setHistoryItem({ insumoId: row.insumoId, item: row.item });
              setDetailsTab("entradas");
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              setHistoryItem({ insumoId: row.insumoId, item: row.item });
              setDetailsTab("entradas");
            }}
          >
            <button
              type="button"
              className={styles.rowItemBtn}
              onClick={() => {
                setHistoryItem({ insumoId: row.insumoId, item: row.item });
                setDetailsTab("entradas");
              }}
            >
              {row.item}
            </button>
          </div>
        </div>
      );
    }

    if (column === "saidas") {
      return <div className={row.cmvTone === "red" ? styles.rowCmvRed : styles.rowCellBold}>{row.saidas}</div>;
    }

    if (column === "custo") {
      return <div className={styles.rowCellBold}>{row.custo}</div>;
    }

    if (column === "cmv") {
      return <div className={row.cmvTone === "red" ? styles.rowCmvRed : row.cmvTone === "yellow" ? styles.rowCmvYellow : styles.rowCmvGreen}>{row.cmv}</div>;
    }

    return <div className={styles.rowCell}>{row[column]}</div>;
  }

  const cmvLabel = useMemo(() => {
    return formatPercent1(calc?.cmvPercent ?? 0);
  }, [calc?.cmvPercent]);

  const deltaLabel = useMemo(() => {
    const d = calc?.deltaPp ?? 0;
    const abs = Math.abs(d);
    const label = `${abs.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% p.p.`;
    return d > 0 ? `${label} acima da meta` : `${label} abaixo da meta`;
  }, [calc?.deltaPp]);

  const comparativoAnteriorLabel = useMemo(() => {
    if (!calc || !lastCalc) return "";
    const delta = calc.cmvPercent - lastCalc.cmvPercent;
    const abs = Math.abs(delta);
    const label = `${abs.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% p.p.`;
    if (delta < 0) return `${label} melhor que o cálculo anterior`;
    if (delta > 0) return `${label} pior que o cálculo anterior`;
    return `${label} igual ao cálculo anterior`;
  }, [calc, lastCalc]);

  const desperdiciosLinha = useMemo(() => {
    return `${formatBrlFromCents(calc?.desperdiciosCents ?? 0)} em desperdícios no período`;
  }, [calc?.desperdiciosCents]);

  const categoriaChart = useMemo(() => {
    if (!calc) return { slices: [] as PieSlice[], legend: [] as Array<{ label: string; tone: string; cents: number }> };
    const byCat = new Map<string, number>();
    for (const r of calc.rows) {
      const c = (r.categoria || "-").trim() || "-";
      const cents = Math.abs(parseBrlToCents(r.cmv));
      byCat.set(c, (byCat.get(c) ?? 0) + cents);
    }
    const sorted = [...byCat.entries()]
      .map(([label, cents]) => ({ label, cents }))
      .filter((x) => x.cents > 0)
      .sort((a, b) => b.cents - a.cents);

    const tones = ["green", "greenDark", "red", "yellow", "blue", "purple", "pink", "mint", "lime", "orange"];
    const legend = sorted.slice(0, 10).map((x, i) => ({ ...x, tone: tones[i] ?? "green" }));
    const slices: PieSlice[] = legend.map((x) => ({ label: x.label, value: x.cents, color: toneColors[(x.tone as keyof typeof toneColors) ?? "green"] }));
    return { slices, legend };
  }, [calc]);

  const chartDisplay = useMemo(() => {
    if (categoriaChart.slices.length && categoriaChart.legend.length) {
      return {
        slices: categoriaChart.slices,
        legend: categoriaChart.legend.map((item) => ({ label: item.label, tone: item.tone })),
      };
    }
    return {
      slices: [] as PieSlice[],
      legend: legendItems.map((item) => ({
        label: item.label,
        tone: item.tone,
      })),
    };
  }, [categoriaChart]);

  const variacaoRows = useMemo(() => {
    if (!calc) return [];
    const startOpt = inventoryOptions.find((o) => o.iso === startDate) ?? null;
    const endOpt = inventoryOptions.find((o) => o.iso === endDate) ?? null;
    if (!startOpt || !endOpt) return [];
    const startD = parseDateDDMMYYYY(startOpt.label);
    const endD = parseDateDDMMYYYY(endOpt.label);
    if (!startD || !endD) return [];
    const startT = startOfDay(startD).getTime();
    const endT = startOfDay(endD).getTime();
    const minT = Math.min(startT, endT);
    const maxT = Math.max(startT, endT);

    const idByKey = new Map<string, string>();
    for (const i of insumos) {
      const key = normalizeKey(i.item);
      if (!key) continue;
      if (!idByKey.has(key)) idByKey.set(key, i.id);
    }

    const lastBeforeStart = new Map<string, { t: number; cents: number }>();
    const lastBeforeEnd = new Map<string, { t: number; cents: number }>();

    for (const e of entradas) {
      const d = parseDateLabelLoose(e.dataLancamento);
      if (!d) continue;
      const t = startOfDay(d).getTime();
      if (t > maxT) continue;
      for (const it of e.itensNota ?? []) {
        const id = idByKey.get(normalizeKey(it.nome));
        if (!id) continue;
        const unitStr = String(it.custoUnitarioLabel ?? "");
        const rawValue = unitStr.split("/")[0] ?? unitStr;
        const cents = parseBrlToCents(rawValue);
        if (!cents) continue;
        if (t <= minT) {
          const prev = lastBeforeStart.get(id);
          if (!prev || t >= prev.t) lastBeforeStart.set(id, { t, cents });
        }
        const prevEnd = lastBeforeEnd.get(id);
        if (!prevEnd || t >= prevEnd.t) lastBeforeEnd.set(id, { t, cents });
      }
    }

    const out = insumos
      .map((i) => {
        const startCost = lastBeforeStart.get(i.id)?.cents ?? parseBrlToCents(String(i.custoMedio ?? "")) ?? 0;
        const endCost = lastBeforeEnd.get(i.id)?.cents ?? parseBrlToCents(String(i.custoMedio ?? "")) ?? 0;
        const pct = startCost > 0 ? ((endCost - startCost) / startCost) * 100 : 0;
        return {
          id: i.id,
          item: i.item,
          startCost,
          endCost,
          pct,
        };
      })
      .filter((x) => x.startCost > 0 || x.endCost > 0)
      .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));

    return out;
  }, [calc, endDate, entradas, insumos, inventoryOptions, startDate]);

  const historicoEntradas = useMemo(() => {
    if (!historyItem) return [];
    const key = normalizeKey(historyItem.item);
    const out: Array<{
      t: number;
      data: string;
      fornecedor: string;
      qtd: string;
      preco: string;
      subtotal: string;
    }> = [];

    for (const e of entradas) {
      const d = parseDateLabelLoose(e.dataLancamento);
      const t = d ? startOfDay(d).getTime() : 0;
      if (!e.itensNota?.length) continue;
      const equivalencias = getEquivalenciasForFornecedor(String(e.fornecedor ?? ""));
      for (const it of e.itensNota) {
        const rawKey = normalizeKey(it.nome);
        const eq = equivalencias.find((m) => normalizeKey(m.nomeNaNota) === rawKey) ?? null;
        const mappedKey = eq ? normalizeKey(eq.insumoEquivalente) : rawKey;
        if (mappedKey !== key) continue;
        out.push({
          t,
          data: e.dataLancamento,
          fornecedor: e.fornecedor,
          qtd: it.quantidadeLabel,
          preco: it.custoUnitarioLabel,
          subtotal: it.subtotalLabel,
        });
      }
    }

    out.sort((a, b) => b.t - a.t);
    return out;
  }, [entradas, fornecedorKeyLookup, fornecedorEquivalenciasMap, historyItem]);

  const historicoFornecedores = useMemo(() => {
    if (!historyItem) return [];
    const itemKey = historyItem.item.trim().toLowerCase();
    const byFornecedor = new Map<
      string,
      { key: string; fornecedor: string; vendedor: string; endereco: string; totalProdutos: number; t: number }
    >();

    const ensureFornecedor = (rawKey: string, t: number) => {
      const key = rawKey.trim().toUpperCase();
      if (!key) return;
      const info = fornecedorInfoMap[key];
      const prev = byFornecedor.get(key);
      if (!prev) {
        byFornecedor.set(key, {
          key,
          fornecedor: info?.fornecedor?.trim() || rawKey.trim() || key,
          vendedor: info?.vendedor?.trim() || "-",
          endereco: info?.endereco?.trim() || "-",
          totalProdutos: fornecedorProdutosMap[key]?.length ?? 0,
          t,
        });
        return;
      }
      byFornecedor.set(key, {
        ...prev,
        fornecedor: info?.fornecedor?.trim() || prev.fornecedor,
        vendedor: info?.vendedor?.trim() || prev.vendedor,
        endereco: info?.endereco?.trim() || prev.endereco,
        totalProdutos: fornecedorProdutosMap[key]?.length ?? prev.totalProdutos,
        t: Math.max(prev.t, t),
      });
    };

    for (const h of historicoEntradas) {
      ensureFornecedor(h.fornecedor || "-", h.t);
    }

    for (const [key, produtos] of Object.entries(fornecedorProdutosMap)) {
      if (produtos.some((name) => name.trim().toLowerCase() === itemKey)) {
        ensureFornecedor(key, 0);
      }
    }

    for (const [key, equivalencias] of Object.entries(fornecedorEquivalenciasMap)) {
      if (equivalencias.some((row) => row.insumoEquivalente.trim().toLowerCase() === itemKey)) {
        ensureFornecedor(key, 0);
      }
    }

    return [...byFornecedor.values()].sort((a, b) => b.t - a.t);
  }, [fornecedorEquivalenciasMap, fornecedorInfoMap, fornecedorProdutosMap, historicoEntradas, historyItem]);

  const fornecedorModalProdutos = useMemo(() => {
    const key = fornecedorModalKey.trim().toUpperCase();
    if (!key) return [];
    return fornecedorProdutosMap[key] ?? [];
  }, [fornecedorModalKey, fornecedorProdutosMap]);

  const fornecedorProdutoSugestoes = useMemo(() => {
    const current = new Set(fornecedorModalProdutos.map((x) => x.toLowerCase()));
    const q = fornecedorProdutoQuery.trim().toLowerCase();
    return insumos
      .map((i) => i.item.trim())
      .filter(Boolean)
      .filter((name, index, arr) => arr.findIndex((x) => x.toLowerCase() === name.toLowerCase()) === index)
      .filter((name) => !current.has(name.toLowerCase()))
      .filter((name) => (!q ? true : name.toLowerCase().includes(q)))
      .sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }))
      .slice(0, 40);
  }, [fornecedorModalProdutos, fornecedorProdutoQuery, insumos]);

  const selectedInsumo = useMemo(() => {
    if (!historyItem) return null;
    return insumos.find((i) => i.id === historyItem.insumoId) ?? null;
  }, [historyItem, insumos]);

  function toggleOcultarSelecionado() {
    if (!selectedInsumo) return;
    const nextOcultar = !selectedInsumo.ocultar;
    const nextRows = insumos.map((i) => (i.id === selectedInsumo.id ? { ...i, ocultar: nextOcultar } : i));
    setInsumos(nextRows);
    writeInsumosToStore(nextRows);
    void syncInsumosToSupabase(nextRows, []).catch(() => {});
    setHideAlert({ item: selectedInsumo.item, tone: nextOcultar ? "hide" : "show" });
    if (nextOcultar) {
      setHistoryItem(null);
      setCalc((prev) => (prev ? { ...prev, rows: prev.rows.filter((r) => r.insumoId !== selectedInsumo.id) } : prev));
    }
    window.setTimeout(() => {
      if (canCalculate) handleCalculate();
    }, 0);
  }

  function openEditSelected() {
    if (!selectedInsumo) return;
    setIsItemMenuOpen(false);
    setIsDeleteItemOpen(false);
    setEditItemName(selectedInsumo.item);
    setEditCategory(String(selectedInsumo.categoria ?? "").trim() === "-" ? "" : String(selectedInsumo.categoria ?? "").trim());
    setEditSpec(String(selectedInsumo.especificacao ?? "").trim() === "-" ? "" : String(selectedInsumo.especificacao ?? "").trim());
    setEditUnit(String(selectedInsumo.medida ?? "").trim() === "-" ? "" : String(selectedInsumo.medida ?? "").trim());
    setEditInitialCost(String(selectedInsumo.custoMedio ?? "").replace(/^R\$\s?/, "").trim().replace(".", ","));
    setIsEditItemOpen(true);
  }

  function saveEditSelected() {
    if (!selectedInsumo) return;
    const item = editItemName.trim();
    if (!item) return;
    const categoria = editCategory.trim() || "-";
    const especificacao = editSpec.trim() || "-";
    const medida = editUnit.trim() || "Und";
    const custoMedio = editInitialCost.trim() ? (editInitialCost.trim().startsWith("R$") ? editInitialCost.trim() : `R$${editInitialCost.trim()}`) : undefined;
    const nextRows = insumos.map((i) =>
      i.id === selectedInsumo.id
        ? {
            ...i,
            item,
            categoria,
            especificacao,
            medida,
            custoMedio,
          }
        : i,
    );
    setInsumos(nextRows);
    writeInsumosToStore(nextRows);
    setHistoryItem({ insumoId: selectedInsumo.id, item });
    setIsEditItemOpen(false);
  }

  function openCategoriesModal() {
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
    const exists = editCategories.some((c) => normalizeCategoryName(c).toLowerCase() === name.toLowerCase());
    if (!exists) setExtraCategories((prev) => [...prev, name]);
    setEditCategory(name);
    setCategoryNewDraft("");
  }

  function editCategoryName(name: string) {
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
    if (fromKey !== existsKey && editCategories.some((c) => c.toLowerCase() === existsKey)) {
      window.alert("Ja existe uma categoria com esse nome.");
      return;
    }

    setExtraCategories((prev) => {
      const lowerFrom = from.toLowerCase();
      const next = prev.map((c) => (c.toLowerCase() === lowerFrom ? name : c));
      return next.some((c) => c.toLowerCase() === existsKey) ? next : [...next, name];
    });

    const nextRows = insumos.map((row) => (normalizeCategoryName(row.categoria ?? "").toLowerCase() === fromKey ? { ...row, categoria: name } : row));
    setInsumos(nextRows);
    writeInsumosToStore(nextRows);
    if (editCategory === from) setEditCategory(name);
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
    const lowerName = name.toLowerCase();
    setExtraCategories((prev) => prev.filter((c) => c.toLowerCase() !== lowerName));
    const nextRows = insumos.map((row) =>
      normalizeCategoryName(row.categoria ?? "").toLowerCase() === lowerName ? { ...row, categoria: "-" } : row,
    );
    setInsumos(nextRows);
    writeInsumosToStore(nextRows);
    if (editCategory === name) setEditCategory("");
    if (editingCategoryOriginal === name) cancelEditCategory();
    cancelDeleteCategory();
  }

  function openDeleteSelected() {
    if (!selectedInsumo) return;
    setIsItemMenuOpen(false);
    setIsEditItemOpen(false);
    setIsDeleteItemOpen(true);
  }

  function confirmDeleteSelected() {
    if (!selectedInsumo) return;
    const nextRows = insumos.filter((i) => i.id !== selectedInsumo.id);
    setInsumos(nextRows);
    writeInsumosToStore(nextRows);
    setIsDeleteItemOpen(false);
    setHistoryItem(null);
    setDetailsTab("entradas");
  }

  function openFornecedorModal(row: { key: string; fornecedor: string; vendedor: string; endereco: string }) {
    setFornecedorModalKey(row.key);
    setFornecedorModalLabel(row.fornecedor);
    setFornecedorModalVendedor(row.vendedor);
    setFornecedorModalEndereco(row.endereco);
    setFornecedorProdutoQuery("");
    setIsFornecedorProdutoMenuOpen(false);
    setIsFornecedorModalOpen(true);
  }

  function closeFornecedorModal() {
    setIsFornecedorModalOpen(false);
    setFornecedorModalKey("");
    setFornecedorModalLabel("");
    setFornecedorModalVendedor("");
    setFornecedorModalEndereco("");
    setFornecedorProdutoQuery("");
    setIsFornecedorProdutoMenuOpen(false);
  }

  function addProdutoFornecedor() {
    const key = fornecedorModalKey.trim().toUpperCase();
    if (!key) return;
    const picked =
      fornecedorProdutoSugestoes.find((name) => name.toLowerCase() === fornecedorProdutoQuery.trim().toLowerCase()) ??
      fornecedorProdutoSugestoes[0] ??
      "";
    const name = picked.trim();
    if (!name) return;
    const cur = fornecedorProdutosMap[key] ?? [];
    if (cur.some((x) => x.toLowerCase() === name.toLowerCase())) return;
    const next = { ...fornecedorProdutosMap, [key]: [...cur, name] };
    setFornecedorProdutosMap(next);
    writeFornecedorProdutosMap(next);
    setFornecedorProdutoQuery("");
    setIsFornecedorProdutoMenuOpen(false);
  }

  function removeProdutoFornecedor(name: string) {
    const key = fornecedorModalKey.trim().toUpperCase();
    if (!key) return;
    const cur = fornecedorProdutosMap[key] ?? [];
    const nextList = cur.filter((x) => x.toLowerCase() !== name.toLowerCase());
    const next = { ...fornecedorProdutosMap, [key]: nextList };
    setFornecedorProdutosMap(next);
    writeFornecedorProdutosMap(next);
  }

  function openVariacaoItem(row: { id: string; item: string }) {
    setIsVariacaoOpen(false);
    setHistoryItem({ insumoId: row.id, item: row.item });
    setDetailsTab("entradas");
  }

  useEffect(() => {
    if (!historyItem) return;
    setTimeout(() => historyRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }, [historyItem, historyRef]);

  useEffect(() => {
    if (!hideAlert) return;
    const timeoutId = window.setTimeout(() => setHideAlert(null), 4000);
    return () => window.clearTimeout(timeoutId);
  }, [hideAlert]);

  useEffect(() => {
    if (!isItemMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (itemMenuRef.current && target && !itemMenuRef.current.contains(target)) {
        setIsItemMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [isItemMenuOpen]);

  return (
    <div className={styles.dashboard}>
      <AppSidebar active={historyItem ? "insumos" : "dashboard"} />

      <main className={styles.content}>
        {hideAlert ? (
          <div className={`${styles.hideAlert} ${hideAlert.tone === "show" ? styles.hideAlertShow : ""}`} role="alert" aria-live="assertive">
            <div className={styles.hideAlertLeading}>
              {hideAlert.tone === "show" ? <IconAlertShow /> : <IconAlertHide />}
            </div>
            <div className={styles.hideAlertBody}>
              <div className={styles.hideAlertTitleRow}>
                <span className={styles.hideAlertItemIcon}>
                  <IconSidebarClipboard />
                </span>
                <span className={styles.hideAlertTitle}>{hideAlert.item}</span>
              </div>
              <div className={styles.hideAlertText}>
                {hideAlert.tone === "show" ? "Item incluído no cálculo de CMV." : "Item ocultado do cálculo de CMV."}
              </div>
            </div>
            <button type="button" className={styles.hideAlertClose} aria-label="Fechar alerta" onClick={() => setHideAlert(null)}>
              ×
            </button>
          </div>
        ) : null}
        <div className={styles.pageFrame}>
        <section className={styles.topSection} style={historyItem ? { display: "none" } : undefined}>
          <div className={styles.topBar}>
            <div className={styles.topField}>
              <span className={styles.topLabel}>Data Inicial:</span>
              <span className={styles.topFieldIcon}>
                <IconCalendarSmall />
              </span>
              <select className={styles.topInput} value={startDate} onChange={(e) => setStartDate(e.target.value)}>
                {periodOptions.map((o) => (
                  <option key={o.iso} value={o.iso}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.topField}>
              <span className={styles.topLabel}>Data Final:</span>
              <span className={styles.topFieldIcon}>
                <IconCalendarSmall />
              </span>
              <select className={styles.topInput} value={endDate} onChange={(e) => setEndDate(e.target.value)}>
                {periodOptions.map((o) => (
                  <option key={o.iso} value={o.iso}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.topField}>
              <span className={styles.topLabel}>Faturamento:</span>
              <span className={styles.topFieldIcon}>
                <IconMoneySmall />
              </span>
              <input
                ref={revenueInputRef}
                className={styles.topInput}
                inputMode="decimal"
                placeholder="R$0,00"
                value={revenue}
                onFocus={() => placeCaretBeforeCurrencyDecimals(revenueInputRef.current)}
                onClick={() => placeCaretBeforeCurrencyDecimals(revenueInputRef.current)}
                onChange={(e) => {
                  setRevenue(formatBrlInput(e.target.value));
                  placeCaretBeforeCurrencyDecimals(revenueInputRef.current);
                }}
              />
            </div>

            <div className={styles.topField}>
              <span className={styles.topLabel}>CMV Meta:</span>
              <span className={styles.topFieldIcon}>
                <IconTargetSmall />
              </span>
              <input
                ref={targetCmvInputRef}
                className={styles.topInput}
                inputMode="decimal"
                placeholder="30,00%"
                value={targetCmv}
                onFocus={() => placeCaretBeforePercentDecimals(targetCmvInputRef.current)}
                onClick={() => placeCaretBeforePercentDecimals(targetCmvInputRef.current)}
                onChange={(e) => {
                  setTargetCmv(formatPercentInput(e.target.value));
                  placeCaretBeforePercentDecimals(targetCmvInputRef.current);
                }}
              />
            </div>

            <button
              type="button"
              className={canCalculate ? `${styles.topAction} ${styles.topActionEnabled}` : styles.topAction}
              onClick={handleCalculate}
              disabled={!canCalculate}
            >
              <span className={styles.topActionIcon}>
                <IconCalendarSmall />
              </span>
              Calcular CMV
            </button>
          </div>

          <div className={styles.topHint}>
            <span className={styles.topHintIcon}>
              <IconInfoSmall />
            </span>
            Selecione o período, insira o faturamento referente a essas datas e defina a meta de CMV. Em seguida, clique
            em Calcular CMV.
          </div>

          <details className={styles.concepts}>
            <summary className={styles.conceptsSummary}>Conceitos iniciais e pré-requisitos</summary>
            <div className={styles.conceptsBody}>
              <div className={styles.conceptsTitle}>O que é</div>
              <div className={styles.conceptsText}>
                CMV é Custo de Mercadoria Vendida, um número que mostra quantos % do faturamento foi gasto com mercadorias.
              </div>

              <div className={styles.conceptsTitle}>Por que é importante</div>
              <div className={styles.conceptsText}>
                Pois é o maior gasto do seu restaurante e tudo o que você reduzir do CMV vira lucro. É o caminho mais rápido para lucrar mais.
              </div>

              <div className={styles.conceptsTitle}>Como é calculado</div>
              <div className={styles.conceptsText}>CMV = Estoque Inicial + Entradas − Estoque Final</div>

              <div className={styles.conceptsTitle}>Pré-requisitos</div>
              <div className={styles.conceptsText}>
                Para calcular o CMV, é necessário ter 2 inventários cadastrados (estoque inicial e final) e lançar todas as compras (entradas de nota) entre as 2 datas.
              </div>
            </div>
          </details>

          {calcError ? <div className={styles.calcError}>{calcError}</div> : null}
        </section>

        <section className={styles.detailsSection} style={historyItem ? { display: "none" } : undefined}>
          <div className={styles.detailsTitleRow}>
            <div className={styles.detailsIcon}>
              <IconSparkSmall />
            </div>
            <p className={styles.detailsTitle}>Detalhes do seu CMV Real</p>
          </div>

          <div className={styles.detailsCards}>
            <div className={styles.cmvCard}>
              <p className={styles.cmvCardLabel}>SEU CMV REAL</p>
              <p className={styles.cmvCardValue}>{cmvLabel}</p>
            </div>

            <div className={styles.deltaCard}>
              <div className={styles.deltaList}>
                <div className={styles.deltaRow}>{deltaLabel}</div>
                <div className={styles.deltaRow}>{comparativoAnteriorLabel || "—"}</div>
                <div className={styles.deltaRow}>{desperdiciosLinha}</div>
              </div>
              <button type="button" className={styles.deltaLink} onClick={() => setIsVariacaoOpen(true)} disabled={!calc}>
                Ver variação de custo dos insumos
              </button>
            </div>

            <div className={styles.chartCard}>
              <div className={styles.chartCanvas}>
                <div className={styles.chartArea}>
                  {chartDisplay.slices.some((slice) => slice.value > 0) ? <PieChart slices={chartDisplay.slices} size={148} /> : <div className={styles.chartEmpty} aria-hidden />}
                </div>
              </div>
              <div className={styles.chartLegend}>
                {chartDisplay.legend.length ? (
                  chartDisplay.legend.map((it) => (
                    <div key={it.label} className={styles.legendItem}>
                      <span className={`${styles.legendSwatch} ${styles[`legendSwatch_${it.tone}` as keyof typeof styles]}`} aria-hidden />
                      <span className={styles.legendLabel}>{it.label}</span>
                    </div>
                  ))
                ) : (
                  <div className={styles.legendEmpty}>CMV por categoria</div>
                )}
              </div>
            </div>
          </div>
        </section>

        <section style={{ display: "flex", flexDirection: "column", gap: 24, width: "100%" }}>
          {!historyItem ? (
            <>
              <div className={styles.summaryHeader}>
                <div className={styles.pillIcon}>
                  <img src="/dashboard/ml7hdudz-vztdpis.svg" className={styles.usersActiveIcon} alt="" />
                </div>
                <p className={styles.summaryTitle}>Descubra o CMV de cada item</p>

                <div className={styles.summarySpacer} />
              </div>

              <div className={styles.cardsRow}>
                <div className={styles.statCard}>
                  <div className={styles.statIconBlue}>
                    <IconCubeOutline />
                  </div>
                  <div className={styles.statText}>
                    <p className={styles.statValue}>{formatBrlFromCents(calc?.initialCents ?? 0)}</p>
                    <p className={styles.statLabel}>ESTOQUE INICIAL</p>
                  </div>
                </div>

                <div className={styles.statCard}>
                  <div className={styles.statIconGreen}>
                    <IconBasketOutline />
                  </div>
                  <div className={styles.statText}>
                    <p className={styles.statValue}>{formatBrlFromCents(calc?.comprasCents ?? 0)}</p>
                    <p className={styles.statLabel}>ENTRADAS PERÍODO</p>
                  </div>
                </div>

                <div className={styles.statCard}>
                  <div className={styles.statIconOrange}>
                    <IconBoxOutline />
                  </div>
                  <div className={styles.statText}>
                    <p className={styles.statValue}>{formatBrlFromCents(calc?.finalCents ?? 0)}</p>
                    <p className={styles.statLabel}>ESTOQUE FINAL</p>
                  </div>
                </div>

                <div className={styles.statCard}>
                  <div className={styles.statIconRed}>
                    <IconArrowDownOutline />
                  </div>
                  <div className={styles.statText}>
                    <p className={styles.statValue}>{formatBrlFromCents(calc?.saidasCents ?? 0)}</p>
                    <p className={styles.statLabel}>SAÍDAS PERÍODO</p>
                  </div>
                </div>
              </div>

              <div className={styles.discoverFilters}>
                <div className={styles.searchBox}>
                  <img src="/dashboard/icon-search-green.svg" className={styles.searchIcon} alt="" />
                  <input className={styles.searchInput} placeholder="Pesquise por itens..." value={tableQuery} onChange={(e) => setTableQuery(e.target.value)} />
                </div>
                <div className={styles.categoryBox}>
                  <select className={styles.categorySelect} value={tableCategoria} onChange={(e) => setTableCategoria(e.target.value)}>
                    <option value="todas">Todas</option>
                    {categorias.map((c) => (
                      <option key={c} value={c.toLowerCase()}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          ) : null}

          {historyItem ? (
            <div className={styles.itemDetails}>
              <div className={styles.itemDetailsTop}>
                <button
                  type="button"
                  className={styles.itemBack}
                  onClick={closeHistoryPanel}
                >
                  <span className={styles.itemBackIcon} aria-hidden>
                    ←
                  </span>
                  <span className={styles.itemBackText}>Detalhes do Item / {historyItem.item}</span>
                </button>
                <div className={styles.itemMoreWrap} ref={itemMenuRef}>
                  <button type="button" className={styles.itemMore} aria-label="Mais opções" onClick={() => setIsItemMenuOpen((v) => !v)}>
                    ⋮
                  </button>
                  {isItemMenuOpen ? (
                    <div className={styles.itemMenu}>
                      <button type="button" className={styles.itemMenuBtn} onClick={openEditSelected}>
                        Editar
                      </button>
                      <button type="button" className={`${styles.itemMenuBtn} ${styles.itemMenuBtnDanger}`} onClick={openDeleteSelected}>
                        Excluir
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className={styles.itemDetailsGrid} ref={historyRef}>
                <div className={styles.itemDetailsMain}>
                  <div className={styles.itemDetailsTabs}>
                    <button
                      type="button"
                      className={detailsTab === "entradas" ? styles.itemTabActive : styles.itemTab}
                      onClick={() => setDetailsTab("entradas")}
                    >
                      Entradas
                    </button>
                    <button
                      type="button"
                      className={detailsTab === "fornecedores" ? styles.itemTabActive : styles.itemTab}
                      onClick={() => setDetailsTab("fornecedores")}
                    >
                      Fornecedores
                    </button>
                  </div>

                  <div className={styles.itemDetailsBody}>
                    {detailsTab === "entradas" ? (
                      <>
                        <div className={styles.historyTitle}>Histórico de Entradas</div>
                        <div className={styles.historyTable}>
                          <div className={styles.historyHead}>
                            <div className={styles.historyTh}>Data</div>
                            <div className={styles.historyThItem}>Fornecedor</div>
                            <div className={styles.historyThRight}>Qtd</div>
                            <div className={styles.historyThRight}>Preço</div>
                            <div className={styles.historyThRight}>Subtotal</div>
                          </div>

                          {historicoEntradas.length ? (
                            historicoEntradas.map((h, idx) => (
                              <div key={`${h.data}-${idx}`} className={styles.historyRow}>
                                <div className={styles.historyCell}>{h.data}</div>
                                <div className={styles.historyItem}>{h.fornecedor}</div>
                                <div className={styles.historyCellRight}>{h.qtd}</div>
                                <div className={styles.historyCellRight}>{h.preco}</div>
                                <div className={styles.historyCellRight}>{h.subtotal}</div>
                              </div>
                            ))
                          ) : (
                            <div className={styles.historyEmpty}>Nenhuma entrada encontrada para este item.</div>
                          )}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className={styles.historyTitle}>Fornecedores deste Item</div>
                        <div className={styles.historyTable}>
                          <div className={styles.fornecedorHead}>
                            <div className={styles.historyThItem}>Fornecedor</div>
                            <div className={styles.historyTh}>Vendedor</div>
                            <div className={styles.historyTh}>Endereço</div>
                          </div>

                          {historicoFornecedores.length ? (
                            historicoFornecedores.map((f) => (
                              <button key={f.key} type="button" className={styles.fornecedorRowBtn} onClick={() => openFornecedorModal(f)}>
                                <div className={styles.fornecedorRowSimple}>
                                  <div className={styles.fornecedorCellMain}>
                                    <span className={styles.fornecedorCellIcon} aria-hidden>
                                      <IconSidebarStore />
                                    </span>
                                    <span className={styles.historyItem}>{f.fornecedor}</span>
                                  </div>
                                  <div className={styles.historyCell}>{f.vendedor}</div>
                                  <div className={styles.historyCell}>{f.endereco}</div>
                                </div>
                              </button>
                            ))
                          ) : (
                            <div className={styles.historyEmpty}>Nenhum fornecedor encontrado para este item.</div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <aside className={styles.itemDetailsAside}>
                  <div className={styles.itemAsideCard}>
                    <div className={styles.itemAsideHead}>
                      <div className={styles.itemAsideTitle}>{historyItem.item}</div>
                      <div className={styles.itemAsideMeta}>{selectedInsumo?.categoria ?? "-"}</div>
                      <div className={styles.itemAsideSubmeta}>Mercado</div>
                    </div>

                    <div className={styles.itemAsideRow}>
                      <div className={styles.itemAsideLabel}>Ocultar do CMV Real</div>
                      <button type="button" className={selectedInsumo?.ocultar ? styles.itemToggleOn : styles.itemToggleOff} onClick={toggleOcultarSelecionado}>
                        <span />
                      </button>
                    </div>

                    <div className={styles.itemAsideKpis}>
                      <div className={styles.itemAsideKpi}>
                        <div className={styles.itemAsideKpiIcon}>
                          <IconMoneySmall />
                        </div>
                        <div className={styles.itemAsideKpiText}>
                          <div className={styles.itemAsideKpiLabel}>Custo Médio</div>
                          <div className={styles.itemAsideKpiValue}>{selectedInsumo?.custoMedio ?? "-"}</div>
                        </div>
                      </div>
                      <div className={styles.itemAsideKpi}>
                        <div className={styles.itemAsideKpiIcon}>
                          <IconCalendarSmall />
                        </div>
                        <div className={styles.itemAsideKpiText}>
                          <div className={styles.itemAsideKpiLabel}>Última Entrada</div>
                          <div className={styles.itemAsideKpiValue}>{historicoEntradas[0]?.data ?? "-"}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </aside>
              </div>
            </div>
          ) : (
            <div className={styles.tableWrapper}>
              <div className={styles.tableHeader} style={{ gridTemplateColumns: tableGridTemplateColumns }}>
                {tableColumnOrder.map((column) => {
                  const label =
                    column === "item"
                      ? "Item"
                      : column === "initial"
                        ? "Estoque Inicial"
                        : column === "entradas"
                          ? "Entradas"
                          : column === "final"
                            ? "Estoque Final"
                            : column === "saidas"
                              ? "Saídas"
                              : column === "custo"
                                ? "Custo Médio"
                                : "CMV";
                  return (
                    <div
                      key={column}
                      className={
                        column === "item"
                          ? `${styles.thGroup} ${styles.tableHeadDrag} ${draggingTableColumn === column ? styles.tableHeadDragging : ""}`
                          : `${styles.thCell} ${styles.tableHeadDrag} ${draggingTableColumn === column ? styles.tableHeadDragging : ""}`
                      }
                      draggable
                      onMouseDown={() => beginTableColumnDrag(column)}
                      onMouseEnter={() => {
                        if (!draggingTableColumn || draggingTableColumn === column) return;
                        moveTableColumn(draggingTableColumn, column);
                      }}
                      onDragStart={(e) => {
                        beginTableColumnDrag(column);
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", column);
                        e.dataTransfer.dropEffect = "move";
                      }}
                      onDragEnd={() => setDraggingTableColumn(null)}
                      onDragEnter={(e) => e.preventDefault()}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                      }}
                      onDrop={(e) => onTableColumnDrop(column, e)}
                    >
                      <div className={styles.tableHeadInner}>
                        <button
                          type="button"
                          className={styles.tableHeadBtn}
                          onClick={() => {
                            if (tableHeaderDidDragRef.current) {
                              tableHeaderDidDragRef.current = false;
                              return;
                            }
                            toggleTableSort(column);
                          }}
                        >
                          {label} {tableSortKey === column ? <SortMark dir={tableSortDir} /> : null}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {!baseRows.length ? (
                <div className={styles.tableEmpty}>Nenhum item cadastrado ainda.</div>
              ) : !visibleRows.length ? (
                <div className={styles.tableEmpty}>Nenhum item encontrado com os filtros atuais.</div>
              ) : (
                visibleRows.map((r) => (
                  <div key={r.index} className={styles.tableRow} style={{ gridTemplateColumns: tableGridTemplateColumns }}>
                    {tableColumnOrder.map((column) => (
                      <div key={column}>{renderDashboardCell(r, column)}</div>
                    ))}
                  </div>
                ))
              )}
            </div>
          )}
        </section>

        {isEditItemOpen ? (
          <div className={styles.modalOverlay} role="presentation" onClick={() => setIsEditItemOpen(false)}>
            <div className={`${styles.modal} ${styles.itemEditModal}`} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div className={styles.itemEditModalTitle}>Editar Item</div>
                <button type="button" className={styles.itemEditModalClose} aria-label="Fechar" onClick={() => setIsEditItemOpen(false)}>
                  ×
                </button>
              </div>

              <div className={styles.itemEditFormBody}>
                <div className={styles.itemEditField}>
                  <div className={styles.itemEditLabel}>Nome do Item</div>
                  <input className={styles.itemEditInput} value={editItemName} onChange={(e) => setEditItemName(e.target.value)} />
                </div>

                <div className={styles.itemEditField}>
                  <div className={styles.itemEditLabelRow}>
                    <div className={styles.itemEditLabel}>Categoria</div>
                    <button type="button" className={styles.itemEditAddCategory} onClick={openCategoriesModal}>
                      ADD Categoria
                    </button>
                  </div>
                  <select className={styles.itemEditSelect} value={editCategory} onChange={(e) => setEditCategory(e.target.value)}>
                    <option value="">Selecione</option>
                    {editCategories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div className={styles.itemEditField}>
                  <div className={styles.itemEditLabel}>Especificação</div>
                  <input className={styles.itemEditInput} value={editSpec} onChange={(e) => setEditSpec(e.target.value)} />
                </div>

                <div className={styles.itemEditField}>
                  <div className={styles.itemEditLabel}>Unidade de Medida</div>
                  <select className={styles.itemEditSelect} value={editUnit} onChange={(e) => setEditUnit(e.target.value)}>
                    <option value="">Selecione</option>
                    {editUnit && !["Und", "Kg", "g", "L", "ml"].includes(editUnit) ? <option value={editUnit}>{editUnit}</option> : null}
                    <option value="Und">Und</option>
                    <option value="Kg">Kg</option>
                    <option value="g">g</option>
                    <option value="L">L</option>
                    <option value="ml">ml</option>
                  </select>
                </div>

                <div className={styles.itemEditField}>
                  <div className={styles.itemEditLabel}>Custo Inicial</div>
                  <div className={styles.itemEditMoneyRow}>
                    <div className={styles.itemEditMoneyPrefix}>R$</div>
                    <input className={styles.itemEditMoneyInput} inputMode="decimal" value={editInitialCost} onChange={(e) => setEditInitialCost(e.target.value)} />
                  </div>
                </div>
              </div>

              <div className={styles.itemEditModalFooter}>
                <button
                  type="button"
                  className={styles.itemEditPrimaryWide}
                  onClick={saveEditSelected}
                  disabled={!editItemName.trim() || !editCategory.trim() || !editSpec.trim() || !editUnit.trim() || !editInitialCost.trim()}
                >
                  Salvar
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {isCategoriesOpen ? (
          <div className={styles.modalOverlay} role="presentation" onClick={() => setIsCategoriesOpen(false)}>
            <div className={`${styles.modal} ${styles.itemCategoriesModal}`} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitle}>Categorias de Itens</div>
                <button type="button" className={styles.modalClose} aria-label="Fechar" onClick={() => setIsCategoriesOpen(false)}>
                  ×
                </button>
              </div>

              <div className={styles.itemCategoriesBody}>
                <div className={styles.itemCategoriesLabel}>Nome da Categoria</div>
                <div className={styles.itemCategoriesRow}>
                  <input
                    className={styles.itemCategoriesInput}
                    placeholder="Ex: Proteinas"
                    value={categoryNewDraft}
                    onChange={(e) => setCategoryNewDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addCategory();
                    }}
                  />
                  <button type="button" className={styles.itemCategoriesAddBtn} onClick={addCategory} disabled={!normalizeCategoryName(categoryNewDraft)}>
                    <IconPlus /> ADD
                  </button>
                </div>

                <div className={styles.itemCategoriesDivider} />

                <div className={styles.itemCategoriesList}>
                  {editCategories.length ? (
                    editCategories.map((c) => (
                      <div key={c} className={styles.itemCategoryItem}>
                        {editingCategoryOriginal === c ? (
                          <>
                            <input
                              className={styles.itemCategoryInlineInput}
                              value={editingCategoryDraft}
                              onChange={(e) => setEditingCategoryDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") confirmEditCategory();
                                if (e.key === "Escape") cancelEditCategory();
                              }}
                              autoFocus
                            />
                            <div className={styles.itemCategoryCount} />
                            <div className={styles.itemCategoryActions}>
                              <button
                                type="button"
                                className={`${styles.itemCategoryIconBtn} ${styles.itemCategoryIconBtnConfirm}`}
                                aria-label="Confirmar edicao"
                                onClick={confirmEditCategory}
                                disabled={!normalizeCategoryName(editingCategoryDraft)}
                              >
                                <IconCheck />
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className={styles.itemCategoryName}>{c}</div>
                            <div className={styles.itemCategoryCount}>{categoryCounts.get(c) ?? 0}</div>
                            <div className={styles.itemCategoryActions}>
                              <button type="button" className={styles.itemCategoryIconBtn} aria-label="Editar categoria" onClick={() => editCategoryName(c)}>
                                <IconEdit />
                              </button>
                              <button type="button" className={styles.itemCategoryIconBtn} aria-label="Excluir categoria" onClick={() => openDeleteCategory(c)}>
                                <IconTrash />
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className={styles.itemCategoriesEmpty}>Nenhuma categoria cadastrada ainda.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {isFornecedorModalOpen && fornecedorModalKey ? (
          <div className={styles.modalOverlay} role="presentation" onClick={closeFornecedorModal}>
            <div className={`${styles.modal} ${styles.fornecedorProdutosModal}`} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitle}>{fornecedorModalLabel || fornecedorModalKey}</div>
                <button type="button" className={styles.modalClose} aria-label="Fechar" onClick={closeFornecedorModal}>
                  ×
                </button>
              </div>

              <div className={styles.fornecedorProdutosTop}>
                <div className={styles.fornecedorProdutosTopCard}>
                  <div className={styles.fornecedorProdutosTopIcon} aria-hidden>
                    <IconUser />
                  </div>
                  <div className={styles.fornecedorProdutosTopText}>
                    <div className={styles.fornecedorProdutosTopLabel}>Vendedor</div>
                    <div className={styles.fornecedorProdutosTopValue}>{fornecedorModalVendedor || "-"}</div>
                  </div>
                </div>

                <div className={styles.fornecedorProdutosTopCard}>
                  <div className={styles.fornecedorProdutosTopIcon} aria-hidden>
                    <IconPin />
                  </div>
                  <div className={styles.fornecedorProdutosTopText}>
                    <div className={styles.fornecedorProdutosTopLabel}>Endereço</div>
                    <div className={styles.fornecedorProdutosTopValue}>{fornecedorModalEndereco || "-"}</div>
                  </div>
                </div>
              </div>

              <div className={styles.fornecedorProdutosBody}>
                <div className={styles.fornecedorProdutosTitle}>{`Produtos do Fornecedor (${fornecedorModalProdutos.length})`}</div>
                <div className={styles.fornecedorProdutosSub}>
                  Vincule os produtos a este fornecedor para facilitar o registro de compras e a seleção de itens nas notas.
                </div>

                <div className={styles.fornecedorProdutosAddRow}>
                  <div className={styles.fornecedorProdutoPickWrap}>
                    <div className={styles.fornecedorProdutoPick}>
                      <span className={styles.fornecedorProdutoPickIcon} aria-hidden>
                        <IconSearch />
                      </span>
                      <input
                        className={styles.fornecedorProdutoPickInput}
                        placeholder="Pesquise por itens..."
                        value={fornecedorProdutoQuery}
                        onChange={(e) => {
                          setFornecedorProdutoQuery(e.target.value);
                          setIsFornecedorProdutoMenuOpen(true);
                        }}
                        onFocus={() => setIsFornecedorProdutoMenuOpen(true)}
                      />
                      <button
                        type="button"
                        className={styles.fornecedorProdutoPickChevron}
                        aria-label="Abrir lista"
                        onClick={() => setIsFornecedorProdutoMenuOpen((v) => !v)}
                      >
                        ▾
                      </button>
                    </div>

                    {isFornecedorProdutoMenuOpen ? (
                      <div className={styles.fornecedorProdutoDropdown} role="listbox" aria-label="Produtos disponíveis">
                        {fornecedorProdutoSugestoes.length ? (
                          fornecedorProdutoSugestoes.map((name) => (
                            <button
                              key={name}
                              type="button"
                              className={styles.fornecedorProdutoOption}
                              onClick={() => {
                                setFornecedorProdutoQuery(name);
                                setIsFornecedorProdutoMenuOpen(false);
                              }}
                            >
                              {name}
                            </button>
                          ))
                        ) : (
                          <div className={styles.fornecedorProdutoEmpty}>Nenhum insumo encontrado</div>
                        )}
                      </div>
                    ) : null}
                  </div>

                  <button type="button" className={styles.fornecedorProdutoAddBtn} onClick={addProdutoFornecedor}>
                    + ADD
                  </button>
                </div>

                <div className={styles.fornecedorProdutosList}>
                  {fornecedorModalProdutos.length ? (
                    fornecedorModalProdutos.map((name) => (
                      <div key={name} className={styles.fornecedorProdutosRow}>
                        <div className={styles.fornecedorProdutosNameWrap}>
                          <div className={styles.fornecedorProdutosName}>{name}</div>
                          <div className={styles.fornecedorProdutosEq}>
                            {(() => {
                              const key = fornecedorModalKey.trim().toUpperCase();
                              const map = fornecedorEquivalenciasMap[key]?.find((m) => m.nomeNaNota.toLowerCase() === name.toLowerCase()) ?? null;
                              const eq = map?.insumoEquivalente ?? "";
                              if (!eq) return "-";
                              const qty = String(map?.equivalenteQuantidade ?? "").trim();
                              if (!qty) return eq;
                              const unit = String(map?.equivalenteUnidade ?? "").trim();
                              return unit ? `${eq} - ${qty} ${unit}` : `${eq} - ${qty}`;
                            })()}
                          </div>
                        </div>
                        <button type="button" className={styles.fornecedorProdutosTrash} aria-label="Remover" onClick={() => removeProdutoFornecedor(name)}>
                          <IconTrash />
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className={styles.historyEmpty}>Nenhum produto vinculado para este fornecedor.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {isDeleteItemOpen ? (
          <div className={styles.modalOverlay} role="presentation" onClick={() => setIsDeleteItemOpen(false)}>
            <div className={styles.itemDeleteModal} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitle}>Excluir Item?</div>
                <button type="button" className={styles.modalClose} aria-label="Fechar" onClick={() => setIsDeleteItemOpen(false)}>
                  ×
                </button>
              </div>

              <div className={styles.itemDeleteBody}>
                <div className={styles.itemDeleteIcon}>
                  <IconTrash />
                </div>
                <div className={styles.itemDeleteText}>
                  Caso exclua o item <strong>“{selectedInsumo?.item ?? historyItem?.item ?? ""}”</strong> não poderá recuperá-lo.
                </div>
              </div>

              <div className={styles.itemDeleteActions}>
                <button type="button" className={styles.itemDeleteConfirm} onClick={confirmDeleteSelected}>
                  Excluir
                </button>
                <button type="button" className={styles.itemDeleteCancel} onClick={() => setIsDeleteItemOpen(false)}>
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {isDeleteCategoryOpen ? (
          <div className={styles.modalOverlay} role="presentation" onClick={cancelDeleteCategory}>
            <div className={styles.itemDeleteModal} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitle}>Excluir Categoria?</div>
                <button type="button" className={styles.modalClose} aria-label="Fechar" onClick={cancelDeleteCategory}>
                  ×
                </button>
              </div>

              <div className={styles.itemDeleteBody}>
                <div className={styles.itemDeleteIcon}>
                  <IconTrash />
                </div>
                <div className={styles.itemDeleteText}>
                  Caso exclua a categoria <strong>“{deletingCategoryName}”</strong> nao podera recupera-la.
                  {deletingCategoryCount ? (
                    <>
                      <br />
                      Existem <strong>{deletingCategoryCount}</strong> itens nessa categoria; eles ficarao sem categoria.
                    </>
                  ) : null}
                </div>
              </div>

              <div className={styles.itemDeleteActions}>
                <button type="button" className={styles.itemDeleteConfirm} onClick={confirmDeleteCategory}>
                  Excluir
                </button>
                <button type="button" className={styles.itemDeleteCancel} onClick={cancelDeleteCategory}>
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {isVariacaoOpen ? (
          <div className={styles.modalOverlay} role="presentation" onClick={() => setIsVariacaoOpen(false)}>
            <div className={styles.modal} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitle}>Variação de Preço dos Insumos</div>
                <button type="button" className={styles.modalClose} aria-label="Fechar" onClick={() => setIsVariacaoOpen(false)}>
                  ×
                </button>
              </div>

              <div className={styles.modalBody}>
                <div className={styles.variacaoTable}>
                  <div className={styles.variacaoHead}>
                    <div className={styles.variacaoThItem}>Item</div>
                    <div className={styles.variacaoTh}>Custo inicial</div>
                    <div className={styles.variacaoTh}>Custo final</div>
                    <div className={styles.variacaoTh}>Variação</div>
                  </div>

                  {variacaoRows.map((r) => {
                    const pct = Number.isFinite(r.pct) ? r.pct : 0;
                    const tone = pct > 0 ? styles.variacaoRed : pct < 0 ? styles.variacaoGreen : styles.variacaoMuted;
                    return (
                      <div
                        key={r.id}
                        className={styles.variacaoRow}
                        role="button"
                        tabIndex={0}
                        onClick={() => openVariacaoItem(r)}
                        onKeyDown={(e) => {
                          if (e.key !== "Enter" && e.key !== " ") return;
                          e.preventDefault();
                          openVariacaoItem(r);
                        }}
                      >
                        <div className={styles.variacaoItem}>
                          <button
                            type="button"
                            className={styles.variacaoItemBtn}
                            onClick={(e) => {
                              e.stopPropagation();
                              openVariacaoItem(r);
                            }}
                          >
                            {r.item}
                          </button>
                        </div>
                        <div className={styles.variacaoCell}>{formatBrlFromCents(r.startCost)}</div>
                        <div className={styles.variacaoCell}>{formatBrlFromCents(r.endCost)}</div>
                        <div className={`${styles.variacaoCell} ${tone}`}>{`${pct.toLocaleString("pt-BR", {
                          minimumFractionDigits: 1,
                          maximumFractionDigits: 1,
                        })}%`}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <div style={{ height: 72, width: "100%" }} />
        </div>
      </main>
    </div>
  );
}
