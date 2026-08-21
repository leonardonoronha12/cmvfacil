"use client";

const PREFIX = "cmvfacil:table-cache:v1";

function cacheScope() {
  if (typeof window === "undefined") return "";
  try {
    const raw = window.localStorage.getItem("cmvfacil:me:v2");
    const me = raw ? (JSON.parse(raw) as { userId?: string; companyId?: string }) : null;
    return String(me?.companyId || me?.userId || "").trim();
  } catch {
    return "";
  }
}

function key(name: string) {
  const scope = cacheScope();
  return scope ? `${PREFIX}:${scope}:${name}` : "";
}

export function readTableCache<T>(name: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const storageKey = key(name);
  if (!storageKey) return fallback;
  try {
    const raw = window.localStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeTableCache<T>(name: string, value: T) {
  if (typeof window === "undefined") return;
  const storageKey = key(name);
  if (!storageKey) return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {}
}

export function clearTableCaches() {
  if (typeof window === "undefined") return;
  try {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const storageKey = window.localStorage.key(index);
      if (storageKey?.startsWith(`${PREFIX}:`)) keys.push(storageKey);
    }
    for (const storageKey of keys) window.localStorage.removeItem(storageKey);
  } catch {}
}
