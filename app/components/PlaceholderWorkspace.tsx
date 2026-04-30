import AppSidebar from "./AppSidebar";
import dash from "../dashboard/dashboard.module.css";

export default function PlaceholderWorkspace({
  active,
  title,
  description,
}: {
  active:
    | "lista-compras"
    | "fichas-tecnicas"
    | "ajustes"
    | "suporte";
  title: string;
  description: string;
}) {
  return (
    <div className={dash.dashboard}>
      <AppSidebar active={active} />
      <main className={dash.content}>
        <div className={dash.pageFrame}>
          <section
            style={{
              background: "#ffffff",
              borderRadius: 16,
              padding: 24,
              border: "1px solid #e4e8e7",
              minHeight: 240,
            }}
          >
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#101214" }}>{title}</h1>
            <p style={{ margin: "10px 0 0", fontSize: 14, lineHeight: "22px", color: "#6f7c7a", maxWidth: 680 }}>Em construção</p>
          </section>
        </div>
      </main>
    </div>
  );
}
