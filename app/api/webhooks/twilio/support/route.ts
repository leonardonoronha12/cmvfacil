import { NextRequest, NextResponse } from "next/server";
import { getVercelOidcToken } from "@vercel/oidc";
import { getSupabaseAdmin } from "../../../../lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEVELOPER_PHONE = "+5521988945647";
const SUPPORT_MENU_CONTENT_SID = "HX8297b00787c7e8465898cd821e5db22e";
const AGENTS = ["Lia", "Ana", "Camila", "Juliana", "Mariana", "Rafael", "Bruno"] as const;
const clean = (value: unknown, max = 6000) => String(value ?? "").trim().slice(0, max);
const xml = (message = "") => new NextResponse(
  `<?xml version="1.0" encoding="UTF-8"?><Response>${message ? `<Message>${message.replace(/[<>&'\"]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '\"': "&quot;" })[char]!)}</Message>` : ""}</Response>`,
  { status: 200, headers: { "content-type": "text/xml; charset=utf-8", "cache-control": "no-store" } },
);

async function callTwilioFunction(payload: Record<string, unknown>) {
  const supabaseUrl = clean(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL).replace(/\/+$/, "");
  const serviceRole = clean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || process.env.SERVICE_ROLE_KEY);
  if (!supabaseUrl || !serviceRole) throw new Error("support_webhook_not_configured");
  const response = await fetch(`${supabaseUrl}/functions/v1/support-whatsapp`, {
    method: "POST",
    headers: { authorization: `Bearer ${serviceRole}`, apikey: serviceRole, "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.ok !== true) throw new Error(clean(result?.error) || `support_whatsapp_${response.status}`);
  return result as Record<string, unknown>;
}

function normalizeAction(payload: string, body: string) {
  const value = `${payload} ${body}`.toLocaleLowerCase("pt-BR");
  if (value.includes("support_resolved") || value.includes("chamado solucionado")) return "resolved";
  if (value.includes("support_developer") || value.includes("enviar desenvolvedor")) return "developer";
  return "";
}

type ChatMessage = { role: "user" | "assistant"; content: string };

function agentFor(phone: string) {
  let hash = 0;
  for (const char of phone) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AGENTS[hash % AGENTS.length];
}

function parseIntent(body: string) {
  const value = body.toLocaleLowerCase("pt-BR");
  if (/^(1|suporte)$/i.test(value.trim()) || value.includes("preciso de suporte") || value.includes("problema")) return "support";
  if (/^(2|d[uú]vida)$/i.test(value.trim()) || value.includes("tenho uma dúvida") || value.includes("tenho uma duvida")) return "question";
  return "";
}

async function askAssistant(agentName: string, intent: string, messages: ChatMessage[]) {
  const token = clean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || (await getVercelOidcToken()), 12000);
  if (!token) throw new Error("whatsapp_assistant_not_configured");
  const system = `Você é ${agentName}, atendente virtual do CMV Fácil no WhatsApp. Converse em português brasileiro de forma humana, acolhedora, objetiva e profissional. Faça uma pergunta por vez, não repita o que já foi respondido e tente diagnosticar e solucionar antes de encaminhar. Colete tela, ação, resultado esperado, resultado ocorrido, erro, data/item afetado e impacto quando forem relevantes. Não peça senha, código, cartão ou dados sensíveis. Use action=resolved somente após o usuário confirmar que resolveu. Use action=escalate quando depender da equipe técnica, após tentativas sem sucesso, ou quando o usuário pedir uma pessoa. Responda somente JSON: {"reply":"texto","action":"continue|resolved|escalate","summary":"resumo técnico ao escalar"}. Contexto: tipo de atendimento ${intent}.`;
  const requestBody = JSON.stringify({ model: clean(process.env.SUPPORT_AI_MODEL, 120) || "openai/gpt-4o-mini", max_tokens: 450, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, ...messages.slice(-18)] });
  let result: any = null;
  let response: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    response = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: requestBody, signal: AbortSignal.timeout(10000) });
    result = await response.json().catch(() => null);
    if (response.ok) break;
    if (attempt === 0 && (response.status === 429 || response.status >= 500)) await new Promise(resolve => setTimeout(resolve, 350));
  }
  if (!response?.ok) throw new Error(clean(result?.error?.message || `gateway_${response?.status || 0}`));
  const raw = clean(result?.choices?.[0]?.message?.content, 8000).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const parsed = JSON.parse(raw);
  const action = ["continue", "resolved", "escalate"].includes(clean(parsed?.action)) ? clean(parsed.action) : "continue";
  return { reply: clean(parsed?.reply, 1300), action, summary: clean(parsed?.summary, 4000) };
}

async function handleConversation(args: { db: ReturnType<typeof getSupabaseAdmin>; phone: string; body: string; messageSid: string }) {
  const { db, phone, body, messageSid } = args;
  const loaded = await db.from("whatsapp_support_conversations").select("*").eq("phone", phone).maybeSingle();
  if (loaded.error) throw loaded.error;
  const existing = loaded.data as any;
  if (clean(existing?.last_message_sid) === messageSid) return xml();
  const agentName = clean(existing?.agent_name) || agentFor(phone);
  let intent = clean(existing?.intent);
  let status = clean(existing?.status) || "choosing";
  let messages = (Array.isArray(existing?.messages) ? existing.messages : []) as ChatMessage[];

  if (status === "escalated") return xml(`Seu atendimento já foi encaminhado à equipe técnica. Aguarde, pois uma pessoa da equipe continuará o contato por aqui.`);
  if (status === "resolved" || /^(menu|iniciar|oi|ol[aá])$/i.test(body)) {
    status = "choosing";
    intent = "";
    messages = [];
  }
  if (status === "choosing") {
    const selected = parseIntent(body);
    if (!selected) {
      await db.from("whatsapp_support_conversations").upsert({ phone, agent_name: agentName, intent: null, status: "choosing", messages: [], last_message_sid: messageSid, updated_at: new Date().toISOString() }, { onConflict: "phone" });
      try {
        await callTwilioFunction({
          action: "send_content",
          to: phone,
          protocol: `support-menu-${messageSid}`,
          contentSid: SUPPORT_MENU_CONTENT_SID,
        });
        return xml();
      } catch (error) {
        console.error("whatsapp_support_menu_failed", error instanceof Error ? error.message : String(error));
        return xml("Olá! Bem-vindo ao atendimento do CMV Fácil. Responda com “Preciso de suporte” ou “Tenho uma dúvida”.");
      }
    }
    intent = selected;
    status = "active";
    messages = [];
  }

  messages.push({ role: "user", content: body });
  let answer: { reply: string; action: string; summary: string };
  try {
    answer = await askAssistant(agentName, intent, messages);
  } catch (error) {
    console.error("whatsapp_assistant_failed", error instanceof Error ? error.message : String(error));
    answer = { reply: "Entendi. Para eu investigar melhor, diga em qual tela isso acontece e o que aparece diferente ou errado.", action: "continue", summary: "" };
  }
  const introduction = messages.length === 1 ? `${agentName} entrou no atendimento.\n\n${agentName}: ` : `${agentName}: `;
  const reply = `${introduction}${answer.reply}`.trim();
  messages.push({ role: "assistant", content: answer.reply });
  status = answer.action === "escalate" ? "escalated" : answer.action === "resolved" ? "resolved" : "active";
  await db.from("whatsapp_support_conversations").upsert({ phone, agent_name: agentName, intent, status, messages: messages.slice(-20), last_message_sid: messageSid, updated_at: new Date().toISOString() }, { onConflict: "phone" });
  if (answer.action === "escalate") {
    await callTwilioFunction({ action: "send_text", to: DEVELOPER_PHONE, protocol: `whatsapp-${messageSid}`, message: `Novo atendimento encaminhado por ${agentName}.\nCliente: ${phone}\n\n${answer.summary || body}` }).catch(error => console.error("whatsapp_escalation_failed", error instanceof Error ? error.message : String(error)));
    return xml(`${reply}\n\nReuni as informações e encaminhei para a equipe de suporte técnico. Uma pessoa continuará o atendimento por aqui.`);
  }
  return xml(reply);
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const messageSid = clean(form.get("MessageSid") || form.get("SmsSid"));
    const body = clean(form.get("Body"));
    const buttonPayload = clean(form.get("ButtonPayload"));
    const originalSid = clean(form.get("OriginalRepliedMessageSid"));
    const action = normalizeAction(buttonPayload, body);
    if (!messageSid) return xml();

    const verified = await callTwilioFunction({ action: "verify_incoming", messageSid, allowAnySender: true });
    if (clean(verified.body) !== body) throw new Error("incoming_body_mismatch");

    const db = getSupabaseAdmin();
    if (!action) return handleConversation({ db, phone: clean(verified.from), body: buttonPayload || body || "Enviei um anexo e preciso de ajuda.", messageSid });
    let receiptQuery = db.from("support_delivery_receipts").select("ticket_id,provider_message_id").eq("provider", "twilio");
    if (originalSid) receiptQuery = receiptQuery.eq("provider_message_id", originalSid);
    else receiptQuery = receiptQuery.order("created_at", { ascending: false }).limit(1);
    const receipt = await receiptQuery.maybeSingle();
    if (receipt.error || !receipt.data?.ticket_id) return xml("Não foi possível identificar o chamado deste botão. Abra a mensagem original e tente novamente.");

    const ticketResult = await db.from("support_tickets")
      .select("id,protocol,user_id,company_id,status,message,page,raw_metadata")
      .eq("id", receipt.data.ticket_id)
      .maybeSingle();
    const ticket = ticketResult.data as Record<string, unknown> | null;
    if (ticketResult.error || !ticket) return xml("Chamado não encontrado.");
    const protocol = clean(ticket.protocol);
    const metadata = ticket.raw_metadata && typeof ticket.raw_metadata === "object" ? ticket.raw_metadata as Record<string, unknown> : {};

    if (action === "resolved") {
      if (clean(ticket.status).toLowerCase() !== "resolved") {
        const updated = await db.from("support_tickets").update({
          status: "resolved",
          raw_metadata: { ...metadata, resolvedAt: new Date().toISOString(), resolvedBy: clean(verified.from), resolvedVia: "twilio_button" },
        }).eq("id", ticket.id);
        if (updated.error) throw updated.error;
      }
      const notify = await fetch(new URL("/api/support/resolution-notify", req.url), {
        method: "POST",
        headers: { authorization: `Bearer ${clean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || process.env.SERVICE_ROLE_KEY)}`, "content-type": "application/json" },
        body: JSON.stringify({ ticketId: ticket.id }),
      });
      const notification = await notify.json().catch(() => ({}));
      if (!notify.ok || notification?.ok !== true) return xml(`Chamado ${protocol} marcado como solucionado. O aviso ao usuário ficou pendente.`);
      return xml(`Chamado ${protocol} marcado como solucionado. O usuário foi avisado no sistema e os canais de contato foram processados.`);
    }

    const variables = {
      "1": protocol,
      "2": clean(metadata.email) || "Não identificado",
      "3": clean(ticket.company_id) || "Não identificada",
      "4": clean(ticket.page) || "/",
      "5": `ENCAMINHADO AO DESENVOLVEDOR — ${clean(ticket.message)}`,
    };
    const sent = await callTwilioFunction({
      action: "send_ticket",
      to: DEVELOPER_PHONE,
      protocol: `${protocol}-developer`,
      message: clean(ticket.message),
      contentVariables: variables,
    });
    if (clean(sent.sid)) {
      await db.from("support_delivery_receipts").upsert({
        ticket_id: ticket.id,
        provider: "twilio-developer",
        provider_message_id: clean(sent.sid),
        status: clean(sent.status) || "accepted",
        evidence: { sourceMessageSid: messageSid, originalMessageSid: originalSid || null, forwardedAt: new Date().toISOString() },
      }, { onConflict: "provider,provider_message_id" });
    }
    return xml(`Chamado ${protocol} encaminhado ao desenvolvedor.`);
  } catch (error) {
    console.error("twilio_support_webhook_failed", error instanceof Error ? error.message : String(error));
    return xml("Não foi possível processar esta ação agora. Tente novamente em instantes.");
  }
}
