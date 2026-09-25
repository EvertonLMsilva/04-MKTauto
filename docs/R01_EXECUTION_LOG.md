# R01 — registro sanitizado de execução

## Estado

- Tópico: `R01 — fluxo real e baseline interno`.
- Persona principal: operador individual de perfis temáticos em `pt-BR`.
- Rodada 1: executada de forma manual assistida em 24/09/2026.
- Rodada 2: autorizada para execução imediata em 25/09/2026; a janela antes
  prevista para 01/10/2026 não bloqueia o avanço do MVP.
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
| C03 | futebol entre seleções da Ásia e América do Sul | 100/75/50/50/100 → 76,25 | 0/75/75/50/75 → 48,75 | 65,25 | observação: pico e direitos | E01 |
| C04 | futebol entre seleções africanas | 100/50/50/50/100 → 70,00 | 0/75/75/50/75 → 48,75 | 61,50 | observação: pico e direitos | E01 |
| C05 | notícias de personalidades da TV brasileira | 100/50/25/25/100 → 61,25 | 0/50/75/25/50 → 36,25 | 51,25 | reprovado: pico, privacidade e origem | E01 |
| C06 | música sertaneja e notícias de artistas | 100/50/50/50/100 → 70,00 | 0/75/100/25/75 → 50,00 | 62,00 | observação: direitos de música/imagem | E01 |
| C07 | cinema e carreiras internacionais | 100/25/25/25/100 → 55,00 | 0/50/50/25/50 → 31,25 | 45,50 | reprovado: pico isolado e origem | E01 |
| C08 | clima extremo e alertas explicados | 100/75/50/100/100 → 83,75 | 75/100/100/50/75 → 82,50 | 83,25 | elegível provisório | E01, E13, E19 |
| C09 | pesquisas eleitorais explicadas | 100/50/75/100/100 → 82,50 | 75/75/100/25/50 → 70,00 | 77,50 | observação: verificação e segurança editorial | E01 |
| C10 | política internacional explicada | 100/25/50/50/100 → 63,75 | 0/50/75/25/25 → 33,75 | 51,75 | reprovado: pico e origem | E01 |
| C11 | motos utilitárias e lançamentos | 100/75/100/100/100 → 93,75 | 100/100/100/50/75 → 90,00 | 92,25 | elegível provisório | E01, E04, E05, E10 |
| C12 | SUVs compactos e comparativos | 100/50/50/100/100 → 77,50 | 100/100/100/50/75 → 90,00 | 82,50 | elegível provisório | E01, E11 |
| C13 | Xbox, Game Pass e lançamentos | 75/75/100/100/100 → 86,25 | 100/100/100/50/100 → 92,50 | 88,75 | elegível provisório | E01, E06, E07, E09 |
| C14 | seguros e proteção do consumidor | 100/50/100/100/100 → 87,50 | 100/100/100/75/100 → 96,25 | 91,00 | elegível provisório | E01, E14, E15, E12 |
| C15 | impostos e reforma tributária para pequenos negócios | 100/50/100/100/100 → 87,50 | 100/100/100/50/75 → 90,00 | 88,50 | elegível provisório | E01, E16, E17 |
| C16 | decisões judiciais e casos públicos | 100/25/25/50/100 → 58,75 | 0/50/100/25/25 → 38,75 | 50,75 | reprovado: verificação, segurança e origem | E01 |
| C17 | indenização e direitos do consumidor | 100/25/25/75/100 → 62,50 | 100/100/100/50/75 → 90,00 | 73,50 | observação: confirmação cruzada insuficiente | E01, E12 |
| C18 | imóveis e arquitetura de alto padrão | 100/25/25/50/100 → 58,75 | 100/75/75/25/50 → 72,50 | 64,25 | observação: confirmação cruzada insuficiente | E01, E18 |
| C19 | animação independente on-line | 25/75/75/100/75 → 63,75 | 100/100/100/50/75 → 90,00 | 74,25 | elegível, abaixo do corte | E08, E10 |
| C20 | jogos independentes brasileiros | 50/75/75/100/100 → 73,75 | 100/100/100/75/100 → 96,25 | 82,75 | elegível, abaixo do corte | E06, E07, E09 |

### Top 5 provisório

| Posição | Candidato | Final | Motivo de entrada | Condição para permanecer |
|---:|---|---:|---|---|
| 1 | C11 — motos utilitárias e lançamentos | 92,25 | pico atual confirmado por release e calendário editorial recorrente; fonte genérica licenciada | repetir elegibilidade e evitar marcas/logos não cobertos |
| 2 | C14 — seguros e proteção do consumidor | 91,00 | busca atual, agenda pública recorrente, alto valor explicativo e vídeo licenciado genérico disponível | repetir elegibilidade na rodada 2 e validar alegações somente em fonte oficial |
| 3 | C13 — Xbox, Game Pass e lançamentos | 88,75 | sinal de busca, feed semanal em pt-BR e pauta contínua; fonte genérica licenciada | repetir elegibilidade e não reutilizar trailers/gameplay sem regra específica aplicável |
| 4 | C15 — impostos e reforma tributária | 88,50 | sinal atual e agenda oficial recorrente com utilidade prática | repetir elegibilidade; revisão factual humana obrigatória |
| 5 | C08 — clima extremo e alertas explicados | 83,25 | pico atual, alta utilidade e repetibilidade sazonal | obter confirmação cruzada oficial na rodada 2 e usar mídia sem pessoa/marca identificável |

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

1. C11 — motos utilitárias e lançamentos;
2. C14 — seguros e proteção do consumidor;
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

## Rodada 2 — 25/09/2026, Brasil, pt-BR

A restrição de calendário foi removida por decisão do usuário. A aplicação
coletou 49 sinais únicos pela YouTube Data API, distribuídos entre o chart geral
e categorias oficiais disponíveis no Brasil. O Ollama local (`qwen3:4b`) gerou
20 candidatos únicos, todos ligados a pelo menos duas evidências conhecidas.
Pesos e âncoras de score não foram alterados.

Como sinais populares não provam direito de adaptação, todos os candidatos
permaneceram com `greenSource=false`. O ranking abaixo é provisório e serve para
revisão humana; ele não promove fonte nem satisfaz G0.

| Pos. | Candidato | Macronicho | Tendência | Viabilidade | Final | Estado |
|---:|---|---|---:|---:|---:|---|
| 1 | música popular brasileira | música | 84,25 | 82,25 | 83,45 | aprovado; fonte verde confirmada |
| 2 | músicas ao vivo brasileiras | música | 81,75 | 77,25 | 79,95 | rejeitado pelo operador |
| 3 | lançamentos de motos utilitárias | automóveis | 82,85 | 73,75 | 79,21 | aprovado; fonte verde confirmada |
| 4 | jogos de Minecraft | jogos | 77,75 | 75,75 | 76,95 | aprovado; fonte verde confirmada |
| 5 | curiosidades de eletrônicos | ciência e tecnologia | 69,00 | 69,25 | 69,10 | aprovado; fonte verde pendente |

### Revisão humana do top 5

O operador revisou a versão exata do ranking local em 25/09/2026. Quatro
candidatos foram aprovados editorialmente e `músicas ao vivo brasileiras` foi
rejeitado. Nenhuma decisão alterou automaticamente o estado de direitos.

Para a validação de fontes e os lotes, a seleção candidata maximiza diversidade:

1. música popular brasileira;
2. lançamentos de motos utilitárias;
3. jogos de Minecraft.

`Curiosidades de eletrônicos` fica como reserva. A seleção se tornou definitiva
após a conferência de três fontes do Wikimedia Commons com arquivo oficial e
metadados de licença; mídia e prova detalhada permaneceram fora do Git.

### Comparação com a rodada 1

- `lançamentos de motos utilitárias` é o único candidato comparável que se
  manteve no top 5 das duas execuções;
- seguros, tributação e clima não reapareceram no corte da YouTube Data API;
- jogos reapareceram como macronicho, mas `Minecraft` não confirma o candidato
  anterior de Xbox/Game Pass;
- música ganhou dois lugares, mostrando sensibilidade do chart atual e exigindo
  cautela adicional com direitos de áudio e imagem;
- não existem ainda três nichos promovíveis segundo a regra de duas execuções.

### Instrumentação e retrabalho da descoberta

- execução final válida: 88 segundos de espera de API/modelo local;
- custo monetário incremental observado: `R$ 0,00`; consumo de quota do YouTube
  e energia local não foram convertidos em custo financeiro;
- tempo ativo do operador na descoberta: revisão concluída, mas sem cronômetro
  comparável;
- falhas: uma categoria sem chart regional retornou 404 e passou a ser tratada
  como ausência de sinal, sem ocultar falhas de autenticação ou quota;
- retrabalhos do instrumento: concentração temática, cópia de títulos, gate de
  múltiplos sinais declarado incorretamente e candidato duplicado foram
  reproduzidos e cobertos por regras/testes antes da execução final;
- a descoberta de fontes foi retomada pela API oficial do Wikimedia Commons,
  pois a YouTube Data API não fornece um arquivo reutilizável para edição.

### Fontes verdes e lotes reais

O operador definiu que somente mídia que não exige autorização individual pode
entrar. A busca oficial aceitou `CC0`, domínio público e `CC BY`, rejeitando
automaticamente licenças incompatíveis com esse recorte. A confirmação humana
promoveu três fontes; as duas fontes `CC BY 3.0` receberam atribuição visível em
todas as saídas.

| Lote | Perfil | Condição | Prova conferida | Entrada |
|---|---|---|---|---|
| L01 | música popular brasileira | CC BY 3.0 | sim; registro externo | 327,30 s; 768x480; 6,29 MiB |
| L02 | motos utilitárias | CC0 | sim; registro externo | 15,83 s; 270x480; 1,87 MiB |
| L03 | jogos de Minecraft | CC BY 3.0 | sim; registro externo | 101,96 s; 854x480; 12,84 MiB |

O usuário reduziu o lote final para uma versão por nicho, combinando narração e
legenda. Foram mantidos três cortes locais com vídeo H.264, áudio AAC, resolução
1080x1920, duração entre 15 e 24 segundos e hash SHA-256 registrado fora do
Git. As saídas finais somam 13,23 MiB e não foram publicadas nem versionadas.
As nove variações isoladas foram descartadas do lote final.

### Medição dos lotes

- espera do passe final das três versões selecionadas: 67,94 segundos;
- espera total de renderização, incluindo retrabalho: 924,71 segundos;
- custo monetário incremental observado: `R$ 0,00`;
- falhas: três classes visuais — eventos ASS ausentes, texto fora da área segura
  e divisão de legenda no meio de palavra — também atingiram versões
  intermediárias posteriormente descartadas;
- retrabalho: 27 renderizações adicionais antes do recorte; a revisão final
  confirmou texto inteiro, atribuição visível, vídeo e áudio nas três saídas;
- tempo ativo humano de preparação e revisão não foi cronometrado de modo
  comparável e não será estimado retroativamente.

A revisão humana aprovou as três versões exatas em 25/09/2026. A decisão
permanece `iterar R01` somente porque o tempo ativo de preparação não foi medido
de forma válida; não será estimado retroativamente.
Não há evidência para `stop/reposicionar`; o calendário não bloqueia o MVP.

## Condição de fechamento

Sem restrição de calendário:

1. executar uma rodada curta cronometrada se o tempo ativo continuar necessário
   para a decisão de G0;
2. decidir `avançar R02`, `iterar R01` ou `stop/reposicionar` com essa evidência.
