import { Suspense } from "react";
import DebugSupabaseClient from "./DebugSupabaseClient";

export const dynamic = "force-dynamic";

export default function DebugSupabasePage() {
  return (
    <Suspense fallback={<main className="cmv-container" />}>
      <DebugSupabaseClient />
    </Suspense>
  );
}

