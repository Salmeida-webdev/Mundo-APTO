-- Exclusão lógica reversível para clientes e usuários.
-- Migração somente de esquema: não atualiza, apaga nem recria registros existentes.
alter table public.crm_leads
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.crm_users(id) on delete set null;

alter table public.crm_users
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.crm_users(id) on delete set null,
  add column if not exists deleted_previous_active boolean;

create index if not exists crm_leads_deleted_at_idx
  on public.crm_leads (deleted_at)
  where deleted_at is not null;

create index if not exists crm_users_deleted_at_idx
  on public.crm_users (deleted_at)
  where deleted_at is not null;
