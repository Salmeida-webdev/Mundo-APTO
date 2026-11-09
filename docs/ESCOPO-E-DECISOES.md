# Escopo do CRM e decisões técnicas

| Requisito aprovado | Cobertura na solução |
| --- | --- |
| Equipe com corretores e suporte comercial | Usuários cadastráveis por perfil, com entrada/saída sem reconstruir a aplicação. A conta inicial da equipe pode ser completada pela gestão. |
| Carteira individual do corretor | API e RLS restringem a leitura à carteira do usuário autenticado; o servidor rejeita edição cruzada. |
| SDR com edição restrita | API aceita para o SDR somente `sdrFeedback` e `status`; nome, telefone, empreendimento e observações não podem ser alterados por esse perfil. |
| Histórico de contatos do SDR | Cada salvamento do SDR registra nova linha com data/hora, autor, etapa e feedback. Histórico antigo sobrescrito antes da implantação não pode ser recuperado. |
| Dez etapas e identidade Mundo Apto | Lista de status e paleta ficam centralizadas na configuração e no schema do banco; o cliente recebe cores correspondentes. |
| Busca e filtros | Nome, telefone, corretor, empreendimento, status e período de cadastro, além de filtro de follow-up. |
| Dashboard e funil | Totais, 10 etapas, ranking por corretor, indicadores de aprovação/reprovação/desistência/compra e clientes sem atualização recente. |
| Senha inicial e troca obrigatória | A gestão pode aplicar uma senha inicial às demais contas ativas; o administrador atual é excluído e cada usuário deve criar sua senha pessoal antes de usar o sistema. |
| Responsividade e navegação | Interface refluida para desktop, tablet e celular, com filtros empilhados, indicadores em duas colunas e navegação móvel. |
| Privacidade | GitHub contém código sem lista nominal; Postgres é privado e RLS limita leituras por carteira/papel; a chave de serviço fica restrita ao runtime da função. |
| Manutenção | Esquema versionado em migrations; papéis, empreendimentos, status e identidade podem evoluir sem reconstruir a base. |

## Arquitetura e limites

- Frontend estático publicado no Netlify; API em Netlify Functions; dados e autenticação no Supabase.
- O dashboard sincroniza automaticamente enquanto está aberto e atualiza imediatamente na sessão que salvou. A versão inicial consulta alterações a cada 20 segundos; a migration deixa leads/histórico prontos para ativar Supabase Realtime na interface numa evolução sem refazer o modelo.
- O banco inicia sem leads. Dados de equipe são inseridos pelo administrador após a implantação para manter nomes e e-mails fora do repositório público.
- A troca do Apps Script para Supabase Auth não migra a sessão antiga. O e-mail da conta administrativa permanece; a senha antiga pode ser digitada no setup inicial para continuar usando a mesma credencial. A senha temporária padrão da equipe nunca é armazenada no código.
- A solução não inclui importação automática dos históricos de feedback que já foram sobrescritos nem sincronização de clientes existentes que ainda não foram recebidos/importados.
