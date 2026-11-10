# Status da implantação

## Preparado para a publicação

- Interface Mundo Apto responsiva portada para página estática Netlify.
- API Netlify Functions com autenticação Supabase Auth, gestão de usuários, carteiras, filtros, dashboard, histórico SDR e senha inicial da equipe.
- Migration Supabase com tabelas, índices, RLS por perfil/carteira e permissões de leitura restritas; escrita operacional pelo servidor.
- Configuração do repositório público sanitizada para não incluir nomes/e-mails da equipe ou senhas.
- Build e suíte de verificação executados: **49 testes passaram, 0 falharam**.
- Projeto Netlify `mundoapto` criado no time Free; ainda não há deploy nem URL ativo.
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` e `SUPABASE_SECRET_KEY` estão configuradas no contexto de produção. O segredo de bootstrap ainda precisa ser configurado.

## Ainda necessário antes da operação

1. Configurar `CRM_BOOTSTRAP_SECRET` no Netlify, somente para produção.
2. Enviar as últimas alterações ao repositório GitHub e conectar o branch principal à publicação Netlify.
3. Fazer um único deploy de produção depois da revisão final e validar login, criação de usuário, troca de senha, isolamento de corretor, edição SDR, histórico e dashboard.
4. Criar a conta administrativa pela tela inicial; o endpoint de bootstrap fecha automaticamente depois do primeiro cadastro.
5. Remover a variável temporária de bootstrap na próxima publicação planejada; cadastrar a equipe e os clientes no ambiente final.

## Limites de validação

Os testes atuais são automatizados e usam dados simulados. Eles não representam um teste de autenticação real no projeto Supabase nem comprovam permissões de produção até a migration, as variáveis secretas e o deploy serem configurados. Dados reais da equipe e clientes não são incluídos no repositório público; serão cadastrados após a inicialização administrativa.
