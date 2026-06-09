"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import dash from "../dashboard/dashboard.module.css";
import LoadingSpinner from "./LoadingSpinner";
import { bootstrapUserDataOnce } from "../lib/bootstrapUserData";
import { type PrePreparoEtiquetaRow, readPrePreparoEtiquetasFromStore, subscribePrePreparoEtiquetas, writePrePreparoEtiquetasToStore } from "../lib/prePreparoEtiquetasStore";
import { loadPrePreparoEtiquetasFromSupabase } from "../lib/prePreparoEtiquetasSupabase";
import suporteStyles from "../suporte/suporte.module.css";

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

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

type SidebarKey =
  | "dashboard"
  | "lista-compras"
  | "fichas-tecnicas"
  | "insumos"
  | "pre-preparo"
  | "fornecedores"
  | "entradas"
  | "inventario"
  | "desperdicios"
  | "ajustes"
  | "suporte";

function navClass(active: SidebarKey, key: SidebarKey) {
  return key === active ? `${dash.navItem} ${dash.navItemActive}` : dash.navItem;
}

function IconBurgerBadge() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5.25 10.5C5.7 7.63604 8.43351 5.5 12 5.5C15.5665 5.5 18.3 7.63604 18.75 10.5H5.25Z" stroke="#111111" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.5 13.5H19.5" stroke="#111111" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M6 15.75H18" stroke="#111111" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M6.75 18H17.25" stroke="#111111" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M17.8 6.2L19.8 4.2" stroke="#111111" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M19.2 6.8H21.2" stroke="#111111" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function IconCmv() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M9 2.25A6.75 6.75 0 1 0 15.75 9H9V2.25Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10.75 2.48A6.76 6.76 0 0 1 15.52 7.25H10.75V2.48Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconChecklist() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M7.5 4.5H14.25" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M7.5 9H14.25" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M7.5 13.5H14.25" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M3 4.5 4.12 5.62 6 3.75" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 9 4.12 10.12 6 8.25" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconClipboard() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M6.75 3H11.25" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M6.75 2.25H11.25C11.6642 2.25 12 2.58579 12 3V3.75H6V3C6 2.58579 6.33579 2.25 6.75 2.25Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M5.25 3.75H4.5C4.08579 3.75 3.75 4.08579 3.75 4.5V14.25C3.75 14.6642 4.08579 15 4.5 15H13.5C13.9142 15 14.25 14.6642 14.25 14.25V4.5C14.25 4.08579 13.9142 3.75 13.5 3.75H12.75" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6.75 7.5H11.25" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function IconCube() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M9 2.25 14.25 5.25 9 8.25 3.75 5.25 9 2.25Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M14.25 5.25V11.25L9 14.25M9 8.25V14.25M9 8.25 3.75 5.25V11.25L9 14.25" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconBowl() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M3 8.25H15C15 11.5637 12.3137 14.25 9 14.25C5.68629 14.25 3 11.5637 3 8.25Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M2.25 8.25H15.75" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M5.25 6C6 4.5 7.5 3.75 9.75 3.75" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function IconStore() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M3.75 6.75H14.25" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M4.5 6.75 5.25 3.75H12.75L13.5 6.75" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M4.5 6.75V13.5H13.5V6.75" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M7.125 13.5V10.125H10.875V13.5" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function IconBasket() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M3.75 7.5H14.25L13.125 14.25H4.875L3.75 7.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M6.75 7.5 9 3.75 11.25 7.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6.75 9.75V10.5M11.25 9.75V10.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function IconLayers() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M9 3 15 6 9 9 3 6 9 3Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M3.75 9 9 11.625 14.25 9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.75 12 9 14.625 14.25 12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconCookie() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M11.8 3.4C11.8 4.5 12.7 5.4 13.8 5.4C14.28 5.4 14.72 5.24 15.07 4.96C15.52 5.73 15.75 6.61 15.75 7.5C15.75 11.228 12.728 14.25 9 14.25C5.27208 14.25 2.25 11.228 2.25 7.5C2.25 4.18829 4.63714 1.43415 7.78125 1.125C7.62996 1.45165 7.55 1.80745 7.55 2.175C7.55 3.58207 8.69293 4.725 10.1 4.725C10.7336 4.725 11.3131 4.49372 11.7589 4.11104C11.7867 3.87652 11.8 3.63969 11.8 3.4Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="6.2" cy="7.1" r="0.7" fill="currentColor" />
      <circle cx="8.9" cy="9.3" r="0.7" fill="currentColor" />
      <circle cx="6.6" cy="10.8" r="0.7" fill="currentColor" />
    </svg>
  );
}

function IconGear() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M9 6.75A2.25 2.25 0 1 0 9 11.25A2.25 2.25 0 0 0 9 6.75Z" stroke="currentColor" strokeWidth="1.7" />
      <path d="M15 9C15 8.6 14.96 8.22 14.88 7.85L16.12 6.89L14.87 4.73L13.36 5.31C12.79 4.83 12.13 4.47 11.4 4.27L11.18 2.7H8.68L8.46 4.27C7.73 4.47 7.07 4.83 6.5 5.31L4.99 4.73L3.74 6.89L4.98 7.85C4.9 8.22 4.86 8.6 4.86 9C4.86 9.4 4.9 9.78 4.98 10.15L3.74 11.11L4.99 13.27L6.5 12.69C7.07 13.17 7.73 13.53 8.46 13.73L8.68 15.3H11.18L11.4 13.73C12.13 13.53 12.79 13.17 13.36 12.69L14.87 13.27L16.12 11.11L14.88 10.15C14.96 9.78 15 9.4 15 9Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

function IconChat() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M5.25 12.75 2.625 15V5.25C2.625 4.62868 3.12868 4.125 3.75 4.125H14.25C14.8713 4.125 15.375 4.62868 15.375 5.25V11.625C15.375 12.2463 14.8713 12.75 14.25 12.75H5.25Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M6.75 8.4375H6.7575M9 8.4375H9.0075M11.25 8.4375H11.2575" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

function IconChevronRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M10 7l5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconMenu() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4.5 7.5H19.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M4.5 12H19.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M4.5 16.5H19.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6 18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconArrowRight() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M10 7l5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconHeadset() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4.5 12a7.5 7.5 0 0 1 15 0v6.25a1.75 1.75 0 0 1-1.75 1.75H16.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path d="M4.5 12v5.25A1.75 1.75 0 0 0 6.25 19h.25" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path
        d="M6.5 14.25H5.75A1.75 1.75 0 0 1 4 12.5v-1A1.75 1.75 0 0 1 5.75 9.75H6.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M17.5 14.25h.75A1.75 1.75 0 0 0 20 12.5v-1a1.75 1.75 0 0 0-1.75-1.75h-.75"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconBook() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 4.5h9a2.5 2.5 0 0 1 2.5 2.5V19.5a2 2 0 0 0-2-2H7a2.5 2.5 0 0 0-2.5 2.5V7A2.5 2.5 0 0 1 7 4.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M8 8h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8 11h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

const SUPPORT_WA_URL =
  "https://api.whatsapp.com/send?phone=%205513936180830&text=Ol%C3%A1%2C+preciso+de+suporte+no+CMVF%C3%A1cil.";
const HELP_CENTER_URL = "https://cmv-facil.gitbook.io/cmv-facil";

export default function AppSidebar({ active }: { active: SidebarKey }) {
  const [etiquetas, setEtiquetas] = useState<PrePreparoEtiquetaRow[]>(() => readPrePreparoEtiquetasFromStore());
  const [isSupportOpen, setIsSupportOpen] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [bootstrap, setBootstrap] = useState<{ status: "idle" | "running" | "done" | "error"; message: string; progress: number; etaMs: number | null; stage: string }>(
    { status: "idle", message: "", progress: 0, etaMs: null, stage: "" },
  );
  const bootstrapDoneKey = "cmvfacil:bootstrapDone:v5";
  const bootstrapRunningKey = "cmvfacil:bootstrapRunning:v5";
  const bootstrapDoneTtlMs = 10 * 60_000;

  const shouldSkipBootstrap = () => {
    try {
      const raw = (window.sessionStorage.getItem(bootstrapDoneKey) ?? "").trim();
      const t = raw ? Number(raw) : 0;
      if (!t || !Number.isFinite(t)) return false;
      return Date.now() - t < bootstrapDoneTtlMs;
    } catch {
      return false;
    }
  };

  const formatEtaLabel = (ms: number | null) => {
    if (!ms || !Number.isFinite(ms) || ms <= 0) return "";
    const totalMin = Math.max(1, Math.round(ms / 60_000));
    const hours = Math.floor(totalMin / 60);
    const mins = totalMin % 60;
    if (hours >= 1) return `~${hours}h ${mins}min`;
    return `~${totalMin}min`;
  };

  const formatBootstrapErrorLabel = (raw: string) => {
    const msg = String(raw ?? "").trim().toLowerCase();
    if (!msg) return "Não foi possível finalizar a atualização. Tente novamente em instantes.";
    if (msg.includes("unauthorized") || msg.includes("401") || msg.includes("jwt")) return "Sessão expirada. Faça login novamente.";
    if (msg.includes("supabase_not_configured")) return "Supabase não está configurado no servidor. Configure as envs (SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY).";
    if (msg.includes("user_not_supabase_uuid")) return "Seu login atual não é compatível com a importação automática. Faça login usando a conta do Supabase.";
    if (msg.includes("forbidden") || msg.includes("403")) return "Não foi possível atualizar sua conta. Entre em contato com o suporte.";
    if (msg.includes("missing_bubble_credentials") || msg.includes("missing_base_url") || msg.includes("missing_token")) {
      return "Falta configurar o Bubble para importar via API. Vá em Ajustes → Importar Bubble via API e informe a URL e o token.";
    }
    if (msg.includes("no_files_and_bubble_not_configured") || msg.includes("needs_setup") || msg === "no_files") {
      return "Não há dados do Bubble disponíveis para importar ainda. Vá em Ajustes → Importar Bubble (ou Importar Bubble via API) e rode a migração.";
    }
    if (msg.includes("seed_copy_failed")) return "Falha ao copiar o dump base para sua conta. Tente novamente em instantes.";
    if (msg.includes("no_import_files")) return "Não encontrei arquivos válidos do Bubble para importar. Vá em Ajustes → Importar Bubble e envie os arquivos, ou configure a importação via API.";
    if (msg.includes("timeout")) return "A atualização está demorando mais que o esperado. Tente novamente em instantes.";
    return "Não foi possível finalizar a atualização. Tente novamente em instantes.";
  };

  const computeBootstrapProgress = (state: any) => {
    const now = Date.now();
    const phase = String(state?.phase ?? "").trim();

    const isSyncState = state?.perType && typeof state.perType === "object" && !Array.isArray(state.perType);
    if (isSyncState) {
      const pullingWeight = 0.65;
      const importingWeight = 0.35;

      const perType = state.perType as Record<string, any>;
      const types = Array.isArray(state.types) ? (state.types as any[]).map((t) => String(t ?? "").trim()).filter(Boolean) : Object.keys(perType);
      const totalTypes = types.length || 0;
      const doneTypes = types.filter((t) => String(perType?.[t]?.status ?? "") === "done").length;
      const runningType = types.find((t) => String(perType?.[t]?.status ?? "") === "pulling" || String(perType?.[t]?.status ?? "").includes("segment")) ?? null;
      const pullingProgress = totalTypes ? Math.min(1, (doneTypes + (runningType ? 0.35 : 0)) / totalTypes) : 0;

      const domains = Array.isArray(state.import?.domains) ? (state.import.domains as any[]).map((d) => String(d ?? "").trim()).filter(Boolean) : [];
      const importIdx = typeof state.import?.index === "number" && Number.isFinite(state.import.index) ? Math.max(0, state.import.index) : 0;
      const importingProgress = domains.length ? Math.min(1, (importIdx + (String(state.import?.status ?? "") === "running" ? 0.35 : 0)) / domains.length) : 0;

      const stage =
        phase === "pulling" ? "Buscando seus dados" : phase === "importing" ? "Organizando informações" : phase === "done" ? "Concluído" : "Atualizando";

      const progress =
        phase === "pulling"
          ? Math.min(0.99, pullingWeight * pullingProgress)
          : phase === "importing"
            ? Math.min(0.99, pullingWeight + importingWeight * importingProgress)
            : phase === "done"
              ? 1
              : Math.min(0.98, pullingWeight * pullingProgress);

      const startedAt = typeof state.startedAt === "string" ? new Date(state.startedAt).getTime() : 0;
      const elapsed = startedAt ? Math.max(0, now - startedAt) : 0;
      const etaMs = (() => {
        if (phase === "done") return 0;
        const p = Math.max(0.02, Math.min(0.95, progress));
        if (!elapsed) return null;
        const totalEst = elapsed / p;
        const remaining = totalEst - elapsed;
        return Number.isFinite(remaining) && remaining > 0 ? Math.min(4 * 60 * 60_000, remaining) : null;
      })();

      return { progress, etaMs, stage, doneSteps: doneTypes, totalSteps: totalTypes, pendingSteps: Math.max(0, totalTypes - doneTypes), phase };
    }
    const deletingWeight = 0.2;
    const importingWeight = 0.8;

    const tables = Array.isArray(state?.delete?.tables) ? (state.delete.tables as any[]) : [];
    const deleteIndex = typeof state?.delete?.index === "number" && Number.isFinite(state.delete.index) ? Math.max(0, state.delete.index) : 0;
    const deleteTotal = tables.length || 0;
    const deleteDone = deleteTotal ? Math.min(deleteTotal, deleteIndex) : 0;
    const deleteProgress = deleteTotal ? deleteDone / deleteTotal : 0;

    const steps = Array.isArray(state?.steps) ? (state.steps as any[]) : [];
    const totalSteps = steps.length || 0;
    const doneSteps = steps.filter((s) => String(s?.status ?? "") === "done").length;
    const runningStep = steps.find((s) => String(s?.status ?? "") === "running") ?? null;
    const pendingSteps = steps.filter((s) => String(s?.status ?? "") === "pending").length;

    const durations: number[] = [];
    for (const s of steps) {
      if (String(s?.status ?? "") !== "done") continue;
      const started = typeof s?.startedAt === "string" ? new Date(s.startedAt).getTime() : 0;
      const finished = typeof s?.finishedAt === "string" ? new Date(s.finishedAt).getTime() : 0;
      if (!started || !finished) continue;
      const d = finished - started;
      if (Number.isFinite(d) && d > 0) durations.push(d);
    }
    const avgStepMs = (() => {
      if (!durations.length) return 60_000;
      const sum = durations.reduce((a, b) => a + b, 0);
      const avg = sum / durations.length;
      return Math.min(5 * 60_000, Math.max(8_000, avg));
    })();
    const runningElapsedMs = (() => {
      if (!runningStep) return 0;
      const started = typeof runningStep?.startedAt === "string" ? new Date(runningStep.startedAt).getTime() : 0;
      if (!started) return 0;
      return Math.max(0, now - started);
    })();
    const runningFrac = runningStep ? Math.min(0.9, Math.max(0, runningElapsedMs / avgStepMs)) : 0;
    const importingProgress = totalSteps ? Math.min(1, (doneSteps + runningFrac) / totalSteps) : 0;

    const stage =
      phase === "deleting"
        ? "Otimizando dados"
        : phase === "importing"
          ? "Carregando informações"
          : phase === "done"
            ? "Concluído"
            : "Atualizando";

    const progress =
      phase === "deleting"
        ? Math.min(0.99, deletingWeight * deleteProgress)
        : phase === "importing"
          ? Math.min(0.99, deletingWeight + importingWeight * importingProgress)
          : phase === "done"
            ? 1
            : Math.min(0.98, deletingWeight + importingWeight * importingProgress);

    const remainingDeleteMs = (() => {
      if (!deleteTotal) return 0;
      const remaining = Math.max(0, deleteTotal - deleteDone);
      return remaining * 1500;
    })();
    const remainingImportMs = (() => {
      if (!totalSteps) return 0;
      const remainingPending = Math.max(0, totalSteps - doneSteps - (runningStep ? 1 : 0));
      const currentRemaining = runningStep ? Math.max(0, avgStepMs - runningElapsedMs) : 0;
      return remainingPending * avgStepMs + currentRemaining;
    })();
    const etaMs =
      phase === "deleting" ? remainingDeleteMs + remainingImportMs : phase === "importing" ? remainingImportMs : phase === "done" ? 0 : remainingImportMs || null;

    return { progress, etaMs, stage, doneSteps, totalSteps, pendingSteps, phase };
  };

  useEffect(() => {
    setEtiquetas(readPrePreparoEtiquetasFromStore());
    return subscribePrePreparoEtiquetas((rows) => setEtiquetas(rows));
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const dbRows = await loadPrePreparoEtiquetasFromSupabase();
        setEtiquetas(dbRows);
        writePrePreparoEtiquetasToStore(dbRows);
      } catch {
        setEtiquetas(readPrePreparoEtiquetasFromStore());
      }
    })();
  }, []);

  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(bootstrapRunningKey) === "1") return;
    } catch {}
    if (bootstrap.status === "running") return;
    void bootstrapUserDataOnce();
  }, [bootstrap.status]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 720px)");
    const apply = () => setIsMobile(Boolean(mq.matches));
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!isMobile) setIsDrawerOpen(false);
  }, [isMobile]);

  useEffect(() => {
    if (!isSupportOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsSupportOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isSupportOpen]);

  useEffect(() => {
    if (!isDrawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isDrawerOpen]);

  useEffect(() => {
    if (!isDrawerOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsDrawerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isDrawerOpen]);

  useEffect(() => {
    if (active === "ajustes") return;
    if (bootstrap.status === "running") return;
    if (shouldSkipBootstrap()) return;

    setBootstrap({ status: "running", message: "", progress: 0.02, etaMs: null, stage: "Atualizando" });
    void (async () => {
      try {
        let bubbleBaseUrl = "";
        let bubbleToken = "";
        try {
          bubbleBaseUrl = (window.localStorage.getItem("cmvfacil:bubbleBaseUrl") ?? "").trim();
          bubbleToken = (window.localStorage.getItem("cmvfacil:bubbleToken") ?? "").trim();
        } catch {}
        const res = await fetch("/api/bubble-import/ensure", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ baseUrl: bubbleBaseUrl || undefined, token: bubbleToken || undefined }),
          cache: "no-store",
        });
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok || !json?.ok) {
          const msg = String(json?.error ?? `failed_${res.status}`);
          setBootstrap({ status: "error", message: msg, progress: 0, etaMs: null, stage: "" });
          return;
        }

        const status = String(json?.status ?? "");
        if (status === "ready") {
          try {
            window.sessionStorage.removeItem(bootstrapRunningKey);
            window.sessionStorage.setItem(bootstrapDoneKey, String(Date.now()));
          } catch {
            // ignore
          }
          setBootstrap({ status: "done", message: "", progress: 1, etaMs: 0, stage: "" });
          return;
        }
        if (status === "needs_setup" || status === "no_files") {
          const msg = String(json?.reason ?? "no_files");
          setBootstrap({ status: "error", message: msg, progress: 0, etaMs: null, stage: "" });
          return;
        }

        const statePath = String(json?.state?.statePath ?? "");
        const mode = String(json?.mode ?? "");
        if (!statePath) {
          setBootstrap({ status: "done", message: "", progress: 1, etaMs: 0, stage: "" });
          return;
        }

        try {
          window.sessionStorage.setItem(bootstrapRunningKey, "1");
          window.sessionStorage.removeItem(bootstrapDoneKey);
        } catch {}

        const tickUrl = mode === "sync" ? "/api/bubble-import/sync/tick" : "/api/bubble-import/rebuild/tick";
        const importAsUserId = mode === "sync" ? String(json?.userId ?? "").trim() : "";

        for (let i = 0; i < 2000; i++) {
          await sleep(1200);
          const tickRes = await fetch(tickUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body:
              mode === "sync"
                ? JSON.stringify({
                    statePath,
                    resume: true,
                    maxOps: 12,
                    baseUrl: bubbleBaseUrl || undefined,
                    token: bubbleToken || undefined,
                    importAsUserId: importAsUserId || undefined,
                  })
                : JSON.stringify({ statePath }),
            cache: "no-store",
          });
          const tickJson = (await tickRes.json().catch(() => null)) as any;
          if (!tickRes.ok || !tickJson?.ok) {
            const msg = String(tickJson?.error ?? `failed_${tickRes.status}`);
            setBootstrap({ status: "error", message: msg, progress: 0, etaMs: null, stage: "" });
            try {
              window.sessionStorage.removeItem(bootstrapRunningKey);
            } catch {}
            return;
          }

          const meta = computeBootstrapProgress(tickJson?.state ?? {});
          setBootstrap((prev) => {
            if (prev.status !== "running") return prev;
            const nextProgress = Math.max(prev.progress, meta.progress || 0);
            const etaMs = meta.etaMs && Number.isFinite(meta.etaMs) ? Math.max(0, meta.etaMs) : null;
            return { ...prev, progress: nextProgress, etaMs, stage: meta.stage || prev.stage };
          });

          const phase = String(tickJson?.state?.phase ?? "");
          if (phase === "done") {
            try {
              window.sessionStorage.removeItem(bootstrapRunningKey);
              window.sessionStorage.setItem(bootstrapDoneKey, String(Date.now()));
            } catch {}
            setBootstrap({ status: "done", message: "", progress: 1, etaMs: 0, stage: "" });
            window.location.reload();
            return;
          }
          if (phase === "error") {
            const msg = mode === "sync"
              ? String(tickJson?.state?.lastError ?? "") || String(tickJson?.state?.import?.lastError ?? "") || "failed"
              : String(tickJson?.state?.delete?.lastError ?? "") ||
                String((Array.isArray(tickJson?.state?.steps) ? tickJson.state.steps.find((s: any) => s?.status === "error")?.lastError : "") ?? "") ||
                "failed";
            setBootstrap({ status: "error", message: msg, progress: 0, etaMs: null, stage: "" });
            try {
              window.sessionStorage.removeItem(bootstrapRunningKey);
            } catch {}
            return;
          }
        }

        setBootstrap({ status: "error", message: "timeout", progress: 0, etaMs: null, stage: "" });
      } catch (err) {
        setBootstrap({ status: "error", message: err instanceof Error ? err.message : String(err), progress: 0, etaMs: null, stage: "" });
      }
    })();
  }, [active, bootstrap.status]);

  const etiquetasVencidasPendentes = useMemo(() => {
    const now = new Date();
    const todayT = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    let count = 0;
    for (const e of etiquetas) {
      const validade = parseDateLabelLoose(e.dataValidade);
      if (!validade) continue;
      const t = new Date(validade.getFullYear(), validade.getMonth(), validade.getDate()).getTime();
      if (t >= todayT) continue;
      const status = (e.wasteStatus ?? "pending") as "pending" | "launched" | "ignored";
      if (status !== "pending") continue;
      count += 1;
    }
    return count;
  }, [etiquetas]);

  const activeTitle =
    active === "dashboard"
      ? "CMV Real"
      : active === "lista-compras"
        ? "Lista de Compras"
        : active === "fichas-tecnicas"
          ? "Fichas Técnicas"
          : active === "insumos"
            ? "Insumos"
            : active === "pre-preparo"
              ? "Pré-Preparo"
              : active === "fornecedores"
                ? "Fornecedores"
                : active === "entradas"
                  ? "Entradas"
                  : active === "inventario"
                    ? "Inventário"
                    : active === "desperdicios"
                      ? "Desperdícios"
                      : active === "ajustes"
                        ? "Ajustes"
                        : "Suporte";

  const closeDrawer = () => {
    if (isMobile) setIsDrawerOpen(false);
  };

  const sidebarBody = (includeBrand: boolean) => (
    <>
      <div className={dash.menuTop}>
        {includeBrand ? (
          <div className={dash.brand}>
            <img src="/dashboard/ml7hdudz-jry958l.svg" alt="CMV Fácil" className={dash.brandImg} />
          </div>
        ) : null}

        <div className={dash.companyCard}>
          <div className={dash.companyAvatar} aria-hidden>
            <IconBurgerBadge />
          </div>
          <div className={dash.companyMeta}>
            <p className={dash.companyName}>Gold Burger - Ocian</p>
            <p className={dash.companyPlan}>PRO Mensal</p>
          </div>
        </div>

        <div className={dash.group}>
          <p className={dash.groupTitle}>Relatórios</p>
          <a className={navClass(active, "dashboard")} href="/dashboard" onClick={closeDrawer}>
            <span className={dash.navIcon}><IconCmv /></span>
            CMV Real
          </a>
          <a className={navClass(active, "lista-compras")} href="/lista-de-compras" onClick={closeDrawer}>
            <span className={dash.navIcon}><IconChecklist /></span>
            Lista de Compras
          </a>
          <a className={navClass(active, "fichas-tecnicas")} href="/fichas-tecnicas" onClick={closeDrawer}>
            <span className={dash.navIcon}><IconClipboard /></span>
            Fichas Técnicas
          </a>
        </div>

        <div className={dash.group}>
          <p className={dash.groupTitle}>Cadastros</p>
          <a className={navClass(active, "insumos")} href="/insumos" onClick={closeDrawer}>
            <span className={dash.navIcon}><IconCube /></span>
            Insumos
          </a>
          <a className={navClass(active, "pre-preparo")} href="/pre-preparo" onClick={closeDrawer}>
            <span className={dash.navIcon}><IconBowl /></span>
            Pré-Preparo
          </a>
          <a className={navClass(active, "fornecedores")} href="/fornecedores" onClick={closeDrawer}>
            <span className={dash.navIcon}><IconStore /></span>
            Fornecedores
          </a>
        </div>

        <div className={dash.group}>
          <p className={dash.groupTitle}>Rotina</p>
          <a className={navClass(active, "entradas")} href="/entradas" onClick={closeDrawer}>
            <span className={dash.navIcon}><IconBasket /></span>
            Entradas
          </a>
          <a className={navClass(active, "inventario")} href="/inventario" onClick={closeDrawer}>
            <span className={dash.navIcon}><IconLayers /></span>
            Inventário
          </a>
          <a className={navClass(active, "desperdicios")} href="/desperdicios" onClick={closeDrawer}>
            <span className={dash.navIcon}><IconCookie /></span>
            <span className={dash.navLabel}>Desperdícios</span>
            {etiquetasVencidasPendentes > 0 ? <span className={dash.navBadge}>{etiquetasVencidasPendentes}</span> : null}
          </a>
        </div>

        <div className={dash.group}>
          <p className={dash.groupTitle}>Configurações</p>
          <a className={navClass(active, "ajustes")} href="/ajustes" onClick={closeDrawer}>
            <span className={dash.navIcon}><IconGear /></span>
            Ajustes
          </a>
          <a
            className={navClass(active, "suporte")}
            href="/suporte"
            onClick={(e) => {
              e.preventDefault();
              setIsSupportOpen(true);
              setIsDrawerOpen(false);
            }}
          >
            <span className={dash.navIcon}><IconChat /></span>
            Suporte
          </a>
        </div>
      </div>

      <div className={dash.menuBottom}>
        <a className={dash.userDropdown} href="/ajustes?tab=minha-conta" onClick={closeDrawer}>
          <div className={dash.userLeft}>
            <div className={dash.userAvatar} aria-hidden>
              <IconBurgerBadge />
            </div>
            <p className={dash.userHello}>Olá, Gold Burger</p>
          </div>
          <span className={dash.userChevron} aria-hidden>
            <IconChevronRight />
          </span>
        </a>
      </div>
    </>
  );

  return (
    <>
      {bootstrap.status === "running"
        ? createPortal(
            <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.18)",
                zIndex: 90,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 16,
              }}
            >
              <div
                style={{
                  background: "#ffffff",
                  border: "1px solid #e4e8e7",
                  borderRadius: 14,
                  padding: "12px 14px",
                  maxWidth: 520,
                  width: "100%",
                  boxShadow: "0 18px 50px rgba(0,0,0,0.16)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", columnGap: 10, marginBottom: 8 }}>
                  <div style={{ width: 18, height: 18 }}>
                    <LoadingSpinner />
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "#01040e" }}>Atualizando o sistema</div>
                </div>

                <div style={{ fontSize: 13, color: "#292d2d", lineHeight: "18px", marginBottom: 12 }}>
                  Estamos sincronizando as informações da sua conta. Isso pode levar alguns minutos.
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
                  <div style={{ fontSize: 12, color: "#111111", fontWeight: 700 }}>{bootstrap.stage ? bootstrap.stage : "Atualizando"}</div>
                  <div style={{ fontSize: 12, color: "#292d2d" }}>
                    {Math.round(Math.max(0, Math.min(1, bootstrap.progress)) * 100)}% • Tempo estimado:{" "}
                    {formatEtaLabel(bootstrap.etaMs) ? formatEtaLabel(bootstrap.etaMs) : "calculando..."}
                  </div>
                </div>

                <div style={{ width: "100%", height: 10, borderRadius: 999, background: "#e9eeed", overflow: "hidden" }}>
                  <div
                    style={{
                      width: `${Math.round(Math.max(0, Math.min(1, bootstrap.progress)) * 100)}%`,
                      height: "100%",
                      borderRadius: 999,
                      background: "linear-gradient(90deg, #0ab86d, #22c55e)",
                      transition: "width 350ms ease",
                    }}
                  />
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
      {bootstrap.status === "error" && bootstrap.message ? (
        <div style={{ position: "fixed", left: 210, right: 16, top: 10, zIndex: 91 }}>
          <div
            style={{
              background: "#fff3f5",
              border: "1px solid #ffd0d8",
              borderRadius: 12,
              padding: "10px 12px",
              color: "#b1002c",
              fontSize: 13,
              boxShadow: "0 10px 28px rgba(0,0,0,0.10)",
            }}
          >
            {formatBootstrapErrorLabel(bootstrap.message)}
          </div>
        </div>
      ) : null}
      <div className={dash.mobileTopBar}>
        <div className={dash.mobileDrawerBrand}>
          <img src="/dashboard/ml7hdudz-jry958l.svg" alt="CMV Fácil" className={dash.brandImg} />
          <div className={dash.mobileDrawerTitle}>{activeTitle}</div>
        </div>
        <button type="button" className={dash.mobileMenuBtn} onClick={() => setIsDrawerOpen(true)} aria-label="Abrir menu">
          <IconMenu />
        </button>
      </div>

      {!isMobile ? <aside className={dash.menuLateral}>{sidebarBody(true)}</aside> : null}

      {isMobile && isDrawerOpen
        ? createPortal(
            <div
              className={dash.mobileDrawerOverlay}
              role="presentation"
              onClick={(e) => {
                if (e.target === e.currentTarget) setIsDrawerOpen(false);
              }}
            >
              <aside className={`${dash.menuLateral} ${dash.mobileDrawer}`} role="dialog" aria-modal="true" aria-label="Menu">
                <div className={dash.mobileDrawerHeader}>
                  <div className={dash.mobileDrawerBrand}>
                    <img src="/dashboard/ml7hdudz-jry958l.svg" alt="CMV Fácil" className={dash.brandImg} />
                    <div className={dash.mobileDrawerTitle}>{activeTitle}</div>
                  </div>
                  <button type="button" className={dash.mobileMenuBtn} onClick={() => setIsDrawerOpen(false)} aria-label="Fechar menu">
                    <IconClose />
                  </button>
                </div>
                {sidebarBody(false)}
              </aside>
            </div>,
            document.body,
          )
        : null}

      {isSupportOpen
        ? createPortal(
            <div
              className={suporteStyles.modalOverlay}
              role="dialog"
              aria-modal="true"
              aria-label="Suporte"
              onClick={(e) => {
                if (e.target === e.currentTarget) setIsSupportOpen(false);
              }}
            >
              <div className={suporteStyles.modalCard}>
                <div className={suporteStyles.modalHeader}>
                  <div className={suporteStyles.modalTitle}>Como podemos te ajudar?</div>
                  <button
                    type="button"
                    className={suporteStyles.modalClose}
                    onClick={() => setIsSupportOpen(false)}
                    aria-label="Fechar"
                  >
                    <IconClose />
                  </button>
                </div>

                <div className={suporteStyles.modalBody}>
                  <a
                    className={suporteStyles.optionCard}
                    href={SUPPORT_WA_URL}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => setIsSupportOpen(false)}
                  >
                    <div className={suporteStyles.optionLeft}>
                      <span className={suporteStyles.optionIcon} aria-hidden>
                        <IconHeadset />
                      </span>
                      <div className={suporteStyles.optionText}>
                        <div className={suporteStyles.optionTitle}>Falar com Suporte</div>
                        <div className={suporteStyles.optionDesc}>Atendente humano para te ajudar com dúvidas ou problemas.</div>
                      </div>
                    </div>
                    <span className={suporteStyles.optionArrow} aria-hidden>
                      <IconArrowRight />
                    </span>
                  </a>

                  <a
                    className={suporteStyles.optionCard}
                    href={HELP_CENTER_URL}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => setIsSupportOpen(false)}
                  >
                    <div className={suporteStyles.optionLeft}>
                      <span className={suporteStyles.optionIcon} aria-hidden>
                        <IconBook />
                      </span>
                      <div className={suporteStyles.optionText}>
                        <div className={suporteStyles.optionTitle}>Central de Ajuda</div>
                        <div className={suporteStyles.optionDesc}>Guias e instruções para usar o CMV Fácil sem dificuldades.</div>
                      </div>
                    </div>
                    <span className={suporteStyles.optionArrow} aria-hidden>
                      <IconArrowRight />
                    </span>
                  </a>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
