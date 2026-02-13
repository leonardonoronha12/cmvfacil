import { Suspense } from "react";
import DashboardClient from "./DashboardClient";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  return (
    <Suspense fallback={<main style={{ minHeight: "100vh" }} />}>
      <DashboardClient />
    </Suspense>
  );
}

