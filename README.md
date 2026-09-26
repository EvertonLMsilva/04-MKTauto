# MKTauto — estúdio de cortes dinâmicos

Repositório de planejamento de um sistema para um operador administrar vários
perfis temáticos, descobrir vídeos em alta, selecionar uma oportunidade e
produzir um novo corte vertical com roteiro, narração e legendas a partir de
mídia obtida legitimamente.

O projeto possui uma primeira aplicação local de descoberta assistida. Ela usa a
rodada 1 como demonstração e, quando configurada, combina sinais da YouTube Data
API com sugestões estruturadas do Ollama local. Scores, gates e
diversidade permanecem determinísticos.

O fluxo de produção planejado possui cinco módulos sequenciais: radar de
tendências, transcrição multimodal, identificação de conteúdo, edição/montagem e
refino para engajamento. Agentes de IA podem acelerar tarefas internas, mas os
contratos e gates entre módulos são determinísticos.

## Executar

Requer Node.js 24 ou superior.

```powershell
npm test
npm start
```

Acesse `http://localhost:3000`. Sem chaves, use **Carregar rodada 1**. Para uma
execução atual, mantenha o Ollama ativo, copie `.env.example` para sua
configuração local e forneça `YOUTUBE_API_KEY`; arquivos `.env` são ignorados.
Instagram, Threads e TikTok entram somente quando seus tokens, escopos e
aprovações oficiais correspondentes estiverem configurados.

### Radar diário local

O M1 também possui uma interface manual adequada a agendadores externos. Ela
não instala nem altera tarefas do sistema operacional:

```powershell
npm run trend:daily -- --date 2026-09-26 --timezone America/Sao_Paulo
npm run trend:export -- --date 2026-09-26
node --env-file-if-exists=.env src/trend-cli.js shortlist --date 2026-09-26 --candidate youtube:ID --actor operador
node --env-file-if-exists=.env src/trend-cli.js select --date 2026-09-26 --candidate youtube:ID --actor operador
```

Cada data aceita uma única configuração material. Retry recupera etapas
concluídas, e a pasta `data/trends/<data>` é substituída somente após todos os
artefatos estarem prontos. Credenciais permanecem apenas no ambiente; sem a
configuração mínima de uma fonte, o relatório registra o bloqueio sem chamar o
adapter. Shortlist ou seleção não concedem direitos nem iniciam download.
Referências sem duração oficial continuam clicáveis na seção sem ranking. O
TikTok Display lista apenas vídeos da conta autorizada e nunca os apresenta como
tendência pública.

## Documentos principais

Leia [docs/CONTENT_AUTOMATION_MVP_PROJECT.md](docs/CONTENT_AUTOMATION_MVP_PROJECT.md) para conhecer visão, escopo, arquitetura proposta, riscos, critérios de sucesso e backlog priorizado.

O pipeline de cinco módulos está em
[docs/MODULAR_VIDEO_PIPELINE.md](docs/MODULAR_VIDEO_PIPELINE.md).

As regras estão em [AGENTS.md](AGENTS.md). O trabalho usa o
[fluxo econômico](docs/PROJECT_WORKFLOW.md), o
[roadmap](docs/TOPIC_ROADMAP.md), que concentra estado, evidências e gates dos
tópicos.

## Próximo passo

Após V05, R02A–R02G implementaram o núcleo do M1; R02H amplia a listagem oficial
para referências de Instagram, Threads e TikTok sem baixar mídia. A divisão detalhada está em
[`docs/M1_VIDEO_IDENTIFICATION_PLAN.md`](docs/M1_VIDEO_IDENTIFICATION_PLAN.md).
M1 registra links e dados sem baixar mídia. Transcrição, conteúdo, montagem e
refino seguem separados; composição multivídeo e react permanecem no backlog.
