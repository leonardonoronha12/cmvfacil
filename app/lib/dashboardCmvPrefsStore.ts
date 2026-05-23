"use client";

export type DashboardCmvPrefs = {
  startDate: string;
  endDate: string;
  revenue: string;
  targetCmv: string;
};

const KEY = "cmvfacil.dashboard.cmv_prefs.v1";

function safeParse(json: string | null): unknown {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
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
  if (typeof window === "undefined") return { startDate: "", endDate: "", revenue: "", targetCmv: "" };
  return normalize(safeParse(window.localStorage.getItem(KEY)));
}

export function writeDashboardCmvPrefsToStore(prefs: DashboardCmvPrefs) {
  if (typeof window === "undefined") return;
  const normalized = normalize(prefs);
  window.localStorage.setItem(KEY, JSON.stringify(normalized));
}

