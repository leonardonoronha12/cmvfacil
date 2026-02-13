"use client";

import { useState } from "react";

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

  return (
    <main className="cmv-company">
      <div className="cmv-company-brand">
        <img src="/cadastro-empresa/icon.svg" alt="" className="cmv-company-brand-icon" />
        <p className="cmv-company-brand-name">
          <span>CMV&nbsp;</span>Fácil
        </p>
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
            const json = (await res.json().catch(() => null)) as { error?: string; details?: string } | null;
            if (!res.ok) {
              setError(json?.details ?? json?.error ?? "Erro ao salvar.");
              return;
            }
            setSuccess(true);
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

        <div className="cmv-company-logoCard">
          <div
            className="cmv-company-avatar"
            style={logoPreviewUrl ? { backgroundImage: `url(${logoPreviewUrl})` } : undefined}
            aria-hidden
          />

          <div className="cmv-company-logoCardBody">
            <div className="cmv-company-logoActions">
              <label className="cmv-company-btn cmv-company-btnPrimary">
                <img src="/cadastro-empresa/camera.svg" alt="" className="cmv-company-btnIcon" />
                <span>Nova Logo</span>
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
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
                          setError(j?.details ?? j?.error ?? "Erro ao enviar logo.");
                          return;
                        }
                        setLogoUrl(j?.publicUrl ?? null);
                      })
                      .catch(() => {
                        setError("Erro ao enviar logo.");
                      })
                      .finally(() => {
                        setIsUploadingLogo(false);
                      });
                  }}
                />
              </label>

              <button
                type="button"
                className="cmv-company-btn cmv-company-btnDanger"
                onClick={() => {
                  setLogoPreviewUrl(null);
                  setLogoUrl(null);
                }}
              >
                Excluir
              </button>
            </div>
            <div className="cmv-company-logoHint">Tamanho recomendado: 600 x 600 px</div>
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
                onChange={(e) => setCnpj(e.target.value)}
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
                  onChange={(e) => setWhatsapp(e.target.value)}
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
