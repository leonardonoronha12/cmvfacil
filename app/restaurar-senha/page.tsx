import { Suspense } from "react";
import RestaurarSenhaClient from "./restaurarSenhaClient";

export const dynamic = "force-dynamic";

export default function RestaurarSenhaPage() {
  return (
    <Suspense fallback={<main className="cmv-reset" />}>
      <RestaurarSenhaClient />
    </Suspense>
  );
}

