import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return NextResponse.json(data, { ...init, headers });
}

function safeExt(filename: string) {
  const base = filename.split("?")[0] ?? "";
  const idx = base.lastIndexOf(".");
  if (idx === -1) return null;
  const ext = base.slice(idx + 1).toLowerCase();
  if (!ext) return null;
  if (ext.length > 8) return null;
  if (!/^[a-z0-9]+$/.test(ext)) return null;
  return ext;
}

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "invalid_form_data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "file_required" }, { status: 400 });

  if (file.size <= 0) return json({ error: "file_empty" }, { status: 400 });
  if (file.size > 5 * 1024 * 1024) return json({ error: "file_too_large" }, { status: 400 });

  const contentType = (file.type ?? "").trim();
  if (!contentType.startsWith("image/")) return json({ error: "invalid_file_type" }, { status: 400 });

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch {
    return json({ error: "server_not_configured" }, { status: 500 });
  }

  const ext = safeExt(file.name) ?? (contentType === "image/png" ? "png" : contentType === "image/jpeg" ? "jpg" : "webp");
  const objectPath = `logos/${crypto.randomUUID()}.${ext}`;

  const upload = await supabase.storage.from("company-logos").upload(objectPath, file, {
    contentType,
    upsert: false,
  });

  if (upload.error) {
    return json({ error: "upload_failed", details: upload.error.message }, { status: 500 });
  }

  const { data } = supabase.storage.from("company-logos").getPublicUrl(objectPath);
  return json({ ok: true, path: objectPath, publicUrl: data.publicUrl }, { status: 200 });
}

