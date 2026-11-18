-- Registra notificações internas da agenda e a confirmação das assinaturas
-- exigidas no recibo. As alterações são aditivas e preservam documentos antigos.

alter table public.crm_commission_documents
  add column if not exists manager_id uuid references public.crm_users(id) on delete restrict,
  add column if not exists manager_signature_confirmed boolean not null default false,
  add column if not exists manager_signature_confirmed_at timestamptz,
  add column if not exists manager_signature_confirmed_by uuid references public.crm_users(id) on delete set null,
  add column if not exists broker_signature_confirmed_at timestamptz,
  add column if not exists broker_signature_confirmed_by uuid references public.crm_users(id) on delete set null,
  add column if not exists sdr_signature_confirmed_at timestamptz,
  add column if not exists sdr_signature_confirmed_by uuid references public.crm_users(id) on delete set null;

create index if not exists crm_commission_documents_manager_created_idx
  on public.crm_commission_documents (manager_id, created_at desc)
  where archived_at is null and manager_id is not null;

create table if not exists public.crm_in_app_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.crm_users(id) on delete restrict,
  appointment_id uuid references public.crm_appointments(id) on delete set null,
  commission_document_id uuid references public.crm_commission_documents(id) on delete set null,
  appointment_start_at timestamptz,
  event_type text not null check (event_type in (
    'appointment_created','appointment_updated','appointment_cancelled',
    'appointment_reminder_24h','appointment_reminder_1h',
    'commission_receipt_signature_requested','commission_receipt_signed_file_uploaded','commission_receipt_signature_reminder'
  )),
  title text not null check (char_length(title) between 1 and 160),
  message text not null check (char_length(message) between 1 and 1000),
  dedupe_key text not null unique check (char_length(dedupe_key) between 1 and 300),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists crm_in_app_notifications_recipient_created_idx
  on public.crm_in_app_notifications (recipient_id, created_at desc);
create index if not exists crm_in_app_notifications_appointment_idx
  on public.crm_in_app_notifications (appointment_id, event_type, appointment_start_at);
create index if not exists crm_in_app_notifications_commission_document_idx
  on public.crm_in_app_notifications (commission_document_id, event_type)
  where commission_document_id is not null;

alter table public.crm_in_app_notifications enable row level security;
revoke all on public.crm_in_app_notifications from public, anon, authenticated;
grant all on public.crm_in_app_notifications to service_role;

-- O job roda apenas no banco; a função fica em schema não exposto e não recebe
-- permissões de execução das roles da API pública.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.crm_enqueue_appointment_reminders()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_inserted integer := 0;
begin
  with upcoming as (
    select a.id, a.created_by, a.client_name, a.starts_at,
      case when a.starts_at <= now() + interval '1 hour'
        then 'appointment_reminder_1h' else 'appointment_reminder_24h' end as event_type,
      case when a.starts_at <= now() + interval '1 hour'
        then 'Atendimento em até 1 hora' else 'Atendimento nas próximas 24 horas' end as title
    from public.crm_appointments a
    where a.deleted_at is null and a.status = 'Agendado'
      and a.starts_at > now() and a.starts_at <= now() + interval '24 hours'
  ), recipients as (
    select upcoming.*, u.id as recipient_id
    from upcoming
    join public.crm_users u on u.active = true and u.deleted_at is null
      and u.role in ('Gerente','Assistente')
    union
    select upcoming.*, creator.id as recipient_id
    from upcoming
    join public.crm_users creator on creator.id = upcoming.created_by
      and creator.role = 'Corretor' and creator.active = true and creator.deleted_at is null
  )
  insert into public.crm_in_app_notifications (
    recipient_id, appointment_id, appointment_start_at, event_type, title, message, dedupe_key
  )
  select recipient_id, id, starts_at, event_type, title,
    client_name || ' · ' || to_char(starts_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY "às" HH24:MI'),
    'appointment:' || id::text || ':' || starts_at::text || ':' || event_type || ':' || recipient_id::text
  from recipients
  on conflict (dedupe_key) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke all on function private.crm_enqueue_appointment_reminders() from public, anon, authenticated;

create extension if not exists pg_cron;

create or replace function private.crm_enqueue_receipt_signature_reminders()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_inserted integer := 0;
begin
  with pending as (
    select d.id, d.broker_id, d.sdr_id
    from public.crm_commission_documents d
    where d.document_type = 'commission_receipt'
      and d.signature_status = 'pending'
      and d.archived_at is null
      and d.generated_storage_path is not null
      and d.signed_uploaded_at is null
      and d.created_at <= now() - interval '24 hours'
  ), recipients as (
    select pending.id as document_id, pending.broker_id as recipient_id from pending
    union
    select pending.id as document_id, pending.sdr_id as recipient_id from pending where pending.sdr_id is not null
  )
  insert into public.crm_in_app_notifications (
    recipient_id, commission_document_id, event_type, title, message, dedupe_key, created_at
  )
  select recipients.recipient_id, recipients.document_id, 'commission_receipt_signature_reminder',
    'Recibo ainda aguarda assinatura',
    'O recibo de comissão continua pendente. Envie o PDF assinado pelo CRM para a gestão conferir.',
    'commission:' || recipients.document_id::text || ':signature-reminder:' || to_char(now() at time zone 'America/Sao_Paulo', 'YYYYMMDD') || ':' || recipients.recipient_id::text,
    now()
  from recipients
  join public.crm_users u on u.id = recipients.recipient_id and u.active = true and u.deleted_at is null
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
  select jobid into existing_job from cron.job where jobname = 'mundo-apto-appointment-reminders' limit 1;
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
  select jobid into existing_job from cron.job where jobname = 'mundo-apto-receipt-signature-reminders' limit 1;
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
  perform cron.schedule('mundo-apto-appointment-reminders', '*/5 * * * *', 'select private.crm_enqueue_appointment_reminders()');
  perform cron.schedule('mundo-apto-receipt-signature-reminders', '0 9 * * *', 'select private.crm_enqueue_receipt_signature_reminders()');
end;
$$;
