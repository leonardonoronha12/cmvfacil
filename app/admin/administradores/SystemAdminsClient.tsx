"use client";
import { FormEvent, useCallback, useEffect, useState } from "react";
import base from "../observabilidade/observabilidade.module.css";
import styles from "./systemAdmins.module.css";

type Admin = { id: string; user_id: string; email: string; name: string | null; active: boolean; created_at: string; updated_at: string };
const messages: Record<string, string> = {
  auth_user_not_found: "Esse e-mail ainda não possui uma conta no sistema novo.",
  cannot_disable_self: "Você não pode desativar o próprio acesso administrativo.",
  cannot_remove_self: "Você não pode remover o próprio acesso administrativo.",
};

export default function SystemAdminsClient() {
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/system-admins", { cache: "no-store" });
    const json = await response.json();
    if (!response.ok || !json.ok) throw new Error(json.detail || json.error || "Falha ao carregar administradores");
    setAdmins(json.admins || []);
    setCurrentUserId(json.currentUserId || "");
  }, []);
  useEffect(() => { load().catch(cause => setError(cause.message)); }, [load]);

  async function request(method: string, body?: unknown, id?: string) {
    setError("");
    const response = await fetch(`/api/admin/system-admins${id ? `?id=${encodeURIComponent(id)}` : ""}`, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    const json = await response.json();
    if (!response.ok || !json.ok) throw new Error(messages[json.error] || json.detail || json.error || "Operação não concluída");
    await load();
  }

  async function create(event: FormEvent) {
    event.preventDefault(); setBusy("create");
    try { await request("POST", { email, name }); setEmail(""); setName(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(""); }
  }

  async function update(admin: Admin, active = admin.active) {
    setBusy(admin.id);
    try { await request("PATCH", { id: admin.id, name: editing === admin.id ? editName : admin.name, active }); setEditing(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(""); }
  }

  async function remove(admin: Admin) {
    if (!window.confirm(`Remover o acesso administrativo de ${admin.email}?`)) return;
    setBusy(admin.id);
    try { await request("DELETE", undefined, admin.id); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(""); }
  }

  return <main className={base.page}>
    <header><div><small>CONTROLE DE ACESSO</small><h1>Administradores do sistema</h1><p>Conceda acesso ao painel global apenas a contas já cadastradas no sistema novo.</p></div></header>
    {error && <div className={styles.error}>{error}</div>}
    <section className={base.panel}>
      <div className={base.heading}><div><h2>Novo administrador</h2><p>O usuário precisa possuir uma conta ativa no Supabase Auth.</p></div></div>
      <form className={styles.form} onSubmit={create}><input type="email" required placeholder="E-mail da conta" value={email} onChange={event => setEmail(event.target.value)} /><input placeholder="Nome de identificação (opcional)" value={name} onChange={event => setName(event.target.value)} /><button disabled={busy === "create"}>{busy === "create" ? "Cadastrando…" : "+ Cadastrar administrador"}</button></form>
    </section>
    <section className={base.panel}>
      <div className={base.heading}><div><h2>Acessos administrativos</h2><p>{admins.length} administrador(es) gerenciado(s) pelo painel.</p></div></div>
      <div className={styles.table}><table><thead><tr><th>Conta</th><th>Nome</th><th>Status</th><th>Cadastrado em</th><th>Ações</th></tr></thead><tbody>{admins.map(admin => <tr key={admin.id}><td><b>{admin.email}</b>{admin.user_id === currentUserId && <small>Você</small>}</td><td>{editing === admin.id ? <input value={editName} onChange={event => setEditName(event.target.value)} autoFocus /> : admin.name || "—"}</td><td><span className={admin.active ? styles.active : styles.inactive}>{admin.active ? "Ativo" : "Inativo"}</span></td><td>{new Date(admin.created_at).toLocaleString("pt-BR")}</td><td><div className={styles.actions}>{editing === admin.id ? <button onClick={() => update(admin)} disabled={busy === admin.id}>✓ Salvar</button> : <button onClick={() => { setEditing(admin.id); setEditName(admin.name || ""); }}>Editar</button>}<button onClick={() => update(admin, !admin.active)} disabled={busy === admin.id || admin.user_id === currentUserId}>{admin.active ? "Desativar" : "Ativar"}</button><button className={styles.danger} onClick={() => remove(admin)} disabled={busy === admin.id || admin.user_id === currentUserId}>Remover</button></div></td></tr>)}</tbody></table>{admins.length === 0 && <p className={styles.empty}>Nenhum administrador adicional cadastrado. Os administradores configurados no ambiente continuam com acesso.</p>}</div>
    </section>
  </main>;
}
