# R01 — método de descoberta dinâmica de nichos

## Resultado esperado

Produzir semanalmente um ranking reproduzível dos cinco nichos com melhor
combinação de demanda crescente e viabilidade editorial em `pt-BR`. O ranking
indica onde trabalhar; não baixa mídia nem autoriza publicação.

O sistema separa três níveis:

- **macronicho:** jogos, automóveis, entretenimento, esporte, tecnologia etc.;
- **micronicho:** trailers comentados, carros de luxo, histórias inspiradoras;
- **pauta:** GTA VI, lançamento de um modelo ou fala específica.

Perfis editoriais usam micronichos relativamente estáveis. Pautas mudam todos os
dias. O portfólio `top 5` é recalculado semanalmente para não trocar de identidade
a cada pico passageiro.

## Fontes de sinais

| Fonte | Sinal | Automação inicial | Limite conhecido |
|---|---|---|---|
| YouTube Data API | `mostPopular` por Brasil/categoria; busca recente e estatísticas | automática por API oficial | popularidade do YouTube não representa todo o mercado; quotas aplicáveis |
| Google Trends | interesse, crescimento, região e persistência | API oficial quando houver acesso; exportação manual como fallback | API permanece alfa e restrita; interesse não é volume absoluto e chega com atraso |
| TikTok Creative Center | hashtags, setores, linha temporal, vídeos e audiência relacionados | validação manual/assistida | não presumir endpoint público estável nem automatizar a interface por scraping |
| Instagram/Meta | tendências e exemplos públicos disponíveis ao operador | validação manual/assistida | acesso e superfícies variam; sem scraping de perfis |
| Feeds oficiais | anúncios de publishers, fabricantes, ligas, estúdios e criadores parceiros | RSS/API/lista permitida | mede oferta e novidade, não demanda sozinho |

Fontes sem API ou permissão clara entram como fallback manual. Nenhuma lacuna de
integração autoriza scraping ou coleta contrária aos termos da plataforma.

## Pipeline de descoberta

1. Coletar sinais com data, região, plataforma e métrica original.
2. Normalizar idioma, grafia, hashtags, entidades, marcas e títulos.
3. Agrupar termos equivalentes em uma pauta; agrupar pautas em micronichos.
4. Calcular tendência nas janelas de 24 horas, 7 dias e 30 dias.
5. Confirmar se o crescimento aparece em ao menos duas fontes independentes.
6. Procurar fontes audiovisuais oficiais ou previamente permitidas.
7. Pontuar tendência e viabilidade separadamente.
8. Aplicar gates de segurança, origem e diversidade.
9. Submeter o `top 5` ao operador, com evidência e explicação da pontuação.
10. Congelar a seleção por uma semana; pautas internas continuam atualizadas.

IA pode sugerir agrupamentos e nomes de nichos. Regras determinísticas calculam
pontuação, aplicam gates e registram por que um candidato entrou ou saiu.

## Pontuação

### Tendência — 0 a 100

| Componente | Peso | Medida candidata |
|---|---:|---|
| Momento de busca | 30 | crescimento recente contra baseline de 30 dias |
| Velocidade em vídeo | 25 | crescimento de visualizações e publicações recentes |
| Confirmação cruzada | 20 | quantidade e qualidade de plataformas concordantes |
| Persistência | 15 | presença contínua, sem depender de um único pico |
| Atualidade | 10 | recência do evento ou anúncio que sustenta a pauta |

### Viabilidade editorial — 0 a 100

| Componente | Peso | Medida candidata |
|---|---:|---|
| Fonte utilizável | 30 | quantidade de fontes verdes recentes e verificáveis |
| Transformabilidade | 25 | possibilidade de acrescentar análise, contexto ou comparação |
| Repetibilidade | 20 | expectativa de novas pautas por pelo menos quatro semanas |
| Saturação inversa | 15 | espaço editorial frente à oferta de conteúdo equivalente |
| Aderência operacional | 10 | idioma, custo, tempo e capacidade do operador |

`nota final = 0,60 × tendência + 0,40 × viabilidade editorial`.

A fórmula é hipótese inicial de R01. Pesos só mudam com decisão registrada e
comparação retroativa, evitando ajustar o ranking para justificar preferências.

## Gates antes do top 5

Um nicho não entra no conjunto de trabalho quando:

- depende apenas de uma plataforma ou de um pico isolado;
- não possui pauta nova suficiente para quatro semanas;
- não apresenta ao menos uma fonte verde recente;
- depende de vazamento, origem desconhecida ou repost integral;
- exige afirmações que o operador não consegue verificar;
- viola segurança editorial ou políticas aplicáveis.

Pode continuar no radar como `observação`, mas não recebe lote nem publicação.

## Estabilidade e diversidade

- Recalcular sinais diariamente e promover o `top 5` uma vez por semana.
- Exigir duas execuções consecutivas elegíveis para um novo nicho entrar.
- Remover somente após três execuções abaixo do corte ou falha de gate.
- Limitar a dois micronichos do mesmo macronicho no `top 5`.
- Preservar uma vaga para candidato emergente, sem substituir todo o portfólio.
- Registrar score, posição, fontes e motivo de entrada/saída em cada rodada.

Essas regras evitam portfólio instável, concentração em um único evento e seleção
dominada por preferências subjetivas.

## Validação manual em R01

Antes de implementar, executar duas rodadas manuais separadas por pelo menos sete
dias. Cada rodada deve:

1. listar no mínimo 20 candidatos;
2. calcular os dois scores com evidência disponível;
3. aplicar gates e produzir o `top 5`;
4. registrar divergências entre fontes;
5. medir tempo ativo, espera e custo da descoberta;
6. selecionar três nichos elegíveis e diversos para os lotes do baseline.

G0 só avança quando três lotes reais puderem ser executados a partir do `top 5`.
Uma rodada única demonstra o instrumento, mas não comprova estabilidade.

## Caminho para R02

R02 compara busca manual com ao menos uma fonte/API oficial e automatiza somente
o menor sinal que reduzir tempo sem comprometer explicabilidade. Ordem candidata:

1. YouTube Data API por `regionCode=BR` e categoria;
2. feeds oficiais cadastrados por macronicho;
3. Google Trends API, se o acesso alfa estiver disponível;
4. validação assistida no TikTok Creative Center e superfícies Meta;
5. fallback manual exportável quando não houver API permitida.

Não será criado coletor genérico de páginas nem dependência de API não oficial
como base obrigatória do produto.

## Fontes oficiais consultadas

- Google Trends API alfa:
  <https://developers.google.com/search/apis/trends>
- YouTube `videos.list`, incluindo `mostPopular` por região/categoria:
  <https://developers.google.com/youtube/v3/docs/videos/list>
- YouTube `search.list`, incluindo data, região, idioma e ordenação:
  <https://developers.google.com/youtube/v3/docs/search/list>
- TikTok Creative Center:
  <https://ads.tiktok.com/help/article/creative-center>
- TikTok, uso da área Trends:
  <https://ads.tiktok.com/resources/help/article/how-to-use-trends?lang=pt>
