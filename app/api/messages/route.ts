import { NextResponse } from "next/server";

const baseUrl = process.env.SUPABASE_FUNCTIONS_BASE_URL;
const adminSecret = process.env.ADMIN_SECRET;

function requireEnv() {
  if (!baseUrl) return { ok: false as const, error: "SUPABASE_FUNCTIONS_BASE_URL_not_set" };
  if (!adminSecret) return { ok: false as const, error: "ADMIN_SECRET_not_set" };
  return { ok: true as const, baseUrl, adminSecret };
}

export async function GET() {
  const env = requireEnv();
  if (!env.ok) return NextResponse.json({ error: env.error }, { status: 500 });

  const url = new URL(`${env.baseUrl.replace(/\/+$/, "")}/message-admin`);
  url.searchParams.set("format", "json");

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { accept: "application/json", "x-admin-secret": env.adminSecret },
    cache: "no-store",
  });

  const text = await res.text();
  let data: unknown = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: "invalid_response", details: text.slice(0, 800) };
  }

  return NextResponse.json(data, { status: res.status });
}

export async function POST(req: Request) {
  const env = requireEnv();
  if (!env.ok) return NextResponse.json({ error: env.error }, { status: 500 });

  const body = await req.text();

  const url = `${env.baseUrl.replace(/\/+$/, "")}/message-admin`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "x-admin-secret": env.adminSecret,
    },
    body,
  });

  const text = await res.text();
  let data: unknown = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: "invalid_response", details: text.slice(0, 800) };
  }

  return NextResponse.json(data, { status: res.status });
}

