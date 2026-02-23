"use client";

import { useMemo, useRef, useState } from "react";
import dash from "../dashboard/dashboard.module.css";
import styles from "./fornecedores.module.css";

type FornecedorRow = {
  id: string;
  fornecedor: string;
  itens: number;
  vendedorNome: string;
  whatsapp: string;
  endereco: string;
};

const initialRows: FornecedorRow[] = [
  { id: "1", fornecedor: "Bem Bom Pescado", itens: 1, vendedorNome: "-", whatsapp: "6281118754", endereco: "Rod Go 080" },
  { id: "2", fornecedor: "Coca Cola", itens: 7, vendedorNome: "-", whatsapp: "6299813573", endereco: "Av servio Tulio Jaime 1600 Residencial ipanema" },
  { id: "3", fornecedor: "Embalagens Bahia", itens: 22, vendedorNome: "-", whatsapp: "6230983577", endereco: "Rua rui barbosa" },
  { id: "4", fornecedor: "JBS", itens: 4, vendedorNome: "-", whatsapp: "(62) 99269-5448", endereco: "Av lago Azul s/n Fazenda Caveira" },
  { id: "5", fornecedor: "São Salvador Alimentos Sa", itens: 5, vendedorNome: "-", whatsapp: "(62) 99288-3079", endereco: "Rodovia Go 222 Zona Rural" },
];

function IconBox() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 2 3.5 6.75v10.5L12 22l8.5-4.75V6.75L12 2Zm0 2.3 6.2 3.45L12 11.2 5.8 7.75 12 4.3Zm-6.7 5.1L11 12.6v7.1l-5.7-3.2V9.4Zm13.4 0v7.1L13 19.7v-7.1l5.7-3.2Z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M10.5 3a7.5 7.5 0 1 1 4.6 13.4l4.3 4.3-1.4 1.4-4.3-4.3A7.5 7.5 0 0 1 10.5 3Zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconUpload() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 7 8l1.4 1.4L11 6.8V15h2V6.8l2.6 2.6L17 8l-5-5Z" fill="currentColor" />
      <path d="M5 19h14v2H5v-2Z" fill="currentColor" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M11 5h2v14h-2V5Z" fill="currentColor" />
      <path d="M5 11h14v2H5v-2Z" fill="currentColor" />
    </svg>
  );
}

function IconEdit() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 17.3V20h2.7l9.9-9.9-2.7-2.7L4 17.3Zm16.8-10.8a.75.75 0 0 0 0-1.1l-2.2-2.2a.75.75 0 0 0-1.1 0l-1.7 1.7 3.3 3.3 1.7-1.7Z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M9 3h6l1 2h4v2H4V5h4l1-2Zm1 7h2v9h-2v-9Zm4 0h2v9h-2v-9ZM6 8h12l-1 13H7L6 8Z"
        fill="currentColor"
      />
    </svg>
  );
}

function SortIcon({ dir }: { dir: "asc" | "desc" }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
      {dir === "asc" ? <path d="M7 14 12 9l5 5H7Z" fill="currentColor" /> : <path d="M7 10h10l-5 5-5-5Z" fill="currentColor" />}
    </svg>
  );
}

type ColumnKey = "fornecedor" | "itens" | "whatsapp" | "endereco";

function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}+/gu, "")
    .replace(/\s+/g, " ");
}

function parseCsvLine(line: string, delimiter: "," | ";") {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] ?? "";
    if (ch === '"') {
      const next = line[i + 1] ?? "";
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && ch === delimiter) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map((c) => c.trim());
}

function parseSupplierRowsFromTable(table: unknown[][]) {
  const safe = table.filter((r) => Array.isArray(r) && r.some((c) => String(c ?? "").trim() !== ""));
  if (!safe.length) return [];

  const header = safe[0] ?? [];
  const headerMap = new Map<string, number>();
  header.forEach((h, i) => {
    const key = normalizeHeader(h);
    if (!key) return;
    if (!headerMap.has(key)) headerMap.set(key, i);
  });

  const hasHeader = ["fornecedor", "fornecedores", "supplier"].some((k) => headerMap.has(k));
  const startIndex = hasHeader ? 1 : 0;

  let idxFornecedor = 0;
  let idxItens = -1;
  let idxVendedorNome = -1;
  let idxWhatsapp = -1;
  let idxEndereco = -1;

  if (hasHeader) {
    idxFornecedor = headerMap.get("fornecedor") ?? headerMap.get("fornecedores") ?? 0;
    idxItens = headerMap.get("itens") ?? headerMap.get("items") ?? -1;
    idxEndereco = headerMap.get("endereco") ?? headerMap.get("endereço") ?? headerMap.get("address") ?? -1;

    const whatsappKey =
      headerMap.get("whatsapp") ?? headerMap.get("telefone") ?? headerMap.get("celular") ?? headerMap.get("phone") ?? null;
    const vendedorNomeKey =
      headerMap.get("contato") ??
      headerMap.get("nome vendedor") ??
      headerMap.get("vendedor nome") ??
      headerMap.get("vendedor_nome") ??
      null;

    if (whatsappKey !== null) {
      idxWhatsapp = whatsappKey;
      idxVendedorNome = vendedorNomeKey ?? (headerMap.get("vendedor") ?? -1);
    } else {
      idxWhatsapp = headerMap.get("vendedor") ?? -1;
      idxVendedorNome = vendedorNomeKey ?? -1;
    }
  } else {
    const sample = safe[startIndex] ?? [];
    idxFornecedor = 0;
    if (sample.length >= 4) {
      idxItens = 1;
      idxWhatsapp = 2;
      idxEndereco = 3;
    } else if (sample.length === 3) {
      idxWhatsapp = 1;
      idxEndereco = 2;
    } else if (sample.length === 2) {
      idxEndereco = 1;
    }
  }

  const out: FornecedorRow[] = [];
  for (let i = startIndex; i < safe.length; i++) {
    const row = safe[i] ?? [];
    const fornecedor = String(row[idxFornecedor] ?? "").trim();
    if (!fornecedor) continue;
    const itensRaw = idxItens >= 0 ? String(row[idxItens] ?? "").trim() : "";
    const itens = itensRaw ? Number.parseInt(itensRaw.replace(/[^\d]/g, "") || "0", 10) : 0;
    const vendedorNome = idxVendedorNome >= 0 ? String(row[idxVendedorNome] ?? "").trim() || "-" : "-";
    const whatsapp = idxWhatsapp >= 0 ? String(row[idxWhatsapp] ?? "").trim() || "-" : "-";
    const endereco = idxEndereco >= 0 ? String(row[idxEndereco] ?? "").trim() || "-" : "-";
    out.push({
      id: String(out.length + 1),
      fornecedor,
      itens: Number.isFinite(itens) ? itens : 0,
      vendedorNome,
      whatsapp,
      endereco,
    });
  }
  return out;
}

export default function FornecedoresClient() {
  const [rows, setRows] = useState<FornecedorRow[]>(initialRows);
  const [query, setQuery] = useState("");

  const [sortKey, setSortKey] = useState<null | ColumnKey>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [columnOrder, setColumnOrder] = useState<ColumnKey[]>(["fornecedor", "itens", "whatsapp", "endereco"]);
  const [draggingColumn, setDraggingColumn] = useState<null | ColumnKey>(null);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftFornecedor, setDraftFornecedor] = useState("");
  const [draftVendedorNome, setDraftVendedorNome] = useState("");
  const [draftWhatsapp, setDraftWhatsapp] = useState("");
  const [draftEndereco, setDraftEndereco] = useState("");

  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteName, setDeleteName] = useState("");

  const [isImportOpen, setIsImportOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function toggleSort(key: ColumnKey) {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
      return;
    }
    if (sortDir === "asc") {
      setSortDir("desc");
      return;
    }
    setSortKey(null);
    setSortDir("asc");
  }

  function onColumnDrop(target: ColumnKey) {
    if (!draggingColumn || draggingColumn === target) return;
    setColumnOrder((prev) => {
      const from = prev.indexOf(draggingColumn);
      const to = prev.indexOf(target);
      if (from === -1 || to === -1) return prev;
      const next = [...prev];
      next.splice(from, 1);
      next.splice(to, 0, draggingColumn);
      return next;
    });
    setDraggingColumn(null);
  }

  const gridTemplateColumns = useMemo(() => {
    const widths: Record<ColumnKey | "acoes", string> = {
      fornecedor: "2fr",
      itens: "0.7fr",
      whatsapp: "1fr",
      endereco: "1.5fr",
      acoes: "120px",
    };
    return [...columnOrder, "acoes"].map((k) => widths[k as keyof typeof widths]).join(" ");
  }, [columnOrder]);

  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? rows.filter((r) => `${r.fornecedor} ${r.vendedorNome} ${r.whatsapp} ${r.endereco}`.toLowerCase().includes(q))
      : rows;
    if (!sortKey) return filtered;

    const decorated = filtered.map((r, i) => ({ r, i }));
    const dir = sortDir === "asc" ? 1 : -1;
    const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

    decorated.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "itens") {
        cmp = a.r.itens === b.r.itens ? 0 : a.r.itens < b.r.itens ? -1 : 1;
      } else {
        cmp = collator.compare(String(a.r[sortKey] ?? ""), String(b.r[sortKey] ?? ""));
      }
      if (!cmp) cmp = a.i - b.i;
      return cmp * dir;
    });

    return decorated.map((d) => d.r);
  }, [query, rows, sortDir, sortKey]);

  function openNew() {
    setEditingId(null);
    setDraftFornecedor("");
    setDraftVendedorNome("");
    setDraftWhatsapp("");
    setDraftEndereco("");
    setIsFormOpen(true);
  }

  function openEdit(row: FornecedorRow) {
    setEditingId(row.id);
    setDraftFornecedor(row.fornecedor);
    setDraftVendedorNome(row.vendedorNome === "-" ? "" : row.vendedorNome);
    setDraftWhatsapp(row.whatsapp === "-" ? "" : row.whatsapp);
    setDraftEndereco(row.endereco);
    setIsFormOpen(true);
  }

  function saveForm() {
    const fornecedor = draftFornecedor.trim();
    if (!fornecedor) return;
    const vendedorNome = draftVendedorNome.trim() || "-";
    const whatsapp = draftWhatsapp.trim() || "-";
    const endereco = draftEndereco.trim() || "-";

    if (!editingId) {
      setRows((prev) => [{ id: String(prev.length + 1), fornecedor, itens: 0, vendedorNome, whatsapp, endereco }, ...prev]);
      setIsFormOpen(false);
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === editingId ? { ...r, fornecedor, vendedorNome, whatsapp, endereco } : r)));
    setIsFormOpen(false);
    setEditingId(null);
  }

  function openDelete(row: FornecedorRow) {
    setDeleteId(row.id);
    setDeleteName(row.fornecedor);
    setIsDeleteOpen(true);
  }

  function confirmDelete() {
    const id = deleteId;
    if (!id) return;
    setRows((prev) => prev.filter((r) => r.id !== id));
    setIsDeleteOpen(false);
    setDeleteId(null);
    setDeleteName("");
  }

  const resultsText = `${visibleRows.length} resultado(s) encontrado(s)`;

  async function importFile(file: File) {
    if (importing) return;
    setImportError(null);
    setImporting(true);
    try {
      const name = file.name.toLowerCase();
      let table: unknown[][] = [];

      if (name.endsWith(".csv")) {
        const text = await file.text();
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
        const first = lines[0] ?? "";
        const delimiter: "," | ";" = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ";" : ",";
        table = lines.map((l) => parseCsvLine(l, delimiter));
      } else if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
        const XLSX = await import("xlsx");
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const sheetName = wb.SheetNames[0] ?? "";
        const ws = sheetName ? wb.Sheets[sheetName] : null;
        if (!ws) throw new Error("Planilha inválida.");
        table = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as unknown[][];
      } else {
        throw new Error("Formato não suportado. Use .xlsx, .xls ou .csv");
      }

      const imported = parseSupplierRowsFromTable(table);
      if (!imported.length) throw new Error("Nenhum fornecedor encontrado na planilha.");
      setRows(imported);
      setIsImportOpen(false);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
      setDragOver(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className={dash.dashboard}>
      <aside className={dash.menuLateral}>
        <div className={dash.menuTop}>
          <div className={dash.brand}>
            <img src="/dashboard/ml7hdudz-jry958l.svg" alt="CMV Fácil" className={dash.brandImg} />
          </div>

          <div className={dash.companyCard}>
            <div className={dash.companyAvatar} aria-hidden />
            <div className={dash.companyMeta}>
              <p className={dash.companyName}>Nome da Empresa</p>
              <p className={dash.companyPlan}>PRO</p>
            </div>
          </div>

          <button type="button" className={dash.primaryBtn}>
            <img src="/dashboard/ml7hdudz-6qw4osi.svg" className={dash.primaryBtnIcon} alt="" />
            Nova Contagem
          </button>

          <div className={dash.group}>
            <p className={dash.groupTitle}>Relatório</p>
            <a className={dash.navItem} href="/dashboard">
              <img src="/dashboard/ml7hdudz-z2dzc40.svg" className={dash.navIcon} alt="" />
              CMV Real
            </a>
          </div>

          <div className={dash.group}>
            <p className={dash.groupTitle}>Cadastros</p>
            <a className={dash.navItem} href="/insumos">
              <img src="/dashboard/ml7hdudz-f06j0dk.svg" className={dash.navIcon} alt="" />
              Insumos
            </a>
            <a className={`${dash.navItem} ${dash.navItemActive}`} href="/fornecedores">
              <img src="/dashboard/ml7hdudz-xapr7wq.svg" className={dash.navIcon} alt="" />
              Fornecedores
            </a>
          </div>

          <div className={dash.group}>
            <p className={dash.groupTitle}>Rotina</p>
            <a className={dash.navItem} href="#">
              <img src="/dashboard/ml7hdudz-ul1u5or.svg" className={dash.navIcon} alt="" />
              Entradas
            </a>
            <a className={dash.navItem} href="#">
              <img src="/dashboard/ml7hdudz-q3mw2yd.svg" className={dash.navIcon} alt="" />
              Inventário
            </a>
            <a className={dash.navItem} href="#">
              <img src="/dashboard/ml7hdudz-8091yrv.svg" className={dash.navIcon} alt="" />
              Listas de Compras
            </a>
          </div>

          <div className={dash.group}>
            <p className={dash.groupTitle}>Ajuda</p>
            <a className={dash.navItem} href="#">
              <img src="/dashboard/ml7hdudz-csojjx2.svg" className={dash.navIcon} alt="" />
              Ajustes
            </a>
            <a className={dash.navItem} href="#">
              <img src="/dashboard/ml7hdudz-osfwhe6.svg" className={dash.navIcon} alt="" />
              Suporte
            </a>
          </div>
        </div>

        <div className={dash.menuBottom}>
          <div className={dash.usersActiveCard}>
            <div className={dash.usersActiveRow}>
              <img src="/dashboard/ml7hdudz-j3gj37b.svg" className={dash.usersActiveIcon} alt="" />
              <p className={dash.usersActiveText}>Usuários Ativos (3 de 5)</p>
            </div>
            <div className={dash.progress}>
              <div className={dash.progressOn} />
              <div className={dash.progressOff} />
            </div>
          </div>

          <button type="button" className={dash.userDropdown}>
            <div className={dash.userLeft}>
              <div className={dash.userAvatar} aria-hidden />
              <p className={dash.userHello}>Olá, Ramon</p>
            </div>
            <img src="/dashboard/ml7hdudz-89hevuh.svg" className={dash.userChevron} alt="" />
          </button>
        </div>
      </aside>

      <main className={dash.content}>
        <section className={styles.header}>
          <div className={styles.headerIcon}>
            <IconBox />
          </div>
          <div className={styles.headerText}>
            <h1 className={styles.title}>Fornecedores</h1>
            <p className={styles.subtitle}>Consulte e cadastre fornecedores, além dos produtos que cada um vende.</p>
          </div>
        </section>

        <section className={styles.toolbar}>
          <div className={styles.search}>
            <span className={styles.searchIcon}>
              <IconSearch />
            </span>
            <input
              className={styles.searchInput}
              placeholder="Pesquise por fornecedor..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.importBtn}
              onClick={() => {
                setImportError(null);
                setIsImportOpen(true);
              }}
            >
              <IconUpload />
              Importar
            </button>
            <button type="button" className={styles.newBtn} onClick={openNew}>
              <IconPlus />
              Novo Fornecedor
            </button>
          </div>
        </section>

        <div className={styles.tableWrap}>
          <section className={styles.table}>
            <div className={styles.tableHead} style={{ gridTemplateColumns }}>
              {columnOrder.map((col) => {
                const label = col === "fornecedor" ? "Fornecedor" : col === "itens" ? "Itens" : col === "whatsapp" ? "Vendedor" : "Endereço";
                return (
                  <div
                    key={col}
                    className={`${styles.th} ${styles.thDraggable}`}
                    draggable
                    onDragStart={(e) => {
                      setDraggingColumn(col);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", col);
                    }}
                    onDragEnd={() => setDraggingColumn(null)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => onColumnDrop(col)}
                  >
                    <button type="button" className={styles.thBtn} onClick={() => toggleSort(col)}>
                      {label} {sortKey === col ? <SortIcon dir={sortDir} /> : null}
                    </button>
                  </div>
                );
              })}
              <div className={styles.thActions}>Ações</div>
            </div>

            {visibleRows.map((r) => (
              <div key={r.id} className={styles.tr} style={{ gridTemplateColumns }}>
                {columnOrder.map((col) => {
                  if (col === "fornecedor") {
                    return (
                      <div key={col} className={styles.supplierCell}>
                        <span className={styles.supplierIcon} aria-hidden>
                          <IconBox />
                        </span>
                        <span className={styles.supplierName}>{r.fornecedor}</span>
                      </div>
                    );
                  }
                  if (col === "itens") return <div key={col} className={styles.td}>{`${r.itens} item${r.itens === 1 ? "" : "s"}`}</div>;
                  if (col === "whatsapp")
                    return (
                      <div key={col} className={styles.td}>
                        {r.whatsapp && r.whatsapp !== "-" ? <span className={styles.vendorLink}>{r.whatsapp}</span> : <span className={styles.tdMuted}>-</span>}
                        {r.vendedorNome && r.vendedorNome !== "-" ? <div className={styles.vendorMuted}>{r.vendedorNome}</div> : null}
                      </div>
                    );
                  return (
                    <div key={col} className={styles.tdMuted}>
                      {r.endereco || "-"}
                    </div>
                  );
                })}

                <div className={styles.tdActions}>
                  <button type="button" className={styles.iconBtn} aria-label="Editar" onClick={() => openEdit(r)}>
                    <IconEdit />
                  </button>
                  <button type="button" className={styles.iconBtn} aria-label="Excluir" onClick={() => openDelete(r)}>
                    <IconTrash />
                  </button>
                </div>
              </div>
            ))}
          </section>
        </div>

        <div className={styles.footer}>
          <div>{resultsText}</div>
          <div className={styles.pagination}>
            <button type="button" className={styles.pageBtn} disabled aria-label="Primeira página">
              «
            </button>
            <button type="button" className={styles.pageBtn} disabled aria-label="Página anterior">
              ‹
            </button>
            <div className={styles.pageInfo}>1 de 1</div>
            <button type="button" className={styles.pageBtn} disabled aria-label="Próxima página">
              ›
            </button>
            <button type="button" className={styles.pageBtn} disabled aria-label="Última página">
              »
            </button>
          </div>
        </div>

        {isFormOpen ? (
          <div className={styles.modalOverlay} role="presentation" onClick={() => setIsFormOpen(false)}>
            <div className={styles.modal} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitle}>{editingId ? "Editar Fornecedor" : "Cadastro de Fornecedor"}</div>
                <button type="button" className={styles.modalClose} aria-label="Fechar" onClick={() => setIsFormOpen(false)}>
                  ×
                </button>
              </div>

              <div className={styles.formBody}>
                <div className={styles.formField}>
                  <div className={styles.formLabel}>Nome do Fornecedor</div>
                  <input
                    className={styles.formInput}
                    placeholder="Ex: Mercado X"
                    value={draftFornecedor}
                    onChange={(e) => setDraftFornecedor(e.target.value)}
                  />
                </div>

                <div className={styles.formRow2}>
                  <div className={styles.formField}>
                    <div className={styles.formLabel}>Vendedor</div>
                    <input
                      className={styles.formInput}
                      placeholder="Ex: João Silva"
                      value={draftVendedorNome}
                      onChange={(e) => setDraftVendedorNome(e.target.value)}
                    />
                  </div>

                  <div className={styles.formField}>
                    <div className={styles.formLabel}>WhatsApp</div>
                    <div className={styles.prefixWrap}>
                      <div className={styles.prefixBox}>+55</div>
                      <div className={styles.prefixInputWrap}>
                        <input
                          className={styles.prefixInput}
                          placeholder="(00) 00000-0000"
                          inputMode="tel"
                          value={draftWhatsapp}
                          onChange={(e) => setDraftWhatsapp(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className={styles.formField}>
                  <div className={styles.formLabel}>Endereço</div>
                  <input
                    className={styles.formInput}
                    placeholder="Ex: rua x, bairro y"
                    value={draftEndereco}
                    onChange={(e) => setDraftEndereco(e.target.value)}
                  />
                </div>
              </div>

              <div className={styles.modalFooter}>
                <button
                  type="button"
                  className={styles.modalPrimaryWide}
                  onClick={saveForm}
                  disabled={!draftFornecedor.trim() || !draftVendedorNome.trim() || !draftWhatsapp.trim() || !draftEndereco.trim()}
                >
                  Salvar
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {isDeleteOpen ? (
          <div className={styles.modalOverlay} role="presentation" onClick={() => setIsDeleteOpen(false)}>
            <div className={styles.modal} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitle}>Excluir Fornecedor?</div>
                <button type="button" className={styles.modalClose} aria-label="Fechar" onClick={() => setIsDeleteOpen(false)}>
                  ×
                </button>
              </div>

              <div className={styles.confirmBody}>
                <div className={styles.confirmIcon}>
                  <IconTrash />
                </div>
                <div className={styles.confirmText}>
                  Caso exclua o fornecedor <strong>“{deleteName}”</strong> não poderá recuperá-lo.
                </div>
              </div>

              <div className={styles.confirmActions}>
                <button type="button" className={styles.confirmDelete} onClick={confirmDelete}>
                  Excluir
                </button>
                <button type="button" className={styles.confirmCancel} onClick={() => setIsDeleteOpen(false)}>
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {isImportOpen ? (
          <div
            className={styles.modalOverlay}
            role="presentation"
            onClick={() => {
              if (!importing) setIsImportOpen(false);
            }}
          >
            <div className={`${styles.modal} ${styles.importModal}`} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitle}>Importar Fornecedores por Planilha</div>
                <button type="button" className={styles.modalClose} aria-label="Fechar" onClick={() => setIsImportOpen(false)} disabled={importing}>
                  ×
                </button>
              </div>

              <div className={styles.importBody}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className={styles.fileInput}
                  onChange={(e) => {
                    const file = e.currentTarget.files?.[0] ?? null;
                    if (!file) return;
                    void importFile(file);
                  }}
                />

                <div
                  className={dragOver ? `${styles.dropzone} ${styles.dropzoneActive}` : styles.dropzone}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files?.[0] ?? null;
                    if (!file) return;
                    void importFile(file);
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
                  }}
                >
                  <div className={styles.dropzoneInner}>
                    <div className={styles.dropIcon} aria-hidden>
                      <IconUpload />
                    </div>
                    <div className={styles.dropTitle}>{importing ? "Importando..." : "Arraste e solte seu arquivo aqui"}</div>
                    <div className={styles.dropHint}>Formatos aceitos: CSV, XLSX</div>
                    <button type="button" className={styles.dropBtn} onClick={() => fileInputRef.current?.click()} disabled={importing}>
                      Selecionar Arquivo
                    </button>
                  </div>
                </div>

                {importError ? <div className={styles.importError}>{importError}</div> : null}

                <a className={styles.downloadLink} href="/fornecedores/fornecedores-modelo.csv" download>
                  Baixar Planilha Modelo
                </a>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
