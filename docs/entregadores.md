# Entregadores e despacho

Publicado em 04/11/2026 às 15:23 UTC. Relatório `reports/update-20261104T152209Z-2655442/STATUS.txt` confirma PUBLICADO; backup final `backups/live/live-20261104T152300Z-2659257`. Conferência visual concluída e aprovada pelo responsável em 04/11/2026. Migração `007-delivery-drivers.sql`: duas novas tabelas; nenhum pedido ou cliente existente é alterado. Tipos de IDs de empresa e pedido são obtidos do esquema real, incluindo instalações com INT assinado. Novas instalações têm o mesmo esquema em `001-initial.sql`.

Acesse **Entregadores** no gestor ou na cozinha (`/drivers.html`). Donos e gerentes cadastram e editam nome, telefone brasileiro com DDD e disponibilidade. Telefone normalizado é único por loja; a mesma pessoa pode atender lojas diferentes. Cadastros são desativados, sem exclusão de vínculos históricos. Alterações com versão antiga retornam conflito.

Todos os perfis autenticados da loja, incluindo operadores, podem consultar a frota e vincular/remover entregador de pedidos delivery em preparo ou prontos. A tela lista 50 pedidos por página, do mais antigo ao mais recente, incluindo os que estão em entrega. Atualize pelo botão para obter a lista atual; validações do servidor impedem gravar escolhas feitas sobre versões antigas.

Escolher entregador não altera a etapa do pedido. Marcar pronto, sair para entrega, concluir ou cancelar continuam no gestor. Pedidos de retirada, novos, concluídos, cancelados ou já em entrega não aceitam alteração de vínculo. O sistema continua permitindo entregar sem frota cadastrada, preservando o fluxo existente.

A API bloqueia o pedido durante a transação e compara etapa e versão do vínculo. Entregadores precisam estar ativos na mesma loja. Nome e telefone são preservados no vínculo para que a edição posterior do cadastro não altere o registro usado no pedido. A troca explícita de entregador substitui esse registro; não há histórico de todas as trocas. O gestor e a impressão manual exibem os dados preservados, inclusive após conclusão.

A rota usa o endereço registrado no pedido e abre o Google Maps. A loja deve conferir o destino no mapa: endereços sem cidade ou coordenadas podem ser ambíguos. Não há rastreamento em tempo real, geocodificação própria ou otimização de várias entregas nesta versão. O formato segue a [documentação oficial de Maps URLs](https://developers.google.com/maps/documentation/urls/get-started).

Endpoints autenticados: GET/POST `/api/admin/drivers`, PUT `/api/admin/drivers/:id`, GET `/api/admin/dispatch?offset=0`, PUT `/api/admin/dispatch/:id`. Cadastro restrito a dono/gerente; consulta e despacho disponíveis aos operadores. Empresa vem da sessão. Respostas usam `Cache-Control: no-store`.

Validação local: 144 testes e seis testes simulados do publicador aprovados, incluindo permissões, isolamento das consultas, conflito, rollback, remoção de vínculo, tratamento da tela e codificação de rota. Integração MySQL preparada para concorrência real, isolamento, retirada, desativação, snapshot e bloqueio durante entrega. DDL ensaiado pelo atualizador em estruturas com IDs assinados e não assinados; smoke sobre cópia ampliado. Integração MySQL real aprovada em `reports/mysql-validation-20261104T152225Z-2656699.log`, incluindo concorrência, isolamento, snapshots, bloqueio durante entrega e migrações 004/005/006/007 com IDs assinados e não assinados. Ensaio da cópia, preservação dos dados, canário e aplicação ativa aprovados.

Publicação autorizada pelo responsável, comando habitual: `bash /root/delivery-saas/scripts/update-live.sh`. O atualizador valida candidata, MySQL e cópia restaurada antes de aplicar a migração no banco real e abrir o tráfego. Não executar a migração isoladamente.

Após publicar, cadastre um entregador, vincule a um pedido delivery em preparo/pronto, confira o nome no gestor e na impressão e abra a rota. Ao marcar em entrega, a troca deve ficar bloqueada. Desativar entregador deve impedir novas vinculações e preservar vínculos existentes.

Envio de dados via WhatsApp e demais automações continuam para a última etapa, conforme decisão do responsável.
