import "server-only";

type ResendSendEmailArgs = {
  apiKey: string;
  from: string;
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
};

export async function resendSendEmail(args: ResendSendEmailArgs): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const apiKey = String(args.apiKey ?? "").trim();
  if (!apiKey) return { ok: false, error: "missing_api_key" };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: args.from,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
      ...(args.replyTo ? { replyTo: args.replyTo } : {}),
    }),
  });

  const j = (await res.json().catch(() => null)) as any;
  if (!res.ok) {
    const msg = String(j?.message ?? j?.error ?? "send_failed").trim();
    console.error("resend_send_failed", { status: res.status, code: msg.slice(0, 120) });
    return { ok: false, error: "provider_send_failed" };
  }

  const id = String(j?.id ?? "").trim();
  if (!id) return { ok: false, error: "provider_missing_id" };
  return { ok: true, id };
}
