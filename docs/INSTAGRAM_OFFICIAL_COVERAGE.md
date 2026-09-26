# R02E — cobertura oficial do Instagram para o radar M1

**Verificação:** 26/09/2026
**Decisão:** cobertura parcial por hashtags quando o acesso for elegível; caso
contrário, `BLOCKED_BY_PROVIDER`. A API não sustenta um ranking global de Reels.

## Matriz reproduzível

| Capacidade | Produto e elegibilidade | Permissões/acesso | Uso no M1 | Limitação determinante |
|---|---|---|---|---|
| Resolver hashtag e consultar mídia pública associada | Instagram API with Facebook Login; conta profissional Business ou Creator vinculada a uma Página | Token da conta consultante, permissões aprovadas e acesso do app compatível com as contas consultadas | `ig_hashtag_search` seguido de `recent_media`, com hashtags derivadas deterministicamente dos clusters R02D | Não é busca textual, feed global ou ranking mundial; ordenação não é garantida. |
| Mídia da conta autorizada | Instagram API with Facebook Login ou Instagram Login, conforme o produto configurado | Autorização da própria conta profissional | Fora do adapter de tendência R02E | Conteúdo autorizado não prova tendência pública. |
| Insights da própria conta/mídia | Produto e permissões de insights aplicáveis à conta profissional | Autorização e revisão correspondentes | Fora de R02E; previsto para R08 | Métrica própria não pode ser atribuída a mídia pública descoberta por hashtag. |
| Conta pessoal/consumer | Não elegível para Instagram API with Facebook Login | Não aplicável | `BLOCKED_BY_PROVIDER` | A API profissional não acessa contas pessoais. |
| Tendências globais, busca livre e filtro regional | Nenhum endpoint oficial confirmado | Não aplicável | Indisponível | Não existe equivalente oficial ao `mostPopular` regional do YouTube. |

O produto com Instagram Login não exige Página vinculada, mas a documentação
oficial consultada não declara a descoberta por hashtags nesse produto. R02E,
portanto, limita o adapter de hashtags ao fluxo com Facebook Login, sem combinar
permissões ou endpoints dos dois produtos.

Para o fluxo de hashtags com Facebook Login, a matriz considera
`instagram_basic` e `pages_read_engagement`, além do acesso/revisão aplicável a
conteúdo público fora das contas com função no app. O token deve representar a
conta profissional consultante vinculada à Página; declarar os flags locais de
elegibilidade não substitui a validação feita pela Meta.

## Fronteira implementada

1. Carregar clusters já persistidos e validados da run R02D.
2. Ordenar clusters por ID e normalizar `label`, `niche` e `subtheme` em hashtags
   sem `#`, espaços, pontuação ou acentos; não há sugestão por IA.
3. Limitar a 30 hashtags por execução. A Meta documenta limite de 30 hashtags
   únicas por conta profissional consultante em uma janela móvel de sete dias;
   a API continua sendo a autoridade para a quota efetiva.
4. Resolver cada termo por `ig_hashtag_search` e consultar `recent_media` com
   paginação por cursor, no máximo 50 itens por página e limite local explícito.
5. Solicitar somente `id`, `media_type`, `media_product_type`, `permalink`,
   `timestamp`, `username`, `caption`, `like_count` e `comments_count`.
6. Normalizar zero oficial como disponível e campo ausente como `UNAVAILABLE`.
   Visualizações, compartilhamentos e duração não são inferidos.
7. Isolar falha não bloqueante por hashtag. Autenticação, permissão/revisão e
   quota interrompem novas chamadas e geram códigos sanitizados.
8. Persistir atomicamente apenas a run, a cobertura e contagens sanitizadas. O
   token vai em `Authorization`, e cabeçalhos, payload bruto, cursor e URL de
   mídia nunca entram no catálogo ou nos logs do adapter.

O contrato `trend-contracts/1.0.0` ainda nomeia a dimensão de cobertura como
`requestedRegions`/`coveredRegions`. Para não reformar o schema neste tópico, o
adapter grava valores tipados `HASHTAG:<termo>` nesses arrays e declara que
`supportsRegions=false`.

## Por que a mídia não entra no ranking nesta versão

O objeto público retornado pela busca de hashtags não expõe a duração do vídeo.
O contrato vigente exige `durationSeconds` oficial entre 15 e 180 segundos para
todo `TrendCandidate`, e o ranking usa esse intervalo como gate. Portanto:

- a evidência é validada e contabilizada, mas não vira candidato persistido;
- a fonte fica `PARTIAL` com
  `DURATION_UNAVAILABLE:INSTAGRAM_HASHTAG_MEDIA` e
  `INSTAGRAM_PUBLIC_MEDIA_NOT_RANKABLE`;
- duração, ID, URL ou métricas nunca são inventados;
- candidatos e rankings existentes do YouTube não são removidos nem regravados.

Condição de desbloqueio para ranking Instagram: a API oficial passar a retornar
duração pública adequada ou um novo tópico aprovar evolução versionada do
contrato e um método oficial, sem download de mídia, para verificar o intervalo.

## Configuração e validação real

Uma chamada real exige, de forma explícita:

- `accessToken`;
- `igUserId` numérico da conta profissional consultante;
- `apiVersion` configurada, sem versão implícita;
- confirmação de conta profissional, Página vinculada, permissões concedidas e
  acesso/revisão do app aprovado.

Sem qualquer desses itens, o adapter não chama a Meta e persiste bloqueio
acionável. Nenhuma credencial elegível estava configurada durante R02E; por isso
não houve validação externa nem persistência de evidência real.

## Fontes oficiais

- [Instagram API — workspace oficial da Meta](https://www.postman.com/meta/instagram/overview)
- [Instagram API with Facebook Login — coleção oficial](https://www.postman.com/meta/instagram/folder/u4g5a2a/instagram-api-with-facebook-login)
- [Instagram API with Instagram Login — documentação oficial](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api)
- [Instagram Hashtag Search](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/hashtag-search)
- [IG Hashtag Search reference](https://developers.facebook.com/docs/instagram-platform/reference/ig-hashtag-search)
- [Instagram Media reference](https://developers.facebook.com/docs/instagram-platform/reference/instagram-media)

As versões, permissões, limites e revisão são revalidados antes de qualquer
piloto real. Material de terceiros não autoriza ampliar capacidades.
