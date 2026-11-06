# Gestão de cardápio — API tenant

Todas as rotas abaixo exigem sessão ou JWT de lojista ativo, `tenantMiddleware` e perfil `tenant_owner` ou `tenant_manager`, incluindo acesso assistido válido. Operadores não gerenciam catálogo. O tenant vem exclusivamente da identidade autenticada; `tenant_id` recebido no corpo/query não altera o escopo. JSON de sucesso: `{success:true,data:...,message:"..."}`. Erros seguem o mesmo envelope com `success:false` e `data:null`.

## Rotas

- `GET /api/tenant/menu`: `{tenant_id,categories:[{id,tenant_id,name,sort_order,is_active,created_at,products:[...]}]}`. Inclui categorias vazias, pausadas e produtos esgotados para gestão. Produtos contêm `price` decimal em texto, `image_url`, `is_available`, `created_at`, `options`, `addon_groups` e `addon_version`.
- `POST /api/tenant/menu/categories`: `{name,sort_order?:0,is_active?:true}`; resposta 201. Nome até 120 caracteres, ordem entre 0 e 10000.
- `POST /api/tenant/menu/products`: `{category_id,name,description?:"",price:"19.90",image_url?:null,is_available?:true,options?:[...]}`; resposta 201. Categoria obrigatoriamente ativa e da mesma loja. Nome até 160 caracteres, descrição até 4000, preço de 0 a 999999.99, URL HTTPS de até 2048 caracteres sem credenciais. Não faz download remoto. Upload de arquivo continua nas rotas de imagens existentes e tem prioridade sobre a URL externa.
- `PUT /api/tenant/menu/products/:id/availability`: `{is_available:false}` ou `true`. Define explicitamente o estado, permitindo repetição segura em vez de alternância cega. Não reativa categoria pausada. Afeta imediatamente a seleção do cardápio público e a validação de novos checkouts.
- `DELETE /api/tenant/menu/products/:id`: desativa (`active=0`), sem remover linha, imagem, adicionais ou referências históricas. Responde com `{id,tenant_id,is_available:false,deleted:false,deactivated:true}`. Repetir em produto próprio desativado é permitido. A disponibilidade pode reativá-lo posteriormente.

Produto ou categoria de outra loja responde 404. Entradas inválidas respondem 400; perfil insuficiente 403; sessão ausente/expirada 401. Erros de conexão usam 503 sem SQL/credenciais na resposta ou no log. Métodos não suportados usam 405.

## Opcionais compatíveis com o checkout

`options` simples: `[{name:"Queijo",additional_price:"2.50",max_quantity:1,is_active:true}]`, até 20 opções. O servidor gera chaves de checkout e um grupo Complementos. Alternativamente, enviar `addon_groups` no formato já existente (até 12 grupos, com limites mínimo/máximo e opções); não enviar ambos.

Cada adicional pode ser escolhido **uma vez por unidade do produto** no checkout atual (`max_quantity=1`). Quantidade maior é rejeitada explicitamente para não cadastrar uma cobrança que o checkout não implementa. Grupos continuam permitindo múltiplas opções diferentes. A tabela aplica esse limite com CHECK. O retorno `options[].id` é uma string representando BIGINT; `option_key` é a chave usada no carrinho, junto com `addon_version`. Não usar o ID relacional no campo `option_ids` do checkout.

`product_addons.config` permanece a configuração canônica com versão e regras dos grupos. `product_options` é uma projeção relacional com ID estável por produto/chave; a migração importa configurações existentes. Tanto a API nova quanto a edição legada de adicionais sincronizam a projeção na mesma transação, sob bloqueio do produto. Alterar diretamente as tabelas fora da aplicação não é suportado.

## Schema e migração 014

Para preservar o banco existente, `categories.company_id` / `products.company_id` representam `tenant_id`, `active` representa `is_active` / `is_available`; a API usa os nomes novos. Não renomear essas colunas: são utilizadas pelos módulos publicados. As duas tabelas ganham `created_at`; registros anteriores recebem a data da migração, pois não havia data original registrada.

`products.image_url` é criada quando ausente ou ampliada de VARCHAR(255) legado para VARCHAR(2048), preservando conteúdo. URLs antigas fora do padrão HTTPS são mantidas no banco e omitidas da apresentação. As imagens binárias existentes não são alteradas.

`product_options`: `id BIGINT UNSIGNED`, `tenant_id` e `product_id` com os tipos reais da base (INT ou INT UNSIGNED), `option_key`, `group_key`, `name`, `additional_price DECIMAL(10,2)`, `max_quantity`, `is_active`, `created_at`. Chave única `(tenant_id,product_id,option_key)`; FK composta `(tenant_id,product_id)` → `products(company_id,id)` impede no banco vincular adicionais ao produto de outra loja. Índices de categoria por `(company_id,sort_order,id)` e produto por `(company_id,id)`.

A atualização detecta a migração pendente ou parcial, ensaia em cópia, faz backup, preserva os dados anteriores e valida o schema antes de abrir a aplicação. DDL MySQL não é transacional: em caso de falha, usar o relatório/backup do atualizador; não executar a migração manualmente sobre uma aplicação aberta. Não requer redefinição de credenciais.

Validação adicionada: testes locais de autenticação, isolamento, validação, sincronização e rollback; integração MySQL com duas lojas, FK adversária, atualização legada, estado público e histórico preservado; DDL com INT/INT UNSIGNED e image_url legado; canário sem autenticação e smoke na cópia migrada.
