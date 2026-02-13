import { NextResponse } from "next/server";

function getEnv(name: string) {
  const v = (process.env[name] ?? "").trim();
  return v || null;
}

export async function GET() {
  const urlCandidates = [
    "SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_FUNCTIONS_BASE_URL",
  ] as const;
  const anonCandidates = [
    "SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_ANON_PUBLIC_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_PUBLIC_KEY",
    "NEXT_PUBLIC_SUPABASE_KEY",
    "SUPABASE_KEY",
  ] as const;

  const present = (name: string) => Boolean(getEnv(name));

  const foundUrl = (getEnv("SUPABASE_URL") ?? getEnv("NEXT_PUBLIC_SUPABASE_URL"))?.trim() || null;
  const derivedUrl = getEnv("SUPABASE_FUNCTIONS_BASE_URL")?.replace(/\/functions\/v1\/?$/, "") ?? null;
  const resolvedUrl = foundUrl ?? derivedUrl ?? null;

  const resolvedAnon =
    getEnv("SUPABASE_ANON_KEY") ??
    getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY") ??
    getEnv("SUPABASE_ANON_PUBLIC_KEY") ??
    getEnv("NEXT_PUBLIC_SUPABASE_ANON_PUBLIC_KEY") ??
    getEnv("NEXT_PUBLIC_SUPABASE_KEY") ??
    getEnv("SUPABASE_KEY") ??
    null;

  return NextResponse.json(
    {
      ok: true,
      url: {
        resolved: Boolean(resolvedUrl),
        from: foundUrl ? "SUPABASE_URL|NEXT_PUBLIC_SUPABASE_URL" : derivedUrl ? "SUPABASE_FUNCTIONS_BASE_URL" : null,
        candidates: Object.fromEntries(urlCandidates.map((n) => [n, present(n)])),
      },
      anonKey: {
        resolved: Boolean(resolvedAnon),
        candidates: Object.fromEntries(anonCandidates.map((n) => [n, present(n)])),
      },
    },
    { status: 200 },
  );
}

