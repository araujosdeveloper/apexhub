# Backups do banco real

Estado: instalação confirmada no host em 03/11/2026 às 03:16 UTC, conforme
saída fornecida pelo responsável. Backup e restauração aprovados; dois timers
habilitados e ativos. A origem é delivery_live_db do ambiente publicado,
identificado em deploy/live-release.path. O script confere se o identificador
corresponde à rota pública e recusa banco antigo, prévia ou referência obsoleta.

## Instalação no host

```sh
bash /root/delivery-saas/comando-configurar-backups.txt
```

O instalador valida os serviços systemd, cria um backup imediato e restaura essa
cópia em MySQL temporário. Somente após essas etapas instala e ativa os timers:

- Backup diário às 04:15 UTC (01:15 em Timon).
- Teste de restauração aos domingos às 05:00 UTC (02:00 em Timon).
- Persistent=true recupera uma execução perdida quando o timer voltar a funcionar.
- Retenção das 30 cópias concluídas mais recentes, não necessariamente 30 dias.

Se a verificação real falhar, os timers ainda não serão instalados. Corrigir a
causa e executar novamente. A instalação não interrompe pedidos nem reinicia a
API, MySQL, PM2, n8n ou Caddy. Os arquivos de agendamento são instalados apenas em
/etc/systemd/system/delivery-live-{backup,restore-check}.{service,timer}.

## Conteúdo e consistência

Cada cópia fica em backups/live/live-<data>-<id>/, com pasta 0700 e arquivos
privados, contendo backup.sql.gz, manifest.json, SHA256SUMS e um marcador interno.
O symlink latest aponta à última cópia concluída. O dump inclui dados, esquema,
triggers, rotinas e eventos do banco real, sem coletar senhas do ambiente do host.
A credencial root é usada somente dentro do container e não é passada no argv.
O backup inclui hashes de senhas e dados pessoais da aplicação; manter privado.

mysqldump usa single-transaction e exige tabelas InnoDB. Isso permite pedidos
normais durante a cópia; NÃO executar ALTER/CREATE/DROP/RENAME/TRUNCATE de tabelas
durante o dump. O backup não é cópia física do servidor e não contém contas
administrativas MySQL, certificados Caddy, configuração n8n nem todo o código.
Preservar separadamente o projeto e os arquivos privados do ambiente publicado.

Uma cópia só recebe o nome final após gzip e checksum passarem. Retenção ocorre
somente depois dessa conclusão. Ela ignora diretórios incompletos, symlinks,
arquivos extras e pastas sem marcador/manifesto correto. Não remove backups
legados nem os de outros ambientes. Um lock impede disputa entre dump, teste
de restauração e retenção.

## Teste de restauração

Usa a mesma imagem MySQL identificada no manifesto (ID local imutável), em
container exclusivo sem rede, portas publicadas ou volume persistente. O
agendador de eventos e o acesso TCP são desativados. A imagem deve continuar
presente no host; não trocar de versão silenciosamente durante a recuperação.

A cópia é importada em delivery_restore_test. São conferidos o número de tabelas,
campos exigidos pela API e o resultado SQL CHECK TABLE de cada tabela. Ao terminar, o container é removido e o
backup recebe restore-check.json. Um checksum válido sozinho não comprova
restauração. O teste usa até 1 GiB de memória e tmpfs de 512 MiB; revisar esses
limites se o banco crescer. Não restaurar diretamente sobre o banco ativo.

## Verificação e execução manual

```sh
systemctl list-timers --all delivery-live-backup.timer delivery-live-restore-check.timer
journalctl -u delivery-live-backup.service -n 50 --no-pager
journalctl -u delivery-live-restore-check.service -n 50 --no-pager
bash /root/delivery-saas/scripts/backup-live.sh
bash /root/delivery-saas/scripts/verify-live-backup.sh
```

Falhas produzem código não zero e são registradas no journal. Ainda não há envio
de alertas por e-mail/WhatsApp. Não enviar dumps, release.env ou o conteúdo de
backup.sql.gz na conversa. Logs operacionais exibem somente metadados.

## Limites de proteção

Estas são cópias LOCAIS na mesma VPS: não protegem contra perda total ou acesso
indevido ao servidor. Cópia externa criptografada ainda precisa ser configurada.
Com frequência diária, a perda potencial desde a última cópia pode chegar a
aproximadamente 24 horas ou mais se houver falhas. Não há recuperação ponto a
ponto, pois o ambiente atual não utiliza binlog para esse fim.

Depois de uma publicação futura, atualizar deploy/live-release.path e executar
backup+restauração de verificação. O script recusa referência que não coincida
com a rota pública. Não apagar release.env nem volumes do ambiente real.

Validação local: sintaxe shell/Node, calendários systemd, três testes de retenção
e quatro testes de fluxo com Docker simulado aprovados. Execução real permanece
pendente no host; o acesso ao socket Docker desta sessão continua negado.

Referências:
- https://dev.mysql.com/doc/refman/8.0/en/mysqldump.html
- https://www.freedesktop.org/software/systemd/man/256/systemd.timer.html


## Correção após a primeira execução no host

Backup live-20261103T031308Z-339367 concluído, com gzip e SHA-256 aprovados.
A restauração importou a cópia, mas parou em `mysqlcheck: not found` (código 127).
Produção e backup preservados; timers ainda não foram instalados.

A checagem foi substituída por CHECK TABLE pelo cliente mysql, que já está
presente na imagem. A lista de tabelas é validada e o retorno é conferido por
tabela: ausência de resultados, erros, duplicação e banco diferente reprovam o
ensaio mesmo quando o cliente SQL retorna código zero. O teste simulado agora
recusa mysqlcheck e inclui falha de integridade com limpeza do container.
Cinco testes de fluxo e três testes do verificador SQL passaram localmente.
Executar novamente comando-configurar-backups.txt para validar no host e agendar.
Referência: https://dev.mysql.com/doc/refman/8.4/en/check-table.html


## Instalação aprovada no host

Backup: `backups/live/live-20261103T031638Z-344468`.
Gzip, SHA-256, importação e CHECK TABLE das 12 tabelas aprovados.
Container temporário removido. Timers delivery-live-backup.timer e
delivery-live-restore-check.timer confirmados como enabled/active.
Próximas execuções informadas: 03/11/2026 às 04:15 UTC para backup e
08/11/2026 às 05:00 UTC para restauração. Essa saída comprova instalação e
teste inicial; resultados das execuções futuras precisam de acompanhamento.
Cópia externa criptografada e alertas externos continuam não configurados.
