"use client";

import { useMemo, useState } from "react";
import styles from "./dashboard.module.css";

type Row = {
  index: number;
  item: string;
  initial: string;
  entradas: string;
  final: string;
  saidas: string;
  custo: string;
  cmv: string;
  cmvTone: "red" | "yellow" | "green";
};

type PieSlice = {
  label: string;
  value: number;
  color: string;
};

const toneColors = {
  green: "#0ab86d",
  greenDark: "#059e5d",
  red: "#ff2f54",
  yellow: "#fbbf24",
  blue: "#3b82f6",
  purple: "#a855f7",
  pink: "#ec4899",
  mint: "#14b8a6",
  lime: "#84cc16",
  orange: "#f97316",
} as const;

const legendItems = [
  { label: "Queijos e Laticínios", tone: "green" },
  { label: "Conservas/Enlatados/Grãos/Outros", tone: "greenDark" },
  { label: "Proteínas/ Embutidos", tone: "red" },
  { label: "Legumes/ Verduras/ Temperos/ Congelados", tone: "yellow" },
  { label: "Molhos e Base", tone: "blue" },
  { label: "Embalagens/ Descartáveis/ Outros", tone: "purple" },
  { label: "Doces", tone: "pink" },
  { label: "Massas e Base", tone: "mint" },
  { label: "Bebidas", tone: "lime" },
  { label: "Frete", tone: "orange" },
] as const;

const pieValues = [14, 8, 12, 2, 3, 42, 2, 5, 18, 2] as const;
const pieData: PieSlice[] = legendItems.map((it, i) => ({
  label: it.label,
  value: pieValues[i] ?? 1,
  color: toneColors[it.tone],
}));

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function fmt(n: number) {
  return Number(n.toFixed(6));
}

function donutPath(cx: number, cy: number, rOuter: number, rInner: number, startAngle: number, endAngle: number) {
  const startOuter = polarToCartesian(cx, cy, rOuter, startAngle);
  const endOuter = polarToCartesian(cx, cy, rOuter, endAngle);
  const startInner = polarToCartesian(cx, cy, rInner, endAngle);
  const endInner = polarToCartesian(cx, cy, rInner, startAngle);

  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return [
    `M ${fmt(startOuter.x)} ${fmt(startOuter.y)}`,
    `A ${fmt(rOuter)} ${fmt(rOuter)} 0 ${largeArc} 1 ${fmt(endOuter.x)} ${fmt(endOuter.y)}`,
    `L ${fmt(startInner.x)} ${fmt(startInner.y)}`,
    `A ${fmt(rInner)} ${fmt(rInner)} 0 ${largeArc} 0 ${fmt(endInner.x)} ${fmt(endInner.y)}`,
    "Z",
  ].join(" ");
}

function PieChart({ slices, size = 220 }: { slices: PieSlice[]; size?: number }) {
  const view = 240;
  const cx = view / 2;
  const cy = view / 2;
  const rOuter = 92;
  const rInner = 44;
  const total = slices.reduce((acc, s) => acc + s.value, 0) || 1;

  let start = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${view} ${view}`} role="img" aria-label="Distribuição por categoria">
      <g>
        {slices.map((s) => {
          const sweep = (s.value / total) * 360;
          const end = start + sweep;
          const d = donutPath(cx, cy, rOuter, rInner, start, end);
          start = end;
          return <path key={s.label} d={d} fill={s.color} stroke="#f1f3f3" strokeWidth="2" />;
        })}
      </g>
      <circle cx={cx} cy={cy} r={rInner} fill="#f1f3f3" />
    </svg>
  );
}

const rows: Row[] = Array.from({ length: 16 }).map((_, i) => {
  const cmvTone: Row["cmvTone"] = i < 3 ? "red" : i < 10 ? "yellow" : "green";
  return {
    index: i + 1,
    item: "{Nome do Item}",
    initial: "100,00",
    entradas: "500,00",
    final: "80,00",
    saidas: "520,00",
    custo: "R$2,16",
    cmv: "R$1.123,26",
    cmvTone,
  };
});

export default function DashboardClient() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [revenue, setRevenue] = useState("");
  const [targetCmv, setTargetCmv] = useState("");

  const chartSlices = useMemo(() => {
    const order = [
      "Queijos e Laticínios",
      "Conservas/Enlatados/Grãos/Outros",
      "Proteínas/ Embutidos",
      "Legumes/ Verduras/ Temperos/ Congelados",
      "Frete",
      "Embalagens/ Descartáveis/ Outros",
      "Doces",
      "Molhos e Base",
      "Massas e Base",
      "Bebidas",
    ];
    const byLabel = new Map(pieData.map((s) => [s.label, s] as const));
    return order.map((l) => byLabel.get(l)).filter((v): v is PieSlice => Boolean(v));
  }, []);

  return (
    <div className={styles.dashboard}>
      <aside className={styles.menuLateral}>
        <div className={styles.menuTop}>
          <div className={styles.brand}>
            <img src="/dashboard/ml7hdudz-jry958l.svg" alt="CMV Fácil" className={styles.brandImg} />
          </div>

          <div className={styles.companyCard}>
            <div className={styles.companyAvatar} aria-hidden />
            <div className={styles.companyMeta}>
              <p className={styles.companyName}>Nome da Empresa</p>
              <p className={styles.companyPlan}>PRO</p>
            </div>
          </div>

          <button type="button" className={styles.primaryBtn}>
            <img src="/dashboard/ml7hdudz-6qw4osi.svg" className={styles.primaryBtnIcon} alt="" />
            Nova Contagem
          </button>

          <div className={styles.group}>
            <p className={styles.groupTitle}>Relatório</p>
            <a className={`${styles.navItem} ${styles.navItemActive}`} href="/dashboard">
              <img src="/dashboard/ml7hdudz-z2dzc40.svg" className={styles.navIcon} alt="" />
              CMV Real
            </a>
          </div>

          <div className={styles.group}>
            <p className={styles.groupTitle}>Cadastros</p>
            <a className={styles.navItem} href="/insumos">
              <img src="/dashboard/ml7hdudz-f06j0dk.svg" className={styles.navIcon} alt="" />
              Insumos
            </a>
            <a className={styles.navItem} href="/fornecedores">
              <img src="/dashboard/ml7hdudz-xapr7wq.svg" className={styles.navIcon} alt="" />
              Fornecedores
            </a>
          </div>

          <div className={styles.group}>
            <p className={styles.groupTitle}>Rotina</p>
            <a className={styles.navItem} href="#">
              <img src="/dashboard/ml7hdudz-ul1u5or.svg" className={styles.navIcon} alt="" />
              Entradas
            </a>
            <a className={styles.navItem} href="#">
              <img src="/dashboard/ml7hdudz-q3mw2yd.svg" className={styles.navIcon} alt="" />
              Inventário
            </a>
            <a className={styles.navItem} href="#">
              <img src="/dashboard/ml7hdudz-8091yrv.svg" className={styles.navIcon} alt="" />
              Listas de Compras
            </a>
          </div>

          <div className={styles.group}>
            <p className={styles.groupTitle}>Ajuda</p>
            <a className={styles.navItem} href="#">
              <img src="/dashboard/ml7hdudz-csojjx2.svg" className={styles.navIcon} alt="" />
              Ajustes
            </a>
            <a className={styles.navItem} href="#">
              <img src="/dashboard/ml7hdudz-osfwhe6.svg" className={styles.navIcon} alt="" />
              Suporte
            </a>
          </div>
        </div>

        <div className={styles.menuBottom}>
          <div className={styles.usersActiveCard}>
            <div className={styles.usersActiveRow}>
              <img src="/dashboard/ml7hdudz-j3gj37b.svg" className={styles.usersActiveIcon} alt="" />
              <p className={styles.usersActiveText}>Usuários Ativos (3 de 5)</p>
            </div>
            <div className={styles.progress}>
              <div className={styles.progressOn} />
              <div className={styles.progressOff} />
            </div>
          </div>

          <button type="button" className={styles.userDropdown}>
            <div className={styles.userLeft}>
              <div className={styles.userAvatar} aria-hidden />
              <p className={styles.userHello}>Olá, Ramon</p>
            </div>
            <img src="/dashboard/ml7hdudz-89hevuh.svg" className={styles.userChevron} alt="" />
          </button>
        </div>
      </aside>

      <main className={styles.content}>
        <section className={styles.topSection}>
          <div className={styles.topBar}>
            <div className={styles.topField}>
              <span className={styles.topLabel}>Data Inicial:</span>
              <input className={styles.topInput} type="date" value={startDate} max={endDate || undefined} onChange={(e) => setStartDate(e.target.value)} />
            </div>

            <div className={styles.topField}>
              <span className={styles.topLabel}>Data Final:</span>
              <input className={styles.topInput} type="date" value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)} />
            </div>

            <div className={styles.topField}>
              <span className={styles.topLabel}>Faturamento:</span>
              <input className={styles.topInput} inputMode="decimal" placeholder="R$0,00" value={revenue} onChange={(e) => setRevenue(e.target.value)} />
            </div>

            <div className={styles.topField}>
              <span className={styles.topLabel}>CMV Meta:</span>
              <input className={styles.topInput} inputMode="decimal" placeholder="30,00%" value={targetCmv} onChange={(e) => setTargetCmv(e.target.value)} />
            </div>

            <button type="button" className={styles.topAction}>
              Calcular CMV
            </button>
          </div>

          <div className={styles.topHint}>
            Selecione o período, insira o faturamento referente a essas datas e defina a meta de CMV. Em seguida, clique
            em Calcular CMV.
          </div>
        </section>

        <section className={styles.detailsSection}>
          <div className={styles.detailsTitleRow}>
            <div className={styles.detailsIcon}>
              <img src="/dashboard/ml7hdudz-vztdpis.svg" className={styles.detailsIconImg} alt="" />
            </div>
            <p className={styles.detailsTitle}>Detalhes do seu CMV Real</p>
          </div>

          <div className={styles.detailsCards}>
            <div className={styles.cmvCard}>
              <p className={styles.cmvCardLabel}>SEU CMV REAL</p>
              <p className={styles.cmvCardValue}>0,0%</p>
            </div>

            <div className={styles.deltaCard}>
              <p className={styles.deltaValue}>0,0% p.p. abaixo da meta</p>
              <a className={styles.deltaLink} href="#">
                Ver variação de custo dos insumos
              </a>
            </div>

            <div className={styles.chartCard}>
              <div className={styles.chartArea}>
                <PieChart slices={chartSlices} />
              </div>
              <div className={styles.chartLegend}>
                {legendItems.map((it) => (
                  <div key={it.label} className={styles.legendItem}>
                    <span className={`${styles.legendSwatch} ${styles[`legendSwatch_${it.tone}`]}`} aria-hidden />
                    <span className={styles.legendLabel}>{it.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section style={{ display: "flex", flexDirection: "column", gap: 24, width: "100%" }}>
          <div className={styles.summaryHeader}>
            <div className={styles.pillIcon}>
              <img src="/dashboard/ml7hdudz-vztdpis.svg" className={styles.usersActiveIcon} alt="" />
            </div>
            <p className={styles.summaryTitle}>Descubra o CMV de cada item</p>

            <div className={styles.summarySpacer} />
          </div>

          <div className={styles.cardsRow}>
            <div className={styles.statCard}>
              <div className={styles.statIconGreen}>
                <img src="/dashboard/ml7hdudz-0d96ct3.svg" className={styles.primaryBtnIcon} alt="" />
              </div>
              <div className={styles.statText}>
                <p className={styles.statValue}>R$20.000,00</p>
                <p className={styles.statLabel}>TOTAL ENTRADAS</p>
              </div>
            </div>

            <div className={styles.statCard}>
              <div className={styles.statIconRed}>
                <img src="/dashboard/ml7hdudz-wlqqtxp.svg" className={styles.primaryBtnIcon} alt="" />
              </div>
              <div className={styles.statText}>
                <p className={styles.statValue}>R$6.500,00</p>
                <p className={styles.statLabel}>TOTAL SAÍDAS</p>
              </div>
            </div>

            <div className={styles.statCard}>
              <div className={styles.statIconBlue}>
                <img src="/dashboard/ml7hdudz-vztdpis.svg" className={styles.primaryBtnIcon} alt="" />
              </div>
              <div className={styles.statText}>
                <p className={styles.statValue}>R$50.000,00</p>
                <p className={styles.statLabel}>FATURAMENTO</p>
              </div>
            </div>

            <div className={styles.statCardDark}>
              <div className={styles.statIconDark}>
                <img src="/dashboard/ml7hdudz-fsi5mff.svg" className={styles.primaryBtnIcon} alt="" />
              </div>
              <div className={styles.statText}>
                <p className={styles.statValueDark}>32,50%</p>
                <p className={styles.statLabelDark}>CMV DO PERÍODO</p>
              </div>
            </div>
          </div>

          <div className={styles.discoverFilters}>
            <div className={styles.searchBox}>
              <img src="/dashboard/ml7hdudz-0yzzssc.svg" className={styles.searchIcon} alt="" />
              <input className={styles.searchInput} placeholder="Pesquise por itens..." />
            </div>
            <div className={styles.categoryBox}>
              <select className={styles.categorySelect} defaultValue="">
                <option value="" disabled>
                  Categorias
                </option>
                <option value="todas">Todas</option>
              </select>
            </div>
          </div>

          <div className={styles.tableWrapper}>
            <div className={styles.tableHeader}>
              <div className={styles.thGroup}>
                <div className={styles.thCellSmall}>#</div>
                <div className={styles.thCellItem}>Item</div>
              </div>
              <div className={styles.thCell}>Estoque Inicial</div>
              <div className={styles.thCell}>Entradas</div>
              <div className={styles.thCell}>Estoque Final</div>
              <div className={styles.thCell}>Saídas</div>
              <div className={styles.thCell}>Custo Médio</div>
              <div className={styles.thCell}>CMV%</div>
            </div>

            {rows.map((r) => (
              <div key={r.index} className={styles.tableRow}>
                <div className={styles.rowGroup}>
                  <div className={styles.rowIndex} style={r.index === 16 ? { color: "#ff2f54" } : undefined}>
                    {r.index}
                  </div>
                  <div className={styles.rowItem}>{r.item}</div>
                </div>
                <div className={styles.rowCell}>{r.initial}</div>
                <div className={styles.rowCell}>{r.entradas}</div>
                <div className={styles.rowCell}>{r.final}</div>
                <div className={styles.rowCellBold}>{r.saidas}</div>
                <div className={styles.rowCellBold}>{r.custo}</div>
                <div
                  className={
                    r.cmvTone === "red"
                      ? styles.rowCmvRed
                      : r.cmvTone === "yellow"
                        ? styles.rowCmvYellow
                        : styles.rowCmvGreen
                  }
                >
                  {r.cmv}
                </div>
              </div>
            ))}
          </div>
        </section>

        <div style={{ height: 72, width: "100%" }} />
      </main>
    </div>
  );
}
