"use client";

import { useEffect, useMemo, useState } from "react";
import dash from "../dashboard/dashboard.module.css";
import { type PrePreparoEtiquetaRow, readPrePreparoEtiquetasFromStore, subscribePrePreparoEtiquetas, writePrePreparoEtiquetasToStore } from "../lib/prePreparoEtiquetasStore";
import { loadPrePreparoEtiquetasFromSupabase } from "../lib/prePreparoEtiquetasSupabase";

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

export default function AppSidebar({ active }: { active: SidebarKey }) {
  const [etiquetas, setEtiquetas] = useState<PrePreparoEtiquetaRow[]>(() => readPrePreparoEtiquetasFromStore());

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

  return (
    <aside className={dash.menuLateral}>
      <div className={dash.menuTop}>
        <div className={dash.brand}>
          <img src="/dashboard/ml7hdudz-jry958l.svg" alt="CMV Fácil" className={dash.brandImg} />
        </div>

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
          <a className={navClass(active, "dashboard")} href="/dashboard">
            <span className={dash.navIcon}><IconCmv /></span>
            CMV Real
          </a>
          <a className={navClass(active, "lista-compras")} href="/lista-de-compras">
            <span className={dash.navIcon}><IconChecklist /></span>
            Lista de Compras
          </a>
          <a className={navClass(active, "fichas-tecnicas")} href="/fichas-tecnicas">
            <span className={dash.navIcon}><IconClipboard /></span>
            Fichas Técnicas
          </a>
        </div>

        <div className={dash.group}>
          <p className={dash.groupTitle}>Cadastros</p>
          <a className={navClass(active, "insumos")} href="/insumos">
            <span className={dash.navIcon}><IconCube /></span>
            Insumos
          </a>
          <a className={navClass(active, "pre-preparo")} href="/pre-preparo">
            <span className={dash.navIcon}><IconBowl /></span>
            Pré-Preparo
          </a>
          <a className={navClass(active, "fornecedores")} href="/fornecedores">
            <span className={dash.navIcon}><IconStore /></span>
            Fornecedores
          </a>
        </div>

        <div className={dash.group}>
          <p className={dash.groupTitle}>Rotina</p>
          <a className={navClass(active, "entradas")} href="/entradas">
            <span className={dash.navIcon}><IconBasket /></span>
            Entradas
          </a>
          <a className={navClass(active, "inventario")} href="/inventario">
            <span className={dash.navIcon}><IconLayers /></span>
            Inventário
          </a>
          <a className={navClass(active, "desperdicios")} href="/desperdicios">
            <span className={dash.navIcon}><IconCookie /></span>
            <span className={dash.navLabel}>Desperdícios</span>
            {etiquetasVencidasPendentes > 0 ? <span className={dash.navBadge}>{etiquetasVencidasPendentes}</span> : null}
          </a>
        </div>

        <div className={dash.group}>
          <p className={dash.groupTitle}>Configurações</p>
          <a className={navClass(active, "ajustes")} href="/ajustes">
            <span className={dash.navIcon}><IconGear /></span>
            Ajustes
          </a>
          <a className={navClass(active, "suporte")} href="/suporte">
            <span className={dash.navIcon}><IconChat /></span>
            Suporte
          </a>
        </div>
      </div>
    </aside>
  );
}
