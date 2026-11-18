# Estado de preparação — CRM Mundo Apto / Sharks Fênix

## Produto e destino

O escopo unificado pertence ao repositório existente `Salmeida-webdev/Mundo-APTO`, que alimenta o site Netlify `mundoapto` e usa o projeto Supabase existente `mundoapto-crm`. A publicação é feita na branch principal `main`, que aciona o deploy automático do site. Não foi criado outro repositório, site ou projeto de dados.

Os módulos ficam separados pela navegação e pelo domínio: relacionamento e clientes; produção, metas e frequência; vendas e repasses; contratos e documentos; administração e auditoria. A identidade visual foi atualizada para a marca Sharks Fênix / Mundo Apto, com preto/carvão, dourado e bronze, logo na entrada e na navegação e adaptações para desktop, tablet e celular.

## Funções reunidas

- Carteira de clientes por corretor, cadastro também pelo SDR com atribuição obrigatória, histórico de contatos, tentativas, solicitações de correção de telefone, follow-ups, etapas e alertas visíveis no CRM.
- Gestão de empreendimentos, importação validada, exportações autorizadas, indicadores gerenciais e trilha administrativa.
- Lançamentos de produção por data para prospecções, interações, agendamentos, visitas e vendas, com entradas repetidas, edição própria, cancelamento lógico e histórico. A lista de corretores ativos acompanha o cadastro da equipe sem duplicação manual.
- Metas semanais e mensais por corretor para prospecções, visitas e vendas, com revisões preservadas.
- Frequências por manhã, tarde e noite, com lançamentos/correções restritos às contas operacionais autorizadas e consulta limitada por perfil. Novos corretores ativos entram automaticamente na lista de frequência. O resumo semanal detalha totais por corretor, turno e dia, além dos totais gerais; cada corretor recebe somente a própria visão.
- Painéis e relatórios com visões diária, semanal e mensal, comparação de períodos, totais individuais/de equipe e exportação CSV separada de lançamentos e frequências, protegida contra fórmulas.
- Registro manual de vendas e repasses, independente do cadastro de lead, com fases de repasse atuais e históricas preservadas, pendências, recebimento e anulação justificada auditada. O SDR é selecionado explicitamente na venda; só há rateio e comissão/prêmio de SDR quando existe esse vínculo. Sem vínculo, o corretor recebe o valor total e a comissão do SDR é zero. A área exibe a comissão do gerente a receber. Vendas pagas, canceladas e distratadas permanecem consultáveis em visões separadas, fora dos indicadores gerenciais. Cada corretor pode consultar somente as próprias vendas e seu repasse/pagamento em uma tela de leitura; a autorização é filtrada no servidor e a resposta não inclui valores de comissão do SDR/gerente, notas internas ou ações administrativas.
- Termo Fifty gerado somente pela gestão, com origem em venda manual, lead ou preenchimento sem vínculo; corretor, SDR e gerente selecionados dinamicamente; cadastro documental unificado e cópia dos dados usados para preservar documentos antigos. Confissões já existentes continuam no histórico, mas novas confissões não são geradas. Recibos são gerados na área financeira; suas únicas assinaturas exigidas são as do corretor e do gerente, mesmo com SDR participante. O SDR permanece relacionado ao recibo para cálculo/acesso, não como signatário.

## Permissões operacionais

- Corretores criam e corrigem apenas os próprios lançamentos de produção e consultam somente a própria frequência.
- O SDR consulta os dados operacionais da equipe, sem editar produção, metas ou frequência.
- Perfis administrativos sem autorização operacional específica têm leitura dos painéis.
- As contas designadas para gestão operacional podem corrigir a produção da equipe, configurar metas e registrar/corrigir frequências; as demais seguem as permissões do próprio perfil.
- As autorizações operacionais e de manutenção ficam em configuração privada do ambiente e não são expostas no frontend ou no repositório público.

## Banco e preservação

As migrações antigas listadas abaixo já constavam no histórico do Supabase. As quatro migrações novas foram aplicadas ao projeto remoto `mundoapto-crm` em 18/11/2026, antes da publicação do frontend, e seus nomes/versões foram alinhados aos arquivos locais:

- `20261112165621_crm_integrated_operations`
- `20261112165636_crm_contract_sources_and_documents`
- `20261112165925_crm_integrated_fk_indexes`
- `20261112170738_crm_receipt_void_fk_index`
- `20261118163736_crm_client_feedback_sales_documents.sql`
- `20261118163751_crm_appointments_feedback_sales_health.sql`
- `20261118163819_crm_notifications_receipt_signatures.sql`
- `20261118163833_crm_sales_sdr_assignment.sql`

As alterações são aditivas: preservam os dados existentes e acrescentam campos, estruturas, restrições, funções, índices e agendamentos necessários ao CRM integrado. Nenhuma carga de usuários ou dados operacionais do Sharks Fênix foi importada. Não importei usuários, lançamentos, metas, frequências ou outros dados do Sharks Fênix que não chegou a ser testado.

As tabelas privadas mantêm RLS ativo e não liberam acesso direto do navegador. Leitura e gravação passam pela Netlify Function, que valida sessão, perfil, carteira, operação e campos permitidos. As permissões especiais são armazenadas em configuração privada do ambiente.

## Validação local

O build local foi concluído nesta preparação. Na última execução da suíte automatizada, 127 testes foram aprovados. A validação local não substitui a conferência autenticada do CRM no site após a publicação.

## Publicação

A publicação autorizada é feita por um único push para `main`, usando o repositório e o site `mundoapto` já conectados. O deploy ocorre automaticamente pela integração do Netlify com GitHub; não se deve iniciar um deploy manual separado para o mesmo commit. O resultado final deve ser confirmado pelo estado do deploy e por uma revisão autenticada das funções no site.

## Limites conhecidos

- Os dados operacionais do Sharks começam vazios; a equipe inicia os lançamentos manualmente no CRM integrado. Os clientes, usuários e históricos já existentes do CRM não são substituídos.
- Alertas de follow-up e tentativas aparecem dentro do painel do CRM. Não há envio de WhatsApp ou e-mail.
- Conversões e históricos começam a ser calculados a partir dos registros disponíveis após as migrations; eventos apagados/sobrescritos anteriormente não podem ser reconstruídos.
- Novas confissões de dívida não serão geradas pela plataforma conforme a regra mais recente. Confissões e arquivos antigos são preservados no histórico.
- O Termo Fifty e os recibos são gerados para baixar, imprimir e assinar fora do sistema. A confirmação é administrativa e não equivale a assinatura eletrônica ou validação jurídica.
