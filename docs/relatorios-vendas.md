# Relatórios de vendas

Publicado em 04/11/2026 às 15:37 UTC. STATUS=PUBLICADO confirmado em `reports/update-20261104T153641Z-2677267`; backup final `backups/live/live-20261104T153732Z-2681094`. Conferência visual concluída e aprovada pelo responsável em 04/11/2026. Não exige nova migração nem altera registros existentes.

Acesse **Relatórios** no gestor/cozinha ou `/reports.html`. Somente donos e gerentes da loja podem consultar. Operadores recebem acesso negado. A API usa a empresa da sessão; parâmetros não permitem escolher outra loja.

## Período e significado dos valores

A consulta padrão abrange os últimos 30 dias, incluindo hoje, no fuso configurado em Operação da loja. Filtros aceitam de 1 a 93 dias consecutivos, incluindo início e fim. Datas inexistentes, listas de parâmetros e intervalos invertidos são recusados. Limites UTC são calculados pelo servidor com Intl, incluindo transições históricas de horário de verão, sem exigir tabelas de fuso no MySQL.

A base é **pedidos recebidos no período, por data de criação, com a situação atual**. O sistema ainda não registra data de conclusão, portanto este relatório não representa vendas pela data de conclusão. Um pedido recebido no período e concluído depois passará a compor as vendas desse período. Trocar o fuso da loja pode alterar os pedidos incluídos nos limites de cada dia.

O total considera somente pedidos atualmente concluídos, incluindo frete e descontando promoções. O ticket médio divide o total conhecido pela quantidade de pedidos concluídos com valor válido. Pedidos sem valor ou com valor negativo no histórico legado são contados, mas excluídos da soma e do ticket médio, com aviso. Frete/desconto ausentes ou inválidos têm aviso próprio. Valores monetários são agregados em DECIMAL no MySQL.

Pedidos recebidos, em andamento e cancelados têm contadores próprios. Pix/cartão/dinheiro são formas informadas no pedido, sem conciliação ou confirmação de recebimento. O relatório não calcula lucro, caixa, tributos ou repasses.

## Visualização

- Resumo: total concluído, compras concluídas, ticket médio, recebidos, andamento, cancelados, frete e descontos.
- Gráfico e tabela diários com todos os dias, inclusive dias vazios.
- Totais de pedidos concluídos por forma de pagamento informada.
- Modalidades delivery/retirada com contagens por situação e total concluído.
- Até 20 produtos mais vendidos em unidades, usando ID/nome preservados na venda. Valor dos itens inclui adicionais, antes do desconto geral e sem frete. Não é uma distribuição do valor líquido do pedido.

Pedidos antigos sem itens detalhados aparecem no total se tiverem valor válido, mas não no ranking; a tela avisa a quantidade afetada. Nomes de produtos editados não reescrevem os nomes do histórico. As tabelas oferecem os valores completos apresentados no gráfico.

## API e validação

GET autenticado `/api/admin/reports/sales?start=2026-11-01&end=2026-11-04`. Sem ambos os parâmetros, usa o período padrão. Dados de resumo, pagamentos, modalidades, série diária e produtos são lidos na mesma transação, sem gravações, com `Cache-Control: no-store`. Respostas identificam loja, fuso, período, instante da consulta e critério `created_at_current_status`.

A tela descarta respostas antigas após nova pesquisa e oculta resultados durante carregamento/erro para não mostrar números de outro período. Sessão expirada redireciona ao login; troca de loja exige recarregar.

154 testes locais aprovados: período inclusivo, datas inválidas, dias com 23/25 horas, permissões, isolamento, snapshot, liberação de conexão, base vazia, escape de texto e concorrência de pesquisas na interface. Integração MySQL preparada com limites exatos do fuso, ano bissexto, pagamentos, modalidades, valores, itens, dias vazios e isolamento entre duas lojas. Smoke da cópia verifica total de pedido realmente concluído.

Integração MySQL real aprovada em `reports/mysql-validation-20261104T153657Z-2678624.log`, incluindo período/fuso, totais, pagamentos, produtos, dias vazios e isolamento. 154 testes aprovados; ensaio sobre cópia, preservação dos dados, canário e aplicação ativa aprovados pelo atualizador.

Após publicar, confira um período com pedidos conhecidos: soma dos concluídos, cancelados separados, pagamentos e produtos. Consultas vazias devem mostrar zero e ticket indisponível. Automação de WhatsApp/IA continua para a última etapa.
