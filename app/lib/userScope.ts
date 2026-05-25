"use client";

let inflight: Promise<string | null> | null = null;

export async function getUserIdFromApi(): Promise<string | null> {
  if (inflight) return inflight;
  inflight = (async () => {
    const res = await fetch("/api/auth/me", { method: "GET" });
    const json = (await res.json().catch(() => null)) as { userId?: string | null } | null;
    const userId = (json?.userId ?? null) as string | null;
    return userId ? String(userId).trim() : null;
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

export async function buildUserScopedId(rawId: string) {
  const userId = await getUserIdFromApi();
  if (!userId) throw new Error("unauthorized");
  const base = String(rawId ?? "").trim();
  if (!base) throw new Error("invalid_id");
  if (base.startsWith(`user:${userId}:`)) return base;
  return `user:${userId}:${base}`;
}

export async function requireUserScopePrefix() {
  const userId = await getUserIdFromApi();
  if (!userId) throw new Error("unauthorized");
  return `user:${userId}:`;
}
