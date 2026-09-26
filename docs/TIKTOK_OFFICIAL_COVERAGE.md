# Cobertura oficial do TikTok no radar M1

**Revalidado em:** 26/09/2026

**Contrato:** `trend-contracts/1.0.0`

**Decisão:** `BLOCKED_BY_PROVIDER` para o operador comercial do MVP; execução
condicional pela Research API somente para projeto de pesquisa elegível e
aprovado. Display API é `AUTHORIZED_ONLY` e Content Posting não é descoberta.

## Matriz reproduzível

| Capacidade | Produto e entidade | Acesso exigido | Uso no M1 | Limitação determinante |
|---|---|---|---|---|
| Vídeos públicos por termo, hashtag e região | Research API `/v2/research/video/query/` | Organização elegível, pesquisa não comercial/de interesse público, revisão ética, candidatura e projeto aprovados, cliente de pesquisa, token de cliente e scope `research.data.basic` | Única capacidade oficial confirmada que aceita consultas derivadas dos clusters R02D e pode gerar candidatos | Criadores/anunciantes/usuários comerciais não são elegíveis. O resultado é correspondência de consulta, não ranking global; região é a região de cadastro do criador. |
| Vídeos públicos da conta que autorizou o app | Display API `/v2/video/list/` e `/v2/video/query/` | Login Kit e TikTok API aprovados, autorização do usuário e scope `video.list` | Registrar `AUTHORIZED_ONLY`; não ingerir no radar como tendência pública | Só alcança vídeos da conta autorizada e a lista é ordenada por criação, não popularidade. |
| Publicar na conta autorizada | Content Posting API | App registrado, produto habilitado, autorização e scope `video.publish`; auditoria para remover a restrição de visibilidade privada | Fora do radar | É produto de publicação, não de descoberta. |
| Tendências globais ou feed “For You” | Nenhum endpoint oficial geral confirmado | Não aplicável | `BLOCKED_BY_PROVIDER` | A Research API não representa tendência global e sua elegibilidade não atende ao operador comercial do MVP. |

No Brasil, a página oficial limita candidaturas de Research Tools a instituições
acadêmicas ou organizações sem fins lucrativos que estudem segurança online de
jovens, além dos demais critérios. Ter somente uma conta de desenvolvedor não
concede acesso. O FAQ declara explicitamente que criadores, anunciantes e usuários
comerciais não são elegíveis.

## Fronteira implementada

O adapter `src/adapters/tiktok.js` possui três caminhos semanticamente separados:

1. `RESEARCH_API`: exige todos os flags locais de elegibilidade, token e run com
   clusters persistidos e controles de retenção aprovados antes da primeira
   chamada. Os flags não substituem a validação do TikTok.
2. `DISPLAY_API`: registra a capacidade da conta autorizada como
   `AUTHORIZED_ONLY`, sem chamar o provedor e sem criar candidato de tendência.
3. `CONTENT_POSTING_API`: registra bloqueio porque publicação não é descoberta.

Para Research API, os termos vêm apenas de `label`, `niche` e `subtheme` dos
clusters persistidos, normalizados deterministicamente como hashtags. Cada
consulta combina uma região explícita com uma hashtag. A janela usa datas UTC no
formato `YYYYMMDD`, com máximo local e oficial de 30 dias.

O adapter solicita somente ID, descrição, criação, região, autor, duração,
hashtags e contadores oficiais de views, likes, comentários e compartilhamentos.
Cada candidato usa o ID oficial e a URL pública reconstruída no formato oficial
`https://www.tiktok.com/@<username>/video/<id>`. Ausência ou invalidade de ID,
autor, data, região ou duração descarta o item; nenhum campo é inventado.
Métrica omitida vira `UNAVAILABLE`, enquanto zero retornado continua disponível.

Resultados de 15 a 180 segundos entram no catálogo SQLite v1 e ficam disponíveis
ao ranking determinístico existente. A IA não fornece termos extras, IDs, URLs,
métricas, regiões, elegibilidade ou scores.

## Paginação, quotas e atualização

- Cada resposta pode conter até 100 vídeos. Páginas seguintes reutilizam
  `cursor` e `search_id` retornados pelo provedor.
- A janela entre `start_date` e `end_date` não excede 30 dias.
- O limite oficial padrão informado é 1.000 requisições e até 100.000 registros
  por dia, reiniciado às 00:00 UTC.
- Tokens de cliente usados pela Research API expiram em duas horas.
- Vídeos novos podem levar até 48 horas para aparecer e métricas podem levar até
  dez dias para atualizar. Portanto, a coleta não representa dados em tempo real.
- Os Research Tools Terms exigem atualizar os dados ao menos a cada 30 dias,
  excluir o que já não estiver disponível e não conservar dados além do necessário
  ao projeto aprovado. O período de retenção específico é o da candidatura.
- `maxQueries`, `maxResultsPerPage` e `maxPagesPerQuery` impõem fronteiras locais.

Falhas não bloqueantes são isoladas por consulta; cobertura válida já obtida é
preservada como `PARTIAL`. Autenticação, scope/aprovação, elegibilidade e quota
interrompem novas chamadas e produzem códigos sanitizados. Token, cabeçalhos,
payload bruto, mensagem do provedor, `log_id`, `search_id` e cursor não são
persistidos nem registrados pelo adapter.

## Estado observado e desbloqueio

Nenhum projeto de pesquisa aprovado, scope `research.data.basic` ou token
elegível foi fornecido/configurado neste tópico. Por isso não houve chamada real
nem persistência de evidência externa. Para a persona comercial principal, a
cobertura correta é `BLOCKED_BY_PROVIDER` com a condição:

1. uma organização e finalidade realmente elegíveis — independentes deste MVP
   comercial — obtêm aprovação formal do TikTok para um projeto de pesquisa;
2. o projeto recebe cliente de pesquisa e scope `research.data.basic`;
3. controles de atualização, exclusão e retenção compatíveis com a candidatura
   são aprovados antes da coleta;
4. um token de cliente válido é configurado fora do Git; e
5. a finalidade e o tratamento dos dados permanecem dentro dos termos aprovados.

Uma conta comum que autorize Display API desbloqueia apenas `AUTHORIZED_ONLY`,
jamais descoberta pública/global. O projeto não solicitará elegibilidade em nome
do usuário nem contornará essa restrição.

## Fontes oficiais

- [Display API — visão geral](https://developers.tiktok.com/doc/display-api-overview/)
- [Display API — primeiros passos](https://developers.tiktok.com/doc/display-api-get-started/)
- [Display API — List Videos](https://developers.tiktok.com/doc/tiktok-api-v2-video-list/)
- [Research Tools — produto e elegibilidade](https://developers.tiktok.com/products/research-api/)
- [Research API — primeiros passos](https://developers.tiktok.com/doc/research-api-get-started/)
- [Research API — Query Videos](https://developers.tiktok.com/doc/research-api-specs-query-videos/)
- [Research API — Codebook](https://developers.tiktok.com/doc/research-api-codebook/)
- [Research API — FAQ e quotas](https://developers.tiktok.com/doc/research-api-faq/)
- [Client Access Token Management](https://developers.tiktok.com/doc/client-access-token-management/)
- [Content Posting API — Direct Post](https://developers.tiktok.com/doc/content-posting-api-get-started/)
- [TikTok API v2 — erros](https://developers.tiktok.com/doc/tiktok-api-v2-error-handling/)
- [TikTok Research Tools Terms of Service](https://www.tiktok.com/legal/page/global/terms-of-service-research-api/en)

As capacidades, elegibilidade, quotas e campos devem ser revalidados antes de
qualquer piloto real. Documentação de terceiros não amplia a cobertura.
