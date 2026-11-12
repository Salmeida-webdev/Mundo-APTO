-- Index the actor reference added for reversible receipt cancellations.
create index if not exists crm_sales_receipts_voided_by_idx
  on public.crm_sales_receipts (voided_by);
