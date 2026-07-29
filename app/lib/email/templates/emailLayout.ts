import "server-only";

function escapeHtml(s: string) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function renderEmailLayout(args: {
  title: string;
  previewText?: string;
  greeting?: string;
  bodyHtml: string;
  bodyText: string;
  button?: { label: string; url: string } | null;
  supportEmail?: string | null;
}) {
  const title = String(args.title ?? "").trim() || "CMV Fácil";
  const previewText = String(args.previewText ?? "").trim();
  const greeting = String(args.greeting ?? "").trim();
  const bodyHtml = String(args.bodyHtml ?? "").trim();
  const bodyText = String(args.bodyText ?? "").trim();
  const button = args.button ?? null;
  const supportEmail = String(args.supportEmail ?? "").trim();

  const footerLine1 = "CMV Fácil";
  const footerLine2 = "https://cmvfacil.app";
  const footerLine3 = "Este é um e-mail automático do CMV Fácil.";
  const supportLine = supportEmail ? `Suporte: ${supportEmail}` : "";

  const text =
    `${title}\n\n` +
    (greeting ? `${greeting}\n\n` : "") +
    `${bodyText}\n\n` +
    (button ? `${button.label}: ${button.url}\n\n` : "") +
    (supportLine ? `${supportLine}\n\n` : "") +
    `${footerLine1}\n${footerLine2}\n${footerLine3}\n`;

  const html = `
  <!doctype html>
  <html lang="pt-br">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <meta name="x-apple-disable-message-reformatting" />
      <title>${escapeHtml(title)}</title>
    </head>
    <body style="margin:0;padding:0;background:#f3f4f6;">
      ${
        previewText
          ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(previewText)}</div>`
          : ""
      }
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f3f4f6;padding:28px 12px;">
        <tr>
          <td align="center">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:640px;">
              <tr>
                <td style="padding:0 0 14px 0;">
                  <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                    <tr>
                      <td style="font-family:Arial,Helvetica,sans-serif;">
                        <div style="display:inline-flex;align-items:center;gap:10px;">
                          <div style="width:44px;height:44px;border-radius:14px;background:rgba(10,184,109,0.14);display:inline-flex;align-items:center;justify-content:center;border:1px solid rgba(10,184,109,0.25);">
                            <span style="color:#06754b;font-weight:900;font-size:14px;">CMV</span>
                          </div>
                          <div>
                            <div style="font-weight:900;font-size:16px;letter-spacing:-0.2px;color:#111827;">CMV Fácil</div>
                            <div style="color:#6b7280;font-size:12px;">${escapeHtml(title)}</div>
                          </div>
                        </div>
                      </td>
                      <td align="right" style="font-family:Arial,Helvetica,sans-serif;color:#6b7280;font-size:12px;">cmvfacil.app</td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="background:#ffffff;border-radius:16px;border:1px solid #e5e7eb;box-shadow:0 18px 50px rgba(0,0,0,0.06);overflow:hidden;">
                  <div style="padding:20px 18px 12px;background:linear-gradient(180deg,rgba(10,184,109,0.14),rgba(10,184,109,0));font-family:Arial,Helvetica,sans-serif;">
                    ${greeting ? `<div style="font-size:14px;color:#374151;margin:0 0 8px 0;">${escapeHtml(greeting)}</div>` : ""}
                    <div style="font-size:14px;color:#111827;line-height:1.55;">${bodyHtml}</div>
                  </div>
                  ${
                    button
                      ? `<div style="padding:0 18px 16px;text-align:center;">
                          <a href="${escapeHtml(button.url)}" style="display:inline-block;background:linear-gradient(180deg,#0ab86d,#098c55);color:#ffffff;padding:12px 18px;border-radius:12px;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-weight:900;">
                            ${escapeHtml(button.label)}
                          </a>
                        </div>`
                      : ""
                  }
                  <div style="border-top:1px solid #e5e7eb;padding:14px 18px 16px;font-family:Arial,Helvetica,sans-serif;">
                    ${supportEmail ? `<div style="color:#374151;font-size:12px;margin:0 0 10px 0;">Suporte: ${escapeHtml(supportEmail)}</div>` : ""}
                    <div style="color:#6b7280;font-size:12px;margin:0 0 10px 0;">${escapeHtml(footerLine3)}</div>
                    <div style="color:#6b7280;font-size:12px;margin:0;">${escapeHtml(footerLine1)} · <a href="${footerLine2}" style="color:#6b7280;text-decoration:underline;">${footerLine2}</a></div>
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
  </html>
  `.trim();

  return { html, text };
}
