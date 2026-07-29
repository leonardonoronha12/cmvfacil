import "server-only";

import { renderEmailLayout } from "./emailLayout";

function firstWord(value: string) {
  const v = String(value ?? "").trim();
  if (!v) return "";
  const [w] = v.split(/\s+/);
  return String(w ?? "").trim();
}

export function renderCompanyInviteEmail(args: {
  companyName: string;
  roleLabel: string;
  inviterName?: string | null;
  actionLink: string;
  supportEmail?: string | null;
}) {
  const companyName = String(args.companyName ?? "").trim() || "CMV Fácil";
  const roleLabel = String(args.roleLabel ?? "").trim() || "Colaborador";
  const inviter = String(args.inviterName ?? "").trim();
  const inviterFirst = inviter ? firstWord(inviter) : "";
  const inviterText = inviterFirst ? `Convite enviado por ${inviterFirst}.` : "Você recebeu um convite.";

  const bodyText =
    `Você foi convidado para acessar ${companyName} no CMV Fácil.\n` +
    `${inviterText} Sua permissão será: ${roleLabel}.\n\n` +
    `Para entrar, clique no botão abaixo e crie sua senha.`;

  const bodyHtml = `
    <h2 style="margin:0 0 8px 0;font-size:20px;letter-spacing:-0.2px;">Seu acesso está pronto</h2>
    <p style="margin:0;color:#374151;">Você foi convidado para acessar <strong>${companyName}</strong> no CMV Fácil.</p>
    <p style="margin:10px 0 0;color:#374151;">${inviterText} Sua permissão será: <strong>${roleLabel}</strong>.</p>
    <div style="margin:14px 0 0;border:1px solid #e5e7eb;border-radius:14px;padding:12px 12px;background:#f9fafb;">
      <div style="font-weight:900;margin:0 0 8px 0;font-size:14px;">Como entrar (bem simples)</div>
      <ol style="margin:0;padding-left:18px;color:#374151;font-size:14px;">
        <li>Clique no botão.</li>
        <li>Crie sua senha de acesso.</li>
        <li>Você será redirecionado para o painel.</li>
      </ol>
    </div>
  `.trim();

  const { html, text } = renderEmailLayout({
    title: `Convite de acesso`,
    previewText: "Seu convite para o CMV Fácil.",
    greeting: "",
    bodyHtml,
    bodyText,
    button: { label: "Acessar sistema", url: args.actionLink },
    supportEmail: args.supportEmail ?? null,
  });

  return { subject: `Seu acesso ao CMV Fácil (${companyName})`, html, text };
}
