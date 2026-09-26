# Roadmap de tópicos do MKTauto

## Estado atual

| ID | Estado | Entrega | Evidência/aceite |
|---|---|---|---|
| B00 | CONCLUÍDO | Governança e cadastro local | Projeto reconhecido no Codex; documentos-base presentes. |
| V00 | CONCLUÍDO | Viabilidade e primeiro corte do MVP | Hipóteses, gates e rota de parada aprovados em 24/09/2026. |
| V01 | CONCLUÍDO | Repriorização para estúdio de cortes dinâmicos | PR #5 mergeado em 24/09/2026 (`fb1fd5d`). |
| R01 | CONCLUÍDO | Fluxo real e baseline interno | PR #10 mergeado; três cortes aprovados e decisão `iterar R01` pela lacuna de tempo ativo. |
| R01A | CONCLUÍDO | Instrumento local de descoberta assistida | PR #8 mergeado em 25/09/2026 (`6706ba6`). |
| V02 | CONCLUÍDO | Repriorização para entrada por upload | PR #11 mergeado em 26/09/2026 (`b7c921e`). |
| V03 | CONCLUÍDO | Estrutura futura para vídeos de react | PR #12 mergeado em 26/09/2026 (`ab2de6d`). |
| V04 | CONCLUÍDO | Pipeline modular e multiagente | PR #13 mergeado em 26/09/2026 (`89a2135`). |
| V05 | CONCLUÍDO | Decomposição técnica do M1 | PR #14 mergeado em 26/09/2026 (`d88918b`). |
| R02A | CONCLUÍDO | M1 — contratos e critérios de tendência | PR #15 mergeado em 26/09/2026 (`b93527f`). |
| R02B | CONCLUÍDO | M1 — histórico local e deduplicação | PR #16 mergeado em 26/09/2026 (`f5fada9`). |
| R02C | CONCLUÍDO | M1 — coleta global do YouTube | PR #17 mergeado em 26/09/2026 (`bd6a0d6`). |
| R02D | CONCLUÍDO | M1 — assuntos e ranking | PR #18 mergeado em 26/09/2026 (`c63e16a`); clusters locais, score determinístico e persistência validados com 55 testes. |
| R02E | CONCLUÍDO | M1 — cobertura oficial do Instagram | PR #19 mergeado em 26/09/2026 (`9ff9657`); cobertura parcial/bloqueada, limites oficiais e adapter sanitizado validados com 62 testes. |
| R02F | CONCLUÍDO | M1 — cobertura oficial do TikTok | PR #20 mergeado em 26/09/2026 (`2928845`); Research API condicionada à elegibilidade e Display API `AUTHORIZED_ONLY`. |
| R02G | EM EXECUÇÃO | M1 — execução diária e catálogo local | Run única por data/configuração, exportação local e seleção humana em validação. |
| R03 | PENDENTE | M2 — transcrição multimodal | Depende de R02G e de arquivo local adquirido legitimamente. |
| R04 | PENDENTE | M3 — identificação de conteúdo | Depende de R03. |
| R05 | PENDENTE | M4 — edição e montagem | Depende de R04. |
| R06 | PENDENTE | M5 — refino para engajamento | Depende de R05. |
| R07 | PENDENTE | Orquestração, revisão e exportação | Depende de R06 e G2. |
| R08 | PENDENTE | Instagram: publicação e insights | Depende de R07 e G3. |
| R09 | PENDENTE | Painel, piloto e decisão | Depende de R08. |

V02 é uma repriorização documental aprovada após o merge do PR #10. Cada tópico
pode ser dividido antes da execução quando houver mais de uma entrega
independente, risco elevado ou oportunidade de entregar valor menor e
demonstrável.

## Corte aprovado do MVP

Permitir que um operador individual administre vários perfis temáticos em
`pt-BR`, descubra referências internacionais em alta, selecione uma oportunidade
e transforme mídia obtida legitimamente em um novo corte vertical autoral,
narrado, legendado, revisado e mensurável. O fluxo termina com publicação
aprovada no Instagram e painel de desempenho; exportação manual permanece como
fallback.

Defaults aprovados:

- uma persona: operador individual de um portfólio de perfis temáticos;
- vários perfis, mas um perfil e um lote processados por vez;
- radar diário internacional como entrada de M1, sem download automático;
- aquisição local posterior, com origem e condição de uso declaradas;
- transcrição local; análise visual local quando a fala não explicar o vídeo;
- um corte por entrada, com roteiro novo, narração e legendas sincronizadas;
- revisão humana da versão renderizada antes de qualquer publicação;
- Instagram como primeiro adaptador de publicação e insights;
- receita manual/importada e lucro estimado, sem promessa de monetização;
- contratos pequenos para adicionar plataformas e parceiros após o MVP;
- mídia, tokens, provas privadas e dados pessoais sempre fora do Git.

## Prioridade e entregas

| ID | Entrega mínima | Depende de | Aceite objetivo |
|---|---|---|---|
| V01 | Reposicionar visão e roadmap | V00 | Documentos coerentes com cortes dinâmicos, múltiplos perfis, Instagram inicial e extensibilidade posterior. |
| R01 | Medir o fluxo interno | V01 | Um operador executa 3 lotes reais; etapas, tempo ativo, espera, retrabalho, custo e resultado são registrados sem mídia no Git. |
| R01A | Instrumentar a descoberta | Rodada 1 de R01 | Aplicação local coleta sinais oficiais, usa IA para sugerir candidatos e calcula ranking explicável por regras testadas. |
| V02 | Reposicionar entrada do MVP | PR #10 | Documentos tornam upload único o fluxo principal e composição multivídeo um item explícito de backlog. |
| V03 | Estruturar react no backlog | V02 | Fonte e reação possuem faixas, sincronização, layouts, áudio, legendas e direitos rastreáveis. |
| V04 | Modularizar o pipeline | V03 | Cinco módulos têm entradas, saídas, agentes, regras determinísticas e ordem obrigatória documentados. |
| V05 | Decompor M1 | V04 | Radar, histórico, fontes, ranking e catálogo são tópicos ordenados com aceite próprio. |
| R02A | Definir contratos de tendência | V05 | Schemas distinguem métricas reais, ausências, cobertura e explicações. |
| R02B | Preservar histórico | R02A | Snapshots permitem calcular crescimento e reaparição sem duplicar vídeo. |
| R02C | Coletar YouTube global | R02B | API oficial produz referências curtas de regiões configuradas. |
| R02D | Descobrir assuntos e ranquear | R02C | IA agrupa evidências e regras entregam top 20/top 5 diversos. |
| R02E | Validar Instagram oficial | R02D | Adapter por hashtags funciona dentro das permissões ou registra cobertura parcial. |
| R02F | Validar TikTok oficial | R02E | Acesso elegível funciona ou bloqueio do provedor fica explícito, sem scraping. |
| R02G | Integrar radar diário | R02F | Run diária gera catálogo JSON/CSV/HTML mapeável, sem baixar mídia. |
| R03 | Provar M2 — transcrição multimodal | R02G + arquivo local legítimo | Fala, texto em tela e observações visuais formam `MediaTranscript` temporal e reproduzível. |
| R04 | Provar M3 — conteúdo | R03 | `ContentBrief` identifica tema, momentos, riscos e ângulos novos, todos ligados a evidências. |
| R05 | Provar M4 — edição/montagem | R04 | `EditPlan` gera um corte narrado e legendado, com linhagem de cada trecho e evidencia G1. |
| R06 | Provar M5 — refino | R05 | `EngagementReport` remove ruído e melhora ritmo/clareza sem perder fidelidade ou auditoria. |
| R07 | Integrar o pipeline | R06/G2 | Orquestrador executa M1→M5, registra falhas, permite revisão e exporta a versão aprovada. |
| R08 | Integrar Instagram | R07 | Conta profissional conecta; somente versão aprovada publica; estado e insights são reconciliados; exportação cobre falha externa. |
| R09 | Entregar painel e piloto | R08 | Painel cruza perfil, vídeo, formato, visualizações, interações, custo, receita e lucro estimado; piloto decide `go`, `iterate` ou `stop`. |

R02A–R02G provam M1 em fatias cumulativas; R03–R06 provam um módulo cada. R07
produz o primeiro pipeline utilizável, R08 entrega o produto conectado e R09
encerra o MVP medido. Novos canais, parceiros e otimizações não interrompem essa
sequência.

## Gates de decisão

| Gate | Condição para avançar |
|---|---|
| G0 — fluxo | O operador interno consegue fornecer e executar 3 lotes representativos com origem registrada. |
| G1 — valor criativo | Ao menos um formato dinâmico produz resultado aceitável com economia mensurável contra o baseline. |
| G2 — construção | O processo concierge comprova o fluxo e justifica aplicação própria. |
| G3 — Instagram | Conta profissional de teste, permissões e documentação oficial permitem publicar e ler insights. |
| G4 — lançamento | Direitos, políticas, privacidade, retenção, takedown e operação pública recebem revisão específica antes da publicação real. |
| G5 — expansão | Cada novo canal ou parceiro demonstra acesso oficial, valor e regras próprias antes de ganhar adaptador. |

Desenvolvimento e testes anteriores a G4 usam apenas mídia própria, licenciada
ou expressamente autorizada. A revisão jurídica formal foi adiada, não removida,
e não autoriza scraping, repostagem irregular ou publicação de material sem base
de uso registrada.

## Fronteiras de adaptadores

O domínio não dependerá diretamente da Meta, de uma rede de afiliados ou de um
provedor de IA. Os contratos entram somente quando exigidos pelo fluxo comprovado:

- `Source`: receber o arquivo enviado e preservar origem, hash e condição de uso;
- `Transcriber`: produzir fala, OCR e observações visuais temporais;
- `ContentIntelligence`: identificar conteúdo, evidências, riscos e ângulos;
- `Editor`: criar roteiro e plano de trechos sem executar efeitos externos;
- `Renderer`: compor e renderizar a versão revisável;
- `EngagementReviewer`: avaliar hook, ritmo, clareza, fidelidade e qualidade;
- `Publisher`: publicar a versão exata aprovada;
- `Insights`: coletar e reconciliar métricas;
- `Monetization`: registrar receitas e custos;
- `Partner`: consultar ofertas e produzir referências rastreáveis.

O MVP implementa Instagram para publicação e insights. Shopee é apenas um
possível adaptador futuro; outras plataformas e parceiros seguem o mesmo gate,
sem generalização antecipada.

## Painel do MVP

O painel começa com dados manuais ou CSV e evolui para insights oficiais do
Instagram em R08. Deve responder, por perfil, vídeo e formato:

- quantas visualizações e interações ocorreram;
- qual foi o custo registrado de produção e ferramentas;
- qual receita foi informada ou importada;
- qual o lucro estimado (`receita - custos`);
- quais formatos merecem continuar, iterar ou parar.

Metabase OSS é candidato para spike por ser gratuito e customizável dentro dos
limites da licença. Reuso só será escolhido se for menor que um painel nativo e
não criar custo, licença ou integração desproporcional.

## Registro de decisões

### R01 anterior — descoberta, direitos e baseline

Em 24/09/2026, o primeiro recorte registrou `stop/reposicionar` por não haver
operadores externos, lotes autorizados ou responsável jurídico demonstrados.
A decisão foi correta para aquele recorte e permanece como histórico.

### V01 — repriorização do MVP

Em 24/09/2026, o usuário esclareceu que:

- o projeto operará perfis próprios, não prestará serviço a terceiros;
- uma única pessoa poderá administrar vários perfis e nichos;
- o valor principal é buscar fontes, criar conteúdo e montar cortes dinâmicos;
- o Instagram deve estar integrado no MVP;
- desempenho, receita e lucro estimado precisam ficar visíveis;
- plataformas e parceiros futuros devem entrar por adaptadores;
- a revisão jurídica formal ocorrerá antes do lançamento público.

V01 substitui o recorte `metadados-only/export-only` de V00, preservando revisão
humana, origem, controles determinísticos, mídia fora do Git e fallback manual.

### R01 — protocolo aprovado

Em 24/09/2026, foi aprovado o protocolo sanitizado de execução em
`docs/R01_BASELINE_PROTOCOL.md`. O exercício compara as quatro famílias em três
lotes, separa tempo ativo de espera e registra custos, falhas, retrabalhos e uma
rubric definida antes da avaliação.

A pesquisa em `docs/R01_NICHE_RESEARCH.md` usa jogos, inspiração e carros de luxo
como exemplos do formato editorial, não como portfólio fixo. O método registrado
em `docs/R01_DYNAMIC_NICHE_DISCOVERY.md` deve ranquear semanalmente cinco nichos;
três candidatos elegíveis e diversos alimentam os lotes do baseline.

O usuário esclareceu que o fluxo candidato não exige gravação própria: ele deve
encontrar vídeos existentes com direito de adaptação e produzir cortes com valor
editorial substancial. Mudanças superficiais não satisfazem o produto, e direito
de uso continua sendo gate independente da transformação criativa.

Fontes agora recebem estado `verde`, `amarelo` ou `vermelho`. Somente fontes
verdes entram nos lotes; mídia oficial com termos ambíguos orienta pauta, mas não
segue para publicação até que o uso proposto esteja coberto.

Em 24/09/2026, a primeira rodada manual assistida avaliou 20 candidatos e gerou
um `top 5` provisório, registrado em `docs/R01_EXECUTION_LOG.md`. A rodada
demonstrou o instrumento, mas não comprova estabilidade. Em 25/09/2026, o
usuário esclareceu que a janela antes prevista para 01/10/2026 não pode bloquear
o avanço do MVP e autorizou a segunda execução imediata. Nenhum lote foi
iniciado, e o tempo da sessão assistida não foi tratado como tempo ativo do
operador.

G0 permanece aberto e R02 continua bloqueado. A decisão intermediária é
`iterar R01` até a segunda rodada, a confirmação de três fontes verdes e a
execução medida de L01–L03. Mídia, provas de autorização e outros dados privados
não devem ser adicionados ao repositório.

### R01A — instrumentação antecipada aprovada

Em 25/09/2026, o usuário aprovou antecipar uma aplicação local pequena porque a
repetição manual antes de qualquer instrumento não oferecia retorno suficiente.
R01A não substitui G0: usa YouTube Data API como primeiro sinal oficial, IA para
sugerir agrupamentos e regras determinísticas para validar evidência, calcular
scores, aplicar gates e limitar diversidade. A versão inicial usou OpenAI; para
a rodada 2, o usuário definiu Ollama local como provedor, sem chave externa de IA.

A fixture da rodada 1 revelou erros aritméticos no registro manual e foi usada
para corrigir scores sem trocar componentes ou pesos. Execuções ao vivo continuam
dependentes da chave local do YouTube não commitada e do Ollama ativo; vídeo
popular não recebe estado verde automaticamente.

O PR #8 foi mergeado em 25/09/2026 (`6706ba6`). A aplicação local, os nove
testes, a fixture, a revisão humana e os adaptadores iniciais encerraram R01A.
A troca para Ollama local integra a execução da rodada 2 de R01. A execução ao
vivo permanece uma validação de R01 e não libera G0 nem R02.

Em 25/09/2026, a rodada 2 antecipada coletou 49 sinais oficiais e produziu 20
candidatos únicos com duas evidências cada. O ranking provisório foi diverso,
mas somente motos utilitárias permaneceu comparável ao top 5 da rodada 1. A
revisão humana aprovou quatro itens e rejeitou um. Três fontes reutilizáveis do
Wikimedia Commons foram confirmadas. Após recorte explícito do usuário, L01–L03
produziram um corte narrado e legendado por nicho, três saídas locais medidas.
As três versões exatas foram aprovadas pelo usuário em 25/09/2026. G0 permanece
aberto somente pela lacuna de tempo ativo; a decisão segue `iterar R01`, sem
bloqueio de calendário.

### V02 — entrada por upload e backlog multivídeo

Em 26/09/2026, o usuário definiu upload manual como entrada principal do MVP.
Para cada vídeo, o sistema deve extrair/transcrever o áudio localmente, recorrer
a análise visual local quando a fala não bastar, criar abordagem e roteiro novos
com o Ollama, selecionar trechos somente do arquivo enviado e produzir um corte
com narração nova e legendas sincronizadas. A versão exata continua sujeita a
aprovação humana.

A composição de um único vídeo a partir de vários uploads do mesmo assunto foi
adicionada ao backlog pós-MVP. Essa evolução deverá validar direitos e hash de
cada entrada, preservar a origem por trecho e impedir que um arquivo rejeitado
participe da montagem.

### V03 — estrutura futura para vídeos de react

Em 26/09/2026, vídeos de react foram adicionados ao backlog pós-MVP. O formato
terá dois ativos independentes: o vídeo-fonte e uma faixa de reação/comentário
fornecida pelo operador. Ambos exigem origem, hash, condição de uso, transcrição
e aprovação próprias.

A timeline deverá alternar eventos de fonte e reação sem perder sincronização,
com layouts `fonte em tela cheia`, `reação em tela cheia`, `picture-in-picture`
e `dividido`. O mixer deverá aplicar prioridade da fala e redução controlada do
áudio-fonte; as legendas identificarão o locutor. Cada trecho renderizado deverá
preservar referência ao ativo e intervalo de origem.

React não cria autorização automática sobre o vídeo-fonte. Direitos, contexto,
atribuição, segurança e aprovação humana da versão exata continuam gates.

### V04 — pipeline modular e multiagente

Em 26/09/2026, o usuário definiu cinco processos obrigatoriamente sequenciais:
identificação de vídeos, transcrição multimodal, identificação de conteúdo,
edição/montagem e refino para engajamento. A especificação e os contratos estão
em `docs/MODULAR_VIDEO_PIPELINE.md`.

Ollama e agentes especializados podem acelerar tarefas independentes dentro de
cada módulo. Um orquestrador determinístico controla a ordem, schemas, evidências,
estados, custos e falhas. Direitos não são decididos por IA, módulos não podem ser
pulados e somente a versão exata aprovada pode avançar para efeito externo.

### V05 — decomposição técnica do M1

Após o merge do PR #13, o usuário esclareceu que M1 deve descobrir vídeos em alta
e não receber uploads. O plano em `docs/M1_VIDEO_IDENTIFICATION_PLAN.md` separa
contratos, histórico, YouTube, ranking, Instagram, TikTok e catálogo diário em
R02A–R02G. A coleta usa somente APIs oficiais, registra cobertura parcial e não
baixa mídia. R03 depende do catálogo completo e de um arquivo local obtido
legitimamente após a seleção.

### R02A — contratos e critérios do radar M1

O contrato `trend-contracts/1.0.0` define runs, fontes, candidatos, snapshots,
assuntos e scores com validadores determinísticos em `src/domain/contracts.js`.
Métricas ausentes usam `UNAVAILABLE`, identidade prioriza plataforma + ID e o
fallback por URL valida o host oficial. `trend-ranking/1.0.0` fixa 20 candidatos,
top 5, duração de 15–180 segundos, regiões iniciais e diversidade configurável.

Evidência: os testes focados em `test/radar-contracts.test.js` e
`test/radar-ranking.test.js` cobrem as três plataformas, lacunas de cobertura,
reaparição, códigos de erro, proteção de evidência/score contra mutação por IA e
serialização pública sanitizada. A suíte completa passou com 25 testes antes da
abertura do PR #15.

O PR #15 foi mergeado em 26/09/2026 (`b93527f`) e desbloqueou R02B.

### R02B — histórico local e deduplicação do radar M1

O catálogo local usa `node:sqlite` e uma migração v1 reproduzível para preservar
runs, fontes, candidatos, snapshots, clusters e scores. Operações possuem chave
idempotente explícita e são atômicas; IDs de plataforma têm precedência, enquanto
URLs canônicas válidas deduplicam candidatos sem ID. Reaparições mantêm a mesma
identidade, acrescentam snapshots imutáveis e registram motivo e posição.

Evidência: `test/trend-store.test.js` cobre migração e reabertura, retry,
deduplicação, promoção de identidade, histórico e velocidade, cobertura parcial,
bloqueada ou falha, imutabilidade, rollback, chaves estrangeiras e versão futura.
Os 13 testes focados e a suíte completa com 38 testes passaram antes da abertura
do PR #16.

O PR #16 foi mergeado em 26/09/2026 (`f5fada9`) e desbloqueou R02C.

### R02C — coleta global oficial do YouTube

O adapter do radar consulta `videos.list` com `chart=mostPopular` nas regiões
versionadas, solicita `snippet`, `contentDetails` e `statistics`, pagina dentro de
limites explícitos e aceita somente durações ISO 8601 entre 15 e 180 segundos.
Os resultados usam identidade `YOUTUBE + platformVideoId`, URL canônica oficial,
métricas ausentes como `UNAVAILABLE` e persistência idempotente no catálogo v1.

O `SourceRun` registra cobertura regional, páginas, tentativas, custo de quota
conhecido, limitações e códigos sanitizados. Falhas são isoladas por região e
produzem `SUCCESS`, `PARTIAL`, `BLOCKED_BY_PROVIDER` ou `FAILED` sem persistir
chave, payload bruto ou cabeçalhos. Retry com a mesma chave retorna a operação
existente sem nova chamada ao provedor.

Evidência determinística: `test/youtube-radar.test.js` cobre as oito regiões,
parâmetros oficiais, paginação, limites inclusivos, normalização, métricas
ausentes, deduplicação, reaparição, retry e estados de falha. A validação real
controlada não foi executada porque `YOUTUBE_API_KEY` não estava disponível no
ambiente; nenhuma quota foi consumida e nenhuma credencial foi criada. Os 25
testes focados e a suíte completa com 48 testes passaram em 26/09/2026.

O PR #17 foi aberto em 26/09/2026 com diff restrito ao adapter, consulta
idempotente do catálogo, testes e este roadmap.

O PR #17 foi mergeado em 26/09/2026 (`bd6a0d6`) e desbloqueou R02D.

### R02D — assuntos e ranking determinístico

O adapter local do Ollama recebe somente evidências sanitizadas já persistidas e
propõe rótulo, nicho, subtema, público provável, padrão narrativo e localização
para `pt-BR`. O schema de saída não aceita IDs próprios, URLs, métricas, direitos,
estados, scores ou posições. Candidatos e snapshots são validados contra o
catálogo, inclusive o vínculo de cada snapshot aos candidatos do cluster.

Título e categoria públicos do YouTube passam a ser preservados como campos
opcionais do contrato existente; payload bruto continua descartado. A análise é
anexada atomicamente à run coletada por chave idempotente, sem duplicar candidato
ou snapshot e sem repetir a chamada ao modelo em retry concluído.

`trend-score/1.0.0` calcula por regra fixa velocidade cronológica, engajamento
somente com interações e visualizações disponíveis, recência com relógio
injetável e recorrência observada entre vídeos, regiões e plataformas. Componentes
sem base permanecem `UNAVAILABLE`; a confiança é a soma dos pesos disponíveis e
o score repondera somente esses componentes. O desempate usa score, confiança,
publicação e ID. A seleção aplica limites por plataforma, região e assunto; quando
a cobertura disponível não permite completar a lista, relaxa os limites de modo
determinístico e registra a lacuna, sem eliminar o YouTube por ausência das redes
futuras nem criar candidatos artificiais.

Evidência reproduzível: `test/trend-analysis.test.js`, `test/ollama.test.js`,
`test/radar-contracts.test.js`, `test/radar-ranking.test.js`,
`test/trend-store.test.js` e `test/youtube-radar.test.js` cobrem validação da IA,
componentes ausentes, zero oficial, regressão de contador, ranking top 20/top 5,
desempate, diversidade, persistência atômica e retry. A suíte completa passou com
55 testes em 26/09/2026. O Ollama local respondeu e possuía um modelo instalado,
mas a validação real controlada não foi executada porque `OLLAMA_MODEL` não estava
configurado; nenhum modelo foi escolhido implicitamente e nenhuma evidência real
foi persistida.

O PR #18 foi aberto em 26/09/2026 com diff restrito ao agrupamento semântico,
ranking determinístico, persistência da análise, normalização mínima do YouTube,
testes e este roadmap.

O PR #18 foi mergeado em 26/09/2026 (`c63e16a`) e desbloqueou R02E.

### R02E — cobertura oficial do Instagram

A revalidação oficial confirmou busca de mídia pública associada a hashtags no
Instagram API with Facebook Login para contas profissionais elegíveis, sem
equivalente a ranking global ou filtro regional. Hashtags são derivadas somente
dos clusters persistidos de R02D. Conta autorizada, mídia pública por hashtag e
insights próprios permanecem capacidades semanticamente separadas.

O adapter limita termos e páginas, usa token somente em `Authorization`, isola
falhas por hashtag, sanitiza autenticação, permissão/revisão e quota, e persiste
retry atomicamente sem repetir chamadas. A API de hashtags não expõe duração;
por isso a mídia pública encontrada não pode satisfazer o gate de 15–180 segundos
do contrato 1.0.0 e não entra no ranking. A cobertura correta é `PARTIAL` com
lacuna explícita, enquanto ausência de conta, Página, permissões, revisão, token
ou versão elegível gera `BLOCKED_BY_PROVIDER` antes de qualquer chamada.

A matriz, a condição de desbloqueio e as fontes oficiais estão em
`docs/INSTAGRAM_OFFICIAL_COVERAGE.md`. Nenhuma credencial elegível estava
configurada; não houve validação externa nem persistência de evidência real.

O PR #19 foi aberto em 26/09/2026 com diff restrito ao adapter oficial de
hashtags, testes, matriz de capacidades e este roadmap. A suíte completa passou
com 62 testes.

O PR #19 foi mergeado em 26/09/2026 (`9ff9657`) e desbloqueou R02F.

### R02F — cobertura oficial do TikTok

A revalidação oficial separou três produtos. A Display API lista somente vídeos
públicos da conta que autorizou o aplicativo e é `AUTHORIZED_ONLY`; a Content
Posting API publica na conta autorizada e não é descoberta; a Research API é a
única capacidade oficial confirmada para consultar conteúdo público por termo,
hashtag e região. Seu acesso, porém, é restrito a projetos de pesquisa elegíveis,
aprovados e não comerciais. Criadores, anunciantes e usuários comerciais não são
elegíveis, de modo que a persona principal do MVP permanece
`BLOCKED_BY_PROVIDER`.

O adapter implementa o caminho Research API atrás de gates explícitos de
organização, finalidade, revisão ética, projeto, scope e token. Consultas usam
somente termos derivados deterministicamente dos clusters R02D, têm janela,
paginação e limites locais, isolam falhas e normalizam somente campos oficiais.
Vídeos válidos de 15–180 segundos entram no catálogo e no ranking existente;
Display API nunca cria candidato de tendência. Retry usa a operação persistida e
não repete chamadas nem duplica evidências.

A matriz, as quotas, a defasagem dos dados, os códigos sanitizados e a condição
exata de desbloqueio estão em `docs/TIKTOK_OFFICIAL_COVERAGE.md`. Nenhuma
credencial ou aprovação elegível foi fornecida; portanto, não houve validação
externa nem persistência de evidência real.

O PR #20 foi aberto em 26/09/2026 com diff restrito ao adapter oficial do
TikTok, evolução aditiva do contrato de cobertura, testes, matriz de capacidades
e este roadmap. A suíte completa passou com 69 testes.

O PR #20 foi mergeado em 26/09/2026 (`2928845`) e desbloqueou R02G.

### R02G — execução diária e catálogo local

O orquestrador recebe data lógica e timezone explícitos e cria no máximo uma
run por data. Um hash somente da configuração pública rejeita mudança material
sem persistir tokens. Etapas têm chaves estáveis e resultados normalizados no
SQLite; por isso, retry recupera coleta e análise concluídas sem repetir chamadas
nem duplicar candidatos, snapshots, clusters ou scores.

YouTube forma a evidência inicial. Clustering local, quando configurado, deriva
consultas oficiais para Instagram e TikTok; depois, todas as observações válidas
são consolidadas e ranqueadas novamente. Falha ou bloqueio isolável preserva as
outras fontes e produz `COMPLETED_WITH_GAPS`. Sem Ollama, o sistema registra a
lacuna e não inventa termos, clusters ou scores. Adapters sem configuração
mínima não são chamados. Nenhuma validação externa foi executada porque não
foram fornecidas credenciais e elegibilidades explícitas.

A migração aditiva `002_daily_catalog` registra runs, etapas e eventos humanos.
Shortlist e seleção exigem comando explícito; a seleção anterior é rebaixada
atomicamente para manter no máximo um `SELECTED`. Somente candidatos ranqueados
podem avançar, e o evento auditável não altera score, evidência ou condição de
uso.

O exportador publica por troca de diretório `catalog.json`, `ranking.csv` UTF-8
com proteção contra formula injection, `report.html` autocontido/escapado e um
`candidate.json` por candidato. A allowlist pública exclui credenciais, headers,
payloads e cursores. Os comandos manuais estão no `README.md`; não há instalação
automática de agendador nem criação de mídia.

Os 75 testes da suíte passaram. Testes focados cobrem unicidade/configuração,
retry, preservação do YouTube,
bloqueios sem chamada, ranking consolidado, sanitização, CSV/HTML, publicação
atômica e transições auditáveis. Riscos residuais: APIs continuam dependentes de
credenciais/eligibilidade reais; clustering depende do Ollama; e a troca de
diretório pressupõe que banco e saída estejam no mesmo host local.

## Backlog pós-MVP aprovado

| ID | Capacidade | Dependência | Aceite futuro |
|---|---|---|---|
| P01 | Composição multivídeo por assunto | R09 e G4 | Vários uploads aprovados formam um vídeo novo com origem por trecho. |
| P02 | Vídeo de react | R09, G4 e captura de reação | Fonte e reação sincronizadas geram uma versão revisável com layouts, áudio e legendas por locutor. |

## Riscos residuais

- Busca não implica licença de uso; cada fonte precisa manter origem e condição
  declarada antes de processamento ou publicação.
- Acesso, permissões e métricas do Instagram podem mudar e serão revalidados em
  R08 somente em conta profissional de teste.
- Receita pode vir de fontes que o Instagram não expõe; o MVP aceita entrada
  manual/CSV antes de novos adaptadores.
- Conteúdo dinâmico pode não gerar audiência ou lucro; R09 mede, não promete.
- Transcrição e visão local podem inviabilizar custo ou latência; R03 mede antes
  da identificação de conteúdo. R05 mede roteiro, voz, legenda e renderização;
  R06 mede o custo adicional do refino.
- Metabase OSS tem obrigações e limites de customização; R09 pode preferir painel
  nativo pequeno.
- Publicação real permanece bloqueada por G4, mesmo que a integração técnica já
  funcione em ambiente de teste.

## Evidências externas atuais

Consultadas em 24/09/2026 e sujeitas a revalidação no tópico correspondente:

- [Instagram API — coleção oficial da Meta](https://www.postman.com/meta/instagram/collection/6yqw8pt/instagram-api): conexão de contas profissionais, publicação e insights.
- [Metabase embedding](https://www.metabase.com/docs/latest/embedding) e [licença](https://www.metabase.com/license): opção OSS para dashboard, com limites de incorporação e customização.
- [Lei 9.610/1998](https://www.planalto.gov.br/ccivil_03/leis/l9610.htm): reprodução, adaptação, citação e pequenos trechos exigem análise do caso e origem registrada.

## Regra de execução

Cada tópico começa em análise no Chat, tem pacote curto aprovado, altera somente
o necessário e termina com aceite demonstrado, testes pertinentes, diff restrito,
roadmap atualizado, commit, push e PR. O próximo tópico começa apenas após o merge.
