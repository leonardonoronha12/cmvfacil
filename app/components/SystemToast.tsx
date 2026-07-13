"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
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
  const closingRef = useRef(false);
  const [isMounted, setIsMounted] = useState(false);
  const autoCloseTimerRef = useRef<number | null>(null);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const progressAnimRef = useRef<Animation | null>(null);
  const loadingSvgElRef = useRef<SVGSVGElement | null>(null);
  const spinnerAnimRef = useRef<Animation | null>(null);
  const setLoadingSvgRef = (el: SVGSVGElement | null) => {
    loadingSvgElRef.current = el;
  };

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    closingRef.current = false;
  }, [props.title, props.message, props.tone, props.icon]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || !isMounted) return;
    try {
      el.animate(
        [
          { opacity: 0, transform: "translate3d(0,-10px,0) scale(0.98)" },
          { opacity: 1, transform: "translate3d(0,0,0) scale(1)" },
        ],
        { duration: 190, easing: "cubic-bezier(0.2, 0.9, 0.2, 1)", fill: "both" },
      );
    } catch {}
  }, [isMounted, props.title, props.message, props.tone]);

  useEffect(() => {
    spinnerAnimRef.current?.cancel();
    spinnerAnimRef.current = null;
    if (!isMounted || icon !== "loading") return;
    const el = loadingSvgElRef.current;
    if (!el) return;
    try {
      spinnerAnimRef.current = el.animate([{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }], {
        duration: 900,
        easing: "linear",
        iterations: Infinity,
      });
    } catch {}
  }, [icon, isMounted]);

  useEffect(() => {
    progressAnimRef.current?.cancel();
    progressAnimRef.current = null;
    if (!isMounted || autoCloseMs <= 0) return;
    const el = progressRef.current;
    if (!el) return;
    try {
      progressAnimRef.current = el.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], {
        duration: autoCloseMs,
        easing: "linear",
        fill: "both",
      });
    } catch {}
  }, [autoCloseMs, isMounted, props.title, props.message, props.tone, props.icon]);

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
    if (!isMounted || autoCloseMs <= 0) return;
    if (autoCloseTimerRef.current) window.clearTimeout(autoCloseTimerRef.current);
    autoCloseTimerRef.current = window.setTimeout(() => {
      autoCloseTimerRef.current = null;
      handleClose();
    }, autoCloseMs);
    return () => {
      if (autoCloseTimerRef.current) window.clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = null;
    };
  }, [autoCloseMs, isMounted, props.title, props.message, props.tone, props.icon]);

  return (
    <div ref={rootRef} className={`${dash.hideAlert} ${isSuccess ? dash.hideAlertShow : ""}`} role="alert" aria-live="assertive">
      <div className={dash.hideAlertLeading}>
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
