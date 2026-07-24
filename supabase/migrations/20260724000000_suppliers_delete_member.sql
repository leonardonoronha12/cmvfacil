drop policy if exists suppliers_delete_member on public.suppliers;
create policy suppliers_delete_member on public.suppliers
for delete to authenticated
using (
  exists (
    select 1
    from public.company_members m
    where m.company_id = suppliers.company_id
      and m.user_id = auth.uid()
  )
);

drop policy if exists supplier_items_delete_member on public.supplier_items;
create policy supplier_items_delete_member on public.supplier_items
for delete to authenticated
using (
  exists (
    select 1
    from public.company_members m
    where m.company_id = supplier_items.company_id
      and m.user_id = auth.uid()
  )
);
