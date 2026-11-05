# Prévia no navegador sem trocar a aplicação atual

Os backups externos informados pelo responsável não são desta aplicação e foram
desconsiderados como caminho de retorno. A etapa seguinte é validar uma cópia,
sem depender da recuperação do processo antigo.

No terminal do host, executar:

```sh
cd ~/delivery-saas
bash scripts/start-preview.sh backups/legacy-20261102T183428Z-75137 bebellahotdog@gmail.com
```

O script confere checksums e gzip; cria projeto Compose exclusivo com MySQL em
tmpfs, sem volumes ou conexão ao banco legado; restaura e migra a cópia usando as
mesmas guardas do ensaio aprovado. Recusa seleção automática se não houver
exatamente uma loja ativa. Cria o proprietário após confirmação do slug e senha
oculta de 12 a 128 caracteres. Não cria o acesso no banco original.

A API usa conta preview_app, separada de root, com acesso somente ao banco da
prévia. Essa conta recebe permissões de inicialização padrão do MySQL; a restrição
a DML será necessária no ambiente final de produção. Root só é usado no preparo.
A API roda em modo de desenvolvimento com cookies locais, atrás de túnel SSH;
esta configuração não deve ser publicada como produção.

A porta é vinculada a 127.0.0.1:3002. O banco fica somente na rede interna;
a aplicação participa também de uma rede bridge de acesso para publicar a porta local. No computador
local, abrir outro terminal:

```sh
ssh -N -L 3002:127.0.0.1:3002 root@179.198.120.188
```

Manter o túnel aberto e acessar `http://localhost:3002/login.html`. Entrar com
o e-mail indicado e a senha de teste definida no servidor. Conferir catálogo,
dois pedidos históricos sem itens, criar pedido e acompanhar mudança de status.
O navegador deve usar localhost para permitir o checkout neste modo de prévia.

O backup representa o estado coletado às 18:34 UTC, não dados atuais em tempo real.
A prévia não recebe atualizações do banco original. Mudanças feitas nela serão
perdidas quando o container MySQL for removido; não usar para operação real.
Não usa PM2, não reinicia a loja e não muda n8n, proxy ou configurações do host.

## Gerenciamento e limpeza

O script imprime o caminho `reports/preview-<data>-<id>/manage.sh`.
Para consultar, executar `bash CAMINHO/manage.sh ps`.
Para remover somente esse ambiente, executar `bash CAMINHO/manage.sh down`.
Após remoção confirmada, apagar `preview.env` na mesma pasta; ele contém senhas
privadas e não deve ser enviado na conversa. Relatório e metadados podem ficar.
Não remover pastas/env antes da limpeza, pois são usados pelo Compose.

Se o preparo falhar, o script tenta remover o próprio projeto. Se a limpeza
falhar, imprime o comando de gerenciamento e preserva as credenciais necessárias
para nova tentativa. Nenhuma limpeza usa nomes ou volumes do legado.

Validação local: bash -n, npm run check, suíte unitária e Compose config aprovados.
Execução Docker real desta nova prévia ainda pendente no terminal do host.


## Correção de acesso em 03/11/2026

O host informou containers saudáveis, mas sem porta publicada, com recusa na
conexão do túnel. A configuração anterior conectava a API somente à rede interna.
Foi adicionada a rede access (bridge) exclusivamente à API. O banco continua na
rede interna existente. Aplicar com `up -d --no-deps --force-recreate --wait app`
pelo manage.sh do projeto. Não executar down nem recriar mysql, pois os dados da
prévia estão em tmpfs. Validar a porta publicada e /api/health pelo host antes de
retomar o navegador em http://localhost:20128/login.html (porta local do túnel).
