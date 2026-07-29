import "server-only";

import { renderEmailLayout } from "./emailLayout";

export type BillingEventType =
  | "subscription_started"
  | "plan_changed"
  | "cancellation_scheduled"
  | "subscription_canceled"
  | "payment_succeeded"
  | "payment_failed"
  | "subscription_reactivated";

function safeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function safeCurrency(value: unknown) {
  return safeText(value).toUpperCase() || "BRL";
}

function formatMoney(value: number | null, currency: string) {
  if (!(typeof value === "number" && Number.isFinite(value))) return "";
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

function formatDatePt(value: string | null) {
  const v = safeText(value);
  if (!v) return "";
  const d = new Date(v);
  if (!Number.isFinite(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function subjectFor(eventType: BillingEventType) {
  switch (eventType) {
    case "subscription_started":
      return "Plano assinado com sucesso — CMV Fácil";
    case "plan_changed":
      return "Seu plano foi alterado — CMV Fácil";
    case "cancellation_scheduled":
      return "Cancelamento programado — CMV Fácil";
    case "subscription_canceled":
      return "Assinatura cancelada — CMV Fácil";
    case "payment_succeeded":
      return "Pagamento confirmado — CMV Fácil";
    case "payment_failed":
      return "Não conseguimos processar seu pagamento — CMV Fácil";
    case "subscription_reactivated":
      return "Assinatura reativada — CMV Fácil";
  }
}

function titleFor(eventType: BillingEventType) {
  switch (eventType) {
    case "subscription_started":
      return "Plano assinado com sucesso";
    case "plan_changed":
      return "Troca de plano confirmada";
    case "cancellation_scheduled":
      return "Cancelamento agendado";
    case "subscription_canceled":
      return "Cancelamento concluído";
    case "payment_succeeded":
      return "Pagamento aprovado";
    case "payment_failed":
      return "Pagamento recusado";
    case "subscription_reactivated":
      return "Assinatura reativada";
  }
}

export function renderBillingEventEmail(args: {
  eventType: BillingEventType;
  companyName: string;
  planName?: string | null;
  previousPlanName?: string | null;
  amount?: number | null;
  currency?: string | null;
  currentPeriodEnd?: string | null;
  actionUrl: string;
  supportEmail?: string | null;
}) {
  const eventType = args.eventType;
  const companyName = safeText(args.companyName) || "sua empresa";
  const planName = safeText(args.planName) || "";
  const previousPlanName = safeText(args.previousPlanName) || "";
  const currency = safeCurrency(args.currency);
  const amountLabel = formatMoney(typeof args.amount === "number" ? args.amount : null, currency);
  const periodEndLabel = formatDatePt(args.currentPeriodEnd ?? null);

  let detailsText = "";
  let detailsHtml = "";

  if (eventType === "plan_changed") {
    const prev = previousPlanName ? `Plano anterior: ${previousPlanName}\n` : "";
    const next = planName ? `Novo plano: ${planName}\n` : "";
    detailsText = `${prev}${next}`.trim();
    detailsHtml = `
      ${previousPlanName ? `<p style="margin:10px 0 0;color:#374151;">Plano anterior: <strong>${previousPlanName}</strong></p>` : ""}
      ${planName ? `<p style="margin:6px 0 0;color:#374151;">Novo plano: <strong>${planName}</strong></p>` : ""}
    `.trim();
  }

  if (eventType === "payment_succeeded" || eventType === "payment_failed") {
    detailsText = `${amountLabel ? `Valor: ${amountLabel}\n` : ""}${planName ? `Plano: ${planName}\n` : ""}`.trim();
    detailsHtml = `
      ${amountLabel ? `<p style="margin:10px 0 0;color:#374151;">Valor: <strong>${amountLabel}</strong></p>` : ""}
      ${planName ? `<p style="margin:6px 0 0;color:#374151;">Plano: <strong>${planName}</strong></p>` : ""}
    `.trim();
  }

  if (eventType === "cancellation_scheduled") {
    detailsText = `${planName ? `Plano: ${planName}\n` : ""}${periodEndLabel ? `Seu acesso segue até: ${periodEndLabel}\n` : ""}`.trim();
    detailsHtml = `
      ${planName ? `<p style="margin:10px 0 0;color:#374151;">Plano: <strong>${planName}</strong></p>` : ""}
      ${periodEndLabel ? `<p style="margin:6px 0 0;color:#374151;">Seu acesso segue até: <strong>${periodEndLabel}</strong></p>` : ""}
    `.trim();
  }

  if (eventType === "subscription_started" || eventType === "subscription_reactivated" || eventType === "subscription_canceled") {
    detailsText = `${planName ? `Plano: ${planName}\n` : ""}${periodEndLabel ? `Vigência atual até: ${periodEndLabel}\n` : ""}`.trim();
    detailsHtml = `
      ${planName ? `<p style="margin:10px 0 0;color:#374151;">Plano: <strong>${planName}</strong></p>` : ""}
      ${periodEndLabel ? `<p style="margin:6px 0 0;color:#374151;">Vigência atual até: <strong>${periodEndLabel}</strong></p>` : ""}
    `.trim();
  }

  const headline = titleFor(eventType);
  const description =
    eventType === "payment_failed"
      ? "Tivemos um problema ao processar seu pagamento. Seu acesso pode ser afetado se o pagamento não for concluído."
      : eventType === "payment_succeeded"
        ? "Seu pagamento foi confirmado com sucesso."
        : eventType === "subscription_canceled"
          ? "Sua assinatura foi cancelada."
          : eventType === "cancellation_scheduled"
            ? "O cancelamento da sua assinatura foi programado."
            : eventType === "plan_changed"
              ? "Confirmamos a troca do seu plano."
              : eventType === "subscription_reactivated"
                ? "Sua assinatura foi reativada com sucesso."
                : "Sua assinatura foi ativada com sucesso.";

  const bodyText =
    `${headline}\n\n` +
    `${description}\n\n` +
    `Empresa: ${companyName}\n` +
    (detailsText ? `${detailsText}\n\n` : "\n") +
    `Gerencie sua assinatura: ${args.actionUrl}\n\n` +
    `Se você não reconhece esta movimentação, fale com o suporte.`;

  const bodyHtml = `
    <h2 style="margin:0 0 10px 0;font-size:20px;letter-spacing:-0.2px;">${headline}</h2>
    <p style="margin:0;color:#374151;">${description}</p>
    <p style="margin:10px 0 0;color:#6b7280;font-size:12px;">Empresa: <strong style="color:#374151;">${companyName}</strong></p>
    ${detailsHtml ? `<div style="margin:12px 0 0;">${detailsHtml}</div>` : ""}
  `.trim();

  const { html, text } = renderEmailLayout({
    title: headline,
    previewText: subjectFor(eventType),
    greeting: "",
    bodyHtml,
    bodyText,
    button: { label: "Gerenciar assinatura", url: args.actionUrl },
    supportEmail: args.supportEmail ?? null,
  });

  return { subject: subjectFor(eventType), html, text };
}

