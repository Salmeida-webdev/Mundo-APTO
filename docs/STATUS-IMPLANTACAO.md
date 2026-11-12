# Revisão consolidada do CRM Mundo Apto

## O que esta versão cobre

- Alertas do SDR no topo do dashboard, com destaque visual para clientes aguardando contato por 24 horas ou mais, revisões após a 7ª tentativa e telefones que o corretor precisa corrigir. A contagem considera fins de semana e os avisos ficam somente no CRM.
- Histórico do SDR atualizado quando uma solicitação de correção de telefone é registrada; o pedido aparece na carteira do corretor responsável e o prazo do contato é reiniciado naquele momento.
- Atualização entre usuários por Supabase Realtime. O canal transmite apenas um sinal técnico sem dados de clientes; a consulta automática a cada 20 segundos continua como fallback.
- Anulação administrativa de recebimentos com justificativa, preservando o registro original e a auditoria. Totais e saldo deixam de contar a parcela anulada, inclusive quando novas parcelas forem lançadas depois. A fase escolhida para o repasse permanece sob decisão da gestão.
- Contratos de venda e controle manual de vendas/repasses mantidos como módulos distintos dentro do CRM. Gestão gera e exporta os dados do contrato; corretor e SDR acessam os documentos somente depois da assinatura registrada. O controle de vendas aceita vendas fora da carteira de leads, parcelas e as 30 fases de repasse informadas pela cliente.
- Demais regras já implementadas: permissões por papel e carteira, cadastro de leads pelo SDR com atribuição obrigatória, tentativas de contato, gestão de empreendimentos, importação/exportação, análise histórica e auditoria administrativa.

## Verificação técnica

- `npm run check`: build, empacotamento e **80 testes automatizados aprovados**.
- Migration `crm_live_sync_and_receipt_void` aplicada ao projeto Supabase de produção. A conferência confirmou 21 perfis, nenhuma parcela anterior, as novas colunas de anulação e a presença de `crm_sync_signal` na publicação Realtime.
- A migration é aditiva para os dados comerciais: não apaga clientes, usuários, vendas ou históricos. Nenhum registro existente de parcela foi alterado.
- O site `mundoapto` segue conectado a `Salmeida-webdev/Mundo-APTO`, branch `main`; o fluxo de publicação é acionado pelo commit nessa branch.

## Limites do histórico

- Os contatos de SDR anteriores que não foram registrados pelo CRM não podem ser reconstruídos. A partir das novas gravações, o histórico e o tempo até o primeiro contato ficam disponíveis.
- A anulação de recebimento não é exclusão física. O registro continua visível no histórico com autor e justificativa, mas não entra no total recebido nem reduz o saldo.
- O CRM não envia alertas por e-mail ou WhatsApp. Os avisos do SDR são exibidos dentro do painel.
- Produção diária, metas e frequências de plantão pertencem à aplicação separada e não fazem parte deste repositório.
