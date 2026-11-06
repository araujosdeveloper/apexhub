# Escopo do SaaS de delivery

Referência funcional fornecida pelo responsável em 03/11/2026: ferramentas e modo de operação semelhantes aos da Brendi, com produto e identidade próprios. Esta lista define o produto desejado; não constitui verificação independente das funcionalidades atuais da Brendi.

## Situação atual

Conferência no código: backend/src/app.js, backend/src/checkout.js, frontend/admin.html, frontend/catalog.html e database/001-initial.sql.

| Frente | Implementado | Falta entregar |
| --- | --- | --- |
| Atendimento | Número da loja e encaminhamento manual ao WhatsApp | Recepção automática, IA conversacional, texto/áudio/imagem/figurinha, respostas sobre a loja e envio automático do cardápio |
| Cardápio e checkout | Categorias, produtos, disponibilidade, compra sem conta, nome/telefone/endereço, preços calculados no servidor e proteção contra reenvio | Adicionais, delivery/retirada/mesa/comanda, popularidade, sugestões e cupons |
| Pagamentos | Registro da opção Pix, cartão ou dinheiro | Pix e cartões processados online, confirmação e conciliação |
| Pedidos e cozinha | Listagem com atualização periódica e transições de status | Atualização imediata, fluxo de cozinha, impressão automática e importação de cardápio do iFood |
| Estabelecimentos | Separação de dados por restaurante e perfis internos | Gestão de equipe na interface, múltiplas unidades por conta e permissões entre unidades |
| Logística | Endereço preservado no histórico do pedido | Horários, taxas por bairro/região e por distância, entregadores, despacho e links de navegação |
| Marketing e CRM | Dados básicos de clientes e pedidos armazenados | Histórico consultável, cashback, recuperação em 15/30/60 dias, satisfação, Pixel e Analytics |
| Administração SaaS | Cadastro, sessão e assinatura informativa | Administração da plataforma, planos, cobrança recorrente e regras de acesso por assinatura |

Atualização de implementação (03/11/2026): horários, abertura/pausa, delivery/retirada, previsões e taxas por bairro foram implementados localmente após o levantamento acima. Detalhes em [operacao-loja.md](operacao-loja.md). A tabela registra a base do levantamento. Operação e adicionais foram publicados em 03/11/2026 às 20:18 UTC, com integração MySQL real e preservação dos dados aprovadas; funcionamento visual confirmado pelo responsável.

Entrega seguinte: [adicionais de produtos](adicionais-produtos.md) implementados localmente, com grupos obrigatórios/opcionais, limites, preços e combinações no carrinho. Publicados na mesma atualização de operação.

Entrega atual publicada em 03/11/2026 às 20:42 UTC: [gestor de pedidos e cozinha](gestor-cozinha.md), com eventos SSE, filtros, tempos e impressão manual. Integração HTTP/MySQL ampliada aprovada; funcionamento testado e aprovado pelo responsável.

Decisão do responsável em 04/11/2026: deixar automação de atendimento, WhatsApp e IA para a última etapa. [Cupons e promoções](cupons.md) foram publicados em 04/11/2026 às 03:19 UTC, com migração e integração MySQL aprovadas; a conferência visual desta entrega ainda está pendente.

O encaminhamento atual ao WhatsApp não é um robô. Selecionar Pix/cartão não comprova pagamento. Isolar restaurantes não equivale a oferecer gestão integrada de franquias.

## Sequência de implementação

### 1. Operação e checkout

Entregar horários e abertura manual, modalidades delivery/retirada, áreas e taxas por bairro, previsão de atendimento e adicionais com limites de escolha. Introduzir mesa/comanda em seguida, com identificação e ciclo de fechamento próprios.

Critérios: validar disponibilidade e modalidade no servidor; exigir endereço somente para delivery; calcular frete e adicionais no servidor; preservar preços, escolhas, modalidade e frete no histórico; incluir esses dados na proteção contra reenvio; manter pedidos antigos legíveis. Entrega fora da área deve ter resposta explícita. Usar fuso horário configurado por restaurante.

### 2. Gestor de pedidos e cozinha

Entregar atualização imediata com reconexão, alerta de novos pedidos, filtros, tempos e ações por modalidade. Preparar impressão por estabelecimento e setor, com estado de fila e reimpressão explícita.

Critérios: nenhuma loja recebe eventos de outra; reconexão recupera pedidos; transições concorrentes não sobrescrevem estado; repetição de eventos não gera impressão duplicada. Validar impressão no equipamento real. Impressão silenciosa requer mecanismo local compatível, além da página web.

### 3. Pagamentos e promoções

Entregar Pix e cartão online por provedor, estados de pagamento separados do preparo, cupons de primeira compra, frete grátis, valor fixo e percentual. Adicionar ordenação por vendas e sugestões de acompanhamentos/bebidas/adicionais.

Critérios: webhook autenticado e idempotente confirma pagamento; retorno do navegador não confirma recebimento; validar valor e restaurante; prever expiração, cancelamento e estorno. Validar cupons, limites, arredondamento e concorrência no servidor. Registrar descontos no pedido e definir regra de combinação. Popularidade deve considerar pedidos válidos e período definido.

### 4. Logística

Entregar cadastro e disponibilidade de motoboys, vínculo ao pedido, envio dos dados por WhatsApp e links de Google Maps/Waze. Evoluir taxas para faixas de distância.

Critérios: entregador só acessa entregas autorizadas; reatribuição mantém histórico; falhas de envio aparecem no painel; endereço deve ser validado. Link de navegação simples e otimização de várias paradas são entregas distintas; a segunda depende de serviço e regras de roteirização.

### 5. CRM, fidelidade e marketing

Entregar histórico de compras por cliente, cashback, segmentos por 15/30/60 dias sem compra, campanhas de recuperação, pesquisa após entrega, Meta Pixel e Google Analytics.

Critérios: cashback usa lançamentos auditáveis, regras de validade e reversão em cancelamentos; concorrência não permite gastar o mesmo saldo duas vezes. Campanhas respeitam preferências e descadastro, sem mensagens duplicadas. Eventos de compra não se repetem após recarga e não expõem telefone ou endereço às ferramentas de análise.

### 6. Escala SaaS e integrações

Entregar gestão de equipe, conta com múltiplas unidades, alternância autorizada de estabelecimento, administração da plataforma e assinatura com cobrança recorrente. Importação do iFood deve permitir prévia, revisão e confirmação de categorias, produtos, fotos e preços antes de publicar.

Critérios: autorizar cada unidade no servidor; auditar alterações relevantes; webhooks de assinatura idempotentes; distinguir cobrança do SaaS e pagamento dos pedidos. Importação deve usar acesso ou formato autorizado, com mapeamento e tratamento de duplicatas. Não presumir que importar cardápio inclui receber pedidos do marketplace.

### 7. WhatsApp e IA — última etapa

Entregar conexão por estabelecimento, recebimento de eventos, histórico, transferência para atendente e envio automático de link. Depois, respostas baseadas no cardápio, horários, taxas e pagamentos reais, com interpretação de texto, áudio, imagem e figurinha.

Critérios: autenticar eventos do provedor; deduplicar mensagens; separar dados e credenciais por loja; tratar mídias indisponíveis; permitir intervenção humana; registrar falhas e tentativas. A IA consulta regras do servidor para preços e disponibilidade. Confirmar escopo de montagem de pedido dentro da conversa antes de implementá-lo; envio de link já faz parte do escopo.

## Dependências e regra de entrega

WhatsApp/IA, pagamentos, geocodificação/rotas, importação do iFood e rastreamento dependem de escolha de provedores e validação das APIs e condições atuais na implementação. Não simular uma integração como concluída.

Cada etapa deve entregar migração compatível com os dados existentes, API, interface e testes dos comportamentos críticos. Publicação exige validação em ambiente isolado e procedimento de retorno. O planejamento não altera o ambiente publicado.

Horários, delivery/retirada, taxas por bairro e adicionais já foram publicados. Gestor de pedidos/cozinha também publicado; impressão automática, mesa/comanda e demais recursos ainda seguem no escopo futuro. Os dados de operação também sustentam respostas corretas da futura IA.

Atualização de 04/11/2026: [clientes e histórico](clientes.md) publicados às 15:10 UTC, com busca, compras concluídas, recorrência, inatividade de 15/30/60 dias e histórico com itens, adicionais e cupons. Sem envio de mensagens ou nova migração. Integração MySQL real e publicação confirmadas pelo relatório `reports/update-20261104T150856Z-2634647`; conferência visual ainda pendente.

04/11/2026: funcionamento de clientes e histórico conferido e aprovado pelo responsável. Entrega [entregadores e despacho](entregadores.md) publicada às 15:23 UTC, com cadastro, disponibilidade, vínculo de pedido, preservação de nome/telefone e link de rota. Relatório `reports/update-20261104T152209Z-2655442` confirma publicação e integração MySQL; conferência visual pendente. Envio por WhatsApp permanece na etapa final de automação.

04/11/2026: entregadores e despacho conferidos e aprovados pelo responsável. Entrega [relatórios de vendas](relatorios-vendas.md) publicada às 15:37 UTC, com período no fuso da loja, resumo, vendas diárias, formas de pagamento, modalidades e produtos. Sem nova migração. Publicação e integração MySQL confirmadas pelo relatório `reports/update-20261104T153641Z-2677267`; conferência visual ainda pendente. Automação permanece para a última etapa.

04/11/2026: relatórios de vendas conferidos e aprovados pelo responsável. Entrega [equipe e permissões](equipe.md) publicada às 16:16 UTC, com acessos de gerente/operador administrados pelo dono, redefinição de senha, bloqueio e encerramento de sessões. Sem nova migração. Publicação e integração MySQL confirmadas pelo relatório `reports/update-20261104T161511Z-2724827`; conferência visual ainda pendente. Automação continua na última etapa.

04/11/2026: equipe e permissões conferidas e aprovadas pelo responsável. Entrega [destaques e sugestões](destaques-sugestoes.md) publicada às 17:13 UTC: popularidade em pedidos concluídos, destaque e ordenação dentro das categorias, combinações configuradas por produto e ofertas no carrinho/checkout. Migração 008 e integração MySQL aprovadas; publicação confirmada em `reports/update-20261104T171222Z-2792769`. Conferência visual ainda pendente. Automação de atendimento/WhatsApp/IA permanece para a última etapa.

04/11/2026: por solicitação do responsável, [fotos por produto](imagens-produtos.md) implementadas no cadastro/edição, em todas as categorias, com prévia, substituição, remoção e exibição no cardápio/destaques/sugestões. Migração 009 e integração MySQL aprovadas; publicação confirmada às 18:33 UTC em `reports/update-20261104T183158Z-2883930`. Conferência visual ainda pendente.

04/11/2026: fotos dos produtos conferidas pelo responsável. Entrega [acompanhamento do pedido](acompanhamento-pedido.md) publicada às 19:46 UTC: link exclusivo no checkout, consulta do cliente sem cadastro e geração de link pelo gestor para pedidos anteriores. Migração 010 e integração MySQL aprovadas; publicação confirmada em `reports/update-20261104T194520Z-2967971`. Conferência visual ainda pendente. Sem envio automático ou GPS; automação continua na última etapa.

04/11/2026: [avaliações de satisfação](avaliacoes.md) implementadas: nota 1–5 e comentário em pedido concluído pelo link exclusivo, uma avaliação por pedido, resumo/distribuição/filtro no painel para dono/gerente. Migração 011 e integração MySQL aprovadas; publicação confirmada às 19:56 UTC em `reports/update-20261104T195547Z-2985874`. Conferência visual ainda pendente. Sem convites automáticos; atendimento/WhatsApp/IA seguem para a última etapa.

04/11/2026: por solicitação do responsável, [dashboard ApexHub](dashboard-apexhub.md) implementado em dark mode carvão/laranja, com sidebar, header, busca, indicadores, gráfico semanal, origem, últimos pedidos e KDS. Integração com dados reais; tempo médio sem timestamps aparece como não medido. Sem migração. Publicação e integração MySQL confirmadas às 20:45 UTC em `reports/update-20261104T204408Z-3046376`; conferência visual ainda pendente. Demais construções funcionais ficam após esta entrega visual.

05/11/2026: por solicitação do responsável, [layout global ApexHub](layout-global-apexhub.md) implementado para todas as telas internas, removendo menu horizontal antigo e fundos claros da interface. Sidebar/header persistentes, views isoladas no mesmo domínio, Lista/Quadro em Pedidos e resumo Financeiro. Sem migração. Publicação e integração MySQL confirmadas às 03:30 UTC em `reports/update-20261105T032936Z-3481760`; conferência visual ainda pendente. Atendimento/WhatsApp/IA continuam na última etapa.

05/11/2026: [Master ApexHub](master-apexhub.md) implementado por solicitação do responsável: App Shell exclusivo, identidade escura/laranja, indicadores globais, gráfico de cadastros, busca/edição/suspensão de empresas, agrupamento de assinaturas e auditoria. Contas Master independentes, provisionamento privado e migração aditiva 012. MRR, gateway/repasses, Docker, conversão/uptime percentual e acesso como loja ficam explicitamente não integrados. 246 testes locais aprovados; publicação, MySQL real e conferência visual pendentes. Automação permanece para a última etapa.

Master ApexHub publicado em 05/11/2026 às 18:06 UTC. STATUS=PUBLICADO e ponteiro latest-update confirmados em `reports/update-20261105T180428Z-216080`; backup final `backups/live/live-20261105T180606Z-221182`. Integração MySQL real aprovada em `reports/mysql-validation-20261105T180459Z-218120.log`. Migração 012, ensaio da cópia, preservação dos dados anteriores, canário e verificações HTTP aprovados. Criação da conta Master e conferência visual pelo responsável ainda não confirmadas.

05/11/2026: [autenticação JWT, RBAC e escopo multi-tenant](autenticacao-rbac.md) implementados a pedido do responsável. Credenciais separadas Master/tenant, perfis canônicos, req.tenantId imutável e propagado aos módulos, autenticação padrão em /api/admin, políticas gerenciais centralizadas e revogação atrelada às sessões. Sem mudança de dados/DDL; compatibilidade dos cookies e gerentes existentes preservada. Publicação e execução MySQL real pendentes. Automação continua para a última etapa.

JWT, RBAC e isolamento multi-tenant publicados em 05/11/2026 às 19:04 UTC. STATUS=PUBLICADO e ponteiro latest-update confirmados em `reports/update-20261105T190222Z-288608`; backup final `backups/live/live-20261105T190408Z-293998`. Integração MySQL real aprovada em `reports/mysql-validation-20261105T190304Z-290916.log`, incluindo emissão JWT, claims, tenant, IDOR, perfis, revogação e suspensão. Ensaio da cópia, preservação dos dados, configuração das chaves, canário e verificações HTTP aprovados. Nenhuma migração SQL aplicada; dados anteriores preservados. Conferência manual dos logins pelo responsável ainda não confirmada.

05/11/2026: [API inicial Super Admin](api-super-admin.md) implementada: lista/cadastro de empresas, ativação/suspensão e métricas globais em quatro rotas reservadas de /api/admin. O restante do prefixo mantém o isolamento de lojistas. Autenticação Master e super_admin, envelope REST, transações/auditoria, revogação e logs seguros. MRR estimado somente com preços configurados; sem integração de cobrança ou automação. 284 testes locais aprovados, sem nova migração. Publicação e execução real MySQL pendentes.

API Super Admin publicada em 05/11/2026 às 20:25 UTC. STATUS=PUBLICADO e ponteiro latest-update confirmados em `reports/update-20261105T202338Z-384376`; backup final `backups/live/live-20261105T202528Z-389880`. Integração MySQL real aprovada em `reports/mysql-validation-20261105T202420Z-386763.log`: cadastro transacional, paginação, status, revogação, métricas e restrição de perfil. Ensaio da cópia, dados anteriores preservados, canário e verificações HTTP aprovados. Nenhuma migração SQL aplicada. Esta entrega é de backend; o painel mantém a interface existente.

05/11/2026: [acesso assistido e identidade visual compartilhada](acesso-assistido.md) implementados por solicitação do responsável. Master inicia sessão temporária tenant_owner com ator e auditoria; entrada usa fragmento, troca única por cookie HttpOnly e contexto por aba, sem JWT na query. Banner e encerramento explícitos; revogação por expiração, logout do Master e suspensão da loja. Tokens e geometria compartilhados, telas alvo sem menu horizontal e CSS claro legado, impressão preservada. Migração 013 aditiva. 301 testes locais e dez simulações aprovados; publicação/MySQL real e conferência visual pendentes. WhatsApp/IA continuam na última etapa.
