-- Extensões do CRM Mundo Apto. Migração aditiva: não apaga nem reescreve registros existentes.

alter table public.crm_audit
  add column if not exists actor_name text,
  add column if not exists actor_role text,
  add column if not exists before_values jsonb not null default '{}'::jsonb,
  add column if not exists after_values jsonb not null default '{}'::jsonb;

alter table public.crm_leads
  add column if not exists phone_correction_required boolean not null default false,
  add column if not exists phone_correction_requested_at timestamptz,
  add column if not exists phone_correction_requested_by uuid references public.crm_users(id) on delete set null,
  add column if not exists phone_correction_notes text not null default '',
  add column if not exists phone_corrected_at timestamptz,
  add column if not exists phone_corrected_by uuid references public.crm_users(id) on delete set null;

create table if not exists public.crm_lead_attempts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.crm_leads(id) on delete cascade,
  attempt_number smallint not null check (attempt_number between 1 and 7),
  at timestamptz not null default now(),
  actor_id uuid references public.crm_users(id) on delete set null,
  actor_name text not null,
  status_at_attempt text not null,
  notes text not null default '' check (char_length(notes) <= 1000),
  unique (lead_id, attempt_number)
);

create index if not exists crm_lead_attempts_lead_at_idx
  on public.crm_lead_attempts (lead_id, at desc);

create or replace function public.crm_add_contact_attempt(
  p_lead_id uuid,
  p_actor_id uuid,
  p_actor_name text,
  p_notes text default ''
)
returns setof public.crm_lead_attempts
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_next smallint;
  v_status text;
  v_at timestamptz := now();
  v_attempt public.crm_lead_attempts%rowtype;
begin
  select status into v_status
  from public.crm_leads where id = p_lead_id and deleted_at is null for update;
  if not found then raise exception 'lead_not_found'; end if;
  select coalesce(max(attempt_number), 0) + 1 into v_next
  from public.crm_lead_attempts where lead_id = p_lead_id;
  if v_next > 7 then raise exception 'attempt_limit_reached'; end if;
  insert into public.crm_lead_attempts (lead_id, attempt_number, at, actor_id, actor_name, status_at_attempt, notes)
  values (p_lead_id, v_next, v_at, p_actor_id, p_actor_name, v_status, left(coalesce(p_notes, ''), 1000))
  returning * into v_attempt;

  update public.crm_leads
  set sdr_updated_at = v_at, sdr_updated_by = p_actor_id, updated_at = v_at, updated_by = p_actor_id
  where id = p_lead_id;

  insert into public.crm_sdr_history (lead_id, at, user_id, user_name, status, feedback, source)
  select p_lead_id, v_at, p_actor_id, p_actor_name, v_status,
         coalesce(nullif(trim(p_notes), ''), 'Tentativa registrada sem observação adicional.'),
         'Tentativa ' || v_next || ' de contato registrada'
  from public.crm_leads where id = p_lead_id;

  return next v_attempt;
  return;
end;
$$;

revoke all on function public.crm_add_contact_attempt(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.crm_add_contact_attempt(uuid, uuid, text, text) to service_role;

create table if not exists public.crm_broker_profiles (
  broker_id uuid primary key references public.crm_users(id) on delete restrict,
  cpf text not null default '',
  cnpj text not null default '',
  creci text not null default '',
  address text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.crm_users(id) on delete set null
);

create table if not exists public.crm_sales (
  id uuid primary key default gen_random_uuid(),
  internal_number text not null unique,
  process_number text not null default '',
  lead_id uuid references public.crm_leads(id) on delete set null,
  buyer_name text not null check (char_length(buyer_name) between 1 and 150),
  development_id text references public.crm_developments(id) on delete set null,
  broker_id uuid not null references public.crm_users(id) on delete restrict,
  sold_at date not null,
  unit text not null default '' check (char_length(unit) <= 100),
  unit_value numeric(14,2) not null default 0 check (unit_value >= 0),
  sale_status text not null default 'Cadastrada'
    check (sale_status in ('Cadastrada','Em conferência','Com pendência','Regularizada','Cancelada')),
  has_pending boolean not null default false,
  pending_description text not null default '' check (char_length(pending_description) <= 2000),
  accounted boolean not null default false,
  accounted_at timestamptz,
  accounted_by uuid references public.crm_users(id) on delete set null,
  expected_repass numeric(14,2) not null default 0 check (expected_repass >= 0),
  repass_status text not null default 'Aguardando repasse'
    check (repass_status in ('Aguardando repasse','Em andamento','Repasse parcial','Repasse concluído','Suspenso','Cancelado')),
  notes text not null default '' check (char_length(notes) <= 3000),
  created_at timestamptz not null default now(),
  created_by uuid not null references public.crm_users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.crm_users(id),
  deleted_at timestamptz,
  deleted_by uuid references public.crm_users(id) on delete set null
);

create index if not exists crm_sales_sold_at_idx on public.crm_sales (sold_at desc);
create index if not exists crm_sales_broker_idx on public.crm_sales (broker_id, sold_at desc);
create index if not exists crm_sales_repass_status_idx on public.crm_sales (repass_status, sold_at desc);

create table if not exists public.crm_sales_receipts (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.crm_sales(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  received_at date not null,
  notes text not null default '' check (char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  created_by uuid not null references public.crm_users(id)
);

create index if not exists crm_sales_receipts_sale_date_idx
  on public.crm_sales_receipts (sale_id, received_at desc);

-- Lança a parcela e recalcula o saldo/status sob bloqueio da venda, sem perder valores concorrentes.
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
  v_status text;
  v_now timestamptz := now();
begin
  select * into v_sale
  from public.crm_sales
  where id = p_sale_id and deleted_at is null
  for update;
  if not found then raise exception 'sale_not_found'; end if;
  if v_sale.sale_status = 'Cancelada' or v_sale.repass_status = 'Cancelado' then raise exception 'sale_cancelled'; end if;
  if p_amount <= 0 then raise exception 'invalid_receipt_amount'; end if;

  select coalesce(sum(amount), 0) into v_prior
  from public.crm_sales_receipts where sale_id = p_sale_id;
  insert into public.crm_sales_receipts (sale_id, amount, received_at, notes, created_by)
  values (p_sale_id, p_amount, p_received_at, left(coalesce(p_notes, ''), 1000), p_actor_id)
  returning id into v_receipt_id;

  v_total := v_prior + p_amount;
  v_status := v_sale.repass_status;
  if v_sale.expected_repass > 0 then
    if v_total >= v_sale.expected_repass then
      v_status := 'Repasse concluído';
    elsif v_total > 0 then
      v_status := 'Repasse parcial';
    end if;
  end if;

  update public.crm_sales
  set repass_status = v_status, updated_at = v_now, updated_by = p_actor_id
  where id = p_sale_id;

  return query select v_receipt_id, v_total, v_sale.expected_repass - v_total, v_status, v_sale.repass_status;
end;
$$;

revoke all on function public.crm_add_sale_receipt(uuid, uuid, numeric, date, text) from public, anon, authenticated;
grant execute on function public.crm_add_sale_receipt(uuid, uuid, numeric, date, text) to service_role;

create table if not exists public.crm_contracts (
  id uuid primary key default gen_random_uuid(),
  contract_number text not null unique,
  lead_id uuid not null references public.crm_leads(id) on delete restrict,
  broker_id uuid not null references public.crm_users(id) on delete restrict,
  sdr_id uuid not null references public.crm_users(id) on delete restrict,
  manager_id uuid not null references public.crm_users(id) on delete restrict,
  buyer_name text not null check (char_length(buyer_name) between 1 and 150),
  buyer_cpf text not null default '',
  buyer_address text not null default '',
  development_id text not null references public.crm_developments(id) on delete restrict,
  unit text not null check (char_length(unit) between 1 and 100),
  unit_value numeric(14,2) not null check (unit_value >= 0),
  gross_commission numeric(14,2) not null check (gross_commission >= 0),
  broker_commission numeric(14,2) generated always as (floor(gross_commission * 50) / 100) stored,
  sdr_commission numeric(14,2) generated always as (gross_commission - floor(gross_commission * 50) / 100) stored,
  has_prize boolean not null default false,
  gross_prize numeric(14,2) not null default 0 check (gross_prize >= 0),
  broker_prize numeric(14,2) generated always as (floor(gross_prize * 50) / 100) stored,
  sdr_prize numeric(14,2) generated always as (gross_prize - floor(gross_prize * 50) / 100) stored,
  status text not null default 'Rascunho'
    check (status in ('Rascunho','Gerado para assinatura','Assinado','Cancelado')),
  template_snapshot text not null default '',
  generated_at timestamptz,
  generated_by uuid references public.crm_users(id) on delete set null,
  signed_at timestamptz,
  signed_uploaded_by uuid references public.crm_users(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.crm_users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.crm_users(id)
);

create index if not exists crm_contracts_lead_idx on public.crm_contracts (lead_id, created_at desc);
create index if not exists crm_contracts_broker_idx on public.crm_contracts (broker_id, status, created_at desc);
create index if not exists crm_contracts_sdr_idx on public.crm_contracts (sdr_id, status, created_at desc);

create table if not exists public.crm_contract_documents (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.crm_contracts(id) on delete restrict,
  document_type text not null check (document_type in ('generated','signed')),
  storage_path text not null unique,
  original_name text not null check (char_length(original_name) between 1 and 255),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  uploaded_by uuid not null references public.crm_users(id),
  created_at timestamptz not null default now()
);

create index if not exists crm_contract_documents_contract_idx
  on public.crm_contract_documents (contract_id, document_type, created_at desc);

alter table public.crm_lead_attempts enable row level security;
alter table public.crm_broker_profiles enable row level security;
alter table public.crm_sales enable row level security;
alter table public.crm_sales_receipts enable row level security;
alter table public.crm_contracts enable row level security;
alter table public.crm_contract_documents enable row level security;

revoke all on public.crm_lead_attempts, public.crm_broker_profiles, public.crm_sales,
  public.crm_sales_receipts, public.crm_contracts, public.crm_contract_documents
  from anon, authenticated;
revoke all on public.crm_audit from anon, authenticated;
grant all on public.crm_lead_attempts, public.crm_broker_profiles, public.crm_sales,
  public.crm_sales_receipts, public.crm_contracts, public.crm_contract_documents, public.crm_audit
  to service_role;

-- Os arquivos de contrato são privados; leitura e gravação passam pela função autenticada do CRM.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('crm-contracts', 'crm-contracts', false, 10485760,
  array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/msword'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
