"use client";

import { useEffect, useMemo, useState } from "react";
import dash from "../../dashboard/dashboard.module.css";
import styles from "./emailsUsuarios.module.css";

type ApiUser = {
  id: string;
  email: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
  banned_until: string | null;
};

function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (message === "forbidden") return "Sua conta não possui permissão de administrador para visualizar estes usuários.";
  if (message === "unauthorized") return "Sua sessão expirou. Entre novamente com uma conta administradora.";
  return message || "Ocorreu um erro inesperado.";
}

function shortId(id: string) {
  const value = String(id ?? "").trim();
  return value.length <= 14 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default function EmailsUsuariosClient() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [filter, setFilter] = useState("");
  const [copied, setCopied] = useState(false);
  const [impersonating, setImpersonating] = useState("");

  async function loadSupabase() {
    setIsLoading(true);
    setError("");
    setCopied(false);
    try {
      const response = await fetch(`/api/admin/users-emails?ts=${Date.now()}`, { method: "GET", cache: "no-store" });
      const json = (await response.json().catch(() => null)) as any;
      if (!response.ok || !json?.ok) throw new Error(String(json?.error ?? `failed_${response.status}`));
      setUsers(Array.isArray(json.users) ? json.users : []);
    } catch (requestError) {
      setUsers([]);
      setError(friendlyError(requestError));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadSupabase();
  }, []);

  const filteredSupabase = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return users;
    return users.filter((user) => String(user.email ?? "").toLowerCase().includes(query) || user.id.toLowerCase().includes(query));
  }, [filter, users]);

  const emailsText = useMemo(() => {
    const emails = filteredSupabase.map((user) => user.email ?? "");
    return Array.from(new Set(emails.map((email) => email.trim().toLowerCase()).filter((email) => email.includes("@"))))
      .sort()
      .join("\n");
  }, [filteredSupabase]);

  async function copyEmails() {
    try {
      await navigator.clipboard.writeText(emailsText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch (copyError) {
      setError(friendlyError(copyError));
    }
  }

  async function loginAs(email: string, authUserId?: string) {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail.includes("@")) return;
    setImpersonating(normalizedEmail);
    setError("");
    try {
      const params = new URLSearchParams({
        email: normalizedEmail,
        ts: String(Date.now()),
      });
      if (authUserId) params.set("userId", authUserId);
      const response = await fetch(`/api/admin/impersonate-link?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
      });
      const json = (await response.json().catch(() => null)) as any;
      if (!response.ok || !json?.ok) throw new Error(String(json?.error ?? `failed_${response.status}`));
      const actionLink = String(json?.actionLink ?? "");
      if (!actionLink) throw new Error("Não foi possível gerar o acesso temporário.");
      window.location.href = actionLink;
    } catch (loginError) {
      setError(friendlyError(loginError));
      setImpersonating("");
    }
  }

  const visibleCount = filteredSupabase.length;
  const totalCount = users.length;

  return (
    <main className={dash.content}>
      <div className={dash.pageFrame}>
        <div className={styles.page}>
          <header className={styles.hero}>
            <div className={styles.heroIcon} aria-hidden>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM19 8v6M22 11h-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <div className={styles.eyebrow}>Administração</div>
              <h1 className={styles.title}>Acesso aos usuários</h1>
              <p className={styles.subtitle}>Consulte contas e acesse o sistema como um usuário para suporte e validação.</p>
            </div>
            <div className={styles.securityBadge}><span />Área restrita</div>
          </header>

          <section className={styles.stats}>
            <div><span>Usuários encontrados</span><strong>{isLoading ? "—" : totalCount}</strong></div>
            <div><span>Resultados visíveis</span><strong>{isLoading ? "—" : visibleCount}</strong></div>
            <div><span>Fonte atual</span><strong>Supabase</strong></div>
          </section>

          <section className={styles.panel}>
            <div className={styles.toolbar}>
              <div className={styles.actions}>
                <label className={styles.search}>
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
                    <path d="m20 20-4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                  <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Buscar por e-mail, ID ou empresa" />
                </label>
                <button type="button" className={styles.secondaryButton} onClick={() => void loadSupabase()} disabled={isLoading}>
                  {isLoading ? <span className={styles.spinner} /> : null}
                  {isLoading ? "Atualizando" : "Atualizar"}
                </button>
                <button type="button" className={styles.secondaryButton} onClick={copyEmails} disabled={!emailsText || isLoading}>
                  {copied ? "E-mails copiados" : "Copiar e-mails"}
                </button>
              </div>
            </div>

            {error ? (
              <div className={styles.errorBanner} role="alert">
                <span className={styles.errorIcon}>!</span>
                <div><strong>Não foi possível carregar os usuários</strong><p>{error}</p></div>
              </div>
            ) : null}

            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>Usuário</th><th>Identificador</th><th>Criado em</th><th>Último acesso</th><th>Status</th><th className={styles.actionColumn}>Ação</th></tr></thead>
                <tbody>
                  {filteredSupabase.map((user) => (
                    <tr key={user.id}>
                      <td><UserCell email={user.email ?? "E-mail não informado"} label="Usuário do sistema novo" /></td>
                      <td><code className={styles.userId} title={user.id}>{shortId(user.id)}</code></td>
                      <td>{formatDate(user.created_at)}</td>
                      <td>{formatDate(user.last_sign_in_at)}</td>
                      <td><span className={user.banned_until ? styles.statusBadgeBlocked : styles.statusBadgeActive}>{user.banned_until ? "Bloqueado" : "Ativo"}</span></td>
                      <td className={styles.actionColumn}>
                        <LoginButton email={user.email ?? ""} authUserId={user.id} enabled={Boolean(user.email) && !user.banned_until} loadingEmail={impersonating} onLogin={loginAs} />
                      </td>
                    </tr>
                  ))}
                  {!isLoading && !filteredSupabase.length ? <EmptyRow columns={6} /> : null}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function UserCell({ email, label }: { email: string; label: string }) {
  return (
    <div className={styles.userCell}>
      <span className={styles.avatar}>{email.slice(0, 1).toUpperCase()}</span>
      <div><strong>{email}</strong><span>{label}</span></div>
    </div>
  );
}

function LoginButton({ email, authUserId, enabled, loadingEmail, onLogin }: { email: string; authUserId?: string; enabled: boolean; loadingEmail: string; onLogin: (email: string, authUserId?: string) => void }) {
  const loading = loadingEmail === email;
  return (
    <button type="button" className={styles.loginButton} disabled={!enabled || Boolean(loadingEmail)} onClick={() => onLogin(email, authUserId)}>
      {loading ? <span className={styles.spinnerLight} /> : null}
      {loading ? "Entrando..." : "Entrar como usuário"}
    </button>
  );
}

function EmptyRow({ columns }: { columns: number }) {
  return (
    <tr>
      <td colSpan={columns}>
        <div className={styles.emptyState}><strong>Nenhum usuário encontrado</strong><span>Tente ajustar a busca, atualizar os dados ou conferir sua permissão.</span></div>
      </td>
    </tr>
  );
}
