import { Suspense } from "react";
import CadastroUsuarioClient from "./CadastroUsuarioClient";

export const dynamic = "force-dynamic";

export default function CadastroUsuarioPage() {
  return (
    <Suspense fallback={<main className="cmv-signup" />}>
      <CadastroUsuarioClient />
    </Suspense>
  );
}

