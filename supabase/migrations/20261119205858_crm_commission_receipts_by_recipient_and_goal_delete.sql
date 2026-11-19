-- Cada participante de uma venda com SDR recebe seu próprio recibo.
-- O CRM continua guardando uma cópia por venda e destinatário.
alter table public.crm_commission_documents
  add column if not exists recipient_id uuid references public.crm_users(id) on delete restrict,
  add column if not exists recipient_role text;

update public.crm_commission_documents
set recipient_id = broker_id,
    recipient_role = 'Corretor'
where recipient_id is null or recipient_role is null;

alter table public.crm_commission_documents
  alter column recipient_id set not null,
  alter column recipient_role set default 'Corretor';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.crm_commission_documents'::regclass
      and conname = 'crm_commission_documents_recipient_role_check'
  ) then
    alter table public.crm_commission_documents
      add constraint crm_commission_documents_recipient_role_check
      check (recipient_role in ('Corretor','SDR'));
  end if;
end
$$;

create index if not exists crm_commission_documents_recipient_created_idx
  on public.crm_commission_documents (recipient_id, created_at desc)
  where archived_at is null;

drop index if exists public.crm_commission_documents_one_active_receipt_per_sale_idx;
create unique index if not exists crm_commission_documents_one_active_receipt_per_sale_recipient_idx
  on public.crm_commission_documents (sale_id, recipient_id)
  where archived_at is null and document_type = 'commission_receipt' and sale_id is not null;

-- Remover uma meta exclui também suas revisões sem gravar uma auditoria de exclusão.
create or replace function public.crm_delete_operation_goal(
  p_broker_id uuid,
  p_metric text,
  p_cycle text,
  p_starts_on date,
  p_ends_on date
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_deleted integer := 0;
begin
  if p_broker_id is null or p_metric not in ('prospections','visits','sales')
    or p_cycle not in ('weekly','monthly') or p_starts_on is null or p_ends_on < p_starts_on then
    raise exception 'invalid_operation_goal';
  end if;

  update public.crm_production_goals
     set supersedes_id = null
   where broker_id = p_broker_id and metric = p_metric and cycle = p_cycle
     and starts_on = p_starts_on and ends_on = p_ends_on;

  delete from public.crm_production_goals
   where broker_id = p_broker_id and metric = p_metric and cycle = p_cycle
     and starts_on = p_starts_on and ends_on = p_ends_on;
  get diagnostics v_deleted = row_count;

  return jsonb_build_object('ok', true, 'deletedCount', v_deleted);
end;
$$;

revoke all on function public.crm_delete_operation_goal(uuid,text,text,date,date) from public, anon, authenticated;
grant execute on function public.crm_delete_operation_goal(uuid,text,text,date,date) to service_role;

create or replace function private.crm_enqueue_receipt_signature_reminders()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_inserted integer := 0;
begin
  insert into public.crm_in_app_notifications (
    recipient_id, commission_document_id, event_type, title, message, dedupe_key, created_at
  )
  select d.recipient_id, d.id, 'commission_receipt_signature_reminder',
    'Recibo ainda aguarda assinatura',
    'Seu recibo de comissão continua pendente. Envie o PDF assinado pelo CRM para a gestão conferir.',
    'commission:' || d.id::text || ':signature-reminder:' || to_char(now() at time zone 'America/Sao_Paulo', 'YYYYMMDD') || ':' || d.recipient_id::text,
    now()
  from public.crm_commission_documents d
  join public.crm_users u on u.id = d.recipient_id and u.active = true and u.deleted_at is null
  where d.document_type = 'commission_receipt'
    and d.signature_status = 'pending'
    and d.archived_at is null
    and d.generated_storage_path is not null
    and d.signed_uploaded_at is null
    and d.created_at <= now() - interval '24 hours'
  on conflict (dedupe_key) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke all on function private.crm_enqueue_receipt_signature_reminders() from public, anon, authenticated;

do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'mundo-apto-receipt-signature-reminders' limit 1;
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
  perform cron.schedule('mundo-apto-receipt-signature-reminders', '0 9 * * *', 'select private.crm_enqueue_receipt_signature_reminders()');
end;
$$;
