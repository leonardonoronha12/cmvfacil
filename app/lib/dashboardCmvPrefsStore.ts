"use client";

export type DashboardCmvPrefs = {
  startDate: string;
  endDate: string;
  revenue: string;
  targetCmv: string;
};

let cache: DashboardCmvPrefs = { startDate: "", endDate: "", revenue: "", targetCmv: "" };
const STORAGE_KEY = "cmvfacil:dashboardCmvPrefs";

function normalize(input: unknown): DashboardCmvPrefs {
  if (!input || typeof input !== "object") return { startDate: "", endDate: "", revenue: "", targetCmv: "" };
  const r = input as Record<string, unknown>;
  return {
    startDate: String(r.startDate ?? "").trim(),
    endDate: String(r.endDate ?? "").trim(),
    revenue: String(r.revenue ?? "").trim(),
    targetCmv: String(r.targetCmv ?? "").trim(),
  };
}

export function readDashboardCmvPrefsFromStore(): DashboardCmvPrefs {
  if (typeof window !== "undefined") {
    try {
      if (!cache.startDate && !cache.endDate && !cache.revenue && !cache.targetCmv) {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) cache = normalize(JSON.parse(raw) as unknown);
      }
    } catch {}
  }
  return cache;
}

export function writeDashboardCmvPrefsToStore(prefs: DashboardCmvPrefs) {
  if (typeof window === "undefined") return;
  const normalized = normalize(prefs);
  cache = normalized;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  } catch {}
}
