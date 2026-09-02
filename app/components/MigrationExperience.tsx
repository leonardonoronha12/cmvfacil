"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import styles from "./MigrationExperience.module.css";

const TOUR_VERSION = "2026-09-primeiro-acesso-v5";
const ACTIVE_TOUR_KEY = `cmvfacil:onboarding:active:${TOUR_VERSION}`;
const DONE_TOUR_KEY = `cmvfacil:onboarding:done:${TOUR_VERSION}`;
const SUPPORT_PHONE = "5513936180830";

const steps = [
  { path: "/dashboard", icon: "✨", kicker: "Uma experiência renovada", title: "Bem-vindo ao novo CMV Fácil", text: "Seus dados continuam aqui, agora em uma experiência mais rápida, organizada e simples de usar.", improvement: "Eu vou caminhar com você pelas telas. A partir do próximo passo, clique apenas no que estiver iluminado.", bullets: ["Dados preservados", "Tour interativo", "Ajuda sempre disponível"] },
  { path: "/dashboard", target: { selector: 'a[href="/inventario"]' }, icon: "🧭", kicker: "Sua vez", title: "Abra o Inventário", text: "A tela ficou escura para destacar exatamente onde você deve clicar.", improvement: "Clique em Inventário no menu lateral. Eu vou junto e continuo a explicação na próxima tela.", bullets: ["Clique no item iluminado"] },
  { path: "/inventario", target: { text: "Nova Contagem", tag: "button" }, icon: "📦", kicker: "Inventário por setores", title: "Crie uma nova contagem", text: "Agora você pode separar Bar, Cozinha, Estoque Seco e outras áreas.", improvement: "Clique em Nova Contagem para conhecer a janela. Nada será salvo sem sua confirmação.", bullets: ["Setores organizados", "Pendentes visíveis"] },
  { path: "/inventario", target: { selector: '[role="dialog"] button[aria-label="Fechar"]' }, icon: "✅", kicker: "Simples e seguro", title: "Você conheceu a nova contagem", text: "É aqui que uma data de inventário é iniciada para depois receber as quantidades de cada setor.", improvement: "Feche a janela no X iluminado para seguirmos. Nenhum registro será criado durante este tour.", bullets: ["Clique no X para continuar"] },
  { path: "/inventario", target: { selector: 'a[href="/entradas"]' }, icon: "⚖️", kicker: "Próxima novidade", title: "Vamos para Entradas", text: "O lançamento de notas ganhou recursos que reduzem contas manuais e itens não encontrados.", improvement: "Clique em Entradas no menu lateral para eu mostrar onde tudo começa.", bullets: ["Clique em Entradas"] },
  { path: "/entradas", target: { text: "Nova Nota", tag: "button" }, icon: "🧾", kicker: "Lançamento mais fácil", title: "Abra uma nova nota", text: "O novo fluxo prepara fornecedor e data antes da inclusão dos produtos.", improvement: "Clique em Nova Nota. Você poderá conhecer a tela sem salvar nenhuma informação.", bullets: ["Fluxo guiado", "Sem salvar agora"] },
  { path: "/entradas", target: { selector: '[role="dialog"] button[aria-label="Fechar"]' }, icon: "🔎", kicker: "Catálogo e conversão", title: "Mais recursos ao lançar", text: "Depois de criar uma nota, o dropdown apresenta todos os insumos e o conversor ajusta caixas, unidades, quilos e litros.", improvement: "Isso reduz retrabalho e mantém fornecedor, quantidade e custo coerentes. Feche esta janela no X iluminado.", bullets: ["Todos os insumos", "Conversão automática"] },
  { path: "/entradas", target: { selector: 'button[data-tour="support"]' }, icon: "💬", kicker: "Suporte inteligente", title: "Fale comigo quando precisar", text: "O botão Ajuda acompanha você em todas as telas.", improvement: "Clique no botão iluminado. Você pode escrever, anexar imagem ou vídeo e enviar o chamado automaticamente ao WhatsApp do suporte.", bullets: ["Clique em Ajuda", "Atendimento com contexto"] },
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
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
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

  useEffect(() => {
    if (!tourOpen || step === 0 || !steps[step].target) { setTargetRect(null); return; }
    const locate = () => {
      const target = steps[step].target as { selector?: string; text?: string; tag?: string };
      let element = target.selector ? document.querySelector(target.selector) : null;
      if (!element && target.text) element = Array.from(document.querySelectorAll(target.tag || "button,a")).find(item => item.textContent?.trim().includes(target.text!)) ?? null;
      if (element instanceof HTMLElement) {
        const rect = element.getBoundingClientRect(); setTargetRect(rect);
        element.scrollIntoView({ block: "center", behavior: "smooth" });
      } else setTargetRect(null);
    };
    locate(); const timer = window.setInterval(locate, 350); window.addEventListener("resize", locate);
    return () => { window.clearInterval(timer); window.removeEventListener("resize", locate); };
  }, [step, tourOpen, pathname]);

  useEffect(() => {
    if (!tourOpen || step === 0 || !steps[step].target) return;
    const onClick = (event: MouseEvent) => {
      const target = steps[step].target as { selector?: string; text?: string; tag?: string };
      const element = target.selector ? document.querySelector(target.selector) : Array.from(document.querySelectorAll(target.tag || "button,a")).find(item => item.textContent?.trim().includes(target.text || ""));
      if (!element || !(event.target instanceof Node) || !element.contains(event.target)) return;
      const next = step + 1;
      if (next >= steps.length) { window.setTimeout(finishTour, 80); return; }
      sessionStorage.setItem(ACTIVE_TOUR_KEY, String(next));
      window.setTimeout(() => setStep(next), 80);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
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
        <div><button className={styles.coachBack} onClick={() => goToStep(step - 1)}>←</button><strong className={styles.clickHint}>Clique no destaque para continuar</strong></div>
      </div>
    </aside> : null}
    {tourOpen && step > 0 && targetRect ? <div className={styles.spotlight} aria-hidden>
      <i style={{ left: 0, top: 0, width: "100%", height: Math.max(0, targetRect.top - 9) }} />
      <i style={{ left: 0, top: targetRect.bottom + 9, width: "100%", bottom: 0 }} />
      <i style={{ left: 0, top: Math.max(0, targetRect.top - 9), width: Math.max(0, targetRect.left - 9), height: targetRect.height + 18 }} />
      <i style={{ left: targetRect.right + 9, top: Math.max(0, targetRect.top - 9), right: 0, height: targetRect.height + 18 }} />
      <b style={{ left: targetRect.left - 7, top: targetRect.top - 7, width: targetRect.width + 14, height: targetRect.height + 14 }} />
    </div> : null}

    <div className={styles.helpActions}>
      <button className={styles.tourButton} onClick={() => { goToStep(0); setTourOpen(true); }}>Ver novidades</button>
      <button data-tour="support" className={styles.chatButton} onClick={() => setChatOpen(value => !value)} aria-expanded={chatOpen}>💬 Ajuda</button>
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
