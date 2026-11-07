# MKTAUTO-MVP-03 — primeira publicação Instagram LIVE

## Resultado comprovado

- Conta: `@katemkt.00` (`17841447654430033`). Execução: `6b2a49e1-f6f2-4f94-9259-f901907db2a0`, estado final `SUCCEEDED`.
- Pacote aprovado: `p8_package_170e2b7682a0079f0074b654b6c2d3694f703ae09c3a563fa5665629b0795b43`, hash `bbf1bf7c7a02b080cfa781f44409b4fcc6071b7dee6201ad76737bb797d8579a`. O SHA-256 dos bytes do MP4 é `3407175d6831cb921aa6f133b5c97672bb16d7f4d8f0ef7aacfb9431328e82fe`.
- Revisão do pacote: aprovação `APPROVED` de `evert`, decisão original de `2026-11-07T15:29:45.398Z`, hash da decisão `a1a9bee095d713997e5b40d52d4d30e3f953190796dfa0f67968bb2974395673`. A revisão, legenda persistida, direitos, QC e ausência de revogação foram validados pelo serviço Publishing antes do envio.
- Banco da operação: `private/kate-mkt/instagram-live/kate-mkt-live.sqlite`, com `social_publication_context.execution_mode='live'`. O banco de origem permaneceu em modo `fake`, sem operações sociais; o LIVE terminou com uma operação, integridade referencial válida e sem reconciliação pendente.
- Operação: `social_publication:c7897b0e51639be1421a23b0039b1aa87df64446ca8e6470dbd12304a843ea0b`. Container `18061553567588482`; media ID `18115549916268744`; recibo da API: [Reel publicado](https://www.instagram.com/reel/Dfckd3qN13J/), horário remoto `2026-11-07T16:07:26.000Z`.
- O histórico persistido registra uma criação de container e uma transição para `PUBLISHING`, correspondente a uma submissão final. O upload ficou `UNCERTAIN` após falha de rede. Uma consulta de status retornou `FINISHED`; a mesma operação foi reconciliada para `READY` e então publicada. Não houve outro container nem novo upload após a incerteza.
- Custo da operação: indisponível; não foi tratado como zero.

## Procedimento efetivamente utilizado

Executado no checkout original, com Node 24 e os serviços NestJS existentes. Estes passos descrevem a homologação; **não devem ser repetidos para o pacote já publicado**. Tokens não entram em comandos, código versionado ou saída. O processo carregou `INSTAGRAM_ACCESS_TOKEN` e `INSTAGRAM_APP_ACCESS_TOKEN` do `.env` raiz. A credencial efetiva foi comparada sem exibir seu valor; `InstagramConnectionService.check()` confirmou token de Página válido, Página e conta Instagram vinculadas e as permissões `instagram_basic`, `instagram_content_publish` e `pages_read_engagement`.

```powershell
# No diretório canônico; o código Node foi enviado por here-string ao stdin.
cd D:\04-Projetos\23-MKTauto
@'
// Imports dos serviços NestJS; parâmetros exatos deste registro.
// Segredos são carregados por --env-file, nunca interpolados aqui.
'@ | node --env-file=.env --input-type=module
```

No processo Node, antes de criar o contexto NestJS, foram definidos `PROJECT_API_DATABASE` e `SOCIAL_HISTORY_DATABASE` para **o mesmo caminho LIVE**; `INSTAGRAM_PUBLICATION_MODE=live`, `INSTAGRAM_LIVE_POSTS_ENABLED=true`, `CAMPAIGN_SCHEDULER_ENABLED=false` e `INSTAGRAM_SCHEDULER_ENABLED=false`. Os roots existentes `FFMPEG_MEDIA_ROOT`, `FFMPEG_RENDER_ROOT`, `PUBLISHING_RENDER_ROOT`, `FFMPEG_VOICE_ROOT` e `LOCAL_MEDIA_EVIDENCE_ROOT`, além de `LOCAL_TTS_MANIFEST` e `LOCAL_TTS_MANIFEST_SHA256`, apontaram para os materiais locais já produzidos. Nenhuma geração, síntese ou renderização foi executada.

1. O caminho da origem foi resolvido pela configuração da execução: `private/kate-mkt/mvp02-daily-20261106/daily5.sqlite`. `prepareInstagramLive({ source, target, executionId, packageHash, accountId, renderHash })` provisionou o destino com contexto LIVE e copiou apenas as dependências locais do pacote e a aprovação. O helper preserva a origem e não transfere operações sociais fake, recibos nem claims ativos. A repetição antes da publicação manteve os mesmos registros.
2. Consultas SQLite somente leitura verificaram origem e destino sem publicação anterior, contexto, revisão, hashes, aprovação, revogações e `PRAGMA foreign_key_check`. `PublishingPersistence.openInstagram('live').manual.validateForPublication(packageHash)` validou o pacote; `LocalFlowService.previewBytes(videoRenderId)` confirmou o SHA-256 físico.
3. `NestFactory.createApplicationContext(PublishingModule, { logger: false })` iniciou apenas o contexto necessário. `CampaignRepository.claim(executionId, now, 600000)` criou o claim LIVE, com heartbeat durante a operação. `InstagramPublicationService.execute(execution, { packageHash, accountId }, { videoRenderId, contentHash: renderHash })` usou o fluxo resumível. O primeiro envio do arquivo terminou com `SOCIAL_NETWORK_UNCERTAIN` na etapa `UPLOAD`; a execução foi pausada em `WAITING_RECONCILIATION` sem repetir POST.
4. `InstagramPublicationService.reconcile(executionId)` consultou o **mesmo container** e persistiu `providerStatus='FINISHED'`. Com essa evidência remota, `CampaignRepository.resume(...)` retomou a execução sem marcar publicação concluída; um novo claim e `reconcile(executionId)` confirmaram `READY` e `uploadStage='ACKNOWLEDGED'`. `execute(...)` sobre a mesma operação realizou uma submissão `media_publish`; o serviço consultou o recibo remoto. Eventos `STEP_DONE` e `COMPLETED` foram registrados somente após o recibo.
5. A conferência final usou `new DatabaseSync(path, { readOnly: true })` para ler `social_publication_operations`, `social_publication_events`, `instagram_publication_reservations`, `campaign_executions` e `PRAGMA foreign_key_check` no banco LIVE. Resultado: uma operação `PUBLISHED`, um evento `PUBLISHING`, media ID e permalink persistidos, execução `SUCCEEDED`. A origem fake continuou sem operações sociais. Todas as conexões foram encerradas com `db.close()` e `await app.close()`.

## Limites da homologação

A produção real local e a primeira publicação orgânica estão comprovadas para este pacote e esta conta. A operação diária contínua ainda não foi homologada. Cada publicação futura continua sujeita à aprovação humana vigente da versão exata, aos gates de direitos, QC, conta e idempotência. `DT-NARRATION-001` (naturalidade editorial da narração) permanece pendente e não impediu esta primeira publicação.
