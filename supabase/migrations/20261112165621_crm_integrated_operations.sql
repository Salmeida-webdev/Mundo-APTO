-- Integra o módulo Sharks Fênix ao CRM sem tocar nos cadastros existentes.
-- Uma única identidade crm_users/auth.users atende relacionamento e operação.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'crm_users' and column_name = 'operations_access'
  ) then
    alter table public.crm_users add column operations_access text not null default 'none';
    update public.crm_users
    set operations_access = case
      when role = 'Corretor' then 'broker'
      when role = 'SDR' then 'sdr'
      when role in ('Administrador','Gerente','Coordenador','Assistente') then 'viewer'
      else 'none'
    end;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'crm_users_operations_access_check'
      and conrelid = 'public.crm_users'::regclass
  ) then
    alter table public.crm_users
      add constraint crm_users_operations_access_check
      check (operations_access in ('none','broker','sdr','viewer','manager'));
  end if;
end
$$;

alter table public.crm_audit
  add column if not exists module text not null default 'crm';

create index if not exists crm_audit_module_at_idx
  on public.crm_audit (module, at desc);

create table if not exists public.crm_production_entries (
  id uuid primary key default gen_random_uuid(),
  broker_id uuid not null references public.crm_users(id) on delete restrict,
  work_date date not null,
  prospecting_count integer not null default 0 check (prospecting_count between 0 and 1000000),
  interaction_count integer not null default 0 check (interaction_count between 0 and 1000000),
  appointment_count integer not null default 0 check (appointment_count between 0 and 1000000),
  visit_count integer not null default 0 check (visit_count between 0 and 1000000),
  sale_count integer not null default 0 check (sale_count between 0 and 1000000),
  notes text not null default '' check (char_length(notes) <= 1500),
  created_at timestamptz not null default now(),
  created_by uuid not null references public.crm_users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.crm_users(id) on delete restrict,
  deleted_at timestamptz,
  deleted_by uuid references public.crm_users(id) on delete set null
);

create index if not exists crm_production_entries_broker_date_idx
  on public.crm_production_entries (broker_id, work_date desc)
  where deleted_at is null;
create index if not exists crm_production_entries_date_idx
  on public.crm_production_entries (work_date desc)
  where deleted_at is null;

create table if not exists public.crm_production_goals (
  id uuid primary key default gen_random_uuid(),
  broker_id uuid not null references public.crm_users(id) on delete restrict,
  metric text not null check (metric in ('prospections','visits','sales')),
  cycle text not null check (cycle in ('weekly','monthly')),
  starts_on date not null,
  ends_on date not null,
  target_count integer not null check (target_count between 1 and 1000000),
  revision integer not null check (revision >= 1),
  supersedes_id uuid references public.crm_production_goals(id) on delete restrict,
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.crm_users(id) on delete restrict,
  check (ends_on >= starts_on),
  check ((cycle = 'weekly' and extract(isodow from starts_on) = 1 and ends_on = starts_on + 6)
      or (cycle = 'monthly' and extract(day from starts_on) = 1 and ends_on = (date_trunc('month', starts_on::timestamp) + interval '1 month - 1 day')::date))
);

create unique index if not exists crm_production_goals_current_unique_idx
  on public.crm_production_goals (broker_id, metric, cycle, starts_on, ends_on)
  where is_current = true;
create index if not exists crm_production_goals_period_idx
  on public.crm_production_goals (starts_on desc, broker_id, metric);

create table if not exists public.crm_attendance_records (
  id uuid primary key default gen_random_uuid(),
  broker_id uuid not null references public.crm_users(id) on delete restrict,
  attendance_date date not null,
  shift text not null check (shift in ('morning','afternoon','night')),
  created_at timestamptz not null default now(),
  created_by uuid not null references public.crm_users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.crm_users(id) on delete restrict,
  deleted_at timestamptz,
  deleted_by uuid references public.crm_users(id) on delete set null
);

create unique index if not exists crm_attendance_active_unique_idx
  on public.crm_attendance_records (broker_id, attendance_date, shift)
  where deleted_at is null;
create index if not exists crm_attendance_date_shift_idx
  on public.crm_attendance_records (attendance_date desc, shift)
  where deleted_at is null;

-- Substituir meta mantém versões anteriores para auditoria e consulta histórica.
create or replace function public.crm_save_operation_goal(
  p_broker_id uuid,
  p_metric text,
  p_cycle text,
  p_starts_on date,
  p_ends_on date,
  p_target_count integer,
  p_actor_id uuid
)
returns public.crm_production_goals
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_previous public.crm_production_goals%rowtype;
  v_saved public.crm_production_goals%rowtype;
  v_key text;
begin
  if p_broker_id is null or p_actor_id is null then raise exception 'invalid_goal_owner'; end if;
  if p_metric not in ('prospections','visits','sales') then raise exception 'invalid_goal_metric'; end if;
  if p_cycle not in ('weekly','monthly') then raise exception 'invalid_goal_cycle'; end if;
  if p_target_count is null or p_target_count < 1 or p_target_count > 1000000 then raise exception 'invalid_goal_target'; end if;
  if p_cycle = 'weekly' and (extract(isodow from p_starts_on) <> 1 or p_ends_on <> p_starts_on + 6) then raise exception 'invalid_week_range'; end if;
  if p_cycle = 'monthly' and (extract(day from p_starts_on) <> 1 or p_ends_on <> (date_trunc('month', p_starts_on::timestamp) + interval '1 month - 1 day')::date) then raise exception 'invalid_month_range'; end if;

  v_key := p_broker_id::text || ':' || p_metric || ':' || p_cycle || ':' || p_starts_on::text;
  perform pg_advisory_xact_lock(hashtextextended(v_key, 0));

  select * into v_previous
  from public.crm_production_goals
  where broker_id = p_broker_id and metric = p_metric and cycle = p_cycle
    and starts_on = p_starts_on and ends_on = p_ends_on and is_current = true
  for update;

  if found then
    update public.crm_production_goals set is_current = false where id = v_previous.id;
    insert into public.crm_production_goals (broker_id, metric, cycle, starts_on, ends_on, target_count, revision, supersedes_id, is_current, created_by)
    values (p_broker_id, p_metric, p_cycle, p_starts_on, p_ends_on, p_target_count, v_previous.revision + 1, v_previous.id, true, p_actor_id)
    returning * into v_saved;
  else
    insert into public.crm_production_goals (broker_id, metric, cycle, starts_on, ends_on, target_count, revision, supersedes_id, is_current, created_by)
    values (p_broker_id, p_metric, p_cycle, p_starts_on, p_ends_on, p_target_count, 1, null, true, p_actor_id)
    returning * into v_saved;
  end if;
  return v_saved;
end;
$$;

revoke all on function public.crm_save_operation_goal(uuid,text,text,date,date,integer,uuid) from public, anon, authenticated;
grant execute on function public.crm_save_operation_goal(uuid,text,text,date,date,integer,uuid) to service_role;

-- Marca/cancela presença de forma idempotente e evita duplicidade sob concorrência.
create or replace function public.crm_set_attendance(
  p_broker_id uuid,
  p_attendance_date date,
  p_shift text,
  p_present boolean,
  p_actor_id uuid
)
returns public.crm_attendance_records
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_record public.crm_attendance_records%rowtype;
  v_key text;
begin
  if p_broker_id is null or p_attendance_date is null or p_actor_id is null then raise exception 'invalid_attendance'; end if;
  if p_shift not in ('morning','afternoon','night') then raise exception 'invalid_attendance_shift'; end if;
  v_key := p_broker_id::text || ':' || p_attendance_date::text || ':' || p_shift;
  perform pg_advisory_xact_lock(hashtextextended(v_key, 0));
  select * into v_record from public.crm_attendance_records
   where broker_id = p_broker_id and attendance_date = p_attendance_date and shift = p_shift and deleted_at is null
   for update;
  if p_present then
    if found then return v_record; end if;
    insert into public.crm_attendance_records (broker_id, attendance_date, shift, created_by, updated_by)
    values (p_broker_id, p_attendance_date, p_shift, p_actor_id, p_actor_id)
    returning * into v_record;
    return v_record;
  end if;
  if not found then return null; end if;
  update public.crm_attendance_records
     set deleted_at = now(), deleted_by = p_actor_id, updated_at = now(), updated_by = p_actor_id
   where id = v_record.id
   returning * into v_record;
  return v_record;
end;
$$;

revoke all on function public.crm_set_attendance(uuid,date,text,boolean,uuid) from public, anon, authenticated;
grant execute on function public.crm_set_attendance(uuid,date,text,boolean,uuid) to service_role;

alter table public.crm_production_entries enable row level security;
alter table public.crm_production_goals enable row level security;
alter table public.crm_attendance_records enable row level security;

revoke all on public.crm_production_entries, public.crm_production_goals, public.crm_attendance_records from anon, authenticated;
grant all on public.crm_production_entries, public.crm_production_goals, public.crm_attendance_records to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables where pubname = 'supabase_realtime'
         and schemaname = 'public' and tablename = 'crm_production_entries'
     ) then
    alter publication supabase_realtime add table public.crm_production_entries;
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables where pubname = 'supabase_realtime'
         and schemaname = 'public' and tablename = 'crm_production_goals'
     ) then
    alter publication supabase_realtime add table public.crm_production_goals;
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables where pubname = 'supabase_realtime'
         and schemaname = 'public' and tablename = 'crm_attendance_records'
     ) then
    alter publication supabase_realtime add table public.crm_attendance_records;
  end if;
end
$$;
