# Roadmap de tópicos do MKTauto

## Estado atual

| ID | Estado | Entrega | Evidência/aceite |
|---|---|---|---|
| B00 | CONCLUÍDO | Governança e cadastro local | Documentos-base e fluxo do projeto presentes. |
| V00 | CONCLUÍDO | Viabilidade e primeiro corte | Hipóteses e gates iniciais aprovados. |
| V01 | CONCLUÍDO | Estúdio de cortes dinâmicos | PR #5 mergeado. |
| R01 | CONCLUÍDO | Fluxo real e baseline | PR #10 mergeado; três cortes avaliados. |
| R01A | CONCLUÍDO | Descoberta assistida local | PR #8 mergeado. |
| V02 | CONCLUÍDO | Entrada por upload | PR #11 mergeado. |
| V03 | CONCLUÍDO | Estrutura futura de react | PR #12 mergeado. |
| V04 | CONCLUÍDO | Pipeline modular | PR #13 mergeado. |
| V05 | CONCLUÍDO | Decomposição do radar | PR #14 mergeado. |
| R02A–R02G | CONCLUÍDO | Contratos, histórico, fontes, ranking e catálogo | PRs #15–#22 mergeados. |
| R02H | CONCLUÍDO | Listagem oficial multirrede | PR #23 mergeado em 27/09/2026 (`c0454cd`). |
| V06 | CONCLUÍDO | Plataforma modular de conteúdo | PR #24 mergeado em 27/09/2026 (`95491bd`); 87 testes passaram. |
| PC01 | CONCLUÍDO | Contrato de Project/Channel | PR #25 mergeado em 27/09/2026 (`8c6ea64`); 96 testes passaram. |
| PC02 | CONCLUÍDO | Persistência e versionamento de Project/Channel | PR #26 mergeado em 27/09/2026 (`d2e6b06`); migração SQLite aditiva, histórico imutável e concorrência otimista; 108 testes passaram. |
| PC03 | CONCLUÍDO | Serviço de aplicação idempotente de Project/Channel | PR #28 mergeado em 27/09/2026 (`1b08a2c`); comandos explícitos, retries reproduzíveis e 117 testes passaram. |
| PC04 | CONCLUÍDO | Interface local de Project/Channel | PR #29 mergeado em 27/09/2026 (`5b16176`); 125 testes passaram. |
| PC05 | CONCLUÍDO | Handoff de ProjectSnapshot para o pipeline | PR #30 mergeado em 27/09/2026 (`35cede6`); contrato `pipeline-handoff/1.0.0` e 133 testes passaram. |
| E02-R01 | CONCLUÍDO | Entrada versionada de Research | PR #31 mergeado em 27/09/2026 (`824c6f3`); contrato `research-input/1.0.0` e 139 testes passaram. |
| E02-R02 | CONCLUÍDO | Radar diário vinculado ao projeto | PR #32 mergeado em 27/09/2026 (`7e0cf31`); `research-topic-catalog/1.0.0`, identidade multi-projeto, plano de fontes e 145 testes passaram. |
| E02-R03 | CONCLUÍDO | Análise de referências estratégicas | PR #33 mergeado em 27/09/2026 (`4cb6ce2`); `reference-insight/1.0.0`, consultas por handle, direitos restritos, migração 006 e 161 testes passaram. |
| E02-R04 | CONCLUÍDO | Shortlist de Research vinculada ao projeto | PR #34 mergeado em 27/09/2026 (`3908856`); `research-shortlist/1.0.0`, política determinística, migração 007 e 169 testes passaram. |
| V07 | CONCLUÍDO | Estratégia documental Portfolio-First | PR #35 mergeado em 27/09/2026 (`e413b68`); visão, pipeline e roadmap atualizados sem alteração de código. |
| V08 | CONCLUÍDO | Estratégia multimodelo de IA | PR #36 mergeado em 27/09/2026 (`2b272ce`); roteamento por política, telemetria e evolução para modelos próprios documentados sem alteração de código; 169 testes passaram. |
| FND01 | CONCLUÍDO | Persistência de PipelineRun | PR #37 mergeado em 28/09/2026 (`2eb0a94`); contrato `pipeline-run/1.0.0`, migração SQLite 008, identidade e transições imutáveis; 180 testes passaram. |
| FND02 | CONCLUÍDO | Linhagem comum de artefatos | PR #38 mergeado em 28/09/2026 (`df10017`); contrato `artifact-lineage/1.0.0`, migração SQLite 009 e histórico append-only; 194 testes passaram. |
| FND03 | CONCLUÍDO | Eventos de custo e CostLedger | PR #39 mergeado em 28/09/2026 (`439bb44`); contratos `cost-event/1.0.0` e `cost-ledger/1.0.0`, migração SQLite 010 e ledger append-only; 206 testes passaram. |
| E03-I01 | CONCLUÍDO | Contratos de ideias e scoring determinístico | PR #40 mergeado em 28/09/2026 (`ae443f8`); `idea-candidate/1.0.0`, `idea-score/1.0.0`, política versionada, migração SQLite 011 e persistência append-only; 221 testes passaram. |
| E03-I02 | CONCLUÍDO | Seleção humana de ideia append-only | PR #41 mergeado em 28/09/2026 (`a3ac4e7`); `idea-selection/1.0.0`, migração SQLite 012, revisão explícita e linhagem transacional; 232 testes passaram. |
| E04-S01 | CONCLUÍDO | Contrato e persistência append-only de roteiro | PR #42 mergeado em 28/09/2026 (`d78309f`); `script/1.0.0`, migração SQLite 013, revisão explícita e linhagem transacional; 243 testes passaram. |
| AI01 | CONCLUÍDO | Primeira geração de roteiro por OpenAIAdapter | PR #43 mergeado em 28/09/2026 (`a7065c9`); `script-generation-request/1.0.0`, porta `ScriptGenerator`, configuração sanitizada e migração SQLite 014; 258 testes passaram e 1 smoke opt-in foi ignorado. |
| V09 | CONCLUÍDO | Estratégia documental Operator Revenue | PR #44 mergeado em 28/09/2026 (`ab74e3c`); visão, cadeia comercial e roadmap atualizados sem alteração de código ou contratos existentes. |
| AI03 | CONCLUÍDO | Telemetria de custo e uso das chamadas de IA | PR #45 mergeado em 28/09/2026 (`9e8d359`); `ai-call-telemetry/1.0.0`, migração SQLite 015, correlação transacional com roteiro, linhagem e `CostLedger`; 267 testes passaram e 1 smoke opt-in foi ignorado. |
| E05-V01 | CONCLUÍDO | Contrato e persistência append-only de faixa de voz | PR #46 mergeado em 28/09/2026 (`17338dd`); `voice-track/1.0.0`, migração SQLite 016, direitos explícitos, storage opaco e linhagem transacional com o roteiro exato; 279 testes passaram e 1 smoke opt-in foi ignorado. |
| E05-V02 | CONCLUÍDO | Porta de provider e orquestração de geração de voz | PR #47 mergeado em 28/09/2026 (`f66e5c`); `voice-generation-request/1.0.0`, porta `VoiceProvider`, migração SQLite 017 e orquestração idempotente; 294 testes passaram e 1 smoke opt-in foi ignorado. |
| E06-M01 | CONCLUÍDO | Contrato e persistência append-only de ativo de mídia | PR #48 mergeado em 28/09/2026 (`2689359`); `media-asset/1.0.0`, migração SQLite 018, direitos comerciais explícitos, referência lógica opaca e linhagem transacional com roteiro e direção visual exatos; 308 testes passaram e 1 smoke opt-in foi ignorado. |
| E06-M02 | CONCLUÍDO | Porta de provider e orquestração de aquisição de mídia | PR #49 mergeado em 28/09/2026 (`d427594`); `media-acquisition-request/1.0.0`, porta `MediaProvider`, migração SQLite 019 e orquestração idempotente; 323 testes passaram e 1 smoke opt-in foi ignorado. |
| E07-C01 | CONCLUÍDO | Contrato e persistência append-only de plano de composição | PR #50 mergeado em 28/09/2026 (`bc2f162`); `composition-plan/1.0.0`, timeline contínua em milissegundos, migração SQLite 020 e linhagem transacional com roteiro, voz e mídia exatos; 341 testes passaram e 1 smoke opt-in foi ignorado. |
| E07-C02 | CONCLUÍDO | Contrato e persistência append-only de render de vídeo | PR #51 mergeado em 28/09/2026 (`3d5a5a0`); `video-render/1.0.0`, migração SQLite 021, propriedades reais informadas, proporção por aritmética inteira e linhagem transacional com o plano exato; 358 testes passaram e 1 smoke opt-in foi ignorado. |
| E07-C03 | CONCLUÍDO | Porta de composer e orquestração idempotente de render | PR #52 mergeado em 29/09/2026 (`a3fcf32`); `video-composition-request/1.0.0`, porta `VideoComposer`, migração SQLite 022 e persistência transacional de solicitação, `VideoRender` e linhagem; 373 testes passaram e 1 smoke opt-in foi ignorado. |
| V10 | CONCLUÍDO | Critical Path explícito do MVP 1 | PR #53 mergeado em 29/09/2026 (`062d11b`); replanejamento documental liga E07-C03 ao primeiro preview físico real, QC e aprovação humana sem enfraquecer a arquitetura. |
| E05-V03 | CONCLUÍDO | Real Voice Adapter | PR #54 mergeado em 29/09/2026 (`e6e7c42`); OpenAI Speech API produz WAV físico validado atrás da porta existente com voz `marin` e storage content-addressed. |
| E06-M03 | CONCLUÍDO | Real Media Adapter | PR #55 mergeado em 29/09/2026 (`1a28d5d`); OpenAI Image API produz PNG 9:16 físico validado, com storage content-addressed, direitos explícitos e custo somente sob evidência completa. |
| E07-C04 | CONCLUÍDO | Real VideoComposer / FFmpeg Adapter | PR #56 mergeado em 29/09/2026 (`2e2b1d2`); FFmpeg/FFprobe compõem WAV e PNG exatos em MP4 vertical físico, inspecionado e armazenado por conteúdo. |
| E07-S01A | CONCLUÍDO | SubtitleTrack Contract and Persistence | PR #57 mergeado em 29/09/2026 (`5be9534`); contrato fechado e persistência append-only ligam cues ao Script e VoiceTrack exatos. |
| E07-S01B | CONCLUÍDO | Deterministic Subtitle Cues and ASS/SRT | PR #58 mergeado em 29/09/2026 (`05268fd`); política fechada gera cues e representações ASS/SRT determinísticas em memória. |
| E07-S01C | CONCLUÍDO | Physical Subtitle Rendering | PR #59 mergeado em 30/09/2026 (`8039974`); burn-in FFmpeg produz `VideoRender` revisão 2 append-only, verificado por FFprobe e armazenado por conteúdo. |
| E07-P01 | CONCLUÍDO | End-to-End Real Preview | PR #60 mergeado em 30/09/2026 (`d60375f`); uma `PipelineRun` explícita produz ou retoma o preview físico revisão 2, revalida lineage e confirma seu SHA-256 físico. |
| E07-P02 | CONCLUÍDO | Local Preview Runner | PR #62 mergeado em 30/09/2026 (`9197add`); `npm run preview` executa ou retoma o pipeline real, distingue execução nova, retomada ou terminal reutilizada e apresenta a referência validada do MP4 final. |
| E08-Q01 | CONCLUÍDO | Quality Control | PR #63 mergeado em 30/09/2026 (`9bd6585`); QC automático verifica o render final legendado, direitos e lineage, com findings estruturados `PASS`, `FAIL` ou `WARN`. |
| E08-U01 | CONCLUÍDO | Operator Preview Console | PR #64 mergeado em 30/09/2026 (`de7de83`); interface web mínima inicia ou retoma o pipeline, reconstrói etapas persistidas, reproduz o render final exato e apresenta seu QC sem antecipar a decisão humana. |
| E08-A01 | CONCLUÍDO | Human Approval | PR #66 mergeado em 30/09/2026 (`ffd0d69`); decisão humana append-only vincula projeto/versão, `PipelineRun`, `VideoRender` ID/revisão/SHA-256 e QC ID/SHA-256 exatos. |
| E08-U02 | CONCLUÍDO | Operator Run & Idea Bootstrap | PRs #68–#75 mergeados; bootstrap, estabilização do preview, margem Script→Voice e tratamento seguro de respostas grandes foram concluídos. |
| FND04 | EM EXECUÇÃO | Stage Recovery Foundation | Contrato `stage-recovery/1.0.0`, migration 026, tentativas append-only, dependências explícitas e integração sem UI em validação. |
| E09 | BLOQUEADO | Social Publishing | Análise de entrada em 30/09/2026: plataforma oficial, conta de teste elegível, scopes de publicação, acesso publicador à API e fallback manual operacional não foram comprovados; o banco operacional possui zero decisões `APPROVED`, portanto G3 e G4 não estão satisfeitos. |

Os antigos R03–R09 foram planejados para um fluxo centrado em mídia-fonte. V06
os **replaneja**, sem apagar suas decisões: transcrição de mídia-fonte, cortes,
react, publicação Instagram e painel serão retomados pelos épicos correspondentes
quando suas dependências voltarem a ser prioritárias.

V06 foi validado com a suíte completa de 87 testes, `git diff --check` e revisão
do diff restrito a `README.md` e aos três documentos arquiteturais equivalentes.
O PR #24 foi aberto em 27/09/2026. Os arquivos locais não rastreados em `data/`
foram preservados e não integram a entrega.

V07 foi validado com a suíte completa de 169 testes, `git diff --check`, blocos
Markdown balanceados e revisão do diff restrito aos quatro documentos aprovados.
O PR #35 foi mergeado em 27/09/2026. Os arquivos locais não rastreados em `data/`
continuam preservados e não integram a entrega.

V08 foi validado com a suíte completa de 169 testes, `git diff --check`, blocos
Markdown balanceados e revisão do diff restrito aos quatro documentos aprovados.
O PR #36 foi mergeado em 27/09/2026 (`2b272ce`). Os arquivos locais não
rastreados em `data/` continuam preservados e não integram a entrega.

## Corte aprovado em V07

V07 preserva o corte técnico de V06: o primeiro MVP recebe configuração de
projeto, nicho, tema e referências
estratégicas e produz ideia, roteiro, narração, mídia autorizada ou gerada, vídeo
vertical, legendas, metadados e preview. Não há publicação automática no MVP 1.

A finalidade muda de uma plataforma genérica para uma máquina própria de ativos
digitais. O sistema deve descobrir, produzir, medir e escalar canais próprios com
foco em lucro sustentável. SaaS é possibilidade futura e não orienta o MVP.

Defaults:

- persona única: operador individual de um portfólio de canais temáticos;
- `Portfolio` é o contexto econômico; `Project` continua a raiz operacional;
- um projeto e um conteúdo por execução;
- conteúdo original, sem copiar referências;
- formato inicial de vídeo curto vertical `9:16`;
- APIs oficiais e cobertura parcial explícita;
- aprovação humana da versão exata antes de efeitos externos;
- mídia privada, tokens e runtime fora do Git;
- interfaces de provider introduzidas somente quando consumidas pelo tópico;
- OpenAI/GPT será o primeiro provider da geração, atrás de portas da aplicação;
- histórico de métricas, custos, receitas e decisões nunca é sobrescrito;
- exportação manual preservada como fallback.

## Corte estratégico aprovado em V09

V09 mantém a arquitetura Portfolio-First, mas define `Operator Revenue` como
prioridade comercial. O MKTauto será usado internamente para produzir e publicar
conteúdo, adquirir audiência, promover ofertas e gerar receita rastreável. O
objetivo imediato é ganhar dinheiro usando o sistema; `Platform Revenue` — SaaS,
produto para terceiros, assinatura, créditos ou marketplace — depende de
validação operacional e permanece fora do MVP comercial atual.

O modelo inicial evita escala prematura: um nicho, um canal, uma a três ofertas e
30 a 50 conteúdos antes de ampliar a operação. A evolução comercial respeita a
cadeia causal:

```text
produção → publicação → oferta/campanha → atribuição/tráfego
→ conversão → receita → analytics → otimização
```

Os contratos implementados continuam válidos. Em particular, o CTA opcional de
`script/1.0.0` permanece editorial; `Offer`, `Campaign`, CTA comercial,
`Attribution`, `Conversion` e `RevenueLedger` serão conceitos desacoplados,
introduzidos apenas por seus tópicos futuros.

Após E09, E10 Daily Automation e E11 Offer & Campaign podem evoluir em
paralelo. E11 depende de E09, não de E10, para que a validação inicial de
`Operator Revenue` possa começar com publicação disponível mesmo antes de a
rotina diária estar automatizada.

V09 foi validado com `git diff --check`, presença dos termos e da ordem causal
aprovados, blocos Markdown balanceados e revisão do diff restrito aos dois
documentos previstos. O PR #44 foi mergeado em 28/09/2026 (`ab74e3c`). Os
arquivos locais não rastreados em `data/` foram preservados e não integram a
entrega.

## Épicos

| Épico | Capacidade | Resultado mínimo | Dependência principal |
|---|---|---|---|
| E01 | Project Configuration | Projeto versionado produz `ProjectSnapshot` válido. | V06 |
| E02 | Research & Reference Analysis | Temas e padrões estratégicos rastreáveis alimentam ideias. | E01 + radar atual |
| FND | Execution Economics Foundation | Run, linhagem e custo são rastreáveis desde o primeiro conteúdo. | PC05 + E02 |
| E03 | Content Intelligence | Ideias originais recebem score explicável e seleção humana. | E02 + FND01 |
| E04 | Script & Metadata | Ideia aprovada vira roteiro e metadados versionados. | E03 |
| E05 | Voice Generation | Roteiro vira faixa de voz com direitos e hash. | E04 |
| E06 | Media Pipeline | Necessidades visuais recebem ativos autorizados ou gerados. | E04 |
| E07 | Video Composer & Subtitles | Voz e mídia formam preview vertical legendado. | E05 + E06 |
| E08 | Quality Control & Approval | Versão validada recebe aprovação humana sobre hash exato. | E07 |
| E09 | Social Publishing | Um adapter oficial publica sem duplicação e com fallback. | E08 + gate da rede |
| E10 | Scheduler & Daily Automation | Jobs persistidos executam agenda configurável com retry. | E09 |
| E11 | Offer & Campaign | Ofertas e campanhas comerciais relacionam operação, conteúdo e destino. | E09 |
| E12 | Attribution & Traffic | Identificadores e eventos explicam a origem de impressões, views e cliques. | E11 + E09 |
| E13 | Conversion | Leads e vendas preservam a evidência de atribuição disponível. | E12 |
| E14 | Revenue Ledger | Receita comercial possui histórico auditável separado dos custos. | E13 + FND03 |
| E15 | Commercial Analytics | Receita, comissão, custo, lucro, margem, ROAS e RPM são comparáveis. | E14 + volume mínimo |
| E16 | Portfolio Experiments | Hipóteses recebem avaliação `KILL`, `CONTINUE` ou `SCALE`. | E15 + política aprovada |
| E17 | Optimization Engine | Regras explicáveis recomendam melhorias com base no histórico. | E15 + volume mínimo |
| E18 | Portfolio Allocation | Capacidade recebe recomendação explicável de distribuição. | E16 + E17 |

Ordem dos produtos: MVP 1 Content Machine; MVP 2 Publishing; após Publishing,
MVP 3 Daily Automation e MVP 4 Offer & Campaign seguem como frentes paralelas;
MVP 5 Attribution & Traffic; MVP 6 Conversion & Revenue Ledger; MVP 7 Commercial
Analytics & Experiments; MVP 8 Optimization & Portfolio Allocation. O MVP 4
depende de E09, não da conclusão do MVP 3. O MVP 1 termina em E08 com preview
aprovado e inclui as fundações FND conforme forem consumidas. Modelos próprios,
infraestrutura de IA e Platform Revenue permanecem futuros.

## Camada comercial futura — E11 a E15

Esta decomposição registra responsabilidades e dependências, sem aprovar
contratos técnicos ou implementação antecipada:

### E11-O01 — Offer Domain

- representar oferta afiliada, ADR, automação, agente, ferramenta ou produto
  digital próprio;
- manter identidade explícita, tipo, plataforma, destino, nicho, moeda, condições
  comerciais e status, sem credenciais;
- preservar versionamento e histórico quando mudanças afetarem atribuição.

### E11-C01 — Campaign Domain

- relacionar obrigatoriamente pelo menos `Project/Channel`, `Offer`,
  `Content/Artifact` e CTA comercial;
- representar o conjunto comercial testado, não um agrupador genérico;
- depender de oferta e conteúdo/publicação identificáveis;
- admitir estratégia ou configuração de tracking opcional e futura, sem exigir
  `Attribution` efetiva, que será criada somente em E12.

### E12-A01 — CTA e Attribution

- modelar objetivo comercial, destino e identificadores como UTM, affiliate ID,
  campaign ID ou tracking ID quando suportados;
- manter o CTA comercial externo ao contrato editorial `script/1.0.0`;
- criar a `Attribution` efetiva a partir da campanha e da evidência de tracking
  disponível, sem retroagir como dependência de E11;
- versionar regras de atribuição e tornar limitações de cobertura explícitas.

### E12-T01 — Traffic Tracking

- registrar origem, impressões, views e cliques por campanha quando disponíveis;
- consumir APIs e webhooks oficiais, com importação manual como fallback;
- preservar ausência de métrica como ausência, nunca como zero inventado.

### E13-C01 — Conversion

- registrar leads e vendas com identidade, instante, origem e evidência de
  atribuição disponíveis;
- suportar reconciliação e idempotência sem duplicar conversões;
- não inferir causalidade quando a plataforma não fornecer evidência suficiente.

### E14-R01 — Revenue Ledger

- registrar receita e comissão comerciais em componente separado do `CostLedger`;
- preferir histórico append-only e auditável, com moeda, origem, instante e
  vínculo à conversão conhecidos;
- definir o contrato técnico somente neste tópico futuro, sem reutilizar eventos
  de custo como eventos de receita.

### E15-A01 — Commercial Analytics

- calcular receita por vídeo, oferta, campanha, canal e nicho somente após existir
  a cadeia de evidência anterior;
- combinar receita e custo apenas em visões para lucro, margem, ROAS e RPM;
- evidenciar cobertura parcial, janela, moeda e regra de atribuição.

## Fundação prioritária — FND Execution Economics

A cadeia `ProjectSnapshot → PipelineRun → Artifact lineage → CostLedger` será
entregue em tópicos independentes antes de automação agressiva:

### FND01 — persistência de PipelineRun

- persistir a identidade técnica da execução e o `ProjectSnapshot` exato;
- registrar estado, início, término e erro sanitizado sem criar artefatos;
- preservar idempotência e histórico imutável;
- não implementar IA, geração, custos, receita ou portfólio.

Aceite: iniciar ou retomar a mesma run não duplica registro; nova versão do
projeto não altera a run existente; transições e conflitos possuem códigos
estáveis e testes.

Implementação FND01: `pipeline-run/1.0.0` define somente `RUNNING`, `SUCCEEDED`
e `FAILED`, com transições determinísticas de `RUNNING` para um estado terminal.
A migração 008 persiste identidade, `ProjectSnapshot` completo e histórico de
transições, protegido contra atualização ou remoção retroativa. O serviço
reutiliza o handoff PC05, exige projeto e versão explícitos e usa
`pipelineRunId` como identidade idempotente; retry compatível recupera a run e
conteúdo divergente falha antes de qualquer escrita. Nova versão ou arquivamento
do projeto não altera o snapshot armazenado. Erros persistidos contêm somente
`code` e `field` públicos sanitizados.

Evidência: 11 testes focados e a suíte completa de 180 testes passaram em
28/09/2026, junto de `git diff --check`. Os testes cobrem criação, recuperação,
retry, conflito de identidade, compatibilidade com `ResearchInput`, snapshot
imutável, transições, rollback, migração aditiva, erro sanitizado, proteções do
banco e ausência de efeitos de Research. Riscos residuais deliberados: o SQLite
mantém sua concorrência de escritor único e runs terminais não são reabertas;
artefatos, linhagem e custos permanecem para FND02 e FND03.
O PR #37 foi aberto em 28/09/2026.

### FND02 — linhagem comum de artefatos

- ligar artefatos versionados a run, projeto, conteúdo, entradas e hashes;
- prever provider, modelo, versão de prompt e configuração sanitizada quando IA
  for usada;
- não armazenar segredo, prompt privado ou mídia no Git.

Implementação FND02: `artifact-lineage/1.0.0` registra identidade, tipo, versão,
`PipelineRun`, projeto e versão exatos, identidade lógica opcional, instante e
hash SHA-256 explícito. Entradas externas são preservadas por ID e hash; entradas
internas exigem artefato anterior no mesmo escopo da run, projeto e versão, com
hash correspondente e posição determinística. Retry idêntico recupera o registro
existente, enquanto reutilização incompatível do ID ou da identidade lógica falha
antes de qualquer escrita.

A migração 009 é aditiva e cria o registro comum e suas entradas ordenadas, com
chaves estrangeiras, índices e triggers que impedem atualização ou remoção. O
repositório transacional revalida o contrato e o hash de identidade na leitura.
Metadados opcionais de geração exigem provider, modelo, tarefa, versão de prompt
e hash de configuração como conjunto; a configuração pública é normalizada e
rejeita chaves ou valores potencialmente sensíveis. Nenhum prompt, mídia ou
payload de conteúdo é persistido. Os artefatos atuais de Research permanecem
inalterados e podem alimentar novos registros como entradas externas por seus IDs
e hashes, sem migração retroativa nem mudança funcional no fluxo.

Evidência: 14 testes focados e a suíte completa de 194 testes passaram em
28/09/2026, junto de `git diff --check`. A cobertura inclui contrato, criação,
recuperação, listagem determinística, retry, conflitos, escopo da `PipelineRun`,
referências internas, hashes, metadados de IA, sanitização, rollback, leitura
revalidada, imutabilidade, migração 008→009 e ausência de efeitos em Research.
Riscos residuais deliberados: SQLite mantém escritor único; a configuração
pública usa uma política conservadora de sanitização e continua exigindo que o
chamador envie somente valores públicos; artefatos legados de Research não são
registrados retroativamente. Custos permanecem para FND03.
O PR #38 foi aberto em 28/09/2026.

### FND03 — eventos de custo e CostLedger

- registrar eventos append-only por run, conteúdo e projeto;
- distinguir custos de IA, mídia, voz, produção e publicação;
- manter moeda, instante, origem e regra de atribuição explícitos;
- não criar receita, ROI, orçamento ou decisão automática.

Revenue Ledger, Commercial Analytics e regras de experimento permanecem nos
épicos E14, E15 e E16. Esta fundação não antecipa receita, limiares financeiros
nem entidades de Platform Revenue.

Implementação FND03: `cost-event/1.0.0` registra identidade, categoria,
`PipelineRun`, projeto e versão exatos, conteúdo e artefato opcionais, valor
decimal exato, moeda, ocorrência, origem, regra de atribuição versionada e
instante de registro. Retry idêntico recupera o evento; reutilização incompatível
do ID falha antes da escrita. O vínculo opcional ao artefato exige linhagem
persistida no mesmo escopo e identidade de conteúdo coerente quando informada.

`cost-ledger/1.0.0` deriva exclusivamente os eventos da run, ordenados por
ocorrência e ID, e soma decimais exatamente em totais separados por moeda. Uma
run sem eventos mantém totais ausentes, sem inventar custo zero. A migração 010
é aditiva, aplica chaves estrangeiras, índices e triggers de imutabilidade; os
repositórios de projeto e catálogo compartilham a mesma cadeia de migrações.
Nenhuma conversão cambial, receita, ROI, orçamento, telemetria de IA ou efeito
externo foi introduzido.

Evidência: 12 testes focados da FND03 e a suíte completa de 206 testes passaram
em 28/09/2026. A cobertura inclui contrato, categorias, precisão decimal,
criação, recuperação, ordem determinística, retry, conflitos, escopo da run,
vínculo e conteúdo do artefato, moedas separadas, ausência de custo,
imutabilidade, rollback, erro sanitizado, leitura revalidada e migração
009→010. Riscos residuais deliberados: SQLite mantém escritor único; correções
financeiras, câmbio e validação contra uma tabela externa de códigos monetários
permanecem fora deste corte. O PR #39 foi mergeado em 28/09/2026 (`439bb44`).

### FND04 — Stage Recovery Foundation

Objetivo: tornar cada etapa recuperável de forma seletiva, persistida e
idempotente antes da introdução de Trend Format Analysis, Visual Motion Plan e
Background Music.

O contrato `stage-recovery/1.0.0` fecha os estados `PENDING`, `RUNNING`,
`SUCCEEDED` e `FAILED`; distingue tentativas `INITIAL`, `AUTOMATIC` e `MANUAL`;
e exige `pipelineRunId`, IDs e hashes dos inputs, versões de política, hash da
configuração pública relevante e `requestHash` explícitos. Não existe consulta
implícita a `latest`.

A migration 026 é aditiva e preserva as runs e artefatos anteriores. Tentativas
são numeradas e mantêm etapa, origem, início, término, resultado terminal,
código/campo sanitizados, permissão de retry e artefato produzido. Tentativas
terminais não podem ser atualizadas ou removidas. Uma `PipelineRun` falha pode
voltar a `RUNNING` por uma recuperação auditável sem apagar suas transições.

O grafo de dependências cobre:

```text
Research → Trend Format Analysis → Idea Generation → Idea Selection → Script
Script → Voice ────────────────────────────────────────────────┐
Script → Media → Visual Motion Plan ───────────────────────────┤
Script → Background Music ─────────────────────────────────────┤
Voice + Media + Visual Motion Plan + Background Music → Composition
Script + Voice → Subtitles
Composition + Subtitles → Preview → QC
```

Quando um novo resultado upstream possui outro hash, apenas tentativas
descendentes que referenciam o ID/hash anterior passam a ser projetadas como
`PENDING`; o histórico anterior permanece íntegro. Resultado terminal da mesma
identidade é reutilizado. Retry automático aceita somente falhas transitórias,
usa no máximo três tentativas e backoff exponencial determinístico. Retry manual
é uma operação separada e exige a identidade exata da tentativa `FAILED`.

A integração inicial registra Research, Idea Generation, Script, Voice, Media,
Composition, Subtitles, Preview e QC. Idea Selection continua sendo decisão
humana append-only e já possui etapa e dependência declaradas para o futuro
controle operacional. Trend Format Analysis, Visual Motion Plan e Background
Music permanecem sem implementação, mas deverão nascer sobre FND04.

Fora do tópico: endpoint ou botão de retry, alteração da Operator UI, novos
providers, publicação e implementação dos novos módulos de produção.

Ordem planejada após o merge de FND04, sempre um tópico por branch:

1. Trend Format Analysis — contrato/persistência e analyzer;
2. Visual Motion Plan;
3. FFmpeg Motion;
4. Background Music;
5. Audio Mixer;
6. Operator retry controls sobre FND04;
7. End-to-End recovery e QC das novas etapas.

Evidência FND04: 525 de 531 testes passaram em 30/09/2026; 6 integrações
físicas/externas opt-in foram ignoradas. A cobertura inclui contrato fechado,
migration 026, upgrade parcial, retry seletivo, cache terminal, tentativa manual
separada, retry automático transitório com limite e backoff, erro permanente,
histórico imutável, sanitização, invalidação downstream por hash, reabertura de
`PipelineRun`, reconciliação de tentativa interrompida após restart e integração
das etapas existentes.
`git diff --check` passou. Riscos residuais: SQLite mantém escritor único; uma
queda enquanto a tentativa está `RUNNING` exige que o chamador invoque a
recuperação explícita antes do retry manual; a exposição desse comando pertence
aos futuros controles. As três novas etapas e a UI permanecem fora deste tópico.

## Habilitação incremental de IA

Estes tópicos entregam capacidades pequenas quando houver consumidor real; não
formam um grande épico antecipado e não alteram a prioridade atual de `FND03`.

### AI01 — OpenAI Adapter

- implementar a primeira porta de geração consumida pelo pipeline e um
  `OpenAIAdapter` sem expor SDK ou nomes de modelo ao domínio;
- usar configuração sanitizada e o perfil default para a primeira tarefa simples;
- não implementar múltiplos providers, escalonamento ou experimento.

Aceite: uma capacidade real do pipeline produz artefato rastreável por adapter,
com contrato testado e sem dependência de OpenAI no domínio.

Implementação AI01: o serviço recebe uma `IdeaSelection` por ID explícito,
recupera a seleção, ideia, `PipelineRun` e `ProjectSnapshot` exatos e chama uma
única vez a porta `ScriptGenerator`. A saída externa é revalidada e traduzida
deterministicamente para `script/1.0.0`; nenhuma referência textual é enviada ao
provider e nenhuma consulta usa `latest`.

O `OpenAIAdapter` usa Responses com saída estruturada, política pública
`script-generation-prompt/1.2.0`, timeout e cancelamento. A faixa enviada ao
modelo é um alvo conservador derivado sem mutação dos limites físicos: `25–45s`
vira `28–36s`, com fallback determinístico para a faixa física quando as margens
não couberem. O serviço e o Voice continuam validando o intervalo físico original.
Credencial e modelo
vêm do ambiente; somente provider, modelo, tarefa, versão da política, hash e
configuração pública sanitizada entram na linhagem. Prompt, mensagens, payload
e resposta brutos não são persistidos ou registrados.

A migração 014 registra identidade e hash da solicitação ligados ao roteiro. O
retry concluído retorna o artefato persistido sem nova chamada; identidade com
conteúdo divergente falha, e roteiro, identidade e linhagem são confirmados na
mesma transação. AI01 não cria eventos de custo, tokens, latência, fallback,
router ou telemetria; esses itens permanecem em AI02/AI03.

Evidência: 15 testes novos cobrem contrato, isolamento arquitetural, seleção
explícita, escopo e hashes, saída não confiável, conteúdo sensível, configuração
e erros sanitizados, timeout, cancelamento, retry, conflito e rollback. A suíte
completa registra 258 testes aprovados e um smoke real ignorado por padrão. O
smoke só executa com `OPENAI_SMOKE_TEST=1`. Riscos residuais: SQLite mantém
escritor único; qualidade, originalidade substantiva e afirmações sensíveis
continuam sujeitas a revisão humana; disponibilidade, limites e cobrança do
provider só são observáveis quando o smoke for explicitamente habilitado.
O PR #43 foi aberto em 28/09/2026.

### AI02 — Model Routing Policy

- introduzir `AIModelRouter` e política versionada por tarefa;
- mapear perfis default, complex e exceptional para configuração de infraestrutura;
- manter decisão determinística, explicável e testável.

Aceite: tarefas simples não acionam automaticamente modelos complexos; toda
seleção retorna política, perfil e justificativa rastreáveis. Este tópico entra
somente quando existir a primeira tarefa complexa consumidora.

### AI03 — Cost and Usage Telemetry

- correlacionar chamada, artefato, `PipelineRun` e evento do `CostLedger`;
- registrar tokens, cache, custo, latência, sucesso e fallback conhecidos;
- preservar hashes opcionais sem armazenar segredo ou prompt privado.

Aceite: uma chamada pode ser atribuída e comparada sem antecipar receita, ROI,
A/B testing ou decisão automática. Depende de AI01, FND02 e FND03.

Implementação AI03: `ai-call-telemetry/1.0.0` registra uma identidade lógica
explícita ligada à solicitação, `PipelineRun`, projeto e versão, provider, modelo,
tarefa e prompt versionado. Uso, custo, moeda, latência, fallback e hashes são
campos conhecidos ou `null`; ausência nunca é convertida em zero. A migração 015
mantém os registros imutáveis e correlaciona opcionalmente o roteiro produzido e
um único evento `ai_cost` do `CostLedger`.

O `OpenAIAdapter` mede instante, latência e hashes SHA-256 e extrai somente os
tokens informados pela Responses API, inclusive cache quando presente. Uso
reportado e custo monetário são conceitos distintos: tokens não implicam preço.
Como a resposta não fornece preço monetário, custo, moeda e origem de preço
permanecem ausentes. O serviço aceita custo positivo somente com moeda e origem
explícitas; nesse caso cria o evento de custo com identidade determinística.
Sucesso persiste roteiro, linhagem, telemetria e custo na mesma transação. Falha
observada persiste somente código sanitizado, sem mensagem bruta, prompt,
request/response ou stack. Se a tentativa falha com custo conhecido, o evento
fica ligado à chamada e mantém `artifactId` ausente, sem criar artefato falso.
Retry da mesma identidade terminal recupera sucesso ou falha sem nova chamada
nem duplicação.

Evidência: os testes focados de contrato, adapter, aplicação, persistência e
migração passaram, assim como a suíte completa de 267 testes; o smoke real
opt-in permaneceu ignorado. A cobertura inclui uso parcial, pricing ausente,
custo conhecido, correlação, sucesso, falha, retry, conflito, imutabilidade e
rollback conjunto. Riscos residuais: a disponibilidade dos contadores depende do
provider; sem pricing versionado não há custo calculado; SQLite mantém escritor
único; não existe atomicidade distribuída entre a cobrança externa e uma falha
local anterior ao commit.
O PR #45 foi mergeado em 28/09/2026 (`9e8d359`). Os arquivos locais não rastreados em `data/`
e `templates/` foram preservados e não integram a entrega.

### E05-V01 — VoiceTrack Contract and Persistence

O contrato `voice-track/1.0.0` registra identidade e revisão, `PipelineRun`,
projeto e versão, roteiro e hash exatos, idioma e estilo de voz derivados do
`ProjectSnapshot`, duração em milissegundos, formato em allowlist, hash SHA-256
do áudio e referência opaca de storage. Origem, provider quando exigido e base
de direitos são explícitos; uso comercial precisa estar autorizado. Origens de
clonagem, imitação ou personificação não pertencem à allowlist, e direitos
ausentes, desconhecidos ou incompatíveis impedem o registro.

A migração 016 preserva faixas e correções append-only. A faixa e sua linhagem
`artifact-lineage/1.0.0` são gravadas na mesma transação, com o roteiro como
entrada interna e, nas correções, a faixa anterior como segunda entrada. Retry
idêntico não duplica registros; reutilização divergente de ID ou revisão falha
antes da escrita; nenhuma consulta implícita a `latest` foi adicionada. Bytes de
áudio, URL assinada, caminho privado, token e credencial não entram no contrato,
banco, fixtures ou Git.

Evidência: 12 testes focados cobrem contrato, isolamento de provider, direitos,
storage, escopo, hash do roteiro, idempotência, conflito, revisão, imutabilidade,
linhagem, rollback e migração. A suíte completa registra 279 testes aprovados e
um smoke real ignorado por padrão; `git diff --check` também passou. Riscos
residuais: validação semântica do áudio dependerá do adapter e do Quality
Control; retenção do objeto externo permanece futura; custos só serão registrados
quando houver chamada real; SQLite mantém escritor único.
O PR #46 foi mergeado em 28/09/2026 (`17338dd`). Os arquivos locais não rastreados em `data/`
e `templates/` foram preservados e não integram a entrega.

### E05-V02 — VoiceProvider Port and Generation Orchestration

O contrato `voice-generation-request/1.0.0` exige identidade lógica, `scriptId`,
hash exato do roteiro, instante e hash reproduzível. O serviço valida a entrada
antes de qualquer leitura, recupera somente o `Script` indicado, revalida seu
hash e deriva narração, idioma, estilo e limites exclusivamente do roteiro e do
`ProjectSnapshot` imutáveis. A porta `VoiceProvider` recebe apenas esses dados
públicos e a identidade de correlação, sem configuração privada ou tipo de SDK.

A resposta do provider é tratada como não confiável: duração medida, formato,
hash do conteúdo, referência opaca, provider, origem sintética e direitos
comerciais explícitos são integralmente revalidados. `VoiceTrack` preserva a
identidade e os metadados do ativo, nunca bytes de áudio. URLs, caminhos locais,
base64, tokens, credenciais, direitos ausentes ou incompatíveis e qualquer origem
de clonagem, imitação ou personificação são recusados. A duração real vem da
evidência do provider e deve respeitar os limites do snapshot; ela não é inferida
do tamanho ou da duração estimada do roteiro.

A migração 017 liga a identidade da solicitação à faixa concluída. Solicitação,
`VoiceTrack` e linhagem são persistidos na mesma transação; falha de contrato ou
escrita não deixa identidade, faixa ou linhagem parcial. Retry local concluído
retorna a faixa persistida sem nova chamada, enquanto identidade divergente falha
antes do provider. Isso não declara garantia distribuída de `exactly-once` para
um futuro provider externo, e nenhum evento de custo é criado sem custo real.

Evidência: 15 testes novos cobrem contrato, isolamento arquitetural, entrada
pública, saída não confiável, direitos, dados sensíveis, derivação, duração real,
chamada única, retry, conflito, sanitização, persistência, rollback e migração.
Os 27 testes focados de voz passaram; a suíte completa registrou 294 testes
aprovados e um smoke real ignorado por padrão; `git diff --check` também passou.
Riscos residuais: qualidade e semântica do áudio dependem do futuro adapter e do
Quality Control; disponibilidade, latência, cobrança e retenção dependem do
provider; uma falha local após futura chamada externa poderá exigir reconciliação;
SQLite mantém escritor único. O PR #47 foi mergeado em 28/09/2026 (`f66e5c`). Os arquivos
locais não rastreados em `data/` e `templates/` foram preservados e não integram
a entrega.

### E06-M01 — MediaAsset Contract and Persistence

O contrato `media-asset/1.0.0` registra identidade e revisão, `PipelineRun`,
projeto e versão, roteiro e hash exatos e a posição explícita de uma direção
visual persistida. O tipo lógico `IMAGE` ou `VIDEO` permanece separado das
propriedades técnicas aplicáveis: formato, dimensões reais e duração real somente
para vídeo. Nenhuma medida é derivada ou inventada pela aplicação.

O ativo preserva apenas hash SHA-256 e `mediaReference` lógica opaca, sem bytes,
base64, URL, caminho físico ou localização de storage. Origem e direitos são
obrigatórios e coerentes; uso comercial precisa ser `true` explicitamente.
`provider` é exigido somente para origens geradas ou licenciadas por provider e
é recusado nas origens próprias ou autorizadas diretamente. Referência social
ou evidência de Research não pertence à allowlist de origens autorizadas.

A migração 018 é aditiva e append-only. Ativo e linhagem
`artifact-lineage/1.0.0` são gravados na mesma transação, com o roteiro exato
como entrada e a revisão anterior como segunda entrada nas correções. Run,
projeto, versão, hash do roteiro e direção visual são revalidados antes da
escrita. Retry idêntico não duplica registros; reutilização divergente de ID ou
revisão falha sem alterar o histórico. Consultas exigem identidades explícitas e
as listagens possuem ordem determinística, sem seleção por `latest`.

Evidência: 14 testes focados cobrem contrato, separação lógica/técnica, direitos,
provider condicional, dados sensíveis, referência opaca, escopo, hash, direção
visual, retry, conflito, revisão, imutabilidade, linhagem, rollback, migração e
isolamento arquitetural. A suíte completa registrou 308 testes aprovados e um
smoke real ignorado por padrão; `git diff --check` também passou. Riscos
residuais: qualidade visual dependerá de adapters e Quality Control futuros;
disponibilidade, latência, cobrança e limites dependerão do provider; retenção e
ciclo de vida do objeto externo permanecem para tópico próprio; não existe
atomicidade distribuída com um futuro provider; SQLite mantém escritor único.
Os arquivos locais não rastreados em `data/` e `templates/` foram preservados e
não integram a entrega. O PR #48 foi mergeado em 28/09/2026 (`2689359`).

### E06-M02 — MediaProvider Port and Acquisition Orchestration

O contrato `media-acquisition-request/1.0.0` exige identidade lógica, roteiro e
hash exatos, posição explícita da direção visual, tipo lógico desejado, instante
e hash reproduzível. O request expressa requisitos, sem formato, dimensões,
duração ou outras propriedades reais inferidas. O serviço valida a solicitação
antes de qualquer leitura, recupera somente o `Script` indicado e revalida hash,
direção, `PipelineRun`, projeto, versão e `ProjectSnapshot` persistidos.

A porta `MediaProvider` recebe somente identidade pública de correlação, tipo
lógico desejado, direção visual explícita e contexto público derivado do
snapshot. Credenciais, configuração privada, referências de Research, mídia de
referência, caminhos, localização de storage e tipos de SDK permanecem fora da
entrada. Não existe adapter nem chamada externa real neste tópico.

Toda saída do provider é tratada como não confiável. Tipo lógico, formato,
dimensões reais, duração real quando aplicável, hash SHA-256, referência lógica
opaca, origem, identidade pública do provider e direitos são revalidados antes
de formar e revalidar o `MediaAsset`. Bytes, base64, URLs, caminhos, storage
físico, segredos e payload bruto são recusados. Direito comercial precisa ser
explicitamente verdadeiro e compatível com a origem; ausência de evidência não
concede permissão implícita. `provider` é obrigatório apenas para origens que
dependem dele.

A migração 019 persiste a identidade concluída e seu vínculo imutável com o
ativo. Solicitação, `MediaAsset` e linhagem são gravados na mesma transação;
falhas revertem os três. Retry terminal recupera o ativo persistido sem chamar
novamente a porta, enquanto identidade divergente falha antes do provider. A
garantia é local: uma futura chamada externa não terá atomicidade distribuída
nem promessa de `exactly-once`. Nenhum evento de custo é criado sem custo real.

Evidência: 15 testes novos cobrem contrato, hash, isolamento arquitetural,
entrada pública, requisitos desejados, saída não confiável, propriedades reais,
direitos, dados sensíveis, derivação, chamada única, retry, conflito,
sanitização, persistência, rollback e migração. A suíte completa registrou 323
testes aprovados e um smoke real ignorado por padrão; `git diff --check` também
passou. Riscos residuais: qualidade visual dependerá do futuro adapter e do
Quality Control; disponibilidade, latência, cobrança, limites e retenção
dependerão do provider; uma falha local após futura chamada externa poderá
exigir reconciliação; SQLite mantém escritor único. Os arquivos locais não
rastreados em `data/` e `templates/` foram preservados e não integram a entrega.
O PR #49 foi mergeado em 28/09/2026 (`d427594`).

### E07-C01 — CompositionPlan Contract and Persistence

O contrato `composition-plan/1.0.0` registra identidade e revisão,
`PipelineRun`, projeto e versão, roteiro e hash exatos, `VoiceTrack` e hash
exatos, proporção de saída derivada do `ProjectSnapshot`, duração total e
segmentos ordenados. A unidade temporal canônica é `MILLISECOND`, com valores
inteiros, e `continuityMode: CONTIGUOUS` torna explícito que esta versão não
admite intervalos intencionais: a timeline começa em zero, não possui lacunas
ou sobreposição e termina exatamente na duração real da faixa de voz.

Cada segmento preserva posição, direção visual, `MediaAsset` e hash exatos,
além dos instantes inicial e final. O plano cobre todas as direções do roteiro
em ordem e usa cada ativo uma única vez, eliminando duplicações ambíguas. Antes
da persistência, roteiro, voz, ativos, run, projeto, versão e snapshot são
recuperados por identidade explícita e revalidados. Direitos comerciais,
origem, escopo, hashes e propriedades técnicas dos ativos são conferidos no
momento da criação; vídeos precisam ter duração real suficiente para o trecho,
enquanto imagens apenas ocupam o intervalo declarado.

A migração 020 é aditiva e não cria planos retroativos. Plano, segmentos e
linhagem `artifact-lineage/1.0.0` são gravados na mesma transação. A linhagem
registra roteiro, voz e ativos na ordem dos segmentos. Retry idêntico não
duplica dados; reutilização divergente de ID ou revisão falha sem alterar o
histórico; correções criam nova revisão append-only. A leitura revalida
contrato, colunas, segmentos, relações e linhagem. Nenhuma consulta a `latest`,
renderização, byte, localização física, transformação ou dependência de
composer, FFmpeg, SDK ou fornecedor foi introduzida.

Evidência: 18 testes novos cobrem contrato, unidade temporal, continuidade,
ordem, cobertura visual, hashes, escopo, snapshot, direitos, duração real,
isolamento arquitetural, idempotência, conflito, revisão, imutabilidade,
linhagem, rollback e migração. A suíte completa registrou 341 testes aprovados
e um smoke real ignorado por padrão; `git diff --check` também passou. Riscos
residuais: enquadramento, transformação e sincronização semântica permanecem
para o composer; legendas e alinhamento por palavra continuam futuros; qualidade
visual dependerá de render e Quality Control; referências opacas dependem do
ciclo de vida do storage externo; SQLite mantém escritor único. Os arquivos
locais não rastreados em `data/` e `templates/` foram preservados e não integram
a entrega. O PR #50 foi mergeado em 28/09/2026 (`bc2f162`).

### E07-C02 — VideoRender Contract and Persistence

O contrato `video-render/1.0.0` registra identidade e revisão, `PipelineRun`,
projeto e versão, `CompositionPlan` e hash exatos, proporção de saída, duração
medida em milissegundos, container, dimensões reais, SHA-256 do conteúdo
renderizado e referência lógica opaca. Duração, dimensões e container precisam
ser fornecidos explicitamente: nenhum valor é inferido do plano ou escolhido por
default. As dimensões são comparadas à proporção declarada por multiplicação
cruzada inteira com `BigInt`, sem depender de ponto flutuante.

Antes da persistência, run, snapshot, plano, hash, escopo, proporção e duração
são recuperados por identidade explícita e revalidados. Como a leitura do plano
revalida toda a sua cadeia, a duração permanece vinculada à `VoiceTrack` exata.
O `contentHash` é o SHA-256 informado do conteúdo renderizado identificado pelo
artefato; ele não é derivado de JSON, metadados, referência ou localização. A
referência aceita somente identificador lógico sanitizado e rejeita URL,
caminho, esquema de storage e segmentos sensíveis.

A migração 021 é aditiva e não cria renders retroativos. Render e linhagem
`artifact-lineage/1.0.0`, cuja única entrada é o `CompositionPlan` exato, são
gravados na mesma transação. Retry idêntico não duplica dados; reutilização
divergente de ID ou revisão falha sem alterar o histórico; correções criam nova
revisão append-only. A leitura revalida contrato, identidade, colunas, escopo,
plano e linhagem. Nenhuma consulta a `latest`, byte, renderização, localização
física ou dependência de composer, FFmpeg, SDK, fornecedor ou storage foi
introduzida.

Evidência: 17 testes novos cobrem contrato, propriedades medidas, proporção
inteira, SHA-256 do conteúdo, referência opaca, segurança, isolamento
arquitetural, escopo, duração, idempotência, conflitos, revisão, imutabilidade,
linhagem, rollback, leitura e migração. A suíte completa registrou 358 testes
aprovados e um smoke real ignorado por padrão. Riscos residuais: produção real
do arquivo permanece para o futuro `VideoComposer`; codec, bitrate, frame rate
e compatibilidade de plataforma exigirão política posterior; legendas e
Quality Control continuam futuros; referências opacas dependem do ciclo de
vida do storage externo; SQLite mantém escritor único. Os arquivos locais não
rastreados em `data/` e `templates/` foram preservados e não integram a entrega.

O PR #51 foi mergeado em 28/09/2026 (`3d5a5a0`).

### E07-C03 — VideoComposer Port and Render Orchestration

O contrato `video-composition-request/1.0.0` registra identidade, o
`CompositionPlan` e hash exatos, container e dimensões desejados, instante e
hash reproduzível. A proporção é validada contra o plano por multiplicação
cruzada inteira. Nenhuma resolução, codec ou outra propriedade técnica é
inferida.

A porta `VideoComposer` recebe somente `logicalCallId`, o plano persistido
integralmente revalidado e os requisitos técnicos explícitos. Não há seleção
por `latest` nem reconstrução parcial. A saída é não confiável e seu contrato
fechado revalida duração medida, container, dimensões, SHA-256 do conteúdo e
referência lógica opaca antes de criar o `VideoRender` determinístico.

A migração 022 é aditiva e não cria solicitações ou renders retroativos.
Solicitação concluída, `VideoRender` e linhagem são persistidos na mesma
transação. Retry terminal retorna o render persistido sem nova chamada;
reutilização divergente e conflito conhecido falham antes do composer.
Cancelamento anterior à chamada e saída inválida não deixam estado parcial. Uma
falha local após futura chamada externa bem-sucedida ainda poderá exigir
reconciliação: não há garantia distribuída de `exactly-once`.

Evidência: 15 testes novos cobrem contrato, hash, segurança, isolamento
arquitetural, plano exato, entrada imutável, propriedades explícitas, saída não
confiável, duração e proporção medidas, chamada única, retry, conflito,
cancelamento, rollback, leitura e migração. A suíte completa registrou 373
testes aprovados e um smoke real ignorado por padrão; `git diff --check` também
passou. O PR #52 foi mergeado em 29/09/2026 (`a3fcf32`).
Riscos residuais: adapter e produção efetiva do arquivo permanecem futuros;
codec, bitrate, frame rate e compatibilidade dependerão da política do adapter;
legendas e alinhamento por palavra continuam futuros; qualidade dependerá do
render real e do Quality Control; referências opacas dependem do ciclo de vida
do storage externo; SQLite mantém escritor único. Os arquivos locais não
rastreados em `data/` e `templates/` foram preservados e não integram a entrega.

## Critical Path — Fechamento do MVP 1

Após E07-C03, a prioridade absoluta é produzir um preview real ponta a ponta.
Novos tópicos puramente estruturais ou de fundação não serão priorizados, salvo
quando desbloquearem diretamente uma capacidade do fluxo real do MVP. Uma nova
abstração, persistência ou porta precisa ter consumidor imediato neste Critical
Path; as decisões já implementadas continuam válidas e não serão reconstruídas.

O caminho planejado possui **7 entregas até o preview real e 11 até o MVP 1
DONE**:

```text
E07-C03 concluído
→ E05-V03 Real Voice
→ E06-M03 Real Media
→ E07-C04 Real Composer
→ E07-S01A Subtitle Contract
→ E07-S01B Deterministic Cues
→ E07-S01C Physical Rendering
→ E07-P01 End-to-End Preview        (7 entregas)
→ E07-P02 Local Preview Runner
→ E08-Q01 Quality Control
→ E08-U01 Operator Preview Console
→ E08-A01 Human Approval
→ MVP 1 DONE                        (11 entregas)
```

No fechamento funcional, E07-P01 prova tecnicamente o pipeline; E07-P02 o torna
executável pelo operador; E08-Q01 valida automaticamente a saída; E08-U01 torna
o MVP utilizável visualmente; e E08-A01 fecha o ciclo humano:

```text
E07-P01 — End-to-End Real Preview
↓
E07-P02 — Local Preview Runner
↓
E08-Q01 — Quality Control
↓
E08-U01 — Operator Preview Console
↓
E08-A01 — Human Approval
↓
MVP 1 DONE
```

Este replanejamento preserva Ports and Adapters, contratos versionados, TDD,
persistência append-only, identidades explícitas, hashes, artifact lineage,
`PipelineRun`, `CostLedger`, idempotência, ausência de consultas implícitas a
`latest`, transações e rollback, erros sanitizados, validação de outputs externos
como não confiáveis, credenciais fora do domínio, referências lógicas/opacas,
direitos comerciais explícitos, separação entre provider e domínio, histórico
imutável, ausência de custo fictício e aprovação humana antes de efeitos externos.

### MVP Critical Path Rule

Enquanto G3 não estiver concluído:

- P0: voz real, mídia real, render real, legendas, preview, QC e aprovação;
- P1: correções arquiteturais ou de segurança necessárias para uma entrega P0;
- adiar, salvo bloqueio concreto: AI02, múltiplos providers, roteamento
  inteligente, modelos próprios, GPU, dashboards, analytics sofisticado,
  optimization engine, portfolio allocation, SaaS, scheduler, publicação,
  Revenue, ROAS e experimentação comercial.

Esses tópicos não estão cancelados; permanecem depois do gate correto. E09
continua sendo o início de Publishing. Após E09, E10 Daily Automation e E11
Offer & Campaign podem evoluir em paralelo; E11 depende de E09, não de E10.
Nenhuma alteração em E11–E18 é antecipada por este replanejamento.

### Princípio de excelência executável

O projeto busca excelência por contratos claros, testes, segurança,
observabilidade, direitos, reprodutibilidade e capacidade real de execução.
Excelência não significa implementar antecipadamente toda complexidade possível.
Antes de ampliar a arquitetura, responder:

```text
Esta implementação é necessária para produzir,
validar ou operar o próximo artefato real do MVP?
```

Se não for, documentar, adiar e não implementar agora. Não criar tópico separado
apenas para contrato, migration, repository ou interface que componha uma única
capacidade pequena e coesa. Dividir somente quando riscos, rollback, efeito
externo, revisão segura, testes ou dependências exigirem fronteira independente.

### E05-V03 — Real Voice Adapter

Objetivo: transformar o `VoiceProvider` existente em geração de áudio físico
real a partir do `Script`, com um único provider TTS inicial.

Aceite mínimo:

- provider atrás da porta existente, sem SDK no domínio ou aplicação;
- credenciais somente em infraestrutura/runtime, com timeout e cancelamento;
- output externo tratado como não confiável, com formato e duração reais medidos;
- SHA-256 calculado sobre o áudio físico e referência de storage lógica/opaca;
- origem, provider e direitos comerciais explicitamente válidos;
- clonagem, imitação e personificação recusadas;
- custo registrado somente quando observado/conhecido e ligado à telemetria
  existente quando aplicável;
- suíte padrão determinística e sem internet, com smoke externo opt-in.

Fora de escopo: múltiplos TTS, AI02, fallback sofisticado, clonagem de voz e
otimização avançada.

### E06-M03 — Real Media Adapter

Objetivo: produzir ou adquirir ao menos um `MediaAsset` físico real consumível
pelo pipeline, usando somente uma estratégia inicial — geração de imagem,
geração de vídeo ou biblioteca oficial/licenciada.

Aceite mínimo:

- `MediaProvider` existente permanece a porta e recebe somente dados permitidos;
- output externo é revalidado quanto a tipo, formato, dimensões e duração real
  quando aplicável;
- SHA-256 é calculado sobre o conteúdo físico e a referência permanece
  lógica/opaca, com bytes fora do domínio;
- origem, provider quando aplicável e direitos comerciais são explícitos; direito
  ausente ou presumido bloqueia o ativo;
- credenciais ficam fora dos contratos e custo existe somente quando conhecido;
- suíte padrão usa fake determinístico; smoke externo é opt-in.

Fora de escopo: vários fornecedores, scraping, download de referências
estratégicas, reutilização indevida de terceiros e seleção automática complexa.

### E07-C04 — Real VideoComposer / FFmpeg Adapter

Objetivo: converter `CompositionPlan`, `VoiceTrack` e `MediaAsset` físicos em um
MP4 vertical real por adapter FFmpeg atrás da porta `VideoComposer`.

Aceite mínimo:

- FFmpeg existe somente na infraestrutura e recebe argumentos construídos por
  allowlist, nunca shell ou argumentos arbitrários derivados de input externo;
- resolução inicial 9:16 e container inicial são explícitos e versionados;
- timeline segue o `CompositionPlan` e termina na duração real da voz;
- comportamento determinístico produz arquivo real com duração, dimensões,
  container, SHA-256 e referência opaca medidos;
- paths são validados contra traversal e temporários recebem cleanup seguro;
- falha ou cancelamento não produz `VideoRender` falso nem estado parcial;
- integration test local prova o composer sem depender de provider externo.

Codec avançado, múltiplos formatos, transições sofisticadas e otimização de
bitrate permanecem fora de escopo.

### E07-S01A — SubtitleTrack Contract and Persistence

Objetivo: persistir `SubtitleTrack` versionada e append-only, ligada ao
`PipelineRun`, `ProjectSnapshot`, `Script` e `VoiceTrack` exatos, sem gerar
timings ou arquivos físicos.

Aceite mínimo:

- `subtitle-track/1.0.0` fecha campos, normaliza Unicode e usa SHA-256 canônico;
- cues têm posições e intervalos explícitos em milissegundos, começam em zero,
  não se sobrepõem e nunca excedem a duração física registrada da voz;
- lacunas entre cues são permitidas por design e o último cue não precisa
  terminar na duração da `VoiceTrack`;
- idioma, duração, IDs, hashes, run, projeto e versão são revalidados contra
  `Script`, `VoiceTrack` e `ProjectSnapshot` persistidos;
- revisão, supersessão, retry idempotente, rollback local e lineage ordenada são
  atômicos; não existe consulta por `latest`;
- serviço permanece fachada mínima de validação e persistência, sem geração de
  cues, timings, SRT/ASS ou lógica editorial.

Evidência: 17 testes focados cobrem contrato, hash, Unicode, gaps intencionais,
intervalos, cadeia exata, persistência, retry, revisão, lineage, rollback,
migration aditiva e isolamento arquitetural. A suíte completa aprovou 423 testes
e ignorou 4 integrações/smokes opt-in; `git diff --check` passou.

Riscos residuais: a detecção de conteúdo sensível usa padrões determinísticos e
não substitui revisão humana; a migration é aditiva e não possui downgrade
destrutivo; geração e qualidade editorial dos cues permanecem para E07-S01B.
O PR #57 foi aberto em 29/09/2026 (`3d306c4`).

### E07-S01B — Deterministic Subtitle Cues and ASS/SRT

Objetivo: gerar cues determinísticos e representações ASS/SRT a partir das
identidades persistidas por E07-S01A, sem renderizar vídeo.

Aceite demonstrado: `subtitle-style-policy/1.0.0` fecha normalização NFC,
segmentação, limites, duração mínima de 600 ms, gaps de 80 ms e tail de 120 ms.
O texto reconstruído corresponde exatamente à narração normalizada; a timeline
canônica permanece em milissegundos, ordenada, positiva, sem sobreposição e
limitada à duração física da voz. SRT e ASS são derivados puros em memória,
escapados e reproduzíveis; a precisão em centésimos do ASS não altera os cues
persistidos. Identidades e hashes explícitos ligam a legenda ao `PipelineRun`,
projeto/versão, `Script` e `VoiceTrack` exatos. Retry reutiliza a identidade
derivada sem duplicar estado, e duração insuficiente falha com código público
antes de qualquer escrita.

Evidência: 28 testes focados cobrem política, Unicode, reconstrução, limites,
timings, gaps, tail, cadeia exata, divergências, serialização, escaping,
persistência SQLite, retry, rollback e isolamento arquitetural. A suíte completa
aprovou 434 testes e ignorou 4 integrações/smokes opt-in; `git diff --check`
passou.

Riscos residuais: timings são proporcionais ao texto, não alinhamento acústico;
palavras indivisíveis podem exceder o alvo visual original de 42 caracteres; ASS reduz a
representação para centésimos, preservando a timeline canônica em milissegundos.
Renderização física, qualidade visual e sincronização observada permanecem para
E07-S01C e E08-Q01.

A correção operacional posterior evolui a política visual para
`subtitle-style-policy/1.1.0`, reduz o alvo para 34 caracteres por linha e ajusta
fonte e margens do ASS sem alterar a timeline canônica.

### E07-S01C — Physical Subtitle Rendering

Aceite demonstrado: `subtitle-render-request/1.0.0`,
`subtitle-render-result/1.0.0` e `ffmpeg-subtitle-render-policy/1.0.0` fecham a
identidade lógica, a tolerância de 34 ms e as propriedades físicas esperadas.
O adapter consome o MP4 e a `SubtitleTrack` exatos, materializa o ASS somente em
staging privado, executa FFmpeg sem shell com áudio em `copy`, exige decode e
FFprobe válidos e promove o resultado por SHA-256. A saída é um `VideoRender`
revisão 2 append-only; revisão 1 permanece imutável. Lineage registra plano,
vídeo original e legenda, e a toolchain efetiva relevante fica auditável sem
promessa de bytes iguais entre ambientes diferentes.

Retry terminal não reexecuta FFmpeg. A reconciliação por receipt e alias interno
reutiliza uma promoção sem commit somente após validar request hash, SHA-256
físico, decode, FFprobe e política. Request normalizada, resultado e lineage são
persistidos em uma transação SQLite; falhas fazem rollback e sempre limpam o
staging. A implementação reutiliza a migration 023 e não cria migration nova.

Evidência: 13 novos testes cobrem contratos, identidade, cadeia, hashes, escopo,
lineage, ASS, allowlist, escaping por basename controlado, staging, falhas do
processo, timeout, cancelamento, logs sanitizados, FFprobe, áudio, tolerância,
storage, reconciliação, retry, rollback e isolamento arquitetural. A integração
local real com FFmpeg passou; a suíte completa aprovou 446 testes e ignorou 5
integrações/smokes opt-in; `git diff --check` passou. O PR #59 foi aberto em
29/09/2026.

Riscos residuais: versão de FFmpeg/libass e resolução da fonte podem alterar os
bytes entre toolchains; o hash persiste os bytes efetivos, enquanto a identidade
lógica permanece estável. Qualidade visual e sincronização percebida continuam
para QC posterior.

Continuam fora do escopo do corte inicial: karaoke, destaque palavra por
palavra, animações complexas, múltiplos estilos automáticos, escolha de layout
por IA e efeitos avançados.

### E07-P01 — End-to-End Real Preview

Aceite demonstrado: `real-preview-request/1.0.0` mantém identidade reproduzível
independente de `requestedAt`; o timestamp do primeiro roteiro persistido torna-se
canônico para retries. Uma única chamada valida a `PipelineRun`, projeto e versão
explícitos e orquestra roteiro, voz, mídias na ordem das direções visuais, plano,
render revisão 1, legenda e burn-in revisão 2 sem consultar `latest`.

A timeline divide a duração física da voz por `floor(i * D / N)`, cobre exatamente
`D` milissegundos e recusa segmentos vazios. Cada fronteira revalida escopo,
IDs, hashes, direitos e ancestry; antes de expor o preview, a orquestração confere
a lineage persistida completa e o SHA-256 físico do render revisão 2 no storage
content-addressed. Revisão 1 e ascendentes permanecem append-only. Custos presentes
no ledger são reportados; etapas sem custo comprovado permanecem explicitamente
indisponíveis, nunca zero.

Retry reutiliza todos os efeitos terminais persistidos. Cancelamento interrompe
efeitos restantes, não produz resultado e mantém a run retomável; falha definitiva
é sanitizada e transiciona a run para `FAILED`. QC, aprovação e publicação não são
executados. Não houve migration.

Evidência: 10 testes novos da suíte padrão cobrem contratos, identidade, timeline,
ordem, hashes, direitos, custos, lineage, retry, retomada, cancelamento, falhas e
isolamento. A integração opt-in executou áudio WAV e mídia PNG físicos, composição
e burn-in FFmpeg reais e confirmou o SHA-256 do MP4 final. A suíte completa aprovou
456 testes e ignorou 6 integrações/smokes opt-in. Os smokes OpenAI de voz e imagem
permanecem dependentes de credenciais e desabilitados por padrão;
`git diff --check` passou. O PR #60 foi aberto em 30/09/2026.

Riscos residuais: versões de FFmpeg/libass e fontes podem alterar bytes entre
ambientes; disponibilidade, cobrança e limites dos providers externos permanecem
fora da integração local. Qualidade visual e sincronização percebida seguem para
E08-Q01.

### E07-P02 — Local Preview Runner

Objetivo: fornecer um ponto de entrada operacional simples, como
`npm run preview`, para executar o `RealPreviewService` fora dos testes internos.

Aceite mínimo:

- CLI/runner fino carrega `.env`, recebe projeto, versão e seleção explicitamente,
  monta somente dependências reais existentes e inicia ou retoma a `PipelineRun`;
- progresso resumido e erros públicos sanitizados são apresentados ao operador;
- ao final, informa status, run ID, `VideoRender` ID, SHA-256, referência lógica e
  caminho operacional/local seguro para abrir o MP4 reproduzível;
- domínio e services existentes permanecem como fonte de verdade; a CLI não duplica
  regras nem introduz arquitetura, contrato ou migration.

Frontend, QC, aprovação e publicação permanecem fora deste tópico.

Aceite demonstrado: `npm run preview` recebe projeto, versão e seleção
explicitamente, recupera a `PipelineRun` vinculada e executa o
`RealPreviewService` com os repositories, services, adapters OpenAI e FFmpeg já
existentes. A identidade determinística do preview permite retomar efeitos
parciais e reutilizar estado terminal sem duplicá-los. O operador recebe progresso
resumido, modo `NEW`, `RESUMED` ou `REUSED_TERMINAL`, status, run ID,
`VideoRender` ID, SHA-256, referência lógica e path físico validado.

O path local é resolvido somente depois da verificação do hash e existe apenas na
saída do processo; não integra contratos, banco ou logs. Erros públicos preservam
somente código, campo e mensagem controlada, sem credenciais, payload bruto, path
privado ou stack trace. Não houve contrato, migration, frontend, QC, aprovação ou
publicação. Evidência: 6 testes novos cobrem comando operacional, entrada
explícita, modos de execução, escopo, composição real e sanitização; 47 testes
focados passaram e a suíte completa aprovou 462 testes, com 6 integrações opt-in
ignoradas. `git diff --check` passou. O PR #62 foi aberto em 30/09/2026.

### E08-Q01 — Quality Control

Objetivo: produzir QC determinístico sobre a versão final legendada e sua cadeia
exata antes de qualquer aprovação.

Aceite mínimo:

- arquivo existe, é acessível, não vazio, legível, decodificável, não corrompido,
  possui container suportado e SHA-256 consistente;
- vídeo possui resolução correta, proporção 9:16, duração e timeline válidas;
- áudio e streams esperados estão presentes e coerentes;
- legenda está incorporada conforme a política e corresponde ao artefato esperado;
- `MediaAsset`s possuem origem, direitos comerciais, hashes e referências válidos;
- relatório referencia `PipelineRun`, projeto/versão, `Script`, `VoiceTrack`,
  `MediaAsset`, `CompositionPlan`, `SubtitleTrack` e `VideoRender` exatos;
- resultado e findings estruturados, rastreáveis e classificados como `PASS`,
  `FAIL` ou `WARN`; `FAIL` bloqueia aprovação e `WARN` permanece visível.

Julgamento subjetivo avançado de criatividade e análise acústica sofisticada não
bloqueiam o corte inicial.

Aceite demonstrado: `quality-control-policy/1.0.0` classifica findings em ordem
determinística e agrega o resultado com precedência `FAIL`, `WARN`, `PASS`.
Cada `quality-control-report/1.0.0` é imutável e ligado ao `VideoRender` revisão 2
por ID e SHA-256; retry retorna o mesmo relatório e um novo render exige novo QC.
O adapter FFmpeg/FFprobe devolve somente fatos sanitizados sobre arquivo,
container, decode, streams, resolução, duração e hashes. A política, fora do
adapter, decide severidade, valida timeline, burn-in e a lineage exata de
`PipelineRun`, projeto/versão, `Script`, `VoiceTrack`, `MediaAsset`s,
`CompositionPlan`, `SubtitleTrack` e `VideoRender`.

A migration 024 é estritamente necessária para persistir relatórios e findings,
garantir unicidade por política e render exato e impedir alterações retroativas.
O runner executa QC após o preview e apresenta resultado, bloqueio e findings sem
aprovar ou publicar. `FAIL` define `approvalBlocked: true`; `WARN` permanece
explícito. Evidência: 12 testes focados passaram; a integração física opt-in
validou o MP4 legendado real com FFmpeg/FFprobe; a suíte completa aprovou 468
testes e ignorou 6 integrações opt-in; `git diff --check` passou.
O PR #63 foi aberto em 30/09/2026.

### E08-U01 — Operator Preview Console

Objetivo: fornecer uma interface web mínima, reutilizando servidor e frontend
existentes quando possível, para o operador usar o MVP sem CLI.

Aceite mínimo:

- selecionar projeto, versão e execução/seleção, iniciar o preview e acompanhar
  `Script`, `Voice`, `Media`, `Composition`, `Subtitles`, `Preview`, `QC` e
  `Approval` com estados equivalentes a `PENDING`, `RUNNING`, `SUCCEEDED` e
  `FAILED` quando aplicáveis;
- reproduzir o `VideoRender` final exato e apresentar seu ID, revisão, SHA-256 e QC;
- permitir retomada quando suportada e preparar a superfície de aprovação sem
  registrar aprovação ou rejeição, que pertencem a E08-A01;
- em falha, mostrar etapa e mensagem sanitizada, sem API keys, paths privados,
  payloads externos brutos ou stack traces sensíveis.

A interface é adapter fino sobre capacidades existentes e não cria novo framework,
arquitetura, contrato ou migration sem necessidade demonstrada.

Implementação: o servidor HTTP existente ganhou rotas finas para catálogo,
execução, estado e streaming do MP4. Projeto, versão, `PipelineRun` e seleção são
sempre explícitos. A execução reutiliza o mesmo caso de uso compartilhado pela
CLI e pelo console; refresh reconstrói as sete etapas a partir dos artefatos
persistidos. O endpoint de vídeo recebe somente `VideoRender` ID e SHA-256,
carrega a referência lógica persistida e a resolve pelo storage seguro. O QC é
exibido apenas quando ID e hash correspondem ao mesmo render final.

Evidências: testes cobrem catálogo, retomada concorrente idempotente, reconstrução
de etapas, vínculo `VideoRender`/QC, `PASS`/`WARN`/`FAIL`, bloqueio visual de
`FAIL`, streaming parcial seguro e sanitização de falhas. A suíte completa passou
com 483 testes e 6 integrações opt-in ignoradas; `git diff --check` passou.

Risco residual: reiniciar o processo interrompe uma chamada externa em andamento;
os artefatos já persistidos continuam recuperáveis e o retry retoma o pipeline
pelas identidades determinísticas existentes.
O PR #64 foi mergeado em 30/09/2026 (`de7de83`).

### E08-U02 — Operator Run & Idea Bootstrap

Objetivo: fechar o gap operacional entre `ProjectVersion` e `IdeaSelection` para
que o operador consiga iniciar todo o MVP 1 pela interface existente.

Implementação: um caso de uso fino inicia ou retoma a identidade explícita pela
`PipelineRunService`, deriva o `ResearchInput`, executa o radar e a shortlist
persistidos e solicita propostas estruturadas ao provider OpenAI já adotado. IDs
de evidência retornados pelo provider são tratados como entrada não confiável e
precisam pertencer à shortlist exata. `IdeaService` continua responsável por
contratos, scoring determinístico, hashes, lineage e persistência.

A console expõe somente endpoints mínimos para criar a run/bootstrap e registrar
a seleção. A escolha envia candidato, score e hashes exatos ao
`IdeaSelectionService`, com ator `HUMAN`, decisão `SELECTED` e justificativa
editorial opcional. Nenhuma ideia é selecionada automaticamente. Catálogo,
candidatos e seleção são reconstruídos do SQLite após refresh; o Preview existente
continua sendo iniciado somente após uma seleção persistida.

Não houve migration nova. A configuração do radar foi extraída para composição
compartilhada entre CLI e console, evitando duplicação de regras operacionais.

Evidências: testes focados passaram para bootstrap, adapter estruturado,
runtime, console, HTTP e UI. A suíte completa aprovou 501 de 507 testes e ignorou
6 integrações físicas/externas opt-in; `git diff --check` passou. A cobertura inclui
retry sem repetir Research/provider após persistência, ausência de auto-select,
evidência inventada, IDs oficiais mistos, seleção pelo service, recuperação
persistida e sanitização.

Risco residual: uma nova execução depende das credenciais e elegibilidades reais
das fontes configuradas, do modelo de clustering e do provider de ideias. Quedas
durante chamadas externas exigem retry pelo mesmo `pipelineRunId`; etapas já
persistidas são retomadas e nenhum candidato parcial é apresentado como válido.
O PR #68 foi mergeado em 30/09/2026 (`129b476`). A correção pós-merge para IDs
oficiais mistos foi mergeada no PR #69. A remoção de `uniqueItems`, não suportado
pelo Structured Outputs, foi mergeada no PR #70. A correção seguinte remove a
confirmação manual de direitos da configuração de imagem, assume a autorização
operacional definida para o produto e registra dinamicamente a data UTC; 501 de
507 testes passaram e 6 integrações opt-in foram ignoradas. O PR #71 foi
mergeado. A correção visual seguinte mantém etapas ociosas em `PENDING`, usa
`RUNNING` somente enquanto o job está ativo e interrompe polling ocioso; o PR
#72 foi mergeado. A correção operacional posterior amplia o parser WAV para
chunks auxiliares e tamanhos de streaming válidos, preserva códigos públicos de
falha do provider, aceita `generation_id` na resposta de imagem, decodifica a
identidade opaca do vídeo, melhora a legibilidade das legendas e usa a faixa alvo
conservadora do roteiro sem alterar os limites físicos. A suíte completa aprovou
509 de 515 testes e ignorou 6 integrações opt-in; `git diff --check` passou. O
PR #73 foi aberto.

Após o merge, uma execução real revelou que um roteiro estimado em 37 segundos
produziu 45,95 segundos de áudio. A correção seguinte reduz o alvo máximo de 85%
para 80% do limite físico e preserva `VOICE_DURATION_OUT_OF_RANGE` no status. Um
smoke real Script→Voice produziu roteiro estimado em 34 segundos e WAV de 37,95
segundos; o teste físico Composition→Subtitles→Preview→QC também passou. A suíte
completa aprovou 510 de 516 testes e ignorou 6 integrações opt-in.
O PR #74 foi aberto.

### E08-A01 — Human Approval

Objetivo: permitir que o operador assista e aprove ou rejeite exatamente uma
versão final legendada que tenha passado por QC.

Aceite mínimo:

- apresentar preview, identificador, revisão, hash, QC, warnings, projeto,
  conteúdo e data/hora;
- estados mínimos `APPROVED` e `REJECTED`; `CHANGES_REQUESTED` entra somente se
  houver necessidade demonstrada;
- decisão referencia `VideoRender` ID, revisão, SHA-256 e QC correspondentes;
- qualquer alteração cria nova versão e não herda a aprovação anterior;
- histórico é append-only e aprovação não migra implicitamente entre renders;
- efeito externo futuro só pode consumir versão aprovada.

Implementação: `human-approval-decision/1.0.0` admite somente `APPROVED` e
`REJECTED`, deriva a identidade lógica do projeto/versão, `PipelineRun`,
`VideoRender` ID/revisão/SHA-256 e relatório de QC ID/SHA-256 exatos e exige
justificativa para rejeição. O service revalida render e QC persistidos, bloqueia
aprovação em `FAIL`, preserva `WARN`, retorna a decisão existente no retry
idêntico e rejeita conflito de decisão, ator ou justificativa.

A migration 025 adiciona o histórico imutável com triggers de binding e de
append-only. A consulta de aprovação exige todo o escopo explícito e possui ordem
determinística; não existe consulta implícita a `latest`. O console e o endpoint
HTTP permanecem adapters finos: apresentam hashes, QC, warnings, ator, instante,
justificativa e histórico, recuperam a decisão após refresh e não executam
publicação.

Evidências: 17 testes focados cobrem contrato, `PASS`/`WARN`/`FAIL`, justificativa,
bindings divergentes, nova identidade, retry, conflito, migration, imutabilidade,
consulta aprovada explícita, refresh, HTTP, UI e sanitização. A suíte completa
aprovou 488 testes e ignorou 6 integrações opt-in. `git diff --check` passou.
O PR #66 foi aberto em 30/09/2026.

Risco residual: sem autenticação, por decisão explícita de escopo, o ator é uma
identificação declarada pelo operador local; autenticação e multiusuário continuam
fora do MVP.

### E09 — Social Publishing (BLOQUEADO)

A análise de entrada de 30/09/2026 não autoriza implementação nem publicação. A
configuração local de projeto menciona Instagram como rede pretendida, mas isso
não constitui seleção formal de plataforma para E09 nem comprova elegibilidade
para publicar. As configurações existentes também não demonstram conta oficial
de teste, scopes de publicação ou acesso publicador à API oficial. O requisito de
exportação manual está documentado, porém ainda não há fallback operacional
demonstrado para o `VideoRender` exato aprovado.

G3 também permanece aberto na evidência operacional local: o banco
`data/mktauto.sqlite` contém zero decisões `APPROVED`. Logo, não existe uma tupla
recuperável por escopo explícito que vincule projeto/versão, `PipelineRun`,
`VideoRender` ID/revisão/SHA-256 e relatório de QC ID/SHA-256 válidos. Testes,
fixtures e a implementação do contrato de aprovação não substituem essa evidência
física real.

Condição de retomada: selecionar explicitamente uma única plataforma oficial;
disponibilizar conta oficial de teste elegível; confirmar os scopes mínimos de
publicação; permitir validação segura e sanitizada da API oficial sem expor
credenciais; definir e demonstrar a exportação manual do artefato exato; e produzir
uma execução física real com QC válido e decisão humana `APPROVED` sobre os IDs,
revisão e hashes exatos. Somente então E09 poderá analisar capacidades, limites,
custos e riscos da plataforma e propor sua decomposição e o menor corte para
aprovação. Nenhuma chamada de publicação foi realizada nesta análise.

### Política de testes do Critical Path

Cada tópico usa testes primeiro e cobre, conforme aplicável, unidade, contrato,
arquitetura, persistência, idempotência, conflito, falhas, rollback, segurança e
regressão completa. Adapters externos usam fake/stub determinístico na suíte
padrão; smoke real é opt-in, recebe credenciais somente pelo ambiente e nunca é
obrigatório no CI padrão. Toda entrega termina com `git diff --check`.

### Definition of Done do MVP 1

O MVP 1 somente estará DONE quando o operador conseguir:

1. abrir a interface;
2. selecionar projeto e versão;
3. iniciar uma execução;
4. acompanhar o progresso;
5. obter voz real;
6. obter mídia real;
7. obter MP4 real;
8. obter legendas;
9. assistir ao preview;
10. consultar QC;
11. aprovar ou rejeitar;
12. recuperar posteriormente a execução e seus artefatos.

O mesmo pipeline também deve ser executável por CLI mediante `npm run preview` ou
comando equivalente documentado.

Toda a cadeia deve preservar run, projeto, versão, artefatos, hashes, lineage,
direitos, custos conhecidos, histórico e idempotência. Publicação automática
permanece fora do MVP 1 e começa em E09.

Evidência V10: estrutura Markdown e marcadores do Critical Path validados,
`git diff --check` aprovado e diff restrito a este roadmap. O PR #53 foi aberto
em 29/09/2026. Os arquivos locais não rastreados em `data/` e `templates/` foram
preservados e não integram a entrega.

### E05-V03 — Real Voice Adapter

O adapter inicial usa exclusivamente a OpenAI Speech API com
`gpt-4o-mini-tts`, voz built-in `marin`, política
`openai-voice-policy/1.0.0` e saída WAV. Modelo, voz, formato, limite efetivo de
4096 caracteres, timeout, tamanho máximo e confirmação dos direitos comerciais
são configuração reproduzível de infraestrutura. A execução falha fechada se a
base comercial não estiver explicitamente confirmada; essa confirmação retrata
a configuração observada para a execução e não presume termos imutáveis.

O download binário é limitado e gravado em temporário privado. O parser aceita
somente o subconjunto necessário ao MVP — RIFF/WAVE, PCM linear, mono, 24 kHz e
16 bits —, percorre chunks com padding, ignora metadados auxiliares seguros e
aceita tamanhos sentinela de streaming somente no RIFF e em `data`; duplicidade,
truncamento, parâmetros, tamanho ou conteúdo mínimo incompatíveis são rejeitados.
A duração é medida pelos frames
físicos, e o SHA-256 é calculado diretamente sobre os bytes gravados. O storage
content-addressed cria o objeto sem sobrescrita: um hash já presente é relido,
revalidado e reutilizado; divergência falha sem alterar o objeto existente. O
`VoiceTrack` recebe somente `object:voice/sha256/<hash>`, nunca bytes, caminho ou
URL privada.

Timeout e cancelamento usam `AbortController`; falhas HTTP, de rede, formato,
storage ou direitos são sanitizadas, e temporários são removidos. A voz
customizada e estilos fora da allowlist — inclusive clonagem, imitação e
personificação — falham antes da chamada externa. A resposta binária normal do
endpoint não fornece custo individual confiável, portanto nenhum custo ou uso é
inventado e nenhuma telemetria de IA é criada sem evidência.

Evidência: 6 testes focados novos cobrem configuração e direitos explícitos,
porta existente, chamada oficial, arquivo físico, duração, SHA-256, referência
opaca, limites prévios, estilos recusados, WAV inválido/não suportado, tamanho,
silêncio, reuso e conflito de storage, timeout, cancelamento, sanitização e
cleanup. O smoke real é opt-in e ignorado por padrão. A suíte completa registrou
380 testes aprovados e 2 smokes opt-in ignorados; `git diff --check` passou.
Riscos residuais: qualidade e pronúncia dependem do QC futuro; o endpoint limita
o texto e segmentação permanece fora do tópico; uma chamada externa pode ser
cobrada antes de falha local; após a promoção do arquivo, rollback SQLite pode
deixar objeto content-addressed órfão, mas nunca `VoiceTrack` falso; não há
garantia distribuída de `exactly-once`. Os diretórios locais não rastreados
`data/` e `templates/` foram preservados e não integram a entrega.
O PR #54 foi mergeado em 29/09/2026 (`e6e7c42`).

### E06-M03 — Real Media Adapter

A estratégia inicial usa exclusivamente geração texto→imagem pela OpenAI Image
API, com snapshot `gpt-image-2.5-flare-2026-09-08`, `quality: medium`, PNG
opaco e uma saída `1152x2048`, proporção 9:16 exata. A porta `MediaProvider`
continua genérica; modelo, credencial, timeout, limites, direitos e pricing
versionado existem apenas na infraestrutura. O prompt é formado somente pela
direção visual e pelo contexto público do `ProjectSnapshot`; campos extras,
URLs, domínios, handles, referências estratégicas e conteúdo-fonte são
recusados antes da chamada.

A resposta JSON é lida com limite explícito e nenhum redirect ou download
secundário é aceito. Base64, formato declarado e metadados são não confiáveis.
O parser deriva o formato exclusivamente dos bytes e valida assinatura PNG,
ordem e limites de chunks, CRC, `IHDR`, `IDAT`, `IEND`, parâmetros técnicos,
dimensões e dados de pixels descomprimidos completos. O SHA-256 é calculado
diretamente sobre o PNG físico. O storage content-addressed cria
`media:sha256_<hash>` sem expor caminho; hash existente é relido, validado e
reutilizado, e conflito nunca é sobrescrito.

`commercialUseAllowed` é assumido como verdadeiro para a geração própria via
provider adotado, com base `PROVIDER_TERMS`; a data UTC da configuração é
registrada dinamicamente sem exigir confirmação manual por variável de ambiente.
A política `openai-image-pricing/1.0.0` somente
calcula USD quando `input_tokens` e `output_tokens` completos permitem aritmética
decimal determinística pelas taxas versionadas. Sem uso completo, o custo
permanece ausente. `MediaAsset`, solicitação, linhagem, telemetria e eventual
`CostEvent` de `media_cost` são persistidos na mesma transação local.

Evidência: os testes focados cobrem porta e isolamento arquitetural,
configuração, direitos, prompt sem referências, limites prévios, PNG físico,
CRC, truncamento, dimensões, formato/MIME divergentes, SHA-256, referência
opaca, reuso e conflito de storage, timeout, cancelamento, redirects,
sanitização, cleanup, custo comprovável, ausência de custo inventado,
idempotência e rollback transacional. O smoke real é opt-in e ignorado por
padrão. A suíte completa registrou 393 testes aprovados e 3 smokes opt-in
ignorados; `git diff --check` passou. Nenhuma migration ou dependência externa
foi adicionada.

Riscos residuais: qualidade e adequação visual dependem do futuro QC e da
aprovação humana; disponibilidade, latência, rate limit, cobrança, termos e
preços dependem do provider; uma chamada pode ser cobrada antes de falha local;
rollback SQLite posterior à promoção pode deixar objeto content-addressed
órfão, mas nunca `MediaAsset` falso; retry após efeito externo sem conclusão
local pode gerar outra imagem e outro custo; não há garantia distribuída de
`exactly-once`. Os diretórios locais não rastreados `data/` e `templates/`
foram preservados e não integram a entrega.
O PR #55 foi mergeado em 29/09/2026 (`1a28d5d`).

Correção operacional em 30/09/2026: uma resposta HTTP 200 válida da Images
API com PNG de aproximadamente 3,7 MB expôs `RangeError` no regex repetitivo que
validava os quase 5 MB de `data[0].b64_json`; o adapter classificava a exceção
como `PROVIDER_CONNECTION_FAILED` e a aplicação a reduzia a `PROVIDER_FAILED`.
A validação Base64 agora percorre a string iterativamente, exige alfabeto,
comprimento e padding estritos sem mutar a entrada, enquanto a validação física
posterior do PNG permanece inalterada. `MediaAcquisitionService` preserva código
e campo de erros no formato público `PROVIDER_[A-Z0-9_]+`, mantendo mensagem
sanitizada e causa interna; erros comuns continuam genéricos. Evidência: 25
testes focados e a suíte completa com 512 aprovados e 6 opt-in ignorados; smoke
real da imagem e integração física de Composition, Subtitles, Preview e QC
passaram. Risco residual: disponibilidade, latência, rate limit e cobrança
continuam dependentes do provider; o código público permanece confiável apenas
quanto ao formato e nunca expõe a mensagem externa.

### E07-C04 — Real VideoComposer / FFmpeg Adapter

A política `ffmpeg-video-policy/1.0.0` produz exclusivamente MP4 `1080x1920`
com CFR `30/1`, H.264 `libx264` High level 4.0, CRF 20, preset medium,
`yuv420p`, GOP 60 sem scene-cut e AAC-LC mono 48 kHz/192 kbps. FFmpeg e
FFprobe permanecem na infraestrutura, executados por array de argumentos com
`shell: false`; filtros, codecs e limites vêm somente da política fechada.

Para o frame `n`, o PTS é `n/30`. O frame usa o segmento que contém esse
timestamp e a troca visual ocorre no primeiro frame cujo PTS seja maior ou
igual ao início do novo segmento. O container e o áudio terminam na duração
física da voz; o stream CFR de vídeo pode terminar menos de um frame antes.

Um catálogo dedicado recupera `VoiceTrack` e `MediaAsset` pelos IDs exatos sem
ampliar `CompositionPlanRepository`. O resolver aceita somente as referências
opacas conhecidas, confina arquivos por `lstat`/`realpath` aos roots autorizados
e bloqueia traversal, symlink e ausência. Originais e cópias consumidas são
revalidados por propriedades e SHA-256. O staging privado fica sob o
`renderRoot`, no mesmo filesystem, e o MP4 só é promovido por hard-link depois
de decode integral, inspeção FFprobe e hash dos bytes reais. Reuso exige objeto
existente íntegro; conflito nunca sobrescreve conteúdo. Nenhum `CostEvent` é
criado para processamento local.

Evidência: 15 testes focados cobrem política, porta, catálogo, fake,
isolamento, cadeia exata, direitos, formatos, referências, symlink, hashes das
cópias, timeline, argumentos allowlisted, `shell: false`, inspeção, streams,
timeout, cancelamento, logs, cleanup e storage. A integração local opt-in com
FFmpeg 8.1.1 produziu duas vezes o mesmo MP4 e o mesmo SHA-256. A suíte completa
registrou 406 testes aprovados e 4 integrações/smokes ignorados por padrão;
`git diff --check` passou. Não houve migration nem alteração de contrato.

Riscos residuais: trocas visuais são quantizadas à grade de 30 fps;
reprodutibilidade byte a byte depende da mesma política e toolchain; falha
SQLite depois da promoção pode deixar MP4 content-addressed órfão, nunca
`VideoRender` falso; roots locais privados ainda dependem das permissões do
host. `data/` e `templates/` foram preservados. O PR #56 foi mergeado em
29/09/2026 (`2e2b1d2`).

## Primeiro épico — E01 Project Configuration

### PC01 — contrato de domínio

- definir `Project`, `ChannelProfile`, `ReferenceProfile` e `ProjectSnapshot`;
- validar nicho, idioma, durações, formato, frequência, redes e timezone;
- aplicar defaults sem depender de provider;
- versionar schemas e cobrir invariantes por TDD;
- não persistir, expor API ou alterar a UI.

Aceite: fixtures válidas produzem snapshot normalizado e imutável; configurações
inválidas falham com código/campo estáveis; nenhum segredo é aceito no contrato.

Implementação PC01: `project-contracts/1.0.0` produz um snapshot profundamente
imutável por allowlist e rejeita campos sensíveis antes da normalização. Os
defaults reproduzíveis são versão `1`, idioma `pt-BR`, vídeo curto `9:16`, duração
de 25–45 segundos, estilos editorial e de voz `informative`, visual `dynamic`,
frequência diária `1`, timezone `America/Sao_Paulo` e horário `10:00`; ao menos
uma rede continua obrigatória, pois escolher um provider implicitamente não é um
default seguro. Referências recebem uso `strategic_reference_only` e
`grantsUsageRights: false`.

Evidência: 9 testes focados e a suíte completa de 96 testes passaram em
27/09/2026, junto de `git diff --check`. O risco residual é deliberadamente
limitado ao escopo: persistência e histórico de versões só serão tratados em
PC02, e novas redes ou formatos exigirão evolução explícita do contrato.

### PC02 — persistência e versionamento

- criar migração e repositório SQLite;
- preservar histórico de versões e arquivamento lógico;
- impedir colisões e updates perdidos;
- manter migrações aditivas.

Aceite: create/read/version/archive são transacionais e reproduzíveis; migration,
rollback de transação e compatibilidade possuem testes.

Implementação PC02: a migração aditiva `003_project_catalog` mantém a sequência
do catálogo SQLite e cria projetos com arquivamento lógico e snapshots por versão.
O repositório valida pelo contrato antes da escrita e novamente após a leitura,
exige versão esperada nas mutações e usa transações imediatas para impedir updates
perdidos. Triggers bloqueiam `UPDATE` e `DELETE` dos snapshots persistidos; falhas
de migração ou de qualquer etapa de escrita revertem integralmente a transação.

Evidência: 21 testes focados de Project/Channel e a suíte completa de 108 testes
passaram em 27/09/2026, junto de `git diff --check`; o PR #26 foi aberto. O risco residual fica
deliberadamente limitado ao escopo: chaves idempotentes, ator e instante de
comandos mutáveis pertencem ao PC03; contenção prolongada entre processos pode
resultar em erro de ocupação do SQLite após o timeout, sem escrita parcial.

### PC03 — serviço de aplicação idempotente

- criar e atualizar projetos por comandos explícitos;
- produzir `ProjectSnapshot` por versão;
- exigir chave idempotente para comandos mutáveis;
- registrar ator e instante.

Aceite: retry idêntico retorna o mesmo resultado; reutilização divergente da
chave falha; snapshot usado por run não muda retroativamente.

Implementação PC03: `ProjectApplicationService` valida comandos de criação,
versionamento e arquivamento antes da escrita, normaliza a entrada pelo contrato
PC01 e compara retries por serialização canônica e SHA-256. A migração aditiva
`004_project_commands` registra chave, tipo, hash, ator, instante, referência e
resultado imutável; a extensão transacional do repositório PC02 persiste comando,
projeto e snapshot na mesma transação, preservando a versão esperada.

Evidência: 29 testes focados de Project/Channel e a suíte completa de 117 testes
passaram em 27/09/2026, junto de `git diff --check`. Falhas forçadas no registro
reverteram criação, nova versão e arquivamento sem deixar efeitos parciais. O risco
residual permanece a contenção prolongada entre processos exceder o timeout do
SQLite; nesse caso, nenhuma escrita parcial é confirmada. O PR #28 foi aberto em
27/09/2026.

### PC04 — interface local

- expor configuração e consulta pela menor interface compatível com a aplicação;
- apresentar erros por campo sem vazar detalhes internos;
- permitir exportar configuração sanitizada.

Aceite: operador cria, revisa e seleciona um projeto localmente; segredos e
artefatos privados não aparecem na exportação.

Implementação PC04: uma única CLI local expõe criação, nova versão e arquivamento
por meio exclusivo do `ProjectApplicationService`; consultas usam o repositório e
os contratos existentes. `latest`, `get`, `review`, `select` e `export` não criam
comandos ou versões, e seleção permanece em memória. Entradas são JSON por
allowlist, falhas públicas preservam código e campo sem detalhes internos e a
exportação contém somente o snapshot normalizado em ordem determinística.

Evidência: 8 testes focados da interface e a suíte completa de 125 testes passaram
em 27/09/2026, junto de `git diff --check`. Os testes cobrem retries, conflito de
versão, histórico imutável, ausência de efeitos em leitura/seleção, rejeição de
segredos antes da abertura do banco e exportação sanitizada. O risco residual é
operacional: o arquivo indicado explicitamente por `--output` pode ser substituído;
o banco de dados é bloqueado como destino de exportação. O PR #29 foi aberto em
27/09/2026.

### PC05 — handoff para o pipeline

- vincular uma execução ao `ProjectSnapshot` selecionado;
- registrar `project_id` e versão nos artefatos seguintes;
- não implementar Research ou geração.

Aceite: um stub consumidor recebe snapshot válido e rastreável; edição posterior
do projeto não altera a execução já iniciada.

Implementação PC05: `pipeline-handoff/1.0.0` exige `pipelineRunId`, `projectId`,
`projectVersion` e `startedAt` explícitos, consulta somente a versão informada e
revalida o snapshot pelo contrato PC01 antes de entregá-lo ao consumidor stub. A
execução e o artefato stub são profundamente imutáveis, compartilham a mesma
referência de projeto e possuem serialização determinística. O comando local
`handoff` recebe JSON por allowlist, rejeita segredos antes de abrir o catálogo e
não cria banco, projeto, versão, comando ou outro estado de pipeline.

Evidência: 8 testes focados do handoff e a suíte completa de 133 testes passaram
em 27/09/2026. Os testes cobrem seleção explícita, revalidação, referência
imutável após nova versão e arquivamento, retry determinístico, propagação ao
artefato, erros públicos sanitizados e ausência de efeitos. O risco residual é
deliberado: execução e artefato permanecem apenas na saída estruturada até um
tópico futuro implementar a persistência completa de `PipelineRun`.
O PR #30 foi mergeado em 27/09/2026.

PC02 só começa após o merge de PC01, e assim sucessivamente. A divisão pode ser
reduzida se a análise de Ready demonstrar que duas fatias não entregam valor
isolado, mas nenhum tópico pode antecipar outro épico.

## Segundo épico — E02 Research & Reference Analysis

### E02-R01 — entrada versionada de Research

- receber somente a seleção explícita produzida pelo handoff PC05;
- criar `ResearchInput` imutável com execução, janela e `ProjectSnapshot` exato;
- impedir consulta implícita a `latest` e efeitos de radar ou provider;
- preservar referências estratégicas e seus direitos restritos.

Implementação E02-R01: `research-input/1.0.0` exige `pipelineRunId`, `projectId`,
`projectVersion`, `startedAt`, `logicalDate` e o `ProjectSnapshot` completo. O
serviço reutiliza a resolução exata extraída do PC05, faz uma única leitura por
projeto e versão, revalida o snapshot e entrega uma cópia profundamente imutável.
Configurações de provider, adapters, catálogo e persistência de `PipelineRun`
permanecem fora do contrato e nenhum campo `latest` é aceito.

Evidência: 14 testes focados de handoff e entrada de Research e a suíte completa
de 139 testes passaram em 27/09/2026, junto de `git diff --check`; o PR #31 foi
mergeado. O risco residual é deliberado: identidade diária multi-projeto,
propagação aos artefatos do radar e uso editorial de nicho, público, idioma e
redes pertencem ao E02-R02; análise de handles estratégicos permanece em tópico
posterior separado.

### E02-R02 — radar diário vinculado ao projeto

- consumir exclusivamente `ResearchInput`, sem consultar projeto, versão ou `latest`;
- isolar execução e exportação por pipeline, projeto, versão e data;
- usar contexto editorial, timezone, idioma e redes do snapshot;
- produzir o primeiro artefato versionado de Research ligado ao `TrendRun`.

Implementação E02-R02: `research-topic-catalog/1.0.0` propaga `pipelineRunId`,
`projectId` e `projectVersion` ao catálogo diário, enquanto `trend-contracts/1.2.0`
remove o idioma fixo do clustering. A migração 005 é aditiva e mantém
`daily_runs` como legado; retries idênticos reutilizam etapas e conflitos de
identidade falham antes de consultar providers. Redes configuradas definem o
plano de fontes, YouTube pode aparecer como dependência técnica explícita e
redes sem adapter são registradas sem chamada externa. `TREND_REGIONS` permanece
operacional e independente do idioma.

Evidência: 145 testes passaram em 27/09/2026, incluindo dois projetos na mesma
data, isolamento do histórico por projeto e versão, retry, conflito de pipeline,
idioma dinâmico, dependência técnica, provider não suportado, exportação e
direitos; `git diff --check` passou. Risco residual: shortlist e seleção ainda
pertencem ao catálogo legado global e exigem corte próprio antes de uso por
projeto. Análise ativa de `references[]` continua fora deste tópico. O PR #32 foi
mergeado em 27/09/2026 (`7e0cf31`).

### E02-R03 — análise de referências estratégicas

- consumir exclusivamente o `ResearchInput` e os handles configurados no snapshot;
- consultar somente capacidades oficiais por handle, sem scraping ou descoberta;
- produzir `ReferenceInsight` agregado, rastreável e sem conteúdo-fonte persistido;
- manter análise de referências separada do radar, Content Intelligence e geração.

Implementação E02-R03: `reference-insight/1.0.0` liga o artefato a
`pipelineRunId`, projeto, versão, data e hashes da entrada e do snapshot. A
política `reference-analysis-policy/1.0.0` usa uma janela determinística de 30
dias e até 25 itens por referência. YouTube, Instagram Business Discovery e
Threads Profile Discovery consultam o handle exato; TikTok limita-se à conta
OAuth exatamente correspondente; Facebook permanece `UNSUPPORTED` sem criar
novo provider. Textos públicos são classificados apenas em memória e somente
IDs, permalinks, metadados mínimos e rótulos controlados são persistidos.

A migração 006 é aditiva e separa runs, passos por referência e artefatos. Retry
idêntico reutiliza passos concluídos e o artefato final; conflitos de pipeline,
projeto, versão, snapshot ou política falham antes do provider. Cobertura parcial,
provider indisponível e erros sanitizados permanecem explícitos. Direitos ficam
`strategic_reference_only`, sem download, armazenamento de texto ou permissão de
republicação.

Evidência: 161 testes passaram em 27/09/2026, incluindo consultas exatas por
handle, ausência de chamadas para referências sem capacidade, agregação mínima,
isolamento multi-projeto, retry, migração 005→006, sanitização e direitos;
`git diff --check` passou. Riscos residuais: App Review e quotas da Meta, cobertura
profissional do Instagram, autorização TikTok, métricas mutáveis, handles
renomeados e amostras insuficientes.
O PR #33 foi mergeado em 27/09/2026 (`4cb6ce2`).

### E02-R04 — shortlist de Research vinculada ao projeto

- consumir somente o `ResearchInput` e o `ResearchTopicCatalog` exatos;
- validar identidade e hashes antes de considerar qualquer candidato;
- materializar seleção determinística e explicável, sem nova coleta ou análise;
- manter `ReferenceInsight` independente para o futuro Content Intelligence.

Implementação E02-R04: `research-shortlist/1.0.0` liga a shortlist ao pipeline,
projeto, versão, data, catálogo de Research e hash canônico do catálogo de
tendências consumido. A política `research-shortlist-policy/1.0.0` limita o
resultado a cinco candidatos, com até dois por cluster, três por plataforma e
três por região; relaxamento para cobertura insuficiente preserva a ordem-base
e gera lacuna explícita.

A migração 007 é aditiva e isola os artefatos por pipeline e escopo do projeto.
Retry idêntico retorna o artefato existente; divergências de identidade, entrada,
catálogo ou política falham antes da seleção. Scores, explicações, componentes
indisponíveis, evidências e cobertura são copiados dos artefatos persistidos,
sem provider, IA, `latest`, catálogo global ou mutação do estado dos candidatos.
O comando global `select` falha fechado e `ReferenceInsight` não integra o
contrato nem influencia ranking.

Evidência: 169 testes passaram em 27/09/2026, incluindo ordem e desempates,
diversidade e relaxamento, métricas indisponíveis, cobertura parcial, linhagem,
hashes, retry, migração 006→007 e regressão completa; `git diff --check` passou.
Riscos residuais: qualidade e cobertura continuam limitadas pelos scores e
fontes do catálogo original; diversidade pode ser relaxada quando há poucos
candidatos elegíveis.
O PR #34 foi mergeado em 27/09/2026 (`3908856`).

## Terceiro épico — E03 Content Intelligence

### E03-I01 — contratos de ideias e scoring determinístico

- receber lotes explícitos de ideias sem chamar IA ou escolher vencedora;
- vincular cada ideia à `PipelineRun`, projeto, versão e `ResearchShortlist` exatos;
- aceitar `ReferenceInsight` somente quando informado e coerente com o escopo;
- calcular score versionado, explicável e reproduzível;
- persistir ideias, scores, evidências e linhagem de forma transacional e append-only.

Implementação E03-I01: `idea-candidate/1.0.0` preserva identidade de conteúdo
normalizado, conceito, ângulo editorial, intenção derivada do `ProjectSnapshot`,
origem e IDs das evidências consumidas. IDs da shortlist e do insight opcional
são verificados contra registros persistidos do mesmo escopo; texto-fonte,
prompts, segredos, mídia, transcrições e payloads privados não são aceitos.

`idea-score/1.0.0` usa `idea-scoring-policy/1.0.0` para adequação ao nicho e
público, força da evidência, novidade relativa, viabilidade editorial, risco de
direitos e diversidade. Cada componente registra disponibilidade, valor, peso,
motivo, evidências e contribuição. Componentes indisponíveis permanecem sem
valor ou contribuição e os pesos disponíveis são renormalizados. Empates seguem
`TOTAL_DESC,EVIDENCE_DESC,FIT_DESC,CONTENT_IDENTITY_ASC,IDEA_ID_ASC`.

A migração 011 adiciona lotes, ideias, evidências e scores sem alterar dados
anteriores. Ideias e scores integram `artifact-lineage/1.0.0`, são gravados na
mesma transação e protegidos contra update e delete. Retry idêntico recupera o
lote; divergências falham com código e campo públicos estáveis. Nenhum evento de
custo é criado e Research permanece funcionalmente inalterado.

Evidência: 15 testes focados e a suíte completa de 221 testes passaram em
28/09/2026, junto de `git diff --check`. A cobertura inclui contratos,
imutabilidade, escopo da run, shortlist e insights, evidências, componentes e
indisponibilidade, política e desempate, retry, conflitos, ordem, rollback,
migração aditiva, revalidação na leitura, linhagem e ausência de custo ou IA.
Riscos residuais: o scoring lexical inicial é deliberadamente simples e exige
calibração futura com histórico; SQLite mantém escritor único. Seleção humana,
geração automática e roteiro permanecem fora deste tópico. O PR #40 foi aberto
em 28/09/2026.

### E03-I02 — seleção humana de ideia append-only

- selecionar explicitamente uma ideia e seu score persistidos, sem inferir a
  escolha pelo ranking;
- registrar ator humano, justificativa pública opcional, hashes exatos, revisão
  e decisão anterior substituída;
- recuperar por ID explícito e listar por run ou lote em ordem determinística;
- preservar retry idempotente, histórico append-only e rollback transacional;
- integrar a seleção à linhagem sem IA, custo, roteiro ou efeito externo.

Implementação E03-I02: `idea-selection/1.0.0` registra somente a decisão
`SELECTED`, exige ator `HUMAN` e vincula a decisão à `PipelineRun`, projeto,
versão, lote, `IdeaCandidate` e `IdeaScore` exatos. O hash do conteúdo é
reproduzível e a leitura revalida contrato, colunas persistidas e hashes dos
artefatos selecionados. A API recupera seleção apenas por ID explícito; não há
consulta implícita à seleção mais recente.

A migração 012 adiciona decisões sem criar registros retroativos. Cada lote tem
uma única decisão por revisão; correções usam nova identidade e revisão,
referenciam a predecessora imediata e mantêm todas as decisões recuperáveis.
Triggers impedem update e delete. A seleção e sua linhagem, com ideia e score
como entradas internas, são gravadas na mesma transação. Nenhum evento de custo
é criado.

Evidência: 11 testes focados e a suíte completa de 232 testes passaram em
28/09/2026, junto de `git diff --check`. A cobertura inclui contrato, ator
humano, seleção sem relação com o maior score, escopo e hashes, ausências,
retry, conflitos, revisão e substituição, ordem, rollback, imutabilidade,
migração aditiva, revalidação na leitura, linhagem e ausência de custo.
Riscos residuais: SQLite mantém escritor único; a interface de operação será
introduzida apenas por tópico próprio. Roteiro, aprovação final e publicação
permanecem fora deste tópico. O PR #41 foi mergeado em 28/09/2026 no commit
`a3ac4e7`.

### E04-S01 — contrato e persistência append-only de roteiro

- registrar roteiro versionado derivado somente de uma `IdeaSelection`
  `SELECTED` informada por ID explícito;
- preservar seleção, ideia, run, projeto, versão e hashes exatos, sem consulta a
  `latest`;
- validar idioma, formato, duração, narração, blocos, indicações visuais,
  afirmações sensíveis e flags de revisão;
- recuperar por ID e listar por run ou seleção em ordem determinística;
- preservar retry idempotente, correções append-only, rollback e linhagem sem
  IA, custo ou efeito externo.

Implementação E04-S01: `script/1.0.0` representa hook, blocos narrativos e
indicações visuais ordenados, narração integral coerente, CTA opcional, duração,
afirmações sensíveis, flags editoriais, origem, revisão e hash reproduzível. O
repositório consome somente a seleção explícita, revalida a seleção e a ideia na
leitura e compara idioma, formato e limites de duração com o `ProjectSnapshot`
imutável da run.

A migração 013 adiciona roteiros sem criar registros retroativos. Cada seleção
tem uma única revisão de cada número; correções usam nova identidade, apontam
para a predecessora imediata e mantêm o histórico recuperável. Triggers impedem
update e delete. Roteiro e linhagem são persistidos na mesma transação, com a
`IdeaSelection` como entrada interna explícita e sem eventos de custo.

Evidência: 11 testes focados e a suíte completa de 243 testes cobrem contrato,
imutabilidade, ordem, narração, conteúdo sensível, seleção explícita, escopo e
hashes, compatibilidade com o projeto, retry, conflitos, revisão, rollback,
migração aditiva, revalidação na leitura, linhagem e ausência de custo. Riscos
residuais: SQLite mantém escritor único; originalidade substantiva e qualidade
editorial continuam sujeitas à revisão humana; geração por IA e aprovação final
permanecem em tópicos posteriores. O PR #42 foi mergeado em 28/09/2026 no
commit `d78309f`.

## Ordem após E01

1. adaptar o radar atual para consumir `ProjectSnapshot`, sem reescrever adapters;
2. separar análise de referência de coleta de tendência;
3. persistir `PipelineRun` e completar linhagem/custos conforme os primeiros
   artefatos consumidores surgirem;
4. implementar ideias e scoring antes de roteiro;
5. provar a porta OpenAI e as portas de voz, mídia e composer;
6. após E07-C03, executar sem intercalação estrutural o Critical Path:
   E05-V03, E06-M03, E07-C04, E07-S01A, E07-S01B, E07-S01C, E07-P01,
   E07-P02, E08-Q01, E08-U01 e E08-A01;
7. encerrar o MVP 1 somente com preview físico real, QC aprovado e aprovação
   humana sobre o hash exato da versão final legendada;
8. validar um publisher oficial por vez, começando pelo acesso realmente elegível;
9. após E09, evoluir E10 Daily Automation e E11 Offer & Campaign em paralelo;
   oferta e campanha vinculam projeto/canal, oferta, conteúdo/artefato e CTA
   comercial, sem exigir `Attribution` efetiva;
10. criar atribuição efetiva e registrar tráfego em E12 antes de conversão, e
    conversão antes de receita em ledger próprio;
11. construir analytics comercial e experimentos somente sobre essa cadeia de
    evidência;
12. otimizar e recomendar alocação apenas com histórico suficiente.

## Gates

| Gate | Condição para avançar |
|---|---|
| G1 — configuração | Snapshot representa a estratégia sem segredo e é reproduzível. |
| G2 — originalidade | Ideia e roteiro não reproduzem material de referência. |
| G3 — Real Production Gate | Uma execução completa produz áudio, mídia, vídeo e legendas físicos reais; o preview reproduz a versão final legendada, passa por direitos e QC, preserva lineage completa e recebe aprovação humana vinculada ao hash exato. Fixture, mock, stub ou fake não participa do caminho final aprovado. |
| G4 — publicação | Conta de teste, permissões e API oficial funcionam com fallback. |
| G5 — operação pública | Direitos, privacidade, retenção, takedown e segurança são revisados. |
| G6 — atribuição | Campanha, CTA, origem e limitações de tracking são reproduzíveis. |
| G7 — economia | Conversões e receitas possuem origem, moeda, janela e atribuição auditáveis. |
| G8 — analytics | Há cobertura e volume suficientes para comparação comercial útil. |
| G9 — escala | Política versionada, amostra suficiente e validação humana sustentam otimização e alocação. |

## Fronteiras e decisões

- adapters de pesquisa social não são publishers;
- nenhuma URL de referência autoriza download ou reutilização;
- `ProjectSnapshot` é imutável dentro de uma run;
- `PipelineRun` permanece a unidade técnica; portfólio é contexto econômico;
- artefatos são versionados e ligados por IDs/hashes;
- custos permanecem no `CostLedger`; o futuro `RevenueLedger` será separado,
  preferencialmente append-only e auditável;
- receitas, métricas e decisões preservam histórico sem sobrescrita destrutiva;
- nenhuma agregação converte moedas sem fonte, taxa e instante registrados;
- edição posterior invalida validação e aprovação;
- a versão legendada é o render final candidato a preview, QC e aprovação;
- fixtures e fakes são obrigatórios nos testes, mas nunca satisfazem G3;
- scheduler persiste antes de publicar e reconcilia antes de retry;
- Daily Automation e Offer & Campaign podem avançar em paralelo após E09;
- métrica indisponível permanece ausente, nunca vira zero;
- recomendação de otimização não altera regra ou conteúdo automaticamente;
- IA não publica, mata canal, muda regra financeira nem aloca capacidade;
- OpenAI/GPT entra por adapter e roteamento configurável; domínio e aplicação não
  dependem do provider nem de nomes de modelo;
- a política usa o menor modelo com qualidade suficiente e só escala quando o
  ganho esperado justifica custo e latência;
- aprovação automática permanece fora do MVP.

## Riscos residuais

- diferenças de API, escopo e revisão de aplicativo podem bloquear redes;
- geração de voz, imagem ou vídeo pode ser cara ou lenta;
- referência estratégica pode induzir cópia se linhagem e revisão forem fracas;
- licenças de mídia gerada ou encontrada variam por fornecedor;
- artefatos audiovisuais exigirão storage privado e política de retenção;
- retries mal projetados podem duplicar efeitos externos;
- métricas disponíveis não são equivalentes entre plataformas;
- identificadores e janelas de atribuição variam por oferta e plataforma;
- campanhas genéricas podem romper o vínculo causal entre conteúdo e receita;
- tratar `Attribution` efetiva como requisito de E11 recriaria dependência circular
  com E12; somente configuração futura de tracking pode ser opcional em campanha;
- condicionar E11 à conclusão de E10 pode atrasar desnecessariamente a validação
  de `Operator Revenue` após Publishing;
- otimização prematura pode reforçar ruído com pouca amostra.
- atribuição incompleta pode distorcer lucro e ROI;
- experimentos com pouca amostra podem levar a `KILL` ou `SCALE` incorretos;
- custo, latência e disponibilidade de providers podem variar.

Cada risco é tratado no tópico que introduz a capacidade; não justifica construir
antecipadamente módulos ainda fora da fase ativa.

## Definition of Ready

- problema, resultado, fora de escopo e aceite claros;
- dependência anterior mergeada;
- uma persona e uma entrega observável;
- riscos de direitos, segurança e efeitos externos avaliados;
- contratos e estratégia de teste proporcionais definidos.

## Definition of Done

- aceite demonstrado e testes pertinentes passando;
- diff restrito e sem mudança incidental;
- decisões, evidências e riscos residuais registrados;
- segredos, mídia privada, logs e runtime ausentes;
- commit, push e PR aberto;
- próximo tópico só apresentado após confirmação do merge.

## Regra de execução

Executar exatamente um tópico por branch. Antes de editar, aprovar pacote com
resultado, arquivos, fora de escopo e testes. Concluir com revisão do diff,
roadmap atualizado, commit, push e PR. O próximo tópico começa somente após o
merge do anterior.
