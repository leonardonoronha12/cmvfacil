import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../../lib/requestUserId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPPORT_BUCKET = "support-tickets";
const clean = (value: unknown) => String(value ?? "").trim();

export async function POST(req: NextRequest) {
  try {
    const { userId } = getUserIdFromRequest(req);
    if (!userId) return NextResponse.json({ ok: false, error: "Sua sessão expirou." }, { status: 401 });

    const payload = await req.json().catch(() => null) as { name?: unknown; type?: unknown; size?: unknown } | null;
    const name = clean(payload?.name);
    const type = clean(payload?.type).toLowerCase();
    const size = Number(payload?.size ?? 0);
    if (!name || !/^(image|video)\//.test(type) || !Number.isFinite(size) || size <= 0 || size > 25 * 1024 * 1024) {
      return NextResponse.json({ ok: false, error: "Anexo inválido. Envie imagem ou vídeo de até 25 MB." }, { status: 400 });
    }

    const safeName = name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-100) || "anexo";
    const path = `pending/${userId}/${crypto.randomUUID()}-${safeName}`;
    const db = getSupabaseAdmin();
    const signed = await db.storage.from(SUPPORT_BUCKET).createSignedUploadUrl(path);
    if (signed.error || !signed.data?.signedUrl) throw signed.error ?? new Error("signed_upload_url_missing");

    return NextResponse.json({ ok: true, path, signedUrl: signed.data.signedUrl }, { status: 201 });
  } catch (error) {
    console.error("support_attachment_upload_init_failed", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ ok: false, error: "Não foi possível preparar o envio do anexo." }, { status: 500 });
  }
}
