# MKTauto --- operação interna de aquisição e receita por conteúdo

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

## 1. Visão e evolução de longo prazo

O MKTauto é um sistema modular de automação de conteúdo, distribuição e
experimentação comercial. No horizonte atual, o operador individual usa
o próprio sistema para descobrir nichos, produzir conteúdo, adquirir
audiência, promover ofertas digitais, medir conversões e gerar receita.
O objetivo inicial é ganhar dinheiro **usando** o MKTauto, não vendendo
o MKTauto.

A evolução possui duas fases deliberadamente separadas:

``` text
Operator Revenue → validação operacional e econômica → Platform Revenue
```

Em `Operator Revenue`, o sistema funciona como ferramenta interna e
acumula evidência sobre conteúdo, canal, oferta, campanha, conversão,
receita e custo. Somente depois de o modelo funcionar internamente,
`Platform Revenue` poderá considerar SaaS, produto para terceiros,
automação como serviço, assinatura, créditos ou marketplace. Essa
segunda fase não integra o MVP comercial atual.

``` text
criar canais próprios → testar nichos e formatos → medir desempenho e receita
→ encerrar experimentos ruins → escalar vencedores → reinvestir
→ expandir canais, nichos e idiomas → acumular dados e inteligência
```

O objetivo não é maximizar volume, visualizações, likes ou seguidores
isoladamente. A função econômica de longo prazo é **maximizar lucro
sustentável por conteúdo, canal, nicho e unidade de capacidade
utilizada**, sem sacrificar direitos, segurança, qualidade ou
explicabilidade.

A persona principal é **o operador individual de um portfólio de canais
temáticos**. Várias configurações podem coexistir, mas cada execução
processa um projeto e um conteúdo por vez no MVP.

Não há promessa de viralidade ou renda. IA sugere e produz artefatos;
regras de estado, direitos, validação, aprovação, idempotência e efeitos
externos permanecem determinísticas.

### Objetivo anterior do MVP — referência histórica

O MVP deve primeiro permitir ao operador pesquisar, produzir, aprovar,
distribuir e aprender com conteúdo original. A camada comercial entra
progressivamente, depois de produção e publicação suficientes para
sustentar evidência real. Ela não altera retroativamente `Project`,
`ProjectSnapshot`, `PipelineRun`, `Research`, ideias, roteiro, linhagem
ou custos já implementados.

O primeiro modelo operacional evita escala prematura:

``` text
1 nicho → 1 canal → 1 a 3 ofertas → 30 a 50 conteúdos
→ mensuração → aprendizado → otimização
```

### Estratégia comercial

A progressão de monetização do operador é:

``` text
afiliados de produtos digitais
→ ADRs, automações, agentes e ferramentas digitais de terceiros
→ produtos digitais simples próprios
→ SaaS futuro, somente após validação interna
```

### Loop de crescimento

``` text
Research → Idea → Script → Content → Publish → Audience → Traffic
→ Offer → Conversion → Revenue → Analytics → novo Research
```

Esse fluxo é um ciclo de aprendizado: dados comerciais complementam, sem
substituir, critérios editoriais, direitos, aprovação humana e
qualidade.

### Métricas comerciais futuras

Quando a cadeia de evidência existir, a arquitetura deverá suportar
views, CTR, leads, conversão, receita, comissão, receita por vídeo,
oferta, campanha e canal, além de custo, lucro, margem, ROAS e RPM.
Estas são metas futuras; esta decisão não cria contratos, persistência,
integrações ou dashboards.

## 2. Princípios invariantes

-   preservar e expandir incrementalmente o software existente;
-   usar APIs oficiais e registrar cobertura parcial ou bloqueio sem
    scraping;
-   criar conteúdo original, sem copiar roteiro, voz, identidade ou
    mídia protegida;
-   usar somente mídia própria, licenciada ou expressamente autorizada;
-   exigir aprovação humana da versão exata antes de qualquer publicação
    no MVP;
-   manter exportação manual como fallback de publicação;
-   isolar fornecedores atrás de interfaces pequenas e versionadas;
-   usar o menor modelo de IA capaz de entregar qualidade suficiente
    para cada tarefa e só escalar quando o ganho esperado justificar
    custo e latência;
-   registrar linhagem, versões, transições e decisões relevantes;
-   preservar snapshots históricos de métricas, receita, custo e
    decisões, sem atualização destrutiva;
-   avaliar prioridade pela contribuição para descobrir, produzir, medir
    ou escalar ativos digitais lucrativos;
-   manter tokens, mídia privada, transcrições, payloads e runtime fora
    do Git;
-   implementar somente o necessário para a fase ativa.

## 3. Base anterior e reaproveitamento

A auditoria P0 do checkout encontrou também voz, mídia, composição FFmpeg,
legendas, preview, QC e aprovação humana. Custos são parciais. A descrição
abaixo preserva a base anterior; não representa certificação operacional LIVE.

O núcleo existente cobre o início de `Research`, não publicação. Ele já
oferece:

  -----------------------------------------------------------------------
  Componente                          Reuso na nova arquitetura
  ----------------------------------- -----------------------------------
  Radar diário e catálogo             Descoberta de temas e referências
                                      para um projeto.

  YouTube, Instagram, Threads e       Adapters de pesquisa oficial com
  TikTok                              capacidades explícitas.

  Wikimedia Commons                   Fonte futura de alternativas com
                                      licença permitida.

  Contratos versionados               Base para artefatos e fronteiras
                                      entre módulos.

  Ranking determinístico              Base do `IdeaScorer` e de decisões
                                      explicáveis.

  Ollama estruturado                  Primeiro adapter local de
                                      inteligência de conteúdo.

  SQLite e migrações                  Persistência local incremental.

  Idempotência e deduplicação         Padrão para runs, jobs e efeitos
                                      externos.

  Estados e eventos                   Base para histórico de conteúdo e
                                      publicação.

  CLI, servidor e exportação          Interfaces locais e fallback
                                      operacional.
  -----------------------------------------------------------------------

Os adapters sociais existentes consultam referências; eles **não**
implementam `SocialPublisher`. Publicação, agendamento e analytics serão
portas e adapters separados para impedir que pesquisa adquira efeitos
externos por acidente.

O pipeline anterior de cortes derivados de upload permanece como
evidência e capacidade futura. Os tópicos concluídos não são
descartados; radar, direitos, linhagem, transcrição e composição podem
ser reutilizados quando o produto voltar a aceitar mídia-fonte. O
primeiro MVP da visão V06 prioriza geração original.

## 4. Configuração de projeto/canal

`Project` é a raiz de configuração que alimenta todo o pipeline. Um
snapshot imutável da versão usada acompanha cada execução.

``` yaml
project:
  id: project_curiosidades_ia
  name: Curiosidades IA
  niche: inteligencia_artificial
  subniches: [ferramentas, curiosidades, produtividade]
  audience:
    language: pt-BR
    profile: pessoas interessadas em tecnologia
  references:
    - platform: instagram
      handle: perfilA
      purpose: strategic_reference
  content:
    format: short_video
    aspect_ratio: "9:16"
    min_duration_seconds: 25
    max_duration_seconds: 45
    voice_style: informativa
    visual_style: dinamico
  publishing:
    contents_per_day: 2
    networks: [instagram, facebook, threads, tiktok]
    timezone: America/Sao_Paulo
    times: ["10:00", "18:00"]
```

Referências servem para identificar temas, hooks, estrutura, ritmo, CTA,
frequência e linguagem visual. Elas nunca concedem direito de uso nem
autorizam reprodução de materiais ou identidade.

## 5. Modelo Portfolio-First

`Portfolio` é o nível econômico superior e reúne nichos, projetos/canais
próprios e experimentos. Um `Project` continua sendo a raiz operacional
configurada e um `ProjectSnapshot` continua fixando sua versão em cada
execução.

``` text
Portfolio
├── Niche
│   ├── Project / Channel
│   └── Project / Channel
└── Experiments
```

Os níveis `Portfolio`, `Niche`, `Project`, `Channel`, `Content` e
`Experiment` terão análises distintas. Isso é direção de domínio: o
estado atual implementa projetos e pesquisa, mas ainda não implementa
`Portfolio` nem `Experiment`.

## 6. Módulos

``` text
Project Configuration
        ↓ ProjectSnapshot
Research
        ↓ TopicCandidates / ReferenceInsights
Content Intelligence
        ↓ IdeaCandidate / IdeaScore
Content Production
        ↓ Script / Voice / Media / Video / Subtitles / Metadata
Quality Control
        ↓ ValidationReport
Preview and Human Approval
        ↓ ApprovedContentVersion
Scheduler
        ↓ PublishingJob
Social Publisher
        ↓ Publication
Offer and Campaign
        ↓ Offer / Campaign / commercial CTA
Attribution and Traffic
        ↓ Attribution / TrafficEvent
Conversion
        ↓ ConversionEvent
Revenue Ledger
        ↓ RevenueEvent
Commercial Analytics
        ↓ MetricSnapshot / RevenueSnapshot / economics view
Optimization Engine
        ↓ OptimizationRecommendation
Portfolio Allocation
        ↓ AllocationRecommendation
```

Cada módulo consome contratos validados e produz artefatos rastreáveis.
Falha obrigatória interrompe o item; nenhum módulo corrige
silenciosamente a saída de outro ou pula uma aprovação.

`Campaign` deverá relacionar pelo menos `Project/Channel`, `Offer`,
`Content/Artifact` e CTA comercial; não será um agrupador genérico. Uma
estratégia ou configuração de tracking poderá ser associada de forma
opcional e futura, mas `Attribution` efetiva não é pré-requisito de
`Campaign` e nasce somente em `Attribution and Traffic` (E12). O
`Revenue Ledger` será separado do `CostLedger`, preferencialmente
append-only e auditável. Contratos técnicos para esses conceitos serão
definidos apenas em tópicos futuros. `Commercial Analytics` relacionará
a cadeia comercial a receita e custo, enquanto `Portfolio Allocation`
recomendará onde investir capacidade. Essas capacidades permanecem
futuras e não autorizam decisão ou efeito automático.

No plano anterior, preservado como histórico, `Scheduler and Daily Automation` e
`Offer and Campaign` podem avançar em paralelo depois de
`Social Publisher`. A automação diária não é dependência para iniciar a
validação de `Operator Revenue` com publicações já disponíveis.

## 7. Entidades principais

  -----------------------------------------------------------------------
  Entidade                            Responsabilidade mínima
  ----------------------------------- -----------------------------------
  `Portfolio`                         Agrupar ativos próprios e oferecer
                                      contexto econômico comum.

  `Niche`                             Classificar estratégia e análise
                                      entre projetos relacionados.

  `Project`                           Identidade, nicho, público e versão
                                      da configuração.

  `ChannelProfile`                    Preferências editoriais e destinos
                                      de um projeto.

  `ReferenceProfile`                  Referência estratégica, origem e
                                      finalidade permitida.

  `ContentItem`                       Identidade estável da unidade de
                                      conteúdo e estado atual.

  `ContentVersion`                    Versão imutável dos artefatos que
                                      formam um preview.

  `PipelineRun`                       Execução, snapshot do projeto,
                                      etapas, custos e falhas.

  `Artifact`                          Saída versionada com tipo, hash,
                                      origem, direitos e localização.

  `Approval`                          Decisão humana sobre o hash exato
                                      de uma versão.

  `StateTransition`                   Estado anterior/seguinte, ator,
                                      motivo e instante.

  `PublishingJob`                     Plataforma, agenda, tentativas e
                                      chave de idempotência.

  `Publication`                       ID externo, estado reconciliado e
                                      versão publicada.

  `MetricSnapshot`                    Métricas opcionais observadas em um
                                      instante.

  `Experiment`                        Hipótese, janela, variantes,
                                      evidências e decisão registrada.

  `Offer`                             Oferta promovida, tipo, plataforma,
                                      destino, nicho e condições
                                      comerciais sem credencial.

  `Campaign`                          Relação rastreável entre
                                      `Project/Channel`, `Offer`,
                                      `Content/Artifact` e CTA comercial;
                                      pode receber configuração futura de
                                      tracking, sem exigir `Attribution`
                                      efetiva.

  `CTA`                               Objetivo comercial e destino
                                      vinculados ao conteúdo sem alterar
                                      o CTA editorial de `Script`.

  `Attribution`                       Identificadores e regras
                                      versionadas que explicam a origem
                                      de tráfego e conversão.

  `TrafficEvent`                      Clique ou visita observada com
                                      campanha, origem e instante
                                      conhecidos.

  `ConversionEvent`                   Lead ou venda observada, ligada à
                                      evidência de atribuição disponível.

  `RevenueEvent`                      Receita atribuída, moeda, origem e
                                      instante imutáveis.

  `RevenueLedger`                     Histórico auditável de receita
                                      comercial, separado do
                                      `CostLedger`.

  `RevenueSnapshot`                   Visão histórica de receita em uma
                                      janela de análise.

  `CostLedger`                        Eventos de custo atribuíveis a run,
                                      conteúdo ou projeto.

  `OptimizationDecision`              Recomendação explicável, evidências
                                      e aplicação.

  `AllocationRecommendation`          Distribuição sugerida de
                                      orçamento/capacidade.
  -----------------------------------------------------------------------

As entidades comerciais, de portfólio e economia são conceitos futuros,
não contratos, tabelas ou serviços autorizados por esta decisão.
Artefatos iniciais incluem `TopicCandidate`, `IdeaCandidate`,
`IdeaScore`, `Script`, `VoiceTrack`, `MediaAsset`, `VideoRender`,
`SubtitleTrack`, `ContentMetadata` e `ValidationReport`.

## 8. Estados

Fluxo normal de conteúdo:

``` text
DRAFT → IDEA_APPROVED → SCRIPT_READY → MEDIA_READY → VIDEO_READY
      → VALIDATED → APPROVED → SCHEDULED → PUBLISHED → ANALYZED
```

Estados terminais ou de exceção: `FAILED`, `REJECTED` e `CANCELLED`.

Regras:

-   transições permitidas são enumeradas e testadas;
-   toda transição registra ator, instante e motivo;
-   alterar qualquer artefato após aprovação cria nova versão e invalida
    aprovação;
-   somente `APPROVED` pode originar agendamento;
-   falha de publicação não altera nem elimina a versão aprovada;
-   retry usa a mesma identidade lógica e não pode duplicar publicação.

Jobs de publicação usam `PENDING`, `PROCESSING`, `PUBLISHED`, `FAILED`,
`RETRYING` e `CANCELLED`.

Experimentos futuros registram uma recomendação `KILL`, `CONTINUE` ou
`SCALE`, sempre sustentada por evidências, política versionada e
validação humana. Uma IA não encerra canal, amplia orçamento nem muda
regra financeira por conta própria.

## 9. Portas entre módulos

As interfaces representam capacidades, não fornecedores:

-   `TrendSource.discover(projectSnapshot)`;
-   `ReferenceAnalyzer.analyze(reference, projectSnapshot)`;
-   `IdeaGenerator.generate(context)`;
-   `IdeaScorer.score(ideas, policy)`;
-   `ScriptGenerator.generate(approvedIdea, projectSnapshot)`;
-   `VoiceProvider.synthesize(script, voiceProfile)`;
-   `MediaProvider.provide(mediaRequest)`;
-   `VideoComposer.compose(compositionPlan)`;
-   `SubtitleGenerator.generate(script, voiceTrack)`;
-   `MetadataGenerator.generate(contentVersion, platformContext)`;
-   `QualityValidator.validate(contentVersion, policy)`;
-   `SocialPublisher.publish(request)`, `getStatus(reference)` e
    `deletePublication(reference)` quando a plataforma permitir;
-   `AnalyticsProvider.collect(publication, cursor)`;
-   `RevenueProvider.collect(source, cursor)`;
-   `OptimizationAdvisor.recommend(evidence, policy)`;
-   `ExperimentPolicy.evaluate(experiment, evidence)`;
-   `AllocationPolicy.recommend(portfolio, capacity, evidence)`.

Capacidades de IA são portas da aplicação, como `IdeaGenerator`,
`ScriptGenerator`, `ContentAnalyzer`, `OptimizationAdvisor`,
`EmbeddingProvider` e `LLMProvider`. A aplicação solicita uma capacidade
e uma política de tarefa versionada; um `AIModelRouter` de
infraestrutura escolhe o provider e o modelo configurados antes de
chamar o adapter:

``` text
Application → AI Port → AIModelRouter → Provider Adapter → Model
```

OpenAI/GPT é o provider inicial previsto e entra somente por um
`OpenAIAdapter`. Domínio e aplicação não importam SDK, nomes de modelos
ou tipos do fornecedor; esses nomes pertencem à configuração e aos
adapters. A política inicial é simples e determinística, sem routing por
machine learning. Adapters locais, self-hosted ou especializados são
possibilidades futuras, não requisitos atuais. A política detalhada está
em `docs/MODULAR_VIDEO_PIPELINE.md`.

Operações de publicação específicas por formato podem existir nas
capacidades do adapter, mas o domínio não deve presumir que todas as
redes aceitam vídeo, imagem, texto, exclusão ou as mesmas métricas.

## 10. Estrutura futura

Esta é uma direção de organização, não uma autorização para mover
arquivos antes de haver uma entrega que exija a mudança:

``` text
src/
├── domain/
│   ├── projects/
│   ├── portfolio/
│   ├── content/
│   ├── publishing/
│   ├── analytics/
│   └── economics/
├── application/
│   ├── project-configuration/
│   ├── content-pipeline/
│   └── publishing/
├── ports/
│   ├── intelligence/
│   ├── media/
│   ├── social/
│   └── storage/
├── adapters/
│   ├── research/
│   ├── generation/
│   ├── publishing/
│   └── analytics/
├── infrastructure/db/
└── interfaces/
    ├── cli/
    └── http/
```

Os arquivos atuais permanecem em seus locais até uma alteração pequena
demonstrar valor e possuir testes que tornem a movimentação segura.

## 11. Fases do produto

As etapas abaixo preservam a evolução anterior. A ordem executável vigente
é P1–P5 em `TOPIC_ROADMAP.md`: oferta/campanha antecedem geração e publicação
manual; Social Publisher e Daily Automation não são pré-requisitos comerciais.

### Stage 1 --- Machine / MVP 1 Content Machine

Entrada: projeto, nicho, tema e referências estratégicas. Saída: ideia,
roteiro, narração, mídia autorizada ou gerada, vídeo vertical, legenda,
hashtags e preview. Não publica automaticamente.

### Stage 2 --- Distribution

Publica por adapter oficial com aprovação humana, mantém exportação
manual como fallback e automatiza a rotina somente após estabilizar o
efeito externo. Assim que Publishing estiver disponível, Daily
Automation e a validação inicial de Offer and Campaign podem evoluir em
paralelo; concluir a automação diária não é condição para iniciar
`Operator Revenue`.

### Stage 3 --- Operator Revenue

Introduz, nesta ordem causal, oferta e campanha, atribuição e tráfego,
conversão, receita e analytics comercial. O objetivo é provar que o
operador consegue gerar e explicar receita com uma operação simples,
começando por afiliados. Pequenos experimentos comparam conteúdo, canal
e oferta somente quando a cadeia de evidência estiver disponível.

### Stage 4 --- Optimization and Scale

Otimização explicável e alocação recomendam onde ampliar produção. A
operação pode evoluir de afiliados para ferramentas de terceiros e
produtos digitais próprios, buscando crescer receita e lucro sem
crescimento proporcional de trabalho manual. Nenhuma recomendação altera
conteúdo, oferta ou orçamento automaticamente.

### Stage 5 --- Platform / futuro

Somente após a validação de `Operator Revenue`, capacidades podem gerar
`Platform Revenue` como SaaS, API, automação como serviço, assinatura,
créditos, marketplace, templates ou intelligence platform. Multi-tenant,
billing de clientes e demandas comerciais da plataforma não influenciam
o MVP atual.

### Sequência anterior dos MVPs — referência histórica

1.  MVP 1 --- Content Machine;
2.  MVP 2 --- Publishing;
3.  após Publishing, duas frentes podem evoluir em paralelo:
    -   MVP 3 --- Daily Automation;
    -   MVP 4 --- Offer and Campaign;
4.  MVP 5 --- Attribution and Traffic;
5.  MVP 6 --- Conversion and Revenue Ledger;
6.  MVP 7 --- Commercial Analytics and Experiments;
7.  MVP 8 --- Optimization and Portfolio Allocation.

Na cadeia comercial, o MVP 4 depende de Publishing, não de Daily
Automation. Isso preserva a ordem produção → publicação →
oferta/campanha → atribuição/tráfego → conversão → receita → analytics →
otimização sem atrasar a primeira validação de receita até a conclusão
do MVP 3. Infraestrutura de IA própria e Platform Revenue permanecem
futuras. Cada MVP é decomposto em tópicos menores no roadmap.

## 12. Dados e economia como ativos

Um dos principais ativos de longo prazo do MKTauto será seu histórico
proprietário de experimentos, conteúdos, estratégias, desempenho e
monetização. A cadeia prioritária é:

``` text
ProjectSnapshot → PipelineRun → Artifact lineage → CostLedger
```

Depois de conteúdo e publicação, a cadeia comercial adiciona, sem
substituir essa fundação: Offer/Campaign → Attribution/Traffic →
Conversion → RevenueLedger → Commercial Analytics.

O histórico deve relacionar, quando existirem, `ProjectSnapshot`,
`ContentVersion`, `GenerationConfiguration`, provider/modelo de IA, tipo
da tarefa, versão de prompt, tema, hook, roteiro, voz, mídia, vídeo,
contexto de publicação, métricas, receita, custo e decisão de
otimização. Isso viabiliza análises, backtests, ranking, recomendação,
previsão e modelos próprios futuros sem torná-los requisito.

Para toda chamada de IA, a observabilidade futura registra, quando
disponível, `provider`, `model`, `task_type`, `prompt_version`, tokens
de entrada, saída e cache, custo, latência, instante, sucesso, fallback
e hashes de entrada e saída. O registro liga a chamada à `PipelineRun`,
à linhagem do artefato e ao `CostLedger`. Segredos e prompts privados
não entram em logs ou Git.

Essa relação deve permitir comparar modelos por tarefa usando custo,
latência, qualidade editorial, aprovação humana, retenção, engajamento,
conversão, receita, lucro e ROI. A função objetivo futura combina custo,
qualidade e impacto; ela não escolhe sempre o modelo mais barato.

A evolução prevista é incremental:

``` text
Fase A: OpenAI com modelos roteados por política
Fase B: OpenAI + modelos locais experimentais
Fase C: modelos próprios especializados + OpenAI como fallback
Fase D: roteamento por qualidade, custo, latência e ROI históricos
```

Modelos próprios priorizam capacidades especializadas, como ranking de
hooks, ideias e roteiros, classificação, previsão de performance e
otimização, em vez de um único LLM geral. As fases B, C e D permanecem
futuras.

`Content Economics` deverá responder quanto custou criar e distribuir,
quanto gerou e quanto lucrou. `PipelineRun` permanece a unidade técnica.
O futuro `RevenueLedger` deve preservar eventos de receita
preferencialmente append-only, com origem, moeda, instante e evidência
auditáveis, e permanecer estritamente separado do `CostLedger` já
existente. A união ocorre somente em visões de economia capazes de
agregar conteúdo, oferta, campanha, canal, projeto, nicho e portfólio;
esta decisão não define seu contrato técnico.

## 13. Capacidades por horizonte

  -----------------------------------------------------------------------
  Horizonte                           Capacidade
  ----------------------------------- -----------------------------------
  Atual                               Configuração versionada, Research,
                                      ideias, roteiro, `PipelineRun`,
                                      linhagem e custos.

  Próximo — Affiliate-First           Produto/campanha, fal.ai, finalização,
                                      revisão comercial, exportação e
                                      publicação manual; ver P1–P4.

  Futuro --- Operator Revenue         Oferta/campanha,
                                      atribuição/tráfego, conversão,
                                      receita, analytics comercial,
                                      experimentos e otimização.

  Futuro --- Platform Revenue         SaaS, produto para terceiros,
                                      billing, marketplace e outras
                                      receitas da própria plataforma.
  -----------------------------------------------------------------------

Não implementar antecipadamente SaaS, multi-tenant, billing,
marketplace, infraestrutura GPU, modelos próprios, ML avançado,
alocação, previsão, scaling ou monetização automáticos.

## 14. Quality Control

Antes de aprovação, validadores verificam pelo menos existência dos
artefatos, duração, resolução, proporção, áudio, legendas, texto,
limites conhecidos da plataforma, formato, duplicidade, renderização,
mídia ausente, direitos declarados e sinais de conteúdo potencialmente
inadequado.

Validações obrigatórias falhas impedem aprovação. Alertas revisáveis
permanecem visíveis ao operador e integram a decisão registrada.

## 15. Segurança, direitos e privacidade

-   credenciais entram somente por configuração segura e com menor
    privilégio;
-   logs e erros não incluem tokens, URLs privadas ou payloads
    sensíveis;
-   artefatos privados usam storage fora do Git, hashes e acesso
    temporário;
-   origem, licença e consentimento acompanham cada mídia;
-   referência pública não equivale a licença de reutilização;
-   publicação e exclusão são efeitos externos auditáveis e
    idempotentes;
-   retenção, takedown e operação pública exigem gate específico antes
    do lançamento.

## 16. Estratégia de testes

-   TDD para entidades, transições, permissões, idempotência e
    contratos;
-   testes de contrato para cada adapter com respostas sanitizadas;
-   integração local para persistência, retry e recuperação de falhas;
-   fixtures próprias ou autorizadas para mídia e renderização;
-   smoke test em conta oficial de teste antes de habilitar cada
    plataforma;
-   publicação real nunca faz parte de uma suíte automática sem ambiente
    isolado e autorização explícita.

## 17. Riscos principais

  -----------------------------------------------------------------------
  Risco                               Mitigação inicial
  ----------------------------------- -----------------------------------
  Escopo crescer antes do primeiro    Fases e tópicos pequenos com gates.
  preview

  Conteúdo copiar referências         Linhagem, instruções de
                                      originalidade e revisão humana.

  Mídia sem direito de uso            Origem/licença obrigatórias e
                                      bloqueio determinístico.

  Custo ou latência de IA inviável    Orçamento por run, cache seguro e
                                      medição por provider.

  Dependência de fornecedor           Portas pequenas, capacidades
                                      explícitas e fallback.

  Duplicação de publicação            Chave idempotente, reconciliação e
                                      estado persistido.

  Métricas incompatíveis              Modelo opcional por plataforma e
                                      snapshots brutos sanitizados.

  Vazamento de segredo ou mídia       Storage privado, menor privilégio e
                                      Git restrito.

  Campanha virar agrupador genérico   Exigir relação explícita entre
                                      projeto/canal, oferta,
                                      conteúdo/artefato e CTA comercial;
                                      tracking futuro é opcional e
                                      `Attribution` efetiva pertence à
                                      etapa seguinte.

  Automação diária atrasar a          Permitir que Daily Automation e
  validação comercial                 Offer and Campaign evoluam em
                                      paralelo após Publishing.

  Receita sem cadeia de evidência     Implementar atribuição, tráfego e
                                      conversão antes de analytics
                                      comercial.

  Otimização opaca ou nociva          Recomendações explicáveis,
                                      auditáveis e reversíveis.

  Receita ou custo atribuídos         Eventos imutáveis, moeda/origem
  incorretamente                      explícitas e regras de atribuição
                                      versionadas.

  Escala baseada em amostra fraca     Políticas configuráveis, qualidade
                                      de dados visível e validação
                                      humana.
  -----------------------------------------------------------------------

## 18. Decisões V06, V07, V08 e V09

V06 substitui a prioridade futura de transformar mídia-fonte pela
prioridade de gerar conteúdo original a partir de uma configuração de
projeto/canal. Ela não remove entregas concluídas nem autoriza antecipar
módulos. O radar implementado torna-se a primeira capacidade do módulo
`Research`; publicação e analytics continuam inexistentes até seus
tópicos próprios.

O roadmap executável e a decomposição do primeiro épico estão em
`docs/TOPIC_ROADMAP.md`. Os artefatos, estados e regras de pipeline
estão em `docs/MODULAR_VIDEO_PIPELINE.md`.

V07 mantém essa arquitetura e muda a orientação estratégica de
plataforma genérica para operação Portfolio-First de ativos próprios.
Ela adiciona os domínios conceituais de experimentação, Revenue
Analytics, Content Economics e Portfolio Allocation, sem implementar
nenhum deles. SaaS deixa de orientar o MVP e passa a ser uma opção
condicionada à validação interna no Stage 5.

V08 define OpenAI como provider inicial multimodelo, com seleção
determinística por tarefa, complexidade e criticidade atrás de
`AIModelRouter`. Ela preserva Ports and Adapters, prepara telemetria
comparável e evolução para modelos especializados próprios, sem
implementar provider, router ou experimento.

V09 torna `Operator Revenue` a prioridade comercial: primeiro o operador
usa a cadeia de conteúdo e distribuição para promover ofertas e gerar
receita rastreável; somente a validação dessa operação permite
considerar Platform Revenue. A decisão introduz conceitos futuros de
oferta, campanha, CTA comercial, atribuição, tráfego, conversão e ledger
de receita, sem alterar contratos implementados. O CTA de `script/1.0.0`
continua sendo artefato editorial; qualquer vínculo comercial será
externo e definido por tópico próprio. `Campaign` não depende de
`Attribution` efetiva, que nasce no estágio seguinte, e Daily Automation
não bloqueia Offer and Campaign: ambas as frentes podem evoluir em
paralelo após Publishing.
