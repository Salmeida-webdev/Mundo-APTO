-- Amplia o fluxo de contratos sem apagar registros anteriores.
-- Vendas podem existir sem lead; cada instrumento (contrato/termo e confissão)
-- tem geração, arquivo assinado e confirmação de assinatura próprios.

alter table public.crm_contracts
  alter column lead_id drop not null,
  add column if not exists sale_id uuid references public.crm_sales(id) on delete set null,
  add column if not exists process_number text not null default '',
  add column if not exists debt_confession_template_snapshot text not null default '';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.crm_contracts'::regclass
      and conname = 'crm_contracts_process_number_length_check'
  ) then
    alter table public.crm_contracts
      add constraint crm_contracts_process_number_length_check
      check (char_length(process_number) <= 100);
  end if;
end
$$;

create index if not exists crm_contracts_sale_idx
  on public.crm_contracts (sale_id, created_at desc)
  where sale_id is not null;

alter table public.crm_contract_documents
  add column if not exists document_kind text not null default 'agreement',
  add column if not exists signature_confirmed_at timestamptz,
  add column if not exists signature_confirmed_by uuid references public.crm_users(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.crm_contract_documents'::regclass
      and conname = 'crm_contract_documents_document_kind_check'
  ) then
    alter table public.crm_contract_documents
      add constraint crm_contract_documents_document_kind_check
      check (document_kind in ('agreement', 'debt_confession'));
  end if;
end
$$;

-- Arquivos assinados antes desta mudança continuam disponíveis como acordos já confirmados.
update public.crm_contract_documents as document
set signature_confirmed_at = coalesce(document.signature_confirmed_at, document.created_at),
    signature_confirmed_by = coalesce(document.signature_confirmed_by, document.uploaded_by)
from public.crm_contracts as contract
where document.contract_id = contract.id
  and document.document_type = 'signed'
  and contract.status = 'Assinado'
  and document.signature_confirmed_at is null;

create index if not exists crm_contract_documents_kind_idx
  on public.crm_contract_documents (contract_id, document_kind, document_type, created_at desc);
