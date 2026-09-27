# MKTauto — plataforma modular de conteúdo social

## 1. Visão

O MKTauto permite que um operador individual administre um portfólio de canais
temáticos e transforme uma estratégia editorial configurada em conteúdo original,
revisável, publicável e mensurável. O produto evolui em etapas: primeiro gera um
vídeo vertical completo para preview; depois publica, automatiza a rotina, coleta
métricas e usa o histórico para melhorar sugestões futuras.

A persona principal é **o operador individual de um portfólio de canais
temáticos**. Várias configurações podem coexistir, mas cada execução processa um
projeto e um conteúdo por vez no MVP.

Não há promessa de viralidade ou renda. IA sugere e produz artefatos; regras de
estado, direitos, validação, aprovação, idempotência e efeitos externos permanecem
determinísticas.

## 2. Princípios invariantes

- preservar e expandir incrementalmente o software existente;
- usar APIs oficiais e registrar cobertura parcial ou bloqueio sem scraping;
- criar conteúdo original, sem copiar roteiro, voz, identidade ou mídia protegida;
- usar somente mídia própria, licenciada ou expressamente autorizada;
- exigir aprovação humana da versão exata antes de qualquer publicação no MVP;
- manter exportação manual como fallback de publicação;
- isolar fornecedores atrás de interfaces pequenas e versionadas;
- registrar linhagem, versões, transições e decisões relevantes;
- manter tokens, mídia privada, transcrições, payloads e runtime fora do Git;
- implementar somente o necessário para a fase ativa.

## 3. Estado atual e reaproveitamento

O núcleo existente cobre o início de `Research`, não publicação. Ele já oferece:

| Componente | Reuso na nova arquitetura |
|---|---|
| Radar diário e catálogo | Descoberta de temas e referências para um projeto. |
| YouTube, Instagram, Threads e TikTok | Adapters de pesquisa oficial com capacidades explícitas. |
| Wikimedia Commons | Fonte futura de alternativas com licença permitida. |
| Contratos versionados | Base para artefatos e fronteiras entre módulos. |
| Ranking determinístico | Base do `IdeaScorer` e de decisões explicáveis. |
| Ollama estruturado | Primeiro adapter local de inteligência de conteúdo. |
| SQLite e migrações | Persistência local incremental. |
| Idempotência e deduplicação | Padrão para runs, jobs e efeitos externos. |
| Estados e eventos | Base para histórico de conteúdo e publicação. |
| CLI, servidor e exportação | Interfaces locais e fallback operacional. |

Os adapters sociais existentes consultam referências; eles **não** implementam
`SocialPublisher`. Publicação, agendamento e analytics serão portas e adapters
separados para impedir que pesquisa adquira efeitos externos por acidente.

O pipeline anterior de cortes derivados de upload permanece como evidência e
capacidade futura. Os tópicos concluídos não são descartados; radar, direitos,
linhagem, transcrição e composição podem ser reutilizados quando o produto voltar
a aceitar mídia-fonte. O primeiro MVP da visão V06 prioriza geração original.

## 4. Configuração de projeto/canal

`Project` é a raiz de configuração que alimenta todo o pipeline. Um snapshot
imutável da versão usada acompanha cada execução.

```yaml
project:
  id: project_curiosidades_ia
  name: Curiosidades IA
  niche: inteligencia_artificial
  subniches: [ferramentas, curiosidades, produtividade]
  audience:
    language: pt-BR
    profile: pessoas interessadas em tecnologia
  references:
    - platform: instagram
      handle: perfilA
      purpose: strategic_reference
  content:
    format: short_video
    aspect_ratio: "9:16"
    min_duration_seconds: 25
    max_duration_seconds: 45
    voice_style: informativa
    visual_style: dinamico
  publishing:
    contents_per_day: 2
    networks: [instagram, facebook, threads, tiktok]
    timezone: America/Sao_Paulo
    times: ["10:00", "18:00"]
```

Referências servem para identificar temas, hooks, estrutura, ritmo, CTA,
frequência e linguagem visual. Elas nunca concedem direito de uso nem autorizam
reprodução de materiais ou identidade.

## 5. Módulos

```text
Project Configuration
        ↓ ProjectSnapshot
Research
        ↓ TopicCandidates / ReferenceInsights
Content Intelligence
        ↓ IdeaCandidate / IdeaScore
Content Production
        ↓ Script / Voice / Media / Video / Subtitles / Metadata
Quality Control
        ↓ ValidationReport
Preview and Human Approval
        ↓ ApprovedContentVersion
Scheduler
        ↓ PublishingJob
Social Publisher
        ↓ Publication
Analytics
        ↓ MetricSnapshot
Optimization Engine
        ↓ OptimizationRecommendation
```

Cada módulo consome contratos validados e produz artefatos rastreáveis. Falha
obrigatória interrompe o item; nenhum módulo corrige silenciosamente a saída de
outro ou pula uma aprovação.

## 6. Entidades principais

| Entidade | Responsabilidade mínima |
|---|---|
| `Project` | Identidade, nicho, público e versão da configuração. |
| `ChannelProfile` | Preferências editoriais e destinos de um projeto. |
| `ReferenceProfile` | Referência estratégica, origem e finalidade permitida. |
| `ContentItem` | Identidade estável da unidade de conteúdo e estado atual. |
| `ContentVersion` | Versão imutável dos artefatos que formam um preview. |
| `PipelineRun` | Execução, snapshot do projeto, etapas, custos e falhas. |
| `Artifact` | Saída versionada com tipo, hash, origem, direitos e localização. |
| `Approval` | Decisão humana sobre o hash exato de uma versão. |
| `StateTransition` | Estado anterior/seguinte, ator, motivo e instante. |
| `PublishingJob` | Plataforma, agenda, tentativas e chave de idempotência. |
| `Publication` | ID externo, estado reconciliado e versão publicada. |
| `MetricSnapshot` | Métricas opcionais observadas em um instante. |
| `OptimizationDecision` | Recomendação explicável, evidências e aplicação. |

Artefatos iniciais incluem `TopicCandidate`, `IdeaCandidate`, `IdeaScore`,
`Script`, `VoiceTrack`, `MediaAsset`, `VideoRender`, `SubtitleTrack`,
`ContentMetadata` e `ValidationReport`.

## 7. Estados

Fluxo normal de conteúdo:

```text
DRAFT → IDEA_APPROVED → SCRIPT_READY → MEDIA_READY → VIDEO_READY
      → VALIDATED → APPROVED → SCHEDULED → PUBLISHED → ANALYZED
```

Estados terminais ou de exceção: `FAILED`, `REJECTED` e `CANCELLED`.

Regras:

- transições permitidas são enumeradas e testadas;
- toda transição registra ator, instante e motivo;
- alterar qualquer artefato após aprovação cria nova versão e invalida aprovação;
- somente `APPROVED` pode originar agendamento;
- falha de publicação não altera nem elimina a versão aprovada;
- retry usa a mesma identidade lógica e não pode duplicar publicação.

Jobs de publicação usam `PENDING`, `PROCESSING`, `PUBLISHED`, `FAILED`,
`RETRYING` e `CANCELLED`.

## 8. Portas entre módulos

As interfaces representam capacidades, não fornecedores:

- `TrendSource.discover(projectSnapshot)`;
- `ReferenceAnalyzer.analyze(reference, projectSnapshot)`;
- `IdeaGenerator.generate(context)`;
- `IdeaScorer.score(ideas, policy)`;
- `ScriptGenerator.generate(approvedIdea, projectSnapshot)`;
- `VoiceProvider.synthesize(script, voiceProfile)`;
- `MediaProvider.provide(mediaRequest)`;
- `VideoComposer.compose(compositionPlan)`;
- `SubtitleGenerator.generate(script, voiceTrack)`;
- `MetadataGenerator.generate(contentVersion, platformContext)`;
- `QualityValidator.validate(contentVersion, policy)`;
- `SocialPublisher.publish(request)`, `getStatus(reference)` e
  `deletePublication(reference)` quando a plataforma permitir;
- `AnalyticsProvider.collect(publication, cursor)`;
- `OptimizationPolicy.recommend(history, projectSnapshot)`.

Operações de publicação específicas por formato podem existir nas capacidades do
adapter, mas o domínio não deve presumir que todas as redes aceitam vídeo, imagem,
texto, exclusão ou as mesmas métricas.

## 9. Estrutura futura

Esta é uma direção de organização, não uma autorização para mover arquivos antes
de haver uma entrega que exija a mudança:

```text
src/
├── domain/
│   ├── projects/
│   ├── content/
│   ├── publishing/
│   └── analytics/
├── application/
│   ├── project-configuration/
│   ├── content-pipeline/
│   └── publishing/
├── ports/
│   ├── intelligence/
│   ├── media/
│   ├── social/
│   └── storage/
├── adapters/
│   ├── research/
│   ├── generation/
│   ├── publishing/
│   └── analytics/
├── infrastructure/db/
└── interfaces/
    ├── cli/
    └── http/
```

Os arquivos atuais permanecem em seus locais até uma alteração pequena demonstrar
valor e possuir testes que tornem a movimentação segura.

## 10. Fases do produto

### MVP 1 — Content Generator

Entrada: projeto, nicho, tema e referências estratégicas. Saída: ideia, roteiro,
narração, mídia autorizada ou gerada, vídeo vertical, legenda, hashtags e preview.
Não publica automaticamente.

### MVP 2 — Publishing

Adiciona validação, aprovação humana, agenda e um publisher por vez: Instagram,
Facebook, Threads e TikTok, sempre condicionado à capacidade oficial disponível.

### MVP 3 — Automação diária

Executa pesquisa, geração, validação e preparação de agenda em horários
configuráveis. Conteúdo continua aguardando aprovação humana antes de publicar.

### MVP 4 — Analytics

Coleta métricas opcionais por `content_id`, `project_id`, plataforma e publicação,
preservando snapshots históricos e indisponibilidades explícitas.

### MVP 5 — Optimization Engine

Relaciona tema, hook, duração, CTA, horário, estilo e estrutura a métricas. Começa
com médias, comparações históricas, regras e scoring. Toda recomendação é
explicável; nenhuma altera regras estruturais ou publica conteúdo por conta própria.

## 11. Quality Control

Antes de aprovação, validadores verificam pelo menos existência dos artefatos,
duração, resolução, proporção, áudio, legendas, texto, limites conhecidos da
plataforma, formato, duplicidade, renderização, mídia ausente, direitos declarados
e sinais de conteúdo potencialmente inadequado.

Validações obrigatórias falhas impedem aprovação. Alertas revisáveis permanecem
visíveis ao operador e integram a decisão registrada.

## 12. Segurança, direitos e privacidade

- credenciais entram somente por configuração segura e com menor privilégio;
- logs e erros não incluem tokens, URLs privadas ou payloads sensíveis;
- artefatos privados usam storage fora do Git, hashes e acesso temporário;
- origem, licença e consentimento acompanham cada mídia;
- referência pública não equivale a licença de reutilização;
- publicação e exclusão são efeitos externos auditáveis e idempotentes;
- retenção, takedown e operação pública exigem gate específico antes do lançamento.

## 13. Estratégia de testes

- TDD para entidades, transições, permissões, idempotência e contratos;
- testes de contrato para cada adapter com respostas sanitizadas;
- integração local para persistência, retry e recuperação de falhas;
- fixtures próprias ou autorizadas para mídia e renderização;
- smoke test em conta oficial de teste antes de habilitar cada plataforma;
- publicação real nunca faz parte de uma suíte automática sem ambiente isolado e
  autorização explícita.

## 14. Riscos principais

| Risco | Mitigação inicial |
|---|---|
| Escopo crescer antes do primeiro preview | Fases e tópicos pequenos com gates. |
| Conteúdo copiar referências | Linhagem, instruções de originalidade e revisão humana. |
| Mídia sem direito de uso | Origem/licença obrigatórias e bloqueio determinístico. |
| Custo ou latência de IA inviável | Orçamento por run, cache seguro e medição por provider. |
| Dependência de fornecedor | Portas pequenas, capacidades explícitas e fallback. |
| Duplicação de publicação | Chave idempotente, reconciliação e estado persistido. |
| Métricas incompatíveis | Modelo opcional por plataforma e snapshots brutos sanitizados. |
| Vazamento de segredo ou mídia | Storage privado, menor privilégio e Git restrito. |
| Otimização opaca ou nociva | Recomendações explicáveis, auditáveis e reversíveis. |

## 15. Decisão V06

V06 substitui a prioridade futura de transformar mídia-fonte pela prioridade de
gerar conteúdo original a partir de uma configuração de projeto/canal. Ela não
remove entregas concluídas nem autoriza antecipar módulos. O radar implementado
torna-se a primeira capacidade do módulo `Research`; publicação e analytics
continuam inexistentes até seus tópicos próprios.

O roadmap executável e a decomposição do primeiro épico estão em
`docs/TOPIC_ROADMAP.md`. Os artefatos, estados e regras de pipeline estão em
`docs/MODULAR_VIDEO_PIPELINE.md`.
