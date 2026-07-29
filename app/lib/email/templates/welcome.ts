import "server-only";

import { renderEmailLayout } from "./emailLayout";

function firstWord(value: string) {
  const v = String(value ?? "").trim();
  if (!v) return "";
  const [w] = v.split(/\s+/);
  return String(w ?? "").trim();
}

export function renderWelcomeEmail(args: {
  firstName?: string | null;
  lastName?: string | null;
  loginUrl: string;
  emailConfirmationRequired: boolean;
  supportEmail?: string | null;
}) {
  const name = [args.firstName, args.lastName].filter(Boolean).join(" ").trim();
  const first = firstWord(name) || "Olá";
  const needsConfirm = Boolean(args.emailConfirmationRequired);

  const bodyText = needsConfirm
    ? "Sua conta foi criada com sucesso. Antes de entrar, confirme seu email usando a mensagem que acabamos de enviar."
    : "Sua conta foi criada com sucesso. Você já pode entrar e começar a configurar sua empresa.";

  const bodyHtml = `
    <h2 style="margin:0 0 10px 0;font-size:20px;letter-spacing:-0.2px;">${first}, bem-vindo ao CMV Fácil</h2>
    <p style="margin:0;color:#374151;">${bodyText}</p>
  `.trim();

  const { html, text } = renderEmailLayout({
    title: "Bem-vindo ao CMV Fácil",
    previewText: "Sua conta no CMV Fácil está pronta.",
    greeting: "",
    bodyHtml,
    bodyText: `${first}, bem-vindo ao CMV Fácil.\n\n${bodyText}`,
    button: { label: "Acessar o CMV Fácil", url: args.loginUrl },
    supportEmail: args.supportEmail ?? null,
  });

  return { subject: "Bem-vindo ao CMV Fácil", html, text };
}
