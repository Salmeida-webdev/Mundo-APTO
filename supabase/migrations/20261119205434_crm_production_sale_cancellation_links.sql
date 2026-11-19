-- Vincula vendas individuais aos lançamentos manuais de produção por corretor/data.
-- A quantidade informada continua preservada; vendas canceladas/distratadas
-- vinculadas são descontadas dos indicadores calculados pela aplicação.

create table if not exists public.crm_production_sale_links (
  id uuid primary key default gen_random_uuid(),
  production_entry_id uuid not null references public.crm_production_entries(id) on delete restrict,
  sale_id uuid not null references public.crm_sales(id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid references public.crm_users(id) on delete set null,
  unlinked_at timestamptz,
  unlinked_by uuid references public.crm_users(id) on delete set null
);

create unique index if not exists crm_production_sale_links_active_sale_idx
  on public.crm_production_sale_links (sale_id)
  where unlinked_at is null;

create index if not exists crm_production_sale_links_active_entry_idx
  on public.crm_production_sale_links (production_entry_id)
  where unlinked_at is null;

-- Reconcilia o histórico já existente de forma determinística. Para preservar
-- o resultado líquido esperado, vendas canceladas/distratadas ou arquivadas
-- ocupam primeiro as vagas manuais da data e carteira correspondentes.
with entry_link_counts as (
  select
    entry.id,
    entry.broker_id,
    entry.work_date,
    entry.created_at,
    greatest(entry.sale_count - count(link.id), 0) as available_slots
  from public.crm_production_entries entry
  left join public.crm_production_sale_links link
    on link.production_entry_id = entry.id
   and link.unlinked_at is null
  where entry.deleted_at is null
    and entry.sale_count > 0
  group by entry.id, entry.broker_id, entry.work_date, entry.created_at, entry.sale_count
), production_slots as (
  select
    entry.id,
    entry.broker_id,
    entry.work_date,
    coalesce(sum(entry.available_slots) over (
      partition by entry.broker_id, entry.work_date
      order by entry.created_at, entry.id
      rows between unbounded preceding and current row
    ), 0) as slot_end,
    coalesce(sum(entry.available_slots) over (
      partition by entry.broker_id, entry.work_date
      order by entry.created_at, entry.id
      rows between unbounded preceding and 1 preceding
    ), 0) as slot_start
  from entry_link_counts entry
  where entry.available_slots > 0
), ranked_sales as (
  select
    sale.id,
    sale.broker_id,
    sale.sold_at,
    row_number() over (
      partition by sale.broker_id, sale.sold_at
      order by case
        when sale.deleted_at is not null
          or upper(coalesce(sale.sale_status, '')) like '%CANCEL%'
          or upper(coalesce(sale.sale_status, '')) like '%DISTRATO%'
          or upper(coalesce(sale.repass_status, '')) = 'CANCELADO'
          or upper(coalesce(sale.repass_status, '')) like '%DISTRATO%'
        then 0 else 1 end,
        sale.created_at,
        sale.id
    ) as sales_slot
  from public.crm_sales sale
  where not exists (
      select 1 from public.crm_production_sale_links link
      where link.sale_id = sale.id and link.unlinked_at is null
    )
), backfill_links as (
  select sale.id as sale_id, entry.id as production_entry_id
  from ranked_sales sale
  join production_slots entry
    on entry.broker_id = sale.broker_id
   and entry.work_date = sale.sold_at
   and sale.sales_slot > entry.slot_start
   and sale.sales_slot <= entry.slot_end
)
insert into public.crm_production_sale_links (sale_id, production_entry_id)
select sale_id, production_entry_id
from backfill_links
on conflict (sale_id) where unlinked_at is null do nothing;

alter table public.crm_production_sale_links enable row level security;
revoke all on public.crm_production_sale_links from anon, authenticated;
grant all on public.crm_production_sale_links to service_role;

-- Cria vínculos dentro de uma transação e sob trava por corretor/data. O limite
-- é a quantidade manual de vendas ainda sem vínculo no lançamento de produção.
create or replace function public.crm_sync_production_sales_day(
  p_broker_id uuid,
  p_work_date date,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_links jsonb := '[]'::jsonb;
  v_key text;
begin
  if p_broker_id is null or p_work_date is null or p_actor_id is null then
    raise exception 'invalid_production_sale_link';
  end if;

  v_key := p_broker_id::text || ':' || p_work_date::text;
  perform pg_advisory_xact_lock(hashtextextended(v_key, 0));

  perform entry.id
  from public.crm_production_entries entry
  where entry.broker_id = p_broker_id
    and entry.work_date = p_work_date
    and entry.deleted_at is null
    and entry.sale_count > 0
  order by entry.created_at, entry.id
  for update;

  with entry_link_counts as (
    select
      entry.id,
      entry.sale_count,
      entry.created_at,
      count(link.id) as linked_count
    from public.crm_production_entries entry
    left join public.crm_production_sale_links link
      on link.production_entry_id = entry.id
     and link.unlinked_at is null
    where entry.broker_id = p_broker_id
      and entry.work_date = p_work_date
      and entry.deleted_at is null
      and entry.sale_count > 0
    group by entry.id, entry.sale_count, entry.created_at
  ), entry_capacity as (
    select
      entry.id,
      greatest(entry.sale_count - entry.linked_count, 0) as capacity,
      coalesce(sum(greatest(entry.sale_count - entry.linked_count, 0)) over (
        order by entry.created_at, entry.id
        rows between unbounded preceding and 1 preceding
      ), 0) as slot_start,
      sum(greatest(entry.sale_count - entry.linked_count, 0)) over (
        order by entry.created_at, entry.id
        rows between unbounded preceding and current row
      ) as slot_end
    from entry_link_counts entry
  ), unlinked_sales as (
    select
      sale.id,
      row_number() over (
        order by case
          when sale.deleted_at is not null
            or upper(coalesce(sale.sale_status, '')) like '%CANCEL%'
            or upper(coalesce(sale.sale_status, '')) like '%DISTRATO%'
            or upper(coalesce(sale.repass_status, '')) = 'CANCELADO'
            or upper(coalesce(sale.repass_status, '')) like '%DISTRATO%'
          then 0 else 1 end,
          sale.created_at,
          sale.id
      ) as sales_slot
    from public.crm_sales sale
    where sale.broker_id = p_broker_id
      and sale.sold_at = p_work_date
      and not exists (
        select 1 from public.crm_production_sale_links link
        where link.sale_id = sale.id and link.unlinked_at is null
      )
  ), matches as (
    select sale.id as sale_id, entry.id as production_entry_id
    from unlinked_sales sale
    join entry_capacity entry
      on sale.sales_slot > entry.slot_start
     and sale.sales_slot <= entry.slot_end
  ), inserted as (
    insert into public.crm_production_sale_links (sale_id, production_entry_id, created_by)
    select sale_id, production_entry_id, p_actor_id
    from matches
    on conflict (sale_id) where unlinked_at is null do nothing
    returning id, sale_id, production_entry_id, created_at
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id,
    'saleId', sale_id,
    'productionEntryId', production_entry_id,
    'createdAt', created_at
  )), '[]'::jsonb)
  into v_links
  from inserted;

  return jsonb_build_object('ok', true, 'links', v_links);
end;
$$;

revoke all on function public.crm_sync_production_sales_day(uuid,date,uuid) from public, anon, authenticated;
grant execute on function public.crm_sync_production_sales_day(uuid,date,uuid) to service_role;

create or replace function public.crm_sync_production_sales_batch(
  p_days jsonb,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_day jsonb;
  v_result jsonb;
  v_links jsonb := '[]'::jsonb;
  v_total integer := 0;
begin
  if p_actor_id is null or jsonb_typeof(p_days) is distinct from 'array' then
    raise exception 'invalid_production_sale_link_batch';
  end if;
  if jsonb_array_length(p_days) > 500 then
    raise exception 'invalid_production_sale_link_batch';
  end if;

  for v_day in select value from jsonb_array_elements(p_days)
  loop
    v_result := public.crm_sync_production_sales_day(
      nullif(v_day->>'brokerId', '')::uuid,
      nullif(v_day->>'workDate', '')::date,
      p_actor_id
    );
    v_links := v_links || coalesce(v_result->'links', '[]'::jsonb);
  end loop;

  v_total := jsonb_array_length(v_links);
  return jsonb_build_object('ok', true, 'linkedCount', v_total, 'links', v_links);
end;
$$;

revoke all on function public.crm_sync_production_sales_batch(jsonb,uuid) from public, anon, authenticated;
grant execute on function public.crm_sync_production_sales_batch(jsonb,uuid) to service_role;
