"use client";

import dash from "../dashboard/dashboard.module.css";

export default function LoadingSpinner(props: { size?: number }) {
  const size = typeof props.size === "number" && props.size > 0 ? props.size : 26;
  return <div className={dash.loadingSpinner} style={{ width: size, height: size }} role="status" aria-label="Carregando" />;
}

