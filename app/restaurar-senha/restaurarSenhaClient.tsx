"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import LoadingSpinner from "../components/LoadingSpinner";

function parseHashParams(hash: string) {
  const h = hash.startsWith("#") ? hash.slice(1) : hash;
  const params = new URLSearchParams(h);
  const accessToken = params.get("access_token") ?? "";
  const refreshToken = params.get("refresh_token") ?? "";
  const type = params.get("type") ?? "";
  return { accessToken, refreshToken, type };
}

export default function RestaurarSenhaClient() {
  const router = useRouter();
  const search = useSearchParams();
  const code = useMemo(() => (search.get("code") ?? "").trim(), [search]);
  const sent = useMemo(() => (search.get("sent") ?? "").trim() === "1", [search]);
  const sentEmail = useMemo(() => (search.get("email") ?? "").trim(), [search]);
  const invite = useMemo(() => (search.get("invite") ?? "").trim() === "1", [search]);
  const inviteCompany = useMemo(() => (search.get("company") ?? "").trim(), [search]);
  const inviteRole = useMemo(() => (search.get("role") ?? "").trim(), [search]);

  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      setError(null);
      setReady(false);
      try {
        if (sent) {
          if (!cancelled) setReady(false);
          return;
        }
        if (code) {
          throw new Error("Link inválido ou expirado.");
        } else {
          const hash = window.location.hash || "";
          const hp = parseHashParams(hash);
          const at = hp.accessToken.trim();
          const rt = hp.refreshToken.trim();
          const qsAt = (search.get("access_token") ?? "").trim();
          const qsRt = (search.get("refresh_token") ?? "").trim();

          const finalAt = at || qsAt;
          const finalRt = rt || qsRt;
          if (!finalAt) throw new Error("Link inválido ou expirado.");

          if (!cancelled) {
            setAccessToken(finalAt);
            setRefreshToken(finalRt || null);
          }
        }

        if (!cancelled) setReady(true);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }
    void init();
    return () => {
      cancelled = true;
    };
  }, [code, sent, search]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setOk(false);
    if (!password.trim()) {
      setError("Digite a nova senha.");
      return;
    }
    if (password !== password2) {
      setError("As senhas não conferem.");
      return;
    }

    setLoading(true);
    try {
      if (!accessToken) throw new Error("Link inválido ou expirado.");

      const res = await fetch("/api/auth/supabase-update-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ access_token: accessToken, password }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; details?: string } | null;
      if (!res.ok || !data?.ok) throw new Error(data?.details ?? data?.error ?? "Erro ao atualizar senha.");

      if (refreshToken) {
        await fetch("/api/auth/supabase-session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ access_token: accessToken, refresh_token: refreshToken }),
        }).catch(() => null);
      }

      setOk(true);
      router.replace("/dashboard");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="cmv-reset">
      <section className="cmv-reset-left">
        <div className="cmv-reset-wrap">
          <div className="cmv-reset-brand">
            <img src="/brand/logo-preto.svg" alt="CMV Fácil" className="cmv-reset-logo" />
          </div>

          <div className="cmv-reset-content">
            <div className="cmv-reset-header">
              <h1 className="cmv-reset-title">{invite ? "Crie sua senha" : "Restaurar Senha"}</h1>
              <p className="cmv-reset-subtitle">
                {invite
                  ? "Este é seu primeiro acesso ao CMV Fácil. Para entrar no sistema, crie uma senha agora (bem rápido)."
                  : "Defina sua nova senha abaixo."}
              </p>
            </div>

            {error ? <div className="cmv-alert cmv-alert-error">{error}</div> : null}
            {ok ? <div className="cmv-alert cmv-alert-ok">Senha alterada com sucesso. Você já pode acessar sua conta.</div> : null}

            {sent ? (
              <div className="cmv-reset-form">
                <div className="cmv-reset-hint">
                  Se existir uma conta{sentEmail ? ` para ${sentEmail}` : ""}, você receberá um email com o link para trocar a senha.
                </div>
                <p className="cmv-reset-footer">
                  <span>Já tem o link?</span>{" "}
                  <Link className="cmv-reset-link" href="/login">
                    Voltar ao Login
                  </Link>
                  .
                </p>
              </div>
            ) : (
              <form className="cmv-reset-form" onSubmit={onSubmit}>
              {invite ? (
                <div className="cmv-reset-hint" style={{ marginBottom: 12 }}>
                  <div style={{ marginBottom: 10 }}>
                    {inviteCompany ? (
                      <div style={{ marginBottom: 6 }}>
                        <strong>Empresa:</strong> {inviteCompany}
                      </div>
                    ) : null}
                    {inviteRole ? (
                      <div style={{ marginBottom: 6 }}>
                        <strong>Permissão:</strong> {inviteRole}
                      </div>
                    ) : null}
                  </div>
                  <div style={{ fontWeight: 800, marginBottom: 6 }}>O que vai acontecer agora</div>
                  <ol style={{ margin: 0, paddingLeft: 18, color: "#374151" }}>
                    <li>Você cria uma senha (para entrar sempre que quiser).</li>
                    <li>O sistema confirma seu acesso.</li>
                    <li>Você será levado automaticamente para o painel da empresa.</li>
                  </ol>
                  <div style={{ color: "#6b7280", marginTop: 10 }}>
                    Dica: use uma senha fácil para você lembrar, mas difícil para outras pessoas (8+ caracteres, com letras e números).
                  </div>
                </div>
              ) : null}
              <div className="cmv-reset-field">
                <label className="cmv-reset-label">Nova Senha</label>
                <div className="cmv-reset-input">
                  <input
                    className="cmv-reset-input-el"
                    placeholder=" "
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={!ready || loading}
                  />
                </div>
              </div>

              <div className="cmv-reset-field">
                <label className="cmv-reset-label">Repita a Nova Senha</label>
                <div className="cmv-reset-input">
                  <input
                    className="cmv-reset-input-el"
                    placeholder=" "
                    type="password"
                    autoComplete="new-password"
                    value={password2}
                    onChange={(e) => setPassword2(e.target.value)}
                    disabled={!ready || loading}
                  />
                </div>
              </div>

              <button type="submit" className="cmv-reset-submit" disabled={!ready || loading}>
                {loading ? (
                  <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                    <LoadingSpinner size={16} />
                    Salvando…
                  </span>
                ) : ready ? (
                  invite ? "Criar senha e entrar" : "Trocar Senha"
                ) : (
                  <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                    <LoadingSpinner size={16} />
                    Preparando troca de senha…
                  </span>
                )}
              </button>

              <p className="cmv-reset-footer">
                <span>Lembrou da senha?</span> <Link className="cmv-reset-link" href="/login">Login</Link>.
              </p>
              </form>
            )}
          </div>
        </div>
      </section>

      <section className="cmv-reset-right" aria-hidden />
    </main>
  );
}
