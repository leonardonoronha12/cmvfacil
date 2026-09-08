import type { Metadata } from "next";
import TermsOfUseDocument from "../components/TermsOfUseDocument";

export const metadata: Metadata = {
  title: "Termos de Uso | CMV Fácil",
  description: "Termos de Uso do CMV Fácil, versão 1.0.",
  alternates: { canonical: "https://cmvfacil.app/termos-de-uso" },
  robots: { index: true, follow: true },
};

export default function Page() {
  return <TermsOfUseDocument />;
}
