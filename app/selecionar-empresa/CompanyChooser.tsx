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
  const [editing, setEditing] = useState<Company | null>(null);
  const [editName, setEditName] = useState("");
  const [saving, setSaving] = useState(false);

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

  const saveEdit = async () => {
    if (!editing || editName.trim().length < 2 || saving) return;
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/companies", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ companyId: editing.id, name: editName.trim() }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Não foi possível editar o perfil.");
      setCompanies(current => current.map(company => company.id === editing.id ? { ...company, name: editName.trim() } : company));
      clearMeStore(); setEditing(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível editar o perfil."); }
    finally { setSaving(false); }
  };

  const remove = async (company: Company) => {
    if (!window.confirm(`Remover o perfil “${company.name}” desta conta? Os dados da empresa serão preservados.`)) return;
    setSelecting(company.id); setError("");
    try {
      const response = await fetch("/api/companies", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ companyId: company.id }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) throw new Error(payload?.error === "last_company_cannot_be_removed" ? "O último perfil da conta não pode ser removido." : payload?.error || "Não foi possível remover o perfil.");
      setCompanies(current => current.filter(item => item.id !== company.id)); clearMeStore();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível remover o perfil."); }
    finally { setSelecting(""); }
  };

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
        {companies.map((company, index) => <div key={company.id} className={styles.profileWrap}>
          <button className={styles.companyCard} disabled={Boolean(selecting)} onClick={() => void choose(company.id)}>
            <span className={`${styles.avatar} ${styles[`tone${index % 5}`]}`}>{selecting === company.id ? <i className={styles.smallLoader} /> : initials(company.name)}</span>
            <strong>{company.name}</strong><small>{selecting === company.id ? "Abrindo perfil…" : company.role}</small>
          </button>
          {company.role === "Administrador" ? <div className={styles.profileActions}>
            <button type="button" disabled={Boolean(selecting)} onClick={() => { setEditing(company); setEditName(company.name); }}>✎ Editar</button>
            <button type="button" className={styles.removeAction} disabled={Boolean(selecting) || companies.length <= 1} onClick={() => void remove(company)}>Remover</button>
          </div> : null}
        </div>)}
        {canAddCompany ? <button className={`${styles.companyCard} ${styles.addProfile}`} disabled={Boolean(selecting)} onClick={() => window.location.assign("/cadastro-empresa?profile=1")}>
          <span className={styles.avatar}>＋</span><strong>Adicionar perfil</strong><small>{companies.length}/4 perfis utilizados</small>
        </button> : null}
        {companies.length > 1 ? <button className={`${styles.companyCard} ${styles.consolidated}`} disabled={Boolean(selecting)} onClick={() => window.location.assign("/consolidado")}><span className={styles.avatar}>▦</span><strong>Visão geral</strong><small>Comparar todas as empresas</small></button> : null}
      </div> : null}
      {error ? <div className={styles.error}>{error}<button onClick={() => window.location.reload()}>Tentar novamente</button></div> : null}
    </section>
    {editing ? <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-label="Editar perfil" onClick={event => { if (event.target === event.currentTarget && !saving) setEditing(null); }}>
      <form className={styles.editModal} onSubmit={event => { event.preventDefault(); void saveEdit(); }}>
        <h2>Editar perfil</h2><p>Altere o nome exibido na seleção de empresas.</p>
        <label>Nome da empresa<input autoFocus value={editName} maxLength={120} onChange={event => setEditName(event.target.value)} /></label>
        <div><button type="button" onClick={() => setEditing(null)} disabled={saving}>Cancelar</button><button type="submit" disabled={saving || editName.trim().length < 2}>{saving ? "Salvando…" : "Salvar"}</button></div>
      </form>
    </div> : null}
  </main>;
}
