# Publicação da loja validada

Estado: publicação real concluída no host em 03/11/2026, conforme saída fornecida pelo responsável. Validação final do navegador público pendente.
HTTPS do IP foi aprovado no host em 03/11/2026 às 02:36 UTC, conforme saída do
responsável. Prévia e fluxo completo no navegador também foram aprovados.

## Executar no terminal do host

```sh
bash /root/delivery-saas/comando-publicar-loja.txt
```

O comando inicia a troca definitiva, incluindo uma interrupção das gravações
no sistema antigo. Deixar o terminal aberto até a conclusão. Quando solicitado,
confirmar `cachorro-quente-bebella` e definir uma senha real de 12 a 128 caracteres,
sem enviá-la na conversa. A senha SSH e a conta da prévia são independentes.

## O que o procedimento faz

- Confere HTTPS e página inicial de preparação. Recusa repetição sobre rota ativa.
- Confere que saas_mysql só contém o banco delivery_saas_db, além dos esquemas
  internos. Recusa estado read_only já configurado e publicações concorrentes.
- Constrói as imagens e inicia MySQL novo antes da interrupção de gravações.
- Ativa super_read_only no MySQL antigo, impedindo gravações inclusive da API
  antiga com privilégios elevados e de integrações apontadas à origem.
- Obtém contagens exatas, backup atualizado, inventário, auditorias e hashes.
- Restaura esse backup em delivery_live_db num servidor novo, em volume persistente.
- Confere UUIDs distintos e identidade exata do destino. Reutiliza auditorias e
  migração validada, sem remover a proteção do executor de ensaio.
- Compara contagens da origem e hashes dos registros restaurados antes/depois.
- Restringe delivery_app a SELECT, INSERT, UPDATE e DELETE no novo banco.
- Cria o proprietário bebellahotdog@gmail.com na empresa 1 confirmada pelo slug.
- Inicia API em produção com cookies seguros; verifica health, catálogo e 401 sem
  autenticação. API e MySQL não publicam portas no host.
- Persiste read_only e super_read_only na origem, inclusive para reinícios.
- Valida a rota candidata do Caddy antes da troca e recarrega o proxy.
- Confere /api/health pelo HTTPS, sem ignorar o certificado.

PM2, a prévia e n8n não são reiniciados. Os dados e o esquema do banco antigo
não são migrados no lugar. Nenhum pedido de teste da prévia é copiado. O endereço
antigo :3000 não é redirecionado automaticamente e deixa de aceitar gravações;
compartilhar o novo endereço HTTPS após aprovação final no navegador.

## Falha e recuperação

Antes da troca do arquivo de rota: em caso de falha, o script tenta reabrir as
gravações da origem e remover as duas configurações persistidas de somente
leitura. Os dados da origem permanecem intactos e o PM2 continua em memória.
Isso não recupera código antigo após perda/reinício desse processo.

Desde a tentativa de troca do arquivo de rota: não há retorno automático para a
origem, pois um reload/reboot pode disponibilizar a nova loja e receber pedidos.
O banco antigo fica bloqueado. Corrigir a rota/API usando o banco novo preservado.
Se for necessário retornar à origem, suspender a loja nova, fazer backup de ambos
os bancos e reconciliar todas as gravações antes de reabrir a origem. Não copiar
apenas o backup anterior nem apagar o volume novo.

O script preserva containers, volumes, credenciais privadas e relatórios em caso
de falha. O caminho de gerenciamento aparece na saída. Não executar down -v.
Uma interrupção abrupta antes da persistência do bloqueio pode exigir inspeção
manual; não reiniciar o host durante o corte. Após qualquer falha, enviar a saída
sem credenciais e não repetir o comando às cegas.

## Integrações e validação final

Ainda não foi confirmado se n8n grava pedidos. O bloqueio da origem impede que
essas gravações continuem separadas do banco novo, mas NÃO migra integrações.
Elas precisam ser revisadas para autenticação/rotas novas antes de uso.

Depois de LOJA PUBLICADA, conferir no navegador público:

- https://179.198.120.188/login.html: acesso com a senha real recém-criada.
- https://179.198.120.188/?loja=cachorro-quente-bebella: catálogo e checkout.
- Pedidos históricos, novo pedido identificável e atualização de status.

Os dois pedidos sem itens permanecem histórico incompleto. Endereços antigos
foram derivados do cadastro disponível. Assinatura legacy não confirma pagamento.
Cobrança automática e integração oficial WhatsApp continuam fora da entrega.

Após publicação, estabelecer backups periódicos do NOVO banco e monitoramento
de disponibilidade/certificados. O dump final da origem não inclui pedidos novos.
Não usar o script de backup legado para proteger os pedidos da loja nova.

## Evidência de validação local

- Sintaxe backend/frontend e shell aprovada; Compose config aprovado.
- Suíte unitária aprovada, incluindo recusa de identidade incorreta do destino.
- Quatro testes do script com Docker/rede/banco simulados: falha de backup,
  falha na validação da rota, falha após tentativa de publicação e sucesso.
- Esses testes conferem reabertura da origem antes do corte e manutenção do
  bloqueio depois da tentativa de publicação. Não equivalem à integração real.
- A nova publicação ainda não foi executada contra Docker/MySQL real nesta sessão.


## Falha e correção em 03/11/2026 às 02:52 UTC

Tentativa `delivery-live-20261103t025137z-313960`: backup final coletado em
`backups/legacy-20261103T025208Z-315080`; restauração e migração chegaram ao
ajuste de permissões. `REVOKE ALL PRIVILEGES ON delivery_live_db.*` falhou com
ER_NONEXISTING_GRANT, antes de criar o proprietário ou publicar a rota.
A saída do host confirmou a reabertura das gravações na origem. A cópia que
falhou foi preservada; não repetir a migração sobre esse esquema já alterado.

Causa identificada no código: a imagem oficial MySQL concede acesso usando
underscores escapados no nome do banco. A revogação anterior não correspondia
a esse grant. Correção: revogar todos os privilégios/GRANT OPTION da conta
exclusiva delivery_app, conceder somente quatro permissões no banco exato
(considerando partial_revokes) e conferir SHOW GRANTS. As aspas de identificadores
e escapes exibidos pelo MySQL são tratados na comparação.

Retomada preparada em `comando-corrigir-publicacao.txt`. Ela primeiro reconstrói
a imagem e executa a correção de permissões na cópia que falhou, sem bloquear a
origem. Se esse teste real passar, para somente essa cópia (sem remover o volume)
e inicia a publicação corrigida com OUTRO banco e backup atualizado, pois a
origem voltou a receber gravações. Recusa execução quando a rota já é pública.

Validação local da correção: cinco testes de permissões passaram, quatro testes
de recuperação continuaram aprovados e a sintaxe foi conferida. Teste de
permissões no MySQL real e nova publicação ainda pendentes no terminal do host.

Referências:
- https://github.com/docker-library/mysql/blob/master/docker-entrypoint.sh
- https://dev.mysql.com/doc/refman/8.4/en/grant.html


## Publicação concluída às 02:58 UTC

Ambiente ativo: `delivery-live-20261103t025846z-321081`.
Gerenciamento: `reports/release-20261103T025846Z-321081/manage.sh`.
Backup final da origem: `backups/legacy-20261103T025904Z-322340`.
O host informou LOJA PUBLICADA, com a origem preservada somente para leitura.
Não remover esse projeto, seus volumes nem o arquivo privado release.env.
A tentativa anterior e a prévia não são o ambiente real.

Próximo passo: conferir no navegador público login com senha real, catálogo,
checkout e mudança de status. Depois estabelecer backups periódicos do novo
banco e monitoramento de disponibilidade e renovação do certificado.
