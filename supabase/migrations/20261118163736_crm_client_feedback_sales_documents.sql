-- Complementa apenas os pedidos aprovados no feedback da cliente.
-- Mantém os registros e fases já existentes; exclusões são reversíveis.

alter table public.crm_production_entries
  add column if not exists folder_count integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.crm_production_entries'::regclass
      and conname = 'crm_production_entries_folder_count_check'
  ) then
    alter table public.crm_production_entries
      add constraint crm_production_entries_folder_count_check
      check (folder_count between 0 and 1000000);
  end if;
end
$$;

alter table public.crm_contracts
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.crm_users(id) on delete set null;

create index if not exists crm_contracts_active_created_idx
  on public.crm_contracts (created_at desc)
  where deleted_at is null;

alter table public.crm_sales drop constraint if exists crm_sales_repass_status_check;
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
  'COMISSÃO NA CABEÇA',
  'Aguardando repasse','Em andamento','Repasse parcial','Repasse concluído','Suspenso','Cancelado'
));

create table if not exists public.crm_commission_documents (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid references public.crm_sales(id) on delete restrict,
  broker_id uuid not null references public.crm_users(id) on delete restrict,
  sdr_id uuid references public.crm_users(id) on delete restrict,
  document_type text not null check (document_type in ('commission_receipt','invoice','payment_proof','historical')),
  signature_status text not null default 'not_required' check (signature_status in ('not_required','pending','signed')),
  payment_status text not null default 'pending' check (payment_status in ('pending','paid','not_applicable')),
  commission_base numeric(14,2) not null default 0 check (commission_base >= 0),
  commission_rate_pct numeric(7,4) not null default 2.5 check (commission_rate_pct between 0 and 100),
  gross_commission numeric(14,2) not null default 0 check (gross_commission >= 0),
  withholding_rate_pct numeric(7,4) not null default 0 check (withholding_rate_pct between 0 and 100),
  withholding_amount numeric(14,2) not null default 0 check (withholding_amount >= 0),
  net_commission numeric(14,2) not null default 0 check (net_commission >= 0),
  broker_amount numeric(14,2) not null default 0 check (broker_amount >= 0),
  sdr_amount numeric(14,2) not null default 0 check (sdr_amount >= 0),
  payment_date date,
  payment_completed_at timestamptz,
  generated_storage_path text,
  signed_storage_path text,
  storage_path text,
  original_name text not null default '' check (char_length(original_name) <= 255),
  mime_type text not null default '' check (char_length(mime_type) <= 120),
  size_bytes bigint not null default 0 check (size_bytes between 0 and 10485760),
  notes text not null default '' check (char_length(notes) <= 3000),
  signed_uploaded_at timestamptz,
  signed_uploaded_by uuid references public.crm_users(id) on delete set null,
  broker_signature_confirmed boolean not null default false,
  sdr_signature_confirmed boolean not null default false,
  archived_at timestamptz,
  archived_by uuid references public.crm_users(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.crm_users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.crm_users(id) on delete restrict,
  check (sdr_id is not null or sdr_amount = 0),
  check (broker_amount + sdr_amount = net_commission or document_type <> 'commission_receipt')
);

create index if not exists crm_commission_documents_broker_created_idx
  on public.crm_commission_documents (broker_id, created_at desc)
  where archived_at is null;
create index if not exists crm_commission_documents_sdr_created_idx
  on public.crm_commission_documents (sdr_id, created_at desc)
  where archived_at is null;
create index if not exists crm_commission_documents_sale_idx
  on public.crm_commission_documents (sale_id, created_at desc)
  where archived_at is null;
create index if not exists crm_commission_documents_queue_idx
  on public.crm_commission_documents (signature_status, payment_status, payment_date)
  where archived_at is null;
create unique index if not exists crm_commission_documents_one_active_receipt_per_sale_idx
  on public.crm_commission_documents (sale_id)
  where archived_at is null and document_type = 'commission_receipt' and sale_id is not null;

alter table public.crm_commission_documents enable row level security;
revoke all on public.crm_commission_documents from anon, authenticated;
grant all on public.crm_commission_documents to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('crm-finance-documents', 'crm-finance-documents', false, 10485760,
  array['application/pdf','image/jpeg','image/png','image/webp']::text[])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Importa toda a operação de forma atômica e grava a auditoria na mesma transação.
-- Isso evita centenas de chamadas sequenciais a partir da função síncrona do Netlify.
create or replace function public.crm_import_operations(
  p_section text,
  p_rows jsonb,
  p_actor_id uuid,
  p_actor_email text,
  p_actor_name text,
  p_actor_role text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row jsonb;
  v_broker_id uuid;
  v_work_date date;
  v_entry_id uuid;
  v_old public.crm_production_entries%rowtype;
  v_saved public.crm_production_entries%rowtype;
  v_attendance public.crm_attendance_records%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_action text;
  v_entity_type text;
  v_changed text;
  v_created integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_prospections integer;
  v_interactions integer;
  v_appointments integer;
  v_visits integer;
  v_sales integer;
  v_folders integer;
  v_notes text;
  v_shift text;
begin
  if p_section not in ('production','attendance') then raise exception 'invalid_import_section'; end if;
  if p_actor_id is null or coalesce(p_actor_email,'') = '' or coalesce(p_actor_name,'') = '' then raise exception 'invalid_import_actor'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 500 then raise exception 'invalid_import_rows'; end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_broker_id := nullif(v_row->>'brokerId','')::uuid;
    if v_broker_id is null or not exists (
      select 1 from public.crm_users u where u.id = v_broker_id and u.role = 'Corretor' and u.active = true and u.deleted_at is null
    ) then raise exception 'invalid_import_broker'; end if;

    if p_section = 'production' then
      v_work_date := nullif(v_row->>'workDate','')::date;
      if v_work_date is null or v_work_date > (now() at time zone 'America/Sao_Paulo')::date then raise exception 'invalid_import_date'; end if;
      v_prospections := coalesce(nullif(v_row->>'prospections','')::integer,0);
      v_interactions := coalesce(nullif(v_row->>'interactions','')::integer,0);
      v_appointments := coalesce(nullif(v_row->>'appointments','')::integer,0);
      v_visits := coalesce(nullif(v_row->>'visits','')::integer,0);
      v_sales := coalesce(nullif(v_row->>'sales','')::integer,0);
      v_folders := coalesce(nullif(v_row->>'folders','')::integer,0);
      v_notes := left(coalesce(v_row->>'notes',''),1500);
      if least(v_prospections,v_interactions,v_appointments,v_visits,v_sales,v_folders) < 0
        or greatest(v_prospections,v_interactions,v_appointments,v_visits,v_sales,v_folders) > 1000000 then raise exception 'invalid_import_count'; end if;
      v_entry_id := nullif(v_row->>'id','')::uuid;

      if v_entry_id is null then
        insert into public.crm_production_entries (
          broker_id, work_date, prospecting_count, interaction_count, appointment_count,
          visit_count, sale_count, folder_count, notes, created_by, updated_by
        ) values (
          v_broker_id, v_work_date, v_prospections, v_interactions, v_appointments,
          v_visits, v_sales, v_folders, v_notes, p_actor_id, p_actor_id
        ) returning * into v_saved;
        v_before := '{}'::jsonb;
        v_action := 'operations.production.create';
        v_created := v_created + 1;
      else
        select * into v_old from public.crm_production_entries
         where id = v_entry_id and broker_id = v_broker_id and deleted_at is null for update;
        if not found then raise exception 'import_update_record_unavailable'; end if;
        v_before := jsonb_build_object(
          'brokerId',v_old.broker_id,'workDate',v_old.work_date,'prospections',v_old.prospecting_count,
          'interactions',v_old.interaction_count,'appointments',v_old.appointment_count,'visits',v_old.visit_count,
          'sales',v_old.sale_count,'folders',v_old.folder_count,'notes',v_old.notes
        );
        update public.crm_production_entries set
          work_date = v_work_date, prospecting_count = v_prospections, interaction_count = v_interactions,
          appointment_count = v_appointments, visit_count = v_visits, sale_count = v_sales,
          folder_count = v_folders, notes = v_notes, updated_at = now(), updated_by = p_actor_id
        where id = v_entry_id returning * into v_saved;
        v_action := 'operations.production.update';
        v_updated := v_updated + 1;
      end if;

      v_after := jsonb_build_object(
        'brokerId',v_saved.broker_id,'workDate',v_saved.work_date,'prospections',v_saved.prospecting_count,
        'interactions',v_saved.interaction_count,'appointments',v_saved.appointment_count,'visits',v_saved.visit_count,
        'sales',v_saved.sale_count,'folders',v_saved.folder_count,'notes',v_saved.notes
      );
      v_entity_type := 'operation_production';
      select string_agg(changed.key, ',') into v_changed
      from (
        select coalesce(a.key,b.key) as key, a.value as new_value, b.value as old_value
        from jsonb_each(v_after) a full join jsonb_each(v_before) b using (key)
        where a.value is distinct from b.value
      ) changed;
      insert into public.crm_audit (user_id,email,actor_name,actor_role,action,entity_type,entity_id,changed_fields,module,before_values,after_values)
      values (p_actor_id,p_actor_email,p_actor_name,p_actor_role,v_action,v_entity_type,v_saved.id::text,coalesce(v_changed,''),'operations',v_before,v_after);
    else
      v_work_date := nullif(v_row->>'attendanceDate','')::date;
      v_shift := coalesce(v_row->>'shift','');
      if v_work_date is null or v_work_date > (now() at time zone 'America/Sao_Paulo')::date then raise exception 'invalid_import_date'; end if;
      if v_shift not in ('morning','afternoon','night') then raise exception 'invalid_import_shift'; end if;
      insert into public.crm_attendance_records (broker_id,attendance_date,shift,created_by,updated_by)
      values (v_broker_id,v_work_date,v_shift,p_actor_id,p_actor_id)
      on conflict (broker_id,attendance_date,shift) where deleted_at is null do nothing
      returning * into v_attendance;
      if not found then
        v_skipped := v_skipped + 1;
        continue;
      end if;
      v_before := '{}'::jsonb;
      v_after := jsonb_build_object('brokerId',v_attendance.broker_id,'attendanceDate',v_attendance.attendance_date,'shift',v_attendance.shift,'present',true);
      v_action := 'operations.attendance.create';
      v_entity_type := 'operation_attendance';
      v_changed := 'brokerId,attendanceDate,shift,present';
      insert into public.crm_audit (user_id,email,actor_name,actor_role,action,entity_type,entity_id,changed_fields,module,before_values,after_values)
      values (p_actor_id,p_actor_email,p_actor_name,p_actor_role,v_action,v_entity_type,v_attendance.id::text,v_changed,'operations',v_before,v_after);
      v_created := v_created + 1;
    end if;
  end loop;

  return jsonb_build_object('ok',true,'createdCount',v_created,'updatedCount',v_updated,'skippedCount',v_skipped);
end;
$$;

revoke all on function public.crm_import_operations(text,jsonb,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.crm_import_operations(text,jsonb,uuid,text,text,text) to service_role;
