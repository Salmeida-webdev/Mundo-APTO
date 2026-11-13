# Release integrada — CRM Mundo Apto / Sharks Fênix

## Produto e destino

O CRM e as funções antes planejadas no Sharks Fênix formam uma única aplicação no repositório `Salmeida-webdev/Mundo-APTO`, na branch `main`, publicada pelo site Netlify existente `mundoapto` e conectada ao projeto Supabase existente do CRM. Não foi criado outro repositório, site ou projeto de dados.

Os módulos ficam separados pela navegação e pelo domínio: relacionamento e clientes; produção, metas e frequência; vendas e repasses; contratos e documentos; administração e auditoria. A identidade visual foi atualizada para a marca Sharks Fênix / Mundo Apto, com preto/carvão, dourado e bronze, logo na entrada e na navegação e adaptações para desktop, tablet e celular.

## Funções reunidas

- Carteira de clientes por corretor, cadastro também pelo SDR com atribuição obrigatória, histórico de contatos, tentativas, solicitações de correção de telefone, follow-ups, etapas e alertas visíveis no CRM.
- Gestão de empreendimentos, importação validada, exportações autorizadas, indicadores gerenciais e trilha administrativa.
- Lançamentos de produção por data para prospecções, interações, agendamentos, visitas e vendas, com entradas repetidas, edição própria, cancelamento lógico e histórico. A lista de corretores ativos acompanha o cadastro da equipe sem duplicação manual.
- Metas semanais e mensais por corretor para prospecções, visitas e vendas, com revisões preservadas.
- Frequências por manhã, tarde e noite, com lançamentos/correções restritos às contas operacionais autorizadas e consulta limitada por perfil. Novos corretores ativos entram automaticamente na lista de frequência.
- Painéis e relatórios com visões diária, semanal e mensal, comparação de períodos, totais individuais/de equipe e exportação CSV separada de lançamentos e frequências, protegida contra fórmulas.
- Registro manual de vendas e repasses, independente do cadastro de lead, com os 30 status enviados pela cliente, pendências, parcelas e anulação justificada auditada. A visão geral discrimina a comissão bruta, os valores de 50% do corretor e de 50% do SDR e se a venda veio do SDR ou de outra origem; o recebimento integral permanece associado somente à parte do corretor. Vendas antigas ficam sem classificação até revisão, e marcar a origem não altera a divisão 50/50 previamente definida.
- Contratos gerados apenas pela gestão, com origem em venda manual, lead ou preenchimento sem vínculo; divisão de comissão/prêmio; cadastro documental unificado para corretores e múltiplos SDRs; seleção do SDR responsável em cada venda; cópia dos dados usados dentro do contrato para preservar documentos antigos; contrato/termo e confissão separados; arquivo assinado e confirmação individual. O corretor e o SDR vinculados acessam documentos somente após as confirmações previstas.

## Permissões operacionais

- Corretores criam e corrigem apenas os próprios lançamentos de produção e consultam somente a própria frequência.
- O SDR consulta os dados operacionais da equipe, sem editar produção, metas ou frequência.
- Perfis administrativos sem autorização operacional específica têm leitura dos painéis.
- As contas designadas para gestão operacional podem corrigir a produção da equipe, configurar metas e registrar/corrigir frequências; as demais seguem as permissões do próprio perfil.
- As autorizações operacionais e de manutenção ficam em configuração privada do ambiente e não são expostas no frontend ou no repositório público.

## Banco e preservação

As migrações foram aplicadas no Supabase já conectado ao CRM:

- `20261112165621_crm_integrated_operations`
- `20261112165636_crm_contract_sources_and_documents`
- `20261112165925_crm_integrated_fk_indexes`
- `20261112170738_crm_receipt_void_fk_index`

As migrações são aditivas. Conferi que os registros existentes de usuários, clientes, vendas e contratos continuam preservados. As tabelas de produção, metas e frequência estão vazias para começarem a receber lançamentos novos no CRM integrado. Não importei usuários, lançamentos, metas, frequências ou outros dados do Sharks Fênix que não chegou a ser testado.

As tabelas privadas mantêm RLS ativo e não liberam acesso direto do navegador. Leitura e gravação passam pela Netlify Function, que valida sessão, perfil, carteira, operação e campos permitidos. As permissões especiais são armazenadas em configuração privada do ambiente.

## Validação local

`npm run check` executa build, montagem dos pacotes e testes automatizados. O conjunto cobre autenticação, isolamento de carteiras, permissões SDR/gestão, produção, metas, frequência, auditoria, contratos, documentos, vendas, repasses, identidade visual e comportamento responsivo.

## Publicação

Um único commit na branch `main` aciona o deploy automático do site existente `mundoapto`. Não usar deploy manual nem criar um segundo site. A entrega deve ser considerada publicada quando o Netlify marcar esse deploy como `ready` e a URL `https://mundoapto.netlify.app` servir a versão integrada.

## Limites conhecidos

- Os dados operacionais do Sharks começam vazios; a equipe inicia os lançamentos manualmente no CRM integrado. Os clientes, usuários e históricos já existentes do CRM não são substituídos.
- Alertas de follow-up e tentativas aparecem dentro do painel do CRM. Não há envio de WhatsApp ou e-mail.
- Conversões e históricos começam a ser calculados a partir dos registros disponíveis após as migrations; eventos apagados/sobrescritos anteriormente não podem ser reconstruídos.
- A confissão de dívida exige que a gestão cadastre o modelo aprovado pela empresa. O modelo deve ser fornecido/revisado pela cliente; a aplicação não cria cláusulas jurídicas.
- Contratos e confissões são gerados para baixar, imprimir e assinar fora do sistema. A confirmação é administrativa e não equivale a assinatura eletrônica ou validação jurídica.
