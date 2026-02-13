"use client";

import { useEffect, useMemo, useState } from "react";

type MessageRow = {
  event_type: string;
  email_subject: string | null;
  email_body: string | null;
  whatsapp_body: string | null;
  twilio_content_sids: string | null;
  send_delay_minutes: number;
  repeat_count: number;
  repeat_interval_minutes: number;
  updated_at: string;
};

type ApiListResponse =
  | { ok: true; data: MessageRow[] }
  | { ok?: false; error: string; details?: string };

const FREE_PLAN_MESSAGES: Array<{ event_type: string; whatsapp_body: string }> = [
  {
    event_type: "plan.free_pending",
    whatsapp_body:
      "Renan Capeletto: Não Desista do seu LUCRO!\n\nFinalize o cadastro no CMV Fácil e transforme estoque em dinheiro 👇\n\n- Acesse: `https://app.cmvfacil.com`\n- Escolha seu Plano\n- Inicie o Teste Grátis!",
  },
  {
    event_type: "plan.free_pending_2",
    whatsapp_body:
      "Será que preciso de um App só pra Controlar CMV? 🤔\n\nPensa comigo...\n\n1. Você tá faturando bem, mas quase não tem Lucro\n2. Cortar gastos é a solução mais rápida\n3. CMV é o maior gasto de todos!\n\nNosso sistema te entrega o CMV Real de forma automática e te ajuda a reduzir ele em tempo recorde!\n\nCMV Controlado = Lucro Recuperado\n\n- Conclua seu cadastro: `https://app.cmvfacil.com`",
  },
  {
    event_type: "plan.free_pending_3",
    whatsapp_body:
      "🍔 Como a Gold Burger LUCROU + R$ 40.000 usando o CMV Fácil...\n\nHamburgueria de sucesso, 3 lojas, faturando R$ 350 mil por mês...\n\nO problema? Igual ao seu:\n\n1. Fornecedor subindo preço\n2. Promoções agressivas pra não perder clientes\n3. Margem muito apertada\n\nCom o CMV Fácil, eles baixaram o CMV Real de 45% para 33%, ou seja, 12% de economia…\n\nR$ 350.000 x 12% = R$42.000,00 de LUCRO RECUPERADO!\n\nFaça o mesmo no seu Restaurante: `https://app.cmvfacil.com`",
  },
  {
    event_type: "plan.free_pending_4",
    whatsapp_body:
      "Ficou com Dúvida? 🙋‍♂️\n\nFale com o Renan, fundador do App e Dono de Restaurante há 6 anos…\n\nJá investi +100 mil em mentorias para aprender a fazer gestão…\n\nManda sua pergunta aqui, sou eu mesmo que respondo 👇",
  },
  {
    event_type: "plan.free_pending_5",
    whatsapp_body: "Essa é a última mensagem",
  },
];

function truncate(value: string, max = 80) {
  const v = value.trim();
  if (v.length <= max) return v;
  return `${v.slice(0, max)}…`;
}

const MESSAGE_TYPES = [
  { id: "contact.upsert", label: "Boas-vindas (novo contato)" },
  { id: "plan.free_pending", label: "Lembrete: ativar plano gratuito" },
  { id: "plan.free_pending_2", label: "Lembrete (24h): mensagem 2" },
  { id: "plan.free_pending_3", label: "Lembrete (48h): mensagem 3" },
  { id: "plan.free_pending_4", label: "Lembrete (72h): mensagem 4" },
  { id: "plan.free_pending_5", label: "Lembrete (96h): mensagem 5" },
] as const;

function getMessageLabel(eventType: string) {
  return MESSAGE_TYPES.find((t) => t.id === eventType)?.label ?? "Mensagem";
}

export default function Page() {
  const [rows, setRows] = useState<MessageRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const [messageTypeId, setMessageTypeId] = useState<string>(MESSAGE_TYPES[0]?.id ?? "");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [whatsappBody, setWhatsappBody] = useState("");
  const [twilioContentSids, setTwilioContentSids] = useState("");

  const selected = useMemo(() => {
    const key = messageTypeId.trim();
    if (!key) return null;
    return rows.find((r) => r.event_type === key) ?? null;
  }, [messageTypeId, rows]);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/messages", { method: "GET" });
      const data = (await res.json()) as ApiListResponse;
      if (!res.ok || !("ok" in data) || data.ok !== true) {
        throw new Error("error" in data ? data.error : "fetch_failed");
      }
      setRows(data.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!selected) return;
    setEmailSubject(selected.email_subject ?? "");
    setEmailBody(selected.email_body ?? "");
    setWhatsappBody(selected.whatsapp_body ?? "");
    setTwilioContentSids(selected.twilio_content_sids ?? "");
  }, [selected?.event_type]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = {
        event_type: messageTypeId.trim(),
        email_subject: emailSubject,
        email_body: emailBody,
        whatsapp_body: whatsappBody,
        twilio_content_sids: twilioContentSids,
      };
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; details?: string };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "save_failed");
      }
      setSavedAt(Date.now());
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function applyFreePlanMessages() {
    setSeeding(true);
    setError(null);
    try {
      for (const msg of FREE_PLAN_MESSAGES) {
        const res = await fetch("/api/messages", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            event_type: msg.event_type,
            whatsapp_body: msg.whatsapp_body,
          }),
        });
        const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; details?: string } | null;
        if (!res.ok || !data?.ok) {
          throw new Error(data?.details ?? data?.error ?? "seed_failed");
        }
      }
      setSavedAt(Date.now());
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSeeding(false);
    }
  }

  const messageTypeTrimmed = messageTypeId.trim();

  return (
    <main className="cmv-container">
      <header className="cmv-header">
        <div>
          <h1 className="cmv-title">Mensagens da automação (Brevo)</h1>
          <div className="cmv-subtitle">Configure o conteúdo das mensagens que serão enviadas.</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button type="button" onClick={() => void applyFreePlanMessages()} disabled={seeding} className="cmv-button">
            {seeding ? "Aplicando…" : "Aplicar mensagens 15min/24h"}
          </button>
          <button type="button" onClick={() => void refresh()} disabled={loading} className="cmv-button">
            {loading ? "Atualizando…" : "Atualizar"}
          </button>
          <button
            type="button"
            className="cmv-button"
            disabled={loggingOut}
            onClick={async () => {
              setLoggingOut(true);
              try {
                await fetch("/api/auth/logout", { method: "POST" });
              } finally {
                window.location.href = "/login";
              }
            }}
          >
            {loggingOut ? "Saindo…" : "Sair"}
          </button>
        </div>
      </header>

      <details open className="cmv-details">
        <summary className="cmv-summary">Ajuda rápida (o que cada campo faz)</summary>
        <div className="cmv-details-body">
          <div style={{ fontWeight: 900, color: "var(--cmv-text)" }}>Como isso funciona</div>
          <div style={{ marginTop: 8 }}>
            Você edita o conteúdo das mensagens da automação. Quando a automação for disparada, ela usa exatamente o texto que
            estiver salvo aqui.
          </div>
          <div style={{ marginTop: 10 }}>
            O envio em si acontece dentro da <b>Brevo</b> (Automations). Se você não receber uma mensagem, verifique se a automação
            está <b>ativa</b> e se o seu cadastro tem <b>email</b> e <b>WhatsApp</b> válidos.
          </div>

          <div style={{ fontWeight: 900, color: "var(--cmv-text)", marginTop: 14 }}>Campos de mensagem</div>
          <div style={{ marginTop: 8 }}>
            <b>Assunto do Email</b> e <b>Mensagem do Email</b> são o texto que você quer usar no email. <b>Mensagem do WhatsApp</b>{" "}
            é o texto que você quer usar no WhatsApp. Se algum campo ficar vazio, a automação na Brevo decide o que fazer (por
            exemplo: não enviar aquele canal ou usar outro conteúdo).
          </div>
        </div>
      </details>

      {error ? (
        <div className="cmv-alert cmv-alert-error">{error}</div>
      ) : null}

      {savedAt ? (
        <div className="cmv-alert cmv-alert-ok">Salvo com sucesso.</div>
      ) : null}

      <section className="cmv-grid">
        <div className="cmv-card">
          <form onSubmit={onSubmit}>
            <label className="cmv-label" style={{ marginTop: 0 }}>
              Mensagem
            </label>
            <div className="cmv-help">Escolha qual mensagem você quer editar.</div>
            <select
              value={messageTypeId}
              onChange={(e) => setMessageTypeId(e.target.value)}
              className="cmv-input"
              required
            >
              {MESSAGE_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>

            <label className="cmv-label">Assunto do Email</label>
            <div className="cmv-help">
              Título do email. Ex.: Bem-vindo(a) ao CMV Fácil
            </div>
            <input
              value={emailSubject}
              onChange={(e) => setEmailSubject(e.target.value)}
              placeholder="Bem-vindo!"
              className="cmv-input"
            />

            <label className="cmv-label">Mensagem do Email</label>
            <div className="cmv-help">
              Corpo do email. Se você usa template na Brevo, pode usar esse texto como variável no template.
            </div>
            <textarea
              value={emailBody}
              onChange={(e) => setEmailBody(e.target.value)}
              placeholder="Digite aqui a mensagem do email…"
              className="cmv-textarea"
            />

            <label className="cmv-label">Mensagem do WhatsApp</label>
            <div className="cmv-help">
              Texto do WhatsApp. Dica: mensagens curtas e diretas costumam performar melhor.
            </div>
            <textarea
              value={whatsappBody}
              onChange={(e) => setWhatsappBody(e.target.value)}
              placeholder="Digite aqui a mensagem do WhatsApp…"
              className="cmv-textarea"
            />

            <label className="cmv-label">Templates Twilio (HX...)</label>
            <div className="cmv-help">
              Opcional. Um ou mais Content SIDs separados por vírgula. Se informar mais de um, o sistema alterna automaticamente.
            </div>
            <input
              value={twilioContentSids}
              onChange={(e) => setTwilioContentSids(e.target.value)}
              placeholder="HX... ou HX...,HX..."
              className="cmv-input"
            />

            <button
              type="submit"
              disabled={saving}
              className="cmv-button cmv-button-primary"
              style={{ marginTop: 14, width: "100%" }}
            >
              {saving ? "Salvando…" : "Salvar"}
            </button>
          </form>
        </div>

        <div className="cmv-card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ fontWeight: 900 }}>Mensagens cadastradas</div>
            <div className="cmv-pill">{rows.length} item(ns)</div>
          </div>

          <div className="cmv-table-wrap">
            <table className="cmv-table">
              <thead>
                <tr>
                  <th className="cmv-th">mensagem</th>
                  <th className="cmv-th">email_subject</th>
                  <th className="cmv-th">whatsapp_body</th>
                  <th className="cmv-th">updated_at</th>
                </tr>
              </thead>
              <tbody>
                {rows.length ? (
                  rows.map((r) => {
                    const active = r.event_type === messageTypeId.trim();
                    return (
                      <tr
                        key={r.event_type}
                        onClick={() => setMessageTypeId(r.event_type)}
                        className={`cmv-row ${active ? "cmv-row-active" : ""}`}
                      >
                        <td className="cmv-td">
                          <span className="cmv-chip">{getMessageLabel(r.event_type)}</span>
                        </td>
                        <td className="cmv-td">{r.email_subject ?? ""}</td>
                        <td className="cmv-td">{r.whatsapp_body ? truncate(r.whatsapp_body) : ""}</td>
                        <td className="cmv-td" style={{ color: "var(--cmv-muted)" }}>
                          {r.updated_at}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td className="cmv-td" colSpan={4}>
                      Nenhuma mensagem cadastrada ainda.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {MESSAGE_TYPES.length > rows.length ? (
            <div className="cmv-help" style={{ marginTop: 10 }}>
              Se ainda não aparecer nenhuma linha, selecione uma mensagem à esquerda, preencha e clique em Salvar.
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
