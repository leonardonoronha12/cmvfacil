import "server-only";

import { getPublicAppUrl } from "./publicAppUrl";
import { sendEmail } from "./email/sendEmail";
import { renderCompanyInviteEmail } from "./email/templates/companyInvite";
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
    supportEmail,
  });
  const sent = await sendEmail({ to, subject: tpl.subject, html: tpl.html, text: tpl.text });
  if (!sent.ok) return { ok: false, error: sent.error };
  return { ok: true, id: sent.id };
}
