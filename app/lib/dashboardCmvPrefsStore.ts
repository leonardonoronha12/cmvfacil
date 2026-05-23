"use client";

export type DashboardCmvPrefs = {
  startDate: string;
  endDate: string;
  revenue: string;
  targetCmv: string;
};

let cache: DashboardCmvPrefs = { startDate: "", endDate: "", revenue: "", targetCmv: "" };

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
  return cache;
}

export function writeDashboardCmvPrefsToStore(prefs: DashboardCmvPrefs) {
  if (typeof window === "undefined") return;
  const normalized = normalize(prefs);
  cache = normalized;
}
