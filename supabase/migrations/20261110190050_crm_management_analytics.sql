-- Histórico de mudanças de etapa para conversões, comparações e alertas.
-- A tabela permanece privada; a interface consulta os eventos apenas pela função autenticada.
create table if not exists public.crm_lead_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.crm_leads(id) on delete cascade,
  at timestamptz not null default now(),
  actor_id uuid references public.crm_users(id) on delete set null,
  actor_name text not null,
  actor_role text not null,
  event_type text not null check (event_type in ('lead_created','status_change','baseline')),
  old_status text,
  new_status text not null,
  broker_id uuid not null references public.crm_users(id) on delete restrict,
  development_id text not null references public.crm_developments(id) on delete restrict
);

create index if not exists crm_lead_events_at_idx on public.crm_lead_events (at desc);
create index if not exists crm_lead_events_lead_at_idx on public.crm_lead_events (lead_id, at);
create index if not exists crm_lead_events_transition_idx on public.crm_lead_events (old_status, new_status, at);

alter table public.crm_lead_events enable row level security;
revoke all on public.crm_lead_events from anon, authenticated;
grant select on public.crm_lead_events to authenticated;
grant all on public.crm_lead_events to service_role;

drop policy if exists crm_lead_events_read_by_lead on public.crm_lead_events;
create policy crm_lead_events_read_by_lead on public.crm_lead_events for select to authenticated
  using (public.crm_user_is_active() and (public.crm_can_read_all() or exists (
    select 1 from public.crm_leads lead where lead.id = crm_lead_events.lead_id and lead.broker_id = auth.uid()
  )));

-- Snapshot inicial na data da migration, sem sugerir que o histórico anterior foi reconstruído.
insert into public.crm_lead_events (lead_id, at, actor_id, actor_name, actor_role, event_type, old_status, new_status, broker_id, development_id)
select lead.id, now(), lead.updated_by, coalesce(actor.name, 'Migração de histórico'), coalesce(actor.role, 'Sistema'),
       'baseline', null, lead.status, lead.broker_id, lead.development_id
from public.crm_leads lead
left join public.crm_users actor on actor.id = lead.updated_by
where not exists (
  select 1 from public.crm_lead_events event where event.lead_id = lead.id
);

create or replace function public.crm_capture_lead_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_actor_name text;
  v_actor_role text;
  v_event_type text;
  v_old_status text;
  v_at timestamptz;
begin
  if tg_op = 'INSERT' then
    v_actor_id := new.created_by;
    v_event_type := 'lead_created';
    v_old_status := null;
    v_at := coalesce(new.created_at, now());
  elsif new.status is distinct from old.status then
    v_actor_id := new.updated_by;
    v_event_type := 'status_change';
    v_old_status := old.status;
    v_at := coalesce(new.updated_at, now());
  else
    return new;
  end if;

  select name, role into v_actor_name, v_actor_role
  from public.crm_users where id = v_actor_id;

  insert into public.crm_lead_events (lead_id, at, actor_id, actor_name, actor_role, event_type, old_status, new_status, broker_id, development_id)
  values (new.id, v_at, v_actor_id, coalesce(v_actor_name, 'Responsável não identificado'), coalesce(v_actor_role, 'Sistema'), v_event_type, v_old_status, new.status, new.broker_id, new.development_id);
  return new;
end;
$$;

revoke all on function public.crm_capture_lead_event() from public, anon, authenticated;

drop trigger if exists crm_leads_capture_events on public.crm_leads;
create trigger crm_leads_capture_events
after insert or update of status on public.crm_leads
for each row execute function public.crm_capture_lead_event();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'crm_lead_events') then
    alter publication supabase_realtime add table public.crm_lead_events;
  end if;
end
$$;
