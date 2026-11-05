# Atualizar a loja já publicada

O responsável autorizou publicar as próximas entregas sem nova confirmação, após as validações necessárias. Quando a sessão não tiver acesso ao servidor/Docker, executar manualmente no terminal do host:

```sh
bash /root/delivery-saas/scripts/update-live.sh
```

O mesmo comando está em `comando-atualizar-loja.txt`. Deixar o terminal aberto até terminar. O procedimento atual inclui cupons e promoções, mantendo os módulos anteriores. Sobre o banco publicado, 004/005 são reconhecidas e não repetidas; a nova entrega aplica 006 após ensaio e backup final.

## Sequência

1. Confere a publicação indicada em `deploy/live-release.path`, a rota ativa, o HTTPS pelo proxy local e os containers da aplicação e do banco. Não usa `saas_mysql`, PM2, a prévia ou o corte original.
2. Guarda a imagem anterior, constrói uma candidata separada e executa sintaxe/testes nela. A imagem agora inclui os testes e fixtures necessários à integração.
3. Executa a integração MySQL em ambiente temporário separado, pelo script já existente `validate-mysql.sh`.
4. Inspeciona o esquema real, recusando migrações parciais. Gera backup online e restaura uma cópia descartável, sem portas públicas, em rede interna e usando a mesma imagem MySQL do banco publicado.
5. Na cópia, aplica somente 004/005/006 pendentes e compara hashes/contagens dos registros originais. Verifica as tabelas e testa cadastro, cardápio, configurações, adicionais, delivery, retirada, reenvio e pausa pela API. Os registros de teste existem apenas nessa cópia, que é removida ao final.
6. Valida a rota de manutenção, confirma HTTP 503 tanto para leitura quanto para envio de pedidos e para a aplicação atual. A partir daqui a loja fica temporariamente indisponível.
7. Gera um backup final com a aplicação parada. Bloqueia a execução concorrente de backups/restauração enquanto aplica DDL no banco real.
8. Aplica as mesmas migrações aditivas, confere UUID, preservação dos registros e CHECK TABLE. Testa uma instância candidata com o usuário real da aplicação antes de recriar o serviço.
9. Inicia a aplicação atualizada e testa health, exigência de autenticação, páginas novas e cardápio. Promove a imagem para a referência usada pelo gerenciamento original, preservando a imagem anterior separadamente.
10. Reabre a rota, confere HTTPS, cardápio e páginas pelo Caddy local e grava `PUBLICADO` no relatório. O volume e as credenciais do banco publicado permanecem os mesmos.

O banco legado continua somente para leitura. Nenhum backup é restaurado sobre o banco publicado durante o procedimento. O dump de ensaio/final contém dados privados e fica nas pastas de backup já protegidas; relatórios de migração contêm apenas metadados, contagens e hashes.

## Resultado e falhas

O relatório fica em `reports/update-DATA-ID/`, incluindo `update.log`, imagem anterior, rota anterior, localização dos backups e resultados de migração/ensaio. O caminho da última atualização concluída é registrado em `deploy/latest-update.path`.

- **PUBLICADO:** atualização e verificações HTTP concluídas. Abrir a loja e o painel no navegador para conferir a apresentação e testar as configurações desejadas.
- **FALHOU_ANTES_DA_MANUTENCAO:** a loja não foi parada. Enviar a saída para corrigir a causa.
- **RETORNOU_VERSAO_ANTERIOR:** falhou antes da reabertura; a imagem e a rota anteriores foram restabelecidas. As adições de esquema permanecem. Não restaurar um dump antigo nem repetir migrações manualmente.
- **RECUPERACAO_PENDENTE:** não foi possível confirmar a recuperação da aplicação/rota. Inspecionar o relatório antes de reabrir tráfego.
- **VERIFICAR:** a reabertura foi tentada; podem existir pedidos na versão nova. Não há rollback automático de aplicação/banco nessa fase. Preservar o estado e diagnosticar antes de decidir retorno.

Não repetir o comando após uma falha sem analisar a saída. Uma falha no meio de DDL pode deixar migração parcial; a próxima execução a recusa. Não usar `publish-release.sh` para atualizar a loja existente, nem remover volumes.

## Limites de validação

Nesta sessão, Docker e rede do host estão bloqueados. A primeira execução real foi concluída pelo responsável no host em 03/11/2026 às 20:18 UTC; veja o registro abaixo. Sintaxe, configuração do Compose e 13 arquivos de testes locais foram aprovados. Seis testes do fluxo com Docker/rede simulados cobrem bloqueio de acesso, falhas antes da manutenção, manutenção não confirmada, backup/migração/canário/inicialização, falha após reabrir tráfego e sucesso.

Esses testes não substituem MySQL/Docker reais nem validação visual no navegador. O comando acima executará a integração e o ensaio reais no host antes da manutenção. Os testes HTTP de HTTPS usam o endereço público com resolução para loopback; não comprovam acesso a partir de uma rede externa.

Antes de considerar novos módulos em produção, exigir a saída `ATUALIZAÇÃO PUBLICADA` e confirmar o resultado no navegador. A autorização para publicar permanece válida; um bloqueio técnico deve gerar um procedimento manual, sem pedir autorização novamente.

## Correção da tentativa de 03/11/2026 às 20:06 UTC

O relatório `update-20261103T200620Z-1413310` registrou `FALHOU_ANTES_DA_MANUTENCAO`. A suíte da candidata foi interrompida por EACCES ao ler a fixture `legacy-inventory.json`, copiada como root:root com modo 0600 para uma imagem executada como node. A aplicação não foi parada e nenhuma migração foi aplicada.

O Dockerfile foi corrigido com `COPY --chown=node:node backend/test ./test`; o arquivo no host continua privado. Os testes locais passaram. A validação no container será repetida antes da manutenção; é possível retomar com o mesmo comando de atualização após essa correção.

## Atualização concluída em 03/11/2026 às 20:18 UTC

O responsável informou `ATUALIZAÇÃO PUBLICADA` e os artefatos locais confirmam `PUBLICADO` em `reports/update-20261103T201720Z-1426258/STATUS.txt`.

- Imagem: `delivery-saas-update:20261103t201720z-1426258`.
- Backup final: `backups/live/live-20261103T201827Z-1430227`.
- Integração MySQL real aprovada: `reports/mysql-validation-20261103T201735Z-1427325.log`.
- Candidata: 94 testes aprovados, zero falhas, Node v22.23.4.
- Ensaio na cópia: migrações 004/005 e smoke da API aprovados.
- Banco real: 004/005 aplicadas; hashes dos registros originais preservados e 14 tabelas verificadas.
- Canário e aplicação ativa: health, autenticação exigida, páginas e cardápio aprovados. HTTPS pelo proxy local aprovado.

Não repetir esta atualização sem novas mudanças ou motivo de diagnóstico. O responsável confirmou posteriormente o funcionamento visual geral dessa publicação. A entrega seguinte, gestor/cozinha, ainda aguarda publicação e sua própria validação visual.

## Gestor/cozinha publicados em 03/11/2026 às 20:42 UTC

Confirmação do responsável e `reports/update-20261103T204107Z-1457501/STATUS.txt` = `PUBLICADO`. Backup final: `backups/live/live-20261103T204205Z-1461315`.

A candidata aprovou 111 testes. A integração real `reports/mysql-validation-20261103T204123Z-1458648.log` aprovou SSE via HTTP, filtros, isolamento e conflitos entre operadores, além dos módulos anteriores. Ensaio e verificação no banco real não aplicaram DDL novo, preservaram registros originais e conferiram 14 tabelas. Canário, aplicação ativa e HTTPS pelo proxy local foram aprovados. A apresentação e o uso em duas abas no navegador desta entrega ainda precisam de confirmação.

## Cupons publicados em 04/11/2026 às 03:19 UTC

Responsável informou sucesso; `reports/update-20261104T031837Z-1881727/STATUS.txt` confirma `PUBLICADO`. Backup final: `backups/live/live-20261104T031933Z-1885520`.

A candidata aprovou 124 testes. Integração MySQL real aprovada em `reports/mysql-validation-20261104T031854Z-1882923.log`, incluindo limites concorrentes, normalização de telefone, primeira compra, frete grátis, percentual, histórico e isolamento. Ensaio da cópia e migração 006 real aprovados, com dados anteriores preservados e 15 tabelas verificadas. Canário, aplicação ativa e HTTPS pelo proxy local passaram. Conferência visual desta entrega ainda pendente.

### Clientes e histórico — preparado em 04/11/2026

A próxima execução de `bash /root/delivery-saas/scripts/update-live.sh` inclui o módulo [Clientes](clientes.md), mantém os módulos anteriores e não acrescenta migração. O atualizador roda 133 testes, integração MySQL ampliada, ensaio sobre cópia, backup e verificações HTTP antes de confirmar sucesso. Nesta sessão Docker permanece inacessível; publicação ainda pendente. Após publicar, abra Clientes no gestor e confira busca, filtros e histórico de um cliente. Operadores devem continuar sem acesso à base.

Clientes e histórico publicados em 04/11/2026 às 15:10 UTC: `reports/update-20261104T150856Z-2634647/STATUS.txt` confirma PUBLICADO. Backup final `backups/live/live-20261104T151013Z-2638867`. Integração MySQL real aprovada em `reports/mysql-validation-20261104T150920Z-2635991.log`; ensaio, preservação dos dados, canário e aplicação ativa aprovados. Conferência visual ainda pendente.

### Entregadores e despacho — preparado em 04/11/2026

Inclui `/drivers.html`, APIs de cadastro/consulta/vinculação, dados do entregador no gestor e na impressão e migração 007 com duas tabelas novas. O comando habitual de atualização executa os testes, ensaio da migração com IDs assinados/não assinados, smoke em cópia restaurada e backup antes de aplicar no banco real. Sem publicação confirmada nesta sessão: Docker inacessível. Detalhes e conferência visual em [entregadores.md](entregadores.md).

Entregadores e despacho publicados em 04/11/2026 às 15:23 UTC. STATUS=PUBLICADO em `reports/update-20261104T152209Z-2655442`; backup final `backups/live/live-20261104T152300Z-2659257`. 144 testes aprovados e integração MySQL real aprovada em `reports/mysql-validation-20261104T152225Z-2656699.log`, incluindo migração 007 para IDs assinados/não assinados. Preservação dos dados, canário e aplicação ativa aprovados. Conferência visual ainda pendente.

### Relatórios de vendas — preparado em 04/11/2026

Inclui `/reports.html`, `/reports.js` e API GET `/api/admin/reports/sales`, restrita a donos/gerentes. Período por data de criação no fuso da loja e situação atual; total considera concluídos. Sem migração ou reescrita de dados. 154 testes locais aprovados; integração MySQL e smoke em cópia ampliados. Docker bloqueado nesta sessão; publicação pendente pelo atualizador habitual. Detalhes e critérios em [relatorios-vendas.md](relatorios-vendas.md).

Relatórios de vendas publicados em 04/11/2026 às 15:37 UTC. STATUS=PUBLICADO e ponteiro latest-update confirmados em `reports/update-20261104T153641Z-2677267`; backup final `backups/live/live-20261104T153732Z-2681094`. 154 testes aprovados; integração MySQL real aprovada em `reports/mysql-validation-20261104T153657Z-2678624.log`, incluindo período/fuso, totais, pagamentos, produtos, dias vazios e isolamento. Ensaio, preservação dos dados, canário e aplicação ativa aprovados. Conferência visual ainda pendente.

### Equipe e permissões — preparado em 04/11/2026

Inclui `/team.html`, `/team.js` e APIs de gestão da equipe restritas ao dono. Usa tabelas existentes, sem migração. Edições revogam sessões; login revalida conta sob trava antes de emitir sessão para evitar disputa com bloqueio/troca de senha. 166 testes locais e seis simulações do publicador aprovados; integração MySQL e smoke da cópia ampliados. Docker inacessível nesta sessão; publicação e execução real pendentes pelo atualizador habitual. Detalhes em [equipe.md](equipe.md).

Equipe e permissões publicados em 04/11/2026 às 16:16 UTC. STATUS=PUBLICADO e ponteiro latest-update confirmados em `reports/update-20261104T161511Z-2724827`; backup final `backups/live/live-20261104T161625Z-2729176`. 166 testes aprovados; integração MySQL real aprovada em `reports/mysql-validation-20261104T161536Z-2726347.log`, incluindo permissões, proteção do dono, bloqueio, senha, sessões e concorrência. Ensaio, preservação dos dados, canário e aplicação ativa aprovados. Conferência visual ainda pendente.

### Destaques e sugestões — preparado em 04/11/2026

Inclui `/merchandising.html`, `/merchandising.js`, GET/PUT administrativo e vitrine/sugestões no cardápio. Migração 008 cria company_merchandising com tipo de empresa compatível; plano, inicial001 e ensaio atualizados. 180 testes locais e seis simulações do publicador aprovados. Integração MySQL e smoke da cópia ampliados. Docker inacessível nesta sessão; publicação e testes reais pendentes pelo atualizador habitual. Detalhes em [destaques-sugestoes.md](destaques-sugestoes.md).

Destaques e sugestões publicados em 04/11/2026 às 17:13 UTC. STATUS=PUBLICADO e ponteiro latest-update confirmados em `reports/update-20261104T171222Z-2792769`; backup final `backups/live/live-20261104T171329Z-2797110`. 180 testes aprovados; integração MySQL real aprovada em `reports/mysql-validation-20261104T171246Z-2794378.log`, incluindo popularidade, combinações, indisponibilidade, concorrência e isolamento. Migração 008, ensaio, preservação dos dados, canário e aplicação ativa aprovados. Conferência visual ainda pendente.

### Imagens dos produtos — preparado em 04/11/2026

Campo de arquivo e prévia no cadastro/edição, miniaturas administrativas e fotos no cardápio/destaques/sugestões. JPG/PNG/WebP até 2 MB. Migração 009 cria product_images com BLOB, tipo e digest. Bytes entram no backup MySQL existente; snapshots de preservação verificam BLOB por SHA2 no servidor para evitar consumo de memória proporcional às fotos. 193 testes locais aprovados; integração MySQL, DDL assinado/não assinado e smoke da cópia ampliados. Docker bloqueado: execução real e publicação pendentes pelo atualizador habitual. Detalhes em [imagens-produtos.md](imagens-produtos.md).

Imagens dos produtos publicadas em 04/11/2026 às 18:33 UTC. STATUS=PUBLICADO e ponteiro latest-update confirmados em `reports/update-20261104T183158Z-2883930`; backup final `backups/live/live-20261104T183310Z-2888314`. 193 testes aprovados; integração MySQL real aprovada em `reports/mysql-validation-20261104T183224Z-2885529.log`, incluindo upload, leitura binária, categorias pausadas, remoção e isolamento. Migração 009, ensaio, preservação dos dados, canário e aplicação ativa aprovados. Conferência visual ainda pendente.

### Acompanhamento do pedido — preparado em 04/11/2026

Checkout devolve link exclusivo e estável nos reenvios. Cliente consulta `/track.html#token` via API com token no header; situação atual, itens e valores, sem cadastro/endereço/telefone do cliente. Gestor pode gerar links para pedidos anteriores. Migração 010 cria order_tracking, adaptada ao tipo real dos IDs. 205 testes locais aprovados; integração MySQL e smoke da cópia ampliados. Docker bloqueado: execução real e publicação pendentes. Detalhes em [acompanhamento-pedido.md](acompanhamento-pedido.md).

Acompanhamento do pedido publicado em 04/11/2026 às 19:46 UTC. STATUS=PUBLICADO e ponteiro latest-update confirmados em `reports/update-20261104T194520Z-2967971`; backup final `backups/live/live-20261104T194631Z-2972451`. 205 testes aprovados; integração MySQL real aprovada em `reports/mysql-validation-20261104T194541Z-2969595.log`, incluindo checkout/reenvio, token privado, status, legado e isolamento. Migração 010, ensaio, preservação dos dados, canário e aplicação ativa aprovados. Conferência visual ainda pendente.

### Avaliações de satisfação — preparado em 04/11/2026

Formulário após conclusão em track.html, helper order-review.js e painel reviews.html/JS. GET/POST público autorizado por token, imutável e idempotente, e consulta administrativa restrita a dono/gerente. Migração 011 cria order_reviews com ID compatível e nota CHECK1–5. 214 testes locais aprovados; integração MySQL, ensaio de tipos e smoke da cópia ampliados. Docker bloqueado; publicação e execução real pendentes. Detalhes em [avaliacoes.md](avaliacoes.md).

Avaliações dos clientes publicadas em 04/11/2026 às 19:56 UTC. STATUS=PUBLICADO e ponteiro latest-update confirmados em `reports/update-20261104T195547Z-2985874`; backup final `backups/live/live-20261104T195646Z-2990142`. 214 testes aprovados; integração MySQL real aprovada em `reports/mysql-validation-20261104T195610Z-2987581.log`, incluindo conclusão, nota, idempotência, concorrência e isolamento. Migração 011, ensaio, preservação dos dados, canário e aplicação ativa aprovados. Conferência visual ainda pendente.

### Dashboard ApexHub — preparado em 04/11/2026

Nova página dashboard.html/CSS/JS com identidade ApexHub e API de indicadores/busca restrita a donos/gerentes. Login desses perfis passa a abrir dashboard; operador mantém gestor. Navegação filtrada aos módulos existentes, SSE + fallback, métricas no fuso da loja e sem valores demonstrativos. Sem migração ou alteração de registros. 223 testes locais aprovados; integração MySQL e smoke da cópia ampliados. Docker bloqueado e navegador indisponível; validação MySQL real, publicação e conferência visual pendentes. Detalhes em [dashboard-apexhub.md](dashboard-apexhub.md).

Dashboard ApexHub publicado em 04/11/2026 às 20:45 UTC. STATUS=PUBLICADO e ponteiro latest-update confirmados em `reports/update-20261104T204408Z-3046376`; backup final `backups/live/live-20261104T204529Z-3051123`. 223 testes aprovados; integração MySQL real aprovada em `reports/mysql-validation-20261104T204435Z-3048213.log`, incluindo indicadores, receita bruta, origem, busca e isolamento. Sem nova migração; ensaio, preservação dos dados, canário e aplicação ativa aprovados. Conferência visual ainda pendente.

### Layout global ApexHub — preparado em 05/11/2026

App Shell persistente para 14 telas, tema escuro compartilhado, navegação com histórico, view de Financeiro e Pedidos em Lista/Quadro. Sem migração. Páginas internas recebem SAMEORIGIN/CSP self para o iframe do mesmo domínio; páginas públicas mantêm DENY. Publicador confere todas as rotas/views/assets/cabeçalhos. 235 testes locais aprovados. Docker/navegador indisponíveis nesta sessão: MySQL real, publicação e conferência visual pendentes. Detalhes em [layout-global-apexhub.md](layout-global-apexhub.md).

Layout global ApexHub publicado em 05/11/2026 às 03:30 UTC. STATUS=PUBLICADO e latest-update confirmados em `reports/update-20261105T032936Z-3481760`; backup final `backups/live/live-20261105T033048Z-3486429`. 235 testes aprovados; integração MySQL real aprovada em `reports/mysql-validation-20261105T032956Z-3483558.log`. Sem migração; ensaio da cópia, dados preservados, canário e verificação HTTP de rotas/views/assets/cabeçalhos aprovados. Conferência visual ainda pendente.

## Preparado: Master ApexHub — 05/11/2026

Área `/master-login.html` → `/master.html` independente do lojista, seis seções, dados globais reais e gestão auditada de nome/identificador fiscal/status das empresas. Migração 012 cria quatro tabelas sem alterar registros existentes ou criar administradores. Conta inicial por `bash scripts/create-master.sh` após atualização bem-sucedida. 246 testes locais e seis simulações do publicador aprovados; sintaxe e Compose válidos. Integração MySQL, ensaio de tipos e smoke ampliados. Docker bloqueado nesta sessão; publicação, validação MySQL real e conferência visual pendentes. MRR/gateway/Docker/acesso assistido não integrados. Procedimento e limites em [master-apexhub.md](master-apexhub.md).

Master ApexHub publicado em 05/11/2026 às 18:06 UTC. STATUS=PUBLICADO e ponteiro latest-update confirmados em `reports/update-20261105T180428Z-216080`; backup final `backups/live/live-20261105T180606Z-221182`. Integração MySQL real aprovada em `reports/mysql-validation-20261105T180459Z-218120.log`. Migração 012, ensaio da cópia, preservação dos dados anteriores, canário e verificações HTTP aprovados. Criação da conta Master e conferência visual pelo responsável ainda não confirmadas.
