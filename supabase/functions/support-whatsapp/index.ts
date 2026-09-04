import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function whatsapp(value: string) {
  const normalized = value.trim();
  return normalized.toLowerCase().startsWith("whatsapp:") ? normalized : `whatsapp:${normalized}`;
}

serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  if (!supabaseUrl || !bearer) return json({ ok: false, error: "unauthorized" }, 401);
  const authCheck = await fetch(`${supabaseUrl}/auth/v1/admin/users?page=1&per_page=1`, {
    headers: { authorization: `Bearer ${bearer}`, apikey: bearer },
  }).catch(() => null);
  if (!authCheck?.ok) return json({ ok: false, error: "unauthorized" }, 401);

  const accountSid = (Deno.env.get("TWILIO_ACCOUNT_SID") ?? "").trim();
  const authToken = (Deno.env.get("TWILIO_AUTH_TOKEN") ?? "").trim();
  const from = (Deno.env.get("TWILIO_WHATSAPP_FROM") ?? "").trim();
  const to = (Deno.env.get("CMV_SUPPORT_WHATSAPP_TO") ?? "+5513936180830").trim();
  if (!accountSid || !authToken || !from || !to) return json({ ok: false, error: "twilio_not_configured" }, 500);

  const payload = await req.json().catch(() => null) as {
    message?: unknown;
    protocol?: unknown;
    contentVariables?: Record<string, unknown>;
  } | null;
  const message = String(payload?.message ?? "").trim();
  const protocol = String(payload?.protocol ?? crypto.randomUUID()).trim();
  const contentSid = (Deno.env.get("TWILIO_SUPPORT_CONTENT_SID") ?? "HXda60a45528a794d78b6e59802e30d187").trim();
  const contentVariables = Object.fromEntries(
    Object.entries(payload?.contentVariables ?? {}).map(([key, value]) => [key, String(value ?? "").trim()]),
  );
  if (message.length < 3 || message.length > 6000) return json({ ok: false, error: "invalid_message" }, 400);
  if (!contentSid || Object.keys(contentVariables).length !== 5) return json({ ok: false, error: "invalid_template_data" }, 400);

  const form = new URLSearchParams();
  form.set("From", whatsapp(from));
  form.set("To", whatsapp(to));
  form.set("ContentSid", contentSid);
  form.set("ContentVariables", JSON.stringify(contentVariables));
  let lastDetail = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
      method: "POST",
      headers: {
        authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
        "Idempotency-Key": `cmv-support-${protocol}`,
      },
      body: form.toString(),
    }).catch(() => null);
    const result = response ? await response.json().catch(() => ({})) : {};
    if (response?.ok) return json({ ok: true, sid: result?.sid ?? null, status: result?.status ?? null });
    lastDetail = String(result?.message ?? "network_error");
    if (response && response.status < 500) break;
    if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 600));
  }
  return json({ ok: false, error: "twilio_send_failed", detail: lastDetail }, 502);
});
