# Acompanhamento do pedido

Publicado em 04/11/2026 às 19:46 UTC. STATUS=PUBLICADO confirmado em `reports/update-20261104T194520Z-2967971`; backup final `backups/live/live-20261104T194631Z-2972451`. Conferência visual pelo responsável ainda pendente. Oferece consulta ao cliente sem cadastro, para delivery e retirada. Não inclui GPS, mensagens automáticas ou confirmação de pagamento.

## Cliente

Após finalizar o checkout, aparece **Último pedido recebido** com o botão **Acompanhar meu pedido**. O link também permanece após atualizar o cardápio na mesma aba, armazenado por loja em sessionStorage. Ao fechar a sessão da aba, esse atalho pode desaparecer; o cliente pode guardar o link para reabrir a consulta diretamente.

A página `/track.html#<token>` mostra nome da loja, número, situação atual, previsão inicial, itens/adicionais, valores, frete/desconto/cupom e endereço da loja para retirada. Não retorna nome, telefone, endereço residencial, observações do cliente ou dados do entregador. O link usa 32 bytes aleatórios e não pode ser obtido apenas pelo número do pedido.

A consulta usa o token no cabeçalho `X-Order-Token`; o identificador fica no fragmento do link, sem aparecer na URL HTTP da página ou da API. A página usa somente assets locais e orientação de referrer `no-referrer`. Quem tiver o link pode consultar as informações disponibilizadas nele. Não há expiração automática nesta versão; pedido e loja precisam continuar disponíveis.

Atualiza a cada dez segundos enquanto a página está visível e o pedido em andamento. Concluído ou cancelado encerra as consultas periódicas; o botão Atualizar continua funcionando. Uma falha mantém os últimos dados com aviso e horário da última consulta confirmada. Link inválido/desconhecido oculta dados e informa indisponibilidade.

As etapas indicam a situação atual, sem inventar horários de transição ou afirmar que todas as etapas anteriores ocorreram. Para retirada, não aparece saída para entrega. A previsão é a duração informada na compra, contada desde o recebimento; não é um novo cálculo de chegada ou uma promessa de horário. A tela informa que os horários usam o fuso do dispositivo.

## Gestor e reenvios

O gestor mostra **Acompanhamento** no cartão do pedido. Para pedidos anteriores sem link, use **Gerar link de acompanhamento**. Donos, gerentes e operadores podem gerar somente para pedidos da própria loja. A geração repetida conserva o link. Não altera a etapa, não cria outro pedido e não envia mensagens.

O checkout grava o token na mesma transação do pedido e o devolve na confirmação. Reenviar a mesma confirmação com a chave de idempotência devolve o mesmo pedido e link, inclusive se a resposta original se perdeu. A leitura do pedido reprocessado mantém trava para serializar a geração com o gestor.

## API e persistência

Migração `010-order-tracking.sql` cria `order_tracking(order_id,token)`, com ID compatível com a tabela real de pedidos e índice único no token. Não reescreve registros anteriores nem cria links em massa. O esquema inicial inclui a mesma tabela. Tokens entram no backup privado do MySQL existente.

GET público `/api/order-tracking`, com cabeçalho `X-Order-Token`. Sem token válido retorna 404; não aceita número/empresa como alternativa. Lê situação e itens na mesma transação, com lista explícita de campos e `Cache-Control: no-store`.

POST autenticado `/api/admin/orders/:id/tracking` verifica empresa da sessão e trava o pedido antes de criar/obter o link. O board administrativo retorna `tracking_url`, sem expor coluna interna `tracking_token`. A rota pública só atende pedidos de lojas ativas.

205 testes locais aprovados: geração aleatória/estável, checkout idempotente, ausência de token, campos permitidos, isolamento, rollback, retirada, terminal, falha de atualização, aba oculta, escape de texto e restauração do último link. Integração MySQL preparada para reenvio, pedidos anteriores, geração concorrente, mudanças reais de status e isolamento. Ensaio da migração usa IDs assinados/não assinados; smoke da cópia verifica consulta de pedido concluído.

Integração MySQL real aprovada em `reports/mysql-validation-20261104T194541Z-2969595.log`, incluindo checkout/reenvio, token privado, status, legado e isolamento. 205 testes aprovados; migração 010, ensaio da cópia, preservação dos dados, canário e aplicação ativa aprovados pelo atualizador.

Após publicar, faça um pedido, abra o acompanhamento e altere as etapas pelo gestor. Confira delivery/retirada, conclusão/cancelamento e atualização pelo mesmo link. Também teste gerar o link de um pedido anterior no gestor. Automação de atendimento e envio por WhatsApp continuam para a última etapa.
