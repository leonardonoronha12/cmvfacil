"use client";

import { useState } from "react";
import Link from "next/link";
import LoadingSpinner from "../components/LoadingSpinner";
import SystemToast from "../components/SystemToast";
import { maskCpf, maskPhoneBR } from "../lib/masks";

export default function CadastroUsuarioClient() {
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
  const [emailConfirmationRequired, setEmailConfirmationRequired] = useState<boolean | null>(null);
  const [toast, setToast] = useState<{ title: string; message: string; tone: "success" | "error" } | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setToast(null);
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
      const required = typeof data.emailConfirmationRequired === "boolean" ? data.emailConfirmationRequired : null;
      setEmailConfirmationRequired(required);
      setToast({
        title: "Conta criada",
        message: required === false ? "Você já pode fazer login." : "Verifique seu email para confirmar o cadastro.",
        tone: "success",
      });
      if (required === false) {
        try {
          sessionStorage.removeItem("cmv_onboarding_checkout_pending");
        } catch {}
        try {
          const lr = await fetch("/api/auth/supabase-login", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email, password, remember: true }),
          });
          const lj = (await lr.json().catch(() => null)) as any;
          if (!lr.ok || !lj?.ok) {
            setError(lj?.details ?? lj?.error ?? "Não foi possível entrar automaticamente. Faça login.");
            return;
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : "Não foi possível entrar automaticamente. Faça login.");
          return;
        }
        try {
          const start = await fetch("/api/onboarding/start", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ plan_key: "pro_monthly" }),
          });
          const sj = (await start.json().catch(() => null)) as { ok?: boolean; url?: string; company_id?: string; error?: string } | null;
          if (start.ok && sj?.ok && sj?.url) {
            const companyId = String(sj.company_id ?? "").trim();
            if (companyId) {
              sessionStorage.setItem("cmv_onboarding_company_id", companyId);
              sessionStorage.setItem("cmv_onboarding_checkout_pending", "1");
            }
            window.location.assign(String(sj.url));
            return;
          }
          if (start.status === 409 && String(sj?.error ?? "") === "subscription_already_active") {
            window.location.replace("/cadastro-empresa?onboarding=1");
            return;
          }
          const status = start.status ? ` (HTTP ${start.status})` : "";
          setError(sj?.error ? `Não foi possível abrir o Checkout${status}: ${sj.error}` : `Não foi possível abrir o Checkout${status}.`);
          return;
        } catch (err) {
          setError(err instanceof Error ? err.message : "Não foi possível abrir o Checkout.");
          return;
        }
      }
    } catch {
      setError("Erro ao criar conta.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="cmv-signup">
      <section className="cmv-signup-left">
        <div className="cmv-signup-wrap">
          <div className="cmv-signup-brand">
            <img src="/brand/logo-preto.svg" alt="CMV Fácil" className="cmv-signup-logo-img" />
          </div>

          <div className="cmv-signup-content">
            <div className="cmv-signup-header">
              <h1 className="cmv-signup-title">Cadastro do Responsável</h1>
              <p className="cmv-signup-subtitle">Informe os dados do responsável nos campos abaixo.</p>
            </div>

            {toast ? (
              <SystemToast
                title={toast.title}
                message={toast.message}
                tone={toast.tone}
                onClose={() => setToast(null)}
              />
            ) : null}
            {error ? <div className="cmv-alert cmv-alert-error">{error}</div> : null}

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
                        onChange={(e) => setCpf(maskCpf(e.target.value))}
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
                        onChange={(e) => setWhatsapp(maskPhoneBR(e.target.value))}
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
