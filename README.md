# MKTauto

Operação Affiliate-First para um operador individual criar e administrar canais
próprios, testar nichos e formatos e transformar histórico de conteúdo,
desempenho e monetização em decisões explicáveis.

A base existente recebe projeto, nicho, tema e referências estratégicas e produz
ideia, roteiro, narração, mídia autorizada ou gerada, vídeo vertical, legendas e
preview. A prioridade é cadastrar produtos manualmente, gerar roteiros com a IA
existente, cenas/áudio pela fal.ai quando suportados e finalizar com FFmpeg.
Aprovação humana, publicação manual, custos e resultados comerciais permitem
validar 10 anúncios e buscar a primeira venda. Essas adaptações ainda são planejadas.
Publicação automática, automação diária, analytics avançado e otimização entram
em fases posteriores. Toda publicação do MVP exige aprovação humana da versão
exata.

O objetivo de longo prazo é maximizar lucro sustentável por conteúdo, canal,
nicho e capacidade utilizada — não apenas volume, views ou seguidores. Revenue
Analytics, experimentos, otimização e alocação entram incrementalmente. SaaS e
modelos próprios são possibilidades futuras e não orientam o MVP atual.

## O que já funciona

O repositório possui uma aplicação local de pesquisa de tendências:

- catálogo diário e histórico SQLite;
- adapters oficiais para YouTube, Instagram, Threads e TikTok;
- cobertura parcial e bloqueios explícitos, sem scraping;
- agrupamento estruturado com Ollama local;
- ranking, diversidade, estados e idempotência determinísticos;
- exportação JSON, CSV e HTML;
- shortlist e seleção humana sem download de mídia.
- configuração local de projetos/canais com snapshots versionados e exportação
  sanitizada.

Esses componentes formam o início do módulo `Research`. Os adapters atuais não
publicam conteúdo.

## Executar

Requer Node.js 24 ou superior.

```powershell
npm test
npm start
```

`npm test` compila o backend e executa somente as suítes JavaScript em
`test/*.test.js` no runner Node. Para executar todas as suítes suportadas,
use `npm run test:all`: Node, testes unitários NestJS, E2E NestJS e testes
Python do alinhador (requer Python). As suítes NestJS usam Vitest e também
podem ser executadas com `npm --prefix backend test` e
`npm --prefix backend run test:e2e`. Os testes Python usam
`npm run test:python`. O smoke CTC com modelo real permanece opt-in;
os testes comuns não baixam modelos nem executam APIs pagas.

A aplicação local fica em `http://localhost:3000`. Sem chaves, use a rodada de
demonstração. Para dados atuais, mantenha o Ollama ativo e configure somente as
credenciais oficiais necessárias no arquivo `.env`, que não entra no Git.

### Radar diário

```powershell
npm run trend:daily -- --input .\research-input.json
npm run trend:export -- --research-run research-daily:ID
node --env-file-if-exists=.env src/trend-cli.js shortlist --date 2026-09-27 --candidate youtube:ID --actor operador
node --env-file-if-exists=.env src/trend-cli.js select --date 2026-09-27 --candidate youtube:ID --actor operador
```

O comando diário exige o `ResearchInput` imutável produzido pelo handoff do
projeto. Data, timezone, nicho, público, idioma e redes vêm desse snapshot; as
regiões de pesquisa continuam na configuração operacional `TREND_REGIONS`. A
saída informa o ID `research-daily:*` necessário para reexportação. Os comandos
legados de shortlist e seleção por data não atuam sobre artefatos de Research.

Referências encontradas não concedem direitos e não são baixadas. Instagram,
Threads e TikTok só são consultados quando tokens, escopos e aprovações oficiais
compatíveis estiverem configurados. Falta de acesso aparece como cobertura
parcial ou bloqueada.

### Projetos e canais

A interface local usa somente JSON determinístico. Os comandos mutáveis recebem
um arquivo contendo o comando completo validado pelo serviço de aplicação:

```powershell
npm run project -- create --input .\project-create.json --database .\data\mktauto.sqlite
npm run project -- version --input .\project-version.json --database .\data\mktauto.sqlite
npm run project -- archive --input .\project-archive.json --database .\data\mktauto.sqlite
```

Os arquivos de criação e nova versão contêm `idempotencyKey`, `actor`,
`occurredAt` e `project`. Nova versão também exige `expectedVersion`;
arquivamento recebe os três metadados, `projectId` e `expectedVersion`. O instante
deve estar em ISO 8601 e cada efeito lógico deve ter uma chave idempotente.

Consultas, revisão, seleção em memória e exportação não criam versões nem
registram comandos:

```powershell
npm run project -- latest --project-id project_curiosidades_ia
npm run project -- get --project-id project_curiosidades_ia --version 1
npm run project -- review --project-id project_curiosidades_ia --version 1
npm run project -- select --project-id project_curiosidades_ia --version 1
npm run project -- export --project-id project_curiosidades_ia --version 1 --output .\project.json
```

`--database` é opcional nas consultas e usa `data/mktauto.sqlite` por padrão. A
exportação contém somente o `ProjectSnapshot` normalizado. Falhas retornam código
de saída `1` e JSON em `stderr` com `code`, `field` e mensagem acionável, sem
stack trace ou detalhes internos.

### Preview local

Com um projeto versionado, uma seleção humana persistida e a respectiva
`PipelineRun`, execute o pipeline real com:

```powershell
npm run preview -- --project-id project_curiosidades_ia --project-version 1 --selection-id selection_ID
```

O banco usa `PREVIEW_DATABASE` do `.env` ou `data/mktauto.sqlite`; `--database`
pode sobrescrever esse valor. O `.env` também deve conter a configuração real da
OpenAI e do FFmpeg descrita em `.env.example`, com os roots de voz e mídia do
provider iguais aos roots usados pelo FFmpeg. Os direitos comerciais de voz e
imagem precisam estar explicitamente confirmados.

O comando infere o run ID da seleção, revalida projeto e versão e informa
`NEW`, `RESUMED` ou `REUSED_TERMINAL`. Progresso resumido é emitido em JSON Lines
no `stderr`; o resultado final em `stdout` contém status, run ID, `VideoRender`
ID, SHA-256, referência lógica e o path físico validado do MP4. Esse path existe
somente na saída local do processo: contratos e persistência continuam usando a
referência lógica. Falhas públicas não incluem credenciais, payloads, paths
privados ou stack traces.

## Arquitetura e planejamento

- `docs/CONTENT_AUTOMATION_MVP_PROJECT.md`: visão, domínio, módulos, interfaces,
  estrutura futura, fases, segurança e riscos;
- `docs/MODULAR_VIDEO_PIPELINE.md`: artefatos, etapas, estados, validação,
  publicação idempotente e observabilidade;
- `docs/TOPIC_ROADMAP.md`: prioridades Affiliate-First, backlog anterior, gates e
  tópicos incrementais;
- `docs/PROJECT_WORKFLOW.md`: processo de análise, aprovação e entrega;
- `AGENTS.md`: regras obrigatórias do repositório.

## Estado e próximo tópico

A auditoria P0 encontrou produção de preview, FFmpeg, legendas, custos parciais,
QC e aprovação humana no checkout, além de projetos e pesquisa. Não certificou
operação LIVE. Produto/campanha, fal.ai e resultados comerciais são lacunas.
A ordem vigente está em `docs/TOPIC_ROADMAP.md`; P1 depende de aprovação e task
do Planner. P0.1 altera somente governança/documentação, sem implementar P1.
