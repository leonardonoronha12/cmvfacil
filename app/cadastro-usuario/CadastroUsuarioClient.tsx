"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import LoadingSpinner from "../components/LoadingSpinner";

export default function CadastroUsuarioClient() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [showPassword2, setShowPassword2] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [cpf, setCpf] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [emailConfirmationRequired, setEmailConfirmationRequired] = useState<boolean | null>(null);
  const [resending, setResending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setSuccess(false);
    setEmailConfirmationRequired(null);

    if (!email.trim() || !password.trim()) {
      setError("Preencha email e senha.");
      return;
    }
    if (password !== password2) {
      setError("As senhas não conferem.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/supabase-signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          first_name: firstName,
          last_name: lastName,
          cpf,
          whatsapp,
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string; details?: string; emailConfirmationRequired?: boolean }
        | null;
      if (!res.ok || !data?.ok) {
        setError(data?.details ?? data?.error ?? "Erro ao criar conta.");
        return;
      }
      setSuccess(true);
      setEmailConfirmationRequired(typeof data.emailConfirmationRequired === "boolean" ? data.emailConfirmationRequired : null);
    } catch {
      setError("Erro ao criar conta.");
    } finally {
      setLoading(false);
    }
  }

  async function resendConfirmation() {
    if (!email.trim() || resending) return;
    setResending(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/supabase-resend-signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; details?: string } | null;
      if (!res.ok || !data?.ok) {
        setError(data?.details ?? data?.error ?? "Erro ao reenviar email.");
        return;
      }
      setSuccess(true);
    } catch {
      setError("Erro ao reenviar email.");
    } finally {
      setResending(false);
    }
  }

  return (
    <main className="cmv-signup">
      <section className="cmv-signup-left">
        <div className="cmv-signup-wrap">
          <div className="cmv-signup-brand">
            <img src="/cadastro/logo.svg" alt="CMV Fácil Logo" className="cmv-signup-logo-img" />
            <p className="cmv-signup-brand-name">
              <span>CMV&nbsp;</span>Fácil
            </p>
          </div>

          <div className="cmv-signup-content">
            <div className="cmv-signup-header">
              <h1 className="cmv-signup-title">Cadastro do Responsável</h1>
              <p className="cmv-signup-subtitle">Informe os dados do responsável nos campos abaixo.</p>
            </div>

            {error ? <div className="cmv-alert cmv-alert-error">{error}</div> : null}
            {success ? (
              <div className="cmv-signup-success" role="status" aria-live="polite">
                <div className="cmv-signup-success-top">
                  <div className="cmv-signup-success-icon" aria-hidden>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <div className="cmv-signup-success-text">
                    <div className="cmv-signup-success-title">Conta criada</div>
                    <div className="cmv-signup-success-sub">
                      {emailConfirmationRequired === false ? "Você já pode fazer login." : "Verifique seu email para confirmar o cadastro."}
                    </div>
                    {emailConfirmationRequired === false ? null : <div className="cmv-signup-success-hint">Dica: verifique também SPAM/Lixo eletrônico.</div>}
                  </div>
                </div>

                <div className="cmv-signup-success-actions">
                  <button type="button" className="cmv-signup-success-primary" onClick={() => router.replace("/login")}>
                    Ir para Login
                  </button>
                  <button type="button" className="cmv-signup-success-secondary" onClick={resendConfirmation} disabled={resending}>
                    {resending ? (
                      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                        <LoadingSpinner size={16} />
                        Reenviando…
                      </span>
                    ) : (
                      "Reenviar email"
                    )}
                  </button>
                </div>
              </div>
            ) : null}

            <form className="cmv-signup-form" onSubmit={onSubmit}>
              <div className="cmv-signup-row2">
                <div className="cmv-signup-field">
                  <label className="cmv-signup-label">Nome</label>
                  <div className="cmv-signup-input">
                    <input
                      className="cmv-signup-input-el"
                      placeholder="Seu nome"
                      autoComplete="given-name"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <div className="cmv-signup-field">
                  <label className="cmv-signup-label">Sobrenome</label>
                  <div className="cmv-signup-input">
                    <input
                      className="cmv-signup-input-el"
                      placeholder="Seu sobrenome"
                      autoComplete="family-name"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      required
                    />
                  </div>
                </div>
              </div>

              <div className="cmv-signup-field">
                <label className="cmv-signup-label">Email</label>
                <div className="cmv-signup-input">
                  <input
                    className="cmv-signup-input-el"
                    placeholder="Insira o email"
                    autoComplete="email"
                    inputMode="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="cmv-signup-row2">
                <div className="cmv-signup-field">
                  <label className="cmv-signup-label">CPF</label>
                  <div className="cmv-signup-input">
                    <input
                      className="cmv-signup-input-el"
                      placeholder="000.000.000-00"
                      inputMode="numeric"
                      value={cpf}
                      onChange={(e) => setCpf(e.target.value)}
                    />
                  </div>
                </div>
                <div className="cmv-signup-field">
                  <label className="cmv-signup-label">Whatsapp</label>
                  <div className="cmv-signup-prefix">
                    <div className="cmv-signup-prefix-box">+55</div>
                    <div className="cmv-signup-input cmv-signup-input--prefix">
                      <input
                        className="cmv-signup-input-el"
                        placeholder="Seu número"
                        inputMode="tel"
                        autoComplete="tel"
                        value={whatsapp}
                        onChange={(e) => setWhatsapp(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="cmv-signup-field">
                <label className="cmv-signup-label">Senha</label>
                <div className="cmv-signup-input cmv-signup-input--withIcon">
                  <input
                    className="cmv-signup-input-el"
                    placeholder=" "
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <button type="button" className="cmv-signup-eye" onClick={() => setShowPassword((v) => !v)} aria-label="Mostrar senha">
                    <img src="/cadastro/eye.svg" alt="" width="20" height="20" />
                  </button>
                </div>
              </div>

              <div className="cmv-signup-field">
                <label className="cmv-signup-label">Repita a Senha</label>
                <div className="cmv-signup-input cmv-signup-input--withIcon">
                  <input
                    className="cmv-signup-input-el"
                    placeholder=" "
                    type={showPassword2 ? "text" : "password"}
                    autoComplete="new-password"
                    value={password2}
                    onChange={(e) => setPassword2(e.target.value)}
                    required
                  />
                  <button type="button" className="cmv-signup-eye" onClick={() => setShowPassword2((v) => !v)} aria-label="Mostrar senha">
                    <img src="/cadastro/eye.svg" alt="" width="20" height="20" />
                  </button>
                </div>
              </div>

              <button type="submit" className="cmv-signup-submit" disabled={loading}>
                {loading ? (
                  <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                    <LoadingSpinner size={16} />
                    Criando…
                  </span>
                ) : (
                  "Criar Conta"
                )}
              </button>

              <p className="cmv-signup-footer">
                <span>Já possui conta?</span> <Link className="cmv-signup-link" href="/login">Faça login</Link>.
              </p>
            </form>
          </div>
        </div>
      </section>

      <section className="cmv-signup-right" aria-hidden />
    </main>
  );
}
