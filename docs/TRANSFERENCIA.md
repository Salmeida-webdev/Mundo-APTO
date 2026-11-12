# Operação e manutenção — Mundo Apto / Sharks Fênix

## Ambientes existentes

- Repositório: `Salmeida-webdev/Mundo-APTO`, branch `main`.
- Hospedagem: site Netlify existente `mundoapto`, URL `https://mundoapto.netlify.app`.
- Dados e autenticação: projeto Supabase privado já conectado ao CRM.

Esta consolidação reutiliza esses ambientes. Não crie outro repositório, site ou projeto Supabase para as funções Sharks, e não importe dados do Sharks Fênix. Clientes, usuários, vendas, contratos e históricos do CRM permanecem na base atual.

## Permissões e equipe

Cadastre, edite e desative usuários pelo módulo **Equipe**. As permissões do CRM continuam relacionadas ao perfil e à carteira. As permissões de produção são próprias do módulo: corretores editam seus registros; o SDR consulta a equipe sem editar; outras funções administrativas podem consultar os painéis; apenas contas incluídas na configuração privada podem corrigir lançamentos da equipe, configurar metas e alterar frequências.

As autorizações especiais de gestão operacional e manutenção ficam em configuração privada do ambiente. Para alterá-las, solicite manutenção técnica autorizada; não grave identificadores, e-mails, senha compartilhada ou chaves secretas no GitHub. A aplicação de senha inicial invalida sessões e exige troca individual no primeiro acesso.

## Dados operacionais

As tabelas `crm_production_entries`, `crm_production_goals` e `crm_attendance_records` foram criadas vazias. A equipe inicia os lançamentos diários diretamente no CRM. Produção, metas e frequências não são preenchidas por importação automática do Sharks.

Antes de qualquer importação de clientes, use o preview disponível no CRM e corrija duplicidades e campos inválidos. A importação atual aceita CSV validado e fica restrita a perfis administrativos. Exportações também são controladas por perfil e aplicam os filtros selecionados.

## Migrations

As migrações aplicadas ao projeto conectado estão versionadas em `supabase/migrations/`. Antes de uma mudança futura, compare os arquivos locais com a lista do projeto Supabase e aplique apenas migrations novas, em ordem. Não reaplique migrations registradas. As mudanças desta consolidação acrescentam tabelas, colunas, índices e funções; não apagam os dados históricos do CRM.

## Publicação e revisão

Execute `npm run check` antes de integrar alterações. Um único commit na branch `main` aciona o deploy ligado ao site Netlify existente. Acompanhe o estado do deploy no Netlify e considere a versão liberada após ficar `ready`. Evite deploy manual ou publicar uma segunda cópia do sistema.

Para rollback da interface, publique a versão anterior do Netlify mantendo as migrations aditivas no Supabase. Verifique compatibilidade da API da versão anterior antes de reverter código que use colunas novas.

## Segredos e documentos

As variáveis `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` e, apenas durante a configuração inicial, `CRM_BOOTSTRAP_SECRET` ficam no ambiente privado das Netlify Functions. Nunca as copie para `public/`, para arquivos versionados ou para o navegador. O armazenamento dos documentos de contratos é privado e usa links temporários emitidos pelo servidor após validar o perfil.

Os modelos de contrato/termo e confissão são mantidos pela gestão. A cliente deve fornecer ou revisar o conteúdo jurídico aprovado antes de usar os arquivos gerados para assinatura. O CRM não substitui revisão jurídica nem assinatura eletrônica.
