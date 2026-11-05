# Clientes e histórico

Publicado em 04/11/2026 às 15:10 UTC. Relatório confirmado: `reports/update-20261104T150856Z-2634647` (PUBLICADO). Backup final: `backups/live/live-20261104T151013Z-2638867`. Conferência visual concluída e aprovada pelo responsável em 04/11/2026.

Acesse **Clientes** no gestor de pedidos ou `/customers.html`. Donos e gerentes podem consultar; operadores não têm acesso. A API usa exclusivamente a loja da sessão e não aceita escolher outro restaurante por parâmetro.

A lista permite buscar nome/telefone, ordenar por último pedido, total comprado, quantidade de compras ou nome e consultar grupos de clientes recorrentes, recentes, sem compras concluídas e inativos há 15, 30 ou 60 dias. Há paginação de 50 clientes e de 20 pedidos no histórico. O resumo superior considera toda a loja, independente dos filtros.

Telefones brasileiros equivalentes, com DDD e com ou sem prefixo 55, são agrupados apenas durante a consulta. O identificador é o menor ID do grupo; o cadastro exibido vem do membro com o pedido mais recente. Cadastros com telefone inválido permanecem separados. Nenhum cadastro é fundido fisicamente e nenhum pedido antigo é reescrito. Pesquisas usam o cadastro representativo do grupo.

Compras e valores consideram somente pedidos concluídos. O total inclui frete e descontos e não comprova recebimento financeiro. Pedidos em andamento e cancelados aparecem separadamente. Valores antigos nulos ou negativos são excluídos da soma e do denominador do ticket médio, com aviso; a quantidade de compras ainda inclui esses pedidos. O banco atual exige valores válidos em novos pedidos.

Inatividade considera períodos completos de 24 horas desde a última compra concluída. Clientes com pedidos em andamento não entram nos grupos de inativos. Os grupos de 15/30/60 dias se sobrepõem. Clientes sem compra concluída têm grupo próprio.

O histórico mostra todos os status, os dados preservados em cada pedido, itens, adicionais, frete, desconto e código do cupom. Registros legados sem itens são identificados. Os cinco itens mais comprados são calculados pelos itens de pedidos concluídos, agrupando ID e nome histórico do produto.

Os endpoints GET `/api/admin/customers` e `/api/admin/customers/:id` fazem consultas em uma transação de leitura para obter dados consistentes. Não há nova migração nem alteração de dados neste módulo. Respostas não são armazenadas em cache. A interface descarta respostas antigas de buscas e de históricos já fechados.

Verificação local: 133 testes aprovados e sintaxe validada. A integração MySQL inclui agrupamento por telefone, soma de compras, inatividade, paginação, snapshots e isolamento de lojas; o ensaio da cópia inclui consulta e conclusão de pedido. Integração MySQL real aprovada no relatório `reports/mysql-validation-20261104T150920Z-2635991.log`. Ensaio da cópia, preservação dos dados, canário e aplicação ativa também aprovados pelo atualizador.

WhatsApp, IA, disparos de recuperação e demais automações continuam reservados para a última etapa. Esta entrega não envia mensagens. Cashback, exportação de base e edição de clientes não fazem parte desta versão.
