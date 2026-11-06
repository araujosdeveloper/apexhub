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

## Ajuste da criação no terminal — 05/11/2026

Após relato de travamento, `scripts/create-master.sh` passou a solicitar os dados diretamente no terminal do host, com Bash `read`, senha oculta e restauração do terminal ao cancelar. Docker usa `exec -T` e recebe JSON por stdin, sem senha em argumentos, variáveis exportadas ou arquivos temporários. Usa o módulo de provisionamento já publicado; não exige rebuild/republicação. A causa do travamento original não foi confirmada por mensagem de erro do host.

Quatro testes com PTY e Docker/banco simulados aprovados: criação, entrada oculta, confirmação divergente, senha curta e cancelamento. A criação de uma conta real pelo responsável continua sem confirmação. `bash scripts/check-master.sh` oferece diagnóstico somente de leitura, mostrando se o terminal é interativo e a contagem de contas/contas ativas, sem mostrar e-mails, hashes, senhas ou tokens.

## Recuperação de credenciais pelo terminal

Para o erro `Credenciais Master inválidas.`, quando a conta já existe e a senha não é aceita:

```bash
bash /root/delivery-saas/scripts/recover-master.sh
```

Informar o e-mail Master e uma nova senha de 16 a 128 caracteres, repetida para confirmação. A senha não aparece ao digitar. O comando exige terminal interativo e acesso ao container publicado identificado por ponteiro/rota. Usa Docker sem TTY; dados e programa são transmitidos por stdin, sem credenciais em argumentos, ambiente exportado ou arquivos temporários. Usa o código de recuperação do host e módulos de segurança já disponíveis na imagem; não exige republicação.

Atualiza somente a conta Master existente do e-mail informado: senha scrypt, reativação, revogação das sessões e auditoria `master_access_recovered`, numa transação. Confere o hash gravado antes de concluir. Não cria conta, não eleva lojista e não modifica empresas ou usuários de lojas. Conta inexistente, falha de auditoria ou verificação divergente revertem a operação. Não há endpoint HTTP de recuperação pública.

A mensagem de sucesso é `SENHA MASTER REDEFINIDA E VERIFICADA.` seguida do ID. Voltar a `/master-login.html` e usar os dados informados. Se não existir conta Master para o e-mail, o comando informa o problema sem alterar outro cadastro; usar criação de conta quando apropriado. A limitação de tentativas do login não é desabilitada pelo script.

269 testes backend e quatro testes de terminal aprovados após a preparação desta correção. A recuperação de uma conta real ainda depende da execução pelo responsável no host, pois o Docker desta sessão não permite acesso.

## Configuração automática solicitada pelo responsável

`scripts/setup-master-auto.sh` configura o e-mail Master indicado pelo responsável (`araujosdeveloper@gmail.com`), criando a conta se não existir ou recuperando apenas ela se já existir. Gera uma senha aleatória de 32 caracteres com crypto.randomBytes, verifica a senha gravada e só então exibe as credenciais no terminal. Não exige digitação de senha nem rebuild da imagem.

A senha fica em memória/stdin durante a operação; uma cópia é salva após sucesso em `reports/master-access-*/credentials.txt`, diretório 700 e arquivo 600, ignorados pelo Git. Novas execuções geram outra senha para essa conta. O processo não altera lojistas nem chaves JWT. Sete testes de configuração automática e recuperação aprovados. A tentativa de execução nesta sessão terminou bloqueada pelo socket Docker, antes de gerar senha ou alterar qualquer conta; execução real permanece pendente no host.

O responsável confirmou que o acesso Master passou a funcionar após a configuração automática. A API inicial Super Admin está documentada em [api-super-admin.md](api-super-admin.md); seus novos recursos não alteram o login existente nem acrescentam formulários à interface atual.

Preparado: [Acessar como loja](acesso-assistido.md), com prazo de até uma hora, ator/auditoria, cookie e contexto independentes, banner e retorno ao Master. O botão anteriormente desabilitado foi conectado ao endpoint de impersonation e requer empresa/proprietário ativos. Migração 013; publicação e validação MySQL real ainda pendentes.
