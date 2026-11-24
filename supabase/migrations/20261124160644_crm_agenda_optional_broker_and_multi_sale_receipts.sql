-- Mantém a agenda válida quando o compromisso não estiver vinculado a um corretor.
alter table public.crm_appointments
  alter column broker_id drop not null;

-- Cada documento de comissão pode consolidar uma ou várias vendas para o mesmo beneficiário.
create table if not exists public.crm_commission_document_sales (
  id uuid primary key default gen_random_uuid(),
  commission_document_id uuid not null references public.crm_commission_documents(id) on delete cascade,
  sale_id uuid not null references public.crm_sales(id) on delete restrict,
  recipient_id uuid not null references public.crm_users(id) on delete restrict,
  recipient_role text not null check (recipient_role in ('Corretor','SDR')),
  commission_base numeric(14,2) not null check (commission_base >= 0),
  sale_gross_commission numeric(14,2) not null check (sale_gross_commission >= 0),
  gross_commission numeric(14,2) not null check (gross_commission >= 0),
  withholding_rate_pct numeric(7,4) not null default 0 check (withholding_rate_pct between 0 and 100),
  withholding_amount numeric(14,2) not null default 0 check (withholding_amount >= 0),
  net_commission numeric(14,2) not null check (net_commission >= 0),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (commission_document_id, sale_id)
);

create index if not exists crm_commission_document_sales_document_idx
  on public.crm_commission_document_sales (commission_document_id, sale_id);
create index if not exists crm_commission_document_sales_sale_idx
  on public.crm_commission_document_sales (sale_id, recipient_id);
create unique index if not exists crm_commission_document_sales_one_active_receipt_idx
  on public.crm_commission_document_sales (sale_id, recipient_id)
  where archived_at is null;

-- Converte recibos existentes para a nova relação de vendas sem alterar seus valores.
insert into public.crm_commission_document_sales (
  commission_document_id, sale_id, recipient_id, recipient_role, commission_base,
  sale_gross_commission, gross_commission, withholding_rate_pct, withholding_amount,
  net_commission, archived_at, created_at
)
select d.id, d.sale_id, coalesce(d.recipient_id, d.broker_id), coalesce(d.recipient_role, 'Corretor'),
       d.commission_base, round(s.unit_value * 0.025, 2), d.gross_commission,
       d.withholding_rate_pct, d.withholding_amount, d.net_commission, d.archived_at, d.created_at
from public.crm_commission_documents d
join public.crm_sales s on s.id = d.sale_id
where d.document_type = 'commission_receipt' and d.sale_id is not null
on conflict (commission_document_id, sale_id) do nothing;

-- As duplicidades futuras passam a ser controladas por venda e beneficiário na tabela associativa.
drop index if exists public.crm_commission_documents_one_active_receipt_per_sale_recipient_idx;

create or replace function public.crm_sync_commission_document_sales_archive()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.archived_at is distinct from old.archived_at then
    update public.crm_commission_document_sales
       set archived_at = new.archived_at
     where commission_document_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists crm_commission_documents_sync_sales_archive on public.crm_commission_documents;
create trigger crm_commission_documents_sync_sales_archive
after update of archived_at on public.crm_commission_documents
for each row execute function public.crm_sync_commission_document_sales_archive();

alter table public.crm_commission_document_sales enable row level security;
revoke all on public.crm_commission_document_sales from anon, authenticated;
grant all on public.crm_commission_document_sales to service_role;
revoke all on function public.crm_sync_commission_document_sales_archive() from public, anon, authenticated;
