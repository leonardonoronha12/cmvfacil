import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../../lib/requestUserId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BUCKET = "support-tickets";
const SUPPORT_PHONE = "5513936180830";
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 60 * 1024 * 1024;

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
const clean = (value: unknown) => String(value ?? "").trim();
const safeName = (value: string) => value.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").slice(-100) || "anexo";
const env = (...names: string[]) => names.map(name => clean(process.env[name])).find(Boolean) || "";

export async function POST(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId) return json({ ok: false, error: "Sua sessão expirou. Entre novamente para abrir o chamado." }, 401);
    const form = await req.formData();
    const message = clean(form.get("message"));
    const page = clean(form.get("page")) || "/";
    if (message.length < 3) return json({ ok: false, error: "Descreva um pouco mais o que está acontecendo." }, 400);
    if (message.length > 4000) return json({ ok: false, error: "A descrição pode ter no máximo 4.000 caracteres." }, 400);
    const files = form.getAll("attachments").filter((value): value is File => value instanceof File && value.size > 0).slice(0, 3);
    if (files.some(file => !/^(image|video)\//.test(file.type))) return json({ ok: false, error: "Envie somente imagens ou vídeos." }, 400);
    if (files.some(file => file.size > MAX_FILE_BYTES) || files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_BYTES) return json({ ok: false, error: "Cada arquivo pode ter até 25 MB e o total até 60 MB." }, 413);

    const db = getSupabaseAdmin();
    const [{ data: auth }, { data: profile }, { data: memberships }] = await Promise.all([
      db.auth.admin.getUserById(userId),
      db.from("user_profiles").select("email,nome_completo,nome,sobrenome,whatsapp").eq("user_id", userId).maybeSingle(),
      db.from("company_members").select("company_id,role").eq("user_id", userId).limit(1),
    ]);
    const companyId = clean(memberships?.[0]?.company_id);
    const { data: company } = companyId ? await db.from("companies").select("fantasy_name,email,phone_e164").eq("id", companyId).maybeSingle() : { data: null } as any;
    const email = clean(profile?.email || auth.user?.email);
    const name = clean(profile?.nome_completo || `${clean(profile?.nome)} ${clean(profile?.sobrenome)}`) || email;
    const companyName = clean(company?.fantasy_name) || "Não identificada";
    const protocol = `CMV-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${randomUUID().slice(0, 6).toUpperCase()}`;
    const root = `${new Date().toISOString().slice(0, 10)}/${protocol}`;
    const attachments: Array<{ name: string; type: string; size: number; path: string; url: string }> = [];
    let persistenceError = "";
    try {
      const existingBucket = await db.storage.getBucket(BUCKET);
      if (existingBucket.error) {
        const created = await db.storage.createBucket(BUCKET, { public: false, fileSizeLimit: MAX_FILE_BYTES, allowedMimeTypes: ["image/*", "video/*"] });
        if (created.error && !/already exists/i.test(created.error.message)) throw created.error;
      }
      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        const path = `${root}/${index + 1}-${safeName(file.name)}`;
        const uploaded = await db.storage.from(BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
        if (uploaded.error) throw uploaded.error;
        const signed = await db.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24 * 7);
        attachments.push({ name: file.name, type: file.type, size: file.size, path, url: clean(signed.data?.signedUrl) });
      }
      const ticketData = { protocol, createdAt: new Date().toISOString(), status: "open", user: { id: userId, name, email, whatsapp: clean(profile?.whatsapp) }, company: { id: companyId, name: companyName, email: clean(company?.email), phone: clean(company?.phone_e164) }, page, message, attachments };
      const ticketUpload = await db.storage.from(BUCKET).upload(`${root}/ticket.json`, JSON.stringify(ticketData, null, 2), { contentType: "application/json", upsert: false });
      if (ticketUpload.error) throw ticketUpload.error;
    } catch (error) {
      // A storage outage must not prevent the support message from reaching WhatsApp.
      persistenceError = error instanceof Error ? error.message : String(error);
    }
    const attachmentLines = attachments.map((item, index) => `Anexo ${index + 1}: ${item.url}`).join("\n");
    const whatsappText = [`Olá, preciso de suporte no CMV Fácil.`, `Protocolo: ${protocol}`, `Usuário: ${name} (${email})`, `Empresa: ${companyName}`, `Página: ${page}`, `Problema: ${message}`, attachmentLines].filter(Boolean).join("\n");
    const whatsappUrl = `https://wa.me/${SUPPORT_PHONE}?text=${encodeURIComponent(whatsappText)}`;
    let forwarded = false;
    let forwardingError = "";
    const supabaseUrl = env("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
    const serviceRole = env("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE", "SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY");
    if (supabaseUrl && serviceRole) {
      for (let attempt = 1; attempt <= 3 && !forwarded; attempt++) {
        try {
          const response = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/functions/v1/support-whatsapp`, {
            method: "POST",
            headers: { authorization: `Bearer ${serviceRole}`, apikey: serviceRole, "content-type": "application/json", "x-cmv-attempt": String(attempt) },
            body: JSON.stringify({ message: whatsappText, protocol }),
            cache: "no-store",
            signal: AbortSignal.timeout(15_000),
          });
          const result = await response.json().catch(() => ({}));
          forwarded = response.ok && result?.ok === true;
          if (!forwarded) forwardingError = clean(result?.detail || result?.error || `http_${response.status}`);
          if (!forwarded && attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 700));
        } catch (error) {
          forwardingError = error instanceof Error ? error.message : String(error);
          if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 700));
        }
      }
    } else {
      forwardingError = "supabase_not_configured";
    }
    return json({ ok: true, protocol, whatsappUrl, attachments: attachments.length, forwarded, persistenceError: persistenceError || undefined, forwardingError: forwarded ? undefined : forwardingError });
  } catch (error) {
    return json({ ok: false, error: "Não foi possível registrar o chamado agora.", detail: error instanceof Error ? error.message : String(error) }, 500);
  }
}
