# Dashboard Apex Delivery

Publicado em 04/11/2026 às 20:45 UTC, conforme a direção visual solicitada. STATUS=PUBLICADO confirmado em `reports/update-20261104T204408Z-3046376`; backup final `backups/live/live-20261104T204529Z-3051123`. Conferência visual pelo responsável ainda pendente. Não exige migração ou altera registros existentes.

## Arquivos e direção visual

- `frontend/dashboard.html`: estrutura HTML5 semântica, símbolos SVG locais, navegação, header, KPIs, gráficos, tabela e KDS.
- `frontend/dashboard.css`: tokens da paleta, componentes, estados e breakpoints de desktop/tablet/celular.
- `frontend/dashboard.js`: acesso à API, renderização, SVG/donut, busca, notificações, perfil, menu móvel e atualização.
- `backend/src/dashboard.js`: endpoints de indicadores e pesquisa rápida, instalados na API existente.

Fundo #121212, sidebar #161616, superfícies #1E1E1E, primária #FF7F00, textos #F5F5F5/#B0B0B0, sucesso #00E676 e alerta #FF5252. Tipografia Inter com fallback para fontes sans-serif do sistema; nenhuma fonte ou biblioteca externa é necessária. Ícone Apex Delivery em SVG, avatar com iniciais reais, foco visível, atalhos de teclado, preferência de movimento reduzido e transições de 200 ms.

Sidebar fixa e rolável em desktop, drawer com backdrop em celular. Conteúdo usa Grid/Flex, cartões em quatro/duas colunas, gráficos e painéis que empilham nas telas menores. Tabelas têm rolagem horizontal em telas estreitas. O gráfico SVG ajusta a largura ao contêiner e mantém tabela diária acessível com os valores.

## Dados e interpretação

O dashboard fica em `/dashboard.html`. Login de dono/gerente passa a abrir essa página; operadores continuam no gestor. APIs financeiras/busca são restritas a dono/gerente e usam a loja da sessão. Os módulos existentes mantêm suas páginas e comportamento, com link de retorno ao dashboard nos menus de pedidos/cozinha.

Pedidos Hoje conta todos os recebidos no dia civil da loja, incluindo cancelados. Receita Bruta soma total + desconto apenas de pedidos atualmente concluídos recebidos no período: inclui frete, antes dos descontos e não comprova pagamento. Valores legados incompletos são excluídos da soma e sinalizados. O gráfico semanal mostra os últimos sete dias no mesmo fuso, alternando receita e quantidade de pedidos.

Tempo Médio permanece “— / Tempo real ainda não medido”, porque o banco não grava timestamps de transições. O cliente já aceita `average_minutes` para uma integração futura com medição real; não usa prazo estimado como tempo efetivamente medido.

Avaliação Média considera avaliações recebidas hoje (pela data da avaliação), da mesma loja. Sem avaliações, mostra “—”. Não apresenta estrelas ou valores simulados como dados reais.

A rosca de Origem distingue Cardápio digital (pedido associado a checkout_requests da loja) de Outros registros (inclui legado). Há explicação visível: WhatsApp/iFood não têm classificação separada no banco atual. Pedidos reenviados não duplicam a contagem, pois a classificação usa IDs distintos.

Últimos Pedidos mostra oito pedidos mais recentes, com cliente, modalidade, valor e situação. Os links abrem o pedido com busca e filtro apropriado, inclusive concluídos/cancelados. KDS resume todos os pedidos em andamento, independente do dia, por novos/preparo/prontos/em entrega, com atalhos para as filas e cozinha.

## Interações

Busca rápida consulta pedidos por número/nome, clientes por nome/telefone e produtos por nome, com até quatro resultados por grupo. Respeita a loja da sessão, trata curingas como texto e descarta respostas antigas. Atalho `/` foca o campo; Escape fecha menus/resultados. Produtos abrem diretamente na edição; clientes abrem o histórico; pedidos abrem o gestor filtrado.

O seletor mostra o estabelecimento real vinculado à sessão. Não simula unidades adicionais nem oferece troca entre franquias que ainda não possuem suporte no backend.

Notificações mostram pedidos aguardando aceite, sem fingir uma caixa de mensagens ou histórico de notificações lidas. Perfil apresenta nome/e-mail/perfil reais, configurações, equipe para donos e saída de sessão. Abrir loja usa o slug real. Botão Atualizar e os menus operam de fato.

Eventos SSE do gestor invalidam os dados ao mudar pedidos; polling visível a cada 30 segundos serve de fallback e atualiza as demais métricas. Esconder a aba pausa o stream; voltar reconecta. Revogação/expiração da sessão ou troca de loja ocultam dados e exigem login. Falhas mantêm o último snapshot com aviso e horário confirmado.

## API e validação

GET `/api/admin/dashboard` devolve série diária, KPIs, origens, fila, últimos pedidos, fuso e disponibilidade em uma transação de leitura. GET `/api/admin/dashboard/search?q=texto` devolve resultados com links locais. Respostas usam `Cache-Control: no-store`. Não há criação de pedidos, medições inventadas ou escritas de configuração nessa consulta.

223 testes locais aprovados, incluindo permissões, isolamento, leitura consistente, receita antes dos descontos, pesquisa, campos escapados, troca de métrica, drawer, notificações, falhas, sessões e eventos. Integração MySQL ampliada para indicadores, origem, busca e separação de lojas; smoke da cópia também verifica o dashboard. Sintaxe válida. Não há navegador instalado nesta sessão para conferência visual automatizada; essa conferência permanece pendente.

Integração MySQL real aprovada em `reports/mysql-validation-20261104T204435Z-3048213.log`, incluindo indicadores, receita bruta, origem, busca e isolamento. 223 testes aprovados; ensaio da cópia, preservação dos dados, canário e aplicação ativa aprovados pelo atualizador. Após publicar, entre como dono/gerente e confira desktop/celular, busca, gráficos, atalhos e atualização ao mudar pedidos no gestor. Confirme que operador continua no gestor e não acessa a visão financeira.
