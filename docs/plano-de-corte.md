# Preparação da troca da aplicação

Estado: preparação; nenhum comando de migração de produção liberado.
Base de validação: ensaio 20261102T190312Z-77403 aprovado, com preservação
dos dados originais e limpeza do ambiente temporário.

## Informações fornecidas pelo responsável

- E-mail indicado para o proprietário: `bebellahotdog@gmail.com`.
- Endereço atual de acesso: `http://179.198.120.188:3000`.
- Endereço físico informado: Avenida Regimento, 5, CEP 65630-350, Timon–MA.
- Conta do proprietário ainda não criada; vínculo à empresa deve ser confirmado
  no inventário antes da gravação.
- O endereço atual usa HTTP. A nova API exige cookies seguros em produção;
  preparar HTTPS antes do corte. Domínio e proxy ainda não confirmados.

## Informações a confirmar

- E-mail e nome do proprietário, com associação explícita à empresa existente.
- Domínio público, HTTPS, proxy e forma de iniciar/parar a aplicação atual.
- Processos externos que gravam pedidos (incluindo fluxos n8n, se houver).
- Janela de interrupção de gravações e responsável pela validação no navegador.

Coleta inicial somente de leitura: `bash scripts/inspect-runtime.sh`.
O relatório não coleta variáveis de ambiente, senhas ou argumentos de processos.
Não enviar arquivos .env, dumps ou credenciais.

## Sequência de corte a preparar após o inventário

1. Registrar como reiniciar a versão atual, preservar sua configuração de forma
   privada e fixar a imagem/cópia da nova versão que será implantada.
2. Preparar HTTPS e a nova aplicação com usuário MySQL limitado ao banco e
   permissões SELECT, INSERT, UPDATE e DELETE. A conta de DDL fica separada.
3. Interromper todas as origens de gravação, incluindo API antiga e integrações.
   Confirmar a interrupção antes de gerar o backup final.
4. Executar backup atualizado e inventário. Restaurar e validar esse backup em
   cópia isolada. Se os dados/esquema diferirem das premissas do ensaio aprovado,
   revisar a migração antes de continuar. Manter gravações suspensas.
5. Aplicar a migração por executor dedicado com verificação do banco alvo,
   auditorias e comparação de hashes das colunas originais. O executor atual
   aceita apenas rehearsal_test; não remover sua proteção para usar em produção.
6. Vincular o proprietário à empresa confirmada com senha definida localmente,
   sem senha na conversa ou em argumentos do processo. Não criar outra loja pelo
   cadastro público. Recusar e-mail em uso e empresa que já tenha proprietário.
7. Iniciar a nova API, verificar health e testar login, catálogo, pedidos históricos
   e isolamento. Conferir cookies seguros pelo endereço HTTPS público.
8. Validar no navegador o pedido completo e a atualização de status. Pedidos de
   validação devem ser identificáveis, sem apagar ou alterar os registros antigos.
9. Encaminhar tráfego para a nova aplicação e reabrir gravações. Só reativar
   integrações após conferir compatibilidade de rotas e autenticação.

## Retorno

Antes de liberar novas gravações: parar a nova aplicação, restaurar o backup final
em banco separado, conferir integridade e apontar a aplicação antiga para o banco
restaurado com sua configuração preservada. Validar antes de reabrir o acesso.
Não depender de rollback transacional: ALTER TABLE tem commit implícito.

Depois de liberar gravações: suspender novamente as gravações e preservar também
um backup do banco novo. Reconciliar pedidos e demais alterações recebidas após
o corte antes de voltar. Restaurar simplesmente o backup anterior perderia esses
dados. A estratégia concreta depende do processo antigo e deve ser definida antes
de liberar o corte.

## Limitações conhecidas

Dois pedidos históricos não têm itens; os registros são preservados como histórico
incompleto. Endereços históricos vêm do cadastro atual, sem recuperação de valores
perdidos. Assinatura legada não comprova pagamento. O responsável aprovou o fluxo no navegador da prévia em 03/11/2026.
A configuração HTTPS pública ainda aguarda validação no host.


## Inventário do host em 02/11/2026 às 19:14 UTC

Saída fornecida pelo responsável: Node escuta na porta 3000, PID 46761,
com processo pai PM2 PID 46282 (PM2 v7.1.1). Node local v26.7.0.
MySQL legado em saas_mysql; n8n e phpMyAdmin em containers separados.
Não há proxy HTTPS identificado nas portas em escuta deste inventário.
Próxima consulta: scripts/inspect-pm2.sh, que seleciona somente metadados
sem imprimir o ambiente completo ou argumentos de execução.
Domínio ainda pendente de confirmação.


## Processo PM2 confirmado

`delivery-api`, pm_id 0, fork, uma instância, executa
`/root/delivery-saas/backend/server.js` com cwd `/root/delivery-saas/backend`.
O responsável informou que não possui domínio.

O caminho do processo coincide com o workspace modificado. Não reiniciar o PM2
antes de confirmar compatibilidade do banco e preservar uma versão antiga
executável: o arquivo em disco não comprova qual código o processo carregou.
A configuração dump.pm2 guarda metadados, não uma cópia do código.
Nesta sessão não foi encontrada cópia antiga de server.js nos diretórios
consultados; verificar histórico e cópias no host via inspect-rollback.sh.
Este é um ponto pendente para tornar concreto o procedimento de retorno.


## Resultado da consulta de retorno

O host confirmou ausência de histórico Git acessível e não encontrou cópia de
server.js nos locais consultados. Isso não comprova ausência de snapshots externos.
Verificar backup/snapshot da VPS no provedor, com data anterior às alterações do
código, antes de afirmar que é possível restaurar a aplicação antiga. Snapshot
feito agora preserva os arquivos atuais, não recupera o código antigo em memória.
Não tratar o dump do banco como backup da aplicação.

## Ferramenta de associação preparada

`backend/scripts/provision-owner.js` aceita `--check` (somente consulta) e
`--apply` (criação explícita após conferir o slug). Recebe ID, slug, nome e e-mail;
a senha é solicitada de forma oculta no terminal, nunca como argumento.
Executar somente após migração e confirmação do banco alvo, com credenciais
locais. A criação trava a empresa durante a transação, recusa proprietário já
existente (inclusive inativo), e-mail ocupado e divergência de slug. Não altera
assinatura, catálogo ou pedidos. O cadastro público não associa a loja antiga.

Validação local: sintaxe e suíte com cinco arquivos aprovadas, incluindo testes
de recusa de vínculo incorreto/duplicado, hash de senha e rollback de inserção.
A nova ferramenta ainda não foi exercitada contra MySQL real.


## Decisão após confirmação do responsável

Os backups de VPS de 30/10 e 23/10 não se referem a esta aplicação; não serão
usados como prova de retorno e não devem ser restaurados para esta migração.
Preparada prévia isolada: ver docs/previa-isolada.md. Acesso por túnel SSH em
localhost:3002; não altera o PM2 da porta 3000. A estratégia final de recuperação
continua pendente e deverá ser definida antes do corte em produção.


## Preparação pública em 03/11/2026

Responsável aprovou todas as etapas de navegador: login, catálogo, pedidos
históricos, checkout e transição de status. Próxima execução preparada em
comando-preparar-https.txt: Caddy com certificado público por IP e página de
preparação, sem apontar a prévia como loja real. Ver docs/https-publico.md.
Ainda falta confirmar se n8n/outras integrações gravam pedidos (pergunta enviada).
Não iniciar o corte sem resolver essas origens de gravação e a recuperação.
Para produção usar restauração de backup atualizado em banco persistente separado,
sem migrar o banco legado no lugar e sem promover os dados de teste da prévia.


## Plano executável definitivo

HTTPS foi validado no host. O procedimento atual está em docs/publicacao.md e
substitui o roteiro preliminar acima: migra uma cópia em servidor MySQL novo e
persistente, mantendo o banco antigo intacto e bloqueado para gravações. A origem
não é sobrescrita nem depende de recuperar código de snapshots não relacionados.
A volta ao processo antigo só é automática antes da tentativa de publicação e
com o processo PM2 ainda em memória; depois exige reconciliação dos pedidos novos.
Script pronto em comando-publicar-loja.txt. Execução real ainda pendente.
