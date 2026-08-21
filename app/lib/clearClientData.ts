"use client";

import { writeDesperdicioMotivosToStore } from "./desperdiciosMotivosStore";
import { writeDesperdiciosSeenIdsToStore } from "./desperdiciosBadgeStore";
import { writeDesperdiciosToStore } from "./desperdiciosStore";
import { writeEntradasToStore } from "./entradasStore";
import { writeFichasTecnicasEtiquetasToStore } from "./fichasTecnicasEtiquetasStore";
import { writeFichasTecnicasToStore } from "./fichasTecnicasStore";
import { writeFornecedorEquivalenciasMap, writeFornecedorInfoMap, writeFornecedorProdutosMap } from "./fornecedoresStore";
import { writeInventarioToStore } from "./inventarioStore";
import { writeInsumoCategoriasToStore } from "./insumoCategoriasStore";
import { writeInsumosToStore } from "./insumosStore";
import { writePrePreparoEtiquetasToStore } from "./prePreparoEtiquetasStore";
import { writePrePreparoToStore } from "./prePreparoStore";
import { clearTableCaches } from "./tableCache";

export function clearClientData() {
  if (typeof window === "undefined") return;
  clearTableCaches();
  try {
    writeInsumosToStore([]);
    writeInsumoCategoriasToStore([]);
  } catch {}
  try {
    writeFornecedorInfoMap({});
    writeFornecedorProdutosMap({});
    writeFornecedorEquivalenciasMap({});
  } catch {}
  try {
    writeEntradasToStore([]);
  } catch {}
  try {
    writeInventarioToStore([]);
  } catch {}
  try {
    writeDesperdiciosToStore([]);
    writeDesperdicioMotivosToStore([]);
    writeDesperdiciosSeenIdsToStore([]);
  } catch {}
  try {
    writePrePreparoToStore([]);
    writePrePreparoEtiquetasToStore([]);
  } catch {}
  try {
    writeFichasTecnicasToStore([]);
    writeFichasTecnicasEtiquetasToStore([]);
  } catch {}
}
