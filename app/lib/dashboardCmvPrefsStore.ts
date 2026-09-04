"use client";

export type DashboardCmvPrefs = {
  startDate: string;
  endDate: string;
  revenue: string;
  targetCmv: string;
};

let cache: DashboardCmvPrefs = { startDate: "", endDate: "", revenue: "", targetCmv: "" };
const STORAGE_KEY = "cmvfacil:dashboardCmvPrefs";
const PERIOD_REVENUE_KEY = "cmvfacil:dashboardRevenueByPeriod:v1";

function periodKey(startDate: string, endDate: string) {
  const start = String(startDate ?? "").trim();
  const end = String(endDate ?? "").trim();
  return start && end ? `${start}::${end}` : "";
}

export function readDashboardRevenueForPeriod(startDate: string, endDate: string): string {
  if (typeof window === "undefined") return "";
  const key = periodKey(startDate, endDate);
  if (!key) return "";
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PERIOD_REVENUE_KEY) || "{}") as Record<string, unknown>;
    return String(parsed[key] ?? "").trim();
  } catch {
    return "";
  }
}

export function writeDashboardRevenueForPeriod(startDate: string, endDate: string, revenue: string) {
  if (typeof window === "undefined") return;
  const key = periodKey(startDate, endDate);
  if (!key) return;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PERIOD_REVENUE_KEY) || "{}") as Record<string, unknown>;
    parsed[key] = String(revenue ?? "").trim();
    window.localStorage.setItem(PERIOD_REVENUE_KEY, JSON.stringify(parsed));
  } catch {}
}

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
