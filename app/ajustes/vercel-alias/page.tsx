import { Suspense } from "react";
import VercelAliasClient from "./VercelAliasClient";

export const dynamic = "force-dynamic";

export default function VercelAliasPage() {
  return (
    <Suspense fallback={<main className="cmv-container" />}>
      <VercelAliasClient />
    </Suspense>
  );
}

