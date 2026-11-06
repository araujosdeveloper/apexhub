# Importação inteligente de cardápio

## Configuração

O backend usa a Responses API OpenAI, com modelo configurável (padrão `gpt-4.1-mini`), entrada multimodal e Structured Outputs. Referências oficiais consultadas:

- https://developers.openai.com/api/docs/guides/file-inputs
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://developers.openai.com/api/docs/models/gpt-4.1-mini

Na VPS, executar `bash scripts/configure-menu-ai.sh`: solicita chave oculta e modelo, grava `.env.ai` privado (0600), sem imprimir a chave ou alterar o serviço. Depois executar `bash scripts/update-live.sh`. O Compose de produção lê `.env.ai` opcional; sem chave, somente a extração retorna 503. Confirmação manual de JSON continua disponível. A chave e o arquivo privado são excluídos do Git e da imagem Docker. Não enviar chave pelo chat ou incluí-la no frontend. Disponibilidade do modelo e saldo/créditos dependem da conta do provedor.

## Segurança e upload

Ambas as rotas exigem **JWT Bearer** válido, sessão e empresa ativas, owner ou manager. Cookie sozinho não basta: o frontend pode obter token por `POST /api/auth/token` usando a sessão HttpOnly. Token assistido Bearer também é aceito enquanto válido; cookie assistido sozinho não atende ao contrato destas rotas.

`POST /api/tenant/menu/import-ai`: multipart/form-data com exatamente um campo `file` (File), sem tenant no formulário. JPEG/PNG até 2 MB, dimensões máximas conforme validador de imagens; PDF até 5 MB; corpo multipart até 6 MB. Valida MIME e assinatura do conteúdo. PDF precisa de cabeçalho e final reconhecíveis; isso não substitui um parser completo, e o provedor pode recusar documentos corrompidos/protegidos. Não executa scripts nem abre links de PDFs. Filename do cliente não vira caminho ou nome enviado ao provedor.

O arquivo fica temporariamente em memória, sem gravar no disco, e é transmitido inline por HTTPS ao provedor. Não se cria um arquivo persistente via Files API. Requisição usa `store:false`; isso não promete ausência de toda retenção pelo provedor. Arquivos, conteúdo, token JWT e chave não entram nos logs da aplicação. Limites por processo: duas extrações simultâneas, uma por tenant e cinco tentativas por tenant em 15 minutos. Em implantação com várias réplicas, aplicar também limite compartilhado no gateway. Timeout de IA de 60 segundos; resposta limitada a 512 KB e 12000 tokens de saída.

A IA recebe instrução para tratar conteúdo do documento como dado, ignorar instruções nele, não inventar preços/itens, devolver preço desconhecido como null e separar variações. Saída é validada novamente no servidor. Documento ilegível, recusa, JSON incorreto ou resposta incompleta não gera importação parcial; retorna erro. A revisão humana permanece necessária para omissões e erros de leitura.

## Prévia

Resposta `{success:true,data:{tenant_id,categories:[{name,products:[{name,description,price}]}],product_count,requires_review:true,warnings:[...],saved:false},message}`. Preço é texto decimal BRL (`"19.90"`) ou null quando ilegível. Nenhum INSERT acontece nesta etapa.

## Confirmação

`POST /api/tenant/menu/confirm-import`, `Content-Type: application/json` e JWT Bearer:

```json
{"categories":[{"name":"Lanches","products":[{"name":"Combo","description":"Revisado","price":"19.90"}]}]}
```

Aceita de 1 a 30 categorias e até 200 produtos no total, respeitando o limite JSON global de 64 KB. Nomes/descrições/preços usam os limites do catálogo. Todos os preços devem estar preenchidos e ser strings decimais não negativas; zero só quando explicitamente confirmado no JSON. IDs, tenant informado e campos adicionais não são usados. Cria **novas** categorias/produtos ativos, sem sobrescrever existentes, sem importar imagens ou adicionais nesta etapa. Não reenvia automaticamente confirmações: cada POST é um novo lote, sem chave de idempotência. O cliente deve impedir duplo clique e conferir o cardápio antes de repetir uma confirmação com resposta perdida.

Valida o lote inteiro antes de abrir conexão, bloqueia a empresa ativa e grava os registros com `req.tenantId` numa única transação. Qualquer falha provoca rollback de todo o lote. Responde 201 com IDs, category_count e product_count após commit. Não exige nova migração de schema.

## Validação

Testes locais cobrem autenticação/JWT, parsing multipart, MIME/magic, tamanho, prévia sem escrita, revisão de preço, escopo por tenant, rollback e contrato/respostas simuladas do provedor. Integração MySQL da atualização usa extração simulada (sem enviar dados ou gerar custos), verifica inserções reais e rollback provocado por CHECK do MySQL. A qualidade OCR/visão e uma chamada real dependem da chave configurada e precisam ser verificadas após a ativação.

## Diagnóstico de erros do provedor

`bash scripts/check-menu-ai.sh` envia uma chamada mínima de texto à Responses API usando a chave/modelo do aplicativo em execução, sem enviar o cardápio nem alterar o banco. Pode consumir poucos tokens. Não exige rebuild da imagem para executar: o script envia o código de diagnóstico por stdin ao container ativo. Exibe somente classificação conhecida, status HTTP, parâmetro estrutural e request ID válido; nunca imprime chave, documento ou mensagem bruta do provedor.

O painel distingue autenticação, créditos/limites, modelo/permissão, contrato da solicitação, arquivo e indisponibilidade temporária. Logs estruturados `menu_ai_provider_failed` preservam apenas os mesmos metadados seguros. Mensagens de erro não são repassadas diretamente da OpenAI, pois podem conter dados da requisição. Referência: https://developers.openai.com/api/docs/guides/error-codes

O diagnóstico mínimo aceito não garante que um PDF/imagem específico possa ser processado nem valida todo o contrato de extração; se ele passar, testar novamente o documento após a publicação e consultar a classificação da recusa. Chave/configuração não são alteradas automaticamente.
