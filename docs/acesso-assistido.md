# Acesso assistido e layout unificado Apex Delivery

Implementado em 05/11/2026, preparado para publicação. Acesso Master normal já foi confirmado pelo responsável. Esta entrega não redefine senhas nem encerra a sessão Master existente. Migração aditiva 013; publicação, execução MySQL real e conferência visual ainda pendentes.

## Fluxo do Master para a loja

Na tabela de empresas do Master, `Acessar como loja` fica disponível para empresas ativas. Ao clicar, o cliente obtém um JWT Master a partir da sessão HttpOnly e chama:

`POST /api/admin/tenants/:id/impersonate`

A rota exige autenticação Master e `super_admin`. Aceita motivo opcional de 5 a 500 caracteres, com motivo padrão registrado pelo painel. Valida empresa existente/ativa e seleciona um proprietário ativo da própria empresa. Empresa inexistente retorna 404; suspensa ou sem proprietário ativo, 409. Não cria usuário oculto, não muda senha ou perfil do lojista e não autentica o Master nas rotas globais com o token de loja.

Conta/sessão Master, empresa e proprietário são verificadas na transação de emissão. Persiste sessão assistida e registra `impersonation_started`. Retorna envelope REST com `data.access_token`, `token_type=Bearer`, `expires_in=3600`, `tenant_id`, `role=tenant_owner`, `impersonation=true`, nome da loja e `redirect_url`.

O token usa HS256 com a chave tenant já configurada, mas tipo `apexhub-impersonation+jwt`, audiência `apexhub:impersonation`, propósito explícito e `act.sub=master:ID`. O sujeito é o proprietário real selecionado. O verificador normal não aceita esse perfil como token comum e o domínio Master não o aceita. O token permite APIs operacionais somente no tenant autorizado e depende da sessão Master pai continuar válida. Validade máxima de uma hora; não pode ser renovado pelas rotas normais de token.

## Entrada sem credencial na query

O redirecionamento usa `/tenant/dashboard#token=JWT`, em vez de `?token=JWT`. Fragmentos não são enviados no pedido HTTP ao servidor. A página de entrada usa `no-referrer`, remove o token da barra/histórico com `replaceState` antes da chamada de troca e não persiste o JWT em localStorage/sessionStorage.

`POST /api/auth/impersonation/exchange` recebe `{token}`. Valida assinatura, perfil, prazo e a sessão assistida/empresa/proprietário/administrador/sessão Master no banco. Uma transação marca o link como utilizado e emite cookie opaco separado `apex_assisted_session`, com hash persistido, HttpOnly, Secure em produção, SameSite=Strict e Path=/api. Troca repetida retorna 409. O JWT emitido continua uma credencial Bearer válida dentro do seu prazo, vinculada à sessão revogável; a regra de uso único é da troca pelo cookie do navegador.

A resposta da troca contém apenas nonce de contexto, tenant, prazo efetivo e destino fixo `/dashboard.html`. O nonce é salvo por aba em sessionStorage; ele não autentica sozinho e não é o cookie ou JWT. Só depois disso abre o App Shell do lojista.

No modo navegador, as requisições da aba assistida levam `X-Apex-Impersonation` junto do cookie opaco. O servidor exige correspondência entre cookie, nonce e registro autorizado. SSE e imagens privadas transportam o mesmo nonce não autenticador em `assisted_context`, limitado a esses recursos; continuam exigindo o cookie correto. Nenhum JWT é enviado na query.

Abas normais sem nonce continuam usando sua própria sessão de lojista. Se outra aba iniciar uma nova sessão assistida, o cookie compartilhado muda: a aba antiga é recusada ao fazer nova requisição, sem escrever silenciosamente na nova loja. Esse modelo mantém um contexto assistido de cookie por navegador; não oferece múltiplos contextos assistidos simultâneos com o mesmo cookie. Clientes API podem usar os JWT emitidos, sujeitos às mesmas verificações de sessão e escopo.

## Identidade, auditoria e revogação

`/api/auth/me` informa os campos usuais do proprietário e metadata de impersonation com identidade do administrador e prazo. O shell apresenta banner persistente `Acesso assistido · Master`, loja, administrador e horário limite, com botão `Encerrar e voltar ao Master`. O perfil visível identifica o Master; os checks operacionais usam a identidade do proprietário da loja alvo.

Cada requisição assistida revalida empresa ativa, proprietário ativo com papel owner, conta Master ativa, sessão pai válida e prazo da sessão assistida. O tenant continua imutável no middleware. Nenhum tenant do body/query substitui o autorizado. SSE revalida acesso a cada 15 segundos.

Emissão, troca e encerramento registram auditoria em suas transações. Tentativas de escrita operacional são auditadas antes do handler, com ator, loja, proprietário, método e caminho; sem corpo, JWT, cookie, hash de credencial ou senha. Falha em registrar a tentativa impede a escrita. Esse evento é uma tentativa de operação, não uma afirmação de sucesso do handler subsequente.

`POST /api/auth/impersonation/end` revoga a sessão assistida e limpa apenas seu cookie; encerra mesmo após expiração/revogação do pai quando ainda há prova do cookie/contexto correspondente. Contexto antigo em outra aba não apaga o cookie novo. O logout do lojista em modo assistido é encaminhado para esse encerramento, preservando a sessão normal do lojista. A aba volta ao Master; se a sessão Master acabou, será solicitado login.

Logout ou recuperação de senha Master remove a sessão pai e, por FK em cascata, as sessões assistidas vinculadas. Suspensão da empresa, tanto pela API global quanto pelo editor antigo do Master, remove suas sessões assistidas; reativar não restaura essas sessões. Desativar/mudar o proprietário também impede a autenticação assistida. Expiração não retorna para outra conta automaticamente: a aba encerra o modo assistido e volta ao Master.

## Banco e código

`database/013-impersonation.sql` cria `platform_impersonations`, sem alterar registros anteriores. IDs de empresa/proprietário usam os tipos reais da instalação. FKs vinculam administrador, sessão Master, empresa e proprietário, com cascade para remoções. O esquema inicial também inclui a tabela. Cookie só aparece como hash; ID/nonce por si só não é credencial válida.

Servidor: `backend/src/impersonation.js`, perfis JWT em `jwt.js`, integração no middleware/auth, logout e consultas de imagens. A rota foi acrescentada ao router global existente, sem liberar o namespace administrativo aos lojistas.

Cliente: `assisted-context.js`, `impersonation-entry.html/JS`, botão no Master e banner/encerramento no App Shell. O helper envia contexto somente para a mesma origem e não substitui um Bearer explícito.

## Padronização visual

`apex-tokens.css` é compartilhado entre Master, login Master, shell e as 14 views internas. Define fundo #121212, superfície #1E1E1E, ação #FF7F00, texto #F5F5F5, secundário #B0B0B0, sidebar 254px e header base 84px.

Gestor, KDS, Cardápio, Entregadores e Cupons usam o mesmo shell lateral com header persistente. CSS claro legado de cards/formulários foi convertido para a paleta escura; `orders.css` perdeu as regras antigas de navegação horizontal. Links redundantes de navegação superior foram removidos das telas alvo, mantendo ações locais e acessos contextuais como destaques do cardápio. As telas de conteúdo continuam isoladas em iframe do mesmo domínio para preservar os scripts existentes, sem recarregar sidebar/header na navegação. Abrir uma view diretamente no navegador redireciona ao shell.

Header, largura de sidebar, links ativos, superfícies e espaçamentos principais foram alinhados ao Master. Drawer móvel, foco, movimento reduzido e navegação por histórico permanecem disponíveis. CSS de impressão das comandas foi preservado integralmente, sem aplicar a paleta escura ao papel.

## Validação e publicação

301 testes locais aprovados. Cobertura de JWT/ator/prazo, autorização Master, loja/proprietário indisponíveis, auditoria/rollback, troca única, cookie seguro, preservação de sessão normal, isolamento de abas, encerramento, revogação pelo pai, imagens e SSE. Testes de navegador em VM verificam remoção do fragmento antes da troca, armazenamento somente do nonce, envio de contexto local, banner e retorno. Seis simulações de atualização e quatro de publicação inicial aprovadas.

Integração MySQL e smoke da cópia foram ampliados para fluxo assistido, upload/leitura privada de imagens, suspensão e revogação da sessão Master. Ensaio DDL contempla IDs signed/unsigned e cascade do pai. Não houve execução MySQL real ou conferência visual em navegador nesta sessão: Docker e navegador de automação estão indisponíveis.

No terminal do host:

```bash
bash /root/delivery-saas/scripts/update-live.sh
```

O atualizador cria backup final, ensaia e aplica 013 com dados anteriores preservados, valida HTTP/canário e publica a imagem. Após publicação, conferir o botão numa loja de teste, identidade no banner, navegação nos cinco módulos, retorno ao Master e encerramento após suspensão/logout.

Referências: [gestão de sessões — OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) e [perfis/validação JWT — RFC 8725](https://www.rfc-editor.org/rfc/rfc8725).
