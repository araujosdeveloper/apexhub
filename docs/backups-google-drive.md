# Cópias criptografadas no Google Drive

Estado em 03/11/2026 às 17:45 UTC, conforme saída fornecida pelo host: OAuth
concluído, primeiro envio real verificado por download/descriptografia e
automação configurada com OnSuccess=delivery-live-drive.service. Backup inicial:
`live-20261103T174509Z-1258445`. O responsável confirmou que salvou a chave de recuperação no computador,
fora da VPS. A primeira execução automática futura ainda precisa ser acompanhada.

A skill Google Drive foi lida e a integração conectada foi consultada para uma
pasta Delivery SaaS Backups; não houve resultado. Não foi transferido nenhum dump
pela integração. A ferramenta não fornece credenciais OAuth nem agendamento ao
servidor; os envios automáticos usam rclone com autorização própria da VPS.

## 1. Conectar a conta Google

No PowerShell do computador, deixar aberto:

```powershell
ssh -N -L 53682:127.0.0.1:53682 root@179.198.120.188
```

Em outro terminal, no servidor:

```sh
bash /root/delivery-saas/comando-conectar-google.txt
```

O script usa imagem oficial rclone 1.75.2 e fixa o ID local após pull. Cria
configuração privada somente se ela ainda não existir; nunca regenera as chaves
numa conexão já configurada. Pede autorização OAuth. Responder y à opção de usar
navegador, abrir no computador o link localhost:53682 exibido e escolher a conta
Google que deve guardar os backups. Se perguntar sobre Shared Drive, responder n
para uma conta pessoal. O listener OAuth fica em localhost da VPS, acessível pelo
túnel SSH; a porta não precisa ser aberta no firewall.

Não enviar senha Google, tokens, rclone.conf ou conteúdo do arquivo de recuperação
na conversa. Autorizar a conta apenas no navegador do Google. O escopo drive.file
limita o rclone aos arquivos/pastas que ele cria; não dá acesso geral aos demais
arquivos do Drive. A pasta Delivery-SaaS-Backups é criada pelo rclone, não pela
integração, para ser acessível com esse escopo.

## 2. Guardar a chave fora da VPS

Depois de GOOGLE DRIVE CONECTADO, no PowerShell:

```powershell
scp root@179.198.120.188:/root/delivery-saas/backups/drive-private/RECUPERACAO-PRIVADA.txt "$HOME\Downloads\Bebella-recuperacao-privada.txt"
```

Guardar esse arquivo em local privado protegido, por exemplo em cofre de senhas.
Ele contém as duas chaves que permitem descriptografar os arquivos, apesar da
aparência codificada, e não contém os tokens OAuth. Não enviá-lo sem criptografia
para a mesma pasta Drive dos backups. A senha da loja não recupera essas chaves.
Se a VPS e todas as cópias dessas chaves forem perdidas, os backups não poderão
ser recuperados. A configuração no servidor é privada (0700/0600), mas não usa
criptografia adicional em repouso: root consegue lê-la.

## 3. Validar o envio e ativar a rotina

No servidor:

```sh
bash /root/delivery-saas/comando-ativar-backup-google.txt
```

O instalador exige backup diário local ativo, cria backup atualizado e envia
apenas essa pasta concluída por delivery_crypt. Configuração OAuth, chaves e
outras pastas da VPS não são enviadas. O resultado variável restore-check.json
não integra a cópia remota imutável; os arquivos fixos e seus checksums vão juntos.
Rclone crypt cifra conteúdo, nomes de arquivos e subpastas antes da transmissão.

Depois, rclone check --download baixa/descriptografa e compara o conteúdo para
conferir o envio. A conferência remota não substitui o teste de restauração MySQL,
que já é executado separadamente. Se qualquer fase falhar, não se registra novo
sucesso nem se instala o gatilho automático. A cópia remota parcial é mantida
para nova tentativa; os backups locais não são removidos.

Após envio confirmado, instala delivery-live-drive.service e o drop-in
OnSuccess=delivery-live-drive.service no serviço de backup local. Cada conclusão
bem-sucedida pelo systemd dispara o envio. Não depende de um segundo horário
fixo; falha no Drive não desativa os backups locais. Chamadas manuais diretas a
backup-live.sh não disparam o gatilho; usar upload-drive-backup.sh após elas.

A retenção local continua em 30 cópias. No Drive não há exclusão automática:
cópias se acumulam e é necessário acompanhar a quota disponível. A rotina não
sincroniza exclusões locais com a nuvem. A configuração é protegida por lock e
os arquivos locais são protegidos contra retenção durante o envio/verificação.

## Acompanhar e recuperar

```sh
systemctl show delivery-live-backup.service --property=OnSuccess
journalctl -u delivery-live-drive.service -n 50 --no-pager
cat /root/delivery-saas/backups/drive-private/last-upload.json
```

O recibo registra backup e data da última conferência bem-sucedida, sem chaves.
Não confundir uma conferência antiga com sucesso da execução mais recente.
Ainda não há alerta por e-mail ou WhatsApp.

Em máquina de recuperação: instalar rclone, criar delivery_drive com autorização
Google e escopo drive.file, adicionar a seção delivery_crypt do arquivo privado,
listar/copiar os arquivos através de delivery_crypt (não pelo remote bruto).
Conferir SHA256SUMS/gzip e restaurar em banco isolado, seguindo o procedimento
local antes de qualquer troca da aplicação. Reautorizar a conta Google não altera
as chaves de criptografia; manter password e password2 originais.

Testes locais aprovados: três de configuração/recuperação e dois de fluxo de
envio, incluindo rejeição de falha na comparação remota. Sintaxe shell e Node
verificada. Nenhum upload real executado por esta sessão.

Referências oficiais:
- https://rclone.org/drive/
- https://rclone.org/crypt/
- https://rclone.org/remote_setup/
- https://rclone.org/commands/rclone_check/
- https://www.freedesktop.org/software/systemd/man/latest/systemd.unit


## Ajuste após a autorização inicial no host

OAuth recebeu código em 03/11/2026 às 03:32 UTC, mas a seleção Shared Drive=y
resultou em 403 por escopo insuficiente para listar drives de equipe. Para Drive
pessoal selecionar n; manter o escopo drive.file. Não houve envio externo.
A imagem também confirmou aposentadoria do cliente compartilhado em 2026.
A ativação passou a exigir cliente OAuth próprio. Orientações e importação segura
em google-cliente-proprio.md e comando-usar-cliente-google.txt. A importação
preserva chaves da criptografia e remove o token antigo antes da reautorização.
