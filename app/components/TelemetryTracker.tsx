"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

const keyName = "cmv_observability_session";
function sessionKey() {
  let value = sessionStorage.getItem(keyName);
  if (!value) { value = crypto.randomUUID(); sessionStorage.setItem(keyName, value); }
  return value;
}
function emit(payload: Record<string, unknown>, beacon = false) {
  const body = JSON.stringify({ ...payload, sessionKey: sessionKey() });
  if (beacon && navigator.sendBeacon) return void navigator.sendBeacon("/api/telemetry/event", new Blob([body], { type: "application/json" }));
  void fetch("/api/telemetry/event", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
}
export function trackAppAction(eventName: string, options: { target?: string; success?: boolean; durationMs?: number; metadata?: Record<string, unknown> } = {}) {
  emit({ category: "action", eventName, route: location.pathname, ...options });
}
export default function TelemetryTracker() {
  const pathname = usePathname();
  useEffect(() => {
    emit({ category: "session", eventName: "session_start", route: location.pathname, referrerHost: document.referrer ? new URL(document.referrer).host : "" });
    const heartbeat = window.setInterval(() => emit({ category: "session", eventName: "heartbeat", route: location.pathname }), 60_000);
    const onError = (event: ErrorEvent) => emit({ category: "error", eventName: "client_error", route: location.pathname, errorCode: event.error?.name ?? "Error", metadata: { message: String(event.message).slice(0, 180) } });
    const onReject = (event: PromiseRejectionEvent) => emit({ category: "error", eventName: "unhandled_rejection", route: location.pathname, metadata: { message: String(event.reason instanceof Error ? event.reason.message : event.reason).slice(0, 180) } });
    const onHide = () => emit({ category: "session", eventName: "session_end", route: location.pathname }, true);
    addEventListener("error", onError); addEventListener("unhandledrejection", onReject); addEventListener("pagehide", onHide);
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (nav) emit({ category: "performance", eventName: "page_load", route: location.pathname, durationMs: Math.round(nav.duration) });
    return () => { clearInterval(heartbeat); removeEventListener("error", onError); removeEventListener("unhandledrejection", onReject); removeEventListener("pagehide", onHide); };
  }, []);
  useEffect(() => { emit({ category: "navigation", eventName: "page_view", route: String(pathname ?? "/") }); }, [pathname]);
  return null;
}
