import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

function timingSafeEqual(a: string, b: string) {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}

function html(body: string, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "text/html; charset=utf-8");
  return new Response(body, { ...init, headers });
}

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function esc(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeEventType(value: unknown) {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v) return null;
  if (v.length > 120) return null;
  return v;
}

type MessageRow = {
  event_type: string;
  email_subject: string | null;
  email_body: string | null;
  whatsapp_body: string | null;
  twilio_content_sids: string | null;
  send_delay_minutes: number;
  repeat_count: number;
  repeat_interval_minutes: number;
  updated_at: string;
};

serve(async (req) => {
  const url = new URL(req.url);
  const accept = req.headers.get("accept") ?? "";
  const wantsJson = url.searchParams.get("format") === "json" || accept.includes("application/json");

  const adminSecret = Deno.env.get("ADMIN_SECRET") ?? "";
  const sentSecret = url.searchParams.get("key") ?? req.headers.get("x-admin-secret") ?? "";
  if (!adminSecret || !sentSecret || !timingSafeEqual(adminSecret, sentSecret)) {
    return wantsJson ? json({ error: "unauthorized" }, { status: 401 }) : html("Unauthorized", { status: 401 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("PROJECT_URL") ?? "";
  const supabaseServiceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !supabaseServiceRole) {
    return wantsJson
      ? json({ error: "server_not_configured" }, { status: 500 })
      : html("Server not configured", { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (req.method === "POST") {
    const contentType = req.headers.get("content-type") ?? "";
    let data: Record<string, unknown> = {};

    if (contentType.includes("application/json")) {
      try {
        data = (await req.json()) as Record<string, unknown>;
      } catch {
        return json({ error: "invalid_json" }, { status: 400 });
      }
    } else {
      const form = await req.formData().catch(() => null);
      if (!form) return json({ error: "invalid_form" }, { status: 400 });
      for (const [k, v] of form.entries()) {
        if (typeof v === "string") data[k] = v;
      }
    }

    const eventType = normalizeEventType(data.event_type);
    if (!eventType) return json({ error: "invalid_event_type" }, { status: 400 });

    const emailSubject = typeof data.email_subject === "string" ? data.email_subject : null;
    const emailBody = typeof data.email_body === "string" ? data.email_body : null;
    const whatsappBody = typeof data.whatsapp_body === "string" ? data.whatsapp_body : null;
    const twilioContentSids = typeof data.twilio_content_sids === "string" ? data.twilio_content_sids : null;

    const sendDelayMinutesRaw = typeof data.send_delay_minutes === "string"
      ? data.send_delay_minutes
      : typeof data.send_delay_minutes === "number"
      ? String(data.send_delay_minutes)
      : "";
    const repeatCountRaw = typeof data.repeat_count === "string"
      ? data.repeat_count
      : typeof data.repeat_count === "number"
      ? String(data.repeat_count)
      : "";
    const repeatIntervalMinutesRaw = typeof data.repeat_interval_minutes === "string"
      ? data.repeat_interval_minutes
      : typeof data.repeat_interval_minutes === "number"
      ? String(data.repeat_interval_minutes)
      : "";

    const sendDelayMinutes = Math.max(0, Number.parseInt(sendDelayMinutesRaw || "0", 10));
    const repeatCount = Math.max(1, Number.parseInt(repeatCountRaw || "1", 10));
    const repeatIntervalMinutes = Math.max(0, Number.parseInt(repeatIntervalMinutesRaw || "0", 10));

    const { error } = await supabase.from("automation_messages").upsert(
      {
        event_type: eventType,
        email_subject: emailSubject?.trim().length ? emailSubject : null,
        email_body: emailBody?.trim().length ? emailBody : null,
        whatsapp_body: whatsappBody?.trim().length ? whatsappBody : null,
        twilio_content_sids: twilioContentSids?.trim().length ? twilioContentSids.trim() : null,
        send_delay_minutes: sendDelayMinutes,
        repeat_count: repeatCount,
        repeat_interval_minutes: repeatIntervalMinutes,
      },
      { onConflict: "event_type" },
    );

    if (error) return json({ error: "save_failed", details: error.message }, { status: 500 });

    if (contentType.includes("application/json")) {
      return json({ ok: true });
    }

    const redirect = new URL(req.url);
    redirect.searchParams.set("saved", "1");
    return new Response("", { status: 303, headers: { location: redirect.toString() } });
  }

  if (req.method !== "GET") {
    return wantsJson
      ? json({ error: "method_not_allowed" }, { status: 405 })
      : html("Method not allowed", { status: 405 });
  }

  const eventTypeParam = normalizeEventType(url.searchParams.get("event_type"));
  let query = supabase
    .from("automation_messages")
    .select("event_type,email_subject,email_body,whatsapp_body,twilio_content_sids,send_delay_minutes,repeat_count,repeat_interval_minutes,updated_at")
    .order("event_type", { ascending: true });
  if (eventTypeParam) query = query.eq("event_type", eventTypeParam);

  const { data: rows, error } = await query;

  if (error) {
    return wantsJson ? json({ error: "query_failed", details: error.message }, { status: 500 }) : html(
      `Error: ${esc(error.message)}`,
      { status: 500 },
    );
  }

  const list = (rows ?? []) as MessageRow[];
  if (wantsJson) {
    return json({ ok: true, data: list });
  }
  const saved = url.searchParams.get("saved") === "1";

  const htmlRows = list
    .map((r) => {
      return `
        <tr>
          <td><code>${esc(r.event_type)}</code></td>
          <td>${r.email_subject ? esc(r.email_subject) : ""}</td>
          <td>${r.updated_at ? esc(r.updated_at) : ""}</td>
        </tr>
      `.trim();
    })
    .join("\n");

  return html(`
<!doctype html>
<html lang="pt-br">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Mensagens da Automação</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, "Helvetica Neue", "Noto Sans", "Liberation Sans", sans-serif; margin: 24px; color: #0f172a; }
      h1 { margin: 0 0 12px 0; font-size: 20px; }
      .row { display: grid; grid-template-columns: 1fr; gap: 16px; max-width: 980px; }
      .card { border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; background: #fff; }
      label { display: block; font-weight: 600; margin: 10px 0 6px; }
      input[type="text"], textarea { width: 100%; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 10px; font-size: 14px; }
      textarea { min-height: 120px; resize: vertical; }
      button { margin-top: 14px; background: #0f172a; color: #fff; border: 0; padding: 10px 14px; border-radius: 10px; font-weight: 700; cursor: pointer; }
      table { width: 100%; border-collapse: collapse; font-size: 13px; }
      th, td { border-top: 1px solid #e2e8f0; padding: 10px 8px; vertical-align: top; }
      th { text-align: left; background: #f8fafc; border-top: 1px solid #e2e8f0; }
      .ok { background: #ecfdf5; border: 1px solid #10b981; color: #065f46; padding: 10px 12px; border-radius: 10px; margin-bottom: 12px; }
      .hint { color: #475569; font-size: 13px; }
      code { background: #f1f5f9; padding: 2px 6px; border-radius: 6px; }
    </style>
  </head>
  <body>
    <h1>Mensagens da automação (Brevo)</h1>
    <div class="row">
      <div class="card">
        ${saved ? `<div class="ok">Salvo com sucesso.</div>` : ``}
        <div class="hint">Cadastre a mensagem por <code>event_type</code> (ex.: <code>contact.upsert</code>).</div>
        <form method="post">
          <label>Event Type</label>
          <input type="text" name="event_type" placeholder="contact.upsert" required />

          <label>Assunto do Email</label>
          <input type="text" name="email_subject" placeholder="Bem-vindo!" />

          <label>Mensagem do Email</label>
          <textarea name="email_body" placeholder="Digite aqui a mensagem do email..."></textarea>

          <label>Mensagem do WhatsApp</label>
          <textarea name="whatsapp_body" placeholder="Digite aqui a mensagem do WhatsApp..."></textarea>

          <label>Templates Twilio (HX...)</label>
          <input type="text" name="twilio_content_sids" placeholder="HX... ou HX...,HX..." />

          <label>Enviar após (minutos)</label>
          <input type="text" name="send_delay_minutes" placeholder="0" />

          <label>Quantas vezes enviar</label>
          <input type="text" name="repeat_count" placeholder="1" />

          <label>Intervalo entre envios (minutos)</label>
          <input type="text" name="repeat_interval_minutes" placeholder="0" />

          <button type="submit">Salvar</button>
        </form>
      </div>

      <div class="card">
        <div class="hint">Mensagens cadastradas</div>
        <table>
          <thead>
            <tr>
              <th>event_type</th>
              <th>assunto email</th>
              <th>updated_at</th>
            </tr>
          </thead>
          <tbody>
            ${htmlRows || `<tr><td colspan="3">Nenhuma mensagem cadastrada ainda.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  </body>
</html>
  `.trim());
});
