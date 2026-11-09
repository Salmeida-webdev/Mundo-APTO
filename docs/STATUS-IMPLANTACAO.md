# Status da implantação

## Preparado localmente

- Interface Mundo Apto responsiva portada para página estática Netlify.
- API Netlify Functions com autenticação Supabase Auth, gestão de usuários, carteiras, filtros, dashboard, histórico SDR e senha inicial da equipe.
- Migration Supabase com tabelas, índices, RLS por perfil/carteira e permissões de leitura restritas; escrita operacional pelo servidor.
- Configuração do repositório público sanitizada para não incluir nomes/e-mails da equipe ou senhas.
- Build e suíte de verificação executados: **49 testes passaram, 0 falharam**.
- Projeto Netlify vazio `mundoapto` criado no time Free; ainda não há deploy nem URL ativo.

## Ainda necessário antes da operação

1. Criar o banco Supabase no workspace correto e aplicar a migration versionada.
2. Adicionar no Netlify as chaves Supabase e os dois valores temporários de bootstrap, somente em ambiente Functions/Runtime.
3. Enviar o código ao repositório GitHub e conectar o branch principal à publicação Netlify.
4. Fazer um único deploy de produção depois da revisão final e validar login, criação de usuário, troca de senha, isolamento de corretor, edição SDR, histórico e dashboard.
5. Remover as variáveis de bootstrap após a criação da conta administradora; cadastrar a equipe e clientes no ambiente final.

## Limites de validação

Os testes atuais são automatizados e usam dados simulados. Eles não representam um teste de autenticação real no projeto Supabase nem comprovam permissões de produção até a migration, as variáveis secretas e o deploy serem configurados. Dados reais da equipe e clientes não são incluídos no repositório público; serão cadastrados após a inicialização administrativa.
