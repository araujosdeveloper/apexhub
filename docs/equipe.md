# Equipe e permissões

Publicado em 04/11/2026 às 16:16 UTC. STATUS=PUBLICADO confirmado em `reports/update-20261104T161511Z-2724827`; backup final `backups/live/live-20261104T161625Z-2729176`. Conferência visual concluída e aprovada pelo responsável em 04/11/2026. Utiliza as tabelas existentes `users` e `sessions`, sem migração ou alteração dos registros anteriores durante a publicação.

Acesse **Equipe** no gestor/cozinha ou `/team.html`, usando uma conta de dono. Apenas donos consultam a lista e criam/alteram acessos da própria loja. Gerentes e operadores recebem 403. O menu fica oculto para eles; a proteção também é aplicada no servidor.

## Perfis

| Perfil | Uso |
| --- | --- |
| Dono | Administração da loja e gestão da equipe |
| Gerente | Pedidos, cozinha, cardápio, operação, cupons, entregadores, clientes e relatórios |
| Operador | Pedidos, cozinha, impressão e vinculação de entregadores; sem gestão da equipe/cadastros ou acesso a clientes/relatórios |

As permissões existentes dos módulos são preservadas. Operadores ainda podem consultar recursos já permitidos, como a lista de cupons; consulta não permite editar.

Esta tela cria somente gerentes e operadores. Contas de donos são protegidas contra edição, bloqueio, troca de perfil e redefinição de senha, inclusive por outros donos da mesma loja. Não há exclusão de pessoas ou transferência de propriedade nesta versão.

## Criar e editar acessos

Informe nome, e-mail, perfil, disponibilidade e senha de 12 a 128 caracteres. E-mails seguem a identificação global de login já existente: um endereço não pode ser usado em outra conta, mesmo de outra loja. A resposta de conflito não identifica a loja ou pessoa que usa o endereço.

Ao editar, senha em branco mantém a senha atual; preencher o campo a redefine. Todas as alterações encerram as sessões existentes da pessoa, inclusive mudança de nome ou e-mail. Reativar uma conta exige novo login; sessões anteriores não voltam a funcionar. Bloquear preserva os dados da loja.

Não há envio de convite, senha por e-mail/WhatsApp, recuperação de senha do dono ou troca obrigatória no primeiro acesso. O dono informa as credenciais à pessoa pelo canal que escolher. Senhas não são gravadas no armazenamento do navegador e o campo é limpo após tentativas de salvamento. O servidor armazena somente scrypt com salt, como no login existente.

## Concorrência e sessões

A lista devolve uma revisão opaca do estado do cadastro, sem expor o hash de senha. A edição trava a linha da pessoa, verifica a revisão, atualiza dados e exclui sessões na mesma transação. Uma edição baseada em dados antigos retorna 409 e exige selecionar novamente a pessoa atualizada.

O login também trava e confere o cadastro antes de criar a sessão. Se senha, e-mail ou disponibilidade mudar entre a conferência inicial e a criação da sessão, o login é recusado. Se o login vencer a disputa, a alteração posterior exclui a sessão criada. Não são emitidos cookies antes do commit do login.

Após revogação, novas requisições com o token antigo recebem 401. Telas de pedidos verificam sessão no stream a cada 15 segundos e também ao consultar APIs. Uma requisição já autorizada e em andamento pode terminar; a alteração não desfaz operações anteriores.

## API e validação

GET/POST `/api/admin/team`; PUT `/api/admin/team/:id`, sempre autenticados como dono. Lista paginada de 50 pessoas; empresa vem exclusivamente da sessão. Respostas não incluem senhas nem hashes e usam `Cache-Control: no-store`. Cadastro não abre uma sessão de funcionário no navegador do dono.

166 testes locais aprovados, incluindo proteção de perfil/dono, isolamento de consultas, revisão, hash de senha, rollback, revogação e login concorrente com alteração de cadastro. Interface testada para escape de nomes, formulários de senha, acesso negado, mudança de loja e respostas atrasadas. Seis simulações do publicador, sintaxe e configuração Compose aprovadas.

Integração MySQL preparada para criar e autenticar operador, validar permissões, bloquear, reativar como gerente, trocar senha, rejeitar senha antiga, revogar sessões e impedir duas edições da mesma revisão. O ensaio da cópia inclui login de operador e bloqueio real. Integração MySQL real aprovada em `reports/mysql-validation-20261104T161536Z-2726347.log`, incluindo permissões, proteção do dono, bloqueio, senha, sessões e concorrência. 166 testes aprovados; ensaio sobre cópia, preservação dos dados, canário e aplicação ativa aprovados.

Publique pelo comando habitual no host: `bash /root/delivery-saas/scripts/update-live.sh`. O atualizador valida a candidata e a cópia antes de promover a aplicação. Após publicar, crie um operador, teste o acesso em outra janela, bloqueie e confira que precisa entrar novamente. Confira que contas de dono permanecem protegidas.

Automação de WhatsApp/IA continua reservada para a última etapa.
