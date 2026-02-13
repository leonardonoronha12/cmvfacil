import { Suspense } from "react";
import SetupSupabaseClient from "./SetupSupabaseClient";

export const dynamic = "force-dynamic";

export default function SetupSupabasePage() {
  return (
    <Suspense fallback={<main className="cmv-container" />}>
      <SetupSupabaseClient />
    </Suspense>
  );
}

