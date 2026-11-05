# Delivery SaaS

Plataforma de restaurantes por assinatura. A primeira entrega implementa cadastro, autenticação, separação entre restaurantes, gestão inicial de cardápio e pedidos. O plano técnico está em [docs/arquitetura.md](docs/arquitetura.md).

Escopo de evolução com referência funcional na Brendi, situação atual e critérios de entrega: [docs/escopo-produto.md](docs/escopo-produto.md).

Módulos publicados em 03/11/2026 às 20:18 UTC: horários, pausa, delivery/retirada e taxas por bairro. Uso e migração 004 em [docs/operacao-loja.md](docs/operacao-loja.md).

Adicionais por produto também publicados: grupos, limites de escolha, preços e histórico de combinações. Uso e migração 005 em [docs/adicionais-produtos.md](docs/adicionais-produtos.md). Integração MySQL real, ensaio da cópia, preservação dos dados e verificações HTTP aprovados; conferência visual dos módulos publicados confirmada pelo responsável.

[Gestor de pedidos e cozinha](docs/gestor-cozinha.md) publicados em 03/11/2026 às 20:42 UTC, com eventos ao vivo, filtros, prazos e impressão manual. Os 111 testes, a integração MySQL/SSE HTTP real, o ensaio da cópia e as verificações HTTP foram aprovados. Sem nova migração; funcionamento testado e aprovado pelo responsável.

[Cupons e promoções](docs/cupons.md) publicados em 04/11/2026 às 03:19 UTC, com valores fixos, percentuais, frete grátis, validade e limites. Migração 006 aplicada com dados anteriores preservados; 124 testes e integração MySQL aprovados. Conferência visual desta entrega ainda pendente. Automação de atendimento/WhatsApp/IA fica para a última etapa, por decisão do responsável.

Para futuras atualizações do ambiente já ativo, executar no host `bash /root/delivery-saas/scripts/update-live.sh`. O procedimento testa a imagem, ensaia as migrações numa cópia atual, cria backup final e atualiza a aplicação. Detalhes e recuperação em [docs/atualizacao-producao.md](docs/atualizacao-producao.md). Não usar novamente o corte inicial.

## Desenvolvimento em banco novo

Requisitos: Node.js 22.8+ e MySQL 8.0.16+. A API e o frontend usam a mesma origem.

1. Crie um banco vazio `delivery_saas_db` com `utf8mb4` e um usuário `delivery_app` com acesso somente a esse banco. Use uma conta administrativa para executar, nesta ordem, `database/001-initial.sql` e `database/002-checkout-requests.sql`; a conta da aplicação precisa apenas de SELECT, INSERT, UPDATE e DELETE.
2. Em `backend`, copie `.env.example` para `.env` e preencha a senha e os dados do MySQL.
3. Execute:

```sh
cd backend
npm ci
npm run check
npm test
npm start
```

4. Acesse `http://localhost:3000/login.html`, cadastre o restaurante e entre em **Gerenciar cardápio**. Crie uma categoria e um produto. O link **Abrir minha loja** usa `/?loja=seu-slug`.
5. Faça um pedido e acompanhe no painel. A seleção de Pix/cartão registra somente a forma de pagamento; não processa pagamentos.

Para listar cada caso de teste neste ambiente: `node --test --test-reporter=tap test/*.test.js`. A suíte usa o pipeline do Express em memória e um banco simulado; não valida SQL em MySQL real.

## Banco que já contém dados

**Não aplique o SQL inicial como migração do banco atual.** `CREATE TABLE IF NOT EXISTS` não atualiza tabelas antigas. A nova API depende de users/sessions/subscriptions/checkout_requests e dos campos históricos em orders/order_items; o esquema anterior não está versionado no projeto.

Antes de trocar o processo em execução:

- Faça backup e restaure uma cópia para homologação.
- Execute `npm run db:inspect` em `backend` para obter um inventário somente de leitura; complemente o esquema com `SHOW CREATE TABLE` de companies, categories, products, customers, orders e order_items.
- Prepare a migração a partir dos tipos, índices e relacionamentos reais. Preencha os campos históricos dos pedidos antigos e associe os proprietários às lojas existentes com verificação de titularidade.
- Valide o fluxo completo com pelo menos dois restaurantes. Só então substitua a aplicação existente.

O código desta entrega foi alterado no workspace; nenhum banco ou processo em produção foi atualizado. O `docker-compose.yml` existente foi mantido para preservar o ambiente anterior. Suas credenciais de desenvolvimento e portas públicas precisam ser revistas antes de produção.

## Configuração e segurança

- Segredos ficam em `backend/.env`, ignorado pelo Git. Não use o usuário root na API.
- Em produção: HTTPS, `NODE_ENV=production` e `SECURE_COOKIES=true`. O servidor recusa iniciar produção com cookies inseguros.
- O proxy deve preservar o Host público; o backend não habilita confiança irrestrita em cabeçalhos de proxy.
- As rotas administrativas antigas por company_id e o token ADMIN_SECRET foram removidos. Agora é obrigatório autenticar por conta individual.
- A porta da API vem de PORT. A conectividade e os campos obrigatórios do banco são verificados antes de aceitar tráfego. `/api/health` verifica conectividade.

## Validação da entrega

A suíte cobre autenticação, isolamento entre restaurantes, permissões de catálogo, origem de requisição, preços no servidor, snapshots de entrega e reversão de transações. Os 28 testes locais passaram. A integração com MySQL real foi aprovada no host em 02/11/2026, com Node v22.23.4, conforme saída fornecida pelo usuário. Foram validados cadastro/sessões de duas lojas, catálogo, isolamento de dados, cálculo de preços e checkout concorrente sem duplicação. A limpeza do ambiente temporário terminou com código zero. Migração do banco existente e testes no navegador permanecem pendentes. Cobrança automática, controle de vencimento e integração oficial com WhatsApp ainda não estão implementados.

## Ambiente Docker separado do legado

Para uma máquina onde o Docker esteja autorizado:

```sh
cp docker.env.example .env.docker
# Preencha as duas senhas em .env.docker antes de continuar.
docker compose --env-file .env.docker -f compose.dev.yml up --build -d app
```

Acesse `http://localhost:3001/login.html`. Esse ambiente usa outro projeto e volume, não altera os containers nem os dados do Compose antigo. O MySQL não expõe porta ao host. Os scripts SQL são aplicados apenas na inicialização de um volume vazio; atualizar arquivos não migra volumes existentes. Não remova volumes para atualizar um banco com dados.

Para executar a integração real em MySQL temporário:

```sh
docker compose --env-file .env.docker -f compose.dev.yml --profile test run --build --rm integration
```

O teste cobre duas lojas, isolamento de catálogo/pedidos, preços no servidor e dois envios simultâneos com a mesma chave. O banco de teste é separado e temporário. Para limpar somente os serviços de teste, use `docker compose --env-file .env.docker -f compose.dev.yml --profile test rm --stop --force integration mysql-test`.

Alternativamente, `npm run test:mysql` em backend usa DB_HOST, DB_PORT, DB_USER, DB_PASSWORD e DB_NAME do ambiente. O banco deve terminar em `_test`; a conta precisa de permissão para criar as tabelas. O teste remove somente os registros que ele próprio criou, não apaga o banco. Não execute contra produção.

Neste workspace, o acesso ao socket `/var/run/docker.sock` é negado pelo ambiente de execução. Ser root dentro do ambiente não concede acesso ao serviço Docker do host. Nenhuma permissão do host foi modificada. A execução pelo terminal do host concluiu a integração MySQL e a limpeza com sucesso; o acesso direto ao Docker desta sessão continua restrito.

## Contrato de reenvio de pedidos

`POST /api/orders` exige o cabeçalho `Idempotency-Key`, de 16 a 80 caracteres ASCII (letras, números, `_` ou `-`). Gere uma chave por intenção de compra e mantenha a mesma chave em tentativas do mesmo pedido. Envio inicial retorna 201; repetição retorna 200 e `replayed: true`; a mesma chave com outros dados retorna 409. O namespace inclui a empresa. A gravação da chave e do pedido é atômica.

O frontend utiliza HTTPS ou localhost, preserva o carrinho na aba, permite alterar quantidades e remove os dados temporários após confirmação. O painel agora exibe os status em português e oferece somente as transições permitidas.

## Validação automatizada no terminal do servidor

Execute na raiz do projeto, em um terminal com acesso autorizado ao serviço Docker:

```sh
bash scripts/validate-mysql.sh
```

O script verifica o Docker antes de iniciar qualquer container. Se disponível, gera credenciais temporárias, cria um projeto exclusivo, constrói a imagem, inicializa um MySQL de teste em memória e executa a integração. Ao terminar, remove os serviços desse projeto e o arquivo de credenciais. Não inicia a aplicação de desenvolvimento nem usa volumes do banco legado. Não migra nem valida os dados do banco legado.

O resultado fica em `reports/mysql-validation-*.log`. `APROVADO` significa que a integração executou contra MySQL real e a limpeza terminou; qualquer falha produz código diferente de zero. A imagem construída pode permanecer no cache local do Docker. Se a sessão for encerrada abruptamente antes da limpeza, o nome exclusivo do projeto aparece no relatório para identificação dos serviços restantes.

Se o teste disser `BLOQUEADO`, o acesso ao Docker precisa ser resolvido no terminal/ambiente do host por quem o administra. O script não altera permissões do socket nem configurações do host.

Evidência da integração aprovada: relatório do host `reports/mysql-validation-20261102T182723Z-73527.log`, execução fornecida pelo usuário. O teste terminou com `pass 1`, `fail 0`, sem casos ignorados, e o script retornou `APROVADO`. A aprovação cobre a suíte de integração em banco temporário novo; não comprova migração de dados legados, inicialização do servidor HTTP ou experiência no navegador.

## Inventário e backup do banco existente

O próximo passo da migração está em [docs/migracao-legado.md](docs/migracao-legado.md). No terminal do host:

```sh
bash scripts/inventory-legacy.sh
```

O script usa o container legado `saas_mysql`, cria um dump privado e um inventário, verifica gzip/checksums e faz auditorias por contagem. Ao final, imprime o comando para exibir `migration-plan.json` e `audit.tsv`. Esses relatórios podem ser usados para planejar a migração; mantenha o dump completo privado. Não há aplicação de SQL de migração nem restauração automática nesta etapa.

Para restaurar e ensaiar a migração específica do backup já inventariado, sem alterar o banco atual:

```sh
bash scripts/rehearse-migration.sh backups/legacy-20261102T183428Z-75137
```

O ensaio confere os registros originais por hashes e testa a aplicação via HTTP real na cópia. O procedimento e suas limitações estão em [docs/migracao-legado.md](docs/migracao-legado.md). Não execute o SQL de migração manualmente no banco existente.


O ensaio do backup legado foi aprovado no host em 02/11/2026 (execução
`20261102T190312Z-77403`): restauração, migração na cópia, preservação dos
registros originais e testes HTTP concluídos; ambiente temporário removido.
Dois pedidos antigos sem itens foram preservados e exigem interpretação como
histórico incompleto. Produção não foi alterada. A associação do proprietário
real, o plano de corte/retorno e a validação no navegador continuam pendentes.


## Publicação de 03/11/2026

Loja publicada no host: https://179.198.120.188/?loja=cachorro-quente-bebella
Painel: https://179.198.120.188/login.html
Ambiente real: `delivery-live-20261103t025846z-321081`, com MySQL persistente separado.
O banco antigo foi preservado somente para leitura; não reabrir suas gravações.
O backup final da origem não protege os novos pedidos; configurar backups do
banco real. Validação pública final e operação estão em [docs/publicacao.md](docs/publicacao.md).


Backups do banco publicado: procedimento de instalação, horários, retenção e
verificação em [docs/backups-producao.md](docs/backups-producao.md). Os scripts
estão preparados; o agendamento só deve ser considerado instalado após a saída
de sucesso do instalador no host. Cópia externa ainda não configurada.


Backups automáticos confirmados no host em 03/11/2026: diário às 04:15 UTC,
retenção de 30 cópias e restauração semanal aos domingos às 05:00 UTC.
Primeiro backup e restauração das 12 tabelas aprovados; ambos timers ativos.
As cópias ficam na própria VPS; armazenamento externo ainda não configurado.


Cópia externa no Google Drive configurada em 03/11/2026 às 17:45 UTC, conforme
saída do host: primeiro backup criptografado enviado e verificado por download
e descriptografia; envio automático acionado após sucesso do backup diário.
Procedimento em [docs/backups-google-drive.md](docs/backups-google-drive.md).
O responsável confirmou a guarda das chaves no computador, fora da VPS.
A primeira execução automática futura ainda precisa ser acompanhada.


Monitoramento instalado no host em 03/11/2026 às 18:06 UTC: timer ativo a cada
cinco minutos, primeira checagem de HTTPS/API e backups local/Drive aprovada.
Sem notificações externas. Consulta e limites em [docs/monitoramento.md](docs/monitoramento.md).

Clientes e histórico de compras publicados em 04/11/2026: [funcionamento e critérios dos indicadores](docs/clientes.md). Donos e gerentes acessam pelo menu Clientes do gestor; a entrega não inclui disparos ou automação de WhatsApp.

Publicado em 04/11/2026: [entregadores e despacho](docs/entregadores.md), com cadastro, vinculação de pedidos e link de rota. Migração 007 e integração MySQL real aprovadas pelo atualizador habitual.

Publicado em 04/11/2026: [relatórios de vendas](docs/relatorios-vendas.md), com resumo, série diária, pagamentos, modalidades e produtos por período no fuso da loja. Publicação e integração MySQL real confirmadas, sem nova migração.

Publicado em 04/11/2026: [equipe e permissões](docs/equipe.md), com cadastro de gerentes/operadores pelo dono, bloqueio, redefinição de senha e encerramento de sessões. Publicação e integração MySQL real confirmadas, sem nova migração.

Publicado em 04/11/2026: [destaques e sugestões de acompanhamentos](docs/destaques-sugestoes.md), com produtos populares e ofertas opcionais no carrinho/checkout. Publicação, migração 008 e integração MySQL real confirmadas pelo atualizador habitual.

Imagens de produtos publicadas em 04/11/2026: [envio, prévia e exibição em todas as categorias](docs/imagens-produtos.md). JPG/PNG/WebP até 2 MB, com persistência no banco e inclusão nos backups. Migração 009 e integração MySQL real aprovadas pelo atualizador habitual.

Publicado em 04/11/2026: [acompanhamento do pedido pelo cliente](docs/acompanhamento-pedido.md), com link exclusivo sem cadastro, situação atual, previsão inicial e itens/valores. Publicação, migração 010 e integração MySQL real confirmadas pelo atualizador habitual.

Publicado em 04/11/2026: [avaliações de satisfação](docs/avaliacoes.md), com nota/comentário pelo acompanhamento após conclusão e painel da loja. Publicação, migração 011 e integração MySQL real confirmadas pelo atualizador habitual.

Dashboard ApexHub publicado em 04/11/2026: [design, arquivos e critérios dos indicadores](docs/dashboard-apexhub.md). Paleta escura/laranja, KPIs reais, gráficos, busca, últimos pedidos e KDS. Sem nova migração; login de dono/gerente abre `/dashboard.html`.

Layout global ApexHub publicado em 05/11/2026: [App Shell persistente e tema compartilhado em todas as telas internas](docs/layout-global-apexhub.md). Sidebar/header mantidos na navegação, Pedidos em Lista/Quadro e Financeiro com resumo dos relatórios existentes. Sem migração.

[Master ApexHub](docs/master-apexhub.md) implementado e preparado para publicação: painel exclusivo para administradores da plataforma, métricas globais reais, busca/edição/suspensão de empresas e auditoria. Migração 012 aditiva; primeira conta criada por `scripts/create-master.sh` após a atualização. 246 testes locais aprovados. Publicação, MySQL real e conferência visual pendentes; gateway, Docker e acesso assistido aparecem como integrações pendentes.

Master ApexHub publicado em 05/11/2026 às 18:06 UTC. STATUS=PUBLICADO e ponteiro latest-update confirmados em `reports/update-20261105T180428Z-216080`; backup final `backups/live/live-20261105T180606Z-221182`. Integração MySQL real aprovada em `reports/mysql-validation-20261105T180459Z-218120.log`. Migração 012, ensaio da cópia, preservação dos dados anteriores, canário e verificações HTTP aprovados. Criação da conta Master e conferência visual pelo responsável ainda não confirmadas.

[JWT, RBAC e isolamento multi-tenant](docs/autenticacao-rbac.md) implementados e preparados para atualização: middlewares centrais, `super_admin`/`tenant_owner`/`tenant_manager`/`tenant_operator`, `req.tenantId` imutável e tokens de 15 minutos vinculados às sessões revogáveis. Coluna `company_id` preservada; sem nova migração. O atualizador configura chaves privadas persistentes automaticamente. Publicação e MySQL real desta entrega ainda pendentes.
