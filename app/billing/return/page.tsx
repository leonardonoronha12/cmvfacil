import { Suspense } from "react";
import BillingReturnClient from "./BillingReturnClient";

export const dynamic = "force-dynamic";

export default function BillingReturnPage() {
  return (
    <Suspense fallback={<main style={{ minHeight: "100vh" }} />}>
      <BillingReturnClient />
    </Suspense>
  );
}

