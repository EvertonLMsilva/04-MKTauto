# MKTauto

Plataforma modular para um operador individual configurar canais temáticos e
criar, revisar, publicar e melhorar conteúdo original para redes sociais.

O primeiro MVP recebe projeto, nicho, tema e referências estratégicas e produz
ideia, roteiro, narração, mídia autorizada ou gerada, vídeo vertical, legendas,
metadados e preview. Publicação, automação diária, analytics e otimização entram
em fases posteriores. Toda publicação do MVP exige aprovação humana da versão
exata.

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

A aplicação local fica em `http://localhost:3000`. Sem chaves, use a rodada de
demonstração. Para dados atuais, mantenha o Ollama ativo e configure somente as
credenciais oficiais necessárias no arquivo `.env`, que não entra no Git.

### Radar diário

```powershell
npm run trend:daily -- --date 2026-09-27 --timezone America/Sao_Paulo
npm run trend:export -- --date 2026-09-27
node --env-file-if-exists=.env src/trend-cli.js shortlist --date 2026-09-27 --candidate youtube:ID --actor operador
node --env-file-if-exists=.env src/trend-cli.js select --date 2026-09-27 --candidate youtube:ID --actor operador
```

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

## Arquitetura e planejamento

- `docs/CONTENT_AUTOMATION_MVP_PROJECT.md`: visão, domínio, módulos, interfaces,
  estrutura futura, fases, segurança e riscos;
- `docs/MODULAR_VIDEO_PIPELINE.md`: artefatos, etapas, estados, validação,
  publicação idempotente e observabilidade;
- `docs/TOPIC_ROADMAP.md`: histórico, épicos, gates e tópicos pequenos do E01;
- `docs/PROJECT_WORKFLOW.md`: processo de análise, aprovação e entrega;
- `AGENTS.md`: regras obrigatórias do repositório.

## Próximo tópico

O épico E01 está em execução sequencial. O roadmap registra o tópico atual e o
próximo passo desbloqueado somente após seu merge.
