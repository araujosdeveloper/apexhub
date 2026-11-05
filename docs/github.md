# Versionamento no GitHub

O repositório deve conter fontes, testes, migrações, exemplos de configuração e scripts de operação. Recomenda-se um repositório privado para o ApexHub.

Não enviar `.env`, credenciais/chaves, configurações pessoais de ferramentas, backups, relatórios de produção, dependências instaladas, estado dos containers ou ponteiros/rotas da publicação atual. O `.gitignore` cobre esses arquivos. A documentação técnica inclui referências operacionais à VPS e não substitui o backup dos dados.

## Preparar uma cópia das fontes

```bash
bash /root/delivery-saas/scripts/prepare-github.sh
```

O script gera uma pasta `reports/github-export-XXXXXXXX/project`, usando uma lista explícita de pastas de código. Mantém migrações SQL (necessárias à instalação), mas exclui dumps/backups. Verifica padrões de chaves privadas e tokens comuns e recusa links simbólicos. Isso reduz o risco de inclusão acidental; não é uma certificação de ausência de qualquer segredo.

Essa cópia pode ser inicializada com Git e enviada ao repositório escolhido. Não usar `git add .` na pasta da VPS sem revisar a lista de arquivos. Não usar `push --force` em um repositório existente. A cópia gerada não contém dados nem o estado do ambiente publicado.

A pasta `.git` da raiz está vazia e somente para leitura no ambiente desta sessão. A exportação permite preparar o envio sem mudar permissões ou interferir na aplicação em produção. Depois do primeiro envio, o fluxo de versionamento contínuo deve usar um checkout gravável e o repositório configurado.

## Envio confirmado em 05/11/2026

Repositório: https://github.com/araujosdeveloper/apexhub (público, conforme configuração existente do destino informado pelo responsável). Branch `main`, commit `75f87be101275be7e07f1d99573bacc8bdb717c5`. Enviados 236 arquivos da exportação `reports/github-export-cjkYVnKa/project`, incluindo lojista, Master, testes e migrações. A lista dos 235 arquivos adicionados no segundo commit foi comparada integralmente com o manifesto (README já estava no primeiro commit). Leitura de Master e .gitignore confirmada na branch main. Dados, credenciais, backups e relatórios não foram enviados.

O envio foi feito pela conexão GitHub; `.git` da raiz permanece somente para leitura e não foi inicializado. Novos envios precisam usar a conexão ou um checkout gravável, preservando o histórico remoto. Registro local em `reports/github-upload-apexhub.json`.
