import "server-only";

import { getPublicAppUrl } from "./publicAppUrl";
import { sendEmail } from "./email/sendEmail";
import { renderCompanyInviteEmail } from "./email/templates/companyInvite";
import { renderEmailLayout } from "./email/templates/emailLayout";
import { renderWelcomeEmail } from "./email/templates/welcome";

export type SendEmailResult = { ok: true; id?: string } | { ok: false; error: string };

function safeEmail(value: unknown) {
  const v = String(value ?? "").trim().toLowerCase();
  if (!v || !v.includes("@")) return "";
  return v;
}

function env(name: string) {
  return String(process.env[name] ?? "").trim();
}

export async function sendWelcomeEmail(args: {
  to: string;
  firstName?: string | null;
  lastName?: string | null;
  siteUrl?: string | null;
  emailConfirmationRequired?: boolean | null;
}): Promise<SendEmailResult> {
  const to = safeEmail(args.to);
  if (!to) return { ok: false, error: "invalid_to_email" };
  const appUrl = getPublicAppUrl();
  const supportEmail = env("EMAIL_REPLY_TO") || null;
  const loginUrl = `${appUrl.replace(/\/+$/, "")}/login`;
  const tpl = renderWelcomeEmail({
    firstName: args.firstName,
    lastName: args.lastName,
    loginUrl,
    emailConfirmationRequired: Boolean(args.emailConfirmationRequired),
    supportEmail,
  });

  const sent = await sendEmail({ to, subject: tpl.subject, html: tpl.html, text: tpl.text });
  if (!sent.ok) return { ok: false, error: sent.error };
  return { ok: true, id: sent.id };
}

export async function sendCompanyInviteEmail(args: {
  to: string;
  companyName: string;
  roleLabel: string;
  inviterName?: string | null;
  actionLink: string;
  existingUser?: boolean;
}): Promise<SendEmailResult> {
  const to = safeEmail(args.to);
  if (!to) return { ok: false, error: "invalid_to_email" };

  const companyName = String(args.companyName ?? "").trim() || "CMV Fácil";
  const roleLabel = String(args.roleLabel ?? "").trim() || "Colaborador";

  const actionLink = String(args.actionLink ?? "").trim();
  if (!actionLink) return { ok: false, error: "missing_action_link" };

  const supportEmail = env("EMAIL_REPLY_TO") || null;
  const tpl = renderCompanyInviteEmail({
    companyName,
    roleLabel,
    inviterName: args.inviterName ?? null,
    actionLink,
    existingUser: args.existingUser,
    supportEmail,
  });
  const sent = await sendEmail({ to, subject: tpl.subject, html: tpl.html, text: tpl.text });
  if (!sent.ok) return { ok: false, error: sent.error };
  return { ok: true, id: sent.id };
}

export async function sendPasswordResetEmail(args: { to: string; actionLink: string }): Promise<SendEmailResult> {
  const to = safeEmail(args.to);
  if (!to) return { ok: false, error: "invalid_to_email" };

  const actionLink = String(args.actionLink ?? "").trim();
  if (!actionLink) return { ok: false, error: "missing_action_link" };

  const supportEmail = env("EMAIL_REPLY_TO") || null;
  const { html, text } = renderEmailLayout({
    title: "Redefina sua senha do CMV Fácil",
    previewText: "Link para redefinir sua senha.",
    bodyHtml: `
      <h2 style="margin:0 0 10px 0;font-size:20px;letter-spacing:-0.2px;">Redefinição de senha</h2>
      <p style="margin:0;color:#374151;">Recebemos uma solicitação para redefinir sua senha da sua conta no CMV Fácil.</p>
      <p style="margin:12px 0 0;color:#6b7280;font-size:12px;">Se você não solicitou essa alteração, ignore este e-mail. Sua senha continuará a mesma.</p>
    `.trim(),
    bodyText:
      "Recebemos uma solicitação para redefinir sua senha da sua conta no CMV Fácil.\n\n" +
      "Se você não solicitou essa alteração, ignore este e-mail. Sua senha continuará a mesma.",
    button: { label: "Redefinir minha senha", url: actionLink },
    supportEmail,
  });

  const sent = await sendEmail({
    to,
    subject: "Redefina sua senha do CMV Fácil",
    html,
    text,
  });
  if (!sent.ok) return { ok: false, error: sent.error };
  return { ok: true, id: sent.id };
}
