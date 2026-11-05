# Autenticação, RBAC e isolamento ApexHub

Implementado em 05/11/2026, preparado para atualização. Publicação e integração MySQL desta entrega ainda não confirmadas. A versão atualmente confirmada em produção é o Master de 18:06 UTC.

## Identidade e middlewares

`backend/src/middlewares/auth.js` centraliza a resolução de credenciais e `requireRoles`. `backend/src/middlewares/tenant.js` fornece `tenantMiddleware`. `backend/src/jwt.js` define um perfil JWT interno restrito a HS256, usando HMAC SHA-256 e comparação constante de assinatura do `node:crypto`. Nenhuma implementação de criptografia própria ou serviço externo de chaves é usado. O registro npm estava indisponível na sessão; não foi adicionada dependência sem execução/verificação local.

JWT de acesso tem duração de 15 minutos, `iss=apexhub`, audiência distinta `apexhub:tenant` / `apexhub:master`, tipo `at+jwt`, `sub=tenant:ID` / `master:ID`, `role`, `tenant_id`, `sid`, `jti`, `iat`, `nbf` e `exp`. O verificador fixa algoritmo, tipo, chave e audiência pelo escopo da rota; não aceita `none`, algoritmos alternativos, referências remotas de chave ou cabeçalhos adicionais. Valida formato, assinatura, tipos, validade, tempo máximo e identificadores. As duas chaves de 256 bits são diferentes. Não se trata de um verificador JWT genérico para emissores externos.

Tokens são vinculados ao identificador derivado da sessão (`sid`), sem expor o cookie original. Cada requisição consulta a sessão, a conta ativa e, no tenant, a empresa ativa. Sujeito, perfil e empresa do JWT devem corresponder ao banco. Logout, bloqueio, mudança de senha/perfil da equipe e suspensão da empresa revogam também os JWT vinculados. SSE revalida identidade e validade a cada 15 segundos e encerra ao perder acesso.

`Authorization: Bearer TOKEN` tem precedência estrita: token inválido retorna 401 mesmo com cookie válido. Cookies HttpOnly existentes continuam aceitos pelo mesmo middleware, com as mesmas verificações de perfil e empresa, para manter os painéis funcionando. Nenhum token é salvo em localStorage pelos frontends atuais.

Toda rota sob `/api/admin` passa obrigatoriamente por autenticação e `tenantMiddleware`, inclusive rotas futuras. `req.auth` contém a identidade canônica; `req.user` preserva os campos e papéis existentes para compatibilidade. `req.tenantId` é definido a partir da identidade, validado contra o usuário e não pode ser alterado. Body, query e cabeçalhos de tenant nunca fornecem escopo administrativo.

As rotas `/api/master` exigem sessão/JWT Master e papel `super_admin`; login permanece público e limitado por tentativas. Um token Master não representa uma loja e não ganha acesso implícito às APIs operacionais. Acesso assistido continua indisponível. As contas Master seguem provisionadas apenas no terminal, sem registro público ou elevação de donos.

## Perfis e permissões

| Perfil no JWT | Perfil atual no banco | Permissão |
| --- | --- | --- |
| `super_admin` | `platform_admins`, conta ativa | Rotas globais Master existentes, gestão de empresas, indicadores e auditoria |
| `tenant_owner` | `users.role=owner` | Operação, catálogo, configurações, relatórios e equipe da própria loja |
| `tenant_manager` | `users.role=manager` | Operação e gestão da própria loja; sem gestão de equipe |
| `tenant_operator` | `users.role=operator` | Consulta operacional, pedidos, cozinha e despacho da própria loja; sem edição gerencial ou acesso a relatórios/clientes/equipe |

Gerentes existentes foram preservados em um papel separado. Não são promovidos a proprietários. Papéis desconhecidos são recusados. A política utiliza uma lista explícita de papéis permitidos em cada operação; `super_admin` não é um bypass das regras de tenant. A autenticação autoriza as rotas existentes; não implementa cobrança, planos comerciais ou gateway ainda ausentes.

## Uso da API

Cadastro e login de tenant retornam `success`, mantendo o cookie existente, e acrescentam `access_token`, `token_type=Bearer`, `expires_in=900`, `role` e `tenant_id` quando JWT está configurado. Login Master retorna os mesmos campos de acesso com `ok=true`, `role=super_admin` e `tenant_id=null`.

Exemplo em cliente JavaScript, mantendo token somente em memória:

```js
const response = await fetch('/api/auth/login', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({email, password})
});
if (!response.ok) throw new Error('Login recusado');
const {access_token} = await response.json();
const orders = await fetch('/api/admin/orders', {
  headers: {Authorization: `Bearer ${access_token}`}
});
```

`POST /api/auth/token` e `POST /api/master/auth/token` emitem novo JWT a partir de uma sessão HttpOnly válida do escopo correspondente. Não recebem `role`/`tenant_id` do cliente. Renovação via bearer é recusada: um token não estende sua própria validade. Sem chaves no desenvolvimento, emissão retorna 503, mantendo login por sessão; produção recusa iniciar sem ambas as chaves.

`POST /api/auth/logout` aceita bearer ou cookie e revoga a sessão correspondente. `POST /api/master/auth/logout` faz o mesmo no escopo Master. Respostas de autenticação usam `Cache-Control: no-store`. A proteção de origem existente continua aplicada às escritas dos navegadores.

## Queries MySQL e escopo

A coluna física de tenant continua sendo `company_id`. `tenant_id` no contrato JWT e `req.tenantId` representam exatamente esse mesmo identificador. Nenhuma tabela, índice, chave estrangeira ou dado foi renomeado.

Os módulos operacionais agora usam `req.tenantId` nos parâmetros SQL. Seleções, atualizações e exclusões de registros diretos usam `company_id=?`; empresas usam sua própria PK `id=?`. Inserções gravam explicitamente o `company_id` autenticado, sem aceitar substituição pelo corpo da requisição. Não se aplica uma cláusula WHERE a INSERT VALUES.

Tabelas filhas, como adicionais, fotos e itens, herdam tenant do produto/pedido. Leituras fazem JOIN ao pai escopado ou usam um pai previamente autorizado; gravações ocorrem após seleção/trava do pai pertencente ao tenant na mesma transação. A remoção de fotos inclui também JOIN explícito com produto e `p.company_id=?`. Operações com versões e transições de status mantêm verificações de concorrência. FKs compostas existentes entre produto/categoria e pedido/cliente impedem vínculos cruzados nessas relações.

MySQL compartilhado não oferece uma política automática de RLS por `req.tenantId`. O isolamento desta arquitetura é aplicado pela autenticação, escopo obrigatório nas rotas, SQL parametrizado, verificação de vínculos, transações e testes de acesso cruzado. Novas consultas precisam respeitar esse contrato; o middleware não reescreve SQL por regex nem considera segura uma query arbitrária sem filtro.

APIs públicas de cardápio/checkout continuam públicas por definição do produto: identificam a empresa pelo slug/id validado e verificam disponibilidade, produtos e preço no servidor. Acompanhamento/avaliação exigem o token privado do pedido. Essas APIs não expõem consultas administrativas e não recebem `tenantMiddleware` de usuários lojistas. Autenticação e rotas globais Master também têm consultas próprias, sem fingir que existe um tenant associado.

## Chaves e publicação

O atualizador e o publicador inicial executam `node scripts/ensure-jwt-keys.js`. Na primeira execução cria `.env.jwt` na raiz, com duas chaves aleatórias independentes e permissão 600. Nas demais, valida e preserva o arquivo. Recusa symlinks, conteúdo inválido ou permissões abertas; não sobrescreve nem imprime segredos. O Compose carrega esse arquivo apenas no serviço app. A configuração fica fora do GitHub, do contexto Docker, dos logs e da exportação de fontes.

No host, publicar normalmente:

```bash
bash /root/delivery-saas/scripts/update-live.sh
```

Não há nova migração de banco. Sessões existentes são preservadas. A inicialização em produção exige ambas as chaves; o canário verifica configuração JWT e proteção dos endpoints de emissão antes de abrir tráfego. Em desenvolvimento Docker, gerar o arquivo com o mesmo script antes de recriar app. Em Node local, configurar as duas variáveis no `backend/.env`, conforme exemplo, usando chaves independentes.

## Verificação e referências

Testes cobrem interoperabilidade com WebCrypto, algoritmo/tipo/audiência, expiração, claims inválidas, separação Master/tenant, perfis, sessão revogada, precedência do bearer, emissão, renovação, logout e imutabilidade do tenant. Integração MySQL foi ampliada para IDOR, inserção com tenant forjado, modificação de outra empresa, mudança de senha/perfil e suspensão. O ensaio da cópia também verifica JWT. Docker continua inacessível nesta sessão; a execução real no MySQL será feita pelo atualizador no host.

Referências primárias: [JWT — RFC 7519](https://www.rfc-editor.org/rfc/rfc7519), [boas práticas JWT — RFC 8725](https://www.rfc-editor.org/rfc/rfc8725) e [env_file — Docker Compose](https://docs.docker.com/reference/compose-file/services/#env_file).

Validação local concluída: 265 testes aprovados, incluindo geração privada/idempotente das chaves e login com JWT; sintaxe backend/frontend/scripts e Compose aprovados. Seis simulações do atualizador e quatro do publicador inicial aprovadas. A execução MySQL real e a publicação continuam pendentes de execução no host.
