-- Private schema for CRM Comercial Mundo Apto.
-- Public app users get only RLS-filtered reads; writes use the protected Netlify function.
create table if not exists public.crm_users (
  id uuid primary key references auth.users(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 150),
  email text not null unique,
  role text not null check (role in ('Administrador','Gerente','Coordenador','Assistente','SDR','Corretor')),
  active boolean not null default true,
  must_change_password boolean not null default true,
  session_version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_developments (
  id text primary key,
  name text not null unique,
  active boolean not null default true
);

create table if not exists public.crm_leads (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 150),
  phone text not null check (char_length(phone) between 10 and 30),
  development_id text not null references public.crm_developments(id),
  notes text not null default '' check (char_length(notes) <= 3000),
  sdr_feedback text not null default '' check (char_length(sdr_feedback) <= 3000),
  status text not null check (status in ('Em atendimento','Atendimento agendado','Desistência','Atendimento realizado','Já comprou','Em contato','Enviando documentação','Em análise documental','Aprovado pela Caixa','Reprovado pela Caixa')),
  broker_id uuid not null references public.crm_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.crm_users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.crm_users(id),
  sdr_updated_at timestamptz,
  sdr_updated_by uuid references public.crm_users(id)
);

create table if not exists public.crm_sdr_history (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.crm_leads(id) on delete cascade,
  at timestamptz not null default now(),
  user_id uuid references public.crm_users(id),
  user_name text not null,
  status text not null,
  feedback text not null default '',
  source text not null default 'Atualização registrada pelo SDR'
);

create table if not exists public.crm_audit (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  user_id uuid references public.crm_users(id),
  email text not null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  changed_fields text not null default ''
);

create table if not exists public.crm_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.crm_users(id) on delete cascade,
  refresh_token_hash text not null unique,
  session_version integer not null default 0,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists crm_leads_broker_idx on public.crm_leads (broker_id);
create index if not exists crm_leads_development_idx on public.crm_leads (development_id);
create index if not exists crm_leads_status_idx on public.crm_leads (status);
create index if not exists crm_leads_created_at_idx on public.crm_leads (created_at desc);
create index if not exists crm_leads_sdr_updated_at_idx on public.crm_leads (sdr_updated_at);
create index if not exists crm_sdr_history_lead_at_idx on public.crm_sdr_history (lead_id, at desc);

create or replace function public.crm_current_role()
returns text language sql stable security definer set search_path = public
as $$ select role from public.crm_users where id = auth.uid() and active = true limit 1 $$;

create or replace function public.crm_user_is_active()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.crm_users where id = auth.uid() and active = true) $$;

create or replace function public.crm_can_read_all()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(public.crm_current_role() in ('Administrador','Gerente','Coordenador','Assistente','SDR'), false) $$;

revoke all on function public.crm_current_role() from public, anon;
revoke all on function public.crm_user_is_active() from public, anon;
revoke all on function public.crm_can_read_all() from public, anon;
grant execute on function public.crm_current_role() to authenticated;
grant execute on function public.crm_user_is_active() to authenticated;
grant execute on function public.crm_can_read_all() to authenticated;

alter table public.crm_users enable row level security;
alter table public.crm_developments enable row level security;
alter table public.crm_leads enable row level security;
alter table public.crm_sdr_history enable row level security;
alter table public.crm_audit enable row level security;
alter table public.crm_settings enable row level security;
alter table public.crm_sessions enable row level security;

revoke all on public.crm_users, public.crm_developments, public.crm_leads, public.crm_sdr_history, public.crm_audit, public.crm_settings, public.crm_sessions from anon, authenticated;
grant select on public.crm_users, public.crm_developments, public.crm_leads, public.crm_sdr_history to authenticated;

drop policy if exists crm_users_read_authorized on public.crm_users;
create policy crm_users_read_authorized on public.crm_users for select to authenticated
  using (public.crm_user_is_active() and (id = auth.uid() or public.crm_can_read_all()));

drop policy if exists crm_developments_read_active on public.crm_developments;
create policy crm_developments_read_active on public.crm_developments for select to authenticated
  using (active = true and public.crm_user_is_active());

drop policy if exists crm_leads_read_by_role on public.crm_leads;
create policy crm_leads_read_by_role on public.crm_leads for select to authenticated
  using (public.crm_can_read_all() or (public.crm_current_role() = 'Corretor' and broker_id = auth.uid()));

drop policy if exists crm_sdr_history_read_by_lead on public.crm_sdr_history;
create policy crm_sdr_history_read_by_lead on public.crm_sdr_history for select to authenticated
  using (public.crm_can_read_all() or exists (
    select 1 from public.crm_leads lead where lead.id = crm_sdr_history.lead_id and lead.broker_id = auth.uid()
  ));

-- Enable scoped change notifications for future live subscriptions.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'crm_leads') then
      alter publication supabase_realtime add table public.crm_leads;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'crm_sdr_history') then
      alter publication supabase_realtime add table public.crm_sdr_history;
    end if;
  end if;
end
$$;
