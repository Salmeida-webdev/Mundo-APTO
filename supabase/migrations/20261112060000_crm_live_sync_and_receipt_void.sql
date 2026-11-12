-- Notificação em tempo real sem publicar dados de clientes: esta tabela contém somente
-- um sinal técnico (id fixo e horário), lido por usuários ativos autenticados.
create table if not exists public.crm_sync_signal (
  id smallint primary key check (id = 1),
  changed_at timestamptz not null default now()
);

insert into public.crm_sync_signal (id, changed_at)
values (1, now())
on conflict (id) do nothing;

alter table public.crm_sync_signal enable row level security;
revoke all on public.crm_sync_signal from anon, authenticated;
grant select on public.crm_sync_signal to authenticated;
grant all on public.crm_sync_signal to service_role;

drop policy if exists crm_sync_signal_read_active on public.crm_sync_signal;
create policy crm_sync_signal_read_active on public.crm_sync_signal
  for select to authenticated using (public.crm_user_is_active());

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'crm_sync_signal'
     ) then
    alter publication supabase_realtime add table public.crm_sync_signal;
  end if;
end
$$;

-- Correções de parcelas são reversíveis: a linha original e o motivo continuam no histórico.
alter table public.crm_sales_receipts
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references public.crm_users(id) on delete set null,
  add column if not exists void_reason text not null default '';

-- Depois que uma parcela é anulada, novos recebimentos devem ignorá-la nos totais.
create or replace function public.crm_add_sale_receipt(
  p_sale_id uuid,
  p_actor_id uuid,
  p_amount numeric,
  p_received_at date,
  p_notes text default ''
)
returns table (receipt_id uuid, received_total numeric, balance numeric, repass_status text, previous_status text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_sale public.crm_sales%rowtype;
  v_prior numeric(14,2);
  v_total numeric(14,2);
  v_receipt_id uuid;
  v_now timestamptz := now();
begin
  select * into v_sale
  from public.crm_sales
  where id = p_sale_id and deleted_at is null
  for update;
  if not found then raise exception 'sale_not_found'; end if;
  if v_sale.sale_status = 'Cancelada' then raise exception 'sale_cancelled'; end if;
  if p_amount <= 0 then raise exception 'invalid_receipt_amount'; end if;

  select coalesce(sum(amount), 0) into v_prior
  from public.crm_sales_receipts
  where sale_id = p_sale_id and voided_at is null;

  insert into public.crm_sales_receipts (sale_id, amount, received_at, notes, created_by)
  values (p_sale_id, p_amount, p_received_at, left(coalesce(p_notes, ''), 1000), p_actor_id)
  returning id into v_receipt_id;

  v_total := v_prior + p_amount;
  update public.crm_sales
  set updated_at = v_now, updated_by = p_actor_id
  where id = p_sale_id;

  return query select v_receipt_id, v_total, v_sale.expected_repass - v_total, v_sale.repass_status, v_sale.repass_status;
end;
$$;

revoke all on function public.crm_add_sale_receipt(uuid, uuid, numeric, date, text) from public, anon, authenticated;
grant execute on function public.crm_add_sale_receipt(uuid, uuid, numeric, date, text) to service_role;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'crm_sales_receipts_void_reason_check'
      and conrelid = 'public.crm_sales_receipts'::regclass
  ) then
    alter table public.crm_sales_receipts
      add constraint crm_sales_receipts_void_reason_check
      check (
        (voided_at is null and voided_by is null and void_reason = '')
        or (voided_at is not null and char_length(trim(void_reason)) between 5 and 1000)
      );
  end if;
end
$$;

create or replace function public.crm_void_sale_receipt(
  p_receipt_id uuid,
  p_actor_id uuid,
  p_reason text
)
returns table (
  sale_id uuid,
  receipt_id uuid,
  amount numeric,
  received_at date,
  notes text,
  previous_received_total numeric,
  received_total numeric,
  balance numeric,
  repass_status text
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_sale_id uuid;
  v_sale public.crm_sales%rowtype;
  v_receipt public.crm_sales_receipts%rowtype;
  v_reason text := trim(coalesce(p_reason, ''));
  v_previous_total numeric(14,2);
  v_total numeric(14,2);
  v_now timestamptz := now();
begin
  if p_receipt_id is null or p_actor_id is null then raise exception 'invalid_receipt'; end if;
  if char_length(v_reason) < 5 or char_length(v_reason) > 1000 then raise exception 'invalid_void_reason'; end if;

  select receipt.sale_id into v_sale_id
  from public.crm_sales_receipts as receipt
  where receipt.id = p_receipt_id;
  if not found then raise exception 'receipt_not_found'; end if;

  -- Rotinas de recebimento bloqueiam primeiro a venda para serializar os totais.
  select sale.* into v_sale
  from public.crm_sales as sale
  where sale.id = v_sale_id
  for update;
  if not found then raise exception 'sale_not_found'; end if;

  select receipt.* into v_receipt
  from public.crm_sales_receipts as receipt
  where receipt.id = p_receipt_id
  for update;
  if not found then raise exception 'receipt_not_found'; end if;
  if v_receipt.voided_at is not null then raise exception 'receipt_already_voided'; end if;

  select coalesce(sum(receipt.amount), 0) into v_previous_total
  from public.crm_sales_receipts as receipt
  where receipt.sale_id = v_sale_id and receipt.voided_at is null;

  update public.crm_sales_receipts as receipt
  set voided_at = v_now, voided_by = p_actor_id, void_reason = v_reason
  where receipt.id = p_receipt_id;

  update public.crm_sales as sale
  set updated_at = v_now, updated_by = p_actor_id
  where sale.id = v_sale_id;

  select coalesce(sum(receipt.amount), 0) into v_total
  from public.crm_sales_receipts as receipt
  where receipt.sale_id = v_sale_id and receipt.voided_at is null;

  return query
  select v_sale.id, v_receipt.id, v_receipt.amount, v_receipt.received_at,
         v_receipt.notes, v_previous_total, v_total,
         v_sale.expected_repass - v_total, v_sale.repass_status;
end;
$$;

revoke all on function public.crm_void_sale_receipt(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.crm_void_sale_receipt(uuid, uuid, text) to service_role;
