# Adicionais de produtos

Publicado em 03/11/2026 às 20:18 UTC, na atualização `update-20261103T201720Z-1426258`. No cardápio administrativo, cada produto tem o link **Adicionais**, que abre `/addons.html?produto=ID`.

## Cadastro e compra

- Até 12 grupos por produto, com até 20 opções por grupo.
- Cada grupo define mínimo e máximo de escolhas. Mínimo zero significa opcional; mínimo maior que zero exige seleção. Não é permitido salvar um grupo obrigatório sem opções disponíveis suficientes.
- Cada opção tem nome, preço adicional em reais e disponibilidade. Opções podem ser gratuitas ou pausadas. Cada opção pode ser escolhida uma vez por unidade do produto.
- O cliente escolhe os adicionais antes de adicionar o produto. Combinações diferentes ficam em linhas distintas no carrinho, com quantidade e remoção independentes. O limite de 99 unidades de um produto soma todas as combinações.
- Preço unitário = preço do produto + adicionais escolhidos. Quantidade multiplica esse valor; frete entra uma vez no total do pedido.
- O pedido salva nomes dos grupos/opções e preços por unidade. O painel e a mensagem manual para WhatsApp exibem as escolhas. Edições posteriores do catálogo não alteram o histórico.

Para mudar a combinação no carrinho, remova a linha e adicione o produto novamente. Adicionais com quantidades próprias, como “duas porções de queijo” na mesma unidade, não fazem parte desta entrega; cadastre uma opção específica ou use combinações de opções distintas.

## Consistência e isolamento

O servidor valida os limites, o produto, a disponibilidade e o preço das opções; não aceita preço enviado pelo cliente. Identificadores de opções pertencem à configuração do produto consultado na loja do pedido.

Cada edição incrementa uma versão. Uma edição desatualizada retorna 409 e não sobrescreve outra. Uma compra com versão desatualizada retorna 400 com orientação para atualizar o cardápio. No recarregamento da loja, itens com configurações alteradas são removidos do carrinho com aviso para nova escolha; as quantidades das demais linhas são preservadas.

O hash de reenvio inclui as combinações e versões, em ordem normalizada. O mesmo pedido com itens/opções em outra ordem retorna o pedido original. Alterar as escolhas com a mesma chave retorna 409. Pedidos anteriores sem adicionais preservam o formato de hash. O reenvio de um pedido confirmado é resolvido antes de conferir a configuração atual, preservando o pedido original mesmo se uma opção foi pausada depois.

Cadastros usam o produto e a empresa da sessão, com bloqueio transacional compatível com o checkout. Proprietário/gerente podem editar; operador pode consultar.

## API e esquema

- `GET /api/admin/products/:id/addons`: produto, grupos completos e versão (zero quando ainda não configurado).
- `PUT /api/admin/products/:id/addons`: `{ "version": 0, "groups": [...] }`, substituindo os grupos após validação. Cada grupo usa `id`, `name`, `min`, `max`, `options`; cada opção usa `id`, `name`, `price` decimal em string e `active` booleano. IDs são estáveis entre edições.
- O cardápio público inclui `addon_groups` e `addon_version` por produto e omite opções pausadas.
- Cada item de `POST /api/orders` pode informar `option_ids` e `addon_version`. Produtos sem grupos continuam aceitando o formato anterior.

`product_addons` guarda configuração JSON e versão por produto. `order_items.addons_snapshot` guarda as escolhas históricas. `unit_price` já inclui os adicionais e `total_price` é o subtotal da linha; a auditoria não soma adicionais novamente.

Instalação nova: o esquema `001-initial.sql` atualizado já contém as estruturas; aplicar também 002 conforme README. Não aplicar 004/005 sobre esse esquema novo.

Banco existente: aplicar **004 e depois 005**, uma vez cada, em conexão administrativa e após backup/ensaio. Se 004 já foi aplicada por completo, aplicar apenas 005. `005-product-addons.sql` adapta a chave estrangeira ao tipo INT com ou sem sinal de `products.id`. Os comandos de cada arquivo precisam da mesma conexão MySQL. A aplicação verifica as estruturas antes de iniciar.

As tabelas legadas `option_groups`/`options` e a coluna `selected_options` são preservadas. Não há importação automática dessas configurações: sua estrutura e regras precisam de revisão específica antes de transferi-las. Itens históricos recebem `addons_snapshot = NULL`, sem alteração de preços ou seleções legadas.

O ensaio completo do legado agora aplica 003, 004 e 005 em conexão dedicada. A revisão desta entrega também corrigiu 004: o inventário real já possui `orders.delivery_fee`, portanto o arquivo cria o campo apenas quando ausente e preserva valores/nulos existentes. A auditoria interpreta frete histórico desconhecido como zero para a comparação de totais, sem atualizar o registro original. Frete negativo continua sendo inconsistência.

## Validação e publicação

Verificações locais concluídas: `npm run check` aprovado e `npm test` com 12 arquivos aprovados, zero falhas/ignorados. Os testes de API usam banco simulado e os testes do JavaScript da loja usam VM. Cobrem limites, preço por unidade, variações, opção pausada/estrangeira, versão desatualizada, permissões, reenvio e persistência do carrinho. Não equivalem a homologação visual ou a validação de SQL em MySQL real.

A integração MySQL foi ampliada para edições e checkouts concorrentes, snapshots e migrações com IDs INT/INT UNSIGNED, com/sem frete preexistente e preservação de seleções legadas. A execução real no host foi aprovada em 03/11/2026: `reports/mysql-validation-20261103T201735Z-1427325.log`. A candidata publicada também aprovou 94 testes em Node v22.23.4. Ensaio, migração 005 no banco real e verificação de 14 tabelas passaram, com registros originais preservados; evidência em `reports/update-20261103T201720Z-1426258/`. O responsável confirmou o funcionamento visual geral dos módulos publicados antes da entrega seguinte.

Antes de publicar, executar `bash scripts/validate-mysql.sh` no host autorizado e ensaiar 004/005 numa cópia atual do banco publicado. Validar cadastro, compra, total, histórico e reenvio em navegador. As migrações usam DDL MySQL com commit implícito. Uma volta à versão anterior após receber pedidos personalizados exige revisão, pois ela não apresenta esses adicionais corretamente.

## Observações por item — preparada para revisão

O cardápio aceita observação opcional de até 500 caracteres por linha, no diálogo de adicionais ou na sacola. Para duas unidades com preparos diferentes, adicione o produto novamente e informe uma observação em cada linha. A quantidade de uma linha aplica a mesma instrução a todas as suas unidades. Texto é tratado como dado e escapado nas interfaces.

O checkout recebe `items[].notes`, valida tipo, tamanho e caracteres de controle, preserva em `order_items.item_notes` e considera a observação na normalização e no hash de idempotência. Observação vazia mantém os hashes anteriores. A instrução aparece no gestor, cozinha, impressão manual e histórico do cliente. O link público de acompanhamento continua omitindo texto livre, conforme seu contrato de privacidade.

A migração aditiva `016-item-instructions.sql` inclui a coluna com padrão vazio, integrada ao planejador de atualização. O esquema inicial já contém a coluna. A suíte local cobre diferenciação de preparos, persistência na sacola, escape de HTML e reenvio com conflito. Integração MySQL e ensaio de atualização foram ampliados, mas precisam ser executados no host antes da publicação pelo atualizador habitual. Esta alteração ainda não foi publicada.

## Quantidades de adicionais — preparada para revisão

Cada opção pode ter `max_quantity` inteiro entre 1 e 20 por unidade de produto. O padrão é 1, preservando cadastros e seleções anteriores. O mínimo e máximo do grupo agora contam unidades de adicionais. Exemplo: grupo com máximo 3 permite dois queijos e um bacon, sujeitos ao limite individual de cada opção. Configure os limites em Adicionais do produto.

No cardápio, opções com limite maior que um apresentam campo de quantidade; limite um conserva a caixa de seleção. A sacola, recarga, cotação de cupom e checkout preservam as quantidades. O servidor calcula preço do produto mais a soma de preço do adicional multiplicado por sua quantidade; o resultado é multiplicado pela quantidade de produtos da linha. Quantidades de adicionais são registradas no snapshot e exibidas no gestor, cozinha, impressão, histórico e acompanhamento.

O contrato aceita `items[].option_quantities`, objeto com identificador e quantidade inteira positiva. `option_ids` continua aceito como seleção de uma unidade. Se ambos forem enviados, as chaves de quantidades devem pertencer à seleção explícita. Quantidades iguais a um são normalizadas para o formato anterior; repetições entram no hash de idempotência e distinguem as linhas. Contagens zero, negativas, fracionárias, fora dos limites, opções pausadas ou de outro produto são recusadas.

A projeção `product_options` mantém `max_quantity` na mesma transação do cadastro. A migração 017 substitui a restrição antiga de uma unidade pela faixa 1–20, sem alterar registros. O atualizador detecta a restrição nomeada para não reaplicar a migração. Esquema inicial, integrações MySQL e ensaio na cópia foram atualizados. A execução MySQL e a conferência visual continuam obrigatórias antes de publicação no host.
