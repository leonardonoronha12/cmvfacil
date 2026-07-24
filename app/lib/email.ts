export type SendEmailResult = { ok: true; id?: string } | { ok: false; error: string };

function env(name: string) {
  return String(process.env[name] ?? "").trim();
}

function safeEmail(value: unknown) {
  const v = String(value ?? "").trim().toLowerCase();
  if (!v || !v.includes("@")) return "";
  return v;
}

function firstWord(value: string) {
  const v = String(value ?? "").trim();
  if (!v) return "";
  const [w] = v.split(/\s+/);
  return String(w ?? "").trim();
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

  const apiKey = env("RESEND_API_KEY");
  const from = env("CMV_EMAIL_FROM") || env("RESEND_FROM");
  if (!apiKey || !from) return { ok: false, error: "email_not_configured" };

  const siteUrl = String(args.siteUrl ?? env("NEXT_PUBLIC_SITE_URL") ?? "https://cmvfacil.app").replace(/\/+$/, "");
  const name = [args.firstName, args.lastName].filter(Boolean).join(" ").trim();
  const first = firstWord(name) || "Olá";
  const needsConfirm = Boolean(args.emailConfirmationRequired);

  const subject = "Bem-vindo ao CMV Fácil";
  const loginUrl = `${siteUrl}/login`;
  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.45; color: #111827">
      <h2 style="margin: 0 0 12px 0;">${first}, bem-vindo ao CMV Fácil</h2>
      <p style="margin: 0 0 12px 0;">Sua conta foi criada com sucesso.</p>
      ${
        needsConfirm
          ? `<p style="margin: 0 0 12px 0;">Antes de entrar, confirme seu email usando a mensagem que acabamos de enviar.</p>`
          : `<p style="margin: 0 0 12px 0;">Você já pode entrar e começar a configurar sua empresa.</p>`
      }
      <p style="margin: 0 0 14px 0;">
        <a href="${loginUrl}" style="display: inline-block; background: #16a34a; color: #ffffff; padding: 10px 14px; border-radius: 8px; text-decoration: none;">
          Acessar o CMV Fácil
        </a>
      </p>
      <p style="margin: 0; color: #6b7280; font-size: 12px;">Se você não reconhece este cadastro, ignore este email.</p>
    </div>
  `.trim();
  const text = `${first}, bem-vindo ao CMV Fácil.\n\nSua conta foi criada com sucesso.\n\n${
    needsConfirm ? "Antes de entrar, confirme seu email usando a mensagem que acabamos de enviar.\n\n" : ""
  }Acesse: ${loginUrl}\n\nSe você não reconhece este cadastro, ignore este email.`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to, subject, html, text }),
  });

  const j = (await res.json().catch(() => null)) as any;
  if (!res.ok) {
    const msg = String(j?.message ?? j?.error ?? "send_failed").trim();
    return { ok: false, error: `email_send_failed:${msg}` };
  }
  const id = String(j?.id ?? "").trim();
  return { ok: true, ...(id ? { id } : {}) };
}

