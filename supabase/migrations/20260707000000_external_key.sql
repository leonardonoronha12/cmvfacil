alter table public.companies add column if not exists external_key text null;
create unique index if not exists companies_external_key_uidx on public.companies (external_key) where external_key is not null and external_key <> '';

alter table public.categories add column if not exists external_key text null;
create unique index if not exists categories_company_external_key_uidx on public.categories (company_id, external_key) where external_key is not null and external_key <> '';

alter table public.items add column if not exists external_key text null;
create unique index if not exists items_company_external_key_uidx on public.items (company_id, external_key) where external_key is not null and external_key <> '';

alter table public.suppliers add column if not exists external_key text null;
create unique index if not exists suppliers_company_external_key_uidx on public.suppliers (company_id, external_key) where external_key is not null and external_key <> '';

alter table public.invoices add column if not exists external_key text null;
create unique index if not exists invoices_company_external_key_uidx on public.invoices (company_id, external_key) where external_key is not null and external_key <> '';

alter table public.invoice_items add column if not exists external_key text null;
create unique index if not exists invoice_items_company_external_key_uidx on public.invoice_items (company_id, external_key) where external_key is not null and external_key <> '';

alter table public.inventories add column if not exists external_key text null;
create unique index if not exists inventories_company_external_key_uidx on public.inventories (company_id, external_key) where external_key is not null and external_key <> '';

alter table public.inventory_items add column if not exists external_key text null;
create unique index if not exists inventory_items_company_external_key_uidx on public.inventory_items (company_id, external_key) where external_key is not null and external_key <> '';

alter table public.waste_reasons add column if not exists external_key text null;
create unique index if not exists waste_reasons_company_external_key_uidx on public.waste_reasons (company_id, external_key) where external_key is not null and external_key <> '';

alter table public.wastes add column if not exists external_key text null;
create unique index if not exists wastes_company_external_key_uidx on public.wastes (company_id, external_key) where external_key is not null and external_key <> '';

alter table public.labels add column if not exists external_key text null;
create unique index if not exists labels_company_external_key_uidx on public.labels (company_id, external_key) where external_key is not null and external_key <> '';

alter table public.recipe_ingredients add column if not exists external_key text null;
create unique index if not exists recipe_ingredients_company_external_key_uidx on public.recipe_ingredients (company_id, external_key) where external_key is not null and external_key <> '';

alter table public.avg_cost_events add column if not exists external_key text null;
create unique index if not exists avg_cost_events_company_external_key_uidx on public.avg_cost_events (company_id, external_key) where external_key is not null and external_key <> '';
