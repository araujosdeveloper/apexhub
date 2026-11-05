# Destaques e sugestões de acompanhamentos

Publicado em 04/11/2026 às 17:13 UTC. STATUS=PUBLICADO confirmado em `reports/update-20261104T171222Z-2792769`; backup final `backups/live/live-20261104T171329Z-2797110`. Conferência visual pelo responsável ainda pendente. A migração `008-menu-merchandising.sql` cria somente `company_merchandising`, adaptando o tipo de company_id ao banco existente. Nenhum pedido, produto ou cliente é reescrito durante a migração.

## Vitrine e popularidade

O cardápio destaca até seis produtos disponíveis mais vendidos e ordena produtos dentro de suas categorias. As categorias mantêm a ordem configurada pela loja. Os produtos destacados também continuam disponíveis na categoria original.

Popularidade considera unidades de itens em pedidos atualmente concluídos, criados nos últimos 30 dias corridos (janela UTC de 30 × 24 horas). Pedidos futuros, em andamento e cancelados não entram. A mesma regra de data de criação é usada nos relatórios existentes; não há data de conclusão gravada. Empates mantêm ordem por ID. Produtos sem vendas aparecem depois dos populares; se não houver vendas elegíveis, não aparece seção de destaques.

O dono/gerente pode desativar a popularidade. Nesse caso, o cardápio volta à ordem por ID dentro das categorias e não mostra a seção de mais vendidos. Não há contagem de vendas, dados de clientes ou pedidos individuais na resposta pública, apenas IDs dos produtos destacados.

## Combinações configuradas pela loja

No gerenciamento de cardápio, abra **Configurar destaques e sugestões de acompanhamentos** (`/merchandising.html`). Donos e gerentes podem consultar e salvar. Operadores não têm acesso à configuração.

Escolha um produto e até seis sugestões que combinam com ele, por exemplo, lanche → bebida/batata. Não é permitido sugerir o próprio produto ou repetir IDs. Até 100 produtos podem ter combinações configuradas. Todos os IDs devem pertencer à loja da sessão, verificados no servidor.

Ao trocar de produto, a seleção permanece no rascunho local. Salvar publica todas as combinações e opções de uma vez. Recarregar descarta o rascunho. A versão é conferida sob trava da empresa para impedir sobrescrita de edição concorrente; conflito bloqueia o salvamento até recarregar.

É possível preparar combinações com produtos pausados, mas o cardápio público filtra tanto produtos quanto categorias indisponíveis. Desativar sugestões oculta as ofertas sem apagar as combinações.

## Experiência do cliente

Após adicionar um produto, o cardápio mostra **Que tal acompanhar?** abaixo das categorias e também no checkout. São até quatro sugestões únicas, seguindo as combinações dos itens no carrinho e a ordem cadastrada. Itens já presentes no carrinho e produtos ausentes do cardápio disponível são excluídos. Remover itens recalcula as ofertas; carrinho vazio não mostra sugestões.

Nada é incluído sem ação do cliente. Clicar em Adicionar usa o mesmo fluxo dos demais produtos, inclusive seleção e validação de adicionais obrigatórios. Preços, quantidades, cupons, disponibilidade e valores continuam sendo conferidos pelo checkout no servidor. A lista e o resumo do checkout são atualizados ao incluir uma sugestão; alterar itens pode exigir reaplicar cupom, como nas demais edições de carrinho.

O sistema não gera mensagens ou disparos e não usa IA para escolher combinações nesta etapa. Novas configurações aparecem ao carregar/atualizar o cardápio; páginas já abertas precisam ser atualizadas.

## API e validação

GET/PUT autenticados `/api/admin/merchandising`, restritos a dono/gerente. GET retorna configuração, versão e produtos da loja. PUT valida flags, limites, referências à mesma loja e versão; a primeira gravação usa versão 0. A configuração inicial habilita popularidade e sugestões, mas não inventa combinações.

GET público `/api/menu/:slug` acrescenta `merchandising` e `recommended_ids` nos produtos, preservando preços e adicionais. Referências indisponíveis são removidas da resposta. A fonte dos nomes e preços é sempre o catálogo atual; combinações não guardam valores próprios.

180 testes locais aprovados, incluindo configuração, limites, isolamento, concorrência, rollback, integração da vitrine com a rota pública, ordenação, ocultação, interface, carrinho e adicionais obrigatórios. Seis simulações do publicador, sintaxe e Compose aprovados. Integração MySQL preparada para vendas concluídas/canceladas, combinações, categoria pausada, desativação dos recursos, concorrência e duas lojas. Ensaio da migração inclui IDs assinados/não assinados; smoke da cópia inclui configuração e leitura do cardápio com venda concluída.

Integração MySQL real aprovada em `reports/mysql-validation-20261104T171246Z-2794378.log`, incluindo popularidade, combinações, indisponibilidade, concorrência e isolamento. 180 testes aprovados; migração 008, ensaio sobre cópia, preservação dos dados, canário e aplicação ativa aprovados pelo atualizador.

Após publicar, cadastre uma combinação em Cardápio → Destaques e sugestões. Na loja, adicione o produto principal e confira a oferta. Adicione o acompanhamento e confira o preço, os adicionais e o total; pause o produto/categoria e confirme que não é oferecido. Produtos populares exigem pedidos concluídos elegíveis.
