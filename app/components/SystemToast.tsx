"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import dash from "../dashboard/dashboard.module.css";

type SystemToastTone = "success" | "error";

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

export default function SystemToast(props: { title: string; message: string; tone: SystemToastTone; onClose: () => void; actions?: ReactNode }) {
  const isSuccess = props.tone === "success";
  const rootRef = useRef<HTMLDivElement | null>(null);
  const closingRef = useRef(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

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
  return (
    <div ref={rootRef} className={`${dash.hideAlert} ${isSuccess ? dash.hideAlertShow : ""}`} role="alert" aria-live="assertive">
      <div className={dash.hideAlertLeading}>{isSuccess ? <IconSuccess /> : <IconError />}</div>
      <div className={dash.hideAlertBody}>
        <div className={dash.hideAlertTitleRow}>
          <span className={dash.hideAlertItemIcon}>
            <IconClipboard />
          </span>
          <span className={dash.hideAlertTitle}>{props.title}</span>
        </div>
        {props.message ? <div className={dash.hideAlertText}>{props.message}</div> : null}
        {props.actions ? <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>{props.actions}</div> : null}
      </div>
      <button type="button" className={dash.hideAlertClose} aria-label="Fechar alerta" onClick={handleClose}>
        ×
      </button>
    </div>
  );
}
