"use client";

export default function LoadingSpinner(props: { size?: number }) {
  const size = typeof props.size === "number" && props.size > 0 ? props.size : 26;
  return (
    <span className="cmv-inlineSpinner" role="status" aria-label="Carregando">
      <span className="cmv-loadingSpinner" style={{ width: size, height: size }} />
    </span>
  );
}
