"use client";

import dynamic from "next/dynamic";
import dash from "../dashboard/dashboard.module.css";

const InventarioClient = dynamic(() => import("./InventarioClient"), {
  ssr: false,
  loading: () => (
    <main className={dash.content} aria-busy="true" aria-label="Abrindo Inventário">
      <div className={dash.pageFrame}>
        <div style={{ display: "grid", gridTemplateColumns: "235px 1fr", gap: 18, minHeight: 520 }}>
          <section style={{ borderRadius: 18, background: "#fff", padding: 16, boxShadow: "0 1px 0 rgba(0,57,63,.08)" }}>
            <div style={{ height: 42, borderRadius: 12, background: "linear-gradient(90deg,#dcece8,#eff7f4,#dcece8)", backgroundSize: "200% 100%" }} />
            <div style={{ height: 14, width: "62%", marginTop: 22, borderRadius: 8, background: "#e3eeeb" }} />
            <div style={{ height: 38, marginTop: 14, borderRadius: 12, background: "#edf4f2" }} />
          </section>
          <section style={{ borderRadius: 18, background: "#fff", padding: 20, boxShadow: "0 1px 0 rgba(0,57,63,.08)" }}>
            <div style={{ height: 24, width: "38%", borderRadius: 9, background: "#dce9e6" }} />
            <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
              <div style={{ height: 44, flex: 1, borderRadius: 12, background: "#edf4f2" }} />
              <div style={{ height: 44, width: 220, borderRadius: 12, background: "#edf4f2" }} />
            </div>
            <div style={{ height: 310, marginTop: 18, borderRadius: 16, background: "linear-gradient(135deg,#f3f8f6,#e6f0ed)" }} />
            <p style={{ margin: "18px 0 0", color: "#527071", fontWeight: 700 }}>Abrindo seu Inventário…</p>
          </section>
        </div>
      </div>
    </main>
  ),
});

export default function InventarioPageClient() {
  return <InventarioClient />;
}
