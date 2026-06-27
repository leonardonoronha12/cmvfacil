"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import AppSidebar from "../components/AppSidebar";
import dash from "../dashboard/dashboard.module.css";
import styles from "./ajustes.module.css";
import { clearMeStore, loadMeFromApi, readMeFromStore, subscribeMe } from "../lib/meStore";

function IconGearSmall() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M7.25 2.5H10.75L11.25 4.2C11.4 4.25 11.55 4.32 11.69 4.4L13.35 3.65L15.1 6.75L13.7 7.85C13.72 8.0 13.75 8.15 13.75 8.3C13.75 8.45 13.72 8.6 13.7 8.75L15.1 9.85L13.35 12.95L11.69 12.2C11.55 12.28 11.4 12.35 11.25 12.4L10.75 14.1H7.25L6.75 12.4C6.6 12.35 6.45 12.28 6.31 12.2L4.65 12.95L2.9 9.85L4.3 8.75C4.28 8.6 4.25 8.45 4.25 8.3C4.25 8.15 4.28 8.0 4.3 7.85L2.9 6.75L4.65 3.65L6.31 4.4C6.45 4.32 6.6 4.25 6.75 4.2L7.25 2.5Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M9 10.4a2.1 2.1 0 1 0 0-4.2 2.1 2.1 0 0 0 0 4.2Z" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function IconSearchMini() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path d="M16.7 16.7 21 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconBurgerBadge() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5.25 10.5C5.7 7.63604 8.43351 5.5 12 5.5C15.5665 5.5 18.3 7.63604 18.75 10.5H5.25Z" stroke="#111111" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.5 13.5H19.5" stroke="#111111" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M6 15.75H18" stroke="#111111" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M6.75 18H17.25" stroke="#111111" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M17.8 6.2L19.8 4.2" stroke="#111111" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M19.2 6.8H21.2" stroke="#111111" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

type TabKey = "minha-conta" | "alterar-senha" | "minha-empresa" | "usuarios" | "planos";

export default function AjustesClient() {
  const searchParams = useSearchParams();
  const tab = useMemo(() => {
    const raw = String(searchParams.get("tab") ?? "").trim().toLowerCase();
    if (raw === "alterar-senha") return "alterar-senha";
    if (raw === "minha-empresa") return "minha-empresa";
    if (raw === "usuarios") return "usuarios";
    if (raw === "planos") return "planos";
    return "minha-conta";
  }, [searchParams]);

  const [nome, setNome] = useState(() => String(readMeFromStore()?.nome ?? "").trim());
  const [sobrenome, setSobrenome] = useState(() => String(readMeFromStore()?.sobrenome ?? "").trim());
  const [email, setEmail] = useState(() => String(readMeFromStore()?.email ?? "").trim());
  const [whatsapp, setWhatsapp] = useState(() => String(readMeFromStore()?.whatsapp ?? "").trim());
  const [permissao, setPermissao] = useState<"Administrador" | "Colaborador">("Colaborador");

  const [senhaAtual, setSenhaAtual] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [repitaSenha, setRepitaSenha] = useState("");

  const [empresaNome, setEmpresaNome] = useState(() => String(readMeFromStore()?.companyName ?? "").trim());
  const [cnpj, setCnpj] = useState("51.590.020/0001-25");
  const [emailCorp, setEmailCorp] = useState("");
  const [empresaWhats, setEmpresaWhats] = useState("(00) 00000-0000");
  const [ramo, setRamo] = useState("Hamburgueria");

  const [planType, setPlanType] = useState<"PRO Mensal" | "PRO Anual">("PRO Mensal");
  const [cardLast4, setCardLast4] = useState("8895");
  const [planStatus, setPlanStatus] = useState("");
  const [members, setMembers] = useState(() => readMeFromStore()?.members ?? []);

  const [loggingOut, setLoggingOut] = useState(false);

  const canSaveAccount = Boolean(nome.trim() && sobrenome.trim() && email.trim() && whatsapp.trim() && permissao);
  const canSavePassword = Boolean(senhaAtual.trim() && novaSenha.trim() && repitaSenha.trim() && novaSenha === repitaSenha);
  const canSaveCompany = Boolean(empresaNome.trim() && cnpj.trim() && empresaWhats.trim() && ramo.trim());

  function tabClass(key: TabKey) {
    return key === tab ? `${styles.tab} ${styles.tabActive}` : styles.tab;
  }

  const [avatarUrl, setAvatarUrl] = useState(() => String(readMeFromStore()?.avatarUrl ?? "").trim());

  useEffect(() => {
    const apply = () => {
      const me = readMeFromStore();
      if (!me) return;
      setNome((prev) => (prev.trim() ? prev : String(me.nome ?? "").trim()));
      setSobrenome((prev) => (prev.trim() ? prev : String(me.sobrenome ?? "").trim()));
      setEmail((prev) => (prev.trim() ? prev : String(me.email ?? "").trim()));
      setWhatsapp((prev) => (prev.trim() ? prev : String(me.whatsapp ?? "").trim()));
      setEmpresaNome((prev) => (prev.trim() ? prev : String(me.companyName ?? "").trim()));
      setAvatarUrl(String(me.avatarUrl ?? "").trim());
      setMembers(Array.isArray(me.members) ? me.members : []);
      const planRaw = String(me.planType ?? "").trim();
      if (planRaw) {
        const up = planRaw.toUpperCase();
        if (up.includes("ANUAL")) setPlanType("PRO Anual");
        else setPlanType("PRO Mensal");
      }
      setPlanStatus(String(me.planStatus ?? "").trim());
      const last4 = String(me.cardLast4 ?? "").trim().replace(/[^\d]/g, "");
      if (last4.length >= 4) setCardLast4(last4.slice(-4));
    };
    apply();
    const unsub = subscribeMe(() => apply());
    void loadMeFromApi().then(() => apply());
    return () => unsub();
  }, []);

  return (
    <div className={dash.dashboard}>
      <AppSidebar active="ajustes" />
      <main className={dash.content}>
        <div className={dash.pageFrame}>
          <div className={styles.pageWrap}>
            <div className={styles.header}>
              <div className={styles.headerIcon} aria-hidden>
                <IconGearSmall />
              </div>
              <h1 className={styles.title}>Ajustes da Conta</h1>
            </div>

            <div className={styles.tabs}>
              <a className={tabClass("minha-conta")} href="/ajustes?tab=minha-conta">
                Minha Conta
              </a>
              <a className={tabClass("alterar-senha")} href="/ajustes?tab=alterar-senha">
                Alterar Senha
              </a>
              <a className={tabClass("minha-empresa")} href="/ajustes?tab=minha-empresa">
                Minha Empresa
              </a>
              <a className={tabClass("usuarios")} href="/ajustes?tab=usuarios">
                Usuários
              </a>
              <a className={tabClass("planos")} href="/ajustes?tab=planos">
                Planos
              </a>
            </div>

            <section className={styles.panel}>
              {tab === "minha-conta" ? (
                <div className={styles.panelInner}>
                  <div className={styles.avatarRow}>
                    <div className={styles.avatarBox}>
                      <span className={styles.avatarIcon} aria-hidden>
                        {avatarUrl ? <img src={avatarUrl} alt="" style={{ width: "100%", height: "100%", borderRadius: "inherit", objectFit: "cover" }} /> : <IconBurgerBadge />}
                      </span>
                      <span>Enviar Imagem</span>
                    </div>
                    <div>
                      <div className={styles.avatarHint}>Tamanho recomendado: 600 x 600 px</div>
                    </div>
                  </div>

                  <div className={styles.sectionTitle}>Informações da Conta</div>
                  <div className={styles.grid2}>
                    <label className={styles.field}>
                      <span className={styles.label}>Nome</span>
                      <input className={styles.input} value={nome} onChange={(e) => setNome(e.target.value)} />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.label}>Sobrenome</span>
                      <input className={styles.input} value={sobrenome} onChange={(e) => setSobrenome(e.target.value)} />
                    </label>

                    <label className={styles.field}>
                      <span className={styles.label}>Email</span>
                      <input className={styles.input} value={email} onChange={(e) => setEmail(e.target.value)} />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.label}>WhatsApp</span>
                      <div className={styles.phoneRow}>
                        <div className={styles.phonePrefix}>+55</div>
                        <input className={styles.input} value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
                      </div>
                    </label>

                    <label className={styles.field} style={{ gridColumn: "span 2" }}>
                      <span className={styles.label}>Nível de Permissão</span>
                      <select className={styles.select} value={permissao} onChange={(e) => setPermissao(e.target.value as any)}>
                        <option value="Administrador">Administrador</option>
                        <option value="Colaborador">Colaborador</option>
                      </select>
                    </label>
                  </div>

                  <div className={styles.actions}>
                    <button type="button" className={styles.btnPrimary} disabled={!canSaveAccount}>
                      Salvar
                    </button>
                    <button
                      type="button"
                      className={styles.btnDanger}
                      disabled={loggingOut}
                      onClick={async () => {
                        if (loggingOut) return;
                        setLoggingOut(true);
                        try {
                          await fetch("/api/auth/logout", { method: "POST" });
                        } finally {
                          clearMeStore();
                          window.location.href = "/login";
                        }
                      }}
                    >
                      {loggingOut ? "Saindo…" : "Logout"}
                    </button>
                  </div>
                </div>
              ) : null}

              {tab === "alterar-senha" ? (
                <div className={styles.panelInner}>
                  <div className={styles.sectionTitle}>Senha Atual</div>
                  <label className={styles.field}>
                    <input className={styles.input} type="password" value={senhaAtual} onChange={(e) => setSenhaAtual(e.target.value)} />
                  </label>
                  <a className={styles.hintLink} href="/resetar-senha">
                    Esqueci a senha
                  </a>

                  <div className={styles.sectionTitle} style={{ marginTop: 16 }}>
                    Nova Senha
                  </div>
                  <label className={styles.field}>
                    <input className={styles.input} type="password" value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} />
                  </label>

                  <div className={styles.sectionTitle} style={{ marginTop: 12 }}>
                    Repita Nova Senha
                  </div>
                  <label className={styles.field}>
                    <input className={styles.input} type="password" value={repitaSenha} onChange={(e) => setRepitaSenha(e.target.value)} />
                  </label>

                  <div className={styles.actions}>
                    <button type="button" className={styles.btnPrimary} disabled={!canSavePassword}>
                      Salvar
                    </button>
                  </div>
                </div>
              ) : null}

              {tab === "minha-empresa" ? (
                <div className={styles.panelInner}>
                  <div className={styles.avatarRow}>
                    <div className={styles.avatarBox} style={{ borderRadius: 999, background: "#f4c400", color: "#01040e" }}>
                      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path
                          d="M5 10.5c0-2.5 3-4.5 7-4.5s7 2 7 4.5"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                        />
                        <path d="M6 11.5h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                        <path
                          d="M6.5 13.5h11c.3 0 .5.2.5.5v.7c0 1.6-1.3 2.8-2.8 2.8H8.8C7.2 17.5 6 16.3 6 14.7V14c0-.3.2-.5.5-.5Z"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinejoin="round"
                        />
                        <path d="M7.5 12.5h2.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                        <path d="M11 12.5h2.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                        <path d="M14.5 12.5h2.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                      </svg>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", rowGap: 6 }}>
                      <button type="button" className={styles.btnGhost}>
                        Enviar Imagem
                      </button>
                      <button type="button" className={styles.btnGhost}>
                        Apagar
                      </button>
                      <div className={styles.avatarHint}>Tamanho recomendado: 600 x 600 px</div>
                    </div>
                  </div>

                  <div className={styles.sectionTitle}>Informações da Empresa</div>
                  <div className={styles.grid2}>
                    <label className={styles.field}>
                      <span className={styles.label}>Nome da Empresa</span>
                      <input className={styles.input} value={empresaNome} onChange={(e) => setEmpresaNome(e.target.value)} />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.label}>CNPJ</span>
                      <input className={styles.input} value={cnpj} onChange={(e) => setCnpj(e.target.value)} />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.label}>Email Corporativo</span>
                      <input className={styles.input} value={emailCorp} onChange={(e) => setEmailCorp(e.target.value)} placeholder="Seu email corporativo" />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.label}>WhatsApp Empresa</span>
                      <div className={styles.phoneRow}>
                        <div className={styles.phonePrefix}>+55</div>
                        <input className={styles.input} value={empresaWhats} onChange={(e) => setEmpresaWhats(e.target.value)} />
                      </div>
                    </label>
                    <label className={styles.field} style={{ gridColumn: "span 1" }}>
                      <span className={styles.label}>Ramo de Atividade</span>
                      <select className={styles.select} value={ramo} onChange={(e) => setRamo(e.target.value)}>
                        <option value="Hamburgueria">Hamburgueria</option>
                        <option value="Restaurante">Restaurante</option>
                        <option value="Bar">Bar</option>
                        <option value="Pizzaria">Pizzaria</option>
                        <option value="Sushi / Japonês">Sushi / Japonês</option>
                        <option value="Cafeteria">Cafeteria</option>
                        <option value="Padaria">Padaria</option>
                        <option value="Confeitaria">Confeitaria</option>
                        <option value="Açaíteria">Açaíteria</option>
                        <option value="Sorveteria">Sorveteria</option>
                        <option value="Churrascaria">Churrascaria</option>
                        <option value="Steakhouse">Steakhouse</option>
                        <option value="Lanchonete">Lanchonete</option>
                        <option value="Fast Food">Fast Food</option>
                        <option value="Food Truck">Food Truck</option>
                        <option value="Marmitex">Marmitex</option>
                        <option value="Delivery / Dark Kitchen">Delivery / Dark Kitchen</option>
                        <option value="Self-service">Self-service</option>
                        <option value="Buffet">Buffet</option>
                        <option value="Pastelaria">Pastelaria</option>
                        <option value="Casa de Sucos">Casa de Sucos</option>
                        <option value="Poke">Poke</option>
                        <option value="Culinária Italiana">Culinária Italiana</option>
                        <option value="Culinária Mexicana">Culinária Mexicana</option>
                        <option value="Culinária Árabe">Culinária Árabe</option>
                        <option value="Culinária Brasileira">Culinária Brasileira</option>
                        <option value="Culinária Asiática">Culinária Asiática</option>
                        <option value="Culinária Vegana">Culinária Vegana</option>
                        <option value="Culinária Fitness">Culinária Fitness</option>
                        <option value="Bistrô">Bistrô</option>
                        <option value="Cozinha Industrial">Cozinha Industrial</option>
                        <option value="Outros">Outros</option>
                      </select>
                    </label>
                  </div>

                  <div className={styles.actions}>
                    <button type="button" className={styles.btnPrimary} disabled={!canSaveCompany}>
                      Salvar
                    </button>
                  </div>
                </div>
              ) : null}

              {tab === "usuarios" ? (
                <div>
                  <div className={styles.table}>
                    <div className={styles.trHead}>
                      <div>Membro</div>
                      <div>Data de Admissão</div>
                      <div>Permissão</div>
                    </div>
                    {members.map((m) => (
                      <div key={`${m.email}:${m.name}`} className={styles.tr}>
                        <div className={styles.memberCell}>
                          <div className={styles.memberAvatar} aria-hidden>
                            {m.avatarUrl ? (
                              <img src={m.avatarUrl} alt="" style={{ width: "100%", height: "100%", borderRadius: "inherit", objectFit: "cover" }} />
                            ) : (
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                                <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" stroke="currentColor" strokeWidth="2" />
                                <path d="M20 20c0-4-3.2-6-8-6s-8 2-8 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                              </svg>
                            )}
                          </div>
                          <div className={styles.memberMeta}>
                            <div className={styles.memberName}>{m.name}</div>
                            <div className={styles.memberEmail}>{m.email}</div>
                          </div>
                        </div>
                        <div>{m.joinedAt || "—"}</div>
                        <div className={m.role === "Administrador" ? styles.badgeAdmin : styles.badgeCollab}>{m.role}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {tab === "planos" ? (
                <div className={styles.plansWrap}>
                  <div className={styles.plansTopRow}>
                    <div className={styles.planMiniCard}>
                      <div className={styles.planMiniTitle}>Plano</div>
                      <div className={styles.planMiniValue}>{planType}</div>
                      <button type="button" className={styles.planMiniLink} disabled>
                        Alterar
                      </button>
                    </div>
                    <div className={styles.planMiniCard}>
                      <div className={styles.planMiniTitle}>Status</div>
                      <div className={styles.planMiniValue}>{planStatus || "—"}</div>
                      <div className={styles.planMiniMuted}>Status da assinatura</div>
                    </div>
                    <div className={styles.planMiniCard}>
                      <div className={styles.planMiniTitle}>Cartão</div>
                      <div className={styles.planMiniValue}>{cardLast4 ? `**** **** **** ${cardLast4}` : "—"}</div>
                      <button type="button" className={styles.planMiniLink} disabled>
                        Alterar
                      </button>
                    </div>
                  </div>

                  <div className={styles.plansGrid}>
                    <div className={styles.planCard}>
                      <div className={styles.planHeader}>
                        <div className={styles.planName}>PRO Mensal</div>
                        <div className={styles.planPriceRow}>
                          <span className={styles.planPrice}>R$ 97,00</span>
                          <span className={styles.planPriceMeta}>/ pago mensalmente</span>
                        </div>
                        <div className={styles.planSeat}>Até 3 usuários inclusos</div>
                      </div>
                      <button type="button" className={styles.planSelectBtn} disabled>
                        Selecionar Plano
                      </button>
                      <ul className={styles.planList}>
                        <li>Cadastro ilimitado de itens</li>
                        <li>Cadastro ilimitado de fornecedores</li>
                        <li>Cadastro ilimitado de compras</li>
                        <li>Contagem ilimitada de inventário</li>
                        <li>Suporte via WhatsApp</li>
                      </ul>
                    </div>

                    <div className={styles.planCard}>
                      <div className={styles.planHeader}>
                        <div className={styles.planNameRow}>
                          <div className={styles.planName}>PRO Anual</div>
                          <span className={styles.planBadge}>25% OFF</span>
                        </div>
                        <div className={styles.planPriceRow}>
                          <span className={styles.planPrice}>R$ 873,00</span>
                          <span className={styles.planPriceMeta}>/ pago anualmente</span>
                        </div>
                        <div className={styles.planSeat}>Até 3 usuários inclusos</div>
                      </div>
                      <button type="button" className={styles.planSelectBtn} disabled>
                        Selecionar Plano
                      </button>
                      <ul className={styles.planList}>
                        <li>Cadastro ilimitado de itens</li>
                        <li>Cadastro ilimitado de fornecedores</li>
                        <li>Cadastro ilimitado de compras</li>
                        <li>Contagem ilimitada de inventário</li>
                        <li>Suporte via WhatsApp</li>
                      </ul>
                    </div>
                  </div>
                </div>
              ) : null}
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
