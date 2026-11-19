-- Separa a primeira revisão do status pelo SDR da última atividade de contato.
-- Tentativas e solicitações de correção de telefone não encerram a fila de novos cadastros.
alter table public.crm_leads
  add column if not exists sdr_status_updated_at timestamptz;

-- Recupera revisões já registradas no histórico e mudanças de status identificadas pelo banco.
-- Quando o histórico antigo não permite identificar com precisão a ação, a fila permanece aberta.
update public.crm_leads lead
set sdr_status_updated_at = coalesce(
  (
    select min(event.at)
    from public.crm_lead_events event
    where event.lead_id = lead.id
      and event.actor_role = 'SDR'
      and event.event_type = 'status_change'
  ),
  (
    select min(history.at)
    from public.crm_sdr_history history
    where history.lead_id = lead.id
      and history.source = 'Atualização registrada pelo SDR'
  )
)
where lead.sdr_status_updated_at is null
  and (
    exists (
      select 1 from public.crm_lead_events event
      where event.lead_id = lead.id
        and event.actor_role = 'SDR'
        and event.event_type = 'status_change'
    )
    or exists (
      select 1 from public.crm_sdr_history history
      where history.lead_id = lead.id
        and history.source = 'Atualização registrada pelo SDR'
    )
  );

create index if not exists crm_leads_sdr_status_updated_at_idx
  on public.crm_leads (sdr_status_updated_at);
