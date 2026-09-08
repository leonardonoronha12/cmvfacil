"use client";

import { clearClientData } from "./clearClientData";

export type MeProfile = {
  userId: string;
  email: string;
  nome: string;
  sobrenome: string;
  nomeCompleto: string;
  whatsapp: string;
  avatarUrl: string;
  companyId: string;
  companyName: string;
  companyLogoUrl: string;
  companyCnpj: string;
  companyEmail: string;
  companyWhatsapp: string;
  companyIndustry: string;
  role: "Administrador" | "Colaborador";
  planType: string;
  planStatus: string;
  cardLast4: string;
  members: Array<{ name: string; email: string; role: "Administrador" | "Colaborador"; joinedAt: string; avatarUrl: string }>;
  companies: Array<{ id: string; name: string; logoUrl: string; role: "Administrador" | "Colaborador" }>;
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
    const raw = window.localStorage.getItem("cmvfacil:me:v2");
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
      window.localStorage.removeItem("cmvfacil:me:v2");
      return;
    }
    window.localStorage.setItem("cmvfacil:me:v2", JSON.stringify(next));
  } catch {}
}

export function clearMeStore() {
  writeMeToStore(null);
  try {
    clearClientData();
  } catch {}
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem("cmvfacil.cmvreal.lastcalc.v1");
    window.localStorage.removeItem("cmvfacil.cmvreal.snapshot.v1");
    window.localStorage.removeItem("cmvfacil:bubbleSyncStatePath");
    window.localStorage.removeItem("cmvfacil:bubbleImportAsUserId");
  } catch {}
  try {
    window.sessionStorage.removeItem("cmvfacil:bootstrap:v1:lastRunMs");
    window.sessionStorage.removeItem("cmvfacil:bootstrapRunning:v5");
    window.sessionStorage.removeItem("cmvfacil:bootstrapDone:v5");
    window.sessionStorage.removeItem("cmvfacil:profile-selected:v1");
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
      const authRes = await fetch(`/api/auth/me?ts=${Date.now()}`, { method: "GET", cache: "no-store" });
      const authJson = (await authRes.json().catch(() => null)) as any;
      const sessionUserId = String(authJson?.userId ?? "").trim();
      if (!sessionUserId) {
        clearMeStore();
        return null;
      }
      const prev = readMeFromStore();
      if (prev?.userId && prev.userId !== sessionUserId) clearMeStore();

      const res = await fetch(`/api/me?ts=${Date.now()}`, { method: "GET", cache: "no-store" });
      const j = (await res.json().catch(() => null)) as any;
      if (!res.ok || !j?.ok) {
        const keep = prev && prev.userId === sessionUserId ? prev : null;
        if (!keep) clearMeStore();
        return keep;
      }
      const next: MeProfile = {
        userId: String(j.userId ?? "").trim(),
        email: String(j.email ?? "").trim(),
        nome: String(j.nome ?? "").trim(),
        sobrenome: String(j.sobrenome ?? "").trim(),
        nomeCompleto: String(j.nomeCompleto ?? "").trim(),
        whatsapp: String(j.whatsapp ?? "").trim(),
        avatarUrl: String(j.avatarUrl ?? "").trim(),
        companyId: String((j.source as any)?.companyId ?? (j as any)?.companyId ?? "").trim(),
        companyName: String(j.companyName ?? "").trim(),
        companyLogoUrl: String(j.companyLogoUrl ?? "").trim(),
        companyCnpj: String(j.companyCnpj ?? "").trim(),
        companyEmail: String(j.companyEmail ?? "").trim(),
        companyWhatsapp: String(j.companyWhatsapp ?? "").trim(),
        companyIndustry: String(j.companyIndustry ?? "").trim(),
        role: String(j.role ?? "").trim() === "Administrador" ? "Administrador" : "Colaborador",
        planType: String(j.plan?.type ?? j.planType ?? "").trim(),
        planStatus: String(j.plan?.status ?? j.planStatus ?? "").trim(),
        cardLast4: String(j.plan?.cardLast4 ?? j.cardLast4 ?? "").trim(),
        members: Array.isArray(j.members)
          ? (j.members as any[]).map((m) => ({
              name: String(m?.name ?? "").trim(),
              email: String(m?.email ?? "").trim(),
              role: String(m?.role ?? "").trim() === "Administrador" ? "Administrador" : "Colaborador",
              joinedAt: String(m?.joinedAt ?? "").trim(),
              avatarUrl: String(m?.avatarUrl ?? "").trim(),
            }))
          : [],
        companies: Array.isArray(j.companies)
          ? (j.companies as any[]).map((company) => ({
              id: String(company?.id ?? "").trim(),
              name: String(company?.name ?? "").trim() || "Empresa",
              logoUrl: String(company?.logoUrl ?? company?.logo_url ?? "").trim(),
              role: (String(company?.role ?? "").trim() === "Administrador" ? "Administrador" : "Colaborador") as "Administrador" | "Colaborador",
            })).filter((company) => Boolean(company.id))
          : [],
      };
      if (next.userId && next.userId !== sessionUserId) {
        clearMeStore();
        return null;
      }
      if (next.userId && next.email) writeMeToStore(next);
      return next;
    } catch {
      clearMeStore();
      return null;
    } finally {
      loading = null;
    }
  })();
  return loading;
}
