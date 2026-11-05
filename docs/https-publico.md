# HTTPS público por IP — preparação

A prévia foi validada pelo responsável em 03/11/2026: login, três produtos,
dois pedidos históricos, novo pedido e transição de status funcionaram.
O túnel usa localhost:20128. Esses pedidos de teste não serão migrados.

Preparação do HTTPS, no terminal do host:

```sh
bash /root/delivery-saas/comando-preparar-https.txt
```

O script prepara apenas Caddy e uma página de manutenção. Não encaminha a API
antiga nem a prévia e não altera PM2, MySQL ou n8n. Publica TCP 80 e 443 em projeto
Compose separado, com volumes persistentes de certificados. Se as portas estiverem
ocupadas, o Compose falha sem parar o serviço que as ocupa. O script não modifica
firewall nem painel do provedor. Portas 80 e 443 devem estar acessíveis externamente.

É usado Caddy 2.11.7 com emissor ACME Let's Encrypt e perfil shortlived,
que permite certificado público para IP. A renovação é automática pelo Caddy,
que deve permanecer em execução com /data persistente. Os certificados desse
perfil duram cerca de seis dias; é necessário monitorar a renovação.
Não há certificado autoassinado como alternativa automática.

O script valida a configuração pelo próprio Caddy e consulta
https://179.198.120.188/deployment-health usando verificação TLS normal,
com conexão direcionada ao localhost do host. Após o resultado positivo,
abrir esse endereço no computador para validar também a rota externa.
Deve aparecer delivery-https-ready, sem alerta de certificado. A raiz retorna
503 de preparação e não representa a loja publicada.

Consulta de estado/logs:

```sh
docker compose --env-file .env.public-edge -f compose.edge.yml ps
docker compose --env-file .env.public-edge -f compose.edge.yml logs --tail 60 edge
```

Para remover somente o serviço de HTTPS (sem apagar os certificados):

```sh
docker compose --env-file .env.public-edge -f compose.edge.yml down
```

Não usar down -v; os volumes guardam a identidade ACME e os certificados.
A troca futura da rota deve preservar /deployment-health para verificação e
ser validada antes de caddy reload. Preservar o Host público para a proteção
de origem da API. HTTPS é necessário para SECURE_COOKIES=true em produção.
A API atual não habilita trust proxy irrestrito.

Validação local: bash -n e docker compose config --quiet passaram.
Execução real, validação Caddy e emissão do certificado pendentes no host:
esta sessão continua sem acesso ao socket Docker. Se a emissão falhar,
o script preserva o serviço e mostra logs para diagnóstico, sem modificar a loja.

Fontes consultadas em 03/11/2026:
- https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability
- https://caddyserver.com/docs/caddyfile/directives/tls
- https://caddyserver.com/docs/caddyfile/options
- https://github.com/caddyserver/caddy/releases/tag/v2.11.7
