# CRM Comercial — Mundo Apto

CRM web responsivo para gestão de atendimentos, clientes e funil comercial imobiliário. A interface estática é publicada no Netlify; autenticação, regras de negócio e acesso ao banco passam por Netlify Functions. O Supabase/Postgres guarda os dados em projeto privado.

## Escopo coberto

- Acesso por e-mail e senha com papéis: Administrador, Gerente, Coordenador, Assistente, SDR e Corretor.
- Carteiras isoladas: corretor consulta e atualiza apenas os próprios clientes; a gestão e o SDR consultam a equipe toda.
- O SDR pode cadastrar um cliente e atribuí-lo a um corretor ativo. O registro passa a integrar a carteira escolhida; isso não altera o papel nem as permissões do SDR.
- Depois do cadastro, edição do SDR validada no servidor somente para feedback e status; cada contato cria histórico com responsável e data/hora.
- Dez etapas, lista controlada e cores; cadastro, filtros, busca, dashboard, funil, ranking, follow-ups e gestão de usuários.
- Empreendimentos podem ser cadastrados, editados, ativados ou desativados pela gestão. Desativar não apaga clientes ou históricos vinculados.
- Importação por CSV padronizado com pré-validação de campos, corretor, empreendimento e telefones duplicados; exportação de clientes filtrados e relatórios gerenciais em CSV. Apenas perfis administrativos podem importar ou exportar.
- Análises históricas com coortes de conversão entre etapas e geral, comparação de períodos de 7 ou 30 dias com a janela anterior, volume de contatos SDR, tempo médio até o primeiro contato, tendência de follow-ups atrasados e concentração de clientes parados por corretor/empreendimento.
- Alertas gerenciais são apresentados no dashboard. O prazo operacional de follow-up permanece em três dias úteis.
- Senha inicial temporária para a equipe, excluindo a conta administrativa conectada, e troca obrigatória no primeiro acesso.
- Estrutura de dados preparada para adicionar, desativar ou substituir pessoas e empreendimentos sem reconstruir a aplicação.

## Segurança

- O repositório público contém apenas código e configuração comercial sem nomes/e-mails da equipe.
- Dados de clientes e usuários ficam no Supabase privado. A chave secreta do Supabase existe somente nas variáveis secretas do Netlify Functions; nunca deve estar no navegador, em `.env` versionado ou no GitHub.
- RLS filtra leituras por usuário e papel; não há permissões de gravação direta para contas autenticadas. As gravações passam pela API que valida perfil, carteira e campos permitidos.
- O primeiro administrador mantém o e-mail operacional já usado no CRM. Como a autenticação muda de Apps Script para Supabase Auth, a senha precisa ser definida/reativada uma vez no primeiro acesso ao novo ambiente; escolha a senha anterior se quiser continuar usando a mesma credencial.
- A inicialização é protegida por segredo temporário no Netlify. O e-mail administrativo é informado na tela de ativação; o endpoint aceita a configuração somente enquanto não existir nenhum usuário.

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
| `SUPABASE_PUBLISHABLE_KEY` | Chave pública usada somente no servidor para validar sessões Auth |
| `SUPABASE_SECRET_KEY` | Segredo moderno usado pelo Netlify Functions para acesso administrativo ao Postgres/Auth |
| `CRM_BOOTSTRAP_SECRET` | Token aleatório temporário para a criação inicial do administrador |

Não inclua senhas de equipe em arquivos, variáveis de build, commits, logs ou mensagens de deploy. A senha padrão é digitada uma única vez pelo administrador na tela autenticada de preparação da equipe; são salvos apenas hashes pela autenticação do Supabase.

## Banco de dados

Execute as migrations de `supabase/migrations/` uma vez no projeto Supabase de produção. A primeira cria o schema privado e as regras de leitura; a segunda cria o histórico de etapas e o registro automático de transições de status. O Netlify Functions usa a chave secreta apenas no cabeçalho `apikey` para operações validadas no servidor.

Ao abrir o site sem usuários, a tela de configuração inicial aceita o segredo definido em `CRM_BOOTSTRAP_SECRET` e o e-mail administrativo informado pelo responsável. O endpoint fecha automaticamente depois da criação do primeiro administrador. Como alterações de variáveis só entram em vigor no próximo deploy, remova `CRM_BOOTSTRAP_SECRET` na próxima publicação planejada; não é necessário fazer um segundo deploy apenas para isso. Cadastre a equipe em **Equipe**, gere a senha compartilhada uma única vez e distribua por canal privado.

## Atualizações

O painel faz sincronização automática enquanto está aberto e atualiza imediatamente para quem salvou. A interface consulta alterações a cada 20 segundos.

As análises históricas começam com uma fotografia dos status atuais na data da migration e registram os eventos seguintes. Mudanças anteriores à fotografia e contatos SDR não armazenados não podem ser reconstruídos.

A importação usa CSV UTF-8 compatível com Excel e Google Sheets, até 200 clientes por arquivo. Nome, telefone, empreendimento e e-mail do corretor são obrigatórios; telefones duplicados bloqueiam a importação para revisão.

A gestão de empreendimentos preserva clientes e históricos ao desativar uma opção.
