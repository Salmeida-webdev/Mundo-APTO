# Escopo do CRM e decisões técnicas

| Requisito aprovado | Cobertura na solução |
| --- | --- |
| Equipe com corretores e suporte comercial | Usuários cadastráveis por perfil, com entrada/saída sem reconstruir a aplicação. A conta inicial da equipe pode ser completada pela gestão. |
| Carteira individual do corretor | API e RLS restringem a leitura à carteira do usuário autenticado; o servidor rejeita edição cruzada. |
| Cadastro pelo SDR e atribuição | O SDR pode cadastrar cliente, escolher um corretor ativo no próprio formulário e iniciar o cadastro em “Em contato”. A escolha direciona o cliente à carteira do corretor; o perfil do SDR não se torna administrativo. Nos cadastros existentes, o SDR só edita feedback e status. |
| Histórico de contatos do SDR | Cada salvamento do SDR registra nova linha com data/hora, autor, etapa e feedback. Histórico antigo sobrescrito antes da implantação não pode ser recuperado. |
| Dez etapas e identidade Mundo Apto | Lista de status e paleta ficam centralizadas na configuração e no schema do banco; o cliente recebe cores correspondentes. |
| Busca e filtros | Nome, telefone, corretor, empreendimento, status e período de cadastro, além de filtro de follow-up. |
| Dashboard e funil | Totais, 10 etapas, ranking por corretor, indicadores de aprovação/reprovação/desistência/compra e clientes sem atualização recente. |
| Gestão de empreendimentos | Perfis administrativos podem cadastrar, editar, ativar e desativar opções. Desativar preserva registros de clientes e seus vínculos históricos. |
| Importação e exportação | Perfis administrativos importam CSV padronizado com validação de dados obrigatórios, empreendimento, corretor e telefones duplicados. Exportam cadastros filtrados e relatórios gerenciais em CSV. Máximo de 200 clientes por lote de importação. |
| Análises históricas e alertas | Comparação dos últimos 7 ou 30 dias com período equivalente anterior; conversões por coorte entre etapas e geral, volume de contatos do SDR, tempo médio até o primeiro contato, tendência de follow-ups atrasados e concentração de clientes parados por corretor/empreendimento. Alertas aparecem no painel. |
| Senha inicial e troca obrigatória | A gestão pode aplicar uma senha inicial às demais contas ativas; o administrador atual é excluído e cada usuário deve criar sua senha pessoal antes de usar o sistema. |
| Responsividade e navegação | Interface refluida para desktop, tablet e celular, com filtros empilhados, indicadores em duas colunas e navegação móvel. |
| Privacidade | GitHub contém código sem lista nominal; Postgres é privado e RLS limita leituras por carteira/papel; a chave de serviço fica restrita ao runtime da função. |
| Manutenção | Esquema versionado em migrations; papéis, empreendimentos, status e identidade podem evoluir sem reconstruir a base. |

## Arquitetura e limites

- Frontend estático publicado no Netlify; API em Netlify Functions; dados e autenticação no Supabase.
- O dashboard sincroniza automaticamente enquanto está aberto e atualiza imediatamente na sessão que salvou. A versão inicial consulta alterações a cada 20 segundos; a migration deixa leads/histórico prontos para ativar Supabase Realtime na interface numa evolução sem refazer o modelo.
- A migration cria uma fotografia do status dos clientes no início do histórico e um gatilho que registra criações e transições posteriores. Não reconstrói mudanças anteriores.
- As comparações usam janelas móveis de 7 e 30 dias. Conversão por etapa considera clientes que entraram na etapa (ou estavam nela no primeiro snapshot) e avançaram depois; o resultado acumulado pode mudar conforme os clientes continuam no funil.
- O CSV é o formato de intercâmbio escolhido por abrir no Excel e no Google Sheets sem dependências extras. O arquivo não é um `.xlsx` nativo.
- Dados de equipe, clientes e empreendimentos permanecem no Supabase privado; o repositório público contém código e configuração sem nomes/e-mails da equipe.
- A troca do Apps Script para Supabase Auth não migra a sessão antiga. O e-mail da conta administrativa permanece; a senha antiga pode ser digitada no setup inicial para continuar usando a mesma credencial. A senha temporária padrão da equipe nunca é armazenada no código.
- A solução não inclui importação automática dos históricos de feedback que já foram sobrescritos nem sincronização de clientes existentes que ainda não foram recebidos/importados.
- O histórico de contatos do SDR é distinto da auditoria administrativa detalhada de todas as alterações, que permanece fora desta lista aprovada.

## Contrato dos indicadores históricos

- **Janelas:** últimos 7 dias ou últimos 30 dias, comparados com a janela imediatamente anterior de igual duração. Um intervalo personalizado escolhido nos filtros substitui a janela móvel.
- **Conversão geral:** clientes cadastrados na janela que chegaram a “Já comprou” até o fim dessa janela, divididos pelos clientes cadastrados na mesma janela.
- **Conversão entre etapas:** clientes que entraram (ou estavam no snapshot inicial) na etapa de origem, e que depois foram registrados na etapa de destino, divididos pelas entradas únicas na origem. A taxa é observada ao longo do histórico disponível.
- **Tempo até o primeiro contato:** média entre cadastro e primeiro registro de contato do SDR para clientes cadastrados na janela; clientes sem contato registrado não entram no denominador.
- **Alertas:** follow-up atrasado em alta quando o total aumenta; queda de conversão quando há pelo menos três clientes de coorte nas duas janelas e a taxa cai; primeiro contato mais demorado quando a média cresce pelo menos 10% e há ao menos dois contatos medidos; concentração quando dois ou mais atrasados representam pelo menos 30% do total em um corretor ou empreendimento.
- **Histórico inicial:** os 55 clientes atuais recebem um snapshot do status na aplicação da migration. A base atual não tem histórico de contatos SDR armazenado; esse histórico e as conversões anteriores a esse snapshot não podem ser reconstruídos.
