import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function whatsapp(value: string) {
  const normalized = value.trim();
  return normalized.toLowerCase().startsWith("whatsapp:") ? normalized : `whatsapp:${normalized}`;
}

serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const serviceRole = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "").trim();
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!serviceRole || !bearer || !safeEqual(serviceRole, bearer)) return json({ ok: false, error: "unauthorized" }, 401);

  const accountSid = (Deno.env.get("TWILIO_ACCOUNT_SID") ?? "").trim();
  const authToken = (Deno.env.get("TWILIO_AUTH_TOKEN") ?? "").trim();
  const from = (Deno.env.get("TWILIO_WHATSAPP_FROM") ?? "").trim();
  const to = (Deno.env.get("CMV_SUPPORT_WHATSAPP_TO") ?? "+5513936180830").trim();
  if (!accountSid || !authToken || !from || !to) return json({ ok: false, error: "twilio_not_configured" }, 500);

  const payload = await req.json().catch(() => null) as { message?: unknown } | null;
  const message = String(payload?.message ?? "").trim();
  if (message.length < 3 || message.length > 6000) return json({ ok: false, error: "invalid_message" }, 400);

  const form = new URLSearchParams();
  form.set("From", whatsapp(from));
  form.set("To", whatsapp(to));
  form.set("Body", message);
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
    method: "POST",
    headers: {
      authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: form.toString(),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) return json({ ok: false, error: "twilio_send_failed", detail: String(result?.message ?? "") }, 502);
  return json({ ok: true, sid: result?.sid ?? null, status: result?.status ?? null });
});
