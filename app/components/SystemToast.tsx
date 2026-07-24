"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import dash from "../dashboard/dashboard.module.css";

type SystemToastTone = "success" | "error";
type SystemToastIcon = "success" | "error" | "loading";

function IconSuccess() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9.25" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8.5 12L11 14.5L15.5 9.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconError() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9.25" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9 9L15 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M15 9L9 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconLoading(props: { svgRef: React.Ref<SVGSVGElement> }) {
  return (
    <svg ref={props.svgRef} width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9.25" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.8" />
      <path d="M21.25 12a9.25 9.25 0 0 0-9.25-9.25" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconClipboard() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8.25 5.25H15.75V20.25H8.25V5.25Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M9.75 3.75H14.25V6H9.75V3.75Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M10.5 10.5H13.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M10.5 14.25H13.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export default function SystemToast(props: {
  title: string;
  message: string;
  tone: SystemToastTone;
  onClose: () => void;
  actions?: ReactNode;
  icon?: SystemToastIcon;
  durationMs?: number;
}) {
  const isSuccess = props.tone === "success";
  const icon = props.icon ?? (isSuccess ? "success" : "error");
  const autoCloseMs = typeof props.durationMs === "number" && Number.isFinite(props.durationMs) ? Math.max(0, props.durationMs) : 0;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const leadingRef = useRef<HTMLDivElement | null>(null);
  const closingRef = useRef(false);
  const autoCloseTimerRef = useRef<number | null>(null);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const progressAnimRef = useRef<Animation | null>(null);
  const loadingSvgElRef = useRef<SVGSVGElement | null>(null);
  const spinnerAnimRef = useRef<Animation | null>(null);
  const enterAnimRef = useRef<Animation | null>(null);
  const pulseAnimRef = useRef<Animation | null>(null);
  const leadingAnimRef = useRef<Animation | null>(null);
  const setLoadingSvgRef = (el: SVGSVGElement | null) => {
    loadingSvgElRef.current = el;
  };

  useEffect(() => {
    closingRef.current = false;
  }, [props.title, props.message, props.tone, props.icon]);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    enterAnimRef.current?.cancel();
    try {
      enterAnimRef.current = el.animate(
        [
          { opacity: 1, transform: "translate3d(0,-14px,0) scale(0.94)" },
          { opacity: 1, transform: "translate3d(0,0,0) scale(1.02)", offset: 0.72 },
          { opacity: 1, transform: "translate3d(0,0,0) scale(1)" },
        ],
        { duration: 260, easing: "cubic-bezier(0.2, 0.9, 0.2, 1)", fill: "both" },
      );
    } catch {}
    return () => {
      enterAnimRef.current?.cancel();
      enterAnimRef.current = null;
    };
  }, [props.title, props.message, props.tone, props.icon]);

  useLayoutEffect(() => {
    if (props.tone !== "error") return;
    const el = rootRef.current;
    if (!el) return;
    const t = window.setTimeout(() => {
      try {
        el.animate(
          [
            { transform: "translate3d(0,0,0)" },
            { transform: "translate3d(-6px,0,0)" },
            { transform: "translate3d(6px,0,0)" },
            { transform: "translate3d(-4px,0,0)" },
            { transform: "translate3d(4px,0,0)" },
            { transform: "translate3d(0,0,0)" },
          ],
          { duration: 240, easing: "cubic-bezier(0.2, 0.9, 0.2, 1)", fill: "both" },
        );
      } catch {}
    }, 170);
    return () => window.clearTimeout(t);
  }, [props.title, props.message, props.tone, props.icon]);

  useLayoutEffect(() => {
    leadingAnimRef.current?.cancel();
    leadingAnimRef.current = null;
    if (icon !== "success") return;
    const el = leadingRef.current;
    if (!el) return;
    try {
      leadingAnimRef.current = el.animate(
        [
          { transform: "scale(0.88)" },
          { transform: "scale(1.08)", offset: 0.7 },
          { transform: "scale(1)" },
        ],
        { duration: 240, easing: "cubic-bezier(0.2, 0.9, 0.2, 1)", fill: "both" },
      );
    } catch {}
  }, [icon, props.title, props.message, props.tone]);

  useEffect(() => {
    spinnerAnimRef.current?.cancel();
    spinnerAnimRef.current = null;
    if (icon !== "loading") return;
    const el = loadingSvgElRef.current;
    if (!el) return;
    try {
      spinnerAnimRef.current = el.animate([{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }], {
        duration: 900,
        easing: "linear",
        iterations: Infinity,
      });
    } catch {}
  }, [icon]);

  useEffect(() => {
    pulseAnimRef.current?.cancel();
    pulseAnimRef.current = null;
    if (icon !== "loading") return;
    const el = rootRef.current;
    if (!el) return;
    try {
      pulseAnimRef.current = el.animate(
        [
          { boxShadow: "0 8px 22px rgba(19, 25, 33, 0.16)" },
          { boxShadow: "0 14px 34px rgba(19, 25, 33, 0.24)" },
        ],
        { duration: 900, easing: "ease-in-out", direction: "alternate", iterations: Infinity },
      );
    } catch {}
    return () => {
      pulseAnimRef.current?.cancel();
      pulseAnimRef.current = null;
    };
  }, [icon, props.title, props.message, props.tone]);

  useEffect(() => {
    progressAnimRef.current?.cancel();
    progressAnimRef.current = null;
    if (autoCloseMs <= 0) return;
    const el = progressRef.current;
    if (!el) return;
    try {
      progressAnimRef.current = el.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], {
        duration: autoCloseMs,
        easing: "linear",
        fill: "both",
      });
    } catch {}
  }, [autoCloseMs, props.title, props.message, props.tone, props.icon]);

  function handleClose() {
    const el = rootRef.current;
    if (!el) {
      props.onClose();
      return;
    }
    if (closingRef.current) return;
    closingRef.current = true;
    try {
      const anim = el.animate(
        [
          { opacity: 1, transform: "translate3d(0,0,0) scale(1)" },
          { opacity: 0, transform: "translate3d(0,-10px,0) scale(0.98)" },
        ],
        { duration: 150, easing: "cubic-bezier(0.2, 0.9, 0.2, 1)", fill: "both" },
      );
      anim.addEventListener("finish", () => props.onClose(), { once: true });
      setTimeout(() => props.onClose(), 220);
    } catch {
      props.onClose();
    }
  }

  useEffect(() => {
    if (autoCloseMs <= 0) return;
    if (autoCloseTimerRef.current) window.clearTimeout(autoCloseTimerRef.current);
    autoCloseTimerRef.current = window.setTimeout(() => {
      autoCloseTimerRef.current = null;
      handleClose();
    }, autoCloseMs);
    return () => {
      if (autoCloseTimerRef.current) window.clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = null;
    };
  }, [autoCloseMs, props.title, props.message, props.tone, props.icon]);

  return (
    <div
      ref={rootRef}
      className={`${dash.hideAlert} ${isSuccess ? dash.hideAlertShow : ""}`}
      role="alert"
      aria-live="assertive"
      style={{ willChange: "transform, opacity, box-shadow" }}
    >
      <div ref={leadingRef} className={dash.hideAlertLeading} style={{ willChange: "transform" }}>
        {icon === "loading" ? <IconLoading svgRef={setLoadingSvgRef} /> : icon === "success" ? <IconSuccess /> : <IconError />}
      </div>
      <div className={dash.hideAlertBody}>
        <div className={dash.hideAlertTitleRow}>
          <span className={dash.hideAlertItemIcon}>
            <IconClipboard />
          </span>
          <span className={dash.hideAlertTitle}>{props.title}</span>
        </div>
        {props.message ? <div className={dash.hideAlertText}>{props.message}</div> : null}
        {autoCloseMs > 0 ? (
          <div
            style={{
              marginTop: 10,
              height: 3,
              borderRadius: 999,
              background: isSuccess ? "rgba(0,169,157,0.16)" : "rgba(239,46,46,0.16)",
              overflow: "hidden",
            }}
          >
            <div ref={progressRef} style={{ height: "100%", width: "100%", background: "currentColor", transformOrigin: "left center" }} />
          </div>
        ) : null}
        {props.actions ? <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>{props.actions}</div> : null}
      </div>
      <button type="button" className={dash.hideAlertClose} aria-label="Fechar alerta" onClick={handleClose}>
        ×
      </button>
    </div>
  );
}
