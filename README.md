# MKTauto — estúdio de cortes dinâmicos

Repositório de planejamento de um sistema para um operador administrar vários
perfis temáticos, enviar um vídeo próprio/licenciado e produzir um novo corte
vertical com roteiro, narração e legendas.

O projeto possui uma primeira aplicação local de descoberta assistida. Ela usa a
rodada 1 como demonstração e, quando configurada, combina sinais da YouTube Data
API com sugestões estruturadas do Ollama local. Scores, gates e
diversidade permanecem determinísticos.

O fluxo de produção planejado possui cinco módulos sequenciais: identificação do
vídeo, transcrição multimodal, identificação de conteúdo, edição/montagem e
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

## Documentos principais

Leia [docs/CONTENT_AUTOMATION_MVP_PROJECT.md](docs/CONTENT_AUTOMATION_MVP_PROJECT.md) para conhecer visão, escopo, arquitetura proposta, riscos, critérios de sucesso e backlog priorizado.

O pipeline de cinco módulos está em
[docs/MODULAR_VIDEO_PIPELINE.md](docs/MODULAR_VIDEO_PIPELINE.md).

As regras estão em [AGENTS.md](AGENTS.md). O trabalho usa o
[fluxo econômico](docs/PROJECT_WORKFLOW.md), o
[roadmap](docs/TOPIC_ROADMAP.md), que concentra estado, evidências e gates dos
tópicos.

## Próximo passo

Após V04, R02 implementa somente M1 — identificação do vídeo e manifesto de
origem/direitos. Transcrição, conteúdo, montagem e refino seguem em tópicos
separados; composição multivídeo e react permanecem no backlog pós-MVP.
