# SHOPEE-DYNAMIC-MVP-001 — contrato de aquisição

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
