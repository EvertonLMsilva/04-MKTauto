# MKTAUTO-C-FIRST-COMMERCIAL-PRODUCT-019

Frente C. Entrega offline; cadastro manual existente reutilizado. Não cria serviço, rota, autorização, grant ou integração operacional.

## Resultado e limite

`TECHNICAL_ONBOARDING_PASS` significa contratos válidos, contexto declarado compatível, direitos documentados para processamento local recorrente e PNG físico com SHA-256 conferido. Não significa produto real autorizado: `realProductAuthorized=false` e `registrationAuthorized=false` em todas as saídas deste comando. Fixture é sempre `FICTITIOUS_TEST_ONLY`.

Sem candidato real explicitamente fornecido, o primeiro bloqueio é `OPERATOR_PROVIDED_INPUT_REQUIRED`. A tarefa não recebeu candidato, imagem ou documentação reais. A capacidade técnica existente foi exercitada somente com um produto e uma campanha fictícios, em SQLite descartável, inclusive após reinício.

O comando não abre banco, não carrega `.env`, não inicia servidor e não faz HTTP. Apenas lê o JSON indicado e, por meio de `inspectQualificationImage`, o PNG no armazenamento local já existente. Sem `--output`, escreve somente em stdout; com `--output`, cria exclusivamente o relatório pedido e recusa sobrescrita. Não baixa nem copia imagens.

## Entrada real necessária

Fornecer um JSON privado com **exatamente** os campos `dataOrigin`, `project`, `product` e `campaign`:

| Campo                       | Contrato / evidência necessária                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dataOrigin`                | `OPERATOR_PROVIDED` para candidato real; `FICTITIOUS_TEST_ONLY` exclusivamente em testes. O rótulo não autentica nem autoriza o conteúdo.                                                                                                                                                                                                                                                                         |
| `project`                   | Snapshot completo `project-contracts/1.0.0` retornado por `GET /projects/:projectId/versions/:version`: `schemaVersion`, `project`, `channel`, `references`. A inspeção local valida o contrato, mas não confirma existência, estado atual ou revisão mais recente no banco.                                                                                                                                      |
| `product`                   | Objeto existente `affiliate-product/1.0.0` ou `/2.0.0`, com ID, revisão, nome, marca, atributos, referências de mídia e evidências. Preferir `/2.0.0` para vincular marca a `PRODUCT_SPECIFICATION`; marca desconhecida deve continuar declarada como desconhecida. O contrato legado não comprova documentação da marca.                                                                                         |
| Descrição e características | Usar `attributes[].name/value/evidenceRef`; não adicionar um campo `description` incompatível com o contrato. Cada alegação deve apontar para evidência de especificação existente. Não inserir preço, estoque, desconto ou comissão como característica.                                                                                                                                                         |
| Evidências                  | `id`, `kind`, `sourceRef`, `recordedAt`, e `mediaAuthorization` quando aplicável. Manter originais privados de especificação, licença, permissão ou propriedade. Referência declarada não comprova automaticamente direito externo.                                                                                                                                                                               |
| `product.localImage`        | `mediaReference`, `contentHash` SHA-256, `origin`, `provider`, `rights`. A referência também deve constar em `product.media`. Nenhum caminho privado ou bytes são adicionados ao produto.                                                                                                                                                                                                                         |
| Direitos                    | `rights.usageBasis`, `commercialUseAllowed=true`, evidências vinculadas à referência e ao hash exatos; `commercialUse=GRANTED`, `processing=GRANTED`, `localProcessing=true`. O mesmo direito deve estar documentado em `product.evidence` e `localImage.rights.evidence`. Permissão restrita a QC/operação/campanha não comprova reutilização recorrente. Transferência externa não é autorizada por este fluxo. |
| Arquivo físico              | PNG autorizado já presente em `<FFMPEG_MEDIA_ROOT>/sha256/<2 primeiros caracteres do hash>/<hash>.png`. O reader existente confere caminho, arquivo, hash e perfil PNG MVP; não equivale a QC visual nem aprovação comercial.                                                                                                                                                                                     |
| `campaign`                  | `affiliate-campaign/1.0.0`: ID/revisão, `projectId`, `productId`/`productRevision` exatos, `affiliateUrl` HTTPS, CTA e disclosure.                                                                                                                                                                                                                                                                                |
| Link afiliado               | URL emitida por fonte autorizada para o produto correto, acompanhada de documentação privada de associação à conta/produto. URL presente ou associação declarada não prova associação real. Nenhum link é criado ou consultado nesta entrega.                                                                                                                                                                     |

Não colocar segredos, credenciais ou arquivos de configuração dentro do candidato. O relatório omite URL afiliada, valores de atributos, texto dos documentos, caminhos privados e bytes; exibe identidades contratuais, hashes e estados de verificação.

## Inspeção reproduzível

Executar no worktree da tarefa, com dependências instaladas e build do próprio worktree. Não iniciar NestJS para a inspeção.

```powershell
node node_modules/@nestjs/cli/bin/nest.js build

# Sem entrada: relatório de pendências; exit code 2; nenhuma leitura de catálogo/imagem.
node scripts/ops-local/first-commercial-product.mjs --dry-run

# Somente após o operador fornecer caminhos reais explícitos:
$env:FFMPEG_MEDIA_ROOT = '<raiz absoluta do armazenamento autorizado já existente>'
node scripts/ops-local/first-commercial-product.mjs --dry-run --input '<candidate.json absoluto>' --output '<relatório novo absoluto>'
```

Exit codes: `0` = inspeção técnica passou; `2` = pendência técnica; `1` = argumento, leitura, build ou saída indisponível. Nenhum desses resultados autoriza cadastro ou piloto. `--database`, `--execute` e opções desconhecidas são recusadas. O modo real de operação não existe neste script.

## Endpoints existentes e ordem posterior ao aceite humano

Não executados contra runtime operacional nesta tarefa. Usar o backend e o perímetro de acesso já existentes, após conferência humana e autorização específica para cadastro real:

1. `GET /projects/:projectId/versions/:version`: obter e conferir o projeto permitido e a revisão exata. Não criar outro projeto por conveniência.
2. Inspecionar o candidato e resolver os bloqueios documentais, físicos e comerciais.
3. `POST /affiliate/products` com `{ "idempotencyKey": "<chave estável do cadastro>", "product": <candidate.product> }`.
4. `POST /affiliate/campaigns` com `{ "idempotencyKey": "<outra chave estável>", "campaign": <candidate.campaign> }`.
5. `GET /affiliate/products/:productId/revisions/:revision` e `GET /affiliate/campaigns/:campaignId/revisions/:revision`: conferir igualdade dos registros e revisões.
6. `GET /affiliate/projects/:projectId/catalog?projectVersion=:version`: consultar elegibilidade técnica e bloqueios operacionais.

Produto e campanha são **dois comandos separados**, não uma transação conjunta. Se a campanha falhar, conferir o produto já registrado e retomar com as mesmas chaves e payloads. Chave repetida com payload distinto gera conflito. Os endpoints manuais não substituem conferência física, verificação externa de direitos, associação afiliada ou aprovação humana; não tratar um POST bem-sucedido como autorização comercial.

O mecanismo de cadastro revisado também existe para pacotes derivados do preview de feeds, com revisor autenticado e revalidação (`POST /affiliate/feed-qualifications/preview/register`). Ele exige os contratos daquele fluxo. Não é necessário criar feed, consultar Shopee ou simular decisão autenticada para demonstrar o cadastro manual desta entrega. O preparador existente `prepare-first-product` permanece preservado; este comando atende o candidato manual sem introduzir descoberta de ofertas.

## Relatório para o operador

- **Capacidade técnica:** cadastro manual e leitura após reinício demonstrados com fixture isolada; inspeção read-only reutiliza validadores e reader existentes.
- **Produto comercial real:** ausente; `REAL_PRODUCT_AUTHORIZED=false`.
- **Evidências ausentes:** candidato real selecionado, especificações e marca documentadas, imagem original autorizada e seu SHA-256, licença/permissão verificável, link com associação comprovada, snapshot do projeto permitido e decisão humana aplicável.
- **Bloqueio de passagem ao piloto:** sem candidato real, `OPERATOR_PROVIDED_INPUT_REQUIRED`; com contrato técnico completo, continuam a autorização real, conferência persistida de projeto/revisões, direitos externos e associação afiliada não verificados.
- **Dados comerciais atuais:** preço, estoque e comissão `UNKNOWN`. `BLOCKED_COST_UNCONFIRMED` permanece no relatório; nenhuma consulta LIVE foi realizada ou liberada.
- **Próxima ação humana:** fornecer o pacote real privado e revisar as evidências. Não há cadastro real, geração, publicação ou agendamento autorizado por esta task.

## Validação da entrega

```powershell
node node_modules/vitest/vitest.mjs run src/modules/affiliate/first-commercial-product.spec.ts --maxWorkers=1
node node_modules/@nestjs/cli/bin/nest.js build
$env:MKTAUTO_C019_COMPILED_SMOKE = '1'
node node_modules/vitest/vitest.mjs run --config vitest.config.e2e.ts src/modules/affiliate/first-commercial-product.e2e-spec.ts --maxWorkers=1
```

O opt-in acima executa o comando real com os contratos compilados e entrada fictícia em diretório descartável. Não habilita transporte externo. A suíte também comprova cadastro de exatamente um produto/uma campanha por HTTP local, idempotência, conflitos, persistência após reinício e bloqueios por direitos, arquivo, SHA-256, link, projeto, revisões e evidências incompatíveis. Regressões Affiliate, TypeScript, build, lint e diff-check integram o fechamento. USER_ONLY_MERGE.
