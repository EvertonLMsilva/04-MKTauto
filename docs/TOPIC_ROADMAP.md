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
| V07 | EM EXECUÇÃO | Estratégia documental Portfolio-First | Visão, pipeline e roadmap em atualização; sem alteração de código. |

Os antigos R03–R09 foram planejados para um fluxo centrado em mídia-fonte. V06
os **replaneja**, sem apagar suas decisões: transcrição de mídia-fonte, cortes,
react, publicação Instagram e painel serão retomados pelos épicos correspondentes
quando suas dependências voltarem a ser prioritárias.

V06 foi validado com a suíte completa de 87 testes, `git diff --check` e revisão
do diff restrito a `README.md` e aos três documentos arquiteturais equivalentes.
O PR #24 foi aberto em 27/09/2026. Os arquivos locais não rastreados em `data/`
foram preservados e não integram a entrega.

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
| E11 | Analytics | Snapshots opcionais reconciliam métricas oficiais. | E09 |
| E12 | Optimization Engine | Regras explicáveis recomendam melhorias com base no histórico. | E11 + volume mínimo |
| E13 | Revenue Analytics | Receita, custo, lucro e ROI possuem histórico atribuível. | E11 + FND |
| E14 | Portfolio Experiments | Hipóteses recebem avaliação `KILL`, `CONTINUE` ou `SCALE`. | E13 + política aprovada |
| E15 | Portfolio Allocation | Capacidade recebe recomendação explicável de distribuição. | E12 + E14 |

Ordem dos produtos: MVP 1 Content Machine; MVP 2 Publishing; MVP 3 Daily
Automation; MVP 4 Analytics; MVP 5 Revenue Analytics; MVP 6 Portfolio
Experiments; MVP 7 Optimization Engine; MVP 8 Portfolio Allocation. O MVP 1
termina em E08 com preview aprovado e inclui as fundações FND conforme forem
consumidas. Modelos próprios/infraestrutura de IA e plataforma comercial/SaaS
permanecem futuros.

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
estáveis e testes. Este é o **próximo tópico técnico recomendado**, somente após
o merge de V07.

### FND02 — linhagem comum de artefatos

- ligar artefatos versionados a run, projeto, conteúdo, entradas e hashes;
- prever provider, modelo, versão de prompt e configuração sanitizada quando IA
  for usada;
- não armazenar segredo, prompt privado ou mídia no Git.

### FND03 — eventos de custo e CostLedger

- registrar eventos append-only por run, conteúdo e projeto;
- distinguir custos de IA, mídia, voz, produção e publicação;
- manter moeda, instante, origem e regra de atribuição explícitos;
- não criar receita, ROI, orçamento ou decisão automática.

Revenue Analytics e regras de experimento permanecem nos épicos E13 e E14. Esta
fundação não antecipa limiares financeiros nem entidades de SaaS.

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

## Ordem após E01

1. adaptar o radar atual para consumir `ProjectSnapshot`, sem reescrever adapters;
2. separar análise de referência de coleta de tendência;
3. persistir `PipelineRun` e completar linhagem/custos conforme os primeiros
   artefatos consumidores surgirem;
4. implementar ideias e scoring antes de roteiro;
5. provar a porta OpenAI e uma porta de mídia antes do composer;
6. encerrar MVP 1 com preview, QC e aprovação humana;
7. validar um publisher oficial por vez, começando pelo acesso realmente elegível;
8. adicionar agenda, analytics, Revenue Analytics e experimentos somente após o
   efeito anterior estar estável e medido;
9. otimizar e recomendar alocação apenas com histórico suficiente.

## Gates

| Gate | Condição para avançar |
|---|---|
| G1 — configuração | Snapshot representa a estratégia sem segredo e é reproduzível. |
| G2 — originalidade | Ideia e roteiro não reproduzem material de referência. |
| G3 — produção | Preview vertical passa por direitos, formato e QC. |
| G4 — publicação | Conta de teste, permissões e API oficial funcionam com fallback. |
| G5 — operação pública | Direitos, privacidade, retenção, takedown e segurança são revisados. |
| G6 — otimização | Há volume e qualidade de métricas suficientes para comparação útil. |
| G7 — economia | Custos e receitas possuem origem, moeda, janela e atribuição reproduzíveis. |
| G8 — escala | Política versionada, amostra suficiente e validação humana sustentam a recomendação. |

## Fronteiras e decisões

- adapters de pesquisa social não são publishers;
- nenhuma URL de referência autoriza download ou reutilização;
- `ProjectSnapshot` é imutável dentro de uma run;
- `PipelineRun` permanece a unidade técnica; portfólio é contexto econômico;
- artefatos são versionados e ligados por IDs/hashes;
- custos, receitas, métricas e decisões são históricos append-only;
- nenhuma agregação converte moedas sem fonte, taxa e instante registrados;
- edição posterior invalida validação e aprovação;
- scheduler persiste antes de publicar e reconcilia antes de retry;
- métrica indisponível permanece ausente, nunca vira zero;
- recomendação de otimização não altera regra ou conteúdo automaticamente;
- IA não publica, mata canal, muda regra financeira nem aloca capacidade;
- OpenAI/GPT entra por adapter; domínio e aplicação não dependem do provider;
- aprovação automática permanece fora do MVP.

## Riscos residuais

- diferenças de API, escopo e revisão de aplicativo podem bloquear redes;
- geração de voz, imagem ou vídeo pode ser cara ou lenta;
- referência estratégica pode induzir cópia se linhagem e revisão forem fracas;
- licenças de mídia gerada ou encontrada variam por fornecedor;
- artefatos audiovisuais exigirão storage privado e política de retenção;
- retries mal projetados podem duplicar efeitos externos;
- métricas disponíveis não são equivalentes entre plataformas;
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
