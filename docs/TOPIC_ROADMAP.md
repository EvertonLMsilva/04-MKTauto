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
| PC03 | PR ABERTO | Serviço de aplicação idempotente de Project/Channel | Comandos explícitos, registro atômico, retries reproduzíveis e snapshots históricos; 117 testes passaram. |

Os antigos R03–R09 foram planejados para um fluxo centrado em mídia-fonte. V06
os **replaneja**, sem apagar suas decisões: transcrição de mídia-fonte, cortes,
react, publicação Instagram e painel serão retomados pelos épicos correspondentes
quando suas dependências voltarem a ser prioritárias.

V06 foi validado com a suíte completa de 87 testes, `git diff --check` e revisão
do diff restrito a `README.md` e aos três documentos arquiteturais equivalentes.
O PR #24 foi aberto em 27/09/2026. Os arquivos locais não rastreados em `data/`
foram preservados e não integram a entrega.

## Corte aprovado em V06

O primeiro MVP recebe configuração de projeto, nicho, tema e referências
estratégicas e produz ideia, roteiro, narração, mídia autorizada ou gerada, vídeo
vertical, legendas, metadados e preview. Não há publicação automática no MVP 1.

Defaults:

- persona única: operador individual de um portfólio de canais temáticos;
- um projeto e um conteúdo por execução;
- conteúdo original, sem copiar referências;
- formato inicial de vídeo curto vertical `9:16`;
- APIs oficiais e cobertura parcial explícita;
- aprovação humana da versão exata antes de efeitos externos;
- mídia privada, tokens e runtime fora do Git;
- interfaces de provider introduzidas somente quando consumidas pelo tópico;
- exportação manual preservada como fallback.

## Épicos

| Épico | Capacidade | Resultado mínimo | Dependência principal |
|---|---|---|---|
| E01 | Project Configuration | Projeto versionado produz `ProjectSnapshot` válido. | V06 |
| E02 | Research & Reference Analysis | Temas e padrões estratégicos rastreáveis alimentam ideias. | E01 + radar atual |
| E03 | Content Intelligence | Ideias originais recebem score explicável e seleção humana. | E02 |
| E04 | Script & Metadata | Ideia aprovada vira roteiro e metadados versionados. | E03 |
| E05 | Voice Generation | Roteiro vira faixa de voz com direitos e hash. | E04 |
| E06 | Media Pipeline | Necessidades visuais recebem ativos autorizados ou gerados. | E04 |
| E07 | Video Composer & Subtitles | Voz e mídia formam preview vertical legendado. | E05 + E06 |
| E08 | Quality Control & Approval | Versão validada recebe aprovação humana sobre hash exato. | E07 |
| E09 | Social Publishing | Um adapter oficial publica sem duplicação e com fallback. | E08 + gate da rede |
| E10 | Scheduler & Daily Automation | Jobs persistidos executam agenda configurável com retry. | E09 |
| E11 | Analytics | Snapshots opcionais reconciliam métricas oficiais. | E09 |
| E12 | Optimization Engine | Regras explicáveis recomendam melhorias com base no histórico. | E11 + volume mínimo |

MVP 1 termina em E08 com preview aprovado, embora E08 não publique. MVP 2 adiciona
E09 e a fatia necessária de E10, uma rede por vez. MVP 3 completa automação diária;
MVP 4 entrega E11; MVP 5 entrega E12.

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

### PC05 — handoff para o pipeline

- vincular uma execução ao `ProjectSnapshot` selecionado;
- registrar `project_id` e versão nos artefatos seguintes;
- não implementar Research ou geração.

Aceite: um stub consumidor recebe snapshot válido e rastreável; edição posterior
do projeto não altera a execução já iniciada.

PC02 só começa após o merge de PC01, e assim sucessivamente. A divisão pode ser
reduzida se a análise de Ready demonstrar que duas fatias não entregam valor
isolado, mas nenhum tópico pode antecipar outro épico.

## Ordem após E01

1. adaptar o radar atual para consumir `ProjectSnapshot`, sem reescrever adapters;
2. separar análise de referência de coleta de tendência;
3. implementar ideias e scoring antes de roteiro;
4. provar uma porta de voz e uma de mídia antes do composer;
5. encerrar MVP 1 com preview, QC e aprovação humana;
6. validar um publisher oficial por vez, começando pelo acesso realmente elegível;
7. adicionar agenda, analytics e otimização somente após o efeito anterior estar
   estável e medido.

## Gates

| Gate | Condição para avançar |
|---|---|
| G1 — configuração | Snapshot representa a estratégia sem segredo e é reproduzível. |
| G2 — originalidade | Ideia e roteiro não reproduzem material de referência. |
| G3 — produção | Preview vertical passa por direitos, formato e QC. |
| G4 — publicação | Conta de teste, permissões e API oficial funcionam com fallback. |
| G5 — operação pública | Direitos, privacidade, retenção, takedown e segurança são revisados. |
| G6 — otimização | Há volume e qualidade de métricas suficientes para comparação útil. |

## Fronteiras e decisões

- adapters de pesquisa social não são publishers;
- nenhuma URL de referência autoriza download ou reutilização;
- `ProjectSnapshot` é imutável dentro de uma run;
- artefatos são versionados e ligados por IDs/hashes;
- edição posterior invalida validação e aprovação;
- scheduler persiste antes de publicar e reconcilia antes de retry;
- métrica indisponível permanece ausente, nunca vira zero;
- recomendação de otimização não altera regra ou conteúdo automaticamente;
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
