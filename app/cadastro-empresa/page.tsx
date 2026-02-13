import { Suspense } from "react";
import CadastroEmpresaClient from "./CadastroEmpresaClient";

export const dynamic = "force-dynamic";

export default function CadastroEmpresaPage() {
  return (
    <Suspense fallback={<main className="cmv-company" />}>
      <CadastroEmpresaClient />
    </Suspense>
  );
}

