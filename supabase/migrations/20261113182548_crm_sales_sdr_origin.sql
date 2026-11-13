-- Registra se a venda teve origem no trabalho do SDR. Valores antigos ficam NULL
-- para não inventar a origem de vendas já cadastradas.
alter table public.crm_sales
  add column if not exists is_sdr_sale boolean;
