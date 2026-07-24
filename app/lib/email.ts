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

export async function sendCompanyInviteEmail(args: {
  to: string;
  companyName: string;
  roleLabel: string;
  inviterName?: string | null;
  actionLink: string;
}): Promise<SendEmailResult> {
  const to = safeEmail(args.to);
  if (!to) return { ok: false, error: "invalid_to_email" };

  const apiKey = env("RESEND_API_KEY");
  const from = env("CMV_EMAIL_FROM") || env("RESEND_FROM");
  if (!apiKey || !from) return { ok: false, error: "email_not_configured" };

  const companyName = String(args.companyName ?? "").trim() || "CMV Fácil";
  const roleLabel = String(args.roleLabel ?? "").trim() || "Colaborador";
  const inviter = String(args.inviterName ?? "").trim();
  const inviterFirst = inviter ? firstWord(inviter) : "";
  const inviterText = inviterFirst ? `Convite enviado por ${inviterFirst}.` : "Você recebeu um convite.";

  const actionLink = String(args.actionLink ?? "").trim();
  if (!actionLink) return { ok: false, error: "missing_action_link" };

  const subject = `Seu acesso ao CMV Fácil (${companyName})`;
  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.45; color: #111827; background: #ffffff;">
      <div style="max-width: 560px; margin: 0 auto; padding: 18px 16px;">
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 14px;">
          <div style="width: 42px; height: 42px; border-radius: 12px; background: #0ab86d; display: inline-flex; align-items: center; justify-content: center;">
            <span style="color: #ffffff; font-weight: 800; font-size: 16px;">CMV</span>
          </div>
          <div>
            <div style="font-weight: 900; font-size: 16px;">CMV Fácil</div>
            <div style="color: #6b7280; font-size: 12px;">Acesso de equipe</div>
          </div>
        </div>

        <h2 style="margin: 0 0 10px 0; font-size: 20px;">Você foi convidado para acessar</h2>
        <p style="margin: 0 0 12px 0; color: #111827; font-size: 14px;">
          <strong>${companyName}</strong>
        </p>
        <p style="margin: 0 0 14px 0; color: #374151; font-size: 14px;">
          ${inviterText} Sua permissão será: <strong>${roleLabel}</strong>.
        </p>

        <div style="border: 1px solid #e5e7eb; border-radius: 12px; padding: 12px 12px; background: #f9fafb; margin: 0 0 14px 0;">
          <div style="font-weight: 800; margin: 0 0 6px 0;">Como entrar (bem simples)</div>
          <ol style="margin: 0; padding-left: 18px; color: #374151; font-size: 14px;">
            <li>Clique no botão abaixo.</li>
            <li>Crie sua senha (para entrar sempre que quiser).</li>
            <li>Pronto: você será levado direto ao painel.</li>
          </ol>
        </div>

        <p style="margin: 0 0 14px 0;">
          <a href="${actionLink}" style="display: inline-block; background: #0ab86d; color: #ffffff; padding: 11px 16px; border-radius: 10px; text-decoration: none; font-weight: 800;">
            Acessar sistema
          </a>
        </p>

        <p style="margin: 0; color: #6b7280; font-size: 12px;">
          Se você não esperava este convite, ignore este email.
        </p>
      </div>
    </div>
  `.trim();

  const text =
    `Você foi convidado para acessar o CMV Fácil (${companyName}).\n` +
    `${inviterText}\n` +
    `Permissão: ${roleLabel}\n\n` +
    `Para entrar, clique no link e crie sua senha:\n${actionLink}\n\n` +
    `Se você não esperava este convite, ignore este email.`;

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
