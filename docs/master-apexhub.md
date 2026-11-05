# Master ApexHub

Master ApexHub publicado em 05/11/2026 às 18:06 UTC. STATUS=PUBLICADO e ponteiro latest-update confirmados em `reports/update-20261105T180428Z-216080`; backup final `backups/live/live-20261105T180606Z-221182`. Integração MySQL real aprovada em `reports/mysql-validation-20261105T180459Z-218120.log`. Migração 012, ensaio da cópia, preservação dos dados anteriores, canário e verificações HTTP aprovados. Criação da conta Master e conferência visual pelo responsável ainda não confirmadas. Não há conta Master padrão, nem elevação automática de donos de lojas.

## Publicar e criar acesso

No terminal do host:

```bash
bash /root/delivery-saas/scripts/update-live.sh
```

Após `ATUALIZAÇÃO PUBLICADA`, criar a primeira conta em terminal interativo:

```bash
bash /root/delivery-saas/scripts/create-master.sh
```

O comando solicita nome, e-mail e senha de 16 a 128 caracteres, com confirmação e entrada oculta. Usa exclusivamente o container da aplicação publicada, identificado pelo ponteiro e rota pública. Não recebe senha por argumento, não cria conta padrão e não altera contas existentes. E-mail já cadastrado é recusado. Pode provisionar outros administradores Master pelo mesmo procedimento; essa operação é restrita a quem possui acesso ao terminal/Docker do servidor.

Acesso: `https://179.198.120.188/master-login.html`. Depois do login: `/master.html`. As contas dos estabelecimentos continuam em `/login.html`. Logout Master não encerra a sessão independente de lojista no mesmo navegador.

## Interface

HTML5 semântico, App Shell próprio e persistente, seis seções por hash, busca por nome/slug, e-mail do responsável e identificador fiscal cadastrado. Dark mode: fundo/sidebar #121212, cartões #1E1E1E, ação #FF7F00 e texto #F5F5F5. Header fixo, drawer móvel, foco visível, tabela com rolagem, formulário em dialog, feedback de erro/carregamento e transições respeitando movimento reduzido.

Arquivos: `frontend/master.html`, `master.css`, `master.js`, `master-login.html` e `master-login.js`. Tailwind CSS 2.2.19 via CDN de CSS fixado por versão, sem JavaScript remoto; `master.css` fornece tokens, componentes e fallback responsivo completo se a CDN falhar. O CSS externo é carregado sem bloquear a exibição. Uma compilação local de Tailwind não foi possível nesta sessão por indisponibilidade de DNS do registro npm; o projeto não ganhou dependência de execução nem etapa de build adicional.

Dados recebidos são renderizados com `textContent`, sem interpolação HTML. Consultas têm sequência para descartar respostas antigas. Paginação de 20 empresas. Busca e navegação mantêm sidebar/header. O gráfico mostra os últimos 12 meses, incluindo meses sem cadastros, com alternativa textual acessível. Atualização manual indica horário UTC; falhas identificam dados anteriores como potencialmente desatualizados.

## Dados e ações

Lojas ativas e totais vêm de `companies`; pedidos do dia vêm de `orders.created_at`, em UTC. Crescimento considera cadastros mensais; planos agrupam os códigos/status registrados em `subscriptions`. Nenhum valor exemplificativo é usado. Saúde de API/MySQL indica o sucesso da última consulta; tempo ativo e RSS pertencem ao processo Node.js, sem representar uptime de toda a infraestrutura.

Edição permite nome, identificador fiscal opcional e status. O identificador é normalizado para letras/números em maiúsculas (até 32), único entre empresas. É um registro informado, sem validação cadastral, dígito verificador ou consulta à Receita. Cadastros anteriores começam sem identificador; é necessário informá-lo antes de buscar por CNPJ.

Toda alteração exige motivo e revisão do registro. Empresa/admin são bloqueados na transação; versão divergente retorna 409. Suspender define `companies.active=0` e remove sessões de todos os usuários daquela empresa, com auditoria atômica. A autenticação existente também consulta a empresa ativa. Reativar libera novo login, sem restaurar sessões removidas. Pedidos e cadastros anteriores são preservados. A suspensão não cancela pedidos em andamento. Nome/status/CNPJ não alteram assinatura nem cobrança.

MRR, conversão, percentual de uptime, gateway/repasses, conexões ativas e Docker aparecem como não integrados/não monitorados. Não há acesso ao socket Docker, segredos, logs brutos ou dados de cartão. `Acessar como loja` permanece desabilitado até existir acesso assistido auditável. Financeiro e configurações apresentam o estado das integrações; não simulam CRUD de preços, cobrança ou infraestrutura.

## Segurança e migração

Migração aditiva `012-platform-master.sql`: `platform_admins`, `platform_sessions`, `platform_audit` e `platform_tenant_profiles`. Perfil fiscal usa o tipo signed/unsigned real de `companies.id` e FK. O esquema inicial contém as mesmas tabelas para novos bancos. A migração não cria usuários ou muda registros anteriores.

Rotas `/api/master/*` usam somente a sessão Master, com token aleatório armazenado por SHA-256, validade de oito horas e cookie HttpOnly, SameSite=Strict, Secure em produção, Path=/api/master. Senha scrypt; entrada limita tentativas por IP e usa verificação de hash também para e-mail desconhecido. Proprietários/gerentes/operadores não ganham acesso Master; cookie Master não concede acesso às APIs das lojas. Escritas passam pela proteção de origem existente. Login e alterações são auditados sem tokens ou senhas. Páginas Master mantêm X-Frame-Options DENY e não entram no iframe do painel lojista.

## Validação

246 testes locais aprovados, sintaxe backend/frontend válida e seis simulações do atualizador aprovadas. Compose validado sem imprimir configuração/segredos. Novos testes cobrem isolamento de cookies, hashes, integrações nulas, busca, paginação, revisão, suspensão, reativação, rollback/auditoria, identificador duplicado e provisionamento.

Integração MySQL real, ensaio de migração para INT/INT UNSIGNED e smoke da cópia aprovados pelo atualizador no host em 05/11/2026 às 18:06 UTC, com backup, preservação dos dados e verificações HTTP dos novos endpoints/assets. Não houve teste visual em navegador nesta sessão. Após publicação: conferir desktop/celular, criar conta Master, verificar isolamento de contas e experimentar edição/suspensão somente numa loja de teste.
