-- Agenda, localização gerencial e ouvidoria aprovadas para a plataforma integrada.
-- VGV e farol de dias sem venda são derivados de vendas e usuários; não duplicam dados.

create table if not exists public.crm_appointments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.crm_leads(id) on delete set null,
  client_name text not null check (char_length(client_name) between 1 and 150),
  development_id text references public.crm_developments(id) on delete set null,
  stand text not null default '' check (char_length(stand) <= 120),
  broker_id uuid not null references public.crm_users(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'Agendado' check (status in ('Agendado','Realizado','Cancelado','Não compareceu')),
  notes text not null default '' check (char_length(notes) <= 1500),
  created_at timestamptz not null default now(),
  created_by uuid not null references public.crm_users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.crm_users(id) on delete restrict,
  deleted_at timestamptz,
  deleted_by uuid references public.crm_users(id) on delete set null,
  check (ends_at > starts_at),
  check (ends_at <= starts_at + interval '8 hours')
);

-- O bloqueio da aplicação detecta conflitos no uso normal; as exclusões abaixo
-- também fecham a corrida entre dois agendamentos simultâneos no mesmo horário.
create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'crm_appointments_broker_slot_excl'
      and conrelid = 'public.crm_appointments'::regclass
  ) then
    alter table public.crm_appointments
      add constraint crm_appointments_broker_slot_excl
      exclude using gist (
        broker_id with =,
        tstzrange(starts_at, ends_at, '[)') with &&
      ) where (deleted_at is null and status = 'Agendado');
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'crm_appointments_stand_slot_excl'
      and conrelid = 'public.crm_appointments'::regclass
  ) then
    alter table public.crm_appointments
      add constraint crm_appointments_stand_slot_excl
      exclude using gist (
        development_id with =,
        stand with =,
        tstzrange(starts_at, ends_at, '[)') with &&
      ) where (deleted_at is null and status = 'Agendado' and stand <> '');
  end if;
end;
$$;

create index if not exists crm_appointments_broker_start_idx
  on public.crm_appointments (broker_id, starts_at)
  where deleted_at is null and status <> 'Cancelado';
create index if not exists crm_appointments_start_idx
  on public.crm_appointments (starts_at)
  where deleted_at is null;
create index if not exists crm_appointments_lead_idx
  on public.crm_appointments (lead_id, starts_at desc)
  where lead_id is not null and deleted_at is null;

create table if not exists public.crm_manager_locations (
  id uuid primary key default gen_random_uuid(),
  manager_id uuid not null references public.crm_users(id) on delete restrict,
  location text not null check (char_length(location) between 1 and 180),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  notes text not null default '' check (char_length(notes) <= 800),
  created_at timestamptz not null default now(),
  created_by uuid not null references public.crm_users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.crm_users(id) on delete restrict,
  deleted_at timestamptz,
  deleted_by uuid references public.crm_users(id) on delete set null,
  check (ends_at > starts_at),
  check (ends_at <= starts_at + interval '24 hours')
);
create index if not exists crm_manager_locations_start_idx
  on public.crm_manager_locations (starts_at)
  where deleted_at is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'crm_manager_locations_time_excl'
      and conrelid = 'public.crm_manager_locations'::regclass
  ) then
    alter table public.crm_manager_locations
      add constraint crm_manager_locations_time_excl
      exclude using gist (
        manager_id with =,
        tstzrange(starts_at, ends_at, '[)') with &&
      ) where (deleted_at is null);
  end if;
end;
$$;

create table if not exists public.crm_complaints (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('Reclamação','Sugestão','Dúvida','Solicitação de treinamento')),
  message text not null check (char_length(message) between 10 and 5000),
  anonymous boolean not null default false,
  author_id uuid references public.crm_users(id) on delete set null,
  status text not null default 'Nova' check (status in ('Nova','Em análise','Respondida','Arquivada')),
  management_response text not null default '' check (char_length(management_response) <= 3000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.crm_users(id) on delete set null,
  check (not anonymous or author_id is null)
);
create index if not exists crm_complaints_status_created_idx
  on public.crm_complaints (status, created_at desc);
create index if not exists crm_complaints_author_created_idx
  on public.crm_complaints (author_id, created_at desc)
  where anonymous = false;

-- O browser acessa somente a API autenticada. Toda autorização de perfil é aplicada no servidor.
alter table public.crm_appointments enable row level security;
alter table public.crm_manager_locations enable row level security;
alter table public.crm_complaints enable row level security;
revoke all on public.crm_appointments, public.crm_manager_locations, public.crm_complaints from anon, authenticated;
grant all on public.crm_appointments, public.crm_manager_locations, public.crm_complaints to service_role;
