# Migração do banco existente

## Etapa atual

A integração do esquema novo em MySQL foi aprovada pelo usuário no host em 02/11/2026. A migração do banco existente depende de seu inventário real. O script `scripts/inventory-legacy.sh` prepara os artefatos sem aplicar DDL ou alterar registros da origem.

Execute no terminal do host:

```sh
cd ~/delivery-saas
bash scripts/inventory-legacy.sh
```

Os padrões são o container `saas_mysql` e o banco `delivery_saas_db`, obtidos do Compose legado do projeto. Para outra origem, informe `LEGACY_CONTAINER` e `LEGACY_DATABASE`. O script usa a credencial root já configurada no ambiente do container (ou MYSQL_ROOT_PASSWORD_FILE); não imprime a senha. Se a senha do banco foi rotacionada sem atualizar essa configuração, a autenticação falha e a configuração de acesso deverá ser revisada localmente. Não envie senhas na conversa.

## Artefatos

Cada execução cria uma pasta privada `backups/legacy-<data>-<id>/`:

- `inventory.json`: versão, tabelas, colunas, índices e chaves estrangeiras; contagens estimadas.
- `schema.sql`: DDL das tabelas/views, sem registros e sem triggers.
- `backup.sql.gz`: dump completo com dados, triggers, rotinas e eventos. Deve permanecer privado.
- `SHA256SUMS`: hashes dos arquivos para verificar integridade.
- `migration-plan.json`: lacunas identificadas a partir dos metadados. Não é SQL de migração.
- `audit.sql` e `audit.tsv`: SELECTs e contagens de duplicados, órfãos, vínculos entre empresas, status desconhecidos e divergências de totais, conforme as colunas disponíveis.
- `STATUS.txt`: escopo e limites da coleta.

O backup usa `--single-transaction` e pressupõe ausência de alterações de esquema durante a coleta. O script recusa continuar se encontrar tabelas não InnoDB. Não bloqueia gravações normais da aplicação e não oferece snapshot atômico entre dump, metadados e auditoria. As auditorias podem percorrer tabelas inteiras; em bancos grandes, executar em horário de menor carga.

Gzip e checksum válidos não comprovam restauração. O ensaio de restauração continua obrigatório. Não use `001-initial.sql` como migração de tabelas existentes.

## Análise e ensaio seguintes

Revisar `migration-plan.json`, `audit.tsv`, `inventory.json` e o DDL. Contagens maiores que zero exigem análise; diferenças no total de pedidos podem refletir taxas existentes e não devem ser corrigidas automaticamente.

Após a revisão: restaurar o dump em MySQL isolado sem publicação de portas, com agendador de eventos desabilitado. Não ativar rotinas/eventos da cópia contra integrações externas. Gerar DDL compatível com os IDs e relacionamentos existentes, testar preenchimento dos campos históricos e comparar contagens/totais antes e depois. Validar a nova API contra a cópia migrada.

Endereços e nomes históricos ausentes só podem ser preenchidos a partir dos dados atuais disponíveis; a migração não reconstrói valores históricos perdidos. A associação de proprietários às empresas existentes é explícita e não pode ser feita pelo cadastro público.

Somente após esse ensaio será preparada a troca da aplicação, com backup atualizado, plano de retorno e janela apropriada para as gravações finais. Nada nesta coleta aplica a migração.

## Validação das ferramentas

Sete testes locais verificam análise de tipos/índices, campos ausentes e geração de auditoria somente de leitura. A suíte de integração foi ampliada para conferir o inventário e as consultas no MySQL; essa ampliação ainda precisa ser executada no host. A execução anterior aprovada não incluía essas novas verificações.

## Resultado do inventário de 02/11/2026

Artefatos analisados em `backups/legacy-20261102T183428Z-75137`: MySQL 8.0.46, oito tabelas InnoDB, IDs INT com sinal. As auditorias disponíveis retornaram zero ocorrências; a verificação de subtotais não estava disponível porque `order_items.total_price` não existia. As contagens estimadas indicaram dois pedidos e nenhum item; o ensaio fará a contagem exata.

O legado tem `orders.status` como VARCHAR(50), que já comporta os novos nomes de status; não é necessário converter para ENUM. Também contém estruturas de adicionais (`option_groups`, `options`, `selected_options`) e campos financeiros extras, que serão preservados. O esquema exige ajustar o default de `companies.whatsapp_phone` para permitir o novo cadastro e ampliar alguns VARCHARs para os limites aceitos pela API.

## Executar o ensaio da cópia

```sh
bash scripts/rehearse-migration.sh backups/legacy-20261102T183428Z-75137
```

Esse comando verifica os hashes do backup e restaura o dump em `delivery_rehearsal_test`, num MySQL temporário sem portas publicadas e com rede interna e agendador de eventos OFF. Não se conecta ao container de origem. A migração específica está em `database/migrations/003-legacy-foundation.sql`, fora dos scripts automáticos de instalação nova.

O executor recusa banco fora do sufixo de ensaio, esquema incompatível, migração parcial, rotinas/triggers/eventos não revisados e itens com adicionais cujo subtotal não possa ser determinado. O DDL tem commit implícito: uma falha reprova o ensaio e a cópia é descartada, sem tentativa de rollback transacional de ALTER TABLE.

A migração preserva IDs e valores antigos, preenche os campos de entrega a partir do cliente atual e registra `snapshot_source=legacy_customer_record`. Nomes e subtotais de itens são derivados dos registros disponíveis; pedidos sem itens permanecem sem itens e aparecem como histórico incompleto no painel. Assinaturas existentes recebem status `legacy`, sem confirmação de pagamento e sem reclassificar o campo original `companies.subscription_status`.

A comparação usa contagens e SHA-256 das linhas e colunas originais de cada tabela, sem imprimir dados pessoais. Depois da migração, a aplicação é exercitada por HTTP real dentro do container: loja antiga, login de proprietário criado somente no ensaio, cadastro de nova loja, catálogo nos limites de tamanho, checkout concorrente, isolamento e mudança de status. Os registros originais são comparados novamente após os testes.

O resultado agregado fica em `reports/rehearsal-<data>-<id>/rehearsal.json`. O log e o relatório permanecem; containers e banco temporários são removidos. O relatório de sucesso não autoriza nem executa troca da aplicação. A associação real do proprietário e a janela de corte serão preparadas após aprovação desse ensaio.

Validação local desta entrega: cinco novos testes de guardas e comparação de dados, suíte existente, sintaxe do backend/frontend e configuração do Compose passaram. O ensaio real do backup foi aprovado no host em 02/11/2026, conforme resultado abaixo.


## Ensaio aprovado em 02/11/2026

Execução `20261102T190312Z-77403`, confirmada pelo terminal do host e por
`reports/rehearsal-20261102T190312Z-77403/rehearsal.json`:
restauração, migração da cópia e testes HTTP aprovados com Node v22.23.4.
Os hashes dos dados originais foram preservados antes e depois dos testes HTTP.
O ambiente temporário foi removido com sucesso, conforme saída do host.
Nenhuma alteração foi aplicada à produção.

A origem contém uma empresa, três categorias, três produtos, um cliente,
dois pedidos e nenhum item. A auditoria `review_order_total` aponta dois casos,
correspondentes aos pedidos históricos sem itens; esses registros foram preservados.
As demais auditorias retornaram zero ocorrências.

Próxima etapa: preparar a associação explícita do proprietário real e o plano de
corte e retorno, incluindo backup atualizado e controle de gravações durante a
migração. A execução da migração em produção e a troca da aplicação permanecem
pendentes. Os testes HTTP não substituem a validação da experiência no navegador.
