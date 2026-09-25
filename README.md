# MKTauto — estúdio de cortes dinâmicos

Repositório de planejamento de um sistema para um operador administrar vários
perfis temáticos, encontrar fontes por nicho e produzir cortes verticais
dinâmicos com narração, texto, legendas ou múltiplos trechos.

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

R01A valida o instrumento com fixtures e, quando houver chaves, com uma execução
ao vivo. R01 continua responsável pelos três lotes e pelo baseline; R02 permanece
bloqueado até G0.
