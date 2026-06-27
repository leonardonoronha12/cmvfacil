"use client";

import { loadDesperdiciosFromSupabase } from "./desperdiciosSupabase";
import { writeDesperdiciosToStore } from "./desperdiciosStore";
import { loadEntradasFromSupabase } from "./entradasSupabase";
import { writeEntradasToStore } from "./entradasStore";
import { loadFichasTecnicasFromSupabase } from "./fichasTecnicasSupabase";
import { writeFichasTecnicasToStore } from "./fichasTecnicasStore";
import { loadFichasTecnicasEtiquetasFromSupabase } from "./fichasTecnicasEtiquetasSupabase";
import { writeFichasTecnicasEtiquetasToStore } from "./fichasTecnicasEtiquetasStore";
import { loadFornecedoresStateFromSupabase } from "./fornecedoresSupabase";
import { writeFornecedorEquivalenciasMap, writeFornecedorInfoMap, writeFornecedorProdutosMap } from "./fornecedoresStore";
import { loadInventarioFromSupabase } from "./inventarioSupabase";
import { writeInventarioToStore } from "./inventarioStore";
import { loadInsumosStateFromSupabase } from "./insumosSupabase";
import { writeInsumoCategoriasToStore } from "./insumoCategoriasStore";
import { writeInsumosToStore } from "./insumosStore";
import { loadPrePreparoEtiquetasFromSupabase } from "./prePreparoEtiquetasSupabase";
import { writePrePreparoEtiquetasToStore } from "./prePreparoEtiquetasStore";
import { loadPrePreparoFromSupabase } from "./prePreparoSupabase";
import { writePrePreparoToStore } from "./prePreparoStore";

let running: Promise<void> | null = null;

function getNow() {
  return Date.now();
}

function getLastRunMs() {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.sessionStorage.getItem("cmvfacil:bootstrap:v1:lastRunMs");
    const n = raw ? Number.parseInt(raw, 10) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function setLastRunMs(ms: number) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem("cmvfacil:bootstrap:v1:lastRunMs", String(ms));
  } catch {}
}

export async function bootstrapUserDataOnce() {
  if (typeof window === "undefined") return;
  const last = getLastRunMs();
  const now = getNow();
  if (last && now - last < 60_000) return;
  if (running) return running;

  setLastRunMs(now);
  running = (async () => {
    const tasks: Array<Promise<void>> = [];

    tasks.push(
      loadInsumosStateFromSupabase()
        .then((state) => {
          writeInsumosToStore(state.rows);
          writeInsumoCategoriasToStore(state.categories);
        })
        .catch(() => {}),
    );

    tasks.push(
      loadFornecedoresStateFromSupabase()
        .then((state) => {
          writeFornecedorInfoMap(state.info);
          writeFornecedorProdutosMap(state.produtos);
          writeFornecedorEquivalenciasMap(state.equivalencias);
        })
        .catch(() => {}),
    );

    tasks.push(loadFichasTecnicasFromSupabase().then(writeFichasTecnicasToStore).catch(() => {}));
    tasks.push(loadFichasTecnicasEtiquetasFromSupabase().then(writeFichasTecnicasEtiquetasToStore).catch(() => {}));
    tasks.push(loadPrePreparoFromSupabase().then(writePrePreparoToStore).catch(() => {}));
    tasks.push(loadPrePreparoEtiquetasFromSupabase().then(writePrePreparoEtiquetasToStore).catch(() => {}));
    tasks.push(loadEntradasFromSupabase().then(writeEntradasToStore).catch(() => {}));
    tasks.push(loadInventarioFromSupabase().then(writeInventarioToStore).catch(() => {}));
    tasks.push(loadDesperdiciosFromSupabase().then(writeDesperdiciosToStore).catch(() => {}));

    await Promise.allSettled(tasks);
  })().finally(() => {
    running = null;
  });

  return running;
}
