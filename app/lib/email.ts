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

export async function sendSubscriptionWelcomeEmail(args: {
  to: string;
  firstName?: string | null;
  planLabel?: string | null;
  idempotencyKey: string;
}): Promise<SendEmailResult> {
  const to = safeEmail(args.to);
  if (!to) return { ok: false, error: "invalid_to_email" };

  const apiKey = env("RESEND_API_KEY");
  const from = env("CMV_EMAIL_FROM") || env("RESEND_FROM");
  if (!apiKey || !from) return { ok: false, error: "email_not_configured" };

  const first = firstWord(String(args.firstName ?? "")) || "Olá";
  const plan = String(args.planLabel ?? "").trim();
  const groupUrl = "https://chat.whatsapp.com/GKDXZb8Usai7jL8mKK96bA";
  const subject = "Bem-vindo ao seu plano CMV Fácil";
  const planText = plan ? ` Seu plano ${plan} já está ativo.` : " Sua assinatura já está ativa.";
  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.5; color: #111827;">
      <h2 style="margin: 0 0 12px;">${first}, seja bem-vindo ao CMV Fácil!</h2>
      <p style="margin: 0 0 12px;">Pagamento confirmado.${planText}</p>
      <p style="margin: 0 0 16px;">Entre no grupo exclusivo de clientes para receber avisos, novidades e orientações da equipe:</p>
      <p style="margin: 0 0 16px;">
        <a href="${groupUrl}" style="display:inline-block;background:#16a34a;color:#fff;padding:11px 16px;border-radius:8px;text-decoration:none;font-weight:700;">Entrar no grupo do WhatsApp</a>
      </p>
      <p style="margin:0;color:#6b7280;font-size:12px;">Se o botão não abrir, copie este link: ${groupUrl}</p>
    </div>
  `.trim();
  const text = `${first}, seja bem-vindo ao CMV Fácil!\n\nPagamento confirmado.${planText}\n\nEntre no grupo exclusivo de clientes:\n${groupUrl}`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "Idempotency-Key": String(args.idempotencyKey).slice(0, 256),
    },
    body: JSON.stringify({ from, to, subject, html, text }),
  });
  const j = (await res.json().catch(() => null)) as any;
  if (!res.ok) return { ok: false, error: `email_send_failed:${String(j?.message ?? j?.error ?? "send_failed").trim()}` };
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
    <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.55; color: #111827; background: #f3f4f6; padding: 26px 12px;">
      <div style="max-width: 640px; margin: 0 auto;">
        <div style="padding: 14px 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <div style="width: 44px; height: 44px; border-radius: 14px; background: rgba(10, 184, 109, 0.14); display: inline-flex; align-items: center; justify-content: center; border: 1px solid rgba(10, 184, 109, 0.25);">
              <span style="color: #06754b; font-weight: 900; font-size: 14px;">CMV</span>
            </div>
            <div>
              <div style="font-weight: 900; font-size: 16px; letter-spacing: -0.2px;">CMV Fácil</div>
              <div style="color: #6b7280; font-size: 12px;">Convite de acesso</div>
            </div>
          </div>
          <div style="color: #6b7280; font-size: 12px; text-align: right;">cmvfacil.app</div>
        </div>

        <div style="background: #ffffff; border-radius: 16px; border: 1px solid #e5e7eb; box-shadow: 0 18px 50px rgba(0,0,0,0.06); overflow: hidden;">
          <div style="padding: 18px 18px 14px; background: linear-gradient(180deg, rgba(10, 184, 109, 0.14), rgba(10, 184, 109, 0));">
            <h2 style="margin: 0 0 8px 0; font-size: 20px; letter-spacing: -0.2px;">Seu acesso está pronto</h2>
            <p style="margin: 0; color: #374151; font-size: 14px;">
              Você foi convidado para acessar <strong>${companyName}</strong> no CMV Fácil.
            </p>
            <p style="margin: 10px 0 0; color: #374151; font-size: 14px;">
              ${inviterText} Sua permissão será: <strong>${roleLabel}</strong>.
            </p>
          </div>

          <div style="padding: 0 18px 18px;">
            <div style="border: 1px solid #e5e7eb; border-radius: 14px; padding: 12px 12px; background: #f9fafb; margin: 0 0 16px 0;">
              <div style="font-weight: 900; margin: 0 0 8px 0; font-size: 14px;">Como entrar (bem simples)</div>
              <ol style="margin: 0; padding-left: 18px; color: #374151; font-size: 14px;">
                <li>Clique no botão abaixo.</li>
                <li>Crie sua senha de acesso (é só para você).</li>
                <li>Você será redirecionado automaticamente para o painel.</li>
              </ol>
            </div>

            <div style="text-align: center; margin: 0 0 14px 0;">
              <a href="${actionLink}" style="display: inline-block; background: linear-gradient(180deg, #0ab86d, #098c55); color: #ffffff; padding: 12px 18px; border-radius: 12px; text-decoration: none; font-weight: 900;">
                Acessar sistema
              </a>
            </div>

            <div style="border-top: 1px solid #e5e7eb; padding-top: 12px; color: #6b7280; font-size: 12px;">
              <div style="margin: 0 0 8px 0;">Se o botão não abrir, copie e cole este link no navegador:</div>
              <div style="word-break: break-all; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px 10px;">
                ${actionLink}
              </div>
              <div style="margin: 10px 0 0 0;">Se você não esperava este convite, ignore este email.</div>
            </div>
          </div>
        </div>
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
