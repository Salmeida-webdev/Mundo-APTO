-- Consolida ajustes de login, produção, vendas, recebimentos e cálculo financeiro.
-- Migração aditiva: não altera nem apaga os valores comerciais já registrados.

alter table public.crm_sales
  add column if not exists commission_rate_pct numeric(7,4),
  add column if not exists gross_commission numeric(14,2),
  add column if not exists broker_commission numeric(14,2),
  add column if not exists sdr_commission numeric(14,2),
  add column if not exists manager_commission_rate_pct numeric(7,4),
  add column if not exists manager_commission_value numeric(14,2) not null default 0,
  add column if not exists has_prize boolean not null default false,
  add column if not exists prize_rate_pct numeric(7,4),
  add column if not exists gross_prize numeric(14,2) not null default 0,
  add column if not exists broker_prize numeric(14,2) not null default 0,
  add column if not exists sdr_prize numeric(14,2) not null default 0;

alter table public.crm_contracts
  add column if not exists manager_commission_rate_pct numeric(7,4),
  add column if not exists manager_commission_value numeric(14,2) not null default 0;

alter table public.crm_sales_receipts
  add column if not exists previous_repass_status text,
  add column if not exists status_set_by_receipt boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.crm_sales'::regclass and conname='crm_sales_commission_rate_range_check') then
    alter table public.crm_sales add constraint crm_sales_commission_rate_range_check check (commission_rate_pct is null or commission_rate_pct between 0 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.crm_sales'::regclass and conname='crm_sales_manager_commission_rate_range_check') then
    alter table public.crm_sales add constraint crm_sales_manager_commission_rate_range_check check (manager_commission_rate_pct is null or manager_commission_rate_pct between 0 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.crm_sales'::regclass and conname='crm_sales_prize_rate_range_check') then
    alter table public.crm_sales add constraint crm_sales_prize_rate_range_check check (prize_rate_pct is null or prize_rate_pct between 0 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.crm_sales'::regclass and conname='crm_sales_commission_values_nonnegative_check') then
    alter table public.crm_sales add constraint crm_sales_commission_values_nonnegative_check check (
      coalesce(gross_commission,0)>=0 and coalesce(broker_commission,0)>=0 and coalesce(sdr_commission,0)>=0
      and manager_commission_value>=0 and gross_prize>=0 and broker_prize>=0 and sdr_prize>=0
    );
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.crm_contracts'::regclass and conname='crm_contracts_manager_commission_rate_range_check') then
    alter table public.crm_contracts add constraint crm_contracts_manager_commission_rate_range_check check (manager_commission_rate_pct is null or manager_commission_rate_pct between 0 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.crm_contracts'::regclass and conname='crm_contracts_manager_commission_value_nonnegative_check') then
    alter table public.crm_contracts add constraint crm_contracts_manager_commission_value_nonnegative_check check (manager_commission_value>=0);
  end if;
end
$$;

alter table public.crm_sales drop constraint if exists crm_sales_sale_status_check;
alter table public.crm_sales alter column sale_status set default 'Pendência para contabilização';
alter table public.crm_sales add constraint crm_sales_sale_status_check check (sale_status in (
  'Contabilizado','Pendência para contabilização',
  'Cadastrada','Em conferência','Com pendência','Regularizada','Cancelada'
));

alter table public.crm_sales drop constraint if exists crm_sales_repass_status_check;
alter table public.crm_sales alter column repass_status set default 'FASE DO REGISTRO';
alter table public.crm_sales add constraint crm_sales_repass_status_check check (repass_status in (
  'AGUARDANDO PJ','LIBERADO P/ REPASSE','IR FUTURO','PENDÊNCIA PARA LIBERAÇÃO DO REPASSE','REPASSE SFH','ANÁLISE DE CRÉDITO',
  'EMISSÃO DE FORMULÁRIOS','FGTS EM DÉBITO','FGTS EM RESSARCIMENTO','FGTS COM ERRO','FORMULÁRIOS EM ASSINATURA',
  'FORMULÁRIOS ASSINADOS','CRITICADO E ENVIADO P/ CONFORMIDADE','PENDÊNCIA DURANTE O REPASSE','INCONFORME',
  'REANÁLISE DA CONFORMIDADE','CONFORME','AGUARDANDO DEMANDA MÍNIMA','CONFIRMAÇÃO DE VALORES COM CLIENTE',
  'EMISSÃO CONFISSÃO DE DÍVIDA / SOLICITAÇÃO DE CONTRATO','CONTRATO EMITIDO','CONTRATO E CONFISSÃO DE DÍVIDA EM ASSINATURA',
  'CONTRATO EM ASSINATURA E CONFISSÃO ASSINADA','CONTRATO ASSINADO E CONFISSÃO PENDENTE',
  'PROBLEMA NA ASSINATURA DO FINANCIAMENTO','CONTRATO E CONFISSÃO ASSINADOS',
  'CHECK-LIST DE REPASSE APTO PARA CONFERENCIA','AGUARDANDO REPACTUAÇÃO','CHECK-LIST DE REPASSE REPROVADO','CHECK-LIST DE REPASSE APROVADO',
  'FASE DO REGISTRO','CHECK-LIST DE REGISTRO REPROVADO','LIBERADO PARA REGISTRO','CHECK-LIST DE REGISTRO APROVADO',
  'PRENOTADO','EXIGÊNCIA','ORÇAMENTO À PAGAR','EM REGISTRO','REGISTRADO / ENVIAR GARANTIA','GARANTIA ENVIADA',
  'GARANTIA INCONFORME','RECURSO LIBERADO','SOLICITAÇÃO DE DISTRATO','DISTRATO FINALIZADO','REPASSE CONCLUIDO','COMISSÃO PAGA',
  'Aguardando repasse','Em andamento','Repasse parcial','Repasse concluído','Suspenso','Cancelado'
));

-- O novo recebimento é único, integral e calcula o valor a partir da comissão do corretor.
create or replace function public.crm_add_sale_receipt_full(
  p_sale_id uuid,
  p_actor_id uuid,
  p_received_at date,
  p_notes text default ''
)
returns table (receipt_id uuid, amount numeric, received_total numeric, balance numeric, repass_status text, previous_status text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_sale public.crm_sales%rowtype;
  v_amount numeric(14,2);
  v_receipt_id uuid;
  v_now timestamptz := now();
begin
  if p_actor_id is null or p_received_at is null then raise exception 'invalid_receipt'; end if;
  select * into v_sale from public.crm_sales where id=p_sale_id and deleted_at is null for update;
  if not found then raise exception 'sale_not_found'; end if;
  if v_sale.sale_status='Cancelada' then raise exception 'sale_cancelled'; end if;
  if exists(select 1 from public.crm_sales_receipts where sale_id=p_sale_id and voided_at is null) then raise exception 'active_receipt_exists'; end if;
  v_amount := coalesce(v_sale.broker_commission,v_sale.expected_repass,0);
  if v_amount <= 0 then raise exception 'broker_commission_not_configured'; end if;
  insert into public.crm_sales_receipts(sale_id,amount,received_at,notes,created_by,previous_repass_status,status_set_by_receipt)
  values(p_sale_id,v_amount,p_received_at,left(coalesce(p_notes,''),1000),p_actor_id,v_sale.repass_status,true)
  returning id into v_receipt_id;
  update public.crm_sales set repass_status='COMISSÃO PAGA',updated_at=v_now,updated_by=p_actor_id where id=p_sale_id;
  return query select v_receipt_id,v_amount,v_amount,0::numeric,'COMISSÃO PAGA'::text,v_sale.repass_status;
end;
$$;
revoke all on function public.crm_add_sale_receipt_full(uuid,uuid,date,text) from public,anon,authenticated;
grant execute on function public.crm_add_sale_receipt_full(uuid,uuid,date,text) to service_role;

-- Anular continua reversível; só restaura a fase se o recebimento a tiver definido e
-- ninguém tiver mudado manualmente a fase depois dele.
drop function if exists public.crm_void_sale_receipt(uuid,uuid,text);
create function public.crm_void_sale_receipt(p_receipt_id uuid,p_actor_id uuid,p_reason text)
returns table (
  sale_id uuid,receipt_id uuid,amount numeric,received_at date,notes text,
  previous_received_total numeric,received_total numeric,balance numeric,repass_status text,phase_restored boolean
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_sale_id uuid;
  v_sale public.crm_sales%rowtype;
  v_receipt public.crm_sales_receipts%rowtype;
  v_reason text:=trim(coalesce(p_reason,''));
  v_previous_total numeric(14,2);
  v_total numeric(14,2);
  v_balance numeric(14,2);
  v_restored boolean:=false;
  v_now timestamptz:=now();
begin
  if p_receipt_id is null or p_actor_id is null then raise exception 'invalid_receipt'; end if;
  if char_length(v_reason)<5 or char_length(v_reason)>1000 then raise exception 'invalid_void_reason'; end if;
  select receipt.sale_id into v_sale_id from public.crm_sales_receipts receipt where receipt.id=p_receipt_id;
  if not found then raise exception 'receipt_not_found'; end if;
  select sale.* into v_sale from public.crm_sales sale where sale.id=v_sale_id for update;
  if not found then raise exception 'sale_not_found'; end if;
  select receipt.* into v_receipt from public.crm_sales_receipts receipt where receipt.id=p_receipt_id for update;
  if not found then raise exception 'receipt_not_found'; end if;
  if v_receipt.voided_at is not null then raise exception 'receipt_already_voided'; end if;
  select coalesce(sum(receipt.amount),0) into v_previous_total from public.crm_sales_receipts receipt where receipt.sale_id=v_sale_id and receipt.voided_at is null;
  update public.crm_sales_receipts set voided_at=v_now,voided_by=p_actor_id,void_reason=v_reason where id=p_receipt_id;
  if v_receipt.status_set_by_receipt and v_sale.repass_status='COMISSÃO PAGA' and v_receipt.previous_repass_status is not null then
    update public.crm_sales set repass_status=v_receipt.previous_repass_status,updated_at=v_now,updated_by=p_actor_id where id=v_sale_id;
    v_restored:=true;
  else
    update public.crm_sales set updated_at=v_now,updated_by=p_actor_id where id=v_sale_id;
  end if;
  select coalesce(sum(receipt.amount),0) into v_total from public.crm_sales_receipts receipt where receipt.sale_id=v_sale_id and receipt.voided_at is null;
  v_balance:=coalesce(v_sale.broker_commission,v_sale.expected_repass,0)-v_total;
  return query select v_sale.id,v_receipt.id,v_receipt.amount,v_receipt.received_at,v_receipt.notes,v_previous_total,v_total,v_balance,
    (select sale.repass_status from public.crm_sales sale where sale.id=v_sale_id),v_restored;
end;
$$;
revoke all on function public.crm_void_sale_receipt(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.crm_void_sale_receipt(uuid,uuid,text) to service_role;

-- Salva a matriz completa de metas em uma transação; cada item cria revisão própria.
create or replace function public.crm_save_operation_goals_batch(p_goals jsonb,p_actor_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item jsonb;
  v_saved public.crm_production_goals%rowtype;
  v_results jsonb:='[]'::jsonb;
  v_count integer:=0;
begin
  if p_actor_id is null or jsonb_typeof(p_goals) is distinct from 'array' then raise exception 'invalid_goal_batch'; end if;
  if jsonb_array_length(p_goals)<3 or jsonb_array_length(p_goals)>300 then raise exception 'invalid_goal_batch_size'; end if;
  for v_item in select value from jsonb_array_elements(p_goals)
  loop
    if nullif(v_item->>'broker_id','') is null or nullif(v_item->>'metric','') is null
      or nullif(v_item->>'cycle','') is null or nullif(v_item->>'starts_on','') is null
      or nullif(v_item->>'ends_on','') is null or nullif(v_item->>'target_count','') is null then
      raise exception 'invalid_goal_batch_item';
    end if;
    select * into v_saved from public.crm_save_operation_goal(
      (v_item->>'broker_id')::uuid,v_item->>'metric',v_item->>'cycle',(v_item->>'starts_on')::date,
      (v_item->>'ends_on')::date,(v_item->>'target_count')::integer,p_actor_id
    );
    v_count:=v_count+1;
    v_results:=v_results||jsonb_build_array(jsonb_build_object('id',v_saved.id,'brokerId',v_saved.broker_id,'metric',v_saved.metric,'target',v_saved.target_count,'revision',v_saved.revision));
  end loop;
  if v_count<>jsonb_array_length(p_goals) then raise exception 'invalid_goal_batch'; end if;
  return jsonb_build_object('count',v_count,'results',v_results);
end;
$$;
revoke all on function public.crm_save_operation_goals_batch(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.crm_save_operation_goals_batch(jsonb,uuid) to service_role;
