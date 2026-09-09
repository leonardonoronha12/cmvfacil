import { NextResponse } from "next/server";
import { getSupabaseAuthConfig } from "../../../lib/supabaseAuthConfig";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return NextResponse.json(data, { ...init, headers });
}

function passwordErrorMessage(status: number, raw: string) {
  let code = "";
  let message = raw;
  try {
    const parsed = JSON.parse(raw) as { code?: unknown; error_code?: unknown; message?: unknown; msg?: unknown };
    code = String(parsed.code ?? parsed.error_code ?? "").toLowerCase();
    message = String(parsed.message ?? parsed.msg ?? raw).toLowerCase();
  } catch {
    message = raw.toLowerCase();
  }
  if (code.includes("same_password") || message.includes("same password") || message.includes("different from the old")) {
    return "A nova senha deve ser diferente da senha usada anteriormente.";
  }
  if (code.includes("weak_password") || message.includes("password should be at least") || message.includes("weak password")) {
    return "Escolha uma senha mais segura, com pelo menos 8 caracteres, incluindo letras e números.";
  }
  if (code.includes("expired") || code.includes("bad_jwt") || message.includes("expired") || message.includes("invalid token") || status === 401) {
    return "Este link de troca de senha expirou ou já foi utilizado. Solicite um novo link para continuar.";
  }
  if (code.includes("over_request") || message.includes("rate limit")) {
    return "Foram feitas muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.";
  }
  return "Não foi possível alterar a senha agora. Confira os dados e tente novamente.";
}

export async function POST(req: Request) {
  let body: { access_token?: string; password?: string } = {};
  try {
    body = (await req.json()) as { access_token?: string; password?: string };
  } catch {
    return json({ error: "invalid_json" }, { status: 400 });
  }

  const accessToken = (body.access_token ?? "").trim();
  const password = (body.password ?? "").trim();
  if (!accessToken) return json({ error: "missing_access_token" }, { status: 400 });
  if (!password) return json({ error: "missing_password" }, { status: 400 });

  let cfg;
  try {
    cfg = getSupabaseAuthConfig();
  } catch {
    return json({ error: "server_not_configured" }, { status: 500 });
  }

  const res = await fetch(`${cfg.url.replace(/\/+$/, "")}/auth/v1/user`, {
    method: "PUT",
    headers: {
      apikey: cfg.anonKey,
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ password }),
  });

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    return json({ error: "update_failed", details: passwordErrorMessage(res.status, text) }, { status: 400 });
  }

  return json({ ok: true }, { status: 200 });
}

