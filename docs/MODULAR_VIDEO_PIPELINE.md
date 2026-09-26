# Pipeline modular e multiagente de vídeo

## Objetivo

Organizar a criação de cada vídeo em cinco módulos obrigatoriamente sequenciais,
com contratos versionados entre eles. IA pode acelerar análise e criação, mas um
orquestrador determinístico valida entradas, saídas, estados, limites e gates.

```text
M1 Identificação
      ↓ VideoAssetManifest
M2 Transcrição multimodal
      ↓ MediaTranscript
M3 Identificação de conteúdo
      ↓ ContentBrief
M4 Edição e montagem
      ↓ RenderCandidate
M5 Refino para engajamento
      ↓ FinalCandidate → revisão humana
```

Cada módulo recebe o contrato aprovado do módulo anterior. Quando mídia original
for necessária, o orquestrador concede acesso pela referência opaca do M1; isso
não autoriza pular contratos intermediários. Falha de contrato interrompe o
item; revisão pede nova versão ao módulo responsável, sem corrigir
silenciosamente dados anteriores.

## M1 — identificação de vídeos

Responsabilidade: receber o upload, identificar tecnicamente o ativo e preservar
origem e condição de uso antes de qualquer processamento criativo.

- validar contêiner, MIME, duração, resolução, tamanho e integridade;
- calcular SHA-256, detectar duplicação e criar ID interno;
- registrar proprietário/origem, licença/autorização declarada e restrições;
- classificar estado de direitos por regra, nunca somente por IA;
- aceitar futuramente vários ativos, mas processar um no primeiro MVP.

Saída: `VideoAssetManifest`, com metadados técnicos, hash, origem, estado de
direitos, alertas e caminho privado opaco.

Reuso atual: estados de fonte, revisão humana, armazenamento SQLite, validações e
adapters de YouTube/Wikimedia como fontes opcionais de pauta. Download de mídia
externa não faz parte do fluxo upload-first.

## M2 — transcrição multimodal

Responsabilidade: converter o que é falado, escrito e visualmente observável em
evidência temporal estruturada.

- FFmpeg extrai áudio mono 16 kHz e quadros amostrados;
- `faster-whisper` produz fala, idioma e timestamps;
- OCR local captura texto relevante na tela;
- visão local no Ollama descreve eventos quando fala/OCR forem insuficientes;
- cada observação referencia intervalo e método de extração;
- confiança baixa permanece explícita e não vira fato confirmado.

Saída: `MediaTranscript`, com segmentos de fala, texto em tela, observações
visuais, confiança, lacunas e referências temporais válidas.

Agentes candidatos: transcritor, leitor de tela e observador visual. Eles podem
rodar em paralelo após a extração determinística, pois não editam a mesma saída;
um agregador apenas combina resultados que passam pelo schema.

## M3 — identificação de conteúdo

Responsabilidade: entender o assunto e produzir um briefing editorial baseado
somente nas evidências do M2.

- identificar tema, subtemas, entidades, acontecimentos e momentos-chave;
- separar afirmação da fonte, inferência da IA e informação não verificada;
- sugerir ângulos novos, promessa editorial e público provável;
- marcar riscos de contexto, política, marca, pessoa, música e direitos;
- referenciar os IDs temporais que sustentam cada conclusão.

Saída: `ContentBrief`, com resumo, mapa de tópicos, momentos, riscos, possíveis
ângulos e cobertura de evidência.

Agentes candidatos: analista de conteúdo, verificador de evidência e revisor de
segurança. Divergência entre agentes vira alerta; não é resolvida por votação
opaca.

## M4 — edição e montagem

Responsabilidade: transformar o briefing aprovado em conteúdo novo, sem inventar
trechos inexistentes nem perder a origem.

- criar hook, roteiro novo, estrutura e plano de cortes;
- selecionar intervalos existentes do vídeo enviado;
- gerar narração e legendas sincronizadas com a nova narração;
- compor o template vertical, mixar áudio e renderizar uma versão;
- preservar linhagem entre cada trecho e o ativo de origem.

Saídas: `EditPlan` e `RenderCandidate`, ambos versionados. No primeiro MVP, todo
o visual vem de um único upload. Multivídeo e react reutilizarão os mesmos
contratos com múltiplas faixas somente após o MVP.

Agentes candidatos: roteirista, planejador de cortes e diretor de montagem. O
renderizador é determinístico; agente nenhum executa publicação.

## M5 — refino para engajamento

“Limpar dados” significa refinar conteúdo e técnica, não apagar origem, direitos,
auditoria ou metadados necessários.

- remover silêncio, repetição e trechos sem função editorial;
- revisar hook, ritmo, duração, densidade e legibilidade das legendas;
- normalizar áudio e detectar cortes, enquadramentos ou sobreposições ruins;
- limpar título, descrição, CTA e hashtags de redundância ou promessa enganosa;
- comparar a versão com o briefing e sinalizar perda de contexto;
- propor edição leve ou rejeição, sem prometer viralização.

Saídas: `EngagementReport` e `FinalCandidate`. Qualquer alteração de mídia volta
ao M4, cria nova versão e invalida aprovação anterior.

Agentes candidatos: editor de retenção, QA audiovisual e revisor de fidelidade.
A aprovação final permanece humana e se aplica ao hash exato renderizado.

## Orquestração multiagente

- A ordem M1 → M2 → M3 → M4 → M5 é obrigatória.
- Agentes paralelos só atuam dentro do módulo quando as subtarefas são
  independentes.
- Cada agente recebe objetivo, schema, evidências permitidas e limite de custo.
- Toda saída inclui versão do prompt/modelo, IDs de evidência, duração e falhas;
  conteúdo privado não entra em logs nem no Git.
- Regras de direitos, intervalos, estados, idempotência e efeitos externos são
  código determinístico.
- O orquestrador rejeita saída fora do schema, referência temporal inexistente e
  tentativa de pular módulo.
- Humano confirma direitos após M1, pode revisar o briefing após M3 e aprova a
  versão exata após M5.

## Reaproveitamento do que já existe

| Componente atual | Reuso planejado |
|---|---|
| Store SQLite e revisão humana | Persistência, idempotência e gate de direitos do M1. |
| YouTube/Wikimedia adapters | Pauta e candidatos opcionais no M1; nunca substituem upload/licença. |
| Contratos e validação de evidências | Schemas e referências controladas em M2–M5. |
| Ollama com saída estruturada | Agentes de visão, análise, roteiro e QA conforme o módulo. |
| Ranking e rubric explicáveis | Priorização de momentos no M3 e avaliação no M5. |
| Experiência local com FFmpeg/ffprobe | Inspeção no M1, extração no M2 e renderização/QA em M4–M5. |
| Estados de aprovação | Gates humanos após M1 e M5, sem efeitos externos automáticos. |

O protótipo de renderização de R01 serviu como evidência, mas seus arquivos
locais não foram versionados; M4 deverá implementar apenas o mínimo reproduzível
sustentado pelos contratos anteriores.

## Prioridade e estratégia de entrega

1. Provar M1 isoladamente com upload e manifesto reproduzível.
2. Provar M2 com fala, texto em tela e um caso visual sem fala suficiente.
3. Provar M3 com briefing explicável e totalmente ligado a evidências.
4. Provar M4 com um corte narrado e legendado baseado em um upload.
5. Provar M5 com rubric, edição leve e comparação antes/depois.
6. Somente então integrar os cinco módulos no orquestrador e medir o fluxo.

Esse fatiamento reutiliza o que existe, reduz retrabalho e permite parar ou trocar
uma tecnologia sem reescrever o pipeline inteiro.
