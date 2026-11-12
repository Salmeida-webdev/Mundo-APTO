# CRM Comercial — Mundo Apto

CRM web responsivo e integrado para relacionamento com clientes, produção comercial, metas, frequência de plantões, vendas, repasses e documentos da operação Mundo Apto / Sharks Fênix. Há uma única aplicação, navegação, identidade de usuário e base Supabase. A interface estática é publicada no Netlify; autenticação, regras de negócio e acesso ao banco passam por Netlify Functions. O Supabase/Postgres guarda os dados em projeto privado.

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
- Produção diária por corretor para prospecções, interações, agendamentos, visitas e vendas, com consolidação diária, semanal e mensal. Corretores lançam e corrigem seus próprios registros; a gestão pode corrigir registros da equipe; alterações ficam no histórico administrativo.
- Acesso operacional por capacidade: corretores ficam restritos aos próprios lançamentos e frequências; o SDR consulta a equipe sem editar; perfis administrativos consultam o painel, e as contas de gestão operacional designadas podem corrigir produção, configurar metas e lançar/corrigir frequências. A aplicação valida essa autorização no servidor.
- Metas semanais e mensais configuráveis por corretor para prospecções, visitas e vendas. Revisões criam uma nova versão sem apagar a meta anterior; painel mostra realizado, meta e quanto falta.
- Frequência de plantão por corretor, data e período (manhã, tarde e noite). Os registros são lançados pela gestão, têm histórico de alteração e podem ser consultados individualmente ou pela equipe conforme o perfil.
- Dashboard e relatórios de operação para produção, metas e frequência, com filtros por período e corretor, comparativos semanais/mensais e exportação gerencial. O módulo operacional não transforma contagem de vendas em receita ou comissão.
- Alertas gerenciais aparecem no dashboard. A gestão pode configurar o prazo de follow-up entre 1 e 30 dias úteis; o padrão inicial é 3 dias úteis.
- Fila SDR com novos cadastros separados dos clientes já contatados, avisos internos após 24 horas (inclusive aos fins de semana), sete tentativas de contato e lembrete para revisão de desistência. O CRM não envia esses avisos por e-mail ou WhatsApp.
- Solicitação de correção de telefone pelo SDR, apresentada como pendência na carteira do corretor responsável até a correção.
- Histórico administrativo com usuário, perfil, data/hora, ação, campos alterados e valores anteriores e novos. O registro detalhado começa depois da migration de operações; não recria alterações anteriores que não tinham sido guardadas.
- Controle manual de vendas e repasses, inclusive vendas de compradores que não foram cadastrados como clientes do CRM. Guarda número de processo/proposta, empreendimento, unidade, corretor, valor de venda, status, pendências, contabilização, repasse previsto, recebimentos parciais, saldo e observações. A gestão filtra por período, cliente/processo, corretor, empreendimento e status, e exporta exatamente o recorte visível em CSV. Recebimentos podem ser anulados pela gestão com justificativa; o lançamento e o motivo permanecem no histórico/auditoria, os totais ignoram a parcela anulada e a fase escolhida não é alterada. O controle não cria contrato automaticamente, não integra com contabilidade e não substitui conciliação financeira.
- Módulo de contratos restrito à gestão. Um contrato pode partir de um lead do CRM, de uma venda registrada manualmente em **Vendas e repasses**, ou de preenchimento manual sem lead; ao vincular uma venda, processo, comprador, empreendimento, corretor, unidade e valor são herdados do registro para evitar divergência. O formulário permite CPF e endereço do comprador, número de processo/proposta, empreendimento, unidade, valor, corretor, SDR e gerente signatários, CPF do SDR, base e percentual da comissão, comissão bruta total, prêmio opcional e percentual/valor bruto do prêmio. O CRM divide comissão e prêmio em 50% para corretor e 50% para SDR.
- Contrato/termo de remuneração e confissão de dívida têm modelos, geração, arquivos e confirmação de assinatura separados. O modelo inicial do contrato deve ser revisado pela empresa; a confissão inicia sem modelo configurado e só pode ser gerada após a gestão salvar o texto aprovado. O CRM não inventa cláusulas jurídicas nem oferece assinatura eletrônica.
- A gestão pode exportar os metadados dos contratos em CSV, sem anexar o conteúdo dos documentos. Arquivos `.doc` compatíveis com Word são baixados para assinatura externa; a gestão anexa cada versão assinada e confirma manualmente as assinaturas do corretor, SDR e gerente. O CRM verifica se o arquivo chegou ao armazenamento, mas não valida assinaturas digitais. O corretor e o SDR vinculados só consultam e baixam documentos assinados depois da confirmação do contrato principal e da confirmação individual de cada documento. Os arquivos ficam em armazenamento privado com links temporários.
- Dados cadastrais do corretor (CPF, CNPJ, CRECI e endereço) ficam restritos à gestão. O armazenamento de documentos de contrato é privado, com links temporários gerados após validação do perfil.
- Senha inicial temporária para a equipe, excluindo a conta administrativa conectada, e troca obrigatória no primeiro acesso.
- Estrutura de dados preparada para adicionar, desativar ou substituir pessoas e empreendimentos sem reconstruir a aplicação.

## Segurança

- O repositório público contém apenas código e configuração comercial sem nomes/e-mails da equipe.
- Dados de clientes e usuários ficam no Supabase privado. A chave secreta do Supabase existe somente nas variáveis secretas do Netlify Functions; nunca deve estar no navegador, em `.env` versionado ou no GitHub.
- RLS está ativo nas tabelas privadas e não há acesso direto às tabelas operacionais para contas públicas/autenticadas. O navegador usa a API do servidor; cada operação valida sessão, papel, carteira e campos permitidos. A chave de serviço fica exclusivamente na Function.
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
| `CRM_BOOTSTRAP_SECRET` | Necessário somente durante a criação do primeiro administrador; remover do Netlify após a inicialização |

Não inclua senhas de equipe em arquivos, variáveis de build, commits, logs ou mensagens de deploy. A senha padrão é digitada uma única vez pelo administrador na tela autenticada de preparação da equipe; são salvos apenas hashes pela autenticação do Supabase.

## Banco de dados

O histórico de migrations no repositório acompanha as versões aplicadas no Supabase. A base recebeu as estruturas de operação e contratos desta entrega, sem importar lançamentos ou usuários do Sharks e sem apagar clientes, vendas, contratos ou históricos do CRM. As tabelas de produção, metas e frequência começam vazias; os lançamentos passam a ser registrados pelos usuários no CRM integrado. As permissões operacionais são mantidas em configuração privada e devem ser atualizadas por manutenção técnica autorizada; identificadores e segredos não devem ser incluídos no repositório público.

Ao abrir um banco sem usuários, a tela de configuração inicial aceita o segredo definido em `CRM_BOOTSTRAP_SECRET` e o e-mail administrativo informado pelo responsável. O endpoint fecha automaticamente depois da criação do primeiro administrador. Depois da inicialização, remova essa variável do Netlify; para uma futura recuperação, gere um novo segredo temporário e remova-o novamente depois de criar o administrador. Cadastre a equipe em **Equipe**, gere a senha compartilhada uma única vez e distribua por canal privado.

## Atualizações

O painel e as outras telas atualizam em tempo real após alterações feitas por usuários autenticados. O canal transmite somente a data/hora de um sinal técnico, não dados pessoais; a interface mantém uma consulta de segurança a cada 20 segundos e exibe se o tempo real está conectado ou se está usando a atualização automática de fallback.

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

Na tela **Contratos**, apenas os perfis administrativos podem criar rascunhos, gerar documentos, exportar metadados em CSV, editar os modelos e manter os dados cadastrais dos corretores. O contrato pode partir de uma venda manual ou de um lead; os campos herdados de venda não podem divergir do lançamento original. Comissão e prêmio são informados pelo valor bruto total e divididos meio a meio entre corretor e SDR. Contrato/termo e confissão de dívida são arquivos independentes. Cada documento gerado guarda a versão do modelo usada; cada arquivo assinado exige confirmação de que corretor, SDR e gerente assinaram. Se um upload falhar antes da confirmação, a gestão pode tentar confirmar novamente após verificar que o arquivo chegou, ou reenviá-lo. O acesso do corretor e do SDR vinculados fica limitado aos arquivos assinados confirmados, e só é liberado depois da confirmação do contrato principal.

## Produção, metas e frequência integradas

Na navegação **Operação**, a produção diária registra prospecções, interações, agendamentos, visitas, vendas e observações por corretor/data. Um corretor pode manter vários lançamentos na mesma data e corrigir os próprios lançamentos passados; a gestão pode corrigir os registros da equipe. O histórico registra autor, data/hora e valores anteriores e novos.

As metas são configuradas na própria aplicação por corretor e por ciclo semanal (segunda a domingo) ou mensal (primeiro ao último dia), para prospecções, visitas e vendas. A gestão pode alterar metas; cada ajuste preserva a versão anterior. A frequência registra presença por manhã, tarde e noite. A gestão lança ou corrige; os corretores consultam conforme seu perfil, sem editar nem acessar a frequência de outros. Painéis e relatórios consolidam resultados individuais e da equipe, comparativos, tarefas e exportações respeitando o perfil.
