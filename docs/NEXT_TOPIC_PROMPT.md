# Próximo tópico — R02A Contratos e critérios do radar M1

> Executar somente após o merge de V05. Este tópico define o domínio do radar
> sem chamar redes sociais, executar IA ou agendar coleta.

## Resultado

- Problema: os dados e métricas variam entre YouTube, Instagram e TikTok; sem um
  contrato comum, o ranking esconderia lacunas ou compararia sinais incompatíveis.
- Resultado observável: schemas versionados representam runs, fontes, candidatos,
  snapshots, assuntos, score, explicação e cobertura parcial.
- Valor: permitir que cada adapter futuro entre sem inventar campos e que a mesma
  evidência produza ranking reproduzível.

## Persona principal

Operador individual de perfis temáticos em `pt-BR` que procura diariamente
oportunidades internacionais e brasileiras para criar conteúdo novo.

## Escopo

1. Criar contratos versionados para `TrendRun`, `SourceRun`, `TrendCandidate`,
   `TrendSnapshot`, `TopicCluster` e `TrendScore`.
2. Definir chave canônica `platform + platformVideoId`, com URL canônica como
   fallback validado.
3. Representar métricas ausentes como indisponíveis, nunca como zero estimado.
4. Modelar capacidades e estados `SUCCESS`, `PARTIAL`, `BLOCKED_BY_PROVIDER` e
   `FAILED` para cada fonte.
5. Definir estados da run e do candidato, incluindo reaparição sem duplicação.
6. Especificar duração elegível de 15 segundos a 3 minutos, 20 candidatos e top
   5, com diversidade configurável por plataforma, região e assunto.
7. Versionar os componentes do score: velocidade, engajamento, recência e
   recorrência, sem implementar coleta ou classificação por IA.
8. Definir serialização pública sanitizada e o layout lógico do catálogo local.

## Reuso

- validadores em `src/domain/contracts.js`;
- fórmula e gates explicáveis de `src/domain/ranking.js`;
- contratos de evidência que impedem o Ollama de criar IDs ou métricas;
- fixtures e testes Node existentes.

## Fora de escopo

- chamadas às APIs de YouTube, Instagram ou TikTok;
- OAuth, novas chaves ou revisão de aplicativo;
- SQLite, histórico real ou agendamento diário;
- agrupamento por Ollama e cálculo do ranking final;
- download, upload, mídia local, transcrição ou edição;
- scraping ou automação de navegador.

## Testes e aceite

- [ ] Contratos aceitam candidatos válidos das três plataformas.
- [ ] Métrica ausente permanece ausente e reduz confiança sem virar zero falso.
- [ ] ID, URL, duração, data e valores inválidos são rejeitados com código estável.
- [ ] Cobertura parcial/bloqueada é visível no resultado da run.
- [ ] O mesmo vídeo pode receber vários snapshots sem criar nova identidade.
- [ ] Limites de 20/top 5 e diversidade possuem configuração validada.
- [ ] IA não pode alterar evidências nem score determinístico.
- [ ] Testes existentes continuam passando e o roadmap registra a evidência.

Este prompt autoriza somente R02A. R02B começa apenas após o merge do PR de
R02A.
