# Conectar o WhatsApp da loja

O proprietário abre **Configurações → WhatsApp automatizado** e autoriza um
número comercial na Meta. A opção usa a permissão da assinatura e aparece
quando a plataforma estiver configurada. O telefone de contato da loja é
independente dessa autorização.

Configure no ambiente do processo Apex os valores de `docker.env.example`
para o aplicativo da Meta e seu Embedded Signup v4. Gere a chave de proteção
dos tokens com `openssl rand -hex 32` e guarde-a fora do repositório. Ao usar
Docker Compose, encaminhe essas variáveis explicitamente para o serviço da
aplicação. Cadastre na Meta o domínio público usado pelo painel e confirme
as permissões de gerenciamento e envio antes de testar com a Bebella.

O vínculo valida a conta e o número na Graph API. A autorização fica
criptografada no banco e associada à empresa, ao identificador da conta e
ao identificador do número. O banco impede vínculo duplicado de número.

Esta entrega termina no vínculo do número. A ativação do atendimento depende
da integração com o código do bot da VPS, da inscrição da conta no webhook
e da verificação de recebimento e envio com a credencial da loja. O piloto
deve conferir ainda se a Meta exige registro adicional do número escolhido.
A autorização do número e a ativação do bot são estados distintos.
