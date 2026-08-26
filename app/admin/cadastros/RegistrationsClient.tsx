"use client";
import { useEffect, useMemo, useState } from "react";
import base from "../observabilidade/observabilidade.module.css";
import styles from "./registrations.module.css";

type AuthUser = { id: string; email: string | null; created_at: string | null; last_sign_in_at: string | null; banned_until: string | null };
type OldRow = { email: string; authUserId: string | null; companies: Array<{ id: string; name: string }>; companiesCount: number; subscriptionMigrated: boolean; migrationStatus: string };
type Kind = "all" | "legacy" | "migrated" | "new" | "pending";
type Origin = "legacy" | "migrated" | "new" | "pending";
const normalize = (value: string | null | undefined) => String(value || "").trim().toLowerCase();

export default function RegistrationsClient() {
  const [auth, setAuth] = useState<AuthUser[]>([]);
  const [old, setOld] = useState<OldRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<Kind>("all");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/registrations", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const json = await response.json();
        if (!response.ok || !json.ok) throw new Error(json.detail || json.error || "Falha ao carregar cadastros");
        setAuth(json.authUsers || []);
        setOld(json.legacyUsers || []);
      })
      .catch(cause => {
        if (cause?.name !== "AbortError") setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const oldEmails = useMemo(() => new Set(old.map(row => normalize(row.email))), [old]);
  const migrated = old.filter(row => row.subscriptionMigrated);
  const pending = old.filter(row => !row.subscriptionMigrated);
  const newUsers = auth.filter(user => !oldEmails.has(normalize(user.email)));
  const rows = useMemo(() => {
    const all = [
      ...auth.map(user => {
        const legacy = old.find(row => normalize(row.email) === normalize(user.email));
        const origin: Origin = legacy?.subscriptionMigrated ? "migrated" : legacy ? "legacy" : "new";
        return { email: user.email || "Sem e-mail", id: user.id, created: user.created_at, last: user.last_sign_in_at, company: legacy?.companies?.map(company => company.name).join(", ") || "—", origin };
      }),
      ...old.filter(row => !row.authUserId).map(row => ({ email: row.email, id: "—", created: null, last: null, company: row.companies?.map(company => company.name).join(", ") || "—", origin: "pending" as Origin })),
    ];
    return all.filter(row => (kind === "all" || (kind === "legacy" && ["legacy", "migrated", "pending"].includes(row.origin)) || row.origin === kind) && `${row.email} ${row.company}`.toLowerCase().includes(query.toLowerCase()));
  }, [auth, old, kind, query]);

  const monthly = useMemo(() => {
    const result: Array<{ label: string; value: number }> = [];
    for (let index = 5; index >= 0; index--) {
      const date = new Date();
      date.setMonth(date.getMonth() - index);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      result.push({ label: key.slice(5), value: auth.filter(user => String(user.created_at || "").startsWith(key)).length });
    }
    return result;
  }, [auth]);
  const max = Math.max(1, ...monthly.map(month => month.value));
  const originLabel: Record<Origin, string> = { migrated: "Assinatura migrada", legacy: "Sistema antigo", new: "Novo", pending: "Pendente" };

  return <main className={base.page}>
    <header><div><small>ADMINISTRAÇÃO GLOBAL</small><h1>Cadastros e migração</h1><p>Acompanhe usuários do sistema antigo, novas contas e assinaturas transferidas para a plataforma atual.</p></div></header>
    {error && <div className={styles.error}>{error}</div>}
    <div className={styles.summary}>
      <article><span>Total no sistema novo</span><strong>{auth.length}</strong><small>contas no Supabase Auth</small></article>
      <article><span>Vindos do sistema antigo</span><strong>{old.length}</strong><small>identificados no processo de migração</small></article>
      <article><span>Assinaturas migradas</span><strong>{migrated.length}</strong><small>assinatura do Stripe vinculada no sistema novo</small></article>
      <article><span>Pendentes de migração</span><strong>{pending.length}</strong><small>ainda sem assinatura transferida e validada</small></article>
    </div>
    <div className={styles.insight}>
      <section><h2>Novos cadastros — últimos 6 meses</h2><div className={styles.months}>{monthly.map(month => <div key={month.label}><i style={{ height: `${Math.max(3, month.value / max * 100)}px` }} title={`${month.value} cadastros`} /><span>{month.label} · {month.value}</span></div>)}</div></section>
      <section className={styles.legend}><h2>Como interpretar</h2><p><b>Assinatura migrada:</b> assinatura antiga recuperada e vinculada à empresa no sistema novo.</p><p><b>Novo:</b> cadastro criado diretamente na plataforma atual.</p><p><b>Pendente:</b> usuário legado cuja assinatura ainda não foi transferida e validada.</p></section>
    </div>
    <section className={base.panel}>
      <div className={base.heading}><div><h2>Diretório consolidado</h2><p>{loading ? "Carregando o diretório consolidado…" : "Contas e assinaturas reconciliadas por e-mail."}</p></div><input className={styles.search} placeholder="Buscar e-mail ou empresa…" value={query} onChange={event => setQuery(event.target.value)} /></div>
      <div className={styles.tabs}>{([['all','Todos'],['legacy','Sistema antigo'],['migrated','Assinaturas migradas'],['new','Novos'],['pending','Pendentes']] as Array<[Kind,string]>).map(([value,label]) => <button key={value} className={kind === value ? styles.active : ""} onClick={() => setKind(value)}>{label}</button>)}</div>
      {loading ? <div className={styles.loader}>Carregando cadastros…</div> : <div className={styles.directory}><table><thead><tr><th>Usuário</th><th>Origem</th><th>Empresa</th><th>Cadastro no sistema novo</th><th>Último login</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.email}-${index}`}><td><b>{row.email}</b><small>{row.id}</small></td><td><span className={`${styles.badge} ${row.origin === "pending" ? styles.pending : row.origin === "new" ? styles.new : ""}`}>{originLabel[row.origin]}</span></td><td>{row.company}</td><td>{row.created ? new Date(row.created).toLocaleString("pt-BR") : "—"}</td><td>{row.last ? new Date(row.last).toLocaleString("pt-BR") : "—"}</td></tr>)}</tbody></table></div>}
    </section>
  </main>;
}
