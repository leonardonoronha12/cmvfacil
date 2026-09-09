import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "../../../lib/requestUserId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 25;

type ConversationLine = { from?: unknown; text?: unknown };

const SYSTEM_PROMPT = `Você é uma pessoa atendente virtual do CMV Fácil. O nome informado no contexto é o seu nome durante esta conversa. Converse em português do Brasil, de forma humana, acolhedora, objetiva e profissional.

Seu trabalho é diagnosticar dúvidas e problemas do sistema antes de abrir um chamado técnico.
- Faça uma pergunta por vez e aproveite tudo que o usuário já informou; nunca repita perguntas respondidas.
- Colete, quando relevante: tela/rotina, ação executada, resultado esperado, resultado ocorrido, mensagem de erro, período/data, item/fornecedor afetado, se ocorre sempre, navegador/dispositivo e impacto.
- Dê instruções curtas e seguras para testar uma solução. Nunca invente telas, dados ou uma correção que você não conhece.
- Não peça senha, código de autenticação, cartão ou dados pessoais desnecessários.
- Não encaminhe na primeira mensagem, salvo se o usuário pedir atendimento humano, relatar perda/corrupção de dados, cobrança indevida, bloqueio total ou já trouxer diagnóstico suficiente.
- Use action="continue" enquanto pergunta ou orienta.
- Use action="resolved" somente quando o usuário confirmar que resolveu; despeça-se cordialmente.
- Use action="escalate" quando as tentativas não resolverem, houver erro técnico que dependa da equipe ou o usuário solicitar suporte humano. Nesse caso, produza summary completo e factual para o técnico, incluindo os testes já feitos.

Responda SOMENTE JSON válido no formato:
{"reply":"mensagem ao usuário","action":"continue|resolved|escalate","summary":"resumo técnico apenas quando escalar"}`;

function clean(value: unknown, max = 4000) {
  return String(value ?? "").trim().slice(0, max);
}

function parseModelJson(value: string) {
  const normalized = value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const parsed = JSON.parse(normalized) as { reply?: unknown; action?: unknown; summary?: unknown };
  const action = ["continue", "resolved", "escalate"].includes(String(parsed.action)) ? String(parsed.action) : "continue";
  return { reply: clean(parsed.reply, 1200), action, summary: clean(parsed.summary, 4000) };
}

export async function POST(req: NextRequest) {
  const { userId } = getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ ok: false, error: "Sua sessão expirou." }, { status: 401 });

  try {
    const body = await req.json().catch(() => null) as { conversation?: ConversationLine[]; page?: unknown; attachments?: unknown; agentName?: unknown } | null;
    const conversation = (Array.isArray(body?.conversation) ? body!.conversation : [])
      .slice(-16)
      .map(line => ({ role: line?.from === "bot" ? "assistant" : "user", content: clean(line?.text, 2000) }))
      .filter(line => line.content);
    if (!conversation.length) return NextResponse.json({ ok: false, error: "Mensagem vazia." }, { status: 400 });

    const token = clean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN, 12000);
    if (!token) return NextResponse.json({ ok: false, error: "assistant_not_configured" }, { status: 503 });
    const page = clean(body?.page, 300) || "/";
    const attachments = Number(body?.attachments ?? 0);
    const agentName = clean(body?.agentName, 40) || "Lia";
    const response = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: clean(process.env.SUPPORT_AI_MODEL, 120) || "openai/gpt-5-mini",
        temperature: 0.25,
        max_tokens: 400,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "system", content: `Contexto automático: seu nome nesta conversa é ${agentName}; página atual ${page}; anexos selecionados: ${Number.isFinite(attachments) ? attachments : 0}.` },
          ...conversation,
        ],
      }),
      signal: AbortSignal.timeout(18000),
    });
    const result = await response.json().catch(() => null) as any;
    if (!response.ok) throw new Error(clean(result?.error?.message || result?.error || `gateway_http_${response.status}`));
    const content = clean(result?.choices?.[0]?.message?.content, 8000);
    const answer = parseModelJson(content);
    if (!answer.reply) throw new Error("empty_assistant_reply");
    return NextResponse.json({ ok: true, ...answer });
  } catch (error) {
    console.error("support_assistant_failed", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ ok: false, error: "Não foi possível consultar a atendente virtual agora." }, { status: 502 });
  }
}
