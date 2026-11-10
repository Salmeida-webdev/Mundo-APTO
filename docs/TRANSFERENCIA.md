# Operação, configuração e transferência

## Propriedade dos serviços

- O projeto Supabase deve ficar em organização controlada pela incorporadora, com acesso de manutenção concedido ao responsável técnico.
- O site Netlify deve ficar associado ao repositório GitHub do CRM e à equipe Netlify escolhida para o projeto.
- Não compartilhe a chave secreta do Supabase, o segredo de bootstrap ou a senha administrativa em arquivo público ou canal aberto.

## Primeira configuração

1. Crie o projeto Supabase e aplique a migration `supabase/migrations/202611090001_crm_schema.sql`.
2. Importe a lista de empreendimentos para `crm_developments` diretamente no banco privado, sem adicioná-la ao repositório público.
3. Configure no Netlify as variáveis `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `CRM_BOOTSTRAP_EMAIL` e um `CRM_BOOTSTRAP_SECRET` aleatório.
4. Publique a aplicação e acesse o endereço do site.
5. Na tela de configuração, informe o e-mail administrativo definido no ambiente, nome, segredo de bootstrap e a senha desejada. Para manter a senha anterior, use a mesma senha que já era utilizada no CRM Apps Script.
6. Confirme o acesso administrativo, remova `CRM_BOOTSTRAP_SECRET` e `CRM_BOOTSTRAP_EMAIL` do Netlify e cadastre/valide os usuários.
7. No menu **Equipe**, aplique a senha inicial compartilhada uma vez. Distribua-a por canal privado; todos os usuários deverão trocá-la no primeiro acesso.

## Mudanças futuras de equipe

Use **Equipe** para cadastrar novos usuários, ajustar função e desativar contas. Desativar preserva os clientes e o histórico. Um e-mail alterado no sistema deve também ser atualizado pelo administrador. A conta admin deve permanecer ativa; a aplicação impede remover ou rebaixar o último administrador.

## Publicação e rollback

Faça alterações por pull request ou commits revisados no GitHub. Netlify fará build com `npm run build`; valide a suíte automatizada antes de integrar alterações. As variáveis secretas não devem ser incluídas no commit. Para reverter, publique a versão anterior do site e mantenha a migration do banco compatível com ambas as versões.
