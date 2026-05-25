import AppSidebar from "../components/AppSidebar";
import dash from "../dashboard/dashboard.module.css";

export const dynamic = "force-dynamic";

export default function AjustesPage() {
  return (
    <div className={dash.dashboard}>
      <AppSidebar active="ajustes" />
      <main className={dash.content}>
        <div className={dash.pageFrame}>
          <section style={{ background: "#ffffff", borderRadius: 16, padding: 24, border: "1px solid #e4e8e7" }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#101214" }}>Ajustes</h1>
            <p style={{ margin: "10px 0 0", fontSize: 14, lineHeight: "22px", color: "#6f7c7a", maxWidth: 680 }}>
              Configurações e páginas administrativas.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginTop: 18 }}>
              <a
                href="/ajustes/modelos-importacao"
                style={{
                  display: "block",
                  textDecoration: "none",
                  border: "1px solid #e4e8e7",
                  borderRadius: 14,
                  padding: 16,
                  color: "#101214",
                }}
              >
                <div style={{ fontWeight: 900 }}>Modelos de Importação</div>
                <div style={{ marginTop: 8, color: "#6f7c7a", fontSize: 13 }}>
                  Enviar os modelos (.csv/.xlsx) usados nos botões de download do modal de importação.
                </div>
              </a>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
