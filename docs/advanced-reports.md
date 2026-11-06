# API de relatórios avançados ApexHub

Respostas: `{success:true,data:{...},message:"..."}`; erros seguros com request ID e logs estruturados. Todas as rotas exigem identidade ativa, incluindo validação de sessão e empresa. Não aceitam tenant escolhido no query/body. `company_id` é o nome físico de `tenant_id` no MySQL existente. Owners e managers podem ler relatórios; operadores não têm permissão financeira. Super Admin usa a rota global com sessão/JWT Master.

## Lojista

- `GET /api/tenant/reports/summary`: padrão últimos sete dias, incluindo hoje; `?start=YYYY-MM-DD&end=YYYY-MM-DD` opcional, ambos obrigatórios quando informados, máximo 93 dias. Retorna `summary` do intervalo, `daily` preenchido com dias zerados e `today` independente do filtro.
- `GET /api/tenant/reports/sales-chart`: últimos sete dias fixos, incluindo hoje, `series` ordenada. Rejeita filtros de data para não alterar o contrato semanal.
- `GET /api/tenant/reports/origin-chart`: mesmo intervalo do resumo; `series` com `origin`, `label`, `orders`, `percentage` e `total_orders`. `snapshot_source=checkout` representa Cardápio Digital; todos os demais valores são Outros/Legados. Não atribui origem WhatsApp/iFood sem evidência. Inclui todos os status; percentuais arredondados a duas casas, base vazia = zero.

Datas seguem o fuso configurado da loja. Limites UTC inclusivo/exclusivo são calculados em Node, incluindo horário de verão, sem depender das tabelas de timezone do servidor MySQL. Agrupamento por dia civil usa `DATE(?)` nos limites e JOIN com faixas diárias; não usa `DATE(created_at)` no filtro, preservando o índice e a correção do fuso.

Cada agregado contém `orders`, `completed_orders`, `cancelled_orders`, `gross_revenue`, `order_revenue`, `average_ticket`, `cancellation_rate` (0 a 100), `incomplete_amount_orders`.

Valores monetários em BRL são strings decimais, nunca float no backend. Gráficos podem converter o valor apenas na apresentação. `gross_revenue` soma total + desconto dos pedidos concluídos, incluindo taxa de entrega; `order_revenue` soma o total final dos concluídos após descontos. Ticket médio usa totais finais conhecidos de pedidos concluídos; sem base retorna `null`. Cancelamento = cancelados / todos os pedidos criados no período. Valores legados nulos/negativos não são tratados como vendas conhecidas; o contador de valores incompletos indica limitações. Métricas são por criação e status atual, não por data de liquidação/conclusão.

## Master

`GET /api/admin/reports/global-financial`: mês corrente e mês anterior em UTC, somente empresas atualmente ativas. Retorna `current_month`, `previous_month`, crescimento percentual do volume de pedidos e faturamento bruto, além do MRR estimado das assinaturas ativas dessas empresas a partir de `PLAN_PRICES_JSON`. GMV de restaurantes e receita recorrente da plataforma são métricas distintas.

A comparação é explicitamente mês corrente parcial versus mês anterior completo; não é projeção. Denominador anterior zero resulta `null`. Não há histórico imutável de assinaturas/preços: `mrr_growth_percent=null`, com motivo `subscription_price_history_not_recorded`. Preços faltantes deixam `mrr_estimate=null` e expõem valor conhecido/quantidade sem preço, conforme API existente. Não representa dinheiro recebido ou repasses do gateway.

## Performance e publicação

Reutiliza `orders_company_date(company_id,created_at,id)` já presente tanto no esquema inicial quanto na migração da base legada. Cada filtro de pedidos aplica igualdade no tenant e intervalo indexável em `created_at`; o global faz JOIN das empresas ativas com o mesmo intervalo por tenant. Não cria índices duplicados nem exige nova migração. Em grandes bases, validar cardinalidade e planos com EXPLAIN no ambiente de produção antes de decidir materialização/agregação incremental.

Leituras de cada resposta usam uma transação para snapshot consistente. Testes de integração da atualização exercitam datas, base vazia, isolamento, origens, totais Master e disponibilidade do índice no MySQL real descartável. Testes locais não substituem a validação MySQL do atualizador.
