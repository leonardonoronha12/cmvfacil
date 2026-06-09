import { Suspense } from "react";
import VercelCliClient from "./VercelCliClient";

export const dynamic = "force-dynamic";

export default function VercelCliPage() {
  return (
    <Suspense fallback={<main className="cmv-container" />}>
      <VercelCliClient />
    </Suspense>
  );
}

