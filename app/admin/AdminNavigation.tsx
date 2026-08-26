"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./admin.module.css";

const items = [
  ["/admin/observabilidade", "▦", "Visão geral"],
  ["/admin/usuarios", "◎", "Acessar usuários"],
  ["/admin/observabilidade#geografia", "⌖", "Mapa e regiões"],
  ["/admin/observabilidade#atividade", "↗", "Atividade"],
  ["/admin/observabilidade#erros", "!", "Erros e desempenho"],
] as const;

export default function AdminNavigation() {
  const pathname = usePathname();
  return <aside className={styles.sidebar}>
    <div className={styles.brand}><span>cmv</span>fácil <small>ADMIN</small></div>
    <nav><p>MONITORAMENTO</p>{items.map(([href,icon,label])=><Link key={href} href={href} className={pathname===href.split("#")[0]?styles.active:""}><i>{icon}</i><span>{label}</span></Link>)}
      <p>FERRAMENTAS</p><Link href="/admin/importacao-manual"><i>⇧</i><span>Importação manual</span></Link><Link href="/admin/mensagens"><i>✉</i><span>Mensagens</span></Link>
    </nav>
    <div className={styles.sidebarFooter}><b>Painel global</b><span>Acesso restrito</span><Link href="/dashboard">← Voltar ao sistema</Link></div>
  </aside>;
}
