# Horários, modalidades e taxas por bairro

Publicado em 03/11/2026 às 20:18 UTC. Evidência: `reports/update-20261103T201720Z-1426258/STATUS.txt` = `PUBLICADO`; migração 004 aplicada no banco real com preservação dos registros originais.

## Uso

No painel de pedidos, abra **Operação da loja** (`/operations.html`). Proprietário e gerente podem salvar; operador pode consultar. As configurações pertencem ao restaurante da sessão.

- **Aberto manualmente:** aceita pedidos independentemente dos horários cadastrados.
- **Automático pelos horários:** aceita pedidos apenas nos intervalos semanais, segundo o fuso escolhido. Pode haver vários turnos por dia; intervalos sobrepostos são rejeitados. Fechamento anterior à abertura termina no dia seguinte. `00:00` até `24:00` cobre o dia inteiro. A abertura é inclusiva e o fechamento é exclusivo.
- **Pausado:** mantém o cardápio visível e bloqueia novos pedidos.
- **Delivery e retirada:** pelo menos uma modalidade deve estar ativa. Retirada exige endereço da loja e não exige endereço do cliente. Os prazos são previsões em minutos a partir do pedido, sem agendamento de entrega futura.
- **Bairros:** ativar a restrição exige ao menos um bairro e sua taxa. A comparação ignora caixa, acentos e espaços repetidos. Outros bairros não podem concluir delivery. Com a restrição desativada, qualquer bairro é aceito, sem frete.

O cliente vê a disponibilidade, os horários automáticos, a previsão, o endereço de retirada e o resumo de produtos/frete/total antes de confirmar. Atualizar disponibilidade recarrega o cardápio; o carrinho permanece na aba. Nome, telefone e endereço digitados ainda não são preservados após recarga.

O pedido guarda modalidade, frete, previsão e endereço de retirada como histórico. O painel diferencia delivery de retirada. Retirada não oferece nem aceita a transição “Saiu para entrega”. A retirada não apaga o endereço de entrega anteriormente salvo no cadastro do cliente.

## Compatibilidade

Sem configuração salva, a loja continua aberta manualmente, com delivery ativo, frete zero e retirada desativada. Esse padrão mantém o comportamento anterior; a loja precisa configurar sua operação para impor horários e bairros.

Pedidos anteriores recebem `delivery`, endereço de retirada vazio e previsão desconhecida (`NULL`). Se o campo de frete ainda não existe, ele é criado com `0.00`. O inventário legado já possui `delivery_fee`: os valores e nulos desse campo são preservados. Valores e endereços históricos existentes não são recalculados. Frete desconhecido não é reconstruído pela migração.

O hash de reenvio de delivery sem cotação explícita mantém o formato anterior. Pedidos com frete incluem a cotação no hash e retirada inclui a modalidade. Reenvios de pedidos já confirmados retornam os valores originais, inclusive após pausa ou alteração das configurações. No navegador, uma tentativa anterior pode ser reconfirmada com a loja fechada somente se o conteúdo for o mesmo.

## API

- `GET /api/admin/operations`: configurações e disponibilidade da loja autenticada.
- `PUT /api/admin/operations`: substitui o conjunto completo, validado no servidor. Somente owner/manager.
- `GET /api/menu/:slug`: inclui `operations`, com configurações públicas e disponibilidade calculada no servidor.
- `POST /api/orders`: aceita `fulfillment_method` (`delivery` por padrão, ou `pickup`) e `delivery_fee` como string decimal, por exemplo `"4.50"`. A taxa enviada é uma cotação a conferir; o servidor calcula a taxa real a partir do bairro. Cotação ausente equivale a zero. Divergência retorna 409 e exige atualizar o cardápio e conferir o valor. Bairro fora da área/modalidade desativada retorna 400; loja fechada retorna 409.

O total inclui produtos e frete. O servidor bloqueia alterações das configurações enquanto o checkout está calculando e gravando um pedido. Uma confirmação válida de reenvio é resolvida antes de reavaliar horários e frete.

## Banco novo e banco existente

Banco novo: `001-initial.sql` já contém a tabela e os campos novos. Aplicar também `002-checkout-requests.sql`, conforme README. Não aplicar 004 depois desse esquema novo.

Banco existente com a fundação SaaS: usar `database/004-store-operations.sql` uma única vez, antes de iniciar a nova versão. O arquivo preserva o tipo INT com/sem sinal de `companies.id` na chave estrangeira. Todos os comandos precisam executar na mesma conexão MySQL porque o DDL usa variáveis de sessão e PREPARE.

Antes da atualização real:

1. Fazer backup atual do banco publicado e ensaiar a restauração em cópia isolada.
2. Conferir que a tabela `company_operations` e as colunas `fulfillment_method`, `fulfillment_address` e `estimated_minutes` ainda não existem. `delivery_fee` pode já existir no legado e será preservada. Se houver migração parcial, inspecionar o estado antes de continuar; não repetir cegamente o arquivo.
3. Aplicar 004 na cópia com conta administrativa, verificar pedidos anteriores e testar novos pedidos com frete e retirada.
4. Validar login, configurações, abertura/pausa, checkout e mudança de status em navegador.
5. Só então atualizar banco e imagem do ambiente real em uma janela controlada, com backup e imagem anterior disponíveis. O DDL MySQL tem commit implícito; rollback da aplicação não remove as novas colunas. As adições e os padrões preservam a leitura pela versão anterior, mas retornar a ela depois de receber retirada/frete exige revisão porque ela não apresenta essas modalidades corretamente.

O ensaio de restauração do legado agora aplica 003, 004 e 005 (adicionais) em uma conexão dedicada. Isso serve para novas cópias isoladas; não é o procedimento para atualizar a loja já publicada. Não repetir o corte original nem reabrir gravações do banco antigo. A versão atual da aplicação também precisa da migração 005 descrita em [adicionais-produtos.md](adicionais-produtos.md).

## Validação

Executar em `backend`: `npm run check` e `npm test`. Conferência local desta entrega: sintaxe válida, 11 arquivos de teste aprovados; execução detalhada com `node --test --test-isolation=none --test-reporter=tap test/*.test.js` confirmou 76 casos, zero falhas e zero ignorados, em Node v26.7.0. Os testes locais exercitam horários/fusos, virada de semana, sobreposição, bairros, total com frete, retirada, isolamento, permissões e reenvio. Os testes da loja executam JavaScript em VM; não equivalem a validação visual em navegador. O runtime de produção não foi revalidado nesta sessão.

A integração `npm run test:mysql` foi ampliada para modalidades, taxas, preservação do cadastro, configurações entre empresas, pausa e reenvio. Também aplica 004 em tabelas temporárias de ensaio com nomes exclusivos, tanto para INT quanto INT UNSIGNED, verificando preservação de pedidos e chave estrangeira. Exige o banco dedicado terminado em `_test`; para usar MySQL temporário no host, executar `bash scripts/validate-mysql.sh` na raiz.

Em 03/11/2026, a execução no host aprovou a integração MySQL ampliada, o ensaio numa cópia atual e a migração no banco real. Foram conferidas 14 tabelas e preservados os registros originais. Health, exigência de autenticação, páginas e cardápio foram aprovados antes/depois da troca. Relatórios: `reports/mysql-validation-20261103T201735Z-1427325.log` e `reports/update-20261103T201720Z-1426258/`. O responsável confirmou o funcionamento visual geral dos módulos publicados antes de iniciar a próxima etapa; não foi relatado um roteiro detalhado de cada cenário.

Adicionais foram publicados na mesma atualização: [adicionais-produtos.md](adicionais-produtos.md). Ficam para as próximas entregas mesa/comanda, taxas por distância, rastreamento público, pagamentos online e IA no WhatsApp.
