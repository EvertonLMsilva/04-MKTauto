# R01 — registro sanitizado de execução

## Estado

- Tópico: `R01 — fluxo real e baseline interno`.
- Persona principal: operador individual de perfis temáticos em `pt-BR`.
- Rodada 1: executada de forma manual assistida em 24/09/2026.
- Rodada 2: não pode ocorrer antes de 01/10/2026.
- Lotes: não iniciados; dependem da confirmação da rodada 2 e de três fontes
  verdes conferidas pelo operador.
- Decisão atual: `iterar R01`.
- Gate: G0 aberto; R02 bloqueado.

Este arquivo não contém mídia, conta, pessoa identificável, prova privada,
token, caminho local de mídia ou URL de fonte escolhida para lote. Links abaixo
são somente evidências públicas de tendência, oferta editorial e licença.

## Método operacional da rodada

Os dez componentes definidos em `R01_DYNAMIC_NICHE_DISCOVERY.md` foram avaliados
em cinco níveis: `0`, `25`, `50`, `75` e `100`. A evidência observada determina
o nível, antes da aplicação dos pesos do protocolo:

- `0`: ausente ou incompatível;
- `25`: sinal único, fraco ou não confirmado;
- `50`: sinal moderado ou confirmação parcial;
- `75`: sinal forte, mas com uma limitação relevante;
- `100`: sinal forte, atual, repetível e diretamente verificável.

Na coluna de tendência, a sequência é `busca/vídeo/cruzamento/persistência/
atualidade`. Na viabilidade, é `fonte/transformabilidade/repetibilidade/
saturação inversa/aderência`. Os totais usam os pesos aprovados e a nota final
usa `0,60 × tendência + 0,40 × viabilidade`.

## Rodada 1 — 24/09/2026, Brasil, pt-BR

Snapshot principal: Google Trends, Brasil, últimas 24 horas. A página registrou,
entre outros sinais, futebol de seleções, `alerta vermelho: onda de calor`,
`bros 2027`, `xbox`, `susep`, `imposto`, `indenização`, `mansão` e
`volkswagen nivus`. Métricas são relativas ao momento da consulta e não
representam volume absoluto de mercado.

| ID | Micronicho candidato | Tendência: componentes → total | Viabilidade: componentes → total | Final | Gate/estado | Evidência |
|---|---|---:|---:|---:|---|---|
| C01 | análises de futebol de seleções europeias | 100/100/100/75/100 → 96,25 | 0/75/100/25/75 → 50,00 | 77,75 | observação: sem fonte verde para imagens de jogo | E01, E02, E03 |
| C02 | análises da seleção brasileira e amistosos | 100/75/75/75/100 → 85,00 | 0/75/100/25/75 → 50,00 | 71,00 | observação: sem fonte verde para imagens de jogo | E01, E02, E03 |
| C03 | futebol entre seleções da Ásia e América do Sul | 100/75/50/50/100 → 73,75 | 0/75/75/50/75 → 48,75 | 63,75 | observação: pico e direitos | E01 |
| C04 | futebol entre seleções africanas | 100/50/50/50/100 → 67,50 | 0/75/75/50/75 → 48,75 | 60,00 | observação: pico e direitos | E01 |
| C05 | notícias de personalidades da TV brasileira | 100/50/25/25/100 → 57,50 | 0/50/75/25/50 → 36,25 | 49,00 | reprovado: pico, privacidade e origem | E01 |
| C06 | música sertaneja e notícias de artistas | 100/50/50/50/100 → 67,50 | 0/75/100/25/75 → 50,00 | 60,50 | observação: direitos de música/imagem | E01 |
| C07 | cinema e carreiras internacionais | 100/25/25/25/100 → 51,25 | 0/50/50/25/50 → 31,25 | 43,25 | reprovado: pico isolado e origem | E01 |
| C08 | clima extremo e alertas explicados | 100/75/50/100/100 → 86,25 | 75/100/100/50/75 → 82,50 | 84,75 | elegível provisório | E01, E13, E19 |
| C09 | pesquisas eleitorais explicadas | 100/50/75/100/100 → 83,75 | 75/75/100/25/50 → 70,00 | 78,25 | observação: verificação e segurança editorial | E01 |
| C10 | política internacional explicada | 100/25/50/50/100 → 62,50 | 0/50/75/25/25 → 33,75 | 51,00 | reprovado: pico e origem | E01 |
| C11 | motos utilitárias e lançamentos | 100/75/100/100/100 → 93,75 | 100/100/100/50/75 → 90,00 | 92,25 | elegível provisório | E01, E04, E05, E10 |
| C12 | SUVs compactos e comparativos | 100/50/50/100/100 → 77,50 | 100/100/100/50/75 → 90,00 | 82,50 | elegível provisório | E01, E11 |
| C13 | Xbox, Game Pass e lançamentos | 75/75/100/100/100 → 88,75 | 100/100/100/50/100 → 95,00 | 91,25 | elegível provisório | E01, E06, E07, E09 |
| C14 | seguros e proteção do consumidor | 100/50/100/100/100 → 90,00 | 100/100/100/75/100 → 96,25 | 92,50 | elegível provisório | E01, E14, E15, E12 |
| C15 | impostos e reforma tributária para pequenos negócios | 100/50/100/100/100 → 90,00 | 100/100/100/50/75 → 90,00 | 90,00 | elegível provisório | E01, E16, E17 |
| C16 | decisões judiciais e casos públicos | 100/25/25/50/100 → 58,75 | 0/50/100/25/25 → 38,75 | 50,75 | reprovado: verificação, segurança e origem | E01 |
| C17 | indenização e direitos do consumidor | 100/25/25/75/100 → 62,50 | 100/100/100/50/75 → 90,00 | 73,50 | observação: confirmação cruzada insuficiente | E01, E12 |
| C18 | imóveis e arquitetura de alto padrão | 100/25/25/50/100 → 58,75 | 100/75/75/25/50 → 72,50 | 64,25 | observação: confirmação cruzada insuficiente | E01, E18 |
| C19 | animação independente on-line | 25/75/75/100/75 → 63,75 | 100/100/100/50/75 → 90,00 | 74,25 | elegível, abaixo do corte | E08, E10 |
| C20 | jogos independentes brasileiros | 50/75/75/100/100 → 73,75 | 100/100/100/75/100 → 96,25 | 82,75 | elegível, abaixo do corte | E06, E07, E09 |

### Top 5 provisório

| Posição | Candidato | Final | Motivo de entrada | Condição para permanecer |
|---:|---|---:|---|---|
| 1 | C14 — seguros e proteção do consumidor | 92,50 | busca atual, agenda pública recorrente, alto valor explicativo e vídeo licenciado genérico disponível | repetir elegibilidade na rodada 2 e validar alegações somente em fonte oficial |
| 2 | C11 — motos utilitárias e lançamentos | 92,25 | pico atual confirmado por release e calendário editorial recorrente; fonte genérica licenciada | repetir elegibilidade e evitar marcas/logos não cobertos |
| 3 | C13 — Xbox, Game Pass e lançamentos | 91,25 | sinal de busca, feed semanal em pt-BR e pauta contínua; fonte genérica licenciada | repetir elegibilidade e não reutilizar trailers/gameplay sem regra específica aplicável |
| 4 | C15 — impostos e reforma tributária | 90,00 | sinal atual e agenda oficial recorrente com utilidade prática | repetir elegibilidade; revisão factual humana obrigatória |
| 5 | C08 — clima extremo e alertas explicados | 84,75 | pico atual, alta utilidade e repetibilidade sazonal | obter confirmação cruzada oficial na rodada 2 e usar mídia sem pessoa/marca identificável |

O limite de dois micronichos por macronicho foi respeitado. C12 e C20 ficaram
fora do corte por nota; C01 ficou fora apesar da maior tendência bruta porque
não foi demonstrada fonte verde para as imagens de jogo. Como todos são novos,
o top 5 ainda não está promovido: a regra de duas execuções consecutivas será
testada na rodada 2.

### Divergências observadas

- O Google Trends favoreceu jogos de futebol pontuais; os sinais do YouTube e
  TikTok confirmam o macronicho esportivo, mas não fornecem direito de adaptação
  sobre transmissões ou melhores momentos.
- Os feeds oficiais de Honda, Xbox, Susep e Receita confirmam oferta contínua de
  pautas, mas material oficial não é automaticamente mídia reutilizável.
- A licença Pexels confirma possibilidade de adaptação comercial para os itens
  indicados, sujeita a marcas, pessoas e demais direitos retratados; ela prova
  oferta de fonte, não demanda.
- Animação independente tem confirmação estrutural forte no YouTube, mas não
  apareceu entre os maiores picos de busca da janela de 24 horas.

### Três candidatos para confirmação na rodada 2

Os lotes não estão autorizados por esta seleção provisória. Se permanecerem
elegíveis em 01/10/2026, a ordem candidata maximiza diversidade:

1. C14 — seguros e proteção do consumidor;
2. C11 — motos utilitárias e lançamentos;
3. C13 — Xbox, Game Pass e lançamentos.

Antes de L01–L03, o operador deve guardar fora do Git a prova aplicável, criar
um ID interno não reversível para cada fonte e conferir adaptação, uso
comercial, plataforma, território, validade, pessoas, marcas e áudio.

### Medição da descoberta

A consulta foi executada por assistência automatizada em sessão interativa. O
tempo dessa sessão não é comparável ao tempo ativo do operador humano e, por
integridade do baseline, não foi usado como métrica de R01. Na rodada 2, o
operador deve cronometrar sua revisão dos candidatos e registrar no fechamento
somente o total agregado. Custo incremental de fontes públicas: `R$ 0,00`.

## Evidências públicas da rodada 1

- E01 — [Google Trends, Brasil, últimas 24 horas](https://trends.google.com/trending?geo=BR&hl=pt-BR), consultado em 24/09/2026.
- E02 — [TikTok: Copa do Mundo de 2026](https://newsroom.tiktok.com/como-a-copa-do-mundo-da-fifa-2026-ganhou-vida-no-tiktok?lang=pt-BR), publicado em 2026.
- E03 — [YouTube: estádio digital dos brasileiros](https://blog.youtube/intl/pt-br/culture-and-trends/), índice consultado em 24/09/2026.
- E04 — [Honda NXR160 Bros 2027](https://prodsalaimp.honda.com.br/releases/honda-nxr160-bros-2027-novas-cores-e-aprimoramento-em-itens-de-seguranca-e-praticidade), publicado em 24/09/2026.
- E05 — [Honda Motos: busca e calendário editorial](https://www.honda.com.br/motos/blog/busca), consultado em 24/09/2026.
- E06 — [Xbox Wire em português: índice](https://news.xbox.com/pt-br/ver-tudo/?_categories=xbox-game-studios), consultado em 24/09/2026.
- E07 — [Xbox: próximos jogos de 31/08 a 04/09](https://news.xbox.com/pt-br/2026/08/28/proxima-semana-em-xbox-novos-jogos-de-31-de-agosto-a-4-de-setembro/), publicado em 2026.
- E08 — [YouTube: animação independente](https://blog.youtube/intl/pt-br/culture-and-trends/a-nova-onda-da-animacao-como-criadores-independentes-estao-redefinindo-o-entretenimento-global/), publicado em 2026.
- E09 — [Pexels: vídeo vertical genérico de controle de jogo](https://www.pexels.com/video/hands-playing-video-game-with-controller-30301758/), estado `free to use` consultado em 24/09/2026.
- E10 — [Pexels: vídeo vertical genérico de motocicleta](https://www.pexels.com/video/riding-a-motorcycle-on-an-empty-road-at-sunset-16512698/), estado `free to use` consultado em 24/09/2026.
- E11 — [Pexels: vídeo vertical genérico de automóvel](https://www.pexels.com/video/a-person-driving-a-car-and-parked-on-the-side-8865234/), estado `free to use` consultado em 24/09/2026.
- E12 — [Pexels: vídeo vertical genérico de finanças](https://www.pexels.com/video/a-man-counting-bank-notes-6700261/), estado `free to use` consultado em 24/09/2026.
- E13 — [NASA: regras para imagens e mídia](https://www.nasa.gov/nasa-brand-center/images-and-media/), consultado em 24/09/2026; uso sujeito às restrições da página e ao item escolhido.
- E14 — [Susep: medida de proteção do consumidor](https://www.gov.br/susep/pt-br/central-de-conteudos/noticias/2026/setembro/susep-adota-medida-cautelar-contra-a-facta-seguradora), publicado em 09/09/2026.
- E15 — [Susep: estudos sobre capitalização](https://www.gov.br/susep/pt-br/central-de-conteudos/noticias/2026/setembro/susep-apresenta-estudos-para-revisao-da-regulamentacao-de-titulos-de-capitalizacao), publicado em 24/09/2026.
- E16 — [Receita Federal: orientações da reforma tributária](https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/programas-e-atividades/reforma-tributaria-do-consumo/orientacoes-da-reforma-tributaria), atualizado em 21/09/2026.
- E17 — [Pexels: vídeo vertical genérico de cálculo tributário](https://www.pexels.com/video/deductible-items-for-computing-tax-amount-sue-6863206/), estado `free to use` consultado em 24/09/2026.
- E18 — [Pexels: vídeo vertical genérico de visita a imóvel](https://www.pexels.com/video/person-showing-the-house-7817209/), estado `free to use` consultado em 24/09/2026.
- E19 — [Pexels: vídeo genérico de solo seco](https://www.pexels.com/video/scenic-drought-landscape-with-cracked-earth-36249169/), estado `free to use` consultado em 24/09/2026.
- Licença comum dos itens Pexels — [permissões e proibições](https://www.pexels.com/license/), consultada em 24/09/2026.

## Condição de retomada

Em ou após 01/10/2026:

1. repetir a coleta sem alterar pesos ou âncoras;
2. avaliar ao menos 20 candidatos;
3. registrar entradas, saídas e divergências contra esta rodada;
4. promover somente candidatos elegíveis nas duas execuções;
5. confirmar três fontes verdes fora do Git;
6. executar L01–L03 e as 12 variações com cronômetro do operador;
7. agregar tempos, custos, espera, falhas e retrabalhos;
8. decidir `avançar R02`, `iterar R01` ou `stop/reposicionar`.
