import { Suspense } from "react";
import InsumosClient from "./InsumosClient";

export const dynamic = "force-dynamic";

export default function InsumosPage() {
  return (
    <Suspense fallback={<main style={{ minHeight: "100vh" }} />}>
      <InsumosClient />
    </Suspense>
  );
}

