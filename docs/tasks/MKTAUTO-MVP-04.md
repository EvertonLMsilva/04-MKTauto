# MVP-04 — operação repetível no runtime NestJS

## Fluxo

O banco operacional LIVE é fixo: `PROJECT_API_DATABASE` e `SOCIAL_HISTORY_DATABASE` apontam para o mesmo SQLite já provisionado em modo `live`. Os BCs de campanha, conteúdo, mídia, Affiliate, Finance e Publishing usam as conexões existentes desse banco. `prepare-instagram-live` foi uma ferramenta de transição do MVP-03; não participa das produções seguintes. O banco fake anterior continua separado. Um banco LIVE novo exige provisionamento e contexto LIVE na criação; `db:provision` isoladamente cria contexto fake.

O cadastro de projeto, produto elegível, campanha e imagem autorizada é feito uma vez pelos contratos públicos. Para cada data lógica, `POST /content-operations/campaign-executions/local` agenda uma execução com `requestId` próprio, `requestedAt` e a imagem já cadastrada. O scheduler NestJS existente produz roteiro, voz, alinhamento, legendas, plano, render, QC e preview com os adapters configurados. A repetição idêntica no dia retorna a mesma execução; outra identidade para a mesma campanha/data gera conflito. Campanhas diferentes têm masters independentes; o orçamento global, direitos e elegibilidade continuam obrigatórios.

Após a aprovação humana do render exato e o handoff, uma execução LIVE espera `SOCIAL_PUBLICATION_REQUEST_REQUIRED`. O pacote, a legenda final e a revisão são criados e aprovados pelos contratos Publishing **no mesmo banco**. O operador vincula explicitamente `{ packageHash, accountId }` pelo endpoint de retomada; o Publishing revalida pacote, revisão, hash físico, QC, conta, revogação e reserva antes de qualquer efeito externo. A aprovação de outra data, revisão, render ou pacote não autoriza a publicação. Processamento conhecido pode ser consultado sem novo container. Um efeito remoto incerto não é reenviado: a retomada consulta o mesmo container; apenas `FINISHED` na etapa de upload permite revalidar e seguir. Incerteza no POST final permanece em reconciliação, sem segunda submissão.

## Operação

Na raiz do repositório, configure o processo com valores privados. O banco LIVE já existe e é reutilizado; não execute `prepare-instagram-live` a cada vídeo. As variáveis de modelo, mídia e licença apontam para instalações e artefatos locais existentes. Os valores abaixo são placeholders, nunca segredos reais.

```powershell
$env:PROJECT_API_DATABASE = '<caminho-absoluto-do-sqlite-LIVE-fixo>'
$env:SOCIAL_HISTORY_DATABASE = $env:PROJECT_API_DATABASE
$env:CAMPAIGN_SCHEDULER_ENABLED = 'true'
$env:INSTAGRAM_SCHEDULER_ENABLED = 'false'
$env:INSTAGRAM_PUBLICATION_MODE = 'live'
$env:INSTAGRAM_LIVE_POSTS_ENABLED = 'true'
$env:INSTAGRAM_ACCOUNT_ID = '<id-da-conta-autorizada>'
$env:INSTAGRAM_FACEBOOK_PAGE_ID = '<id-da-pagina-vinculada>'
$env:INSTAGRAM_META_APP_ID = '<id-do-app>'
$env:INSTAGRAM_API_VERSION = '<versao-configurada>'
$env:INSTAGRAM_ACCESS_TOKEN = '<token-da-pagina>'
$env:INSTAGRAM_APP_ACCESS_TOKEN = '<token-do-app>'
$env:CONTENT_EDITORIAL_PROVIDER = 'ollama'
$env:OLLAMA_MODEL = '<modelo-local-configurado>'
$env:LOCAL_TTS_MANIFEST = '<manifesto-local-licenciado>'
$env:LOCAL_TTS_MANIFEST_SHA256 = '<sha256-do-manifesto>'
$env:LOCAL_ALIGNMENT_PYTHON = '<python-local>'
$env:LOCAL_ALIGNMENT_MODEL_ROOT = '<modelo-local-de-alinhamento>'
$env:FFMPEG_PATH = '<ffmpeg>'
$env:FFPROBE_PATH = '<ffprobe>'
$env:FFMPEG_MEDIA_ROOT = '<midia-autorizada>'
$env:FFMPEG_VOICE_ROOT = '<diretorio-de-voz>'
$env:FFMPEG_RENDER_ROOT = '<diretorio-de-render>'
$env:PUBLISHING_RENDER_ROOT = $env:FFMPEG_RENDER_ROOT
$env:LOCAL_MEDIA_EVIDENCE_ROOT = '<diretorio-de-evidencias>'
npm start
```

O build é feito uma vez por implantação de código, não por vídeo. O bootstrap valida o esquema; o transporte LIVE exige credencial de Página, conta e permissões vigentes. O scheduler de Instagram separado permanece desativado. Para parar, use `Ctrl+C`; o NestJS fecha as conexões em `SIGINT`/`SIGTERM`.

Com o servidor ativo, use os endpoints existentes. Envie cada corpo JSON por `Invoke-RestMethod -ContentType 'application/json' -InFile '<arquivo-json-local>'`; arquivos de operação e respostas com dados privados ficam fora do Git.

| Ação | Contrato |
| --- | --- |
| Cadastrar produto/campanha uma vez | `POST /affiliate/products`, `POST /affiliate/campaigns` |
| Agendar a data | `POST /content-operations/campaign-executions/local` com `campaignId`, `campaignRevision`, `projectVersion`, `requestId`, `requestedAt`, `localImage` |
| Consultar | `GET /content-operations/campaign-executions/{id}`, `/history`, `/result` |
| Aprovar o render | `POST /content-operations/campaign-executions/{id}/approvals`, com identidade QC autenticada e decisão da versão exata; depois `POST /content-operations/campaign-executions/{id}/resume` com `{}` |
| Preparar e revisar o pacote | `POST /publishing/packages` com `input` (`campaignId`, `campaignRevision`, `videoRenderId`, `qualityControlReportId`, `platform`, `account`, `caption`) e `idempotencyKey`; conferir `GET /publishing/packages/{hash}`; `POST /publishing/reviews` com `input` (`packageHash`, `decision`, `actor`, `justification`) e outro `idempotencyKey` |
| Vincular e retomar publicação | `POST /content-operations/campaign-executions/{id}/resume` com `{ "publication": { "packageHash": "<hash-aprovado>", "accountId": "<id-autorizado>" } }` |
| Acompanhar ou reconciliar | `GET /content-operations/campaign-executions/{id}` e `/history`; `GET /publishing/social-operations/{operationId}`; em `WAITING_RECONCILIATION`, `POST /content-operations/campaign-executions/{id}/resume` com `{}` consulta a operação existente |

Nunca retome uma publicação incerta com outro pacote, banco ou conta. Upload aceito não é publicação confirmada; o recibo e o permalink precisam constar da operação `PUBLISHED` e da execução `SUCCEEDED`.

## Validação e limites

Os testes usaram SQLite provisionado com foreign keys ativas, relógio controlado, produto/campanha e mídia de fixture, e transporte externo simulado. Demonstraram dois dias da mesma campanha elegível, idempotência no mesmo dia, masters independentes de campanhas distintas, checkpoints reaproveitados após reinício, espera sem pacote, gates de aprovação/revogação e ausência de segundo POST após incerteza. Não houve inferência, TTS, render ou publicação reais nesta entrega. A primeira publicação real do MVP-03 permanece evidência separada; a operação diária contínua real ainda não foi homologada. `DT-NARRATION-001` continua fora deste escopo. Custo de uma futura execução: indisponível até ser medido e registrado.
