-- Indexes for foreign keys added by the integrated operations and contract migrations.
-- They support audit lookups and avoid full-table scans when a user or document is removed.

create index if not exists crm_production_entries_created_by_idx
  on public.crm_production_entries (created_by);
create index if not exists crm_production_entries_updated_by_idx
  on public.crm_production_entries (updated_by);
create index if not exists crm_production_entries_deleted_by_idx
  on public.crm_production_entries (deleted_by);

create index if not exists crm_production_goals_created_by_idx
  on public.crm_production_goals (created_by);
create index if not exists crm_production_goals_supersedes_id_idx
  on public.crm_production_goals (supersedes_id);

create index if not exists crm_attendance_records_created_by_idx
  on public.crm_attendance_records (created_by);
create index if not exists crm_attendance_records_updated_by_idx
  on public.crm_attendance_records (updated_by);
create index if not exists crm_attendance_records_deleted_by_idx
  on public.crm_attendance_records (deleted_by);

create index if not exists crm_contract_documents_signature_confirmed_by_idx
  on public.crm_contract_documents (signature_confirmed_by);
