-- Campos complementares do termo operacional em branco fornecido para o CRM Mundo Apto.
-- Migração aditiva: preserva todos os contratos e demais registros existentes.

alter table public.crm_contracts
  add column if not exists proposal_number text not null default '',
  add column if not exists sdr_cpf text not null default '',
  add column if not exists commission_base numeric(14,2) not null default 0,
  add column if not exists commission_rate_pct numeric(7,4),
  add column if not exists prize_rate_pct numeric(7,4);

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.crm_contracts'::regclass and conname = 'crm_contracts_proposal_number_length_check') then
    alter table public.crm_contracts add constraint crm_contracts_proposal_number_length_check check (char_length(proposal_number) <= 100);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.crm_contracts'::regclass and conname = 'crm_contracts_sdr_cpf_length_check') then
    alter table public.crm_contracts add constraint crm_contracts_sdr_cpf_length_check check (char_length(sdr_cpf) <= 30);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.crm_contracts'::regclass and conname = 'crm_contracts_commission_base_nonnegative_check') then
    alter table public.crm_contracts add constraint crm_contracts_commission_base_nonnegative_check check (commission_base >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.crm_contracts'::regclass and conname = 'crm_contracts_commission_rate_range_check') then
    alter table public.crm_contracts add constraint crm_contracts_commission_rate_range_check check (commission_rate_pct is null or commission_rate_pct between 0 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.crm_contracts'::regclass and conname = 'crm_contracts_prize_rate_range_check') then
    alter table public.crm_contracts add constraint crm_contracts_prize_rate_range_check check (prize_rate_pct is null or prize_rate_pct between 0 and 100);
  end if;
end
$$;
