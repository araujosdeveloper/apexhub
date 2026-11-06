# Layout global ApexHub

Publicado em 05/11/2026 às 03:30 UTC. STATUS=PUBLICADO confirmado em `reports/update-20261105T032936Z-3481760`; backup final `backups/live/live-20261105T033048Z-3486429`. Conferência visual pelo responsável ainda pendente. Unifica as 14 páginas internas, sem migração ou alteração de dados existentes.

## Shell persistente

Sidebar fixa #121212 com marca ApexHub e navegação completa: Dashboard, Gestão de Pedidos / Ativos / Histórico, Cozinha (KDS), Cardápio, Clientes, Entregadores, Cupons, Relatórios, Financeiro, Configurações, Avaliações e Equipe. Permissões continuam sendo aplicadas: operador acessa operação; dados gerenciais exigem dono/gerente; equipe exige dono.

Header permanece no contêiner fixo com título/breadcrumb, busca, estabelecimento real da sessão, notificações de pedidos aguardando aceite e perfil/saída. O título permanece visível também em tablet/celular. Menu móvel usa drawer e backdrop. A seleção de estabelecimento não simula unidades adicionais ao suporte atual da plataforma.

A navegação interna usa History API e mantém o mesmo DOM da sidebar/header. Voltar/Avançar e links profundos continuam funcionando. O conteúdo usa um iframe do mesmo domínio, substituído por `location.replace`, sem criar entradas extras de histórico do iframe. Isso conserva o contexto dos scripts/formulários existentes e permite ao navegador encerrar timers, SSE e recursos da página anterior ao trocar de módulo.

O middleware serve `app-shell.html` para rotas administrativas diretas. O iframe solicita a view original com `view=1`; navegações de iframe também são identificadas pelo cabeçalho Sec-Fetch-Dest. Um identificador de navegação interno impede que um carregamento antigo substitua a rota atual. Esses parâmetros não aparecem no endereço principal.

`frame-bridge.js` intercepta somente links internos conhecidos, sem afetar cliques modificados, links externos, novas abas ou downloads. Comunica navegação/expiração à janela principal. O shell aceita mensagens exclusivamente da origem atual e do seu iframe. URLs externas e rotas desconhecidas são recusadas. Login expirado ou troca de loja exigem autenticação novamente.

As páginas internas usam SAMEORIGIN e CSP `frame-ancestors 'self'` para permitir esse enquadramento. Login, loja pública e acompanhamento do cliente continuam com DENY e fora do shell. Nenhuma API privada teve permissões relaxadas.

## Tema e módulos

`dashboard.css` mantém os tokens e componentes visuais do dashboard aprovado. `app-shell.css` aplica a estrutura persistente. `admin-theme.css` é o módulo compartilhado de estilos escopados às views, com superfícies #1E1E1E, texto #F5F5F5/#B0B0B0, inputs escuros e ações #FF7F00. Os estilos locais preservam a geometria dos formulários; o tema sobrescreve a aparência antiga.

Pedidos/cozinha perderam o antigo header com marca e o menu horizontal. Som/atualização/conexão permanecem como ferramentas locais. Dashboard não renderiza outra sidebar/header dentro do conteúdo. Os demais módulos têm o mesmo fundo, cartões, campos e botões. Adicionais e destaques também fazem parte da unificação.

Gestão de Pedidos abre em Lista, com contadores, filtros, modalidades, valores, badges e ação de próxima etapa. Detalhes abre o snapshot completo, adicionais, endereço, cancelamento, acompanhamento e impressão. O botão Quadro restaura a apresentação por etapas. Cozinha mantém o quadro KDS e as ações de produção. Ambos continuam usando os mesmos endpoints e proteção contra conflitos.

A impressão continua no documento de conteúdo: o tema novo é aplicado somente a mídia screen e a comanda segue o CSS próprio de papel. Os clientes continuam usando o cardápio público e acompanhamento independentes.

## Financeiro

Nova view `finance.html` usa a API de relatórios existente. Mostra valores de pedidos concluídos, fretes, descontos, quantidade e formas de pagamento informadas, com período. Indica explicitamente que esses dados não são saldos bancários ou conciliação. Não cria contas a pagar/receber ou simula Pix/cartão confirmado. Permissões de relatório são preservadas.

## Arquivos principais

- `backend/src/app-shell.js`: lista permitida de rotas, template e cabeçalhos de enquadramento.
- `frontend/app-shell.html`, `app-shell.css`, `app-shell.js`: estrutura, roteamento, histórico e controles persistentes.
- `frontend/frame-bridge.js`: navegação/expiração entre view e shell.
- `frontend/admin-theme.css`: tema global das telas internas, escopado por classe.
- `frontend/finance.html`, `finance.js`: resumo financeiro somente de leitura.
- Demais HTMLs internos: inclusão do tema e ponte; gestor adaptado para Lista/Quadro.

Novas páginas internas devem ser registradas no middleware, roteador e ponte, incluir o tema e declarar sua classe de view. A lista permitida é intencional para evitar enquadrar URLs arbitrárias. Abrir uma nova aba ou atualizar o navegador recarrega o shell normalmente; trocar pelo menu não o recarrega. Ao sair de uma view, salve os formulários antes de navegar, como no fluxo anterior.

## Validação e publicação

235 testes locais aprovados, incluindo todas as rotas diretas e embutidas, isolamento de páginas públicas, cabeçalhos, persistência dos nós da estrutura, navegação/histórico, mensagens de origem indevida, resposta antiga, expiração, permissões, ponte, Financeiro, Lista/Quadro e fluxos anteriores.

O publicador foi ampliado para conferir, via HTTP real, todas as rotas do shell, suas views, os cabeçalhos e os assets. Os testes MySQL e ensaio existentes continuam sendo exigidos. Integração MySQL real aprovada em `reports/mysql-validation-20261105T032956Z-3483558.log`. 235 testes, ensaio da cópia, preservação dos dados, canário e verificações HTTP da aplicação ativa aprovados. Não há navegador instalado para renderização visual automatizada; conferência visual deve ocorrer após publicar.

Comando habitual no host: `bash /root/delivery-saas/scripts/update-live.sh`. Após sucesso, confirme desktop/celular, sidebar/header persistindo entre módulos, Ativos/Histórico, busca global, detalhes e ações do pedido, cozinha, upload de foto, formulários de entregador/cupom/configuração e impressão. Confirme que o operador não recebe acesso gerencial.

Preparado em 05/11/2026: tokens de marca/dimensões agora compartilhados com o Master por apex-tokens.css; sidebar/header alinhados, remoção física de navegação horizontal e fundos claros legados nas telas alvo, suporte ao banner/contexto de acesso assistido. A navegação persistente e o CSS de impressão foram preservados. Ver [acesso-assistido.md](acesso-assistido.md). Publicação e conferência visual desta atualização ainda pendentes.
