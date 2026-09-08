"use client";

import { useCallback, useEffect, useState } from "react";
import { clearMeStore } from "../lib/meStore";
import styles from "./selecionar-empresa.module.css";

type Company = { id: string; name: string; role: "Administrador" | "Colaborador" };

function safeNext() {
  const value = new URLSearchParams(window.location.search).get("next") ?? "/dashboard";
  return value.startsWith("/") && !value.startsWith("//") && !value.includes("://") && !value.startsWith("/selecionar-empresa") && !value.startsWith("/consolidado") ? value : "/dashboard";
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "CM";
}

export default function CompanyChooser() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [selecting, setSelecting] = useState("");
  const [error, setError] = useState("");
  const [canAddCompany, setCanAddCompany] = useState(false);

  const choose = useCallback(async (companyId: string) => {
    setSelecting(companyId);
    setError("");
    try {
      const response = await fetch("/api/companies/active", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ companyId }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Não foi possível abrir esta empresa.");
      clearMeStore();
      window.location.replace(safeNext());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível abrir esta empresa.");
      setSelecting("");
    }
  }, []);

  useEffect(() => {
    fetch(`/api/me?ts=${Date.now()}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Não foi possível carregar suas empresas.");
        const list = (Array.isArray(payload.companies) ? payload.companies : []).map((company: unknown) => {
          const row = company as { id?: unknown; name?: unknown; role?: unknown };
          return { id: String(row?.id ?? ""), name: String(row?.name ?? "Empresa"), role: String(row?.role ?? "Colaborador") === "Administrador" ? "Administrador" : "Colaborador" } as Company;
        }).filter((company: Company) => company.id);
        setCompanies(list);
        setCanAddCompany(payload.canAddCompany === true);
        setLoading(false);
      })
      .catch((reason) => { setError(reason instanceof Error ? reason.message : "Não foi possível carregar suas empresas."); setLoading(false); });
  }, [choose]);

  return <main className={styles.page}>
    <header><div className={styles.brand}>cmv<span>fácil</span></div><button onClick={() => fetch("/api/auth/logout", { method: "POST" }).finally(() => window.location.replace("/login"))}>Sair</button></header>
    <section className={styles.content}>
      <p className={styles.eyebrow}>SUA OPERAÇÃO</p>
      <h1>{loading ? "Preparando suas empresas…" : "Qual empresa você quer acessar?"}</h1>
      <p className={styles.subtitle}>{loading ? "Só um instante. Estamos organizando seus acessos." : "Escolha seu perfil para entrar. Por segurança, essa escolha é solicitada em todo novo acesso."}</p>
      {loading ? <div className={styles.loader}><i /><strong>Carregando empresas…</strong></div> : null}
      {!loading ? <div className={styles.grid}>
        {companies.map((company, index) => <button key={company.id} className={styles.companyCard} disabled={Boolean(selecting)} onClick={() => void choose(company.id)}>
          <span className={`${styles.avatar} ${styles[`tone${index % 5}`]}`}>{selecting === company.id ? <i className={styles.smallLoader} /> : initials(company.name)}</span>
          <strong>{company.name}</strong><small>{selecting === company.id ? "Abrindo perfil…" : company.role}</small>
        </button>)}
        {canAddCompany ? <button className={`${styles.companyCard} ${styles.addProfile}`} disabled={Boolean(selecting)} onClick={() => window.location.assign("/cadastro-empresa?profile=1")}>
          <span className={styles.avatar}>＋</span><strong>Adicionar perfil</strong><small>{companies.length}/4 perfis utilizados</small>
        </button> : null}
        {companies.length > 1 ? <button className={`${styles.companyCard} ${styles.consolidated}`} disabled={Boolean(selecting)} onClick={() => window.location.assign("/consolidado")}><span className={styles.avatar}>▦</span><strong>Visão geral</strong><small>Comparar todas as empresas</small></button> : null}
      </div> : null}
      {error ? <div className={styles.error}>{error}<button onClick={() => window.location.reload()}>Tentar novamente</button></div> : null}
    </section>
  </main>;
}

