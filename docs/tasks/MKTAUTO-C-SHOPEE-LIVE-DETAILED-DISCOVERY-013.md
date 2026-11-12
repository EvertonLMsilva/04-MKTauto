# MKTAUTO-C-SHOPEE-LIVE-DETAILED-DISCOVERY-013

Preparação em 12/11/2026, America/Sao_Paulo.

**TASK_STATUS: READY_FOR_OPERATOR_APPROVAL.** A confirmação específica da consulta
real C-013 ainda não foi recebida. Nenhuma chamada real foi executada nesta task.

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

## Gate da consulta real — pendente

O aceite financeiro provisório é mantido:

```text
COST_STATUS: PROVISIONAL_NO_CHARGE_ASSUMPTION_OPERATOR_ACCEPTED
QUOTA_STATUS: NOT_VERIFIED
LIVE_QUERY_AUTHORIZATION: PENDING_EXPLICIT_C013_CONFIRMATION
REQUEST_COUNT: 0 real nesta task
LIVE_DETAILED_DISCOVERY_STATUS: NOT_EXECUTED
LINK_GENERATION_STATUS: NOT_EXECUTED
```

Essa premissa não comprova gratuidade e não é um grant operacional. O PR não
autoriza HTTP. A confirmação da C-012 não pode ser reutilizada.

Antes de qualquer HTTP C-013, apresentar e confirmar com o operador:

1. HEAD exato publicado e checkout/compilado correspondente; sem alterações
   locais em código de execução.
2. Script `scripts/shopee-affiliate-detailed-once.mjs`, no worktree desta entrega.
3. Comando proposto abaixo, com o mecanismo .env existente, sem imprimir ou
   copiar valores e preservando SHOPEE_AFFILIATE_MODE=fake no backend.
4. Exatamente uma tentativa de leitura, page=1/limit=1, sem nova página,
   mutation, retry, download, cadastro, banco, campanha ou publicação.
5. Aceitação explícita do risco financeiro desse novo perímetro, sob a premissa
   provisória já declarada e com quotas não verificadas.

**Comando futuro proposto — não executado com credenciais reais nesta task:**

```text
node --env-file-if-exists=D:\04-Projetos\23-MKTauto\.env scripts/shopee-affiliate-detailed-once.mjs --execute-once
```

O flag foi exercitado somente na função com doubles; o processo CLI real foi
executado apenas sem argumentos. Não há leitura de credenciais reais nesses
ensaios.

Se houver confirmação específica, executar uma vez e preservar somente JSON
sanitizado. Qualquer falha, timeout, HTTP 401/403/429, erro GraphQL ou resultado
incerto encerra a autorização desta task; não repetir nem ajustar o contrato
automaticamente para obter sucesso. Um novo processo não é um mecanismo de
retry autorizado e exige avaliação humana do escopo.

## Estado de entrega

Runner e validação offline concluídos. T06 permanece parcial aguardando a
confirmação específica; T08 encerra a preparação com READY_FOR_OPERATOR_APPROVAL.
Progresso: oito subtópicos, sete concluídos, um parcial, zero pendentes e um
faltante. Um único Draft PR; merge exclusivo do usuário.

Nenhuma homologação real detalhada foi realizada nesta entrega. Mesmo após uma
página válida, não ficam homologados paginação multipágina, ranking com amostra
real, geração de links, direitos de mídia, elegibilidade de produto ou campanha
comercial. C-010 continua BLOCKED_EXTERNAL_EVIDENCE.
