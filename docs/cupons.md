# Cupons e promoções

Publicado em 04/11/2026 às 03:19 UTC. Evidência: `reports/update-20261104T031837Z-1881727/STATUS.txt` = `PUBLICADO`. Automação de atendimento/WhatsApp/IA foi adiada para a última etapa pelo responsável.

## Configurar

No gestor, abrir **Cupons** (`/coupons.html`). Proprietário e gerente criam, editam ou pausam; operador apenas consulta. Cada restaurante tem seus próprios códigos, com 3 a 32 caracteres. Letras são normalizadas para maiúsculas. O mesmo código pode existir em lojas diferentes; o código de uma campanha não muda após ser criado.

Tipos:

- **Desconto em reais:** abate um valor dos produtos/adicionais, limitado ao subtotal e ao teto opcional.
- **Percentual:** de 0,01% a 100%, calculado em centavos, com arredondamento para o centavo mais próximo e teto opcional. Nunca desconta mais que o subtotal dos produtos.
- **Frete grátis:** abate a taxa original de entrega; exclusivo para delivery. Não se aplica à retirada ou a pedidos cujo frete já é zero.

Um cupom por pedido. O valor mínimo considera produtos e adicionais antes do desconto, sem incluir frete. Datas são opcionais e digitadas no fuso do dispositivo, indicado na tela; o servidor compara em UTC. Início é inclusivo e término é exclusivo.

Os limites total e por telefone são opcionais. Primeira compra é verificada pelo telefone brasileiro informado, com DDD e código 55 opcional; pontuação e prefixo de país não criam um cliente novo. O checkout não verifica a titularidade do telefone: essa regra controla o número informado, não comprova identidade pessoal.

O histórico anterior, inclusive sem chave de telefone preenchida, é considerado na primeira compra. Pedidos cancelados não impedem uma primeira compra; entretanto, um pedido confirmado que usou cupom consome o uso e continua contando nos limites mesmo se for cancelado depois. Não há devolução automática de uso. Para restringir reutilização após cancelamento, definir limite por telefone.

## Checkout e histórico

O cliente informa telefone e bairro/modalidade, digita o código e clica em **Aplicar**. A prévia confere catálogo, adicionais, área/taxa, validade e elegibilidade no servidor. Não reserva uso. Ao confirmar, todas as regras e os limites são verificados novamente.

Alterar carrinho, telefone, modalidade, bairro ou código invalida a prévia. O cliente precisa reaplicar ou remover o código antes de concluir. Se produtos, frete ou desconto mudarem, o sistema exige conferir os valores novamente. Uma prévia indisponível não vira silenciosamente um pedido sem desconto.

O pedido preserva código, desconto, versão e regras aplicadas em `coupon_snapshot`. O frete original fica registrado separadamente, inclusive em frete grátis. O total é produtos + frete original − desconto. O gestor, a via de entrega e a mensagem manual de WhatsApp mostram o cupom e seu desconto; cozinha mantém o foco em itens/adicionais.

O uso é incrementado na mesma transação do pedido. Checkout por restaurante usa bloqueio exclusivo na empresa antes das verificações; isso serializa compras concorrentes para impedir estouro de limite e duas primeiras compras do mesmo telefone com códigos diferentes. Essa escolha prioriza consistência no monólito atual.

Reenvio com a mesma chave e dados retorna o pedido original, sem novo uso, mesmo se o cupom foi pausado ou esgotou depois. Alterar cupom, desconto ou subtotal com a mesma chave retorna conflito. O hash dos pedidos anteriores sem cupom continua compatível. Na aba, a prévia de cupom é guardada para restaurar o mesmo envio após falha/recarga quando o contexto voltar a coincidir; é removida após confirmação ou remoção explícita.

## API e banco

- `GET /api/admin/coupons?offset=0`: lista da empresa da sessão, 50 por página, com contagem de usos.
- `POST /api/admin/coupons`: código e configuração, somente owner/manager.
- `PUT /api/admin/coupons/:id`: edição com `version`, sem alterar código nem zerar contador. Versão desatualizada retorna 409.
- `POST /api/coupons/quote`: prévia pública para código, empresa, telefone, itens, modalidade e bairro; retorna subtotal, frete, desconto e total.
- `POST /api/orders`: para usar cupom, informar `coupon_code`, `coupon_discount` e `coupon_subtotal`, estes dois como strings decimais de duas casas. O servidor calcula e confere os valores; dados enviados não definem o preço.

Banco existente: migração `006-coupons.sql` após 004/005. Cria `company_coupons` e acrescenta código/desconto/snapshot/chave de telefone aos pedidos, com índice de uso por cliente. A chave estrangeira acompanha o tipo INT com/sem sinal da empresa. Os comandos precisam da mesma conexão MySQL.

Pedidos existentes recebem código vazio, desconto zero e snapshot/chave de telefone nulos. Não são reescritos nem recebem desconto retroativo. A auditoria foi atualizada para considerar o desconto no total e conferir o contador de usos com o histórico, incluindo pedidos cancelados.

Instalação nova: `001-initial.sql` já inclui as estruturas; aplicar 002 conforme README. Não aplicar 004/005/006 depois desse esquema inicial atualizado. O ensaio do legado e o atualizador foram preparados para reconhecer 006, aplicar apenas o que falta e recusar migração parcial.

## Validação e publicação

Sintaxe e **124 testes locais** aprovados, zero falhas/ignorados. Seis testes do fluxo de publicação com Docker/rede simulados também passaram. Cobertura de cálculo, arredondamento, limites, primeira compra, versões de edição, isolamento, reenvio e preservação do cupom na aba. Esses testes usam banco simulado/VM e não equivalem à integração MySQL real.

A integração no host foi ampliada para verificar limite total concorrente, limite por telefone com formatações diferentes, primeira compra entre códigos distintos, histórico antigo, frete grátis, percentuais, pausa e reenvio. O DDL 006 é ensaiado com IDs assinados e não assinados, preservando os registros anteriores. O ensaio da cópia da loja testa criação e uso de cupom. Essa execução real foi aprovada no host em `reports/mysql-validation-20261104T031854Z-1882923.log`. Ensaio da cópia e aplicação de 006 no banco real passaram, preservando os registros anteriores e verificando 15 tabelas. A candidata aprovou 124 testes; canário, aplicação ativa e HTTPS pelo proxy local também passaram. Backup final: `backups/live/live-20261104T031933Z-1885520`. A conferência visual desta entrega ainda não foi relatada.

Publicação já autorizada pelo responsável, usando o procedimento habitual:

```sh
bash /root/delivery-saas/scripts/update-live.sh
```

O comando executará a integração, ensaiará a cópia atual e fará backup final antes de aplicar 006 e trocar a aplicação. Após `ATUALIZAÇÃO PUBLICADA`, conferir no navegador criação/pausa, aplicação/remoção no checkout, total e histórico do pedido. Não restaurar dump antigo no banco real nem repetir DDL manualmente após uma falha; analisar o relatório.
