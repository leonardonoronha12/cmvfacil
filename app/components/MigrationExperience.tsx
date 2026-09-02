"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import styles from "./MigrationExperience.module.css";

const TOUR_VERSION = "2026-09-migrados-v1";
const SUPPORT_PHONE = "5513936180830";

const steps = [
  { title: "Bem-vindo ao novo CMV Fácil", text: "Seus dados vieram do sistema antigo. Este passeio mostra onde estão as funções conhecidas e o que ficou mais simples." },
  { title: "Tudo organizado no menu", text: "CMV Real, compras, fichas, insumos, pré-preparos, fornecedores, entradas, inventários e desperdícios continuam disponíveis no menu lateral." },
  { title: "Inventário por setores", text: "Separe Bar, Cozinha, Estoque Seco e outros setores para contar, acompanhar e revisar cada área com mais clareza." },
  { title: "Novo conversor de unidades", text: "Converta caixas, pacotes, unidades, gramas, quilos, mililitros e litros sem fazer a conta manualmente." },
  { title: "Todos os insumos nas notas", text: "Ao lançar uma entrada, o dropdown mostra todo o catálogo. Ao selecionar um item, o vínculo com o fornecedor é mantido automaticamente." },
  { title: "Ajuda sem sair do sistema", text: "Use o novo assistente para tirar dúvidas ou enviar um problema com imagens e vídeos. Ele identifica sua conta e prepara o chamado para o suporte." },
];

type Me = { userId?: string; email?: string; nomeCompleto?: string; companyName?: string; source?: { hasBubbleMatch?: boolean; userBubbleId?: string | null } };
type ChatLine = { from: "bot" | "user"; text: string };

export default function MigrationExperience() {
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [tourOpen, setTourOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [ticket, setTicket] = useState<{ protocol: string; whatsappUrl: string; forwarded: boolean } | null>(null);
  const [lines, setLines] = useState<ChatLine[]>([{ from: "bot", text: "Olá! Sou o assistente do CMV Fácil. Conte sua dúvida ou o que não está funcionando." }]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/me?tour=1&ts=${Date.now()}`, { cache: "no-store" })
      .then(r => r.json())
      .then((data: Me & { ok?: boolean }) => {
        if (!active || !data?.ok) return;
        setMe(data);
        const migrated = Boolean(data.source?.hasBubbleMatch || data.source?.userBubbleId);
        if (migrated && localStorage.getItem(`cmvfacil:onboarding:${TOUR_VERSION}:${data.userId}`) !== "done") setTourOpen(true);
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const fileLabel = useMemo(() => files.map(file => file.name).join(", "), [files]);
  const finishTour = () => {
    if (me?.userId) localStorage.setItem(`cmvfacil:onboarding:${TOUR_VERSION}:${me.userId}`, "done");
    setTourOpen(false); setStep(0);
  };
  const onFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []).filter(file => /^(image|video)\//.test(file.type)).slice(0, 3);
    setFiles(selected);
  };
  const submit = async () => {
    const bodyText = message.trim();
    if (!bodyText || sending) return;
    setLines(current => [...current, { from: "user", text: bodyText }]);
    setSending(true); setTicket(null);
    try {
      const body = new FormData(); body.set("message", bodyText); body.set("page", String(pathname || "/"));
      files.forEach(file => body.append("attachments", file));
      const response = await fetch("/api/support/ticket", { method: "POST", body });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) throw new Error(data?.error || "Não foi possível registrar o chamado.");
      setTicket({ protocol: data.protocol, whatsappUrl: data.whatsappUrl, forwarded: data.forwarded === true });
      setLines(current => [...current, { from: "bot", text: data.forwarded === true
        ? `Chamado ${data.protocol} registrado e enviado automaticamente ao suporte. Você receberá o retorno pelo WhatsApp.`
        : `Chamado ${data.protocol} registrado. O envio automático não respondeu; use o botão abaixo para encaminhar pelo WhatsApp.` }]);
      setMessage(""); setFiles([]); if (inputRef.current) inputRef.current.value = "";
    } catch (error) {
      const fallback = `https://wa.me/${SUPPORT_PHONE}?text=${encodeURIComponent(`Olá, preciso de suporte no CMV Fácil.\nUsuário: ${me?.email || "não identificado"}\nEmpresa: ${me?.companyName || "não identificada"}\nPágina: ${pathname}\nProblema: ${bodyText}`)}`;
      setTicket({ protocol: "sem protocolo", whatsappUrl: fallback, forwarded: false });
      setLines(current => [...current, { from: "bot", text: error instanceof Error ? `${error.message} Você ainda pode encaminhar a mensagem pelo WhatsApp.` : "Você pode encaminhar a mensagem pelo WhatsApp." }]);
    } finally { setSending(false); }
  };

  return <>
    {tourOpen ? <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Conheça o novo CMV Fácil">
      <section className={styles.tourCard}>
        <div className={styles.eyebrow}>NOVIDADES PARA VOCÊ</div>
        <div className={styles.progress}>{steps.map((_, index) => <span key={index} className={index <= step ? styles.progressOn : ""} />)}</div>
        <h2>{steps[step].title}</h2><p>{steps[step].text}</p>
        <div className={styles.tourActions}>
          <button className={styles.ghost} onClick={finishTour}>Pular passeio</button>
          <div><button className={styles.ghost} disabled={step === 0} onClick={() => setStep(value => Math.max(0, value - 1))}>Voltar</button>
          {step < steps.length - 1 ? <button className={styles.primary} onClick={() => setStep(value => value + 1)}>Próximo</button> : <button className={styles.primary} onClick={finishTour}>Começar a usar</button>}</div>
        </div>
      </section>
    </div> : null}

    <div className={styles.helpActions}>
      <button className={styles.tourButton} onClick={() => { setStep(0); setTourOpen(true); }}>Ver novidades</button>
      <button className={styles.chatButton} onClick={() => setChatOpen(value => !value)} aria-expanded={chatOpen}>💬 Ajuda</button>
    </div>
    {chatOpen ? <aside className={styles.chat} aria-label="Assistente de suporte">
      <header><div><strong>Assistente CMV Fácil</strong><small>Suporte e dúvidas</small></div><button onClick={() => setChatOpen(false)} aria-label="Fechar">×</button></header>
      <div className={styles.messages}>{lines.map((line, index) => <div key={index} className={line.from === "bot" ? styles.bot : styles.user}>{line.text}</div>)}</div>
      <div className={styles.composer}>
        <textarea value={message} onChange={event => setMessage(event.target.value)} placeholder="Descreva sua dúvida ou problema…" rows={3} />
        <input ref={inputRef} type="file" accept="image/*,video/*" multiple onChange={onFiles} />
        <button className={styles.attach} onClick={() => inputRef.current?.click()}>📎 Enviar imagem ou vídeo</button>
        {fileLabel ? <small className={styles.files}>{fileLabel}</small> : null}
        <button className={styles.primary} disabled={!message.trim() || sending} onClick={submit}>{sending ? "Registrando…" : "Registrar chamado"}</button>
        {ticket ? <a className={styles.whatsapp} href={ticket.whatsappUrl} target="_blank" rel="noreferrer">{ticket.forwarded ? "Abrir conversa no WhatsApp" : "Enviar pelo WhatsApp"}</a> : null}
      </div>
    </aside> : null}
  </>;
}
