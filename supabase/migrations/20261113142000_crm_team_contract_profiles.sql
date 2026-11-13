-- Centraliza os dados documentais dos integrantes da equipe e congela os dados
-- usados em cada contrato, preservando perfis e documentos já existentes.

create table if not exists public.crm_user_contract_profiles (
  user_id uuid primary key references public.crm_users(id) on delete restrict,
  cpf text not null default '' check (char_length(cpf) <= 30),
  cnpj text not null default '' check (char_length(cnpj) <= 30),
  creci text not null default '' check (char_length(creci) <= 60),
  address text not null default '' check (char_length(address) <= 500),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.crm_users(id) on delete set null
);

alter table public.crm_user_contract_profiles enable row level security;
revoke all on public.crm_user_contract_profiles from public, anon, authenticated;
grant all on public.crm_user_contract_profiles to service_role;

alter table public.crm_contracts
  add column if not exists broker_cpf text not null default '',
  add column if not exists broker_cnpj text not null default '',
  add column if not exists broker_creci text not null default '',
  add column if not exists broker_address text not null default '',
  add column if not exists sdr_cnpj text not null default '',
  add column if not exists sdr_creci text not null default '',
  add column if not exists sdr_address text not null default '';

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.crm_contracts'::regclass and conname='crm_contracts_broker_profile_lengths_check') then
    alter table public.crm_contracts add constraint crm_contracts_broker_profile_lengths_check
      check (char_length(broker_cpf) <= 30 and char_length(broker_cnpj) <= 30 and char_length(broker_creci) <= 60 and char_length(broker_address) <= 500);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.crm_contracts'::regclass and conname='crm_contracts_sdr_profile_lengths_check') then
    alter table public.crm_contracts add constraint crm_contracts_sdr_profile_lengths_check
      check (char_length(sdr_cpf) <= 30 and char_length(sdr_cnpj) <= 30 and char_length(sdr_creci) <= 60 and char_length(sdr_address) <= 500);
  end if;
end
$$;

-- Importa os cadastros documentais de corretores já preenchidos.
insert into public.crm_user_contract_profiles (user_id, cpf, cnpj, creci, address, updated_at, updated_by)
select profile.broker_id, profile.cpf, profile.cnpj, profile.creci, profile.address, profile.updated_at, profile.updated_by
from public.crm_broker_profiles as profile
on conflict (user_id) do update set
  cpf = case when public.crm_user_contract_profiles.cpf = '' then excluded.cpf else public.crm_user_contract_profiles.cpf end,
  cnpj = case when public.crm_user_contract_profiles.cnpj = '' then excluded.cnpj else public.crm_user_contract_profiles.cnpj end,
  creci = case when public.crm_user_contract_profiles.creci = '' then excluded.creci else public.crm_user_contract_profiles.creci end,
  address = case when public.crm_user_contract_profiles.address = '' then excluded.address else public.crm_user_contract_profiles.address end,
  updated_at = greatest(public.crm_user_contract_profiles.updated_at, excluded.updated_at);

-- Reaproveita o CPF do SDR salvo em rascunhos/contratos, se ainda não houver cadastro central.
with latest_sdr_cpf as (
  select distinct on (contract.sdr_id) contract.sdr_id, contract.sdr_cpf
  from public.crm_contracts as contract
  where nullif(trim(contract.sdr_cpf), '') is not null
  order by contract.sdr_id, contract.updated_at desc, contract.created_at desc
)
insert into public.crm_user_contract_profiles (user_id, cpf)
select latest.sdr_id, latest.sdr_cpf
from latest_sdr_cpf as latest
join public.crm_users as team_user on team_user.id = latest.sdr_id and team_user.role = 'SDR'
on conflict (user_id) do update set
  cpf = case when public.crm_user_contract_profiles.cpf = '' then excluded.cpf else public.crm_user_contract_profiles.cpf end;

-- Congela nos contratos antigos os dados que já existiam nos cadastros.
update public.crm_contracts as contract
set broker_cpf = coalesce(nullif(contract.broker_cpf, ''), nullif(broker_profile.cpf, ''), ''),
    broker_cnpj = coalesce(nullif(contract.broker_cnpj, ''), nullif(broker_profile.cnpj, ''), ''),
    broker_creci = coalesce(nullif(contract.broker_creci, ''), nullif(broker_profile.creci, ''), ''),
    broker_address = coalesce(nullif(contract.broker_address, ''), nullif(broker_profile.address, ''), '')
from public.crm_user_contract_profiles as broker_profile
where broker_profile.user_id = contract.broker_id;

-- Também importa os dados de qualquer parte disponível quando um dos perfis
-- ainda não foi cadastrado, sem apagar valores históricos já preenchidos.
update public.crm_contracts as contract
set sdr_cpf = coalesce(nullif(contract.sdr_cpf, ''), nullif(sdr_profile.cpf, ''), ''),
    sdr_cnpj = coalesce(nullif(contract.sdr_cnpj, ''), nullif(sdr_profile.cnpj, ''), ''),
    sdr_creci = coalesce(nullif(contract.sdr_creci, ''), nullif(sdr_profile.creci, ''), ''),
    sdr_address = coalesce(nullif(contract.sdr_address, ''), nullif(sdr_profile.address, ''), '')
from public.crm_user_contract_profiles as sdr_profile
where sdr_profile.user_id = contract.sdr_id;

