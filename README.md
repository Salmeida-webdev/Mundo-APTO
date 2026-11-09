# CRM Comercial — Mundo Apto

CRM web responsivo para gestão de atendimentos, clientes e funil comercial imobiliário. A interface estática é publicada no Netlify; autenticação, regras de negócio e acesso ao banco passam por Netlify Functions. O Supabase/Postgres guarda os dados em projeto privado.

## Escopo coberto

- Acesso por e-mail e senha com papéis: Administrador, Gerente, Coordenador, Assistente, SDR e Corretor.
- Carteiras isoladas: corretor consulta e atualiza apenas os próprios clientes; a gestão e o SDR consultam a equipe toda.
- Edição do SDR validada no servidor somente para feedback e status; cada contato cria histórico com responsável e data/hora.
- Dez etapas, lista controlada e cores; cadastro, filtros, busca, dashboard, funil, ranking, follow-ups e gestão de usuários.
- Senha inicial temporária para a equipe, excluindo a conta administrativa conectada, e troca obrigatória no primeiro acesso.
- Estrutura de dados preparada para adicionar, desativar ou substituir pessoas e empreendimentos sem reconstruir a aplicação.

## Segurança

- O repositório público contém apenas código e configuração comercial sem nomes/e-mails da equipe.
- Dados de clientes e usuários ficam no Supabase privado. A chave `service_role` existe somente nas variáveis secretas do Netlify Functions; nunca deve estar no navegador, em `.env` versionado ou no GitHub.
- RLS filtra leituras por usuário e papel; não há permissões de gravação direta para contas autenticadas. As gravações passam pela API que valida perfil, carteira e campos permitidos.
- O primeiro administrador mantém o e-mail operacional já usado no CRM. Como a autenticação muda de Apps Script para Supabase Auth, a senha precisa ser definida/reativada uma vez no primeiro acesso ao novo ambiente; escolha a senha anterior se quiser continuar usando a mesma credencial.
- A inicialização é protegida por segredo temporário no Netlify. Depois de criar o primeiro administrador, remova as variáveis `CRM_BOOTSTRAP_SECRET` e `CRM_BOOTSTRAP_EMAIL` do site.

## Configuração local

Requisitos: Node.js 22 ou superior; não há dependências npm externas.

```bash
npm run build
npm test
```

O build gera `public/index.html`, embutindo CSS, JavaScript e logo para publicação estática. `npm run check` também executa verificações de segurança, regras de perfil, histórico, responsividade e estrutura.

## Variáveis de ambiente no Netlify

Configure apenas pelo painel ou API de ambiente do Netlify, no contexto **Functions/Runtime**:

| Variável | Uso |
| --- | --- |
| `SUPABASE_URL` | URL do projeto Supabase |
| `SUPABASE_ANON_KEY` | Chave pública usada somente no servidor para validar sessões Auth |
| `SUPABASE_SERVICE_ROLE_KEY` | Segredo usado pelo Netlify Functions para acesso administrativo ao Postgres/Auth |
| `CRM_BOOTSTRAP_EMAIL` | E-mail exato do administrador original |
| `CRM_BOOTSTRAP_SECRET` | Token aleatório temporário para a criação inicial do administrador |

Não inclua senhas de equipe em arquivos, variáveis de build, commits, logs ou mensagens de deploy. A senha padrão é digitada uma única vez pelo administrador na tela autenticada de preparação da equipe; são salvos apenas hashes pela autenticação do Supabase.

## Banco de dados

Execute as migrations de `supabase/migrations/` uma vez no projeto Supabase de produção. A migration habilita RLS, filtros de leitura por perfil/carteira e notificações Realtime; o Netlify Functions usa a chave privada para as operações validadas no servidor. Carregue a relação de empreendimentos diretamente no banco privado antes da ativação do primeiro administrador; a lista comercial não é incluída no repositório público.

Ao abrir o site sem usuários, a tela de configuração inicial aceita apenas o e-mail definido em `CRM_BOOTSTRAP_EMAIL` e o segredo definido em `CRM_BOOTSTRAP_SECRET`. Após ativar, remova ambos os segredos de bootstrap do Netlify. Cadastre a equipe em **Equipe**, gere a senha compartilhada uma única vez e distribua por canal privado.

## Atualizações

O painel faz sincronização automática periódica enquanto está aberto; salvamentos aparecem imediatamente para quem efetuou a alteração. A migration já habilita as tabelas necessárias para uma futura assinatura Supabase Realtime sem alterar a arquitetura de acesso.
