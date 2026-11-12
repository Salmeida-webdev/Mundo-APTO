-- Índices para os novos relacionamentos e filtros administrativos do CRM.
-- Somente estrutura: não atualiza nem remove registros.

create index if not exists crm_audit_user_at_idx
  on public.crm_audit (user_id, at desc);

create index if not exists crm_users_deleted_by_idx
  on public.crm_users (deleted_by);

create index if not exists crm_lead_attempts_actor_at_idx
  on public.crm_lead_attempts (actor_id, at desc);

create index if not exists crm_leads_created_by_idx
  on public.crm_leads (created_by);
create index if not exists crm_leads_updated_by_idx
  on public.crm_leads (updated_by);
create index if not exists crm_leads_sdr_updated_by_idx
  on public.crm_leads (sdr_updated_by);
create index if not exists crm_leads_deleted_by_idx
  on public.crm_leads (deleted_by);
create index if not exists crm_leads_phone_correction_requested_by_idx
  on public.crm_leads (phone_correction_requested_by);
create index if not exists crm_leads_phone_corrected_by_idx
  on public.crm_leads (phone_corrected_by);

create index if not exists crm_broker_profiles_updated_by_idx
  on public.crm_broker_profiles (updated_by);

create index if not exists crm_sales_lead_idx
  on public.crm_sales (lead_id);
create index if not exists crm_sales_development_sold_at_idx
  on public.crm_sales (development_id, sold_at desc);
create index if not exists crm_sales_accounted_by_idx
  on public.crm_sales (accounted_by);
create index if not exists crm_sales_created_by_idx
  on public.crm_sales (created_by);
create index if not exists crm_sales_deleted_by_idx
  on public.crm_sales (deleted_by);
create index if not exists crm_sales_updated_by_idx
  on public.crm_sales (updated_by);

create index if not exists crm_sales_receipts_created_by_idx
  on public.crm_sales_receipts (created_by);

create index if not exists crm_contracts_development_idx
  on public.crm_contracts (development_id);
create index if not exists crm_contracts_manager_idx
  on public.crm_contracts (manager_id, created_at desc);
create index if not exists crm_contracts_created_by_idx
  on public.crm_contracts (created_by);
create index if not exists crm_contracts_generated_by_idx
  on public.crm_contracts (generated_by);
create index if not exists crm_contracts_signed_uploaded_by_idx
  on public.crm_contracts (signed_uploaded_by);
create index if not exists crm_contracts_updated_by_idx
  on public.crm_contracts (updated_by);

create index if not exists crm_contract_documents_uploaded_by_idx
  on public.crm_contract_documents (uploaded_by);
