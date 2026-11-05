# Cliente Google próprio para os backups

A tentativa de conexão recebeu o código OAuth, mas falhou porque Shared Drive
foi escolhido. Para o Drive pessoal, responder n à pergunta Shared Drive.
Não aumentar o escopo para corrigir essa seleção. A loja e os backups locais
continuam funcionando; a cópia externa ainda não foi ativada.

O rclone também informou a desativação do seu cliente OAuth compartilhado em
2026. A ativação automática foi ajustada para exigir cliente próprio antes de
enviar dados. É necessário criá-lo na conta Google pelo navegador.

1. Abrir https://console.cloud.google.com/ e criar o projeto Bebella Backups.
2. Em APIs e serviços → Biblioteca, habilitar Google Drive API nesse projeto.
3. Abrir Google Auth Platform e configurar o aplicativo, nome Bebella Backups,
   e-mail de suporte/contato próprio e público externo para uma conta Gmail.
4. Em Acesso a dados, usar somente https://www.googleapis.com/auth/drive.file.
5. Em Clientes, criar cliente OAuth do tipo Aplicativo para computador (Desktop).
6. Baixar o JSON e salvar como Bebella-google-client.json em Downloads.
   Não enviar o arquivo ou seu conteúdo na conversa.
7. Conferir o estado do aplicativo em Público/Audience. Para a automação,
   concluir a configuração de produção; aplicativos externos em teste podem
   receber autorizações que expiram após sete dias. Se a publicação solicitar
   configurações adicionais, resolver no Google Cloud antes de ativar a rotina.

O tipo Desktop usa retorno OAuth de localhost; não configurar como cliente Web.
Não é necessário mudar a loja, comprar domínio ou publicar dados de clientes
para configurar o cliente Desktop.

No PowerShell, enviar o JSON diretamente à pasta privada do servidor:

```powershell
scp "$HOME\Downloads\Bebella-google-client.json" root@179.198.120.188:/root/delivery-saas/backups/drive-private/google-client.json
```

Manter o túnel de autorização aberto em outro PowerShell:

```powershell
ssh -N -L 53682:127.0.0.1:53682 root@179.198.120.188
```

No servidor:

```sh
bash /root/delivery-saas/comando-usar-cliente-google.txt
```

A importação preserva password e password2 da criptografia, remove o token antigo
e os campos de drive de equipe, grava o cliente próprio e pede nova autorização.
Na pergunta navegador, responder y; na pergunta Shared Drive, responder n.
Se a janela não abrir automaticamente no servidor (xdg-open ausente), abrir no
computador o link localhost:53682 exibido. Isso é esperado em servidor sem GUI.

Após GOOGLE DRIVE CONECTADO, continuar com cópia da chave de recuperação para
local privado fora da VPS e comando-ativar-backup-google.txt, conforme
backups-google-drive.md. Não ativar a rotina com o cliente compartilhado.

Fontes:
- https://rclone.org/drive/#making-your-own-client-id
- https://developers.google.com/workspace/guides/create-credentials
- https://support.google.com/cloud/answer/15549945?hl=en

Validação: importação do cliente e preservação das chaves testadas localmente;
configuração OAuth e testes de envio também passaram localmente. Cliente próprio,
OAuth no host e envio real ainda pendentes.
