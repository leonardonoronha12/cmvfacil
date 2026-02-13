import { NextRequest, NextResponse } from "next/server";

function requestOrigin(req: NextRequest) {
  const origin = (req.headers.get("origin") ?? "").trim();
  if (origin) return origin;
  const proto = (req.headers.get("x-forwarded-proto") ?? "").trim();
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").trim();
  if (proto && host) return `${proto}://${host}`;
  return "";
}

export async function GET(req: NextRequest) {
  const baseSiteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim();
  const origin = requestOrigin(req);
  const siteUrl = origin || baseSiteUrl || "";
  const redirectTo = siteUrl ? `${siteUrl.replace(/\/+$/, "")}/restaurar-senha` : null;

  return NextResponse.json(
    {
      ok: true,
      siteUrl: {
        resolved: Boolean(siteUrl),
        value_source: origin ? "request" : baseSiteUrl ? "NEXT_PUBLIC_SITE_URL" : null,
      },
      redirectTo,
    },
    { status: 200 },
  );
}

