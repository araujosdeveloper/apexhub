# Apresentação e rodapé da loja

No painel do lojista, abrir **Cardápio → Apresentação da loja**. Selecionar arquivos de capa/logo, revisar a prévia, preencher contato/endereço/avisos e clicar Salvar apresentação. PNG, JPEG e WebP até 2 MB por imagem; limite de dimensões conforme o validador de fotos existente. Há opção de remoção individual. Links antigos continuam funcionando enquanto não forem substituídos/removidos, mas os campos de imagem do painel agora são uploads.

O cabeçalho público mantém largura total, capa de 200–250 px, avatar circular e status/prazos reais. Capa ausente/falha usa gradiente; logo ausente/falha usa iniciais. Contato, e-mail, Instagram, Facebook, avisos, horários e localização ficam no rodapé, em colunas adaptáveis. O corpo do cardápio e o checkout mantêm o tema claro.

A localização mostra endereço e uma indicação visual ilustrativa, com link para Google Maps; não inventa coordenadas nem representa mapa geocodificado. Sem endereço público, usa o de retirada; sem ambos, informa ausência. Telefone público vazio usa o WhatsApp da empresa. Horários registrados e fuso são exibidos sem inventar horários para dias não configurados. Referência de link: https://developers.google.com/maps/documentation/urls/get-started .

## Dados e permissões

`GET` / `PUT /api/admin/store-profile`: owner/manager com autenticação tenant ativa, incluindo acesso assistido. O tenant vem sempre de req.tenantId. O perfil em company_operations.config.store_profile contém endereço (320), telefone (10–15 números ou vazio), aviso (500), e-mail (254), instagram_url/facebook_url (2048) e os caminhos de imagens. Campos ausentes na edição preservam o valor atual. Caminhos locais de imagens de outra loja/tipo são rejeitados. Redes sociais exigem HTTPS e host da rede correspondente. Textos são renderizados com textContent; e-mail e query do mapa são codificados.

`POST /api/admin/store-profile/images/:kind`, kind banner/logo: multipart/form-data com exatamente um campo file. Autenticação e perfil antes de ler o arquivo. O parser nativo recebe corpo limitado a 2 MB + 64 KB de multipart; valida tamanho real, MIME e assinatura/dimensões com imageInfo. Não usa o nome do arquivo como caminho, nem grava arquivo no disco efêmero. `DELETE` no mesmo caminho remove somente aquela imagem e limpa sua referência. URL gerada: `/api/store-images/:company/:kind?v=<sha256>`.

`GET /api/store-images/:company/:kind`: binário público de empresa ativa, com MIME validado, nosniff, ETag e revalidação de cache. A leitura é pública por serem imagens do cardápio; a escrita é exclusiva do tenant autenticado. Remoção/substituição afeta somente a chave (company_id,kind). Campos de tenant enviados em query/formulário não escolhem o destino da gravação.

A migração **015-store-images.sql** cria store_images com FK para companies e PK composta. IDs acompanham INT/INT UNSIGNED da base real. Arquivos em MEDIUMBLOB são incluídos nos backups MySQL; o JSON guarda só a URL relativa. Binário e referência são atualizados na mesma transação, sob bloqueio da empresa. Alterar operação preserva apresentação; alterar apresentação preserva taxas, horários e modalidades.

O formulário salva contato e cada imagem em requisições separadas. Uma falha pode deixar parte da apresentação salva; a interface informa isso e mantém apenas os arquivos pendentes para nova tentativa. Upload repetido substitui a mesma chave, sem criar imagens duplicadas. Prévias usam object URLs locais e são liberadas após envio/troca/saída da página.

## Verificação

Testes locais cobrem escopo, MIME falso, multipart, limite, cache, remoção, paths entre lojas, links públicos, prévias e nova tentativa parcial. A validação MySQL e a cópia de ensaio testam gravação binária real, preservação de operação/perfil e DDL nos dois tipos de ID. A conferência visual em navegador depende da publicação.
