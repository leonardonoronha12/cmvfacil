[OPEN]

# Debug Session: events-me-empty

## Context
- Symptom: `GET https://cmvfacil.app/api/debug/events-me` always returns `events: []`.
- Even after `POST /api/fornecedores` activity in production, the debug events are not visible.
- `diag=1` currently shows `hasDefaultSupplier: false`, implying the “supplier:default:sem_fornecedor” row is not being found by the collector.

## Goal
- Make production debug collection reliable enough to capture evidence for the original “supplier_items disappear after refresh” issue.

## Hypotheses (falsifiable)
1. **H1 (Default supplier mismatch)**: A default supplier exists but `external_key` casing differs (e.g. `SUPPLIER:DEFAULT:SEM_FORNECEDOR`), so `.eq("external_key", ...)` misses it and the collector reads `events: []`.
2. **H2 (Write blocked by RLS)**: The server-side writer attempts to create/update the default supplier but RLS blocks insert/update, so no `debug_events` persists.
3. **H3 (Wrong company picked)**: `events-me` selects a `company_id` that is not the one being mutated by `/api/fornecedores` due to membership scoring.
4. **H4 (Writer not running)**: The `/api/fornecedores` code path that stores debug events doesn’t run (legacy source path, auth missing, or early returns).
5. **H5 (Write succeeds but read wrong field)**: Events are being written somewhere else (different supplier row or different json path), so `events-me` reads an empty array.

## Instrumentation / Evidence Plan
- Use `GET /api/debug/events-me?diag=1` to validate if default supplier is found and how many events exist.
- Use `GET /api/debug/events-me?seed=1&diag=1` to force-create (or attach to) the default supplier and append a known “seed” event.
- Trigger writes by executing a small change in `/fornecedores` that performs `POST /api/fornecedores`.

## Status
- Pending: confirm production deploy contains the latest fixes (case-insensitive lookup + seed fallback).

