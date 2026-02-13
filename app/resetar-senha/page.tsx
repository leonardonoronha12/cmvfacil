import { Suspense } from "react";
import ResetarSenhaClient from "./ResetarSenhaClient";

export const dynamic = "force-dynamic";

export default function ResetarSenhaPage() {
  return (
    <Suspense fallback={<main className="cmv-reset" />}>
      <ResetarSenhaClient />
    </Suspense>
  );
}

