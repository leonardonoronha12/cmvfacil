"use client";

import { useEffect, useRef, useState } from "react";
import LoadingSpinner from "../components/LoadingSpinner";
import { maskCnpj, maskPhoneBR } from "../lib/masks";

export default function CadastroEmpresaClient() {
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const [fantasyName, setFantasyName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [email, setEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [industry, setIndustry] = useState("Hamburgueria");
  const [desiredStore, setDesiredStore] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [checkoutPending, setCheckoutPending] = useState(false);
  const [createdCompanyId, setCreatedCompanyId] = useState<string | null>(null);
  const didRedirectRef = useRef(false);
  const didAutoOpenCheckoutRef = useRef(false);

  useEffect(() => {
    const pending = (() => {
      try {
        return sessionStorage.getItem("cmv_onboarding_checkout_pending") === "1";
      } catch {
        return false;
      }
    })();
    const storedCompanyId = (() => {
      try {
        return String(sessionStorage.getItem("cmv_onboarding_company_id") ?? "").trim();
      } catch {
        return "";
      }
    })();
    if (storedCompanyId) setCreatedCompanyId(storedCompanyId);
    if (pending) setCheckoutPending(true);
    if (pending && storedCompanyId && !didAutoOpenCheckoutRef.current) {
      didAutoOpenCheckoutRef.current = true;
      void openCheckout(storedCompanyId);
    }
  }, []);

  async function openCheckout(companyId: string) {
    const companyIdTrim = String(companyId ?? "").trim();
    if (!companyIdTrim) {
      setError("Empresa criada sem ID. Não foi possível abrir o Checkout.");
      return false;
    }
    try {
      try {
        sessionStorage.setItem("cmv_onboarding_checkout_pending", "1");
        sessionStorage.setItem("cmv_onboarding_company_id", companyIdTrim);
      } catch {}
      setCheckoutPending(true);
      const checkout = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan_key: "pro_monthly", origin: "signup", company_id: companyIdTrim }),
      });
      const cj = (await checkout.json().catch(() => null)) as { ok?: boolean; url?: string; error?: string } | null;
      if (checkout.ok && cj?.ok && cj?.url) {
        try {
          sessionStorage.removeItem("cmv_onboarding_checkout_pending");
          sessionStorage.removeItem("cmv_onboarding_company_id");
        } catch {}
        if (!didRedirectRef.current) {
          didRedirectRef.current = true;
          window.location.assign(String(cj.url));
        }
        return true;
      }
      const status = checkout.status ? ` (HTTP ${checkout.status})` : "";
      setError(cj?.error ? `Não foi possível abrir o Checkout${status}: ${cj.error}` : `Não foi possível abrir o Checkout${status}.`);
      return false;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível abrir o Checkout.");
      return false;
    }
  }

  if (checkoutPending) {
    return (
      <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ maxWidth: 520, width: "100%", textAlign: "center" }}>
          <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
            <LoadingSpinner size={18} />
            <span>
              Cadastro concluído.
              <br />
              Preparando sua assinatura…
            </span>
          </div>
          {error ? <div style={{ marginTop: 14, color: "#b42318", fontSize: 13, fontWeight: 700 }}>{error}</div> : null}
          <div style={{ marginTop: 16 }}>
            {createdCompanyId ? (
              <button
                type="button"
                className="cmv-company-submit"
                style={{ width: "fit-content" }}
                onClick={() => void openCheckout(createdCompanyId)}
              >
                Tentar abrir Checkout
              </button>
            ) : null}
            <a
              className="cmv-company-submit"
              href="/ajustes?tab=planos"
              style={{ display: "inline-block", textDecoration: "none", marginLeft: createdCompanyId ? 10 : 0 }}
              onClick={() => {
                try {
                  sessionStorage.removeItem("cmv_onboarding_checkout_pending");
                  sessionStorage.removeItem("cmv_onboarding_company_id");
                } catch {}
              }}
            >
              Ir para Ajustes
            </a>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="cmv-company">
      <div className="cmv-company-brand">
        <img src="/brand/logo-preto.svg" alt="CMV Fácil" className="cmv-company-brand-icon" />
      </div>

      <form
        className="cmv-company-content"
        onSubmit={async (e) => {
          e.preventDefault();
          if (isSubmitting) return;
          setError(null);
          setSuccess(false);
          setIsSubmitting(true);
          try {
            const res = await fetch("/api/companies", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                fantasyName,
                legalName,
                cnpj,
                email,
                whatsapp,
                industry,
                desiredStore,
                logoUrl,
              }),
            });
            const json = (await res.json().catch(() => null)) as { ok?: boolean; company_id?: string; error?: string; details?: string } | null;
            if (!res.ok) {
              setError(json?.details ?? json?.error ?? "Erro ao salvar.");
              return;
            }
            setSuccess(true);
            const newCompanyId = String(json?.company_id ?? "").trim();
            setCreatedCompanyId(newCompanyId || null);
            const ok = await openCheckout(newCompanyId);
            if (ok) return;
          } catch {
            setError("Erro ao salvar.");
          } finally {
            setIsSubmitting(false);
          }
        }}
      >
        <header className="cmv-company-header">
          <h1 className="cmv-company-title">Cadastro da Empresa</h1>
          <p className="cmv-company-subtitle">Informe os dados da sua empresa nos campos abaixo para continuar.</p>
        </header>

        <div className="cmv-company-divider" />

        <div className="cmv-company-field">
          <label className="cmv-company-label">Logo (opcional)</label>
          <div className="cmv-company-input">
            <input
              className="cmv-company-inputEl"
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                const url = URL.createObjectURL(file);
                setLogoPreviewUrl(url);
                setError(null);
                setIsUploadingLogo(true);
                const form = new FormData();
                form.set("file", file);
                fetch("/api/companies/logo", { method: "POST", body: form })
                  .then(async (r) => {
                    const j = (await r.json().catch(() => null)) as
                      | { ok?: boolean; publicUrl?: string; error?: string; details?: string }
                      | null;
                    if (!r.ok) {
                      setError(j?.details ?? j?.error ?? "Erro ao enviar imagem.");
                      return;
                    }
                    setLogoUrl(j?.publicUrl ?? null);
                  })
                  .catch(() => {
                    setError("Erro ao enviar imagem.");
                  })
                  .finally(() => {
                    setIsUploadingLogo(false);
                  });
              }}
            />
          </div>
          {isUploadingLogo ? (
            <div style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 8 }}>
              <LoadingSpinner size={16} />
              <span>Enviando…</span>
            </div>
          ) : null}
          {logoPreviewUrl ? <img src={logoPreviewUrl} alt="" style={{ marginTop: 10, width: 86, height: 86, objectFit: "cover", borderRadius: 12 }} /> : null}
          {logoPreviewUrl ? (
            <button
              type="button"
              className="cmv-company-btn cmv-company-btnDanger"
              style={{ marginTop: 10, width: "fit-content" }}
              onClick={() => {
                setLogoPreviewUrl(null);
                setLogoUrl(null);
              }}
            >
              Remover imagem
            </button>
          ) : null}
          <div className="cmv-company-logoHint" style={{ marginTop: 8 }}>
            Tamanho recomendado: 600 x 600 px
          </div>
        </div>

        <div className="cmv-company-field">
          <label className="cmv-company-label">Nome Fantasia</label>
          <div className="cmv-company-input">
            <input
              className="cmv-company-inputEl"
              placeholder="Seu sobrenome"
              value={fantasyName}
              onChange={(e) => setFantasyName(e.target.value)}
            />
          </div>
        </div>

        <div className="cmv-company-row2">
          <div className="cmv-company-field">
            <label className="cmv-company-label">Razão Social</label>
            <div className="cmv-company-input">
              <input
                className="cmv-company-inputEl"
                placeholder="Seu nome"
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
              />
            </div>
          </div>
          <div className="cmv-company-field">
            <label className="cmv-company-label">CNPJ</label>
            <div className="cmv-company-input">
              <input
                className="cmv-company-inputEl"
                placeholder="000.000/0001-00"
                inputMode="numeric"
                value={cnpj}
                onChange={(e) => setCnpj(maskCnpj(e.target.value))}
              />
            </div>
          </div>
        </div>

        <div className="cmv-company-row2">
          <div className="cmv-company-field">
            <label className="cmv-company-label">Email Comercial</label>
            <div className="cmv-company-input">
              <input
                className="cmv-company-inputEl"
                placeholder="Seu email"
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>
          <div className="cmv-company-field">
            <label className="cmv-company-label">Whatsapp Comercial</label>
            <div className="cmv-company-prefix">
              <div className="cmv-company-prefixBox">+55</div>
              <div className="cmv-company-input cmv-company-input--prefix">
                <input
                  className="cmv-company-inputEl"
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

        <div className="cmv-company-field cmv-company-field--narrow">
          <label className="cmv-company-label">Ramo de Atividade</label>
          <div
            className="cmv-company-dropdown"
            role="button"
            tabIndex={0}
            onClick={() => setIndustry(industry)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") setIndustry(industry);
            }}
          >
            <span className="cmv-company-dropdownValue">{industry}</span>
            <img src="/cadastro-empresa/chevron.svg" alt="" className="cmv-company-dropdownIcon" />
          </div>
        </div>

        <div className="cmv-company-field">
          <label className="cmv-company-label">Loja desejada</label>
          <div className="cmv-company-input">
            <input
              className="cmv-company-inputEl"
              placeholder="Ex.: Loja Centro"
              value={desiredStore}
              onChange={(e) => setDesiredStore(e.target.value)}
            />
          </div>
        </div>

        {error ? <div className="cmv-company-error">{error}</div> : null}
        {success ? <div className="cmv-company-success">Empresa cadastrada com sucesso.</div> : null}

        <button type="submit" className="cmv-company-submit" disabled={isSubmitting || isUploadingLogo}>
          Salvar e Continuar
        </button>
      </form>
    </main>
  );
}
