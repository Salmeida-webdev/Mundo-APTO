-- Substitui as opções genéricas da fase do repasse pela lista informada pela cliente.
-- Interrompe sem alterar registros se houver fases antigas ou desconhecidas para revisão manual.
do $$
begin
  if exists (
    select 1 from public.crm_sales
    where repass_status not in (
      'AGUARDANDO PJ','LIBERADO P/ REPASSE','IR FUTURO','PENDÊNCIA PARA LIBERAÇÃO DO REPASSE',
      'REPASSE SFH','ANÁLISE DE CRÉDITO','EMISSÃO DE FORMULÁRIOS','FGTS EM DÉBITO',
      'FGTS EM RESSARCIMENTO','FGTS COM ERRO','FORMULÁRIOS EM ASSINATURA','FORMULÁRIOS ASSINADOS',
      'CRITICADO E ENVIADO P/ CONFORMIDADE','PENDÊNCIA DURANTE O REPASSE','INCONFORME',
      'REANÁLISE DA CONFORMIDADE','CONFORME','AGUARDANDO DEMANDA MÍNIMA',
      'CONFIRMAÇÃO DE VALORES COM CLIENTE','EMISSÃO CONFISSÃO DE DÍVIDA / SOLICITAÇÃO DE CONTRATO',
      'CONTRATO EMITIDO','CONTRATO E CONFISSÃO DE DÍVIDA EM ASSINATURA',
      'CONTRATO EM ASSINATURA E CONFISSÃO ASSINADA','CONTRATO ASSINADO E CONFISSÃO PENDENTE',
      'PROBLEMA NA ASSINATURA DO FINANCIAMENTO','CONTRATO E CONFISSÃO ASSINADOS',
      'CHECK-LIST DE REPASSE APTO PARA CONFERENCIA','AGUARDANDO REPACTUAÇÃO',
      'CHECK-LIST DE REPASSE REPROVADO','CHECK-LIST DE REPASSE APROVADO'
    )
  ) then
    raise exception 'crm_sales contains a repass phase outside the known old/new options; review values before migration';
  end if;
end
$$;

alter table public.crm_sales
  drop constraint if exists crm_sales_repass_status_check;

alter table public.crm_sales
  alter column repass_status set default 'AGUARDANDO PJ';

alter table public.crm_sales
  add constraint crm_sales_repass_status_check check (repass_status in (
    'AGUARDANDO PJ',
    'LIBERADO P/ REPASSE',
    'IR FUTURO',
    'PENDÊNCIA PARA LIBERAÇÃO DO REPASSE',
    'REPASSE SFH',
    'ANÁLISE DE CRÉDITO',
    'EMISSÃO DE FORMULÁRIOS',
    'FGTS EM DÉBITO',
    'FGTS EM RESSARCIMENTO',
    'FGTS COM ERRO',
    'FORMULÁRIOS EM ASSINATURA',
    'FORMULÁRIOS ASSINADOS',
    'CRITICADO E ENVIADO P/ CONFORMIDADE',
    'PENDÊNCIA DURANTE O REPASSE',
    'INCONFORME',
    'REANÁLISE DA CONFORMIDADE',
    'CONFORME',
    'AGUARDANDO DEMANDA MÍNIMA',
    'CONFIRMAÇÃO DE VALORES COM CLIENTE',
    'EMISSÃO CONFISSÃO DE DÍVIDA / SOLICITAÇÃO DE CONTRATO',
    'CONTRATO EMITIDO',
    'CONTRATO E CONFISSÃO DE DÍVIDA EM ASSINATURA',
    'CONTRATO EM ASSINATURA E CONFISSÃO ASSINADA',
    'CONTRATO ASSINADO E CONFISSÃO PENDENTE',
    'PROBLEMA NA ASSINATURA DO FINANCIAMENTO',
    'CONTRATO E CONFISSÃO ASSINADOS',
    'CHECK-LIST DE REPASSE APTO PARA CONFERENCIA',
    'AGUARDANDO REPACTUAÇÃO',
    'CHECK-LIST DE REPASSE REPROVADO',
    'CHECK-LIST DE REPASSE APROVADO'
  ));

-- Parcelas alteram somente valores/atualização. A fase é selecionada pela gestão e não é inferida pelo saldo.
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
  from public.crm_sales_receipts where sale_id = p_sale_id;
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
