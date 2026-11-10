# MKTauto --- roadmap operacional

Este arquivo contém **ordem, dependências, estado atual e critérios de aceite**.
Histórico detalhado de tópicos concluídos e PRs:
`docs/history/ROADMAP_HISTORY.md`. Visão do produto:
`docs/CONTENT_AUTOMATION_MVP_PROJECT.md`. Tasks executáveis:
`docs/tasks/`.

## Fases aprovadas pelo Planner — 13/10/2026 — MKTAUTO-ROADMAP-UPDATE-001

Esta atualização define a prioridade vigente e as próximas fases; não declara
implementação, aceite ou autorização de execução. As decisões e evidências
anteriores permanecem preservadas abaixo. O cadastro manual continua disponível;
a descoberta e seleção de afiliados integram o escopo da V1, respeitando direitos
e fontes autorizadas, sem scraping/repostagem irregular. Preservar contratos,
Ports & Adapters, linhagem, QC e aprovação humana da versão exata no MVP.

### MVP V1 — prioridade atual

- Produzir 1 vídeo automático por campanha por dia.
- Incluir descoberta e seleção de produtos afiliados, roteiro, Kokoro, mídias,
  renderização e QC.
- Garantir recuperação e idempotência na execução diária.
- Aplicar orçamento global de produção de **US$ 1/dia e US$ 20/mês**, compartilhado
  entre campanhas; ambos os limites se aplicam. Registrar custos conhecidos e
  valores indisponíveis, que não equivalem a zero.
- Concluir a execução diária antes de ampliar o escopo.

O orçamento recorrente da V1 é distinto do limite anterior do lote experimental
de três originais em P2, preservado abaixo; não renova nem amplia autorização
LIVE. Execução paga continua exigindo autorização explícita e orçamento.

### MVP V2 — expansão de conteúdo

Após concluir a execução diária da V1, produzir por campanha e ciclo:

- 1 vídeo principal.
- 2 imagens divulgativas do produto.
- 3 postagens com imagens.
- Total: **6 peças por ciclo de produção**, com abordagens diferentes para
  evitar repetição.
- Distribuição escalonada, não necessariamente no mesmo dia.
- Reutilização do produto, briefing e identidade visual.

### Publicação multiplataforma

- Adapters oficiais para Facebook, Instagram, YouTube, Threads e TikTok.
- Configuração inicial assistida de contas e permissões.
- Publicação automática somente quando autorizada pelas plataformas,
  preservando a aprovação humana da versão exata no MVP.
- Idempotência, histórico, agendamento e métricas.
- Validar restrições oficiais antes de implementar cada adapter.

A expansão preserva os gates externos e a progressão P5.2–P5.4 registrados
abaixo. A publicação manual inicial permanece válida até os gates de cada
adapter serem satisfeitos; esta atualização não autoriza publicação ou APIs.

### Ads Manager — fase posterior à V2

- Gerenciamento de anúncios pagos via Meta Marketing API, TikTok Marketing API,
  Google Ads API nos formatos compatíveis e Pinterest Ads API.
- Outras plataformas somente após validação.
- Orçamento de anúncios separado do orçamento de produção.
- Aprovação inicial para ativar anúncios.
- Limites financeiros, monitoramento e pausas.
- Seleção de conteúdos com bom desempenho.
- Acompanhamento de cliques, conversões, comissões e retorno.
- Não presumir que limites internos garantem teto absoluto de cobrança.

As fases futuras dependem de tasks especificadas pelo Planner. Esta atualização
é somente documental: não autoriza código, testes, pipelines, chamadas de API,
alterações de banco, commits ou PRs.

## Estado herdado

O núcleo de Content Machine até aprovação humana já possui entregas
concluídas no histórico. `E08-U03` estava com PR aberto no roadmap
fornecido. `E09 Social Publishing` estava bloqueado por gates externos.
Esses fatos não são reinterpretados aqui.

## Estratégia vigente — Affiliate-First (P0.1)

Esta decisão substitui a ordem de implementação anterior, preservada abaixo
como referência histórica. Não declara capacidades futuras como implementadas.
Objetivo inicial: produzir 10 anúncios, validar custos e buscar a primeira venda.
Cadastro manual de produtos, características verificadas e imagens reais
autorizadas; roteiro pela IA existente; fal.ai para cenas, música e narração
quando suportadas pelo modelo escolhido; FFmpeg para textos exatos, CTA,
composição e correções locais; aprovação humana e publicação manual inicial.
O MVP deverá registrar custos, cliques, vendas e comissões com origem e atribuição
explícitas. SaaS e automação avançada aguardam validação comercial.

Preservar ProjectSnapshot, PipelineRun, linhagem, CostLedger e Ports & Adapters.
Produto/campanha entram por contratos próprios, sem alterar snapshots antigos.
Receita permanece separada dos custos. O Planner define modelo/endpoint fal.ai,
entradas, direitos, áudio, recuperação e orçamento antes de P2. Não presumir
suporte audiovisual completo: o composer atual silencia áudio original e exige
voz WAV; música e overlays comerciais exigem adaptação. A revisão comercial
complementa o QC técnico e acompanha a versão exata aprovada.

## Atualização de estado — 12/10/2026 — P5.1

Esta atualização prevalece sobre os estados registrados anteriormente abaixo;
preserva a tabela anterior e o histórico original, sem declarar merge, aceite
comercial ou autorização LIVE.

| Fase | Estado observado | Evidência e pendência |
|---|---|---|
| P2 — geração | IMPLEMENTADO NO CHECKOUT; demonstração interna disponível | Adapter fal.ai, porta, BudgetGate e CostLedger existentes; testes locais cobrem reservas, concorrência, resultado incerto e reconciliação. A origem AI_GENERATED de P4.6 identifica uma geração LIVE-01 armazenada. Não comprova conclusão do lote de três originais nem certifica custos históricos. |
| P3 — adaptação | IMPLEMENTADO; validação técnica local | Adaptação FFmpeg e híbrido existentes. P4.6/P4.7 demonstram derivados 9:16, 4:5 e 1:1 de uma origem, com hashes, lineage, duração e áudio. Três formatos não equivalem a três originais. Fidelidade perceptual e comercial permanece humana. |
| P4 — exportação/revisão | TECNICAMENTE VALIDADO NA DEMONSTRAÇÃO; SEM ACEITE COMERCIAL | `outputs/P4.6/P4.6-manifest.json` e `outputs/P4.7/REVIEW.md`: verificações técnicas PASS, QC global FAIL por COMMERCIAL_RIGHTS; nenhuma aprovação ou publicação. AURA ONE permanece interna e inelegível. Não há evidência de cliques/vendas/comissões reais nesta entrega. |
| P5.1 — distribuição manual rastreável | IMPLEMENTADO NO CHECKOUT; validação local com fixtures | Pacote imutável por destino, revisão humana do hash completo, registro manual idempotente e resultados com fonte/período/atribuição. Migração aditiva 035; sem alterações em dados de produção. CLI descrita em `docs/tasks/P5.1.md`. Não satisfaz por si só o aceite comercial de P4. |
| P5.2 — publicação oficial em uma rede | PLANNED; gate externo e evidências de P4 pendentes | Porta separada da pesquisa, adapter oficial, operação persistida, identidade por destino, recuperação/reconciliação e fallback manual. Aceite: mocks comprovam ausência de duplicação após concorrência, reinício e timeout; smoke externo somente com autorização explícita, conta/permissões comprovadas e orçamento quando pago. |
| P5.3 — agendamento persistente | PLANNED; depende de P5.2 estável | Agenda/timezone, cancelamento, execução concorrente controlada, revalidação de direitos e aprovação antes do envio. Aceite: fixtures cobrem horários, reinício, execução perdida e retry seguro após reconciliação. |
| P5.4 — expansão baseada em evidências | PLANNED; depende de resultados e gargalos observados | Novas redes e coleta oficial de métricas priorizadas pelo retorno observado. Aceite: reutilizar contratos, preservar atribuição e valores indisponíveis, comprovar permissões e reconciliação por rede. Sem gerações extras por formato. |

Aceite P5.1: somente pacote com direitos comerciais, QC PASS e decisão humana
APPROVED sobre mídia, texto, campanha e destino exatos aceita registro manual;
alterações exigem novo pacote/revisão. Repetições e concorrência não duplicam
publicações, resultados ficam vinculados à publicação correta e reinício preserva
estados/evidências. AURA ONE é explicitamente bloqueada mesmo com declaração
contraditória de direitos. Resultados conhecidos zero são distintos de UNKNOWN;
receita/comissão não entram como despesas no CostLedger. BudgetGate permanece
inalterado e não é autorização genérica para publicação paga.

Testes P5.1: `node --test test/manual-distribution.test.js`; regressões focadas:
affiliate-repository, human-approval, p4-contracts, video-generation, cost-ledger
e project-repository.
Integrações externas fake/mock; nenhuma API paga, publicação ou scheduler.

## Ordem prioritária registrada anteriormente — preservada

| Fase | Estado | Entrega e critério de conclusão |
|---|---|---|
| P0 — Auditoria | DONE | Auditoria estática entregue no chat; sem certificação LIVE. |
| P0.1 — Governança | DONE | Alinhar documentos; não autoriza P1. |
| P1 — Produto e campanha | IMPLEMENTADO NO CHECKOUT; validação local abaixo | Reaproveitar cadastro manual versionado, direitos/evidências, CTA/link, vínculo à run e briefing consumido pelo roteiro com fake; não duplicar estes módulos. |
| P2 — fal.ai | PLANNED; depende da validação de P1 e confirmação de cobrança | Gerar exatamente 3 vídeos originais por IA em 9:16, atrás de adapter; fixtures comprovam solicitação, resultado, falhas, reconciliação e custos sem duplicar submissão; aplicar os gates de orçamento abaixo. |
| P3 — FFmpeg e validação multiplataforma | PLANNED; depende de P2 | Reaproveitar composição, legendas e QC existentes; adaptar localmente os mesmos 3 originais para 9:16, 4:5 e 1:1, preservando áudio, produto e área segura; revisão comercial e aprovação da versão exata. |
| P3.HYBRID-01 — Anúncio híbrido de 10 segundos | DONE — execução e prévia simuladas locais | Extensão isolada do P3: abertura AURA ONE de 2s com movimento local, MP4 previamente armazenado (~5s, duração medida), encerramento ajustado para 10s com CTA “Conheça AURA ONE”. Modo explícito `HYBRID_ORIGINAL_AUDIO`, silêncio local, sem narração; três formatos, hashes, manifesto e recuperação por receipts persistentes. Não autoriza geração paga, publicação ou aprovação comercial. |
| P4 — Exportação e validação comercial | PLANNED; depende de P3 | Exportar derivados aprovados dos mesmos vídeos para Instagram, TikTok, Facebook e Threads, com linhagem até o original e formato identificado; publicação manual e registro de cliques, vendas, comissões e custos, inclusive indisponíveis. A meta comercial de 10 anúncios não autoriza gerações adicionais neste lote. |
| P5 — Automação progressiva | PLANNED; depende de evidências de P4 | Automatizar gargalos demonstrados; publicação oficial em tópico próprio com idempotência e reconciliação. |

A auditoria P0 encontrou projetos, pesquisa, roteiro, mídia, composição,
legendas, preview, custos parciais e aprovação implementados no checkout.
O checkout já contém produto/campanha/briefing e testes locais correspondentes;
isso atualiza o diagnóstico de P0, sem declarar merge ou certificação LIVE.
fal.ai e resultados comerciais permanecem futuros. O Planner deve especificar
o próximo tópico executável de P2, reaproveitando P1 e os contratos existentes.

## Decisão multiplataforma aprovada e gates de aceite

- P2 produz exatamente 3 originais em vertical 9:16. Instagram, TikTok,
  Facebook e Threads reutilizam esses mesmos vídeos; nenhuma geração IA
  adicional por plataforma ou formato.
- Orçamento de eventual LIVE: US$ 1,00 total e no máximo US$ 0,33 por
  geração (3 gerações somam no máximo US$ 0,99). Proibir retries pagos
  automáticos. Antes de submissão, comprovar custo completo e saldo suficiente;
  custos indisponíveis não equivalem a zero e impedem autorizar execução paga.
  Registrar custo conhecido e reconciliação no CostLedger existente.
- LTX-2.3 Distilled continua candidato; cobrança completa pendente de
  confirmação. Esta decisão não escolhe endpoint nem autoriza adapter LTX.
- P3 concentra a adaptação local FFmpeg: 9:16, 4:5 e 1:1, sem distorção
  nem corte do produto. Preservar o áudio do original e manter produto,
  textos, CTA e elementos importantes em área segura em cada formato.
  O Planner deve definir dimensões e margens seguras antes da implementação.
- Aceite de P3: fixtures locais demonstram os três formatos, proporções
  corretas, preservação de áudio, duração e conteúdo importante; QC técnico
  complementado por revisão visual/comercial. Derivados mantêm hashes e
  linhagem; qualquer alteração invalida aprovação anterior da versão alterada.
- P3 deve incluir um caminho que preserve o áudio nativo do original, sem
  substituição obrigatória por voz WAV; validar a faixa de áudio e os formatos
  9:16, 4:5 e 1:1 com fixtures locais, sem novas gerações IA.
- Aceite de P4: pacote identifica original, derivado, formato, plataformas
  e aprovação humana da versão exata antes de publicação manual.
- Reaproveitar persistência, CostLedger, referência, composição, legendas e
  QC já existentes. O composer atual é fixo em 1080×1920, usa crop e voz WAV
  separada; não comprova preservação do áudio original nem exportação 4:5/1:1.
- Lacunas futuras: gates determinísticos de orçamento e quantidade,
  proibição de retry pago, integração fal.ai, adaptação com áudio/área segura,
  pacote multiplataforma e resultados comerciais. Não implementar nesta task.
- Esta atualização autoriza somente documentação e testes locais com
  fixtures/mocks, incluindo FFmpeg local; sem LIVE ou chamadas pagas.

## Validação local — 11/10/2026

Executado `node --test --test-reporter=dot` sobre os 17 arquivos focados:
`affiliate-{contracts,repository,cli}`, `script-generation-service`,
`reference-{insight-contracts,analysis,adapters}`, `project-repository`,
`pipeline-run`, `cost-event-contracts`, `cost-ledger`,
`ffmpeg-video-{config,composer,integration}`, `ffmpeg-subtitle-renderer`,
`ffmpeg-subtitle-renderer-integration` e `ffmpeg-quality-inspector`
(todos em `test/`, com extensão `.test.js`). Integrações locais habilitadas
por `FFMPEG_COMPOSER_INTEGRATION_TEST=1` e `FFMPEG_SUBTITLE_INTEGRATION_TEST=1`.

- 97 testes passaram, incluindo MP4 real 1080×1920 e legendas com FFmpeg.
- 1 falhou: `cost-ledger`, teste “migração 010 é aditiva e preserva registros
  existentes”. O teste ainda espera schema/migrações 28, enquanto o repository
  e o banco temporário migrado possuem versão 30 e 30 migrações. A asserção
  ocorre antes do fechamento do banco; a limpeza no Windows retorna `EPERM`
  e encobre a divergência. Registrar correção futura do teste e fechamento
  garantido; nenhuma correção de código/teste realizada nesta task.
- Referências foram validadas com mocks; esta suíte não comprova análise
  física de áudio/vídeo nem fidelidade comercial de produto.
- Nenhum gate de orçamento foi encontrado em `src/` ou `test/` pela busca
  pontual de orçamento/budget/maxCost. CostLedger registra custos, mas não
  comprova os limites LIVE aprovados.
- Sem execução LIVE ou chamadas pagas. Custo de API nesta execução:
  US$ 0,00; custo computacional local não apurado.

## Ordem anterior — backlog preservado, sem prioridade vigente

  -------------------------------------------------------------------------
  Prioridade              Frente                  Resultado
  ----------------------- ----------------------- -------------------------
  P0                      VG00 --- Video          contrato e job
                          Generation Foundation   independentes de
                                                  UI/provider

  P1                      MM01 --- MiniMax Local  H3 local atrás da porta,
                                                  via ComfyUI

  P2                      VP01 --- Video Planner  vídeo/imagem/instruções
                          & Multimedia Input      opcionais e plano
                                                  aprovável

  P3                      VE01 --- Video Edit /   ANALYZE, REEDIT, ENHANCE,
                          Remix                   REMIX, GENERATE

  P4                      MC01 --- Cloud Video    MiniMax Cloud e futuros
                          Providers               providers sem alterar
                                                  domínio

  P5                      FE01 --- Frontend       UI consome apenas API
                          Contract / React        MKTauto

  P6                      INF01 --- Workers &     separação operacional
                          Containers              gradual

  P7                      MS01 --- Microservices  extrair somente
                          Extraction              responsabilidades
                                                  justificadas
  -------------------------------------------------------------------------

## Dependência anterior — referência de backlog

``` text
VG00
  ↓
MM01
  ↓
VP01
  ↓
VE01
  ↓
MC01

VG00 ─────────────→ FE01
VG00 + fluxo estável → INF01 → MS01
```

`MC01` pode evoluir depois de a porta estar comprovada localmente.
`FE01` não depende de MiniMax: depende do contrato estável de jobs/API.
`INF01` só começa após o fluxo funcional estar estável. `MS01` não é
meta por si só.

## Decisões anteriores — aplicáveis somente ao backlog MiniMax

-   `VideoGenerationPort` representa capacidade, não fornecedor.
-   `MiniMaxLocalAdapter` usa ComfyUI/H3 local.
-   Futuro `MiniMaxCloudAdapter` usa API oficial sem vazar contrato do
    fornecedor para domínio/UI.
-   `VideoGenerationJob` pertence ao MKTauto e é independente de
    UI/provider.
-   Estados normalizados: `queued`, `preparing`, `generating`,
    `processing`, `completed`, `failed`.
-   Progresso percentual só existe quando houver evidência real do
    provider; caso contrário é ausente/nulo.
-   Modos previstos: T2V, I2V e FL2V.
-   Workflow H3 é template JSON versionado; adapter clona e altera
    apenas inputs dinâmicos.
-   Entrada de imagem/vídeo e ideias/instruções do usuário são opcionais
    quando o modo permitir.
-   `VideoPlan` separa sugestão/planejamento de execução cara.
-   Ações previstas: `ANALYZE`, `REEDIT`, `ENHANCE`, `REMIX`,
    `GENERATE`.
-   Front atual e React futuro conhecem API MKTauto, não
    ComfyUI/MiniMax.
-   Arquitetura: modular-first, microservices-ready.
-   Workers/containers são extraídos gradualmente.
-   ComfyUI/H3 permanece inicialmente no host; não containerizar antes
    de estabilizar.
-   Contratos pequenos e estáveis são requisito também para reduzir
    contexto do Codex.

## Gates anteriores — somente para eventual execução do backlog H3

-   Validar upload/transferência de frames dinâmicos do MKTauto para o
    ComfyUI.
-   Validar localmente T2V no workflow comunitário de 8 GB antes de
    afirmar suporte local.
-   Não substituir o workflow FL2V já comprovado sem teste específico.
-   Não executar H3 real em testes automáticos.

## Regra de prioridade

### Task P3.HYBRID-01 — contrato autorizado pelo Planner

- READ: compositor P3, adaptação, contratos e storage existentes; adapter fal.ai e testes diretamente relacionados para integração simulada.
- MODIFY: este roadmap, `src/video-composer.js`, `src/adapters/ffmpeg-video-composer.js`.
- CREATE: `src/domain/hybrid-composition-contracts.js`, `src/adapters/ffmpeg-hybrid-composition.js`, `test/hybrid-video.test.js`.
- Entrada: `hybrid-composition/1.0.0`, imagem PNG e MP4 por referências opacas/hashes, direitos explícitos da imagem/vídeo/áudio, CTA fixa e três perfis. Reutiliza resultado armazenado pelo adapter fal.ai; composição não despacha geração.
- Saída: master 9:16 e derivados 9:16, 4:5, 1:1, manifesto com hashes, referências, timeline, direitos declarados, offset de áudio, fonte e toolchain. Nenhuma aprovação comercial é criada.
- Erros: direitos ausentes, hashes divergentes, mídia inválida, clipe fora de 4–6s, FPS fora de 24/30, rotação/SAR incompatível ou reconciliação corrompida bloqueiam. Legado com voz não muda.
- Áudio: faixa original decodificada, alinhada em +2s respeitando offset original; silêncio fora da cena IA. AAC recodificado uma vez na composição e copiado nos derivados; não promete identidade binária com o AAC original.
- Idempotência: receipt atômico do master e manifesto final persistidos fora do Git; reinício reutiliza master/derivados e verifica hashes. Falha após master permite completar adaptação sem reencodificar master.
- Fixtures/mocks: MP4 local com produto preservado, marcador móvel e seno autorizado para simulação; nenhuma rede real. Prévia em `outputs/P3.HYBRID-01/`, explicitamente `SIMULATED`.
- Custos: chamadas pagas 0, API US$ 0 nesta execução exclusivamente local; custo computacional local indisponível (`null`). Banco principal e BudgetGate inalterados.
- Testes: `node --test test/hybrid-video.test.js`; regressão focada nos testes do compositor, adaptação e E2E fal.ai/P3 existentes. Verificar duração, CTA, movimento, proporções, áudio/sincronia, integridade, direitos e reinício.
- Resultado local: 3 testes híbridos e 22 de regressão PASS; fixture de 121 frames/24fps (5,042s medidos), áudio com offset original, encerramento de 2,958s e derivados de 10s/240 frames. Correlação de áudio >0,98; silêncio local, recuperação após interrupção e rejeição de manifesto/artefato adulterados comprovados. Produto e CTA conferidos visualmente. Prévia 9:16: `outputs/P3.HYBRID-01/SIMULATED-aura-one-9-16.mp4`; manifesto: `outputs/P3.HYBRID-01/SIMULATED-manifest.json`.
- NÃO FAZER: LIVE, créditos, narração nova, publicação, banco principal, BudgetGate, refatorações laterais, commit/push/PR.

Executar o tópico funcional de tamanho útil `READY_FOR_CODEX` cuja dependência esteja
concluída. Uma task bloqueada não autoriza antecipar arquitetura
dependente; retornar ao ChatGPT para decisão.

## Instagram MVP — fechamento operacional e estratégia futura

### COMMERCIAL-003 — custos e prontidão de rentabilidade (10/11/2026)

Base confirmada `dc0f5a49943f63d73492c993eb153557fd4209f3` (merge #135).
Entrega técnica validada na branch isolada `feature/mktauto-commercial-profitability`,
aguardando revisão e merge manual do PR.
Extensão restrita a Commercial em `publishing/*commercial-measurement*`,
expressamente autorizada pelo usuário. Novo estado opcional da comissão e
projeção de prontidão preservam normalização, hashes, replay e campos antigos.
Custos registrados sem classificação não viram despesas confirmadas; somente
evidência tipada de reconciliação Finance compõe o subtotal TTS comprovado,
inclusive zero. Lucro, margem e ROI definitivos continuam UNKNOWN por falta de
custeio completo e alocação comprovada; saldo parcial tem escopo explícito.
Sem alteração Finance, Affiliate, Publishing operacional, migrations ou LIVE.
Mapa, contratos, evidências e pendências em
[`tasks/COMMERCIAL-003.md`](tasks/COMMERCIAL-003.md). COMMERCIAL-002 segue
aguardando amostra real Shopee. USER_ONLY_MERGE; sem próximo tópico iniciado.
TDD comprovou a lacuna antes da correção. Validação offline: 934 regressões
PASS em 76 arquivos; 57 testes Commercial na execução final focada; cinco E2E
Finance/Publishing PASS. TypeScript, build, lint (oito avisos preexistentes),
Prettier do escopo e diff-check passaram. As contagens se sobrepõem.

### COMMERCIAL-001 — rastreamento comercial integrado (10/11/2026)

Entrega técnica validada, aguardando revisão e merge manual do PR. Base remota
confirmada: `d64b24aea4d20341387e2403a630327b98b5a883` (#133); branch isolada
`feature/mktauto-commercial-tracking`. Reutilizados os contratos e consultas
Commercial existentes, sem duplicação de módulos ou auditoria de catálogo.

A projeção agora expõe projeto/versão do pacote persistido, inclusive em consultas
de resultados V2 antigos, sem regravar histórico, hashes ou recibos de replay.
Produto, oferta Affiliate/revisão, campanha, execução, operação, plataforma,
recibo e link conservam os vínculos congelados e a distinção KNOWN/UNKNOWN.
TDD demonstrou a lacuna antes da correção; 41 testes Commercial passaram,
incluindo HTTP fake, Facebook e preservação histórica. Regressões: 920 PASS
em 75 arquivos e 29 E2E PASS em quatro arquivos. TypeScript, build, lint
(oito avisos preexistentes), Prettier do escopo e diff-check passaram.

Evidência e mapa dos filhos C-01 a C-08 em
[`tasks/COMMERCIAL-001.md`](tasks/COMMERCIAL-001.md). Validação offline com SQLite
descartável não comprova venda, comissão ou rentabilidade reais. COMMERCIAL-002
depende de amostra Shopee real autorizada/sanitizada e pacote aprovado; nenhum
layout oficial ou importador foi presumido. AFFILIATE-001 permanece em
READY_AWAITING_APPROVAL. Sem cadastro, grant, publicação, chamada paga,
recorrência D1/D2, alteração Finance ou acesso ao SQLite LIVE.
USER_ONLY_MERGE; próximo tópico não iniciado.

- O fechamento atual integra legenda automática fundamentada nos dados cadastrados, revisão versionada, autorização específica de publicação quando necessária e agendamento Instagram fake. Direitos, QC, Finance, aprovação da versão exata e histórico permanecem obrigatórios.
- A extração local registra explicitamente modelo indisponível e ausência de nova inferência de IA; não representa uma chamada generativa nem autoriza chamadas pagas.
- **Estratégia futura: páginas dark.** Avaliar páginas temáticas sem exposição pessoal após a validação comercial do MVP. Cadastro de contas, identidade editorial, direitos e operação dessas páginas dependem de especificação e autorização futuras. Nenhuma funcionalidade de páginas dark é implementada neste fechamento.
