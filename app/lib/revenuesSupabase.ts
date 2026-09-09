"use client";

export type RevenueSuggestion = { value: number; periods: number; exact: boolean };

export async function loadRevenueSuggestion(startDate: string, endDate: string): Promise<RevenueSuggestion> {
  const params = new URLSearchParams({ startDate, endDate, ts: String(Date.now()) });
  const response = await fetch(`/api/revenues?${params}`, { cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) throw new Error(data?.error || "Não foi possível carregar o faturamento.");
  return { value: Number(data.value || 0), periods: Number(data.periods || 0), exact: Boolean(data.exact) };
}

export async function saveRevenuePeriod(startDate: string, endDate: string, value: number) {
  const response = await fetch("/api/revenues", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ startDate, endDate, value }) });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) throw new Error(data?.error || "Não foi possível salvar o faturamento.");
}
