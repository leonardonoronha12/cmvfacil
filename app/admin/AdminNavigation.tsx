"use client";
import Link from "next/link";
import {usePathname} from "next/navigation";
import styles from "./admin.module.css";
const monitoring=[["/admin/observabilidade","▦","Visão geral"],["/admin/usuarios","◎","Acessar usuários"],["/admin/cadastros","⇄","Cadastros e migração"],["/admin/geografia","⌖","Mapa e regiões"],["/admin/atividade","↗","Atividade"],["/admin/erros","!","Erros e desempenho"]] as const;
const tools=[["/admin/importacao-manual","⇧","Importação manual"],["/admin/mensagens","✉","Mensagens"]] as const;
export default function AdminNavigation(){const pathname=usePathname();const link=([href,icon,label]:readonly [string,string,string])=><Link key={href} href={href} className={pathname===href?styles.active:""}><i>{icon}</i><span>{label}</span></Link>;return <aside className={styles.sidebar}><div className={styles.brand}><b><span>cmv</span>fácil</b><small>ADMIN</small></div><nav aria-label="Menu administrativo"><p>MONITORAMENTO</p>{monitoring.map(link)}<p>FERRAMENTAS</p>{tools.map(link)}</nav><div className={styles.sidebarFooter}><b>Painel global</b><span>Acesso restrito a administradores</span><Link href="/dashboard">← Voltar ao sistema</Link></div></aside>}
