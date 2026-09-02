"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import styles from "./MigrationExperience.module.css";

const TOUR_VERSION = "2026-09-primeiro-acesso-v4";
const ACTIVE_TOUR_KEY = `cmvfacil:onboarding:active:${TOUR_VERSION}`;
const DONE_TOUR_KEY = `cmvfacil:onboarding:done:${TOUR_VERSION}`;
const SUPPORT_PHONE = "5513936180830";

const steps = [
  { path: "/dashboard", icon: "✨", kicker: "Uma experiência renovada", title: "Bem-vindo ao novo CMV Fácil", text: "Seus dados continuam aqui, agora em uma experiência mais rápida, organizada e simples de usar.", improvement: "Eu vou caminhar com você pelas telas e mostrar como cada melhoria economiza tempo na sua rotina.", bullets: ["Dados preservados", "Mais agilidade", "Ajuda sempre disponível"] },
  { path: "/dashboard", icon: "🧭", kicker: "Tudo no lugar certo", title: "Navegue sem se perder", text: "As rotinas que você já conhece estão reunidas no menu lateral e a troca entre telas ficou mais direta.", improvement: "Assim você encontra qualquer tarefa em poucos cliques: relatórios acima, cadastros no centro e a operação diária logo abaixo.", bullets: ["Relatórios", "Cadastros", "Rotina diária"] },
  { path: "/inventario", icon: "📦", kicker: "Você está no Inventário", title: "Contagens por setor", text: "Organize Bar, Cozinha, Estoque Seco e outras áreas. Fica mais fácil saber o que falta e o que já foi contado.", improvement: "Sua equipe pode dividir a contagem por área, enxergar os pendentes e retomar o trabalho com segurança, reduzindo esquecimentos.", bullets: ["Separação por setores", "Pendentes visíveis", "Histórico organizado"] },
  { path: "/entradas", icon: "⚖️", kicker: "Novidade nas Entradas", title: "Conversor de unidades", text: "Converta caixas, pacotes, unidades, gramas, quilos, mililitros e litros enquanto lança a nota.", improvement: "Você informa como comprou e como controla o estoque; o sistema cuida da conta, evitando calculadora, retrabalho e diferenças por unidade incorreta.", bullets: ["Conversão automática", "Menos contas manuais", "Menos erros de lançamento"] },
  { path: "/entradas", icon: "🔎", kicker: "Catálogo completo", title: "Encontre qualquer insumo", text: "O dropdown da nota mostra todo o catálogo e mantém automaticamente o vínculo correto com o fornecedor.", improvement: "Mesmo na primeira compra daquele fornecedor, o item aparece. Você lança mais rápido e constrói um histórico de preços mais confiável.", bullets: ["Todos os insumos", "Busca mais rápida", "Fornecedor vinculado"] },
  { path: "/dashboard", icon: "💬", kicker: "Estamos com você", title: "Suporte dentro do sistema", text: "Conte o que aconteceu e envie imagem ou vídeo. O chamado chega ao time do CMV Fácil com os dados da sua conta.", improvement: "Você não precisa sair do sistema nem explicar tudo de novo: eu preparo o contexto, a página, sua empresa e os anexos para o atendimento começar mais rápido.", bullets: ["Protocolo automático", "Imagens e vídeos", "Envio direto ao suporte"] },
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
  const [typedText, setTypedText] = useState("");
  const [lines, setLines] = useState<ChatLine[]>([{ from: "bot", text: "Olá! Sou o assistente do CMV Fácil. Conte sua dúvida ou o que não está funcionando." }]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    if (localStorage.getItem(DONE_TOUR_KEY) !== "done") {
      const savedStep = Number(sessionStorage.getItem(ACTIVE_TOUR_KEY) ?? "0");
      const initialStep = Number.isInteger(savedStep) && savedStep >= 0 && savedStep < steps.length ? savedStep : 0;
      sessionStorage.setItem(ACTIVE_TOUR_KEY, String(initialStep));
      setStep(initialStep);
      setTourOpen(true);
      if (pathname !== steps[initialStep].path) window.location.assign(steps[initialStep].path);
    }
    fetch(`/api/me?tour=1&ts=${Date.now()}`, { cache: "no-store" })
      .then(r => r.json())
      .then((data: Me & { ok?: boolean }) => {
        if (!active || !data?.ok) return;
        setMe(data);
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!tourOpen || step === 0) return;
    const fullText = `${steps[step].text} ${steps[step].improvement}`;
    setTypedText("");
    let cursor = 0;
    const timer = window.setInterval(() => {
      cursor = Math.min(fullText.length, cursor + 3);
      setTypedText(fullText.slice(0, cursor));
      if (cursor >= fullText.length) window.clearInterval(timer);
    }, 18);
    return () => window.clearInterval(timer);
  }, [step, tourOpen]);

  const goToStep = (nextStep: number) => {
    const bounded = Math.max(0, Math.min(steps.length - 1, nextStep));
    sessionStorage.setItem(ACTIVE_TOUR_KEY, String(bounded));
    setStep(bounded);
    const destination = steps[bounded].path;
    if (pathname !== destination) window.location.assign(destination);
  };

  const fileLabel = useMemo(() => files.map(file => file.name).join(", "), [files]);
  const finishTour = () => {
    localStorage.setItem(DONE_TOUR_KEY, "done");
    if (me?.userId) localStorage.setItem(`cmvfacil:onboarding:${TOUR_VERSION}:${me.userId}`, "done");
    sessionStorage.removeItem(ACTIVE_TOUR_KEY);
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
    {tourOpen && step === 0 ? <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Conheça o novo CMV Fácil">
      <section className={styles.tourCard}>
        <header className={styles.tourHeader}><strong><span>cmv</span>fácil</strong><div>Tour de novidades <b>{step + 1}/{steps.length}</b></div></header>
        <div className={styles.progress}>{steps.map((item, index) => <button key={item.title} aria-label={`Ir para etapa ${index + 1}`} onClick={() => goToStep(index)} className={index <= step ? styles.progressOn : ""}><span /></button>)}</div>
        <div className={styles.tourBody}>
          <div className={`${styles.visual} ${styles[`visual${step}`] || ""}`}>
            <span className={styles.orbOne} /><span className={styles.orbTwo} />
            <div className={styles.heroIcon}>{steps[step].icon}</div>
            <div className={styles.miniWindow}><i /><i /><i /><div><span /><span /><span /></div></div>
            <small>PASSO {String(step + 1).padStart(2, "0")}</small>
          </div>
          <div className={styles.copy}>
            <div className={styles.eyebrow}>{steps[step].kicker}</div>
            <h2>{steps[step].title}</h2><p>{steps[step].text}</p>
            <ul>{steps[step].bullets.map(item => <li key={item}><span>✓</span>{item}</li>)}</ul>
          </div>
        </div>
        <div className={styles.tourActions}>
          <button className={styles.skip} onClick={finishTour}>Pular apresentação</button>
          <div><button className={styles.ghost} disabled={step === 0} onClick={() => goToStep(step - 1)}>Voltar</button>
          {step < steps.length - 1 ? <button className={styles.primary} onClick={() => goToStep(step + 1)}>Continuar <span>→</span></button> : <button className={styles.primary} onClick={finishTour}>Explorar o CMV Fácil <span>→</span></button>}</div>
        </div>
      </section>
    </div> : null}
    {tourOpen && step > 0 ? <aside className={styles.coach} role="dialog" aria-label="Guia do novo CMV Fácil">
      <div className={styles.coachGlow} />
      <header className={styles.coachHeader}>
        <div className={styles.robot}><span>{steps[step].icon}</span><i>🤖</i></div>
        <div><strong>Fácil, seu guia</strong><small><i /> explicando esta tela</small></div>
        <b>{step + 1}/{steps.length}</b>
      </header>
      <div className={styles.speech}>
        <div className={styles.coachKicker}>{steps[step].kicker}</div>
        <h3>{steps[step].title}</h3>
        <p>{typedText}<span className={styles.typingCursor} /></p>
        <div className={styles.benefits}>{steps[step].bullets.map(item => <span key={item}>✓ {item}</span>)}</div>
      </div>
      <div className={styles.coachProgress}>{steps.map((item, index) => <button aria-label={`Etapa ${index + 1}`} key={item.title} onClick={() => goToStep(index)} className={index === step ? styles.coachProgressOn : index < step ? styles.coachProgressDone : ""} />)}</div>
      <div className={styles.coachActions}>
        <button className={styles.coachSkip} onClick={finishTour}>Encerrar tour</button>
        <div><button className={styles.coachBack} onClick={() => goToStep(step - 1)}>←</button>
        {step < steps.length - 1 ? <button className={styles.coachNext} onClick={() => goToStep(step + 1)}>Me mostre a próxima <span>→</span></button> : <button className={styles.coachNext} onClick={finishTour}>Tudo pronto! <span>✓</span></button>}</div>
      </div>
    </aside> : null}

    <div className={styles.helpActions}>
      <button className={styles.tourButton} onClick={() => { goToStep(0); setTourOpen(true); }}>Ver novidades</button>
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
