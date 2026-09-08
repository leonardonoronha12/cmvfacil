"use client";

import { useEffect, useState } from "react";
import { loadMeFromApi, type MeProfile } from "../lib/meStore";

const SESSION_KEY = "cmvfacil:profile-selected:v1";

export default function ProfileChooser() {
  const [me, setMe] = useState<MeProfile | null>(null);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    void loadMeFromApi().then((profile) => {
      if (!alive || !profile) return;
      setMe(profile);
      setVisible(sessionStorage.getItem(SESSION_KEY) !== profile.userId);
    });
    return () => { alive = false; };
  }, []);

  if (!visible || !me) return null;
  const companies = me.companies.length
    ? me.companies
    : [{ id: me.companyId, name: me.companyName || "Minha empresa", logoUrl: me.companyLogoUrl, role: me.role }].filter((item) => item.id);
  const canAdd = me.role === "Administrador" && companies.length < 4;

  async function choose(companyId: string) {
    setBusy(companyId);
    setError("");
    try {
      const response = await fetch("/api/active-company", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyId }),
      });
      if (!response.ok) throw new Error("Não foi possível abrir este perfil.");
      sessionStorage.setItem(SESSION_KEY, me!.userId);
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível abrir este perfil.");
      setBusy("");
    }
  }

  return (
    <div className="cmv-profile-gate" role="dialog" aria-modal="true" aria-labelledby="cmv-profile-title">
      <div className="cmv-profile-gate__brand">cmv<span>fácil</span></div>
      <main className="cmv-profile-gate__content">
        <h1 id="cmv-profile-title">Quem está acessando?</h1>
        <p>Escolha a empresa para entrar no CMV Fácil.</p>
        <div className="cmv-profile-gate__grid">
          {companies.map((company) => (
            <button key={company.id} type="button" className="cmv-profile-card" disabled={Boolean(busy)} onClick={() => void choose(company.id)}>
              <span className="cmv-profile-card__avatar">
                {company.logoUrl ? <img src={company.logoUrl} alt="" /> : company.name.slice(0, 2).toUpperCase()}
              </span>
              <strong>{company.name}</strong>
              <small>{company.role}{busy === company.id ? " · Entrando…" : ""}</small>
            </button>
          ))}
          {canAdd ? (
            <a className="cmv-profile-card cmv-profile-card--add" href="/cadastro-empresa">
              <span className="cmv-profile-card__avatar">+</span>
              <strong>Adicionar empresa</strong>
              <small>{companies.length} de 4 perfis</small>
            </a>
          ) : null}
        </div>
        {error ? <p className="cmv-profile-gate__error" role="alert">{error}</p> : null}
        {me.role === "Colaborador" ? <p className="cmv-profile-gate__hint">Colaboradores acessam somente os perfis aos quais foram convidados.</p> : null}
      </main>
    </div>
  );
}
