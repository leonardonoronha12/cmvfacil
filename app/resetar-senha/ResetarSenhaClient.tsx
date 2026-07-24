"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import LoadingSpinner from "../components/LoadingSpinner";

export default function ResetarSenhaClient() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <main className="cmv-reset">
      <section className="cmv-reset-left">
        <div className="cmv-reset-wrap">
          <div className="cmv-reset-brand">
            <img src="/brand/logo-preto.svg" alt="CMV Fácil" className="cmv-reset-logo" />
          </div>

          <div className="cmv-reset-content">
            <div className="cmv-reset-header">
              <h1 className="cmv-reset-title">Restaurar Senha</h1>
              <p className="cmv-reset-subtitle">
                Informe seu email, caso exista uma conta relaciona, enviaremos as instruções de restauração;
              </p>
            </div>

            <form
              className="cmv-reset-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (loading) return;
                setLoading(true);
                setError(null);
                setSent(false);
                try {
                  const res = await fetch("/api/auth/supabase-reset", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ email }),
                  });
                  const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; details?: string } | null;
                  if (!res.ok || !data?.ok) {
                    setError(data?.details ?? data?.error ?? "Erro ao enviar instruções.");
                    return;
                  }
                  setSent(true);
                  router.push(`/restaurar-senha?sent=1&email=${encodeURIComponent(email)}`);
                } catch {
                  setError("Erro ao enviar instruções.");
                } finally {
                  setLoading(false);
                }
              }}
            >
              {error ? <div className="cmv-alert cmv-alert-error">{error}</div> : null}
              <div className="cmv-reset-field">
                <label className="cmv-reset-label">Email</label>
                <div className="cmv-reset-input">
                  <input
                    className="cmv-reset-input-el"
                    placeholder="Insira o email"
                    autoComplete="email"
                    inputMode="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>

              <button type="submit" className="cmv-reset-submit" disabled={loading}>
                {loading ? (
                  <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                    <LoadingSpinner size={16} />
                    Enviando…
                  </span>
                ) : (
                  "Enviar Instruções"
                )}
              </button>

              {sent ? (
                <div className="cmv-reset-hint">
                  Se existir uma conta para este email, você receberá as instruções em instantes.
                </div>
              ) : null}

              <p className="cmv-reset-footer">
                <span>Lembrou da senha?</span> <Link className="cmv-reset-link" href="/login">Login</Link>.
              </p>
            </form>
          </div>
        </div>
      </section>

      <section className="cmv-reset-right" aria-hidden />
    </main>
  );
}
