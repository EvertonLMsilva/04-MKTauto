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
| V09 | PR ABERTO | Estratégia documental Operator Revenue | PR #44 aberto; visão, cadeia comercial e roadmap atualizados sem alteração de código ou contratos existentes. |

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
documentos previstos. O PR #44 foi aberto em 28/09/2026. Os arquivos locais não
rastreados em `data/` foram preservados e não integram a entrega.

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
`script-generation-prompt/1.0.0`, timeout e cancelamento. Credencial e modelo
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
5. provar a porta OpenAI e uma porta de mídia antes do composer;
6. encerrar MVP 1 com preview, QC e aprovação humana;
7. validar um publisher oficial por vez, começando pelo acesso realmente elegível;
8. após E09, evoluir E10 Daily Automation e E11 Offer & Campaign em paralelo;
   oferta e campanha vinculam projeto/canal, oferta, conteúdo/artefato e CTA
   comercial, sem exigir `Attribution` efetiva;
9. criar atribuição efetiva e registrar tráfego em E12 antes de conversão, e
   conversão antes de receita em ledger próprio;
10. construir analytics comercial e experimentos somente sobre essa cadeia de
    evidência;
11. otimizar e recomendar alocação apenas com histórico suficiente.

## Gates

| Gate | Condição para avançar |
|---|---|
| G1 — configuração | Snapshot representa a estratégia sem segredo e é reproduzível. |
| G2 — originalidade | Ideia e roteiro não reproduzem material de referência. |
| G3 — produção | Preview vertical passa por direitos, formato e QC. |
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
