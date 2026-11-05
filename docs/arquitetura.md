# Plataforma SaaS para restaurantes

## Direção do produto

O escopo funcional detalhado fornecido pelo responsável e a sequência de evolução estão em [escopo-produto.md](escopo-produto.md). Esse documento atualiza as prioridades de produto dos marcos abaixo.

Referência de categoria: Brendi. Não houve acesso às telas privadas ou levantamento completo do produto de referência. O escopo implementado é próprio, a partir da necessidade de atender múltiplos restaurantes por assinatura. Nome e identidade visual definitivos ficam para uma etapa posterior.

Decisão inicial: monólito modular Node.js/Express + MySQL 8. Manter a tecnologia existente reduz o custo da primeira entrega. O backend serve as páginas e a API na mesma origem. Não há dependência do n8n para receber pedidos.

## Primeira entrega: fundação

- Cadastro transacional de restaurante, proprietário e assinatura em teste de 14 dias.
- Senhas com scrypt e salt aleatório; sessão opaca, cookie HttpOnly/SameSite, hash do token no banco e expiração em sete dias.
- Identidade do restaurante obtida da sessão nas rotas administrativas. Os identificadores fornecidos pelo navegador não definem a empresa autorizada.
- Perfis owner, manager e operator. Proprietário e gerente administram o cardápio; operador acompanha pedidos. A interface de convite e gestão da equipe ainda não foi feita.
- Cardápio público por slug, cadastro e edição de categorias/produtos, ordenação e pausa de categorias, pausa/ativação de produtos e configuração de WhatsApp.
- Checkout transacional, preços calculados no servidor em centavos, conferência de categoria/produto da empresa e histórico de produto/endereço salvo no pedido.
- Consulta dos últimos 100 pedidos e mudança de status condicionada ao estado anterior.
- API sem credenciais fixas e sem respostas com detalhes internos do SQL.

O fluxo do cliente é: cadastro → painel → cardápio → categoria → produto → abrir loja → pedido → acompanhar no painel.

## Limites desta entrega

O status de assinatura é informativo. Não existe cobrança, confirmação de pagamento, bloqueio por vencimento ou integração automática com WhatsApp. O encaminhamento ao WhatsApp abre uma mensagem para envio manual. Não informa que um pagamento foi efetivado.

O checkout exige Idempotency-Key. Uma chave única por empresa e o hash normalizado dos dados são gravados na mesma transação do pedido. Reenvios com a mesma chave e conteúdo retornam o pedido original; conteúdo diferente retorna 409. O cliente mantém carrinho e chave em sessionStorage para permitir reenvio após falha ou recarga. A retenção dessas chaves ainda não tem rotina de expurgo; apagá-las elimina a proteção dos reenvios antigos. O carrinho permite diminuir e remover produtos. A loja exige HTTPS ou localhost para usar a API criptográfica do navegador.

O limitador de autenticação é local ao processo e limita a 30 requisições a cada 15 minutos por IP. Antes de escalar: armazenamento compartilhado e configuração explícita do proxy confiável. Sessões expiradas são rejeitadas, mas ainda precisam de rotina de limpeza. Faltam recuperação de senha e verificação de e-mail.

O frontend antigo permanece em HTML/JavaScript. O painel e a loja ainda utilizam o CDN do Tailwind. A entrega não constitui uma homologação visual ou de produção.

## Próximos marcos

1. Banco existente: inventário, backup, migração ensaiada e homologação com MySQL real.
2. Operação: adicionais, horários, taxas e áreas de entrega; rastreamento público de pedidos.
3. Administração SaaS: painel da plataforma, equipe e permissões, auditoria, planos e bloqueios.
4. Assinaturas: provedor de cobrança, checkout hospedado, webhooks assinados e idempotentes, cancelamento e recuperação de cobrança.
5. Atendimento: WhatsApp oficial, consentimentos e templates, automações com histórico.
6. Expansão: cozinha, impressão, entregadores, financeiro, estoque, campanhas e fidelidade.
7. Operação de produção: monitoramento, backups com restauração testada, testes ponta a ponta, acessibilidade, assets locais e segurança da infraestrutura.

## Regras de evolução

Toda rota privada deve obter company_id da sessão e filtrar as consultas por ele. Não criar superadministrador implicitamente no primeiro cadastro. Dados financeiros usam DECIMAL no banco e centavos no cálculo. Migrações de dados existentes exigem inventário e backup. Serviços externos só entram após configuração e validação de seus eventos reais.

## Ambiente isolado e validação

`compose.dev.yml` usa projeto e volume próprios, sem reaproveitar `saas_mysql` ou `mysql_data` do Compose legado. A aplicação fica acessível apenas em localhost:3001 por padrão; o MySQL não publica porta. `001` e `002` são executados automaticamente somente ao criar um volume vazio.

O perfil `test` contém um MySQL temporário e um serviço de integração. O teste usa um banco terminado em `_test`, cria duas lojas, tenta acesso cruzado e envia o mesmo checkout de forma concorrente. Ele não faz parte de `npm test`; exige execução explícita em um ambiente com Docker ou banco de testes acessível.

Validação: 28 testes locais com banco simulado e execução do JavaScript da loja em VM passaram; sintaxe dos scripts e configuração do Compose foram verificadas. Em 02/11/2026, a execução no host fornecida pelo usuário concluiu a suíte de integração com MySQL real e Node v22.23.4: uma suíte passou, zero falhas e zero casos ignorados. Cadastro/sessões de duas lojas, catálogo, isolamento, preço no servidor e checkout concorrente sem duplicação foram validados. A limpeza do ambiente temporário também concluiu com sucesso.

Evidência: `reports/mysql-validation-20261102T182723Z-73527.log` no host. O acesso ao Docker desta sessão permanece restrito; a validação foi executada pelo usuário no terminal do servidor. Migração do banco legado, inicialização do servidor HTTP e renderização em navegador ainda não foram validadas.
