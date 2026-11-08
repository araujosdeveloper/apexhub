# API Super Admin Apex Delivery

API Super Admin publicada em 05/11/2026 às 20:25 UTC. STATUS=PUBLICADO e ponteiro latest-update confirmados em `reports/update-20261105T202338Z-384376`; backup final `backups/live/live-20261105T202528Z-389880`. Integração MySQL real aprovada em `reports/mysql-validation-20261105T202420Z-386763.log`: cadastro transacional, paginação, status, revogação, métricas e restrição de perfil. Ensaio da cópia, dados anteriores preservados, canário e verificações HTTP aprovados. Nenhuma migração SQL aplicada. Esta entrega é de backend; o painel mantém a interface existente. As credenciais Master existentes não são recriadas pelo atualizador.

## Arquivos e autenticação

- Rotas: `backend/src/routes/platform-admin.js`.
- Controlador: `backend/src/controllers/platform-admin.js`.
- Respostas, transação e tratamento de erros: `backend/src/platform-admin-http.js`.
- Preços e cálculo decimal do MRR: `backend/src/platform-plan-prices.js`.

Os recursos `/api/admin/tenants` e `/api/admin/metrics` foram reservados ao Master e registrados antes do middleware de tenant existente em `/api/admin`. Ambos exigem autenticação no domínio Master e `requireRoles('super_admin')`. Rotas operacionais como `/api/admin/orders`, `/api/admin/catalog` e `/api/admin/customers` continuam exigindo o tenant da conta; não houve liberação global do prefixo. Donos, gerentes e operadores não acessam os recursos globais. JWT de outro domínio retorna 401. O middleware de perfil também recusa papéis não autorizados.

Utilizar JWT Master retornado no login ou em `POST /api/master/auth/token`, no header `Authorization: Bearer TOKEN`. O cookie Master do navegador continua restrito a `/api/master`, portanto chamadas do frontend às novas rotas devem usar Bearer. Exemplo após login Master:

```js
const response = await fetch('/api/master/auth/token', {method: 'POST'});
if (!response.ok) throw new Error('Autenticação Master necessária');
const {access_token} = await response.json();
const result = await fetch('/api/admin/tenants?page=1&page_size=20', {
  headers: {Authorization: `Bearer ${access_token}`}
});
const {success, data, message} = await result.json();
```

O token fica em memória. Nunca enviar senhas ou JWT em URLs. Os endpoints antigos `/api/master/*` e o painel atual permanecem compatíveis. Esta entrega disponibiliza a API; não adiciona formulários de criação ao frontend.

## Contrato JSON

Sucesso: `{ "success": true, "data": ..., "message": "..." }`.

Erro: `{ "success": false, "data": null, "message": "..." }`.

O padrão vale também para autenticação recusada, origem externa, JSON inválido, métodos e subrotas inválidos nos novos recursos. Respostas usam `Cache-Control: no-store` e `X-Request-ID` para correlação. APIs antigas conservam seus contratos existentes.

| HTTP | Uso |
| --- | --- |
| 200 | Consulta e atualização de status |
| 201 | Empresa e proprietário criados |
| 400 | Campos, paginação ou JSON inválidos |
| 401 | Sessão/token Master ausente, inválido, expirado ou revogado |
| 403 | Perfil recusado pela política ou escrita com origem externa |
| 404 | Empresa/subrota inexistente |
| 405 | Método não permitido no recurso |
| 409 | Duplicidade de e-mail, slug ou CNPJ |
| 500 | Falha interna sem exposição de detalhes |
| 503 | MySQL indisponível, timeout ou conflito transacional temporário |

## GET /api/admin/tenants

Parâmetros: `page` (padrão 1), `page_size` (padrão 20, máximo 100), `search` (até 80 caracteres) e `status=all|active|suspended` (padrão all). Offset máximo 100000. Curingas de busca são tratados como texto.

Retorna `data.tenants` e `data.pagination={page,page_size,total,total_pages}`. Cada empresa inclui `id`, `name`, `slug`, `cnpj`, `owner={id,name,email}` ou null, `plan={code,status,trial_ends_at}`, `status=active|suspended` e `created_at` em UTC. Consulta e contagem usam a mesma transação. Ordenação: cadastro mais recente, com ID como desempate. Não retorna senha, hash ou sessão.

## POST /api/admin/tenants

Exemplo ilustrativo, com dados e senha fornecidos pelo administrador:

```json
{
  "name": "Loja Exemplo",
  "slug": "loja-exemplo",
  "cnpj": "12.ABC.345/01DE-00",
  "plan_code": "trial",
  "owner": {
    "name": "Nome do Proprietário",
    "email": "proprietario@example.com",
    "password": "defina-uma-senha-propria"
  }
}
```

Nome da loja até 160 caracteres; responsável até 120; e-mail até 254; senha do lojista entre 12 e 128. `slug` é opcional: se omitido, gera endereço baseado no nome com sufixo aleatório. Se fornecido, de 3 a 80 letras minúsculas, números e hífens.

CNPJ é obrigatório, normalizado para maiúsculas e sem máscara; aceita 12 posições alfanuméricas e dois dígitos finais numéricos. A validação é de formato, sem cálculo de DV ou consulta cadastral à Receita. O exemplo é sintético. Cadastros anteriores e o editor antigo mantêm seu contrato de identificador fiscal já existente.

Toda nova empresa criada pelo Master também recebe automaticamente `plan_code=trial`, status `trialing` e validade de 30 dias. Valores legados do campo `plan_code` são aceitos na API por compatibilidade; não são ativados como plano pago. Não são atribuídas permissões Master ao proprietário: o papel gravado é sempre `owner`.

Empresa, proprietário, assinatura, perfil fiscal e auditoria `tenant_created` são criados numa única transação. E-mail do proprietário é único na tabela users; slug e CNPJ também são únicos. Qualquer falha reverte tudo. O Master e sua sessão são revalidados com travas antes de escrever. Senha é armazenada com scrypt e não retornada, registrada em auditoria ou escrita em logs. A operação não autentica o administrador como lojista e não envia mensagens ao responsável.

## Solicitações e ativação de plano

`GET /api/admin/subscription-requests` lista solicitações pendentes Essencial/Pro. `PUT /api/admin/subscription-requests/:id` recebe `{"status":"accepted"}` ou `{"status":"declined"}`. Apenas Super Admin autenticado pode consultar ou processar; aceitação ativa o plano solicitado, encerra o trial e grava auditoria. Recusa só encerra a solicitação. Nenhum endpoint cobra automaticamente.

## PUT /api/admin/tenants/:id/status

```json
{"status":"suspended","reason":"Suspensão solicitada pela administração"}
```

Status permitido: `active` ou `suspended`. Motivo opcional, de 5 a 500 caracteres; se omitido, registra o motivo padrão de alteração pela API Master.

Retorna `data={id,status,active,sessions_revoked}`. Trava conta/sessão Master e empresa; atualiza `companies.active`; ao suspender, remove somente sessões dos usuários daquela empresa; audita antes/depois/motivo na mesma transação. JWT vinculado à sessão revogada deixa de funcionar. Ativar não restaura sessões antigas nem reativa usuários individualmente desabilitados. Pedidos e dados existentes são preservados; não altera o status da assinatura ou cobrança. Requisições repetidas são seguras para o estado da empresa e permanecem auditadas.

## GET /api/admin/metrics

Retorna total de empresas ativas/suspensas, pedidos totais/do dia/concluídos, volume conhecido de pedidos concluídos, número de pedidos concluídos sem valor válido e estimativa de MRR. Horário e recorte diário em UTC.

`completed_order_volume` é soma conhecida de `orders.total_amount` dos pedidos concluídos, incluindo a composição já registrada no checkout. É volume transacionado pelas lojas, sem comprovar liquidação bancária ou receita do SaaS. Pedidos históricos sem valor válido são contados em `orders_with_unknown_amount`; a soma desses valores não é inventada.

`mrr_estimate` soma assinaturas com `subscriptions.status=active`, multiplicadas pelo preço mensal configurado do código de plano. Não inclui trialing/past_due/cancelled/legacy. Suspensão operacional da loja não cancela automaticamente um contrato ativo, por isso a estimativa considera o status da assinatura, independentemente de `companies.active`.

Valores monetários são strings decimais em BRL. Preços são convertidos para centavos inteiros e calculados com BigInt, sem ponto flutuante. Se existir assinatura ativa de plano sem preço configurado, `mrr_estimate=null`; `mrr_known_amount` informa a parcela conhecida e `mrr_missing_price_subscriptions` a quantidade pendente. Sem assinaturas ativas, estimativa 0.00. Também retorna `active_subscriptions`, `plan_prices_configured`, `mrr_basis`, `as_of` e `timezone`.

Configuração opcional: `PLAN_PRICES_JSON` no ambiente do processo ou em `.env.plans` da raiz, carregado pelo Compose do app. Exemplo apenas de formato, ajustar aos contratos reais:

```dotenv
PLAN_PRICES_JSON={"essencial":"99.90","pro":"149.90"}
```

Aceita até 100 planos, valores não negativos com duas casas decimais e até seis dígitos inteiros. Configuração inválida impede inicialização; ausência não impede uso da API e é explicitada nas métricas. O atualizador não cria preços nem configura cobrança. Recriar/publicar app após alterar a configuração. `.env.plans` fica fora do GitHub e da imagem Docker.

## Erros e logs com PM2/Docker

Falhas inesperadas geram uma linha JSON no stderr com `level`, `event`, `request_id`, `method`, padrão de rota e código seguro do erro MySQL. Sem SQL, parâmetros, corpo da requisição, cookies, senhas, tokens ou texto bruto de erro do banco. Falhas de conexão devolvem 503 com mensagem genérica; o request_id também está no header da resposta. Falha ao fazer rollback destrói a conexão para não devolver uma transação aberta ao pool.

PM2 captura stderr de processos gerenciados; consultar `pm2 logs NOME_DO_PROCESSO`. A produção atual usa Docker, que captura as mesmas linhas. Esta entrega não instala PM2 nem troca o gerenciador de processos da VPS.

## Publicação e validação

284 testes locais aprovados nesta entrega, incluindo autorização, envelope, cadastro/suspensão transacional, rollback, dados sensíveis e cálculo do MRR. Integração MySQL e smoke da cópia ampliados para criação, duplicidade, paginação, métricas, bloqueio e reativação com sessões revogadas. Execução MySQL real e publicação confirmadas no host às 20:25 UTC, conforme os relatórios acima.

Para futuras atualizações, no terminal do host:

```bash
bash /root/delivery-saas/scripts/update-live.sh
```

O atualizador executa a integração real e o ensaio antes de publicar. Não há DDL novo. O canário verifica anonimato recusado e envelope nas quatro rotas.

Referências primárias: [roteamento Express](https://expressjs.com/en/guide/routing/), [logs PM2](https://pm2.keymetrics.io/docs/usage/log-management/) e [formato alfanumérico do CNPJ — Receita Federal](https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/programas-e-atividades/cnpj-alfanumerico).
