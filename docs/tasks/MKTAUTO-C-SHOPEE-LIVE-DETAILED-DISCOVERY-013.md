# MKTAUTO-C-SHOPEE-LIVE-DETAILED-DISCOVERY-013

Preparação em 12/11/2026, America/Sao_Paulo.

**TASK_STATUS: DONE.** Após a preparação offline, o operador confirmou
explicitamente UMA consulta C-013 no HEAD
`e7a32205d82ad876b95f341af2119152b50b8d2d`. A tentativa autorizada foi executada
uma vez: HTTP 200, autenticação SUCCESS e uma oferta normalizada. A autorização
está consumida; não permite repetição, página adicional ou mutation.

## Baseline e preservação

- Base: `48037f2c51397df8a9094b6a3e5315b3936e5f16`, PR #194 integrado.
- Branch: `codex/c-shopee-live-detailed-discovery-013`.
- Worktree: `D:\04-Projetos\_worktrees\mktauto-c-shopee-live-detailed-discovery-013`.
- C-012 comprovou uma consulta mínima com HTTP 200, autenticação SUCCESS e uma
  oferta; a autorização de sua única tentativa está consumida. Isso não homologa
  detalhes comerciais, paginação ou links e não autoriza C-013.
- C-010 permanece BLOCKED_EXTERNAL_EVIDENCE.
- Nenhum provider, contrato de domínio, normalizador, assinatura, variável,
  arquivo .env, banco operacional, scheduler ou código de outra frente foi alterado.

## Implementação reutilizada

O novo script `scripts/shopee-affiliate-detailed-once.mjs` cria uma única instância
de `ShopeeAffiliateLive` e chama somente:

```js
await live.queryOfferPage({ page: 1, limit: 1 });
```

Usa o query builder, transporte e normalizador existentes. Não constrói cliente
HTTP, assinatura, query GraphQL alternativa, catálogo ou ranking. `discover` e
`ShopeeDynamicService` permanecem intactos; o probe não chama esses fluxos nem
seus loops de paginação.

Campos solicitados pelo contrato existente: itemId, shopId, productName,
shopName, price, priceMin, priceMax, priceDiscountRate, commission, commissionRate,
imageUrl, productLink, offerLink e pageInfo. Int64 continua textual e decimais
continuam strings exatas. Null significa desconhecido. Moeda, estoque e descrição
não são inferidos; comissão é estimativa, não receita realizada. Proveniência
normalizada continua SHOPEE_LIVE, inclusive quando exercitada por doubles.

Uma instância, uma página, um produto no máximo, uma tentativa. Timeout 10s,
máximo 262144 bytes, 3xx bloqueados e nenhum retry. `hasNextPage=true` é apenas
registrado; nunca causa outra consulta. Sem link, banco, mídia, cadastro,
campanha, publicação, grant, reserva financeira ou servidor Nest.

Sem o argumento exato `--execute-once`, retorna `requestCount=0`,
`EXPLICIT_EXECUTION_REQUIRED` e exit code 1. O guard vem antes da leitura de
credenciais, carregamento do transporte e consulta ao Git. O processo CLI sem
argumentos foi validado nesse modo, sem carregar .env.

## Saída sanitizada

O script escreve somente JSON em stdout. Não cria arquivos de dados.

- Data/hora UTC e commit Git de 40 caracteres; falha fechada se o commit não
  estiver disponível. O HEAD exato da entrega será informado com o PR/retorno.
- Status HTTP, autenticação, requestCount, operação e offersReturned.
- presentFields/missingFields identificam chaves presentes no contrato retornado;
  uma chave com valor null pode estar presente. As listas não contêm valores.
- validatedTypes descreve tipos normalizados; NULL não é convertido em zero.
  Sem oferta, o tipo é NOT_OBSERVED. Comissão é DECIMAL_STRING_ESTIMATE.
- pageInfo contém apenas estado, page, limit e hasNextPage.
- fieldObservationStatus diferencia resultado não avaliado e página normalizada.
- Códigos de erro passam por allowlist; nenhum corpo/mensagem/causa é emitido.

Indicadores booleanos:

```text
HAS_PRODUCT_ID  HAS_SHOP_ID  HAS_PRODUCT_NAME  HAS_SHOP_NAME
HAS_PRICE  HAS_PRICE_RANGE  HAS_COMMISSION  HAS_COMMISSION_RATE
HAS_IMAGE_URL  HAS_PRODUCT_URL  HAS_OFFER_URL
```

FALSE significa que o valor não foi observado como disponível; só deve ser
interpretado junto com fieldObservationStatus. Nenhum ID real, nome de produto
ou loja, URL, preço, comissão, App ID, Secret, header, assinatura ou hash de
credencial é registrado. Uma resposta vazia válida mantém autenticação SUCCESS,
mas não comprova os campos de um produto.

## Validação offline

30 testes novos, com credenciais sintéticas e fetch doubles. O teste integrado
observa internamente o retorno do transporte existente para confirmar precisão
e proveniência, mas o runner continua expondo apenas tipos e indicadores.

| Requisito | Evidência |
| --- | --- |
| 1. Sem flag | Arrays vazios/argumentos extras/flag duplicada e processo Node sem argumentos recusados |
| 2. Credenciais ausentes | Zero HTTP e erro sanitizado |
| 3. Configuração inválida | Credenciais em branco rejeitadas antes do HTTP |
| 4. Uma tentativa | Fetch chamado uma vez com page=1/limit=1 |
| 5. Página detalhada válida | Metadados, indicadores e tipos corretos |
| 6. Opcionais ausentes | Null preservado, indicadores FALSE e campos ausentes listados |
| 7. Int64 textual | String grande e lexema numérico JSON inseguro preservados pelo transporte |
| 8. Preços decimais | Precisão exata preservada; Number inválido rejeitado |
| 9. Comissão estimada | Decimais exatos; rótulo de estimativa sem receita registrada |
| 10. URLs | HTTPS aceito; URL incompatível rejeitada; valores ausentes da saída |
| 11. pageInfo | Page/limit/hasNextPage verificados; nenhuma página seguinte |
| 12. GraphQL | Dados parciais com erro rejeitados; só código público permanece |
| 13. HTTP 401/403 | Uma tentativa, autenticação FAILURE, corpo descartado |
| 14. HTTP 429 | Encerra sem retry |
| 15. Timeout | Relógio fake, limite existente de 10s, sem nova tentativa |
| 16. Resposta inválida | JSON, paginação, identidade, cardinalidade, preços e URLs inválidos |
| 17. Sem retry | Contador de fetch verificado nos caminhos positivos e de erro |
| 18. Sem vazamento | Sentinelas de credenciais, IDs, nomes, URLs e valores comerciais ausentes |
| 19. Sem link | Query sem mutation/generateShortLink; nenhum outro método usado |
| 20. Sem escrita operacional | Runner sem armazenamento comercial; checkout e modo preservados nos testes |

167 testes de regressão PASS em cinco arquivos: probe novo, transporte,
provider, ofertas/normalização e links. Após ajustar somente a tipagem do double,
os 30 testes novos passaram novamente. TypeScript, build, lint global incluindo
o script novo e diff-check PASS. Avisos de lint preexistentes fora do escopo.

Dependências instaladas neste worktree pelo lockfile, offline, sem scripts de
instalação e com configurações npm vazias explícitas. Nenhum .env privado foi
lido durante a preparação; não foram acessados bancos operacionais.

## Confirmação e resultado da consulta real

O aceite financeiro provisório é mantido:

```text
COST_STATUS: PROVISIONAL_NO_CHARGE_ASSUMPTION_OPERATOR_ACCEPTED
QUOTA_STATUS: NOT_VERIFIED
LIVE_QUERY_AUTHORIZATION: EXPLICIT_C013_CONFIRMATION_RECEIVED_AND_CONSUMED
REQUEST_COUNT: 1 real nesta task
HTTP_STATUS: 200
LIVE_AUTHENTICATION_STATUS: VERIFIED
OFFERS_RETURNED: 1
LIVE_DETAILED_DISCOVERY_STATUS: VALIDATED_SINGLE_PAGE
LINK_GENERATION_STATUS: NOT_EXECUTED
```

Essa premissa não comprova gratuidade e não é um grant operacional. O PR não
autoriza HTTP; a consulta ocorreu por confirmação humana específica posterior.
A confirmação da C-012 não foi reutilizada.

Perímetro apresentado e confirmado pelo operador antes do HTTP:

1. HEAD exato publicado e checkout/compilado correspondente; sem alterações
   locais em código de execução.
2. Script `scripts/shopee-affiliate-detailed-once.mjs`, no worktree desta entrega.
3. Comando proposto abaixo, com o mecanismo .env existente, sem imprimir ou
   copiar valores e preservando SHOPEE_AFFILIATE_MODE=fake no backend.
4. Exatamente uma tentativa de leitura, page=1/limit=1, sem nova página,
   mutation, retry, download, cadastro, banco, campanha ou publicação.
5. Aceitação explícita do risco financeiro desse novo perímetro, sob a premissa
   provisória já declarada e com quotas não verificadas.

**Comando executado uma vez no HEAD autorizado — não repetir nesta task:**

```text
node --env-file-if-exists=D:\04-Projetos\23-MKTauto\.env scripts/shopee-affiliate-detailed-once.mjs --execute-once
```

Durante a preparação, o flag foi exercitado somente na função com doubles e o
processo CLI foi executado sem argumentos. Depois da confirmação, o processo
real foi executado uma vez, com credenciais carregadas pelo mecanismo .env
existente sem exibir valores, representações ou conteúdo privado.

Resultado às **01:59:21 BRT de 12/11/2026** (04:59:21.811Z): todos os 14 campos
solicitados presentes, nenhum ausente, nenhum código de erro. Indicadores
HAS_PRODUCT_ID, HAS_SHOP_ID, HAS_PRODUCT_NAME, HAS_SHOP_NAME, HAS_PRICE,
HAS_PRICE_RANGE, HAS_COMMISSION, HAS_COMMISSION_RATE, HAS_IMAGE_URL,
HAS_PRODUCT_URL e HAS_OFFER_URL: todos TRUE.

Tipos observados: itemId/shopId como INT64_STRING; preços como DECIMAL_STRING;
comissão/taxa como DECIMAL_STRING_ESTIMATE; desconto como INTEGER; nomes como
STRING; URLs como HTTPS_STRING. Nenhum valor de produto, preço, comissão, ID,
nome ou URL foi persistido. pageInfo validado: page=1, limit=1,
hasNextPage=true. Nenhuma segunda página foi consultada.

Relatório sanitizado novo, criado exclusivamente sem sobrescrever arquivos:
`D:\04-Projetos\MKTauto-runtime\acceptance\C\MKTAUTO-C-SHOPEE-LIVE-DETAILED-DISCOVERY-013-20261112T045921811Z-108071c8-bbc7-424c-85bd-189e379d5314.jsonl`.
Contém somente intenção de execução e resultado sanitizado; nenhum corpo bruto.

Preflight confirmou checkout limpo, runner igual ao commit autorizado e compilado
correspondente ao fonte. Comparação interna de bytes confirmou .env inalterado,
sem imprimir conteúdo ou hashes. Modo fake preservado. Nenhum banco operacional
acessado; zero links gerados, cadastros, downloads, reservas financeiras,
campanhas, scheduler, publicações ou retries. Código permaneceu intacto durante
a execução; após ela, somente este documento foi atualizado.

A confirmação desta task foi consumida. Não repetir o processo, consultar outra
página nem ajustar contratos para ampliar este resultado. Um novo ensaio exige
novo escopo e anuência humana; nenhum grant recorrente foi emitido.

## Estado de entrega

Runner, validação offline e consulta real delimitada concluídos. T06 recebeu
confirmação específica e T08 registra VALIDATED_SINGLE_PAGE. Progresso: oito
subtópicos, oito concluídos, zero parciais, zero pendentes e zero faltantes.
O mesmo Draft PR é atualizado com a evidência, sem outro PR; merge exclusivo do
usuário. Os 167 testes offline e gates anteriores permanecem aplicáveis: não
houve mudança de código após sua validação, apenas documentação do resultado.

Foi validada uma única página real detalhada. Não ficam homologados paginação
multipágina, ranking com amostra
real, geração de links, direitos de mídia, elegibilidade de produto ou campanha
comercial. C-010 continua BLOCKED_EXTERNAL_EVIDENCE.
