# MKTauto — estúdio de cortes dinâmicos

Repositório de planejamento de um sistema para um operador administrar vários
perfis temáticos, enviar um vídeo próprio/licenciado e produzir um novo corte
vertical com roteiro, narração e legendas.

O projeto possui uma primeira aplicação local de descoberta assistida. Ela usa a
rodada 1 como demonstração e, quando configurada, combina sinais da YouTube Data
API com sugestões estruturadas do Ollama local. Scores, gates e
diversidade permanecem determinísticos.

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

As regras estão em [AGENTS.md](AGENTS.md). O trabalho usa o
[fluxo econômico](docs/PROJECT_WORKFLOW.md), o
[roadmap](docs/TOPIC_ROADMAP.md), que concentra estado, evidências e gates dos
tópicos.

## Próximo passo

V02 reprioriza o MVP para entrada por upload. Após seu merge, R02 valida extração
de áudio, transcrição local e análise visual quando necessária; composição a
partir de vários vídeos e o formato react permanecem no backlog pós-MVP.
