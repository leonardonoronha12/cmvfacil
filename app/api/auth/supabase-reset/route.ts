import { NextRequest, NextResponse } from "next/server";
import { getPublicAppUrl } from "../../../lib/publicAppUrl";
import { checkAuthRateLimit } from "../../../lib/authRateLimit";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { sendPasswordResetEmail } from "../../../lib/email";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return NextResponse.json(data, { ...init, headers });
}

function safeEmail(value: unknown) {
  const v = String(value ?? "").trim().toLowerCase();
  if (!v || !v.includes("@")) return "";
  return v;
}

export async function POST(req: NextRequest) {
  let body: { email?: string } = {};
  try {
    body = (await req.json()) as { email?: string };
  } catch {
    return json({ error: "invalid_json" }, { status: 400 });
  }

  const email = safeEmail(body.email);
  if (!email) return json({ ok: false, error: "email_required" }, { status: 400 });

  const rl = await checkAuthRateLimit({ req, action: "password_reset", email });
  if (!rl.ok) return json({ ok: false, error: rl.error }, { status: 429 });

  const appUrl = getPublicAppUrl().replace(/\/+$/, "");
  const redirectTo = `${appUrl}/auth/callback?next=${encodeURIComponent("/restaurar-senha")}`;

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return json({ error: "server_not_configured" }, { status: 500 });
  }

  const generated = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo },
  } as any);

  if (generated.error) {
    const message = String(generated.error.message ?? "").toLowerCase();
    if (message.includes("not found") || message.includes("does not exist") || message.includes("unable to find")) {
      return json({ ok: true }, { status: 200 });
    }
    console.error("password_reset_generate_link_failed", { code: message.slice(0, 120) });
    return json({ ok: true }, { status: 200 });
  }

  const actionLink = String((generated.data as any)?.properties?.action_link ?? "").trim();
  if (!actionLink) {
    console.error("password_reset_generate_link_missing_action_link");
    return json({ ok: true }, { status: 200 });
  }

  const sent = await sendPasswordResetEmail({ to: email, actionLink });
  if (!sent.ok) {
    console.error("password_reset_email_send_failed", { code: String(sent.error ?? "").slice(0, 120) });
    return json({ ok: true }, { status: 200 });
  }

  return json({ ok: true }, { status: 200 });
}
