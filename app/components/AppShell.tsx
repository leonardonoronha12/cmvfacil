"use client";

import type { ReactNode } from "react";
import { useMemo } from "react";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import dash from "../dashboard/dashboard.module.css";

const AppSidebar = dynamic(() => import("./AppSidebar"), { ssr: false });
const ProfileChooser = dynamic(() => import("./ProfileChooser"), { ssr: false });
const MigrationExperience = dynamic(() => import("./MigrationExperience"), { ssr: false });

type SidebarKey =
  | "dashboard"
  | "lista-compras"
  | "fichas-tecnicas"
  | "insumos"
  | "pre-preparo"
  | "fornecedores"
  | "entradas"
  | "inventario"
  | "desperdicios"
  | "consumo-interno"
  | "ajustes"
  | "suporte";

function shouldHideSidebar(pathname: string) {
  const p = pathname.trim() || "/";
  if (p === "/" || p.startsWith("/login") || p.startsWith("/cadastro") || p.startsWith("/resetar-senha") || p.startsWith("/restaurar-senha")) return true;
  if (p.startsWith("/termos-de-uso")) return true;
  if (p.startsWith("/setup-supabase") || p.startsWith("/debug-supabase") || p.startsWith("/debug")) return true;
  return false;
}

function activeKeyFromPathname(pathname: string): SidebarKey {
  const p = pathname.trim() || "/";
  if (p.startsWith("/lista-de-compras")) return "lista-compras";
  if (p.startsWith("/fichas-tecnicas")) return "fichas-tecnicas";
  if (p.startsWith("/insumos")) return "insumos";
  if (p.startsWith("/pre-preparo")) return "pre-preparo";
  if (p.startsWith("/fornecedores")) return "fornecedores";
  if (p.startsWith("/entradas")) return "entradas";
  if (p.startsWith("/inventario")) return "inventario";
  if (p.startsWith("/desperdicios")) return "desperdicios";
  if (p.startsWith("/consumo-interno")) return "consumo-interno";
  if (p.startsWith("/ajustes")) return "ajustes";
  if (p.startsWith("/suporte")) return "suporte";
  return "dashboard";
}

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const hide = useMemo(() => shouldHideSidebar(String(pathname ?? "")), [pathname]);
  const active = useMemo(() => activeKeyFromPathname(String(pathname ?? "")), [pathname]);

  if (hide) return <>{children}</>;

  return (
    <div className={dash.dashboard}>
      <ProfileChooser />
      <AppSidebar active={active} />
      {children}
      <MigrationExperience />
    </div>
  );
}

