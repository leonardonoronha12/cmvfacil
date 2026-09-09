import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../../lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function attachmentToken(secret: string, protocol: string, index: number) {
  return crypto.createHmac("sha256", secret).update(`${protocol}:${index}`).digest("base64url").slice(0, 32);
}

export async function GET(req: NextRequest, context: { params: { protocol: string; index: string } }) {
  const protocol = String(context.params.protocol ?? "").trim();
  const index = Number(context.params.index);
  const token = String(req.nextUrl.searchParams.get("t") ?? "").trim();
  const secret = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || process.env.SERVICE_ROLE_KEY || "").trim();
  if (!secret || !/^CMV-\d{8}-[A-F0-9]{6}$/i.test(protocol) || !Number.isInteger(index) || index < 1 || index > 3) {
    return new NextResponse("Link inválido.", { status: 404 });
  }
  const expected = attachmentToken(secret, protocol, index);
  const valid = token.length === expected.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  if (!valid) return new NextResponse("Link inválido.", { status: 404 });

  const db = getSupabaseAdmin();
  const ticket = await db.from("support_tickets").select("id").eq("protocol", protocol).maybeSingle();
  if (ticket.error || !ticket.data?.id) return new NextResponse("Anexo não encontrado.", { status: 404 });
  const attachment = await db.from("support_attachments").select("storage_bucket,storage_path,original_name").eq("ticket_id", ticket.data.id).is("deleted_at", null).order("created_at", { ascending: true }).range(index - 1, index - 1).maybeSingle();
  if (attachment.error || !attachment.data?.storage_path) return new NextResponse("Anexo não encontrado.", { status: 404 });
  const downloadName = String(attachment.data.original_name || `anexo-${index}`).replace(/[\r\n"\\/]/g, "-");
  const signed = await db.storage.from(attachment.data.storage_bucket).createSignedUrl(attachment.data.storage_path, 15 * 60, { download: downloadName });
  if (signed.error || !signed.data?.signedUrl) return new NextResponse("Não foi possível abrir o anexo.", { status: 503 });
  const response = NextResponse.redirect(signed.data.signedUrl, 307);
  response.headers.set("cache-control", "no-store");
  return response;
}
