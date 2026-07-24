"use client";

import { useEffect, useMemo, useState } from "react";

export default function usePagination<T>(params: { items: T[]; pageSize?: number; resetKey?: string }) {
  const pageSize = typeof params.pageSize === "number" && params.pageSize > 0 ? params.pageSize : 20;
  const items = params.items ?? [];
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [params.resetKey, pageSize]);

  const safePage = Math.min(Math.max(1, page), totalPages);

  const pageItems = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    const end = start + pageSize;
    return items.slice(start, end);
  }, [items, pageSize, safePage]);

  const from = totalItems ? (safePage - 1) * pageSize + 1 : 0;
  const to = totalItems ? Math.min(totalItems, safePage * pageSize) : 0;

  return { page: safePage, setPage, pageSize, totalItems, totalPages, pageItems, from, to };
}

