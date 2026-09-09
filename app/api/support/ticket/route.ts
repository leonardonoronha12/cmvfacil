import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../../lib/requestUserId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SUPPORT_BUCKET = "support-tickets";
const SUPPORT_PHONE = "5513936180830";
const clean = (value: unknown) => String(value ?? "").trim();
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const attachmentToken = (secret: string, protocol: string, index: number) => crypto.createHmac("sha256", secret).update(`${protocol}:${index}`).digest("base64url").slice(0, 32);

export async function GET(req: NextRequest) {
  const { userId } = getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ ok: false, error: "Sua sessão expirou." }, { status: 401 });
  const db = getSupabaseAdmin();
  const result = await db.from("support_tickets").select("protocol,status,raw_metadata").eq("user_id", userId).eq("status", "resolved").order("opened_at", { ascending: false }).limit(20);
  if (result.error) return NextResponse.json({ ok: false, error: "Não foi possível consultar os chamados." }, { status: 500 });
  const resolutions = (result.data || []).map((row: any) => ({
    protocol: clean(row.protocol),
    resolvedAt: clean(row.raw_metadata?.resolvedAt),
    notifiedAt: clean(row.raw_metadata?.resolutionNotification?.createdAt),
  })).filter((row: any) => row.protocol && row.resolvedAt);
  return NextResponse.json({ ok: true, resolutions });
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId) return NextResponse.json({ ok: false, error: "Sua sessão expirou." }, { status: 401 });

    const form = await req.formData();
    const message = clean(form.get("message"));
    const page = clean(form.get("page")) || "/";
    if (message.length < 3 || message.length > 4000) return NextResponse.json({ ok: false, error: "Descrição inválida." }, { status: 400 });

    const files = form.getAll("attachments").filter((value): value is File => value instanceof File && value.size > 0).slice(0, 3);
    const uploadedAttachments = (() => {
      try {
        const parsed = JSON.parse(clean(form.get("uploadedAttachments")) || "[]");
        return Array.isArray(parsed) ? parsed.slice(0, 3) as Array<{ name?: unknown; type?: unknown; size?: unknown; path?: unknown }> : [];
      } catch {
        return [];
      }
    })();
    if (files.some((file) => !/^(image|video)\//.test(file.type) || file.size > 25 * 1024 * 1024)) {
      return NextResponse.json({ ok: false, error: "Anexo inválido." }, { status: 400 });
    }
    if (uploadedAttachments.some((file) => {
      const path = clean(file.path);
      const type = clean(file.type);
      const size = Number(file.size ?? 0);
      return !path.startsWith(`pending/${userId}/`) || !/^(image|video)\//.test(type) || !Number.isFinite(size) || size <= 0 || size > 25 * 1024 * 1024;
    })) return NextResponse.json({ ok: false, error: "Anexo inválido." }, { status: 400 });

    const db = getSupabaseAdmin();
    const requestedCompany = clean(req.cookies.get("cmv_active_company")?.value);
    let membershipQuery = db.from("company_members").select("company_id").eq("user_id", userId);
    if (requestedCompany && isUuid(requestedCompany)) membershipQuery = membershipQuery.eq("company_id", requestedCompany);
    const membership = await membershipQuery.limit(1).maybeSingle();
    const companyId = clean(membership.data?.company_id) || null;
    const auth = await db.auth.admin.getUserById(userId);
    const email = clean(auth.data.user?.email);
    const protocol = `CMV-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    const openedAt = new Date().toISOString();
    const root = `${openedAt.slice(0, 10)}/${protocol}`;

    const bucketState = await db.storage.getBucket(SUPPORT_BUCKET);
    if (bucketState.error) {
      const created = await db.storage.createBucket(SUPPORT_BUCKET, { public: false, fileSizeLimit: 25 * 1024 * 1024, allowedMimeTypes: ["image/*", "video/*", "application/json"] });
      if (created.error) throw created.error;
    }

    const attachments: Array<{ name: string; type: string; size: number; path: string; url: string }> = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]!;
      const safeName = file.name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-100) || "anexo";
      const path = `${root}/${index + 1}-${safeName}`;
      const uploaded = await db.storage.from(SUPPORT_BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
      if (uploaded.error) throw uploaded.error;
      const signed = await db.storage.from(SUPPORT_BUCKET).createSignedUrl(path, 7 * 86400);
      attachments.push({ name: file.name, type: file.type, size: file.size, path, url: clean(signed.data?.signedUrl) });
    }
    for (let index = 0; index < uploadedAttachments.length; index += 1) {
      const file = uploadedAttachments[index]!;
      const sourcePath = clean(file.path);
      const safeName = clean(file.name).normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-100) || "anexo";
      const path = `${root}/${files.length + index + 1}-${safeName}`;
      const moved = await db.storage.from(SUPPORT_BUCKET).move(sourcePath, path);
      if (moved.error) throw moved.error;
      const signed = await db.storage.from(SUPPORT_BUCKET).createSignedUrl(path, 7 * 86400);
      if (signed.error) throw signed.error;
      attachments.push({ name: clean(file.name), type: clean(file.type), size: Number(file.size), path, url: clean(signed.data?.signedUrl) });
    }

    const payload = { protocol, createdAt: openedAt, status: "open", user: { id: userId, email }, company: { id: companyId }, page, message, attachments };
    const saved = await db.storage.from(SUPPORT_BUCKET).upload(`${root}/ticket.json`, JSON.stringify(payload, null, 2), { contentType: "application/json", upsert: false });
    if (saved.error) throw saved.error;

    const company = companyId ? await db.from("companies").select("phone_e164").eq("id", companyId).maybeSingle() : null;
    const phone = clean((company?.data as any)?.phone_e164 || auth.data.user?.user_metadata?.whatsapp || auth.data.user?.phone);
    const ticket = await db.from("support_tickets").upsert({ protocol, user_id: userId, company_id: companyId, status: "open", message, page, storage_root: root, opened_at: openedAt, source: "assistant", raw_metadata: { email, phone } }, { onConflict: "protocol" }).select("id").single();
    if (ticket.error) throw ticket.error;

    if (attachments.length) {
      const catalog = await db.from("support_attachments").upsert(attachments.map((attachment) => ({ ticket_id: ticket.data.id, storage_bucket: SUPPORT_BUCKET, storage_path: attachment.path, original_name: attachment.name, mime_type: attachment.type, size_bytes: attachment.size, created_at: openedAt })), { onConflict: "storage_bucket,storage_path" });
      if (catalog.error) throw catalog.error;
    }

    const attachmentLines = attachments.map((attachment, index) => `Anexo ${index + 1}: ${attachment.url}`).join("\n");
    let forwarded = false;
    let twilioSid = "";
    let twilioStatus = "";
    const supabaseUrl = clean(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
    const serviceRole = clean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || process.env.SERVICE_ROLE_KEY);
    const publicAttachmentLinks = serviceRole
      ? attachments.map((_, index) => `https://cmvfacil.app/api/support/attachment-link/${protocol}/${index + 1}?t=${attachmentToken(serviceRole, protocol, index + 1)}`)
      : [];
    const templateAttachmentText = publicAttachmentLinks.map((url, index) => `Anexo ${index + 1}: ${url}`).join(" ");
    const text = ["Olá, preciso de suporte no CMV Fácil.", `Protocolo: ${protocol}`, `Usuário: ${email}`, `Página: ${page}`, `Problema: ${message}`, attachmentLines].filter(Boolean).join("\n");

    if (supabaseUrl && serviceRole) {
      for (let attempt = 1; attempt <= 3 && !forwarded; attempt += 1) {
        try {
          const response = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/functions/v1/support-whatsapp`, {
            method: "POST",
            headers: { authorization: `Bearer ${serviceRole}`, apikey: serviceRole, "content-type": "application/json", "x-cmv-attempt": String(attempt) },
            body: JSON.stringify({ message: text, protocol, contentVariables: { "1": protocol, "2": email, "3": companyId || "Não identificada", "4": page, "5": [message, templateAttachmentText].filter(Boolean).join(" — ") } }),
            signal: AbortSignal.timeout(15000),
          });
          const result = await response.json().catch(() => ({}));
          forwarded = response.ok && result?.ok === true;
          if (forwarded) {
            twilioSid = clean(result.sid);
            twilioStatus = clean(result.status);
          }
        } catch {}
      }
    }

    if (forwarded && twilioSid) {
      const evidence = { protocol, twilioSid, twilioStatus, acceptedAt: new Date().toISOString() };
      await db.storage.from(SUPPORT_BUCKET).upload(`${root}/twilio.json`, JSON.stringify(evidence, null, 2), { contentType: "application/json", upsert: true });
      await db.from("support_delivery_receipts").upsert({ ticket_id: ticket.data.id, provider: "twilio", provider_message_id: twilioSid, status: twilioStatus || "accepted", evidence }, { onConflict: "provider,provider_message_id" });
    }

    return NextResponse.json({ ok: true, protocol, forwarded, twilioSid: twilioSid || undefined, twilioStatus: twilioStatus || undefined, whatsappUrl: `https://wa.me/${SUPPORT_PHONE}?text=${encodeURIComponent(text)}` }, { status: 201 });
  } catch (error) {
    console.error("support_ticket_failed", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ ok: false, error: "Não foi possível registrar o chamado." }, { status: 500 });
  }
}
