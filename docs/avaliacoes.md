# Avaliações de satisfação

Publicado em 04/11/2026 às 19:56 UTC. STATUS=PUBLICADO confirmado em `reports/update-20261104T195547Z-2985874`; backup final `backups/live/live-20261104T195646Z-2990142`. Conferência visual pelo responsável ainda pendente. Aproveita o link exclusivo do acompanhamento. Não envia convites, e-mails ou mensagens de WhatsApp.

## Cliente

Quando o restaurante marcar o pedido como concluído, a página de acompanhamento mostra **Como foi seu pedido?**. O cliente escolhe nota de 1 a 5 e pode escrever um comentário de até 1000 caracteres. A avaliação é opcional e só é enviada ao clicar em Enviar avaliação. Pedidos em andamento ou cancelados não podem ser avaliados.

Existe uma avaliação por pedido. Após enviar, o cliente vê a nota/comentário salvos e não pode alterá-los. Repetir o mesmo conteúdo após falha de conexão retorna sucesso sem criar duplicidade. Tentar substituir por outro conteúdo retorna conflito. Comentários são exibidos como texto, sem interpretar HTML.

O mesmo token privado do acompanhamento autoriza a avaliação; não há verificação de telefone ou cadastro adicional. Quem tiver esse link pode enviar/consultar a avaliação daquele pedido. As notas e comentários não são publicados no cardápio ou em uma página pública de avaliações. A tela orienta a não incluir dados pessoais no comentário.

## Painel da loja

Acesse **Avaliações** no gestor/cozinha ou `/reviews.html`. Somente donos e gerentes podem consultar. Operadores não acessam o painel. A empresa é sempre obtida da sessão.

O painel mostra quantidade, média, total de notas 1/2 e distribuição de 1 a 5. O resumo considera toda a base da loja, independente do filtro de nota. A lista pode filtrar uma nota e apresenta 50 registros por página, dos mais recentes aos mais antigos, com número do pedido, cliente registrado no pedido, modalidade, data e comentário. Não exibe telefones ou endereços.

Não há edição, exclusão ou resposta pela loja nesta versão. Os registros de satisfação não alteram pedidos, clientes ou relatórios de vendas.

## API e concorrência

GET/POST `/api/order-review` usam `X-Order-Token`, sem incluir o token na URL da API. GET informa elegibilidade e eventual avaliação. POST recebe `{rating,comment}`, exige pedido concluído e valida limites no servidor. Token inválido/desconhecido retorna 404.

O envio trava a linha do pedido e faz leitura atual da avaliação sob trava. Assim, dois envios do mesmo pedido se serializam sem sobrescrever conteúdo, inclusive quando a primeira consulta da transação ocorreu antes de outra avaliação terminar. A chave primária por pedido também impede duplicações.

GET autenticado `/api/admin/reviews?rating=all&offset=0` exige dono/gerente. Resumo, distribuição, contagem filtrada e registros são lidos na mesma transação. Todos os endpoints usam `Cache-Control: no-store`.

Migração `011-order-reviews.sql` cria `order_reviews` com ID de pedido compatível com o banco real, nota limitada por CHECK 1–5, comentário e data. Não reescreve pedidos ou cria avaliações de exemplo no banco real. Novas instalações têm o esquema em `001-initial.sql`; registros entram nos backups privados do MySQL.

214 testes locais aprovados, incluindo validação, elegibilidade, token, permissões, isolamento, reenvio, conflito, rollback e formulário. Integração MySQL preparada para envio concorrente real, média/lista de uma loja e isolamento de outra, além da recusa antes de conclusão. Ensaio de DDL cobre IDs assinados/não assinados; smoke da cópia envia uma avaliação em pedido concluído.

Integração MySQL real aprovada em `reports/mysql-validation-20261104T195610Z-2987581.log`, incluindo conclusão, nota, idempotência, concorrência e isolamento. 214 testes aprovados; migração 011, ensaio da cópia, preservação dos dados, canário e aplicação ativa aprovados pelo atualizador.

Após publicar, conclua um pedido e abra seu acompanhamento. Envie uma avaliação e confira a nota e o comentário no painel Avaliações. Confira também que um pedido ainda em preparo não oferece o formulário. Atendimento/WhatsApp/IA continuam para a última etapa.
