# Conectar o WhatsApp da loja

O proprietário abre **Configurações → WhatsApp automatizado** e autoriza um
número comercial na Meta. A opção usa a permissão da assinatura e aparece
quando a plataforma estiver configurada. O telefone de contato da loja é
independente dessa autorização.

Copie as cinco variáveis do bloco WhatsApp em `docker.env.example` para
`.env.whatsapp`, na pasta do projeto, com permissões 0600. O Compose de
desenvolvimento e o de publicação carregam esse arquivo no serviço da aplicação.
Preencha os dados do aplicativo da Meta e seu Embedded Signup v4. Gere a chave
de proteção dos tokens com `openssl rand -hex 32` e guarde-a fora do repositório.
Cadastre na Meta o domínio público usado pelo painel e confirme
as permissões de gerenciamento e envio antes de testar com a Bebella.

O vínculo valida a conta e o número na Graph API. A autorização fica
criptografada no banco e associada à empresa, ao identificador da conta e
ao identificador do número. O banco impede vínculo duplicado de número.

Esta entrega termina no vínculo do número. A ativação do atendimento depende
da integração com o código do bot da VPS, da inscrição da conta no webhook
e da verificação de recebimento e envio com a credencial da loja. O piloto
deve conferir ainda se a Meta exige registro adicional do número escolhido.
A autorização do número e a ativação do bot são estados distintos.

Configure também `WHATSAPP_WEBHOOK_VERIFY_TOKEN` no mesmo arquivo privado e
use o mesmo valor na configuração do webhook da Meta. O endereço do callback
no domínio público é `/api/webhooks/whatsapp`. A inscrição da conta no campo
`messages` permite testar a recepção. O webhook valida a assinatura sobre o
corpo original e só grava mensagens de números vinculados a lojas elegíveis.
As mensagens ficam na caixa de entrada persistente para processamento posterior.

Para testar a resposta inicial, configure `WHATSAPP_REPLY_PILOT_COMPANY_ID`
e `WHATSAPP_REPLY_PILOT_SENDER` em `.env.whatsapp` e recrie a aplicação.
Use o identificador interno da loja e o telefone autorizado, com código
do país e somente dígitos. Do telefone autorizado, envie “cardápio” ao
número vinculado à loja. O Apex responde com o link do cardápio da loja.
A aceitação da mensagem pela Meta é registrada separadamente do recebimento
no aparelho. Em caso de resultado incerto, confira o aparelho antes de um
novo teste. Para desligar o piloto, remova as duas variáveis e recrie a aplicação.

No piloto do carrinho, envie `PRODUTOS` e `OPÇÕES 12` (trocando 12 pelo
código exibido). Por exemplo, envie `ADICIONAR 12 1 | ovo:1 | sem batata palha`
e depois `ADICIONAR 12 1 | salsicha:1 |`. Use os códigos reais dos adicionais.
Consulte `CARRINHO`, depois envie `ENTREGA Nome | Rua | 10 | Bairro | Dinheiro`
ou `RETIRADA Nome | Pix`. Confira o resumo antes de enviar `CONFIRMAR código`.
O piloto registra pedidos reais no checkout. Use uma loja de teste para
validar sem acionar a operação da Bebella. A migração 033 persiste carrinhos
por empresa, número comercial e remetente.

Para pedir troco, use `Dinheiro 50,00` no campo de pagamento. O resumo
mostra o valor entregue e o troco. Após a confirmação, a informação
aparece nas observações do pedido no painel.

No piloto, envie `Quero falar com um atendente`. No painel da loja,
abra **Configurações → WhatsApp automatizado → Abrir atendimentos do WhatsApp**.
A equipe pode assumir a conversa, conferir mensagens recentes e o carrinho,
responder pelo número da loja e retomar o bot. Ao retomar, o bot só processa
mensagens posteriores à retomada. A migração 034 persiste a pausa e as
tentativas da equipe. Resultado incerto precisa ser conferido no WhatsApp.

A migração 035 adiciona o controle de automação por loja. O proprietário
pode testar a credencial e a inscrição da conta na Meta, ativar ou pausar
o bot, renovar a autorização do mesmo número e desconectar o vínculo local.
Antes da ativação, configure a assinatura do webhook no aplicativo Meta e
registre o número na plataforma quando exigido. Teste recebimento e envio
com a Bebella para confirmar o funcionamento. Ao ativar, o bot processa
mensagens novas; pedidos anteriores permanecem no histórico.
