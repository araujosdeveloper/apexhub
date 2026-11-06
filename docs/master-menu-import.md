# Importação de cardápio por IA no Master

Acesso: `/master.html#menu-import`, menu **Importar cardápio com IA**. Mantém sidebar e header do Master, paleta Dark ApexHub e layout responsivo. Não requer nova migração nem nova chave de IA; reutiliza `.env.ai` configurado na etapa anterior.

## Fluxo visual

1. Buscar uma loja pelo nome, CNPJ ou e-mail; selecionar a empresa ativa no dropdown. Busca usa a API administrativa paginada, com até 100 resultados por página e botão Carregar mais lojas.
2. Selecionar ou arrastar um JPEG/PNG de até 2 MB ou PDF de até 5 MB. Processar com IA gera somente uma prévia.
3. Revisar categorias, nomes, descrições e preços. É possível remover/adicionar produtos e categorias. Preços ilegíveis ficam vazios/em destaque; aceita vírgula ou ponto nos centavos, normalizados para o backend.
4. Marcar que conferiu loja e preços e clicar em **Salvar Cardápio na Loja**. O resultado mostra quantidades e nome da loja.

Trocar loja/arquivo limpa a prévia anterior. Durante processamento, os controles de seleção ficam bloqueados. Na confirmação de resultado incerto, a edição é bloqueada e Tentar salvar novamente usa exatamente o mesmo corpo/identificador. O backend devolve o recibo já confirmado, sem duplicar itens. Nenhum conteúdo da IA é renderizado como HTML; campos usam value e textos usam textContent. O frontend não guarda token ou documentos em localStorage/sessionStorage.

## Backend

Rotas reservadas globais protegidas por autenticação Master e `super_admin`; JWT de lojista é rejeitado antes de ler/processar o arquivo. O frontend emite JWT Master sob demanda em `/api/master/auth/token`, pois o cookie HttpOnly do Master tem Path `/api/master`.

- `POST /api/admin/menu/import-ai`: multipart com exatamente `tenant_id` e `file`. Valida ID e existência/status da empresa antes da extração. Reutiliza o mesmo parser/engine de IA, limites e revisão da API tenant. Revalida conta/sessão Master e loja depois da extração, registra `menu_import_preview` sem arquivo/JSON extraído no log, retorna `{tenant_id,tenant_name,categories,product_count,requires_review:true,saved:false,warnings}`.
- `POST /api/admin/menu/confirm-import`: JSON `{tenant_id,import_id?,categories:[{name,products:[{name,description,price:"19.90"}]}]}`. Valida tudo antes de escrever, revalida/bloqueia conta e sessão Master e empresa ativa, cria novas categorias/produtos com o ID validado e audita na mesma transação. Falha de gravação ou auditoria reverte o lote inteiro. Não sobrescreve itens existentes. Categorias físicas continuam usando company_id, conforme schema vigente.

Respostas REST `{success,data,message}`. Loja inexistente: 404; suspensa: 409; ID inválido: 400; conteúdo/preços inválidos: 422; perfil/sessão incompatível: 401/403. Mesmos limites de arquivo e lote (30 categorias, 200 produtos, JSON até 64 KB) da importação tenant.

`import_id` é UUID v4, sempre enviado pelo painel, opcional para clientes diretos (ausência gera novo identificador). Recibo `menu_import_confirmed` no platform_audit guarda hash do conteúdo normalizado, IDs criados, quantidades e destino; não guarda arquivo nem nomes/descrições dos produtos. Bloqueios serializam confirmações concorrentes. Mesmo administrador + loja + identificador + conteúdo retorna 200/replayed=true; conteúdo diferente para recibo existente retorna 409. Confirmação inicial retorna 201. Não apagar esses recibos de auditoria se precisar preservar a garantia de repetição; a deduplicação é vinculada ao mesmo administrador e loja.

O middleware de tenant normal não é enfraquecido: somente o namespace global explícito `/api/admin/menu` aceita escolher uma empresa. APIs `/api/tenant/menu` continuam extraindo o tenant exclusivamente do JWT de lojista.

Limites de extração compartilham o gate por instância de aplicação entre rotas tenant e Master (duas extrações simultâneas, uma por tenant/administrador e cinco tentativas em 15 minutos). Não há chamada paga nos testes: o provedor é simulado.

## Verificação e publicação

Testes locais de rotas e DOM cobrem escolha da loja, upload multipart, preview, edição de preço, bloqueio de campos, conteúdo não interpretado como HTML, nova tentativa, escopo e rollback. A validação MySQL e o ensaio na cópia verificam escritas/auditoria/repetição reais e rollback de uma falha de auditoria com engine simulada. O canário verifica autenticação, menu e assets. A conferência visual em navegador e extração real dependem da publicação e da configuração do provedor.
