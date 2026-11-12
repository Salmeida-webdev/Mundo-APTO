# CRM Comercial — Mundo Apto

CRM web responsivo para gestão de atendimentos, clientes, vendas, repasses e documentos comerciais da Mundo Apto. A interface estática é publicada no Netlify; autenticação, regras de negócio e acesso ao banco passam por Netlify Functions. O Supabase/Postgres guarda os dados em projeto privado. Lançamentos diários de produção, metas e frequências de plantão pertencem a uma ferramenta separada e não são implementados nem sincronizados neste repositório.

## Escopo coberto

- Acesso por e-mail e senha com papéis: Administrador, Gerente, Coordenador, Assistente, SDR e Corretor.
- Carteiras isoladas: corretor consulta e atualiza apenas os próprios clientes; a gestão e o SDR consultam a equipe toda.
- O SDR pode cadastrar um cliente e atribuí-lo a um corretor ativo. O registro passa a integrar a carteira escolhida; isso não altera o papel nem as permissões do SDR.
- Depois do cadastro, edição do SDR validada no servidor somente para feedback e status; cada contato cria histórico com responsável e data/hora.
- Dez etapas, lista controlada e cores; cadastro, filtros, busca, dashboard, funil, ranking, follow-ups e gestão de usuários.
- Empreendimentos podem ser cadastrados, editados, ativados ou desativados pela gestão. Desativar não apaga clientes ou históricos vinculados.
- A gestão pode excluir e restaurar clientes e usuários. A exclusão é reversível: clientes saem das listas e indicadores ativos, enquanto cadastros, históricos e atribuições permanecem preservados; usuários perdem o acesso e podem ser restaurados com o estado de acesso anterior.
- Importação por CSV padronizado com pré-validação de campos, corretor, empreendimento e telefones duplicados; exportação de clientes filtrados e relatórios gerenciais em CSV. Apenas perfis administrativos podem importar ou exportar.
- Análises históricas com conversões entre etapas e geral; comparação da semana atual com a semana anterior e do mês atual com o mesmo recorte do mês anterior; contatos SDR, tempo até o primeiro contato, atrasos e concentração por etapa, corretor e empreendimento.
- Alertas gerenciais aparecem no dashboard. A gestão pode configurar o prazo de follow-up entre 1 e 30 dias úteis; o padrão inicial é 3 dias úteis.
- Fila SDR com novos cadastros separados dos clientes já contatados, avisos internos após 24 horas (inclusive aos fins de semana), sete tentativas de contato e lembrete para revisão de desistência. O CRM não envia esses avisos por e-mail ou WhatsApp.
- Solicitação de correção de telefone pelo SDR, apresentada como pendência na carteira do corretor responsável até a correção.
- Histórico administrativo com usuário, perfil, data/hora, ação, campos alterados e valores anteriores e novos. O registro detalhado começa depois da migration de operações; não recria alterações anteriores que não tinham sido guardadas.
- Controle manual de vendas e repasses, inclusive vendas de compradores que não foram cadastrados como clientes do CRM. Guarda número de processo/proposta, empreendimento, unidade, corretor, valor de venda, status, pendências, contabilização, repasse previsto, recebimentos parciais, saldo e observações. A gestão filtra por período, cliente/processo, corretor, empreendimento e status, e exporta exatamente o recorte visível em CSV. O controle não gera contrato automaticamente, não integra com contabilidade e não substitui conciliação financeira.
- Módulo de contratos restrito à gestão, ligado a um cliente cadastrado no CRM. O modelo inicial em branco segue a estrutura e as cláusulas do termo operacional fornecido para Mundo Apto; não contém os dados do exemplo preenchido e assinado. O formulário permite número de proposta/pasta, comprador e CPF, empreendimento, unidade, valor de venda, corretor, SDR e gerente signatários, CPF do SDR, base e percentual da comissão quando aplicáveis, valor bruto da comissão, opção e percentual de prêmio e valores brutos. Os dados de corretor (nome, CPF, CNPJ, CRECI e endereço) são preenchidos pelo cadastro administrativo e inseridos no documento. O CRM divide comissão e prêmio em 50% para corretor e 50% para SDR.
- A gestão pode exportar o cadastro de contratos em CSV, sem anexar os documentos. O documento Word compatível (`.doc`) é baixado para assinatura externa; não há assinatura eletrônica. A gestão anexa e confirma o arquivo assinado. Só depois disso o corretor e o SDR vinculados podem consultar e baixar o documento assinado. Os arquivos ficam em armazenamento privado com links temporários.
- Dados cadastrais do corretor (CPF, CNPJ, CRECI e endereço) ficam restritos à gestão. O armazenamento de documentos de contrato é privado, com links temporários gerados após validação do perfil.
- Senha inicial temporária para a equipe, excluindo a conta administrativa conectada, e troca obrigatória no primeiro acesso.
- Estrutura de dados preparada para adicionar, desativar ou substituir pessoas e empreendimentos sem reconstruir a aplicação.

## Segurança

- O repositório público contém apenas código e configuração comercial sem nomes/e-mails da equipe.
- Dados de clientes e usuários ficam no Supabase privado. A chave secreta do Supabase existe somente nas variáveis secretas do Netlify Functions; nunca deve estar no navegador, em `.env` versionado ou no GitHub.
- RLS filtra leituras por usuário e papel; não há permissões de gravação direta para contas autenticadas. As gravações passam pela API que valida perfil, carteira e campos permitidos.
- As tabelas novas de tentativas, vendas, parcelas, contratos e documentos são acessíveis apenas ao servidor do CRM; os documentos ficam em bucket privado.
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

Execute, em ordem, as migrations de `supabase/migrations/` uma vez no projeto Supabase do CRM de produção. As primeiras criam o schema privado, o histórico de etapas e as exclusões reversíveis. `202611120001_crm_operations_extensions.sql` acrescenta trilha de auditoria detalhada, fila SDR, vendas/parcelas manuais, dados de corretores e documentos de contrato. `20261112032100_crm_operations_fk_indexes.sql` adiciona índices para as relações e consultas administrativas. `20261112040000_crm_contract_template_fields.sql` adiciona número da proposta, CPF do SDR, base e percentuais opcionais de comissão/prêmio. `20261112050000_crm_repass_phase_statuses.sql` substitui as fases genéricas do repasse pelos 30 valores definidos pela cliente e mantém a fase independente do lançamento de recebimentos. São alterações de esquema; não removem registros. O Netlify Functions usa a chave secreta apenas no servidor para operações validadas pelo CRM.

Ao abrir o site sem usuários, a tela de configuração inicial aceita o segredo definido em `CRM_BOOTSTRAP_SECRET` e o e-mail administrativo informado pelo responsável. O endpoint fecha automaticamente depois da criação do primeiro administrador. Como alterações de variáveis só entram em vigor no próximo deploy, remova `CRM_BOOTSTRAP_SECRET` na próxima publicação planejada; não é necessário fazer um segundo deploy apenas para isso. Cadastre a equipe em **Equipe**, gere a senha compartilhada uma única vez e distribua por canal privado.

## Atualizações

O painel faz sincronização automática enquanto está aberto e atualiza imediatamente para quem salvou. A interface consulta alterações a cada 20 segundos.

As análises históricas começam com uma fotografia dos status atuais na data da migration e registram os eventos seguintes. Mudanças anteriores à fotografia e contatos SDR não armazenados não podem ser reconstruídos.

As análises usam semana e mês do calendário em `America/Sao_Paulo`; a comparação considera o período anterior até o mesmo dia da semana ou do mês. Um intervalo personalizado nos filtros compara o recorte selecionado com o intervalo anterior de igual duração.

A importação usa CSV UTF-8 compatível com Excel e Google Sheets, até 200 clientes por arquivo. Nome, telefone, empreendimento e e-mail do corretor são obrigatórios; telefones duplicados bloqueiam a importação para revisão.

A gestão de empreendimentos preserva clientes e históricos ao desativar uma opção.

## Exclusão e restauração

Nas telas **Clientes** e **Equipe**, os perfis administrativos encontram os botões **Excluir** e as listas de itens excluídos. A ação exige confirmação e arquiva o registro; não apaga fisicamente os dados.

- Clientes excluídos deixam de aparecer nas listas ativas, no funil, no ranking e nas exportações. A ficha e o histórico SDR continuam guardados e podem ser restaurados.
- Usuários excluídos perdem o acesso e têm suas sessões do CRM encerradas. Seus perfis, e-mails e relações com clientes permanecem para manter o histórico; a gestão pode restaurá-los. O acesso volta ao estado ativo ou desativado que tinham antes.
- A própria conta conectada não pode ser excluída. O sistema também preserva ao menos um perfil administrativo ativo.
- A migration 20261111152136_crm_reversible_deletions.sql é somente de esquema: acrescenta colunas e índices nulos, sem atualizar nem excluir registros existentes.

## Vendas, repasses e contratos

Na tela **Vendas e repasses**, a gestão registra os dados manualmente. O campo de cliente não depende de um cadastro na carteira; isso permite acompanhar vendas externas ao fluxo de leads. A **situação da venda** e a **fase do repasse** são campos separados. A fase usa exatamente os 30 status definidos pela cliente. As parcelas são append-only: novos recebimentos entram no histórico em vez de sobrescrever os anteriores; o total recebido e o saldo são recalculados sem alterar automaticamente a fase escolhida pela gestão. O indicador de repasse pendente considera vendas não canceladas com valor previsto e saldo em aberto. Os filtros da tela se aplicam também à exportação CSV.

Na tela **Contratos**, apenas os perfis administrativos podem criar rascunhos, gerar documentos, exportar metadados em CSV, editar o modelo e manter os dados cadastrais dos corretores. O modelo em branco já está disponível para revisão da empresa. Os documentos são preparados com os dados preenchidos e dividem os valores totais de comissão e prêmio em metades. A gestão anexa o arquivo assinado e confirma a conclusão. O acesso do corretor e do SDR vinculados fica limitado aos documentos assinados após essa confirmação.
