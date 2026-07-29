import "server-only";

import { resendSendEmail } from "./resend";

export type SendEmailResult = { ok: true; id: string } | { ok: false; error: string };

function env(name: string) {
  return String(process.env[name] ?? "").trim();
}

function safeEmail(value: unknown) {
  const v = String(value ?? "").trim().toLowerCase();
  if (!v || !v.includes("@")) return "";
  return v;
}

function defaultFrom() {
  return "CMV Fácil <notificacoes@cmvfacil.app>";
}

export async function sendEmail(args: { to: string; subject: string; html: string; text: string }): Promise<SendEmailResult> {
  const to = safeEmail(args.to);
  if (!to) return { ok: false, error: "invalid_to_email" };

  const apiKey = env("RESEND_API_KEY");
  if (!apiKey) return { ok: false, error: "email_not_configured" };

  const from = env("EMAIL_FROM") || defaultFrom();
  const replyTo = env("EMAIL_REPLY_TO");

  const sent = await resendSendEmail({
    apiKey,
    from,
    to,
    subject: String(args.subject ?? "").trim(),
    html: String(args.html ?? "").trim(),
    text: String(args.text ?? "").trim(),
    ...(replyTo ? { replyTo } : {}),
  });

  if (!sent.ok) return { ok: false, error: sent.error };
  return { ok: true, id: sent.id };
}
