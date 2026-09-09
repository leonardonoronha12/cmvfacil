"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import LoadingSpinner from "../components/LoadingSpinner";
import styles from "./consolidado.module.css";

type Company = { id: string; name: string; items: number; inventories: number; invoices: number; invoiceItems: number; purchasesTotal: number; lastInventoryDate: string | null };
type Payload = { ok: boolean; totals: { companies: number; items: number; inventories: number; invoices: number; invoiceItems: number; purchasesTotal: number }; companies: Company[]; error?: string };

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const TOUR_KEY = "cmvfacil:consolidado:tutorial:v1";
const tourSteps = [
  {
    kicker: "VISÃO GERAL",
    title: "Veja todas as empresas juntas",
    text: "Os cards somam os dados de todas as empresas que você administra. Assim, você confere rapidamente o tamanho e o movimento da operação inteira.",
    bullets: ["Quantidade de empresas", "Insumos e inventários", "Total das compras"],
  },
  {
    kicker: "COMPARAÇÃO POR EMPRESA",
    title: "Compare cada loja na tabela",
    text: "Cada linha representa uma empresa. Use as colunas para identificar lojas sem inventário recente, com poucas entradas ou com valores de compras diferentes do esperado.",
    bullets: ["Uma linha por empresa", "Entradas e itens comprados", "Última contagem"],
  },
  {
    kicker: "EMPRESA ATIVA",
    title: "Abra os detalhes de uma empresa",
    text: "Para trabalhar nos dados de uma loja específica, volte à seleção de empresas e escolha o perfil desejado. Todas as telas seguintes usarão somente os dados daquela empresa.",
    bullets: ["Troca segura de empresa", "Dados sempre separados", "Você pode rever este tutorial"],
  },
];
function date(value: string | null) {
  if (!value) return "Sem contagem";
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

export default function ConsolidadoClient() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [tourOpen, setTourOpen] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  useEffect(() => {
    fetch(`/api/companies/consolidated?ts=${Date.now()}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as Payload | null;
        if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Não foi possível carregar o consolidado.");
        setData(payload);
      })
      .catch((reason) => setError(String(reason?.message ?? reason)));
    try {
      if (window.localStorage.getItem(TOUR_KEY) !== "done") setTourOpen(true);
    } catch {
      setTourOpen(true);
    }
  }, []);

  const closeTour = () => {
    try { window.localStorage.setItem(TOUR_KEY, "done"); } catch {}
    setTourOpen(false);
    setTourStep(0);
  };
  const step = tourSteps[tourStep];

  return (
    <div className={styles.shell}>
      <main className={styles.main}>
        <header className={styles.pageHeader}><div><p className={styles.eyebrow}>MULTIEMPRESA</p><h1>Visão consolidada</h1><p>Acompanhe todas as empresas que você administra em um só lugar.</p></div><div className={styles.headerActions}><Link href="/selecionar-empresa" className={styles.backButton}>← Escolher empresa</Link><button className={styles.tutorialButton} onClick={() => { setTourStep(0); setTourOpen(true); }}>🎓 Ver tutorial</button></div></header>
        {!data && !error ? <div className={styles.loading}><LoadingSpinner /><strong>Reunindo os dados das suas empresas…</strong></div> : null}
        {error ? <div className={styles.error}>{error}</div> : null}
        {data ? <>
          <section className={styles.cards}>
            <article><span>Empresas</span><strong>{data.totals.companies}</strong></article>
            <article><span>Insumos</span><strong>{data.totals.items}</strong></article>
            <article><span>Inventários</span><strong>{data.totals.inventories}</strong></article>
            <article><span>Entradas</span><strong>{data.totals.invoices}</strong></article>
            <article><span>Compras registradas</span><strong>{money.format(data.totals.purchasesTotal)}</strong></article>
          </section>
          <section className={styles.tableWrap}>
            <table><thead><tr><th>Empresa</th><th>Insumos</th><th>Inventários</th><th>Entradas</th><th>Itens comprados</th><th>Total das compras</th><th>Última contagem</th></tr></thead>
              <tbody>{data.companies.map((company) => <tr key={company.id}><td><strong>{company.name}</strong></td><td>{company.items}</td><td>{company.inventories}</td><td>{company.invoices}</td><td>{company.invoiceItems}</td><td>{money.format(company.purchasesTotal)}</td><td>{date(company.lastInventoryDate)}</td></tr>)}</tbody>
            </table>
          </section>
        </> : null}
      </main>
      {tourOpen ? <div className={styles.tourBackdrop} role="dialog" aria-modal="true" aria-labelledby="consolidado-tour-title">
        <section className={styles.tourCard}>
          <div className={styles.tourTop}><div className={styles.tourBrand}>cmv<span>fácil</span><small>Guia da visão consolidada</small></div><div className={styles.tourCounter}>{tourStep + 1}/{tourSteps.length}</div><button className={styles.tourClose} onClick={closeTour} aria-label="Fechar tutorial">×</button></div>
          <div className={styles.tourBody}><p className={styles.tourKicker}>{step.kicker}</p><h2 id="consolidado-tour-title">{step.title}</h2><p>{step.text}</p><div className={styles.tourBullets}>{step.bullets.map((bullet) => <span key={bullet}>✓ {bullet}</span>)}</div></div>
          <div className={styles.tourProgress}>{tourSteps.map((_, index) => <i key={index} className={index <= tourStep ? styles.tourProgressActive : ""} />)}</div>
          <footer className={styles.tourFooter}><button className={styles.tourSecondary} onClick={closeTour}>Encerrar tutorial</button><div>{tourStep > 0 ? <button className={styles.tourBack} onClick={() => setTourStep((current) => current - 1)}>← Voltar</button> : null}<button className={styles.tourNext} onClick={() => tourStep === tourSteps.length - 1 ? closeTour() : setTourStep((current) => current + 1)}>{tourStep === tourSteps.length - 1 ? "Começar a usar" : "Continuar →"}</button></div></footer>
        </section>
      </div> : null}
    </div>
  );
}
