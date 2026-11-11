# Status da implantação

## Entrega preparada

- CRM Mundo Apto responsivo com acesso por perfil e carteira individual dos corretores.
- SDR consulta todos os clientes, pode cadastrar um cliente escolhendo um corretor ativo e, nos registros existentes, edita apenas feedback e status.
- Gestão de empreendimentos, importação CSV validada e exportação de cadastros/relatórios, com operações restritas aos perfis administrativos.
- Histórico dos contatos do SDR e histórico de mudanças de etapa para conversões e comparações.
- Dashboard com indicadores, ranking, comparação semanal e mensal por calendário, conversões, tempo até o primeiro contato, atrasos e concentrações de clientes parados por etapa, corretor e empreendimento.
- Prazo de follow-up configurável pela gestão entre 1 e 30 dias úteis, com padrão inicial de 3 dias úteis.
- Gestão pode arquivar e restaurar clientes e usuários de todos os perfis. A operação preserva cadastro, histórico e vínculos; usuário arquivado perde o acesso, e a conta conectada não pode ser excluída.
- Migrations de análise histórica e de exclusão reversível aplicadas ao Supabase de produção. A migração de exclusão acrescentou apenas colunas e índices, sem comandos de atualização ou exclusão de cadastros.
- npm run check: build e **62 testes automatizados aprovados**.

## Publicação e validação

- O código está preparado para uma atualização consolidada no repositório público `Salmeida-webdev/Mundo-APTO`, branch `main`.
- Após o commit, confirmar a associação com o site Netlify `mundoapto`, acompanhar um único deploy até o estado `ready` e validar os fluxos principais no endereço publicado antes de liberar o uso da equipe.
- A conta administrativa e os usuários da equipe devem ser configurados no CRM; nomes e e-mails de usuários não são armazenados no repositório.

## Limites dos dados históricos

- Os registros de etapas anteriores ao snapshot não existem na base e não podem ser reconstruídos retroativamente.
- O histórico de contatos do SDR passa a ser formado a partir das novas atualizações registradas pelo CRM.
- A interface atualiza os dados periodicamente, com consulta automática a cada 20 segundos enquanto estiver aberta.
- O sistema não registra auditoria administrativa completa de todas as mudanças de todos os campos; essa funcionalidade não faz parte do escopo aprovado.
