"use client";

export type MeProfile = {
  userId: string;
  email: string;
  nome: string;
  sobrenome: string;
  nomeCompleto: string;
  whatsapp: string;
  avatarUrl: string;
  companyName: string;
};

let state: MeProfile | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of Array.from(listeners)) {
    try {
      l();
    } catch {}
  }
}

function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function readLocal(): MeProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem("cmvfacil:me:v1");
    if (!raw) return null;
    const parsed = safeJsonParse<MeProfile>(raw);
    if (!parsed) return null;
    if (!parsed.userId || !parsed.email) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeLocal(next: MeProfile | null) {
  if (typeof window === "undefined") return;
  try {
    if (!next) {
      window.localStorage.removeItem("cmvfacil:me:v1");
      return;
    }
    window.localStorage.setItem("cmvfacil:me:v1", JSON.stringify(next));
  } catch {}
}

export function readMeFromStore() {
  if (state) return state;
  const local = readLocal();
  if (local) {
    state = local;
    return local;
  }
  return null;
}

export function writeMeToStore(next: MeProfile | null) {
  state = next;
  writeLocal(next);
  emit();
}

export function subscribeMe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

let loading: Promise<MeProfile | null> | null = null;

export async function loadMeFromApi() {
  if (typeof window === "undefined") return null;
  if (loading) return loading;
  loading = (async () => {
    try {
      const res = await fetch(`/api/me?ts=${Date.now()}`, { method: "GET", cache: "no-store" });
      const j = (await res.json().catch(() => null)) as any;
      if (!res.ok || !j?.ok) throw new Error(String(j?.error ?? `failed_${res.status}`));
      const next: MeProfile = {
        userId: String(j.userId ?? "").trim(),
        email: String(j.email ?? "").trim(),
        nome: String(j.nome ?? "").trim(),
        sobrenome: String(j.sobrenome ?? "").trim(),
        nomeCompleto: String(j.nomeCompleto ?? "").trim(),
        whatsapp: String(j.whatsapp ?? "").trim(),
        avatarUrl: String(j.avatarUrl ?? "").trim(),
        companyName: String(j.companyName ?? "").trim(),
      };
      if (next.userId && next.email) writeMeToStore(next);
      return next;
    } catch {
      return readMeFromStore();
    } finally {
      loading = null;
    }
  })();
  return loading;
}
