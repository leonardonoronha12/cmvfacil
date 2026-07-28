import dynamic from "next/dynamic";

const EntradasClient = dynamic(() => import("./EntradasClient"), { ssr: false });

export default function EntradasPage() {
  return <EntradasClient />;
}
