-- Registra o SDR efetivamente selecionado em cada venda.
-- Sem esse vínculo, a venda não atribui comissão nem prêmio ao SDR.

alter table public.crm_sales
  add column if not exists sdr_id uuid references public.crm_users(id) on delete restrict;

create index if not exists crm_sales_sdr_sold_at_idx
  on public.crm_sales (sdr_id, sold_at desc)
  where sdr_id is not null;

comment on column public.crm_sales.sdr_id is
  'SDR selecionado pela gestão como participante da venda; comissão e prêmio só são divididos quando este vínculo existe.';
