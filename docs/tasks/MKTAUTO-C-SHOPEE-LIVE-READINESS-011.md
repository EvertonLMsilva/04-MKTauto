# MKTAUTO-C-SHOPEE-LIVE-READINESS-011

Auditoria realizada em **12/11/2026, America/Sao_Paulo**. O smoke abaixo é um
plano futuro condicionado; este documento **não autoriza sua execução**.

## Estado

| Dimensão | Resultado |
| --- | --- |
| IMPLEMENTATION_STATUS | Implementação existente; validação de configuração corrigida após reprodução |
| OFFLINE_VALIDATION_STATUS | PASS — 175 testes, seis arquivos |
| LIVE_AUTHENTICATION_STATUS | NOT_EXECUTED |
| LIVE_DISCOVERY_STATUS | NOT_HOMOLOGATED |
| LIVE_LINK_GENERATION_STATUS | NOT_HOMOLOGATED |
| CREDENTIAL_CONFIGURATION_STATUS | NOT_VERIFIED — nenhum valor/arquivo privado acessado |
| COST_STATUS | BLOCKED_COST_UNCONFIRMED |
| QUOTA_STATUS | NOT_VERIFIED |
| OPERATOR_AUTHORIZATION_STATUS | Nenhuma autorização/grant emitido nesta tarefa |
| LIVE_CALLS_EXECUTED | 0 requisições à API |

Worktree exclusivo: `D:\04-Projetos\_worktrees\mktauto-c-shopee-live-readiness-011`.
Branch: `codex/c-shopee-live-readiness-011`.
Base: `026c1dfb9f34e13ff09dacd3370e563b0589ff50`.
PRs #163, #166, #170, #178, #184, #191 e #193 confirmados como integrados.
C-010 continua **BLOCKED_EXTERNAL_EVIDENCE**, sem aceite de produto real.

## T01 — Integração existente

- `ShopeeAffiliateLive`: transporte oficial com tentativa única por instância;
  consulta mínima, página detalhada ou geração de link são operações separadas.
- `ConfiguredShopeeAffiliate`: fachada do provider Nest, cria transporte por
  operação e exige capability operacional antes de HTTP. FAKE é o padrão.
- `ShopeeCatalogService`: descoberta paginada, deduplicação e geração de link
  pelo port existente, sem outro cliente HTTP.
- `ShopeeDynamicService`: configura projeto/nicho/filtros, classifica e ordena
  ofertas, verifica evidências e prepara catálogo transacional. Replay,
  `recoverCycle`, `inspectLink` e `reconcileLink` usam evidência persistida.
- Sem autorizações por item, a descoberta continua e produz WAITING. Mídia e
  aprovação comercial bloqueiam o link; associação bloqueia o cadastro.
- #193 acrescentou preview a partir de projeto sem campanha, autenticado e
  **exclusivamente FAKE** (`SHOPEE_PREVIEW_OFFLINE_ONLY` fora desse perímetro).
  Não equivale a autorização de descoberta LIVE por projeto.
- O runner standalone usa o mesmo transporte. Não inicializa Nest, scheduler,
  catálogo, banco ou fluxo de publicação.

## T02 — Autenticação e controles estáticos

Variáveis do provider: `SHOPEE_AFFILIATE_MODE` (padrão `fake`, aceita `live`),
`SHOPEE_AFFILIATE_APP_ID` e `SHOPEE_AFFILIATE_SECRET`. O runner lê apenas App ID
e Secret quando a execução explícita é solicitada; não precisa mudar o modo
do runtime Nest. A presença ou validade de valores reais não foi investigada.

A assinatura implementada corresponde ao código público do Explorer legado:
SHA-256 hexadecimal sobre `appId + timestamp + payload + secret`, com timestamp
em segundos arredondado para cima e o mesmo JSON UTF-8 assinado e transmitido.
Headers: Content-Type JSON e Authorization no formato SHA256 com Credential,
Timestamp e Signature. Fonte: [Explorer oficial](https://open-api.affiliate.shopee.com.br/explorer),
consultado em 12/11/2026; evidência documental de formato, sem autenticação remota.

Endpoint fixo previsto: `https://open-api.affiliate.shopee.com.br/graphql`.
Esse endpoint **não foi acessado**. Timeout de 10 segundos, máximo de 262144
bytes, redirecionamento manual com rejeição de 3xx, cookies omitidos e nenhuma
nova tentativa automática. O deadline abrange headers e leitura do corpo.

Falhas são sanitizadas: HTTP 401/403, GraphQL, JSON/contrato inválidos, tamanho,
timeout e transporte. Somente códigos públicos permitidos saem do transporte;
mensagens, causas e respostas brutas não entram no relatório. Códigos numéricos
tratados localmente: 10000, 10010, 10020, 10030, 10035 e 11001. Seus significados
atuais por conta não foram homologados remotamente. Dados parciais acompanhados
de erros GraphQL são rejeitados. HTTP 429 encerra a tentativa, sem retry.

### Defeito reproduzido e correção mínima

O provider rejeitava credenciais apenas em branco, mas o transporte direto do
runner aceitava strings compostas por espaços/tabulação/quebra de linha. Três
testes com credenciais sintéticas demonstraram que a operação alcançava o double
HTTP em vez de falhar na configuração. Os três testes falharam antes da correção.

`ShopeeAffiliateLive` agora verifica conteúdo não branco antes de criar uma
tentativa. Configuração inválida retorna `SHOPEE_LIVE_CREDENTIALS_MISSING`, sem
HTTP. Valores aceitos são preservados byte a byte; não são aparados antes da
assinatura. Nenhum provider, contrato remoto ou gate operacional foi substituído.

## T03 — Contrato: evidência documental, fixture e API real

O HTML público do [Explorer V2 oficial](https://open-api.affiliate.shopee.com.br/explorer/v2)
contém `SCHEMA` em JSON, extraído sem executar JavaScript, preencher credenciais,
usar introspecção remota ou acionar a API. Consulta em 12/11/2026. SHA-256 do HTML
observado: `86F095E1BF38AEDA6C6B922737F231FCC9C10F321A40D8334BCAB435178F99A2`.

| Elemento | Conferência documental no SCHEMA público |
| --- | --- |
| productOfferV2 | Query; ProductOfferConnectionV2; page/limit Int, defaults 1/20; keyword String; sortType/productCatId Int |
| Produto/loja | itemId/shopId Int64; nomes, URLs, preços e comissões String |
| Paginação | page/limit Int, hasNextPage Boolean; scrollId String não usado como argumento pelo MKTauto |
| generateShortLink | Mutation; input ShortLinkInput obrigatório; retorno ShortLinkResult |
| Link | originUrl String obrigatório; subIds lista String opcional; shortLink String |

O MKTauto seleciona campos existentes: identidade, productName, shopName,
price/priceMin/priceMax, commission/commissionRate, imageUrl, productLink,
offerLink e pageInfo. Mantém Int64 textual, decimais exatos, desconhecidos como
null e comissão como estimativa. SubIDs e URLs passam pela política local
restritiva de hosts/formato. Isso não comprova associação comercial ou licença.

Fixtures comprovam serialização, normalização, paginação e falhas previstas.
Compatibilidade documental não comprova autenticação, comportamento da conta,
comissões reais ou quotas. Nenhum desses contratos foi validado por API real
nesta tarefa. O smoke mínimo tampouco homologa a consulta detalhada ou mutation.

## T04 — Custos, quotas e acesso

Fontes públicas oficiais consultadas em 12/11/2026:

| Fonte | Escopo e resultado |
| --- | --- |
| [Explorer BR legado](https://open-api.affiliate.shopee.com.br/explorer) e [V2](https://open-api.affiliate.shopee.com.br/explorer/v2) | Formato técnico/SCHEMA; não estabeleceram preços, franquia ou rate limit aplicável ao aplicativo/conta |
| [Portal Open API BR](https://affiliate.shopee.com.br/open_api) | Página pública dependente de JavaScript; sem condições verificadas de acesso da conta ou preço |
| [API Access — Shopee Singapore](https://help.shopee.sg/portal/10/article/191702-API-Access) | Confirma capacidades gerais de ofertas e links; região SG, insuficiente para condições comerciais brasileiras |
| [Pré-requisitos do programa BR](https://help.shopee.com.br/portal/10/article/163025-Pr%C3%A9-requisitos-para-ser-um-Afiliado-Shopee) | Elegibilidade geral do programa; não comprova habilitação API, quotas ou custos da conta |

Não foi encontrada comprovação pública oficial suficiente de ausência de
cobrança por consulta ou link, quota de requisições, frequência permitida,
restrições por app ou habilitação API da conta alvo. Não se afirma que a API é
paga nem gratuita. Custos de terceiros, taxas de vendedor e regras de outras
regiões não foram usados como prova de preço da Affiliate API brasileira.

Limites locais não são quotas oficiais: queries usam páginas 1–100 e tamanho
1–10; descoberta limita a cinco consultas, dez páginas totais e cinco preparos;
o scope operacional define tetos de páginas/links. O runner limita uma tentativa.
**COST_STATUS=BLOCKED_COST_UNCONFIRMED; QUOTA_STATUS=NOT_VERIFIED.**

## T05 — Autorização operacional existente

`POST /operations/campaigns/shopee-live-authorization` usa LocalQcGuard,
sessão/CSRF existentes e ator obtido no servidor. A prévia (`confirmed=false`)
calcula scopeHash sem HTTP nem persistência de grant. Confirmação exige o hash
exato e identidade ativa; scope inclui projeto/configuração, campanha/revisão,
datas, intervalo de validade, periodicidade, maxOfferPages e maxLinks.

O contrato atual exige `costBasis=NO_CHARGE_CONFIRMED` e costEvidenceRef.
Preencher esses campos não constitui prova de custo nem autorização financeira.
O journal impede ampliar o mesmo grant, reserva chamadas e conserva replay.
Grant ausente, expirado ou incompatível falha antes de HTTP. maxLinks=0 não
autoriza mutation. Link incerto não é repetido; recuperação exige descoberta
persistida e reconciliação documental do resultado remoto quando necessário.

Nenhum endpoint operacional foi chamado e nenhum grant foi criado. O runner
standalone não usa esse grant persistido: seu flag explícito não verifica custos
ou anuência humana por si só. As condições do próximo item são pré-requisitos
independentes e obrigatórios para uma futura execução pelo operador.

## T06 — Plano de um único smoke futuro

Estado atual: **BLOCKED_COST_UNCONFIRMED; execução não autorizada por esta task**.

Antes do HTTP, o operador precisa:

1. Apresentar evidência oficial aplicável à conta/app/BR sobre ausência de
   cobrança da consulta proposta, quota e rate limit disponíveis. Geração de
   links é outro escopo e permanece bloqueada. Se houver possibilidade de
   cobrança, este plano não libera execução; exige nova definição financeira.
2. Confirmar habilitação API da conta e carregar App ID/Secret pelo mecanismo
   privado existente, sem entregar valores ao relatório/modelo.
3. Confirmar o código/HEAD a executar e o perímetro exato: uma consulta de leitura,
   uma tentativa, sem link, cadastro, mídia, scheduler ou publicação. Eventual
   anuência histórica condicionada não elimina os gates ainda não comprovados.
4. Dar autorização humana explícita para essa execução concreta, caso o escopo
   ainda não esteja coberto por anuência válida. Não criar grant de scheduler
   para executar um probe standalone.

Somente após os gates, em processo isolado, o comando futuro é:

```text
node scripts/shopee-affiliate-live-once.mjs --execute-once
```

O comando acima **não foi executado nesta tarefa**. Sua query fixa existente é:

```graphql
query ControlledOffers {
  productOfferV2(page: 1, limit: 1) { nodes { itemId } }
}
```

Timeout 10s; teto 262144 bytes; sem redirect/retry; resultado apenas em metadados.
Qualquer erro de autenticação, timeout, HTTP, rate limit ou contrato encerra o
ensaio sem repetição. Zero ofertas em contrato válido não é falha de autenticação.
Registrar status HTTP, autenticação, campos de contrato, quantidade e códigos
permitidos. Nunca registrar assinatura, Secret, resposta bruta ou ofertas.
Não reiniciar/repetir o processo para obter sucesso. Uma execução nova exige
revisão do escopo autorizado; o runner não é um recibo durável entre processos.

O runner foi executado **sem argumentos**, com retorno esperado:
`requestCount=0`, `errorCodes=[EXPLICIT_EXECUTION_REQUIRED]`, exit code 1.
Nenhuma credencial foi necessária ou consultada por esse caminho.

## T07 — Evidência offline

175 testes PASS em seis arquivos; três testes novos reproduzem a divergência
de configuração antes da correção. Nenhum teste recebeu credencial real ou
transporte LIVE real; persistência é SQLite descartável.

| Requisito | Cobertura executada |
| --- | --- |
| 1. Credenciais ausentes | shopee-affiliate-live.spec.ts; shopee-affiliate.spec.ts |
| 2. Configuração inválida | Três novos casos em branco; configuração do provider e queries inválidas |
| 3. Assinatura | Corpo UTF-8 exato, relógio fixo e assinatura esperada no double |
| 4. Autenticação simulada | HTTP 401/403 e códigos GraphQL sanitizados |
| 5. Timeout | Headers, corpo e mutation parados; sem nova tentativa |
| 6. HTTP inválido | 401/403/429/500 |
| 7. Resposta incompatível | JSON/GraphQL parcial, identidade e contratos inválidos |
| 8. Limite de bytes | Content-Length e stream sem tamanho anunciado |
| 9. Redirect | 301/302/307/308 sem segunda chamada |
| 10. Paginação | Limites, próximo número, duplicatas e conflitos |
| 11. Quota interna | Tetos separados de páginas e links no permit |
| 12. Link não autorizado | Falta de capability; maxLinks=0 |
| 13. Grant ausente | shopee-live-authorization.spec.ts |
| 14. Grant expirado | Expiração, configuração/campanha/data incompatíveis |
| 15. Replay | Ciclo/autorizações e reinício sem HTTP duplicado |
| 16. Resultado incerto | CLAIM, reconciliação e recuperação sem repetir mutation |
| 17. Ausência de LIVE | Provider FAKE padrão, doubles e construção sem HTTP |
| 18. Ausência de escrita operacional | Fixtures temporárias; nenhum banco operacional fornecido ou aberto |

Arquivos executados: `shopee-affiliate-live.spec.ts`, `shopee-affiliate.spec.ts`,
`shopee-links.spec.ts`, `shopee-offers.spec.ts`, `shopee-live-authorization.spec.ts`
e `shopee-dynamic.service.spec.ts`. TypeScript (`tsc --noEmit`), build Nest, lint
global e diff-check PASS; somente avisos de lint preexistentes.

Dependências instaladas no worktree exclusivo a partir do lockfile, em modo
offline, sem scripts de instalação e com configurações npm vazias explícitas.
Nenhum outro worktree, manifesto, banco, container ou credencial foi alterado.

## T08 — Fechamento e próxima ação

Oito verificações técnicas concluídas; aceite LIVE continua bloqueado por
evidência externa. Entrega em um Draft PR com a correção reproduzida, testes e
este relatório. Sem merge/deploy. C-010 permanece BLOCKED_EXTERNAL_EVIDENCE e
nenhum teste FAKE equivale a aceite comercial real.

Próxima ação do operador: obter evidência oficial sanitizada das condições de
cobrança, quota/rate limit e habilitação API da conta/app brasileira. Depois,
revisar os pré-requisitos e a anuência da consulta única. Não ativar LIVE,
scheduler ou mutation com base neste relatório.
