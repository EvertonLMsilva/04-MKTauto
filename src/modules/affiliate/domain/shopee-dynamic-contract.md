# SHOPEE-DYNAMIC-MVP-001 — contrato de aquisição

## Atualização LIVE-003 — autorização operacional restritiva

Implementação validada offline sobre `a38b7153a0a43f08a6be74479b945e761e3bb4ad`.
Isto não é homologação LIVE, autorização de consulta ou ativação operacional.

Selecionar `SHOPEE_AFFILIATE_MODE=live` continua sem autorizar HTTP. A facade
`ConfiguredShopeeAffiliate` exige capacidade interna por contexto assíncrono,
com validade e limites separados para leituras e links. Fora desse contexto,
falha antes do transporte. A classe de transporte single-use e o probe isolado
permanecem com seu contrato explícito anterior; não são o scheduler.

O Operations autenticado (sessão/CSRF via `LocalQcGuard`) disponibiliza
`POST /operations/campaigns/shopee-live-authorization`:

1. Enviar `{configuration, scope, confirmed: false}` para obter a prévia e
   `scopeHash`, sem HTTP Shopee ou grant persistido.
2. Após revisão humana, enviar a mesma configuração/escopo com `confirmed: true`
   e `expectedScopeHash`. O servidor associa o ator autenticado e persiste o
   grant imutável no journal existente; ainda não consulta a Shopee.
3. Ativar explicitamente pelo endpoint existente
   `POST /operations/campaigns/shopee-dynamic`, usando
   `{request, configuration, authorizationId}`. Este passo poderá executar as
   operações autorizadas; não é autorizado nesta T01 nem substitui o smoke.

`scope` tem exatamente os campos de `ShopeeLiveAuthorizationScope`:

```ts
{
  authorizationId, campaignId, campaignRevision,
  productionDates, // datas civis explícitas, únicas, máximo 31
  notBefore, expiresAt, // ISO com timezone, validade máxima 32 dias
  maxOfferPages, // orçamento por ciclo, igual ao maxPages da configuração
  maxLinks, // 0 bloqueia novas mutações sem marcar resultado remoto incerto
  periodic, // true obrigatório para autorizar mais de uma data
  evidenceRef,
  costBasis: 'NO_CHARGE_CONFIRMED',
  costEvidenceRef
}
```

São referências de evidência declaradas pelo operador, não uma verificação
automática de cobrança. Sem comprovação aplicável de ausência de cobrança,
este gate não autoriza a chamada; operações pagas continuam fora deste contrato
e exigem fluxo financeiro/orçamento próprio. Não há custo zero presumido.

O hash revisado inclui modo LIVE, projeto, campanha/revisão, configuração
normalizada completa, datas, limites e evidências. Os ciclos são derivados pelo
servidor de campanha/data; não cabe ao operador escolher IDs técnicos diários.
Cada tentativa HTTP recebe reserva append-only no journal antes do transporte.
Replay não repete chamadas; uma reserva incerta nunca é apagada para tentar de
novo. Uma autorização não pode ser ampliada reutilizando o mesmo identificador.

O histórico da recorrência registra modo e authorizationId. Mudar a variável
de ambiente não promove recorrência FAKE/histórica para LIVE. A recorrência
FAKE controlada continua protegida, com LOCAL_ONLY e publicação DISABLED.
Datas não autorizadas, grants expirados, outro projeto/campanha/revisão ou
configuração alterada bloqueiam a aquisição antes de HTTP. Ocorrências já
reservadas conservam seu produto e não consultam novamente. O scheduler não é
habilitado por esta configuração. Não há novo catálogo, timer ou migração.

Elegibilidade, direitos, associação comercial e rotação permanecem os anteriores:
gerar um link não muda `associationVerified: false`. Sem evidências adequadas,
o candidato fica WAITING. Autorização de transporte não concede direitos de
mídia, aprovação comercial, permissão de publicação ou autorização financeira.

### Primeiro smoke futuro — ainda não autorizado

O runner existente `scripts/shopee-affiliate-live-once.mjs` consulta somente
`productOfferV2(page: 1, limit: 1) { nodes { itemId } }`. Ele não inicia Nest,
não gera link, não abre banco, não baixa imagem e imprime apenas metadados
sanitizados. Homologa autenticação/contrato mínimo; não comprova direitos,
associação ou operação comercial completa.

Após autorização específica e confirmação de custo/limites aplicáveis, o comando
previsto, a partir do checkout confirmado e com build correspondente, é:

```powershell
node --env-file="<arquivo privado autorizado>" scripts/shopee-affiliate-live-once.mjs --execute-once
```

Não executar esse comando nesta T01. Perímetro proposto: uma requisição POST ao
endpoint fixo oficial `https://open-api.affiliate.shopee.com.br/graphql`, timeout
10 segundos, resposta máxima 256 KiB, sem redirects ou retries. Credenciais
privadas permanecem apenas na memória do processo. Relatório: requestCount,
httpStatus, authentication, operation, offersReturned, contractFields e
errorCodes; sem headers, assinatura, credenciais, ofertas ou corpo remoto.

Custos e quotas oficiais continuam não comprovados pela evidência local. Os
limites acima são controles do cliente, não quotas atribuídas à Shopee. O smoke
exige consentimento próprio e não autoriza consultas periódicas ou mutações.
Não houve probe real, grant operacional, alteração de SQLite LIVE, ativação de
scheduler, publicação, deploy ou merge nesta implementação.

Evidência offline desta atualização: 221 testes distintos focados aprovados,
incluindo 14 cenários novos e o e2e diário HTTP existente. Foram verificados
scopeHash/ator/autenticação, bloqueio padrão, ausência de credenciais, expiração,
limites de leitura/mutação, grant imutável, FAKE não promovido, D1/D2 com HTTP
simulado e direitos de fixture, replay, concorrência, restart e recuperação após
parada sem repetir HTTP ou link incerto. TypeScript, build, lint do escopo e
diff-check passaram; lint type-aware mantém avisos em testes e código legado.
Nenhum resultado offline é apresentado como homologação autenticada real.

As seções seguintes descrevem o contrato de aquisição original. A dependência
histórica com Operations ali registrada foi atendida no PR #160; a ativação
LIVE agora depende dos gates acima, sem remover as proteções de conteúdo.

Base: `5915d31d361e6b8240a2891135be059b53d6bef1`. Persona: operador individual
de canais temáticos. Implementação validada offline; LIVE não homologado.

## Entrada operacional

`AffiliateModule` exporta `ShopeeDynamicService`:

- `configure(configuration)`: configuração inicial/revisada por projeto. Persiste
  nicho, consultas, limites, regras comerciais e autorizações. O nicho deve
  coincidir com o Project atual. A configuração não consulta a Shopee.
- `runCycle(projectId, cycleId)`: descobre, filtra, classifica, gera/reutiliza links,
  verifica evidências e prepara o catálogo existente. A identidade do ciclo é
  estável por ocorrência. Replay retorna o resultado congelado sem transporte.
- `recoverCycle(projectId, cycleId)`: retoma descoberta já persistida e comandos
  locais após parada do worker. Não inicia consultas nem novas mutações remotas.
  Sem descoberta completa persistida, uma nova ocorrência pode consultar novamente;
  o ciclo interrompido não recebe resultados inventados.
- `inspectLink(callId)`: retorna identidade, origem, produto/oferta/loja, projeto,
  campanha, SubIDs enviados, proveniência e resultado registrado. Não verifica a
  associação comercial. Permite reunir a evidência inicial de associação exata.
- `reconcileLink(callId, {url, sourceRef, recordedAt})`: registra resultado remoto
  confirmado externamente pelo operador, sem repetir a chamada. Não confirma
  direitos ou associação comercial. Resultados contraditórios são rejeitados.

Não há endpoint, timer, segundo catálogo ou scheduler adicional. A entrada é um
serviço Nest exportado, pronto para o consumidor de Operations. Configurações e
provas operacionais ficam no SQLite privado, nunca em fixtures ou no Git.

## Provider e limites

`SHOPEE_AFFILIATE_MODE` ausente mantém `fake`. `live` exige
`SHOPEE_AFFILIATE_APP_ID` e `SHOPEE_AFFILIATE_SECRET`, privados. Selecionar o
provider não faz requisições. Cada operação recebe um transporte novo, de tentativa
única, mantendo assinatura, endpoint fixo, timeout, limite de bytes e bloqueio de
redirects existentes. Não há retries. Erros públicos distinguem credenciais ausentes,
autenticação recusada, indisponibilidade e contrato inválido sem conteúdo remoto.

Máximos locais por ciclo: 5 consultas configuradas, 10 páginas totais, 10 itens por
página, 5 produtos preparados e no máximo `maxSelected` novas mutações de link.
Uma chamada é reservada para cada consulta configurada antes de paginar as demais.
Truncamento é explícito. A descoberta associa resultados às consultas do nicho;
não afirma que a API forneceu uma taxonomia de nichos por produto.

Deduplicação por produto dentro/entre páginas; fatos conflitantes abortam a
descoberta. Instantes diferentes da mesma observação não são conflito. Ranking:
taxa de comissão estimada decrescente, ausência por último e ID textual crescente
como desempate. Comparações decimais usam BigInt, sem arredondamento. Exclusões,
preço observado e comissão mínima filtram candidatos; ausência nunca vira zero.
Preço/comissão observados não entram como preço atual, receita ou comissão
confirmada no produto. Moeda, estoque e vendas não são inferidos.

## Evidências e elegibilidade

`ShopeeDynamicConfiguration` e `ShopeeDynamicAuthorization` são os contratos TS.
Cada autorização inicial referencia produto/loja, produto Affiliate versionado,
imagem autorizada local e provas com `sourceRef`, `recordedAt` e `subjectHash`.
`subjectHash` usa `affiliateHash` sobre exatamente os seguintes objetos:

```ts
// Fidelidade da referência visual ao item e aos bytes autorizados.
{ externalProductId, shopId, imageUrl, mediaRef, contentHash, faithful: true }
// Aprovação comercial inicial, reutilizável para este produto/revisão/projeto.
{ projectId, externalProductId, shopId, productHash: affiliateHash(product) }
// Associação comercial ao link exato; mera URL HTTPS não basta.
{ projectId, campaignId, productId: externalProductId, shopId, offerId,
  originUrl, url, subIds }
```

São declarações do operador apoiadas por referências de evidência; o sistema não
autentica licenças ou documentos automaticamente. Não preencher provas só porque
uma URL existe. O link permanece `associationVerified: false`. Candidatos sem
direitos, aprovação ou associação permanecem WAITING, sem cadastro elegível fictício.
Novos ciclos podem usar a configuração atualizada para completar uma pendência;
ciclos antigos permanecem imutáveis. Produtos já autorizados não exigem escolha
ou nova autorização diária enquanto o escopo continuar válido.

O produto interno usa `shopee_<itemId>`; a campanha é derivada deterministicamente
de projeto/item, com hash quando excederia o limite de identificador. A origem
deve ser a URL canônica `https://shopee.com.br/product/<shopId>/<itemId>`;
aliases/formato SEO ficam pendentes, sem resolver redirects. A imagem precisa
ser a referência da fonte vinculada ao item, em `AUTHORIZED_THIRD_PARTY`, com
licença/permissão comercial e processamento local recorrente. Não se atribui a
propriedade ao operador e não se produz banner substituto. Inspeção reutiliza o
leitor PNG existente e confere os bytes e SHA-256 no storage de Media, sem download.
Grants restritos a QC/operação/campanha não autorizam produção recorrente.

## Persistência e retomada

`configure` provisiona explicitamente `affiliate_shopee_dynamic_events_v1`,
journal append-only do módulo Affiliate no banco já existente. Não abre SQLite
no bootstrap, não altera migrations globais nem `user_version`. Requer schema
suportado pelo repositório Affiliate e extensão `affiliate_campaign_sources_v1`
já provisionada pelo procedimento existente. Nenhum banco operacional foi acessado
durante esta task. O journal não substitui produtos/campanhas/briefings existentes.

Reserva de ciclo e de chamada é persistida antes do transporte. Reserva de link
é atômica por projeto/produto/loja; trocar SubIDs não contorna resultado incerto.
Timeout, falha ou parada após reserva bloqueia geração até reconciliação. Não há
reset automático de mutações. A descoberta, configuração congelada, motivos,
provas e vínculo de chamada permanecem auditáveis.

Produto, oferta/campanha, proveniência e recibos Affiliate são gravados em uma
transação SQLite, reutilizando validadores e comandos existentes. Uma falha em
qualquer escrita reverte o conjunto. Replay de preparação reutiliza proveniência
original, inclusive após o CATALOG criar novas revisões de vínculo com briefings.
Alteração de link/produto acrescenta revisão de campanha; observações isoladas não
reescrevem histórico. Revisões conflitantes de produto aguardam revisão. Histórico
de campanha é percorrido até 100 revisões, com bloqueio explícito no limite.

## Dependência precisa com Operations

O CATALOG atual já consome os produtos/ofertas elegíveis e preserva sua política
`ROUND_ROBIN_ID_V1`. Para aquisição automática antes de cada ocorrência, Operations
deverá importar o módulo e aguardar `runCycle(projectId, occurrenceId)` **antes**
da transação que reserva a ocorrência/congela o CATALOG. Deve reutilizar identidade
de ocorrência, distinguir WAITING de PREPARED e encaminhar recuperação explícita
de worker interrompido. Uma data já reservada não será reatribuída por descoberta
posterior. Esse hook não foi implementado porque Operations é read-only nesta task.
Não há promessa de automação diária LIVE já ativada.

## Validação e riscos residuais

Testes novos usam respostas artificiais, credenciais sintéticas e SQLite/PNG
descartáveis. Exercitam provider Nest LIVE, detalhes/filtros/paginação/deduplicação,
ranking de precisão alta, SubIDs, identidade, direitos, CATALOG/briefing/proveniência,
replay/restart, concorrência, reconciliação e rollback transacional.

Evidência local: 363 testes distintos de Affiliate e rotação CATALOG aprovados
(26 cenários novos). A primeira execução encontrou duas expectativas históricas
de provider LIVE indisponível; ambas foram atualizadas para o novo contrato e os
62 testes desses dois arquivos passaram na repetição focada. TypeScript
`tsc --noEmit`, `npm run build` e `git diff --check` passaram. Lint dos novos
serviços, journal, política e provider sem erro. Nenhuma suíte global foi executada.

Homologação LIVE ainda requer autorização operacional específica, credenciais
próprias, evidências reais e avaliação de custos. Sem scraping, chamada paga,
cadastro LIVE, publicação, deploy ou merge. O próximo tópico não é iniciado.
Evidência fica neste contrato e no PR: o allowlist da task não autoriza editar
`docs/TOPIC_ROADMAP.md` nem os contratos históricos read-only.
