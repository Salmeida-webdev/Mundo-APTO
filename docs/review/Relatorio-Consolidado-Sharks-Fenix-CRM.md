# Relatório de consolidação — Sharks Fênix no CRM Mundo Apto

**Data:** 12 de novembro de 2026
**Finalidade:** documentar o que a aplicação Sharks Fênix oferece hoje e planejar sua incorporação ao CRM, conforme o adendo da cliente.
**Status deste documento:** relatório histórico de análise elaborado antes da implementação. O escopo unificado foi consolidado no CRM Mundo Apto; o estado técnico e as orientações de publicação ficam registrados em `docs/STATUS-IMPLANTACAO.md`.

---

## 1. Direção aprovada e conclusão de produto

O adendo muda a arquitetura de produto que havia sido definida inicialmente. Sharks Fênix e CRM Mundo Apto passam a ser planejados como **uma plataforma operacional integrada**, reunindo as funções de relacionamento comercial do CRM com produção, metas, frequência e relatórios da Sharks Fênix. A incorporação não deve apagar nem simplificar as regras já aprovadas para o CRM: os módulos continuam com responsabilidades claras e passam a compartilhar navegação, identidade visual e autenticação.

A melhor classificação para o produto consolidado é **sistema de gestão comercial e operação de equipe**, ou **plataforma operacional comercial integrada**. Em termos de categorias conhecidas:

| Categoria | Enquadramento |
|---|---|
| CRM | Continua sendo o núcleo de relacionamento com clientes, carteiras, empreendimentos, etapas e histórico de contatos. |
| Gestão de desempenho comercial | É a função adicionada pela Sharks: lançamentos diários, metas, frequência, rankings e comparação de períodos. |
| Dashboard/BI operacional | É uma camada de leitura e análise dentro da plataforma, não a classificação do produto inteiro. |
| ERP | Não é um ERP no escopo atual. Não há módulos de contabilidade, contas a pagar/receber, compras, estoque, folha ou fiscal. |

Portanto, não é apenas um CRM com um painel, nem apenas um dashboard. É um CRM ampliado com gestão da rotina e do desempenho da equipe.

## 2. Base consultada e limites desta análise

Este inventário foi cruzado com o código e as migrações Sharks disponíveis no workspace, as orientações registradas nesta conversa e a gravação de tela da aplicação. O material técnico consultado inclui os tipos de dados, a interface React, o cliente de autenticação, a API Edge Function `sharks-api` e as migrações SQL de produção, metas, frequência, auditoria, políticas de acesso e fila inicial de usuários.

A migração de usuários contém um **retrato de 21 contas do CRM consultado em 12/11/2026**: 18 corretores, 1 SDR, 1 gerente e 1 assistente. A fila executa a preparação das contas quando a equipe é carregada; o estado atual de cada registro no banco remoto não foi consultado nesta análise. A lista é um retrato inicial, não prova que todas as contas estejam hoje habilitadas.

O briefing PDF original não ficou disponível para leitura nesta etapa. Assim, o relatório se limita a requisitos recuperáveis do histórico e do software existente. Antes da implementação, a matriz abaixo deve ser confrontada com o briefing e com as permissões efetivas do CRM. Não se deve preencher lacunas por suposição.

## 3. Aplicação Sharks Fênix existente

### 3.1 Painel de desempenho

A visão geral combina produção e frequência no intervalo selecionado. O período padrão é a semana atual, de segunda a domingo, calculada no fuso de São Paulo. O sistema compara o período com outro de duração equivalente e atualiza o painel a cada 60 segundos enquanto a página está visível, além de atualizar quando a janela ganha foco.

Os seis indicadores apresentados são:

- prospecções;
- interações;
- agendamentos;
- visitas;
- vendas contabilizadas;
- frequências registradas.

O painel também inclui tendência diária de prospecções, visitas e vendas; progresso das metas; ranking de corretores; registros recentes para o próprio corretor; frequência total e separada por turno; indicação de atualização e mensagens de erro com tentativa de recarga. Os dados de vendas são **quantidades**, não valores em reais, e não representam receita ou comissão.

### 3.2 Lançamentos de produção

Cada lançamento está associado a um corretor e a uma data. O formulário registra cinco contagens inteiras: prospecções, interações, agendamentos, visitas e vendas, além de uma observação de até 1.500 caracteres. É possível criar vários lançamentos para o mesmo corretor no mesmo dia; por isso, um lançamento representa um bloco de atividades e não necessariamente o total diário final.

A listagem oferece busca por corretor/observação, filtro por corretor para perfis com leitura da equipe e intervalo de datas. Corretores registram e alteram os próprios dados. A gestão pode registrar e corrigir dados de corretores. Cancelar um lançamento é uma exclusão lógica: o item deixa de compor a consulta ativa, mas permanece identificável na auditoria.

### 3.3 Metas e resultados

A gestão define metas por corretor para três indicadores: prospecções, visitas e vendas. Os ciclos são semanais — sempre de segunda a domingo — ou mensais — o mês-calendário completo. O painel mostra realizado, alvo, percentual, saldo restante ou excedente e período coberto.

Alterar uma meta cria uma nova revisão encadeada à anterior; a revisão anterior deixa de ser a vigente, mas é mantida. O histórico de metas permite explicar o valor que valia em determinado período. Corretores consultam as próprias metas; o SDR e a gestão podem ler o conjunto da equipe; a criação/revisão é restrita à gestão.

### 3.4 Frequência de plantões

A frequência é registrada por corretor, data e turno: manhã, tarde ou noite. Só é possível haver um registro ativo para a mesma combinação. A gestão marca ou cancela a presença; o corretor consulta suas próprias frequências sem editar. A tela mostra totais por turno, pesquisa de corretores para a gestão e navegação semanal dentro do intervalo escolhido. Não são aceitas datas futuras.

O painel e os relatórios consolidam presenças por período, corretor e turno. A exclusão também é lógica e auditada. Essa função não é controle de ponto trabalhista: o escopo implementado registra presença em plantões e não calcula jornada, horas trabalhadas, banco de horas ou folha.

### 3.5 Relatórios e exportação

A tela de relatórios reúne:

1. totais do período para as cinco métricas e frequência;
2. comparação com o período anterior de igual duração;
3. produção consolidada por corretor, incluindo as cinco métricas;
4. frequência por corretor e por turno;
5. exportação local em CSV, delimitada por ponto e vírgula e compatível com acentos.

A exportação contém data, corretor, indicadores e observações, além da tabela de frequência. O código protege valores textuais que poderiam ser interpretados como fórmulas por planilhas. A regra de acesso da consulta deve ser aplicada também à exportação: um perfil com visão própria não pode obter dados de equipe por baixar um arquivo.

Não há geração de valores financeiros, comissão, previsão de receita ou integração financeira neste módulo.

### 3.6 Histórico de alterações

O histórico registra inclusões, alterações, cancelamentos e restaurações que ocorram sobre produção, metas, frequência e contas. Exibe o autor (nome e e-mail), data/hora, tipo de entidade, ação, contexto do corretor/período e campos alterados. A busca cobre os registros já carregados; a API trabalha com paginação por cursor, normalmente em páginas de 50 registros.

O histórico é exclusivo da gestão no Sharks atual. Ele deve ser levado para o CRM integrado sem perder autoria, horários, IDs e contexto. A unificação pode criar uma visão única de auditoria filtrável por módulo, mas deve manter a identificação explícita da origem (CRM ou produção/frequência).

### 3.7 Equipe e acessos

A área administrativa lista usuários por nome, e-mail, classificação, situação de acesso e estado da senha. Oferece busca e filtros de contas habilitadas ou pendentes, criação, edição, desativação lógica e senha temporária individual. A desativação bloqueia o acesso ao módulo e preserva os registros históricos. O próprio usuário e a conta de desenvolvedor recebem proteções contra operações administrativas comuns.

A conta técnica reconhecida pelo código é `segundoalmeidawebdev@gmail.com`. Ela pode iniciar o próprio primeiro acesso por link seguro e é a única autorizada a executar a ação de senha temporária em lote. O processo de primeiro acesso exige que cada usuário crie sua senha pessoal. Senhas têm mínimo de 12 caracteres nos formulários e nunca devem ser armazenadas em tabelas operacionais em texto puro.

O estado atual, porém, mostra “autenticação própria da Sharks Fênix”: as identidades do Sharks são independentes das do CRM. Há uma fila privada de importação com o retrato de 21 contas, e o provisionamento pode criar identidades na autenticação Sharks. Logo, o comportamento desejado pelo usuário — mesmo login e senha nos dois sistemas — **ainda não é garantido por esta implementação**. Isso deve ser resolvido arquiteturalmente, sem copiar senhas manualmente entre bancos.

## 4. Classificações e permissões no Sharks atual

O modelo de dados usa classificações `Administrador`, `Gerente`, `Coordenador`, `Assistente`, `SDR` e `Corretor`, além dos níveis técnicos `admin`, `manager`, `sdr`, `broker` e `none`.

| Perfil no módulo Sharks | Leitura | Escrita/gestão no Sharks atual |
|---|---|---|
| Desenvolvedor — e-mail autorizado | Toda a operação Sharks | Administração do módulo; pode iniciar primeiro acesso e definir senhas temporárias em lote. O código não permite que gestores comuns se promovam a administrador. |
| Administrador, Gerente, Coordenador, Assistente com acesso `manager` | Produção, metas, frequência e equipe | Pode lançar/corrigir produção da equipe, definir/revisar metas, registrar/cancelar frequência, consultar auditoria e administrar contas, respeitando as proteções para a própria conta e para a conta técnica. |
| SDR com acesso `sdr` | Produção e metas da equipe; frequência própria | Não grava produção, não administra metas, não altera presença nem acessa a auditoria ou administração de usuários do Sharks. |
| Corretor com acesso `broker` | Seus próprios lançamentos, metas e frequência | Pode registrar/corrigir os próprios lançamentos de produção; não administra metas, equipe ou frequência. |
| Qualquer perfil com acesso `none`, inativo ou excluído logicamente | Nenhum dado operacional autorizado | Sem acesso ao módulo. |

**Ponto de controle para a integração:** no Sharks atual, quatro classificações administrativas são agrupadas na mesma capacidade `manager`. Isso pode não refletir as diferenças finas de autorização já existentes no CRM. Não se deve aplicar essa regra automaticamente a clientes, carteiras, feedbacks, exportações ou transferência de cadastros. A matriz do CRM continua sendo a fonte de verdade para as funções do CRM; as permissões da produção precisam ser mapeadas separadamente e aprovadas por função.

## 5. Dados, arquitetura e salvaguardas atuais

A aplicação usa React/TypeScript no frontend, autenticação Supabase e uma Supabase Edge Function para a API. As tabelas Sharks identificadas nas migrações são:

| Tabela | Uso |
|---|---|
| `app_members` | Perfil local Sharks, classificação, permissão do módulo, atividade da conta e exigência de troca de senha. |
| `production_entries` | Data, corretor, cinco contagens, observações, autoria, atualização e cancelamento lógico. |
| `goals` | Indicador, corretor, ciclo, alvo, revisão, vigência e vínculo à revisão anterior. |
| `attendance_records` | Corretor, data, turno, autoria e cancelamento lógico. |
| `audit_logs` | Ator, ação, entidade, campos/contexto e data/hora. |
| `app_settings` | Fuso de São Paulo, início da semana na segunda-feira e configuração dos indicadores. |
| `sharks_team_import_queue` | Fila privada de contas do CRM a preparar no Sharks. Acesso limitado ao serviço. |

O navegador envia o token de sessão a uma Edge Function; as operações de escrita passam por essa camada. As migrações habilitam RLS, revogam gravações diretas do cliente autenticado em tabelas operacionais e deixam a chave de serviço no ambiente seguro do servidor. O serviço valida o ator, papel e dados, e grava auditoria. O acesso não deve depender apenas de esconder botões na interface: API e políticas do banco precisam negar operações não autorizadas.

A integração proposta deve manter esse padrão. A chave `service_role` nunca deve ser enviada ao frontend ou incluída no repositório. Também é necessário conferir a aplicação efetiva de cada migração no banco de destino antes de migrar dados ou usuários; a leitura de arquivos SQL não prova que o estado remoto esteja igual.

## 6. Funções do CRM que devem continuar existindo

A incorporação é aditiva. O CRM mantém seu ciclo de relacionamento e suas regras próprias, entre elas:

- cadastro e acompanhamento de clientes/leads, com responsável, telefone, empreendimento, observações, feedback e status;
- carteira individual do corretor e acesso de equipe para os perfis autorizados;
- atuação do SDR com consulta ampla e edição restrita aos campos de feedback/status conforme a regra já acordada;
- histórico de contatos, data/hora e tentativas de contato;
- filtros por cliente, corretor, empreendimento, status e período;
- etapas do funil e estados específicos do processo, preservados conforme o CRM existente;
- acompanhamento de follow-up e alertas operacionais já definidos no CRM;
- painel, totais, funil, indicadores e ranking existentes;
- gestão de empreendimentos, importação/exportação validada, análises históricas e trilha administrativa que já foram aprovadas.

Produção, metas e frequência passam a compor a mesma plataforma, mas não devem ser confundidas com status de lead, fase de repasse ou histórico de relacionamento. São domínios e relatórios distintos, ligados pela identidade do usuário e pela navegação.

## 7. Recomendação de arquitetura unificada

### 7.1 Identidade única

Usar a autenticação já consolidada do CRM como fonte de identidade da plataforma, após confirmar qual projeto Supabase é o destino oficial. Cada pessoa deve ter uma identidade única e um ID estável compartilhado. As tabelas de produção passam a referenciar esse mesmo ID; não se cria uma segunda conta só para acessar a Sharks.

Não duplicar hash nem senha entre bancos. Se os dois módulos usarem o mesmo provedor de autenticação, uma alteração de senha afeta a conta unificada e o usuário entra nos dois módulos com a mesma credencial. Isso atende ao objetivo de login compartilhado com menos risco e menos contas órfãs.

Para contas existentes do CRM, preservar as credenciais atuais durante a migração, salvo autorização explícita para redefinição. Para novos usuários, emitir link seguro/convite e exigir senha pessoal no primeiro acesso. O primeiro acesso do desenvolvedor deve ser por convite de uso único ou fluxo de recuperação controlado, com a identidade autorizada pelo e-mail e sem senha fixa embutida no código.

A ferramenta de senha temporária em lote, se mantida, deve avisar que uma senha alterada na identidade unificada também vale para o CRM. Registrar quem a executou, quando, quantidade de contas afetadas e exigência de troca; nunca registrar a senha em auditoria. Recomenda-se usar lote apenas na entrada inicial de contas sem credencial, não como rotina de redefinir as senhas atuais de toda a equipe.

### 7.2 Permissões por módulo

Manter as classificações existentes do CRM, mas representar capacidades por módulo e ação. Exemplo conceitual: acesso a `crm.clientes.ler`, `crm.clientes.editar_feedback`, `crm.clientes.editar_status`, `producao.ler_equipe`, `producao.lancar_proprio`, `producao.editar_equipe`, `metas.gerir`, `frequencia.registrar`, `relatorios.exportar`, `usuarios.gerir` e `auditoria.ler`.

O mapa final deve ser construído a partir das permissões reais do CRM e da regra de negócio da cliente. A classificação comunica o papel da pessoa; a permissão define o que ela pode fazer. Assim, manter `SDR` ou `Coordenador` como classificação não obriga que todos recebam permissões idênticas em cada módulo.

Aplicar as permissões no servidor e no banco. A interface reflete as regras, mas não substitui autorização. Exportar CSV é uma operação de leitura de dados e precisa da mesma verificação de carteira/equipe que a tela.

### 7.3 Organização de dados e auditoria

Migrar entidades operacionais Sharks com namespace/domínio próprio, ainda que fiquem no mesmo banco do CRM. Preservar tabelas de produção, metas e frequência com seus identificadores e vínculos aos usuários unificados. Na auditoria, permitir busca por módulo e entidade, conservando eventos originais e distinguindo mudanças do CRM de mudanças operacionais.

A administração de usuários deve existir uma única vez. Cadastro, classificação, ativação, desativação e convite alteram uma identidade comum. A tela pode exibir permissões por módulo, mas não deve manter duas listas com e-mails/contas independentes.

## 8. Identidade visual Sharks Fênix

### 8.1 Elementos que devem permanecer

A marca apresentada é um emblema circular de fundo preto, contorno dourado, tubarão antropomórfico armado ao centro, asas/chamas de fênix, nome `SHARKS FÊNIX`, assinatura `DIRETORIA FÊNIX` e marca Mundo Apto na base. O conjunto transmite força, competitividade, liderança e renascimento. A base visual é **preto/carvão + dourado/bronze + fogo/fênix**, com tipografia de impacto no logotipo.

O nome da aplicação deve continuar sendo **Sharks Fênix**. `Diretoria Fênix` pode funcionar como assinatura institucional; `Produção & Frequência` identifica o módulo ou a área operacional. Como o emblema contém a marca Mundo Apto, manter essa assinatura no produto consolidado preserva a relação com a empresa cliente; a posição final da assinatura deve ser deliberada antes de redesenhar os arquivos da logo.

### 8.2 Tratamento recomendado da logo

A arte atual é uma imagem quadrada ilustrada, rica em detalhes e textos. Ela funciona em login, capa e comunicação de marca, mas pode perder legibilidade em espaços compactos como favicon, cabeçalho estreito e avatar. Preparar variantes sem alterar a identidade do tubarão/fênix:

- versão principal quadrada para login, apresentação e página institucional;
- selo simplificado (símbolo sem textos pequenos) para favicon e ícone de navegação;
- lockup horizontal com selo e wordmark para cabeçalho/sidebar;
- versão monocromática/dourada de alto contraste para fundos claros ou impressão;
- arquivos otimizados em SVG ou PNG com transparência, mantendo a arte original como fonte e sem redesenhar feições de forma arbitrária.

Em telas pequenas não forçar o emblema inteiro com textos microscópicos. Usar o selo simplificado e manter “Sharks Fênix” como texto HTML acessível junto ao símbolo. Definir texto alternativo e dimensões fixas para que a logo não empurre títulos ou navegação.

### 8.3 Sistema de cores proposto

A paleta abaixo é uma proposta para o produto integrado, não um resultado já aprovado/publicado. Ela mantém o universo preto e dourado, mas distribui os tons para melhorar leitura e reduzir a sensação de interface pesada.

| Token | Cor proposta | Aplicação |
|---|---|---|
| Carvão | `#171613` | Sidebar, barra superior escura e áreas de marca. |
| Preto profundo | `#0E0D0B` | Fundo do selo/logo, ícones e momentos de destaque; não usar como fundo de todo o conteúdo. |
| Dourado principal | `#93651D` | Ações e indicadores dourados sobre superfície clara, após validação de contraste. |
| Dourado de luz | `#D6AD62` | Filetes, ícones, detalhes e estados selecionados em fundo escuro. |
| Bronze | `#76502A` | Detalhe secundário e gráficos, sem competir com o dourado principal. |
| Canvas marfim | `#F5F2EB` | Fundo principal das páginas operacionais. |
| Superfície | `#FFFFFF` | Cards, tabelas, formulários e modais. |
| Superfície aquecida | `#FBF8F1` | Cabeçalhos de cards, filtros e estados selecionados suaves. |
| Texto principal | `#25231F` | Conteúdo sobre superfícies claras. |
| Texto secundário | `#625D53` | Ajuda, metadados e descrições. |
| Borda | `#E2DCCE` | Separadores e contornos de componentes. |
| Foco acessível | `#176B87` | Anel de foco visível e estados de teclado, sem substituir as cores da marca. |
| Sucesso/atenção/erro | tons semânticos aprovados | Estados operacionais; nunca depender só de cor para comunicar o significado. |

A recomendação é uma interface híbrida: navegação carvão, áreas de conteúdo marfim, cards claros e dourado reservado para ações importantes e identidade. Evitar páginas inteiras pretas, dourado em todos os botões, gradientes extensos, texto preto sobre superfície escura, texto pequeno em dourado e qualquer fundo branco desconectado do restante da aplicação. A razão de contraste deve ser medida para cada combinação final; as cores propostas ainda precisam passar por revisão de acessibilidade.

### 8.4 Tipografia, ícones e componentes

Usar uma família sans-serif de interface legível e consistente (por exemplo, Inter ou Manrope) para navegação, formulários, dados e texto. O lettering ornamental deve ficar restrito ao logotipo. Estabelecer uma escala clara: título de página, subtítulo, título de painel, rótulo, número de indicador e texto auxiliar. Não deixar o navegador cair na fonte serifada padrão.

Adotar grade de espaçamento consistente, bordas discretas, sombras curtas, raios moderados, botões com altura confortável, campos com rótulo visível e estados claros. Ícones devem ter o mesmo peso e tamanho de acordo com sua função. Avatar com iniciais deve ser pequeno e circular; não pode dominar a linha da tabela nem comprimir nome, e-mail ou ações.

## 9. Redesenho do layout do sistema integrado

### 9.1 Navegação de desktop

Manter uma estrutura familiar ao CRM Mundo Apto — menu persistente, cabeçalho de contexto e área central de trabalho —, mas atualizar a marca e organizar todas as funções por tarefa. A proposta é uma sidebar de aproximadamente 240–260 px em telas grandes, recolhível, com:

1. logo compacta e wordmark Sharks Fênix;
2. **Relacionamento:** visão geral comercial, clientes/carteiras, empreendimentos e funções atuais do CRM;
3. **Desempenho:** painel de produção, lançamentos, metas, frequência e relatórios;
4. **Administração:** equipe e acessos, histórico/auditoria e configurações autorizadas.

A navegação deve mostrar somente o que o perfil pode acessar. O título e a localização atuais ficam claros no topo. O filtro de período deve aparecer apenas nas telas em que afeta os dados, evitando apresentar controles globais que não se aplicam à página aberta. Perfil, classificação e sair da conta ocupam área compacta e previsível no cabeçalho.

### 9.2 Dashboard integrado

O dashboard deve responder rapidamente a duas perguntas: “como está o funil de relacionamento?” e “como está a execução da equipe?”. Recomenda-se separar visualmente os dois blocos, com alertas prioritários visíveis:

- bloco CRM: clientes por etapa, follow-ups/alertas pendentes e indicadores do funil já existentes;
- bloco Sharks: prospecções, interações, agendamentos, visitas, vendas e frequências; progresso de metas; ranking autorizado;
- seletor de período e comparação equivalente;
- filtros e ranking respeitando a carteira/perfil;
- atalhos de ação somente para quem pode cadastrar ou corrigir;
- estados vazios com explicação e ação útil, sem tabelas vazias abertas ou áreas enormes sem conteúdo.

Não misturar contagem de leads com contagem de prospecções, nem vendas registradas com valor financeiro. Nomear cada indicador e fornecer definição curta/tooltip onde haja risco de dupla interpretação.

### 9.3 Telas operacionais

- **Clientes/CRM:** preservar formulários e etapas atuais; inserir os dados de produção como módulo independente, sem transformar métricas em campos ambíguos do cadastro de cliente.
- **Produção:** em desktop, tabela com cabeçalho fixo, colunas dimensionadas e ações alinhadas; em tablet, rolagem horizontal controlada; em celular, cartões por lançamento ou tabela com indicação explícita de rolagem. Observações extensas devem truncar com acesso ao conteúdo completo.
- **Metas:** cartões claros e consistentes, filtros semanal/mensal, progresso textual e barra; histórico de revisão acessível sem sobrecarregar o cartão.
- **Frequência:** visão semanal com corretor fixado e dias/turnos organizados; em telas estreitas, apresentar um corretor por cartão ou permitir rolagem com rótulos de data sempre visíveis. Marcação deve ser distinguível por ícone e texto, não apenas pelo tom dourado.
- **Relatórios:** filtros e período no início, resumo comparativo e tabelas bem separadas; exportação claramente rotulada e restrita. Explicar que vendas são contagens.
- **Histórico:** eventos legíveis em lista ou tabela adaptável, com autor, data, módulo, ação e detalhe de antes/depois; filtros por módulo, período, usuário e entidade são recomendados para o sistema consolidado.
- **Equipe/acessos:** um diretório de usuários para toda a plataforma; perfil, status e permissões por módulo num único lugar. Mostrar se uma conta está ativa globalmente ou apenas sem acesso a um módulo.

### 9.4 Responsividade e qualidade visual

Projetar e conferir ao menos em 320/360/375 px, 768 px, 1024 px e 1366/1440 px, além de zoom do navegador a 200%. Em celular, a sidebar vira gaveta acessível por botão; o cabeçalho respeita áreas seguras e não cobre conteúdo; filtros empilham; indicadores usam uma ou duas colunas conforme a largura. Botões e áreas de toque devem ter dimensão adequada.

Nenhum conteúdo pode depender de largura fixa que provoque sobreposição. Tabelas devem usar um comportamento definido, não transbordar para fora do cartão. Modais devem caber na altura disponível, permitir rolagem interna e manter seus botões de ação alcançáveis. Validar navegação por teclado, foco visível, rótulos de formulário, mensagens de erro, contraste, leitores de tela e estados de carregamento/vazio/erro/permissão.

Na gravação da versão atual foram vistos problemas que justificam uma revisão total: área de conteúdo branca em contraste com a navegação escura; trechos com fonte padrão serifada e textos com contraste inadequado; tabelas e linhas com dimensionamento ruim; avatares de iniciais grandes demais; controles com aparência nativa inconsistente; conteúdo de auditoria e estados vazios sem hierarquia clara. O redesenho precisa resolver a estrutura e a tipografia em todas as telas, e não apenas trocar códigos de cor.

## 10. Plano de consolidação recomendado

1. **Congelar inventário e regras:** validar este relatório com o briefing, a cliente e a matriz real de permissões do CRM; identificar diferenças sem alterar dados.
2. **Definir sistema de identidade:** confirmar qual projeto Supabase será a fonte de autenticação, qual será o banco destino e como as marcas Mundo Apto/Sharks Fênix aparecem no produto.
3. **Modelar permissões:** criar matriz por função, módulo, ação e escopo (próprio, carteira ou equipe), incluindo exportações e operações administrativas.
4. **Projetar arquitetura e migração:** reconciliar usuários por e-mail normalizado e IDs; definir destino das tabelas, chaves estrangeiras, trilha de auditoria, índices, RLS e retenção.
5. **Preparar identidade visual e protótipo:** aprovar logo/variantes, tokens de cor, tipografia, sidebar, cabeçalho e componentes antes de atualizar todas as páginas.
6. **Unificar navegação e login:** uma sessão, um diretório de usuários, um fluxo de convite/primeiro acesso e comportamento explícito para troca de senha.
7. **Migrar e integrar módulos:** preservar CRM; integrar produção, metas, frequência, relatórios e auditoria; manter IDs e histórico onde possível.
8. **Revisar telas e permissões:** validar cada função com contas de desenvolvedor, gestão, SDR, corretor e perfil sem acesso, em desktop e celular.
9. **Validar dados e operação:** conferir reconciliação de totais, períodos de São Paulo, deduplicação de lançamentos/frequências, auditoria, exportação, RLS e recuperação de senha.
10. **Preparar publicação somente após aceite:** esta análise não autoriza nem executa deploy; a publicação continua bloqueada até a integração e a revisão visual/funcional estarem prontas.

## 11. Critérios de aceite para a integração

- Cada pessoa acessa CRM e Sharks com a mesma identidade e senha, sem conta duplicada.
- Alterar senha na conta unificada afeta os dois módulos; o usuário é informado do alcance.
- O primeiro acesso do desenvolvedor e de usuários convidados usa fluxo seguro, sem senha fixa no código.
- As funções CRM existentes, etapas, carteiras e restrições de SDR permanecem intactas.
- Produção, metas, frequência, relatórios e histórico Sharks estão disponíveis dentro da plataforma comum.
- Permissões são avaliadas no servidor e no banco, não apenas na interface.
- Corretor não acessa dados alheios; SDR acessa somente a leitura acordada para cada módulo; gestão recebe somente capacidades aprovadas; desenvolvedor não se torna uma credencial compartilhada.
- Edição/cancelamento preserva trilha de auditoria; inativação preserva histórico e bloqueia acesso conforme a política aprovada.
- Indicadores e exportações mostram o mesmo universo de dados permitido ao usuário.
- Todas as páginas, formulários, modais, tabelas, gráficos, estados vazios e mensagens de erro seguem o novo sistema visual sem cortes, sobreposições ou tipografia padrão.
- A navegação funciona em 320 px até desktop; teclado, foco, rótulos e contraste são revisados.
- A reconciliação comprova que os dados antes e depois da migração correspondem, com cópia de segurança e plano de reversão.

## 12. Decisões que precisam de validação antes da implementação

1. **Banco de destino:** assumir o projeto Supabase que já sustenta o CRM como fonte de identidade é a recomendação, mas o ID e os ambientes devem ser confirmados antes de qualquer migração.
2. **Permissões finais:** revisar a matriz do CRM e decidir se Assistente, Coordenador, Gerente e Administrador realmente terão os mesmos poderes no módulo de produção. O código Sharks atual os agrupa.
3. **Senha temporária em lote:** decidir se continuará disponível para o desenvolvedor e confirmar a mensagem de impacto: no modelo unificado, muda a senha da conta que também abre o CRM.
4. **Logo e assinatura:** confirmar se o lockup integrado exibirá “Mundo Apto” dentro do selo, como no arquivo atual, e como `Diretoria Fênix` e `Produção & Frequência` aparecem na navegação.
5. **Escopo de frequência:** confirmar que a função continua sendo registro de plantões por turno, sem controle trabalhista de horas.
6. **Política de dados:** definir retenção de registros, acesso a períodos antigos, exportação e restauração de itens cancelados.

## 13. Situação atual e recomendação final

O Sharks Fênix já representa um conjunto funcional bem delimitado: gestão diária de produção, metas de três indicadores, frequência em três turnos, painéis e comparativos, exportação CSV, trilha de auditoria e administração de acessos. A base técnica tem controles relevantes, mas sua autenticação é separada e sua classificação de gestão é ampla demais para assumir que coincide com todas as permissões do CRM.

O adendo deve ser implementado como integração de produto, dados, identidade e interface, não como simples cópia de telas. A estratégia recomendada é manter o CRM como fonte de identidade e relacionamento, incorporar os módulos Sharks sob a marca Sharks Fênix, mapear permissões por módulo, preservar os históricos e redesenhar a experiência inteira com a nova paleta. A identidade preto/dourado permanece reconhecível; o conteúdo operacional usa superfícies claras e tipografia legível para equilibrar a marca e o uso diário.

Este relatório registra o diagnóstico anterior à integração. As mudanças posteriores estão sendo revisadas no repositório do CRM; **o estado remoto não foi verificado por este documento e o deploy continua pendente de autorização após a revisão final**.
