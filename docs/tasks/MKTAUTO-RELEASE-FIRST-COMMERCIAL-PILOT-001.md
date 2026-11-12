# MKTAUTO-RELEASE-FIRST-COMMERCIAL-PILOT-001

Frente RELEASE. Entrega técnica controlada; não constitui aceite comercial.
Branch `codex/release-first-commercial-pilot-001`, worktree
`D:\04-Projetos\_worktrees\mktauto-release-first-commercial-pilot-001`.
Base `c7b86c64646aa63698b9e557d8d7cc69a99d9a0f`, com PR #216 integrado
(`f0be78e95fa0989c0f9f5d7d7fe147158087a9e4`). Checkout canônico preservado.

## Resultado e limites

- `TECHNICAL_VERTICAL_PASS`: integração controlada em SQLite descartável,
  produto/campanha/roteiro nativos, áudio PCM físico de fixture, imagem própria
  de fixture, composição V2, FFmpeg real, burn-in, QC, pacote manual e replay.
- `OPERATIONAL_PILOT_READY`: **não declarado**. Não há produto/campanha real
  verificados, evidências comerciais, gravação falada autorizada ou avaliação
  humana do audiovisual. A prova usa alinhamento fixo assinado de teste,
  sem inferência CTC nem homologação acústica.
- `COMMERCIAL_PILOT_ACCEPTED`: **não**; `WAITING_REAL_PRODUCT_EVIDENCE`.
- Revisões e recibo do teste são entradas `FICTITIOUS_TEST_ONLY`, em banco
  descartável. O recibo é `UNCONFIRMED`, sem ID/URL externa e com evidência
  explícita de que nenhuma publicação ocorreu. Nunca houve POST social.
- Finance: leitura do orçamento e fechamento existentes; `PARTIAL_EVIDENCE`,
  `COVERAGE_UNVERIFIED`, `financiallyClosed=false`, `totalRunCost=null`.
  Nenhum custo desconhecido foi convertido em zero. Chamadas pagas conhecidas:
  zero. Computação/energia locais não mensuradas. Nenhum gasto autorizado.
- Nenhum banco operacional foi acessado; nenhum Docker, frontend, scheduler,
  configuração LIVE, provider ou contrato de negócio foi alterado.

## T01/T02 — Operações reutilizadas e caminho

| Operação | Serviço / método / endpoint existente | Entrada e saída | Dependência / prova nesta task |
| --- | --- | --- | --- |
| Produto | AffiliateService.registerProduct; POST /affiliate/products | Revisão, imagem, direitos → produto revisionado | Catálogo SQLite; fixture nativa, não comercial |
| Campanha | AffiliateService.registerCampaign; POST /affiliate/campaigns | Produto/revisão, CTA, disclosure, link → campanha/revisão | Uma campanha, um produto fictício |
| Briefing / vínculo | AffiliateService.createBriefing; AffiliateRunContext.bindRun | Campanha, briefing, PipelineRun → contexto imutável | Serviços nativos e SQLite descartável |
| Execução | CampaignAdministration.schedule; POST /content-operations/campaign-executions | Identidades, horário, briefing → execution_id | NativeCampaignWorkflow existente; nenhum scheduler ativado |
| Roteiro | EditorialFlowService.generate; POST /content/editorial-generations | GenerationRequest, shortlist, briefing → script/hash | FakeEditorialProvider local; sem rede |
| Áudio local | LocalFlowService.ingest; POST /media/local/audio | VoiceTrack, WAV e declaração de origem → CAS/vínculo | PCM sintético de teste; narração real não homologada |
| Alinhamento / legendas | LocalFlowService.alignAudio/subtitles | Voz/roteiro → alinhamento e SRT/ASS | Vetor fixo com PinnedAlignmentVerifier; não CTC real |
| MP4 | MediaService.registerCompositionPlan; LocalFlowService.compose/burn | Plano V2, request e legendas → render revisão 2/hash | CAS local e FFmpeg real |
| QC | LocalFlowService.qc/ensureQcHandoffEvidence | Render exato → local QC e evidência datada | Hash, streams, duração, linhagem e decode físico |
| Aprovação da execução | CampaignAdministration.approve; POST /content-operations/campaign-executions/:id/approvals | Identidade exata, decisão, ator → evento humano | Teste rejeita hash incorreto; decisão positiva somente simulada |
| Pacote | PublishingService.prepare; POST /publishing/packages | Campanha, render, QC, destino/conta/caption → packageHash | Elegibilidade Publishing separada do QC técnico |
| Aprovação do pacote | PublishingService.review; POST /publishing/reviews | PackageHash, decisão, ator → decisão vinculada ao pacote | Sem aprovação, handoff é bloqueado |
| Handoff manual | PublishingService.manualHandoff/manualReadiness; GET /publishing/packages/:hash/manual-handoff | PackageHash → mídia/caption/CTA/disclosure/link/destino exatos | Sem publicação automática; fixture não deve ser publicada |
| Recibo / resultados | PublishingService.recordPublication/recordResults; POST /publishing/manual-publications e /publishing/results | Pacote, relato e evidência → registro idempotente | Apenas recibo UNCONFIRMED fictício; resultados reais não informados |
| Finance | FinanceService.getGlobalReadiness/getPilotCostClosure; GET /finance/readiness | PipelineRun → orçamento, custos conhecidos e lacunas | Total desconhecido e cobertura pendente preservados |
| Histórico | CampaignAdministration.get/history; GET /content-operations/campaign-executions/:id/history | ExecutionId → estado/eventos | Reabertura SQLite e consulta em processo novo |

O teste reutiliza o caminho nativo LOCAL_VALIDATION com gravação fornecida,
plano V2 explícito e publicação manual. Etapas de geração externa não solicitadas
permanecem NOT_REQUESTED no histórico; SUCCEEDED da campanha não prova publicação.
O catálogo de fixture existente contém `prod_001` / `camp_001`, nunca AURA ONE.
O link example.com do seed é explicitamente fictício e não comprova afiliação.
Os endpoints de comando Publishing recebem o envelope existente
`{ input, idempotencyKey }`; os campos da tabela descrevem seu input.

## T03 — Consulta consolidada

FirstCommercialPilotService.inspect recebe executionId e packageHash opcional.
Consulta CampaignAdministration, Affiliate, OperationsPreflight, Media, LocalFlow,
Publishing e Finance. Retorna identidades/revisões, etapa, próxima ação, bloqueios,
histórico, hashes de áudio/render, QC, pacote, recibos e custos. Não possui tabela,
fila, workflow, endpoint novo, aprovação ou efeito externo próprio.

Revalida os bytes físicos e a evidência QC; rejeita pacote de outro run, campanha
ou render. Falhas de disponibilidade permanecem desconhecidas. O retorno mantém
`commercialAcceptance=NOT_ASSESSED` e `publicationAuthorized=false`, inclusive
quando a fixture possui revisão simulada APPROVED.

## T04/T05 — Reprodução isolada e evidência física

PowerShell, no worktree da task:

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm run build
$env:MKTAUTO_TEST_FFMPEG = (Get-Command ffmpeg).Source
$env:MKTAUTO_TEST_FFPROBE = (Get-Command ffprobe).Source
# Diretório externo existente, exclusivo da task, sem symlinks/junctions ou Git.
$env:MKTAUTO_FIRST_PILOT_EVIDENCE = '<EVIDENCE_PARENT_ABSOLUTO>'
npx vitest run --config vitest.config.e2e.ts src/modules/operations/first-commercial-pilot.e2e-spec.ts
```

O teste cria um subdiretório exclusivo `FICTITIOUS_TEST_ONLY-*`, copia CAS e backup
SQLite consistente, e grava config.json, marcador ligado ao hash do banco,
physical-evidence.json, WAV e MP4. Runtime e mídias permanecem fora do Git.
Sem FFmpeg/FFprobe explícitos, o teste é SKIP e não comprova a prova física.

```powershell
node scripts/ops-local/first-commercial-pilot.mjs --dry-run --config '<FIXTURE_ROOT>\config.json'
node scripts/ops-local/first-commercial-pilot.mjs --verify --config '<FIXTURE_ROOT>\config.json'
```

O smoke exige configuração explícita, classificação/provider de teste, marcador
com hash atual do SQLite, diretórios externos, arquivos regulares sem hardlinks
ou symlinks e FFmpeg/FFprobe executáveis. Dry-run inspeciona dependências; verify
consulta os serviços compilados em contexto Nest temporário, sem servidor.
Não carrega .env; remove ambiente de providers reais, usa flags fake/offline,
desliga schedulers/notificações, bloqueia fetch e fecha o contexto. Compara hash
do banco antes/depois. Não gera, aprova, publica ou cria dados comerciais.

Prova física desta execução: render revisão 2, 1080×1920, 10 segundos,
SHA-256 `129d933b0ccce4c46357604d3c75f8095e0812efbda7683830929a5425e54180`.
WAV SHA-256 `00f558c74e3fed0a288b22cf3d6d5e2f9c1fd85c9494038dafcb40b34bfe038f`.
O relatório externo contém script/plano/render/QC/probe e os hashes efetivamente
medidos. A revisão da fixture não equivale a aprovação comercial.

## T06/T07 — Operador, custos e recuperação

Para um piloto real ainda faltam projeto/campanha/produto e revisões verificadas,
direitos comerciais da imagem, prova do link afiliado, autorização comercial,
narração falada e avaliação humana da versão física exata. Esses itens não foram
inferidos da fixture. Depois dos gates existentes, o operador deve publicar
manualmente e informar ID/URL/evidência reais vinculados ao pacote/destino.
Sem verificação independente, preservar UNCONFIRMED. Não registrar métricas,
receita ou comissão inexistentes; resultados desconhecidos permanecem desconhecidos.

O teste confirma replay do agendamento, render e recibo com mesmas identidades,
sem duplicação; rejeição de aprovação com hash divergente; bloqueio de handoff
sem aprovação; recuperação com novas instâncias e leitura pelo smoke compilado
em processo novo. A preparação do pacote não concede autorização de gasto.

## Primeiro impedimento observado

Na montagem inicial da fixture, a campanha pausou em EDITORIAL com
`AFFILIATE_SCRIPT_CONTEXT_CONFLICT`: o roteiro havia sido gerado com requestedAt
`2026-11-12T00:00:00Z`, enquanto o replay nativo usou scheduled_at normalizado
`2026-11-12T00:00:00.000Z`. A identidade existente inclui o valor literal.
A fixture passou a usar o horário canônico desde sua primeira geração;
nenhum hash/contexto persistido foi reescrito ou validação enfraquecida.

Antes disso, a montagem manual de um segmento V2 em ordem diferente da projeção
nativa provocou INVALID_PERSISTED_COMPOSITION_PLAN / segmentos divergentes.
A fixture agora usa a estrutura/ordem produzida pelo contrato nativo. Não foi
alterado o repositório Media. Esses diagnósticos de montagem não bloqueiam o
caminho canônico demonstrado; não constituem correção geral desses domínios.
Arquivos adicionais necessários ao caminho demonstrado: nenhum.

## T08 — Aceite técnico e progresso

Validações: teste físico integrado, testes focados da projeção/isolamento,
regressões Preflight/Finance/V1 Pilot, smoke dry-run/verify, TypeScript, build,
lint e diff check. Os resultados exatos estão no retorno e nos logs externos.
Suíte global de aplicação não executada. Avisos globais de lint fora da task
não foram corrigidos. Nenhuma integração comercial real foi declarada.

Oito subtópicos técnicos T01–T08 concluídos; parciais 0, pendentes 0, faltantes 0
no escopo controlado autorizado. O tópico será entregue em um único Draft PR;
USER_ONLY_MERGE. O último marco comprovado é o fluxo técnico recuperável;
marco atual é revisão da entrega técnica; próximo marco externo é obter as
evidências reais e autorização do operador, sem execução antecipada.
Aceite comercial, qualidade de fala/CTC reais, publicação real e confirmação
independente da plataforma permanecem não testados.
