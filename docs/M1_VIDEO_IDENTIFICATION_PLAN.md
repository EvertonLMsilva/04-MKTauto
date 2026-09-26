# M1 — radar diário de vídeos em alta

## Decisão de produto

M1 não recebe upload, não transcreve e não edita. Ele executa uma descoberta
diária de vídeos públicos em alta no YouTube, Instagram e TikTok, em regiões e
idiomas diversos, descobre os assuntos automaticamente e entrega 20 candidatos
explicáveis para adaptação ao público brasileiro.

O módulo registra referências e metadados, mas não baixa mídia. Um vídeo sem
permissão continua útil como referência editorial; isso não autoriza cópia,
repostagem ou download. O arquivo necessário aos módulos seguintes deverá ser
obtido legitimamente e associado ao candidato em uma etapa posterior.

## Resultado diário

Cada execução produz um `TrendCatalog` versionado contendo:

- 20 candidatos entre 15 segundos e 3 minutos, com top 5 destacado;
- plataforma, ID canônico, URL pública, autor/canal quando a API disponibilizar,
  data, duração, idioma, país/região, texto público e miniatura permitida;
- métricas brutas disponíveis: visualizações, curtidas, comentários e
  compartilhamentos;
- snapshots históricos para calcular crescimento e velocidade;
- assunto, nicho, subtema, público provável, padrão narrativo e possibilidade de
  criar abordagem nova para o Brasil;
- score, posição, evidências e explicação de por que o item está em alta;
- disponibilidade de uso: `REFERENCE_ONLY`, `USAGE_UNKNOWN` ou
  `USAGE_CONFIRMED`, sem decisão automática de direitos;
- capacidade da fonte e lacunas de dados explícitas, sem inventar métricas;
- histórico de reaparição do mesmo vídeo sem novo download ou novo cadastro.

O ranking combina sinais disponíveis, normalizados por plataforma:

1. crescimento de visualizações entre snapshots;
2. visualizações por hora/dia desde a publicação;
3. taxas de curtidas, comentários e compartilhamentos;
4. recência;
5. recorrência do assunto em vídeos, regiões e plataformas diferentes.

Um sinal ausente reduz a confiança; não recebe valor zero nem estimativa criada
por IA. O score é determinístico. IA local pode agrupar assuntos e explicar
padrões somente a partir das evidências coletadas.

## Cobertura internacional

A coleta começa com regiões representativas e configuráveis, incluindo Brasil,
Estados Unidos, México, Reino Unido, Espanha, Índia, Japão e Coreia do Sul. A
lista pode crescer sem mudar o contrato. Idioma não restringe a entrada; cada
candidato registra idioma detectado/declarado e potencial de localização para
`pt-BR`.

O top 20 evita domínio de uma única rede, região ou assunto por meio de limites
configuráveis de diversidade. A cobertura real de cada rede permanece visível:
uma fonte limitada nunca é apresentada como se tivesse sido pesquisada por
completo.

## Limites reais das APIs oficiais

| Rede | Capacidade oficial útil | Limite para M1 | Estratégia |
|---|---|---|---|
| YouTube | `videos.list` com `chart=mostPopular`, região, categoria, estatísticas e duração. | O chart não é exclusivo de Shorts; formato curto precisa ser filtrado por duração e outros sinais disponíveis. | Primeira fonte operacional e baseline reproduzível. |
| Instagram | Busca oficial por hashtags e mídia pública associada, sujeita a conta profissional, permissões e revisão do app. | Não existe endpoint geral equivalente a “Reels em alta no mundo”; descoberta é parcial e orientada por hashtags. | Expandir hashtags a partir dos assuntos já observados e declarar cobertura limitada. |
| TikTok | Display API lista vídeos do usuário que autorizou o app; Research API consulta dados públicos apenas para pesquisadores elegíveis. | A API comercial comum não fornece feed global de tendências públicas. | Implementar adaptador somente com acesso oficial elegível; caso contrário registrar `BLOCKED_BY_PROVIDER`, sem scraping. |

Referências oficiais verificadas em 26/09/2026:

- [YouTube `videos.list`](https://developers.google.com/youtube/v3/docs/videos/list);
- [Instagram Hashtag Search](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-hashtag-search);
- [TikTok Display API](https://developers.tiktok.com/docs/en/display-api-overview);
- [TikTok Research Tools](https://developers.tiktok.com/docs/en/about-research-api).

“Todas as redes” significa tentar todos os adapters oficiais diariamente e
registrar o resultado de cada um: `SUCCESS`, `PARTIAL`, `BLOCKED_BY_PROVIDER` ou
`FAILED`. Não autoriza scraping nem dados fabricados para preencher uma fonte.

## Identidade, histórico e reaparição

A chave é `platform + platformVideoId`; URL canônica é fallback. Cada coleta cria
um snapshot imutável de métricas. Se o vídeo reaparecer:

- não cria outro candidato nem tenta baixar mídia;
- atualiza `lastSeenAt` e acrescenta novo snapshot;
- recalcula velocidade, posição e confiança;
- explica a nova indicação, por exemplo crescimento renovado, permanência no
  ranking ou retorno do assunto em outras redes.

Conteúdo semelhante não é tratado como duplicata do vídeo. Similaridade serve
para formar clusters de assunto e detectar tendências cruzadas.

## Armazenamento local e mapeamento

SQLite guarda runs, candidatos, snapshots, clusters, scores e estado dos
adapters. Uma pasta por execução oferece artefatos fáceis de usar:

```text
data/trends/2026-09-26/
├── catalog.json
├── ranking.csv
├── report.html
└── candidates/
    └── <candidate-id>/
        ├── candidate.json
        └── thumbnail.<ext>  # somente quando a API permitir persistência
```

`candidate.json` é a fonte de ligação com os módulos posteriores. Não há arquivo
de vídeo nessa pasta. Depois da escolha, um processo de aquisição ainda a definir
associa um arquivo local legítimo ao `candidateId`, registra hash/origem e só
então libera transcrição. M2 jamais recebe somente uma URL remota.

## Estados

### Execução diária

`CREATED → COLLECTING → NORMALIZING → CLUSTERING → RANKING → COMPLETED`

Falhas terminam em `COMPLETED_WITH_GAPS` ou `FAILED`. Uma rede indisponível não
apaga resultados válidos das demais.

### Candidato

`DISCOVERED → ACTIVE → SHORTLISTED → SELECTED`

`STALE` indica que deixou a janela de tendência; `REFERENCE_ONLY` é uma condição
de uso, não um estado editorial. Seleção humana não equivale a autorização de
download ou publicação.

## Divisão de R02

Cada linha é um tópico e um PR independente, executado na ordem.

| ID | Entrega | Resultado observável | Depende de |
|---|---|---|---|
| R02A | Contratos e critérios | `TrendRun`, `TrendCandidate`, `TrendSnapshot`, capacidades das fontes, estados e fórmula de ranking possuem schemas e testes. | V05 |
| R02B | Histórico local e deduplicação | SQLite guarda snapshots diários; reaparições atualizam histórico e explicação sem duplicar candidato. | R02A |
| R02C | Coleta global do YouTube | Adapter oficial coleta charts de regiões configuradas, filtra 15 s–3 min e normaliza métricas. | R02B |
| R02D | Assuntos e ranking | IA local agrupa evidências; regras determinísticas entregam top 20 diverso e top 5 explicável. | R02C |
| R02E | Cobertura oficial do Instagram | Spike prova a cobertura permitida por hashtags ou registra bloqueio/limitação reproduzível. | R02D |
| R02F | Cobertura oficial do TikTok | Spike usa acesso oficial elegível ou registra `BLOCKED_BY_PROVIDER`, sem scraping. | R02E |
| R02G | Execução diária e catálogo local | Uma execução manual/agendada por dia consulta todos os adapters e gera JSON, CSV e relatório HTML mapeáveis. | R02F |

### R02A — contratos e critérios

- substituir o contrato de upload pelo catálogo de tendências;
- definir campos obrigatórios, opcionais e disponibilidade por plataforma;
- versionar fórmula, normalização, diversidade e explicações;
- testar estados, dados ausentes, IDs canônicos e serialização sanitizada;
- definir as regiões iniciais e duração de 15 segundos a 3 minutos.

Aceite: um conjunto de snapshots válido produz candidatos comparáveis sem
inventar sinal ausente; nenhuma URL ou métrica arbitrária passa pelo contrato.

### R02B — histórico local e deduplicação

- persistir runs, adapters, candidatos, snapshots e ranking;
- reutilizar candidato por chave canônica e preservar snapshots imutáveis;
- calcular velocidade somente com observações comparáveis;
- registrar motivo de reaparição e mudança de posição;
- tornar nova tentativa da mesma run idempotente.

Aceite: o mesmo vídeo observado em dias diferentes aparece uma vez, com histórico
e explicação atualizados.

### R02C — coleta global do YouTube

- reutilizar o adapter e a chave do YouTube já existentes;
- coletar `mostPopular` nas regiões configuradas;
- normalizar estatísticas, duração, idioma/região e URLs;
- filtrar a janela de 15 segundos a 3 minutos;
- registrar quota, páginas, falhas regionais e cobertura real.

Aceite: uma execução real produz candidatos internacionais reproduzíveis sem
scraping e sem baixar mídia.

### R02D — assuntos e ranking

- usar Ollama para rotular nicho, subtema, público, padrão e localização `pt-BR`;
- impedir que a IA altere métricas, IDs, URLs ou score;
- formar clusters por evidência e recorrência cruzada;
- calcular score por velocidade, engajamento, recência e recorrência;
- aplicar diversidade e entregar 20 candidatos, com top 5 explicado.

Aceite: repetir a classificação validada gera o mesmo ranking e toda explicação
referencia snapshots reais.

### R02E — cobertura oficial do Instagram

- validar conta, permissões, revisão e endpoints oficiais disponíveis;
- descobrir mídia pública somente dentro dos usos e hashtags permitidos;
- alimentar hashtags por clusters já conhecidos, sem scraping;
- normalizar apenas campos realmente retornados;
- registrar cobertura `PARTIAL` ou bloqueio com motivo acionável.

Aceite: evidência real sustenta o adapter ou uma decisão explícita de adiamento;
a falta de acesso não bloqueia YouTube nem o avanço do MVP.

### R02F — cobertura oficial do TikTok

- verificar elegibilidade e acesso aprovado às APIs oficiais;
- distinguir Display API autorizada de pesquisa de tendências públicas;
- implementar coleta somente se o uso for permitido para este produto;
- registrar `BLOCKED_BY_PROVIDER` quando não houver endpoint apropriado;
- manter contrato pronto para futura ativação sem scraping.

Aceite: o sistema não apresenta vídeos de contas autorizadas como se fossem um
ranking global e não contorna restrições da plataforma.

### R02G — execução diária e catálogo local

- executar no máximo uma run lógica por data, com retry idempotente;
- chamar todos os adapters e tolerar lacunas declaradas;
- gerar `catalog.json`, `ranking.csv`, `report.html` e registros por candidato;
- permitir marcar top 5, shortlist e seleção humana;
- registrar tempo, quota, custo, falhas e cobertura sem conteúdo privado.

Aceite: o operador abre a pasta diária, entende quais vídeos estão em alta, por
que foram listados e quais dados estarão disponíveis para o próximo estágio.

## Reuso

- `src/adapters/youtube.js`: ponto inicial da coleta oficial;
- `src/adapters/ollama.js`: classificação estruturada, nunca criação de métricas;
- `src/domain/ranking.js`: padrão de score e gates explicáveis;
- `src/store.js`: padrão SQLite, ampliado para snapshots normalizados;
- UI de top 5 e revisão: base para relatório e shortlist;
- Wikimedia: fora do radar social, mas poderá oferecer alternativa licenciada
  semelhante depois da descoberta.

## Fora de escopo do M1

- upload, download, armazenamento ou reprodução do arquivo de vídeo;
- transcrição, OCR, visão quadro a quadro ou identificação de cenas;
- criação de roteiro, narração, legenda, cortes ou renderização;
- decisão automática de direitos ou garantia de monetização;
- scraping, automação de navegador ou contorno de API;
- publicação em qualquer rede.

## Riscos residuais

- Instagram e TikTok podem não oferecer descoberta geral compatível com o
  produto; o resultado correto é cobertura parcial explícita, não scraping;
- métricas entre redes não são equivalentes e exigem normalização por fonte;
- API pode omitir compartilhamentos, idioma ou autor; confiança precisa refletir
  cada lacuna;
- catálogo não é mídia processável. A aquisição legítima e o vínculo do arquivo
  local precisam ser definidos antes de implementar M2.
