import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { getUserIdFromRequest } from "../../../lib/requestUserId";

function isUuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function safeExt(file: File) { if (file.type === "image/png") return "png"; if (file.type === "image/webp") return "webp"; return "jpg"; }
async function context(req: NextRequest) {
  const { userId } = getUserIdFromRequest(req); if (!userId || !isUuid(userId)) return null;
  const db = getSupabaseAdmin(); const requested = String(req.cookies.get("cmv_active_company")?.value ?? "").trim();
  let query = db.from("company_members").select("company_id").eq("user_id", userId); if (requested && isUuid(requested)) query = query.eq("company_id", requested);
  const { data } = await query.limit(1).maybeSingle(); return data?.company_id ? { db, companyId: String(data.company_id) } : null;
}

export async function POST(req: NextRequest) {
  const ctx = await context(req); if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const form = await req.formData().catch(() => null); const file = form?.get("file"); const itemId = String(form?.get("itemId") ?? "").replace(/^db:/, "");
  if (!(file instanceof File) || !isUuid(itemId)) return NextResponse.json({ error: "invalid_form" }, { status: 400 });
  if (!file.type.startsWith("image/") || file.size <= 0 || file.size > 5 * 1024 * 1024) return NextResponse.json({ error: "invalid_file" }, { status: 400 });
  const { data: item } = await ctx.db.from("items").select("id,operational_image_url").eq("id", itemId).eq("company_id", ctx.companyId).maybeSingle();
  if (!item) return NextResponse.json({ error: "item_not_found" }, { status: 404 });
  const path = `${ctx.companyId}/${itemId}/${crypto.randomUUID()}.${safeExt(file)}`;
  const upload = await ctx.db.storage.from("item-photos").upload(path, file, { contentType: file.type, upsert: false });
  if (upload.error) return NextResponse.json({ error: upload.error.message }, { status: 500 });
  const publicUrl = ctx.db.storage.from("item-photos").getPublicUrl(path).data.publicUrl;
  const update = await ctx.db.from("items").update({ operational_image_url: publicUrl }).eq("id", itemId).eq("company_id", ctx.companyId);
  if (update.error) { await ctx.db.storage.from("item-photos").remove([path]); return NextResponse.json({ error: update.error.message }, { status: 500 }); }
  return NextResponse.json({ ok: true, publicUrl });
}

