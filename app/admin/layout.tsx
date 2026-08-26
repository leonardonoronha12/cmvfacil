import type { ReactNode } from "react";
import AdminNavigation from "./AdminNavigation";
import styles from "./admin.module.css";
export default function AdminLayout({children}:{children:ReactNode}){return <div className={styles.shell}><AdminNavigation/><div className={styles.content}>{children}</div></div>}
