# Fotos dos produtos

Publicado em 04/11/2026 às 18:33 UTC. STATUS=PUBLICADO confirmado em `reports/update-20261104T183158Z-2883930`; backup final `backups/live/live-20261104T183310Z-2888314`. Conferência visual concluída pelo responsável em 04/11/2026. Atende a todos os produtos e categorias existentes, incluindo combos, bebidas e lanches.

## Usar no painel

Em **Cardápio**, crie um produto ou clique em **Editar**. O campo **Foto do produto** permite escolher um arquivo do computador/celular e mostra a prévia. Salvar o produto também envia a foto. Deixar o campo vazio conserva a imagem existente. Marcar **Remover a foto ao salvar** apaga somente a imagem.

São aceitos JPG/JPEG, PNG e WebP, até 2 MB, com até 8192 pixels por lado e 32 megapixels. Não é necessário hospedar imagem em outro serviço ou informar um link. Há uma foto por produto; trocar substitui a anterior.

O painel mostra miniaturas na lista de produtos. O cardápio público, os destaques e as sugestões usam a foto atual. Produtos sem foto continuam funcionando normalmente. Falha ao carregar uma imagem remove a miniatura e mantém nome, preço e botão. Fotos no cardápio usam carregamento sob demanda.

Produtos pausados podem ter sua foto alterada no painel. Também é possível manter a categoria pausada atual ao editar o produto; mover para uma nova categoria pausada continua proibido. Fotos de produto/categoria/loja pausados não são servidas pela rota pública. A prévia administrativa permanece disponível a donos e gerentes da própria loja.

## Falhas e permissões

Dono e gerente podem enviar, consultar a prévia e remover fotos. Operador não altera imagens. O servidor verifica o produto e a empresa da sessão antes de gravar/remover e valida assinatura do arquivo, tipo informado, tamanho e dimensões. SVG e arquivos não suportados são recusados.

Dados do produto e foto têm gravações separadas. Se o produto for salvo e o envio da imagem falhar, a mensagem informa isso e conserva o ID para tentar novamente, sem criar outro produto. A seleção pode ser substituída por outro arquivo ou descartada. Trocar de produto na edição descarta a foto ainda não enviada; durante o salvamento a seleção e a troca de produto ficam bloqueadas.

Fotos não alteram o preço, os adicionais, o conteúdo de pedidos antigos ou o checkout. Páginas de cardápio já abertas precisam ser atualizadas para refletir mudanças no catálogo.

## Persistência e publicação

Migração `009-product-images.sql` cria `product_images`, com o mesmo tipo de ID da tabela real de produtos. Guarda bytes, tipo e SHA-256; o catálogo não recebe cópia da imagem em cada listagem. Instalações novas têm o mesmo esquema em `001-initial.sql`.

As imagens ficam no MySQL e entram nos backups existentes com `--hex-blob`. Não dependem da camada temporária do contêiner ou de uma pasta de uploads. A verificação de preservação calcula o hash dos BLOBs no MySQL, evitando carregar todas as fotos no processo Node durante atualizações.

GET público `/api/product-images/:id` verifica disponibilidade, responde com o tipo de imagem e `nosniff`, e revalida cache/ETag antes de reutilizar conteúdo. Rotas autenticadas GET/PUT/DELETE `/api/admin/products/:id/image` limitam a operação à loja da sessão. PUT recebe bytes com Content-Type correspondente. O catálogo administrativo e público retornam `image_url`; produtos sem foto retornam null.

193 testes locais aprovados: formatos/dimensões, limite de bytes, MIME incompatível, permissões, isolamento, rollback, leitura binária, remoção, cache, prévia, troca de produto, tentativa após falha de foto, renderização em sugestões e preservação por hash. Integração MySQL preparada para upload/leitura, disponibilidade de categorias, prévia privada, exclusão e isolamento, com foto persistida no teste. Ensaio 009 inclui IDs assinados/não assinados e preservação de bytes; smoke da cópia envia e lê uma imagem real.

Integração MySQL real aprovada em `reports/mysql-validation-20261104T183224Z-2885529.log`, incluindo upload, leitura binária, categorias pausadas, remoção e isolamento. 193 testes aprovados; migração 009, ensaio da cópia, preservação dos dados, canário e aplicação ativa aprovados pelo atualizador.

Após publicar, edite um combo e uma bebida, escolha fotos e salve. Confira a prévia, a miniatura no painel e a imagem no cardápio. Teste substituir/remover uma foto e atualizar a página. Atendimento/WhatsApp/IA continuam para a última etapa.
