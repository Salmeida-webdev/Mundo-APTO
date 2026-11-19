# Estado de preparação — CRM Mundo Apto / Sharks Fênix

## Produto e destino

O escopo unificado pertence ao repositório existente `Salmeida-webdev/Mundo-APTO`, que alimenta o site Netlify `mundoapto` e usa o projeto Supabase existente `mundoapto-crm`. A publicação é feita na branch principal `main`, que aciona o deploy automático do site. Não foi criado outro repositório, site ou projeto de dados.

Os módulos ficam separados pela navegação e pelo domínio: relacionamento e clientes; produção, metas e frequência; vendas e repasses; contratos e documentos; administração e auditoria. A identidade visual foi atualizada para a marca Sharks Fênix / Mundo Apto, com preto/carvão, dourado e bronze, logo na entrada e na navegação e adaptações para desktop, tablet e celular.

## Funções reunidas

- Carteira de clientes por corretor, cadastro também pelo SDR com atribuição obrigatória, histórico de contatos, tentativas, solicitações de correção de telefone, follow-ups, etapas e alertas visíveis no CRM.
- Gestão de empreendimentos, importação validada, exportações autorizadas, indicadores gerenciais e trilha administrativa.
- Lançamentos de produção por data para prospecções, interações, agendamentos, visitas e vendas, com entradas repetidas, edição própria, cancelamento lógico e histórico. A lista de corretores ativos acompanha o cadastro da equipe sem duplicação manual.
- Metas semanais e mensais por corretor para prospecções, visitas e vendas, com revisões preservadas.
- Frequências por manhã, tarde e noite, com lançamentos/correções restritos às contas operacionais autorizadas e consulta limitada por perfil. Novos corretores ativos entram automaticamente na lista. O resumo semanal mostra os totais por corretor e turno e os totais gerais da semana; o detalhamento diário foi removido desta tela e os dias podem ser consultados pelos filtros.
- Painéis e relatórios com visões diária, semanal e mensal, comparação de períodos, totais individuais/de equipe e exportação CSV separada de lançamentos e frequências, protegida contra fórmulas.
- Registro manual de vendas e repasses, independente do cadastro de lead, com fases de repasse atuais e históricas preservadas, pendências, recebimento e anulação justificada auditada. O SDR é selecionado explicitamente na venda; só há rateio e comissão/prêmio de SDR quando existe esse vínculo. Sem vínculo, o corretor recebe o valor total e a comissão do SDR é zero. A área exibe a comissão do gerente a receber. Vendas pagas, canceladas e distratadas permanecem consultáveis em visões separadas, fora dos indicadores gerenciais. Cada corretor pode consultar somente as próprias vendas e seu repasse/pagamento em uma tela de leitura; a autorização é filtrada no servidor e a resposta não inclui valores de comissão do SDR/gerente, notas internas ou ações administrativas.
- Somente a gestão pode gerar o Termo Fifty, que exige uma venda ativa com participação do SDR, seleção do corretor, SDR e gerente signatário e número da proposta. O CPF do comprador e os dados documentais do corretor/SDR são opcionais; o gerente signatário precisa ter CPF, CNPJ, CRECI e endereço completos. Confissões já existentes continuam no histórico, mas não são geradas novamente.
- Recibos são emitidos separadamente para cada beneficiário: sem SDR, o corretor recebe recibo de 100% da comissão; com SDR, corretor e SDR recebem recibos próprios de 50% cada. O desconto manual é aplicado sobre a comissão bruta e o líquido é dividido conforme essa participação. Cada documento exige assinatura externa do beneficiário indicado e do gerente; gerente/assistente conferem o PDF anexado e registram o pagamento.

## Permissões operacionais

- Corretores registram produção somente na data atual e corrigem os próprios registros do dia; não podem lançar datas passadas ou futuras. A gestão pode lançar e corrigir datas anteriores. As alterações permitidas ficam auditadas.
- O cadastro da equipe exige nome e CPF. CNPJ, CRECI e endereço são opcionais para corretores e SDRs; o gerente que assina documentos precisa manter todos os dados cadastrais completos.
- O SDR acessa Clientes, Novos cadastros, Follow-ups, Alertas SDR e Contratos. Não vê Produção, Metas, Frequências ou o painel financeiro geral; pode consultar os recibos vinculados a ele pela área de contratos/documentos.
- Follow-ups incluem clientes com ao menos uma tentativa de contato. Clientes ainda sem primeira tentativa permanecem em Novos cadastros até que o SDR salve a revisão do status. Perfis administrativos também podem registrar tentativas; a sétima gera lembrete para análise do SDR, sem mudar o status automaticamente.
- A agenda inicia na visão mensal e oferece consulta semanal e por intervalo. O formulário abre antes das consultas auxiliares para permitir cadastrar atendimentos e a localização do gerente. Atendimentos não são somados à produção. Lembretes são exibidos somente à gerente, à assistente e ao corretor que cadastrou o atendimento.
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

O build e a montagem dos pacotes de produção são verificados localmente com `npm run check`, junto da suíte automatizada. Essa verificação não substitui a conferência autenticada do CRM no site após a publicação.

## Publicação

A publicação autorizada é feita por um único push para `main`, usando o repositório e o site `mundoapto` já conectados. O deploy ocorre automaticamente pela integração do Netlify com GitHub; não se deve iniciar um deploy manual separado para o mesmo commit. O resultado final deve ser confirmado pelo estado do deploy e por uma revisão autenticada das funções no site.

## Limites conhecidos

- Os dados operacionais do Sharks começam vazios; a equipe inicia os lançamentos manualmente no CRM integrado. Os clientes, usuários e históricos já existentes do CRM não são substituídos.
- Alertas de follow-up e tentativas aparecem dentro do painel do CRM. Não há envio de WhatsApp ou e-mail.
- Conversões e históricos começam a ser calculados a partir dos registros disponíveis após as migrations; eventos apagados/sobrescritos anteriormente não podem ser reconstruídos.
- Novas confissões de dívida não serão geradas pela plataforma conforme a regra mais recente. Confissões e arquivos antigos são preservados no histórico.
- O Termo Fifty e os recibos são gerados para baixar, imprimir e assinar fora do sistema. A confirmação é administrativa e não equivale a assinatura eletrônica ou validação jurídica.

## Correções do feedback mais recente — preparadas localmente, banco atualizado, pendentes de publicação

O menu do SDR foi limitado a Clientes, Novos cadastros, Follow-ups, Alertas SDR e Contratos. A área financeira geral fica oculta; recibos vinculados ao SDR são acessíveis a partir de Contratos e continuam filtrados pelo beneficiário no servidor. Também foi corrigida a paginação da carteira. Novos cadastros mostram clientes cujo status ainda não foi revisado e salvo pelo SDR; tentativas ou solicitações de correção de telefone, sozinhas, não encerram essa fila.

O formulário de usuário agora permite salvar o cadastro de gerente sem alterar permissões operacionais. O cadastro exige nome e CPF; CNPJ, CRECI e endereço podem ficar vazios para corretores e SDRs, enquanto o gerente precisa ter todos os dados completos. A geração do Termo Fifty permite CPF do comprador vazio, exige número da proposta e valida a venda com SDR, os participantes e o gerente signatário.

Também foram preparados os ajustes de produção: corretores só podem registrar números na data vigente; a gestão mantém acesso às datas anteriores; metas podem ser excluídas junto com suas revisões, sem criar histórico de exclusão; e o resumo de plantões mantém totais semanais por corretor/turno e totais gerais, sem a tabela dia a dia. O VGV é calculado por mês da data de venda, mostra o acumulado anual e exclui vendas canceladas/distratadas. A importação/exportação de lançamentos e frequências continua em CSV.

Vendas e repasses mostram cada venda ao corretor responsável, incluindo o valor do próprio repasse e o pagamento, sem expor comissão do SDR/gerente ou campos administrativos. A comissão do SDR só aparece quando há participação e seleção explícita na venda. O erro de valor monetário com centavos no padrão brasileiro foi corrigido. O gerente também vê o total de comissão que tem a receber.

O PDF do recibo foi alinhado ao conteúdo do modelo assinado: identifica o beneficiário, o responsável pela intermediação, comprador, empreendimento, unidade, processo/proposta, VGV, comissão bruta individual, desconto e pagamento; inclui as cláusulas de objeto, pagamento/documentação fiscal, relação comercial, ausência de vínculo, disposições gerais e assinaturas externas do beneficiário e gerente. Nomes e dados dos participantes são carregados dos registros selecionados, sem nomes de exemplo fixos. O layout gerado continua sendo um PDF textual simples; a gestão deve conferir o documento e validar o teor jurídico e contábil antes do primeiro uso oficial.

As três migrações foram aplicadas ao projeto remoto `mundoapto-crm` e os arquivos locais estão alinhados às versões registradas no banco: `20261119205423_crm_sdr_status_review_queue.sql`, `20261119205434_crm_production_sale_cancellation_links.sql` e `20261119205858_crm_commission_receipts_by_recipient_and_goal_delete.sql`. Foram conferidos o campo de revisão do SDR, a tabela/vínculos de produção e vendas, as funções de sincronização e exclusão de metas, a regra única de recibos por destinatário e o agendamento de lembretes. O `npm run check` executou o build e os pacotes locais e aprovou os 130 testes automatizados. O código ainda aguarda o único push de publicação.

## Itens que precisam de revisão da cliente

- Conferir visualmente os PDFs do Termo Fifty e dos recibos gerados antes do uso oficial. A geração automatiza os campos e cálculos, mas a assinatura ocorre fora do CRM e não é assinatura eletrônica.
- O modelo de confissão de dívida não foi incluído para nova geração; documentos antigos podem continuar no histórico. Se a empresa quiser emitir esse documento pelo CRM no futuro, será necessário aprovar e cadastrar seu modelo.
- Validar os dados reais do gerente signatário e executar a geração, assinatura e anexação com usuários reais após aplicar as migrações e publicar.
