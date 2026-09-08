"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import LoadingSpinner from "../components/LoadingSpinner";
import { clearMeStore } from "../lib/meStore";

export default function LoginClient() {
  const router = useRouter();
  const params = useSearchParams();
  const nextPath = useMemo(() => {
    const raw = (params.get("next") ?? "").trim();
    if (!raw || raw === "/") return "/dashboard";
    if (!raw.startsWith("/")) return "/dashboard";
    if (raw.startsWith("//")) return "/dashboard";
    if (raw.includes("://")) return "/dashboard";
    return raw;
  }, [params]);
  const loginBgUrl = useMemo(() => (process.env.NEXT_PUBLIC_LOGIN_BG_URL ?? "").trim(), []);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      clearMeStore();
    } catch {}
  }, []);

  useEffect(() => {
    const hash = window.location.hash || "";
    if (!hash) return;
    const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
    const type = (params.get("type") ?? "").trim();
    const accessToken = (params.get("access_token") ?? "").trim();
    const refreshToken = (params.get("refresh_token") ?? "").trim();
    if (type === "recovery" && accessToken && refreshToken) {
      window.location.replace(`/restaurar-senha${hash}`);
    }
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/supabase-login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, remember }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; details?: string };
      if (!res.ok || !data.ok) throw new Error(data.details ?? data.error ?? "login_failed");
      try {
        const meRes = await fetch("/api/auth/me", { method: "GET", cache: "no-store" });
        const meJson = (await meRes.json().catch(() => null)) as any;
        const uid = String(meJson?.userId ?? "").trim();
        if (!uid) {
          const dbg = "/api/health/auth-debug";
          throw new Error(`login_cookie_not_set. Abra ${dbg} para diagnóstico.`);
        }
      } catch (err) {
        if (err instanceof Error) throw err;
        throw new Error(String(err));
      }
      try {
        clearMeStore();
      } catch {}
      window.location.replace(nextPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="cmv-login">
      <section className="cmv-login-left">
        <div className="cmv-login-card">
          <div className="cmv-login-brand">
            <img src="/brand/logo-preto.svg" alt="CMV Fácil" className="cmv-login-logo-img" />
          </div>

          <div className="cmv-login-content">
            <div className="cmv-login-header">
              <h1 className="cmv-login-title">Entre com sua Conta</h1>
              <p className="cmv-login-subtitle">
                Bem vindo(a) de volta! Selecione um método de para login.
              </p>
            </div>

            {error ? <div className="cmv-alert cmv-alert-error">{error}</div> : null}

            <form onSubmit={onSubmit} className="cmv-login-form">
              <div className="cmv-login-field">
                <label className="cmv-login-label">Email</label>
                <div className="cmv-login-input-container">
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="cmv-login-input"
                    placeholder="Insira o email"
                    autoComplete="email"
                    inputMode="email"
                    required
                  />
                </div>
              </div>

              <div className="cmv-login-field">
                <label className="cmv-login-label">Senha Atual</label>
                <div className="cmv-login-input-container">
                  <input
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="cmv-login-input"
                    placeholder=" "
                    autoComplete="current-password"
                    type={showPassword ? "text" : "password"}
                    required
                  />
                  <button
                    type="button"
                    className="cmv-login-eye"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  >
                    <img src="/login/eye.svg" alt="" width="20" height="20" />
                  </button>
                </div>
              </div>

              <div className="cmv-login-row">
                <label className="cmv-login-remember">
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                  <span>Lembrar de Mim</span>
                </label>
              <a className="cmv-login-forgot" href="/resetar-senha">
                Esqueci a Senha
              </a>
            </div>

              <button type="submit" className="cmv-login-submit" disabled={loading}>
                {loading ? (
                  <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                    <LoadingSpinner size={16} />
                    Entrando…
                  </span>
                ) : (
                  "Login"
                )}
              </button>
            </form>

            <p className="cmv-login-footer">
              <span>Ainda não possui cadastro?</span>{" "}
              <a className="cmv-login-link" href="/cadastro-usuario">
                Criar conta.
              </a>
            </p>
            <p className="cmv-login-footer">
              <a className="cmv-login-link" href="/termos-de-uso" target="_blank" rel="noreferrer">Termos de Uso</a>
            </p>
          </div>
        </div>
      </section>

      <section className="cmv-login-right" aria-hidden />
    </main>
  );
}
