import { Suspense } from "react";
import VercelCliClient from "./VercelCliClient";

export const dynamic = "force-dynamic";

export default function VercelCliPage() {
  if (process.env.NODE_ENV === "production") {
    return (
      <main className="cmv-container">
        <header className="cmv-header">
          <div>
            <h1 className="cmv-title">Deploy via Vercel CLI</h1>
            <div className="cmv-subtitle">Esta página só funciona no localhost.</div>
          </div>
        </header>
        <section className="cmv-card">
          <div className="cmv-alert cmv-alert-error">Abra em http://localhost:3000/ajustes/vercel-cli</div>
        </section>
      </main>
    );
  }
  return (
    <Suspense fallback={<main className="cmv-container" />}>
      <VercelCliClient />
    </Suspense>
  );
}
