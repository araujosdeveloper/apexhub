# Gestor de pedidos e cozinha

Publicado em 03/11/2026 às 20:42 UTC. O responsável informou sucesso e o relatório `reports/update-20261103T204107Z-1457501/STATUS.txt` confirma `PUBLICADO`. Backup final: `backups/live/live-20261103T204205Z-1461315`.

## Telas

- `/admin.html`: gestor com colunas Novos, Em preparo, Prontos e Em entrega. Resumo por etapa, busca por número/nome/telefone, filtro de delivery/retirada e histórico de concluídos/cancelados.
- `/kitchen.html`: produção com Novos, Em preparo e Prontos, destacando quantidades e adicionais. A cozinha não exibe telefone, endereço, forma de pagamento ou total, e suas ações são aceitar/preparar e marcar pronto.
- As duas telas usam a sessão já existente. Cozinha é uma visualização de operação, não um novo perfil de acesso. Owner, manager e operator continuam com as permissões já definidas pela API. Links de catálogo/configurações ficam ocultos para operator.

Pedidos ativos aparecem do mais antigo ao mais novo, independentemente de quantos pedidos já foram encerrados. O histórico usa ordem inversa. A página mostra até 60 pedidos e oferece navegação; os filtros são aplicados no servidor antes da paginação. Os contadores superiores são o total por etapa da loja, independentemente da busca/modalidade selecionada. Cada coluna também informa quantos pedidos aparecem naquela página.

O tempo mostrado é desde o recebimento. “Prazo ultrapassado” compara esse tempo com a previsão registrada no pedido; não estima o tempo em cada etapa ou o prazo específico de preparo. Pedidos sem previsão não recebem alerta de atraso inventado. Datas são serializadas em UTC, e o relógio usa o horário informado pelo servidor.

Itens e escolhas dos adicionais são lidos do histórico do pedido. Registros antigos sem itens ficam sinalizados; a interface não oferece iniciar produção desses registros. No gestor, pedidos ativos sem itens ainda podem ser cancelados após conferência do responsável. Não houve alteração automática dos registros antigos.

## Atualizações e alertas

O navegador recebe eventos SSE autenticados em `/api/admin/orders/events`. Um pedido confirmado ou uma mudança de status bem-sucedida avisa somente os clientes do mesmo restaurante. O evento apenas sinaliza uma mudança; os dados são obtidos novamente pela API da sessão. Checkout repetido pela mesma chave não dispara novo aviso.

Há consulta automática a cada 10 segundos mesmo com SSE ativo. Ela recupera mudanças após falhas e alterações recebidas por outro processo. A sinalização imediata é local ao processo Node atual; uma implantação com vários processos exigirá um canal compartilhado para ter o mesmo alcance imediato entre instâncias. A consulta periódica continua funcionando nesse cenário.

Conexões SSE revalidam a sessão a cada 15 segundos, encerram se expirada/desativada ou se a empresa mudar, e são removidas ao desconectar. Até 20 conexões SSE por restaurante; acima disso a tela continua pela consulta periódica. Reinício do servidor encerra os streams para permitir parada da API.

O som exige clicar em **Ativar som** em cada tela, respeitando o navegador. Não toca para a primeira carga ou para o mesmo pedido visto novamente. Ao detectar um novo pedido pendente, exibe aviso com acesso à fila de novos. Se a rede falhar, mantém os cartões visíveis, indica que estão sem atualização confirmada e bloqueia as ações até a consulta voltar a funcionar.

## Ações concorrentes

O novo painel envia `expected_status` com cada alteração. A atualização SQL exige o estado esperado, o restaurante da sessão e uma transição permitida. Se outro operador avançou o pedido, retorna 409, informa o conflito e recarrega os dados. A tela não repete escritas automaticamente após erro de conexão.

O endpoint antigo permanece compatível com clientes sem `expected_status`; nesse formato, continua validando as transições anteriores. A interface nova usa a conferência adicional. Retirada não oferece nem aceita sair para entrega. Na cozinha, “pronto” encerra a ação de produção; despacho/conclusão ficam no gestor.

## Impressão

O botão **Imprimir** abre o diálogo de impressão do navegador. Na cozinha, imprime comanda de produção; no gestor, inclui cliente, endereço, pagamento registrado, frete e total para entrega/retirada. A formatação é compacta, mas papel, margens e impressora devem ser conferidos no equipamento real.

Não há impressão silenciosa/automática, detecção de impressora térmica ou garantia de impressão física. Nenhuma impressão é disparada por evento ou reconexão; só por clique explícito. Integração automática com equipamento é uma etapa posterior.

## API e publicação

`GET /api/admin/orders/board` retorna pedidos, itens, contadores, maior ID pendente, total filtrado, paginação e horário do servidor. Aceita `scope=active|kitchen|history`, `status`, `fulfillment=all|delivery|pickup`, `search` (até 80 caracteres), `limit` (1 a 100) e `offset` (0 a 100000). Valores inválidos são rejeitados. Todos os resumos, consultas e itens são filtrados pelo restaurante da sessão; um `company_id` informado pelo cliente não escolhe a loja.

Não há migração nova de banco. Sobre a publicação confirmada de 03/11 às 20:18 UTC, o atualizador reconhece 004/005 como aplicadas e não repete o DDL. Ele mantém backup, ensaio da cópia, preservação dos dados e verificações de saúde do fluxo já autorizado.

Para publicar:

```sh
bash /root/delivery-saas/scripts/update-live.sh
```

O ensaio da cópia foi ampliado para consultar o painel e conferir transições com estado esperado. A integração MySQL temporária também testa SSE em HTTP real e o conflito entre operadores. Canário e aplicação ativa verificam gestor, cozinha, JavaScript/CSS e recusa de acesso sem sessão aos endpoints novos.

Validação local concluída: sintaxe e 111 casos aprovados, zero falhas/ignorados; seis testes do fluxo de atualização com Docker/rede simulados aprovados. Cobertura: filtros e SQL com banco simulado, isolamento de eventos, encerramento de sessão, concorrência, renderização em VM, impressão manual, proteção de conteúdo, manutenção dos cartões em falhas e descarte de respostas antigas. Esses testes não substituem o navegador real. A integração ampliada foi executada e aprovada no host: `reports/mysql-validation-20261103T204123Z-1458648.log`, incluindo SSE em HTTP real, filtros, isolamento e conflito entre operadores. O ensaio na cópia e a aplicação ativa passaram nas verificações. Não houve DDL novo; registros originais foram preservados e 14 tabelas conferidas. O responsável confirmou que testou e aprovou o funcionamento desta entrega.

Após publicar, abrir gestor e cozinha em duas abas, ativar som se desejado, criar um pedido identificável e conferir que as ações aparecem nas duas telas. Testar delivery e retirada, conflito de ação entre abas, filtros/histórico e impressão no navegador. Não enviar senha ou cookies na conversa.
