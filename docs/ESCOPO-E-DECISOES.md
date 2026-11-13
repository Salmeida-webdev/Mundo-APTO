# Escopo do CRM e decisões técnicas

| Requisito aprovado | Cobertura na solução |
| --- | --- |
| Equipe com corretores e suporte comercial | Usuários cadastráveis por perfil, com entrada/saída sem reconstruir a aplicação. A conta inicial da equipe pode ser completada pela gestão. |
| Exclusão reversível | Perfis administrativos podem excluir e restaurar clientes e usuários. Clientes, históricos e atribuições são preservados; usuários perdem o acesso e podem ser restaurados. |
| Carteira individual do corretor | API e RLS restringem a leitura à carteira do usuário autenticado; o servidor rejeita edição cruzada. |
| Cadastro pelo SDR e atribuição | O SDR pode cadastrar cliente, escolher um corretor ativo no próprio formulário e iniciar o cadastro em “Em contato”. A escolha direciona o cliente à carteira do corretor; o perfil do SDR não se torna administrativo. Nos cadastros existentes, o SDR só edita feedback e status. |
| Histórico de contatos do SDR | Cada salvamento do SDR registra nova linha com data/hora, autor, etapa e feedback. Histórico antigo sobrescrito antes da implantação não pode ser recuperado. |
| Dez etapas e identidade Sharks Fênix / Mundo Apto | A lista de status e a paleta ficam centralizadas na configuração e no schema do banco; os componentes usam a nova identidade visual do produto integrado. |
| Busca e filtros | Nome, telefone, corretor, empreendimento, status e período de cadastro, além de filtro de follow-up. |
| Dashboard e funil | Totais, 10 etapas, ranking por corretor, indicadores de aprovação/reprovação/desistência/compra e clientes sem atualização recente. |
| Gestão de empreendimentos | Perfis administrativos podem cadastrar, editar, ativar e desativar opções. Desativar preserva registros de clientes e seus vínculos históricos. |
| Importação e exportação | Perfis administrativos importam CSV padronizado com validação de dados obrigatórios, empreendimento, corretor e telefones duplicados. Exportam cadastros filtrados e relatórios gerenciais em CSV. Máximo de 200 clientes por lote de importação. |
| Análises históricas e alertas | Comparação da semana atual com a semana anterior e do mês atual com o mesmo recorte do mês anterior; conversões por coorte entre etapas e geral, contatos SDR, tempo médio até o primeiro contato, atrasos e concentração por etapa, corretor e empreendimento. Alertas aparecem no painel. |
| Prazo de follow-up | Gestão configura de 1 a 30 dias úteis; o padrão inicial é 3 dias úteis. A mesma regra alimenta a lista de acompanhamento e os alertas gerenciais. |
| Produção comercial integrada | A aba de operação registra prospecções, interações, agendamentos, visitas e vendas por corretor e data, com consolidação diária, semanal e mensal. Corretores inserem e corrigem somente os próprios registros; o SDR consulta a equipe sem editar; os demais perfis administrativos consultam o painel. Somente as contas autorizadas na configuração privada podem corrigir registros da equipe, configurar metas ou lançar/corrigir frequências. Lançamentos repetidos na mesma data são aceitos e cada revisão fica no histórico. |
| Metas | A gestão configura metas semanais (segunda a domingo) e mensais (primeiro ao último dia do mês), por corretor, para prospecções, visitas e vendas. O painel calcula realizado e restante; revisões preservam as versões anteriores. |
| Frequência de plantões | As contas operacionais autorizadas registram manhã, tarde e noite. Corretores consultam apenas os próprios registros, sem editar nem acessar a frequência de outros. O SDR pode consultar o consolidado da equipe sem editar. Os painéis consolidam dados individuais e da equipe conforme o perfil. |
| Vendas e repasses | A gestão registra manualmente vendas que podem ou não estar associadas a um lead; controla processo, empreendimento, corretor, unidade, valor, pendências, contabilização, situação, parcelas, saldo e os 30 status de repasse. Exportações respeitam os filtros e permissões. |
| Contratos e documentos | Gestão gera e exporta metadados. O rascunho pode partir de uma venda manual, de um lead ou de dados inseridos manualmente. Contrato/termo e confissão de dívida são documentos independentes, com modelos, arquivos e confirmações próprios. Comissão e prêmio entram como valores brutos e são divididos em 50% para corretor e 50% para SDR. Corretor e SDR só consultam documentos depois da assinatura confirmada do contrato principal e da confirmação do documento específico. |
| Cadastro contratual centralizado | CPF, CNPJ, CRECI e endereço ficam no cadastro administrativo de cada integrante da equipe e são reutilizados quando ele é selecionado como corretor ou SDR. Cada rascunho escolhe o SDR efetivamente vinculado à venda, permitindo mais de um SDR ativo. Os dados documentais ficam em tabela privada separada da listagem geral de usuários; os valores usados são gravados no contrato no momento da geração para preservar documentos antigos mesmo se o cadastro ou a equipe mudar depois. |
| Histórico administrativo detalhado | Registra perfil/autor, data/hora, módulo, ação, campos, valores anteriores e novos nas áreas CRM e operação. A trilha passa a existir a partir da implantação de cada recurso e não recompõe eventos antigos que nunca foram registrados. |
| Senha inicial e troca obrigatória | A gestão pode aplicar uma senha inicial às demais contas ativas; o administrador atual é excluído e cada usuário deve criar sua senha pessoal antes de usar o sistema. |
| Responsividade e navegação | Interface refluida para desktop, tablet e celular, com filtros empilhados, indicadores em duas colunas e navegação móvel. |
| Privacidade | GitHub contém código sem lista nominal; Postgres é privado e RLS limita leituras por carteira/papel; a chave de serviço fica restrita ao runtime da função. |
| Manutenção | Esquema versionado em migrations; papéis, empreendimentos, status e identidade podem evoluir sem reconstruir a base. |

## Arquitetura e limites

- Frontend estático publicado no Netlify; API em Netlify Functions; dados e autenticação no Supabase.
- O dashboard e as telas abertas recebem um sinal técnico autenticado do Supabase Realtime após gravações do CRM. O sinal não contém dados de clientes; a interface também consulta a API a cada 20 segundos como fallback e mostra o estado da conexão.
- A fila do SDR fica no início do dashboard, antes dos indicadores, com chamada visual destacada. Os avisos são somente dentro do CRM, não por e-mail ou WhatsApp; as 24 horas são corridas, incluindo fins de semana.
- Ao sinalizar telefone incorreto, o CRM registra a ocorrência no histórico do SDR, atualiza a data de acompanhamento e cria uma pendência na carteira do corretor até que o telefone seja corrigido.
- Recebimentos de vendas continuam manuais e append-only. Perfis administrativos podem anular uma parcela com justificativa; o lançamento permanece no histórico e na auditoria, os totais e o saldo excluem a parcela anulada e a fase do repasse não é alterada automaticamente.
- A migration cria uma fotografia do status dos clientes no início do histórico e um gatilho que registra criações e transições posteriores. Não reconstrói mudanças anteriores.
- A comparação semanal usa a semana do calendário, de segunda a domingo, contra a semana anterior até o mesmo dia e horário. A comparação mensal usa o mês atual contra o mês anterior até o mesmo dia (limitado ao último dia daquele mês). Um intervalo personalizado nos filtros compara o intervalo anterior de igual duração.
- Conversão por etapa considera clientes que entraram na etapa (ou estavam nela no primeiro snapshot) e avançaram depois; o resultado acumulado pode mudar conforme os clientes continuam no funil.
- O CSV é o formato de intercâmbio escolhido por abrir no Excel e no Google Sheets sem dependências extras. O arquivo não é um `.xlsx` nativo.
- Dados de equipe, clientes e empreendimentos permanecem no Supabase privado; o repositório público contém código e configuração sem nomes/e-mails da equipe.
- A troca do Apps Script para Supabase Auth não migra a sessão antiga. O e-mail da conta administrativa permanece; a senha antiga pode ser digitada no setup inicial para continuar usando a mesma credencial. A senha temporária padrão da equipe nunca é armazenada no código.
- A solução não inclui importação automática dos históricos de feedback que já foram sobrescritos nem sincronização de clientes existentes que ainda não foram recebidos/importados.
- O histórico de contatos do SDR e a auditoria administrativa são recursos diferentes. O primeiro registra contato/feedback/status por cliente; a segunda registra mudanças administrativas e operacionais, autor, horário e valores anteriores/novos.
- A geração de arquivos é para assinatura externa; o CRM não realiza assinatura eletrônica nem valida autenticidade jurídica. A gestão anexa cada arquivo assinado e atesta que corretor, SDR e gerente assinaram. O sistema confirma a chegada do arquivo ao armazenamento.
- O modelo inicial do contrato é uma estrutura do CRM que a empresa deve revisar antes de usar. A confissão de dívida não tem modelo padrão configurado: a gestão deve cadastrar o texto aprovado pela empresa. O CRM não cria cláusulas jurídicas para esse documento.
- Os modelos podem usar os campos `{{sdr_cnpj}}`, `{{sdr_creci}}` e `{{sdr_endereco}}`, além de `{{sdr_cpf}}`; todos vêm do perfil do SDR selecionado no rascunho. Os campos só impedem a geração se o próprio modelo tiver o marcador correspondente.
- Uma venda pode ser ligada a um lead ou ficar sem lead, pois parte das vendas chega por fora do fluxo de atendimento. Vincular contrato a venda reaproveita processo, comprador, empreendimento, corretor, unidade e valor. O contrato não cria a venda automaticamente nem altera sozinho a fase de repasse.
- As exclusões são arquivamentos, sem remoção física. Usuários arquivados mantêm o e-mail reservado e os vínculos com clientes; a própria conta conectada não pode ser excluída.

## Contrato dos indicadores históricos

- **Janelas:** semana e mês do calendário em `America/Sao_Paulo`, comparados com o recorte equivalente do período anterior. Um intervalo personalizado escolhido nos filtros substitui o período do calendário.
- **Conversão geral:** clientes cadastrados na janela que chegaram a “Já comprou” até o fim dessa janela, divididos pelos clientes cadastrados na mesma janela.
- **Conversão entre etapas:** clientes que entraram (ou estavam no snapshot inicial) na etapa de origem, e que depois foram registrados na etapa de destino, divididos pelas entradas únicas na origem. A taxa é observada ao longo do histórico disponível.
- **Tempo até o primeiro contato:** média entre cadastro e primeiro registro de contato do SDR para clientes cadastrados na janela; clientes sem contato registrado não entram no denominador.
- **Alertas:** follow-up atrasado em alta quando o total aumenta; queda de conversão quando há pelo menos três clientes de coorte nos dois períodos e a taxa cai; primeiro contato mais demorado quando a média cresce pelo menos 10% e há ao menos dois contatos medidos; concentração quando dois ou mais atrasados representam pelo menos 30% do total em uma etapa, corretor ou empreendimento.
- **Prazo de follow-up:** valor de 1 a 30 dias úteis, configurável pela gestão. O padrão é 3 dias úteis.
- **Histórico inicial:** os clientes ativos existentes recebem um snapshot do status na aplicação da migration. A base não tem histórico de contatos SDR armazenado antes da implantação; esse histórico e as conversões anteriores ao snapshot não podem ser reconstruídos.
