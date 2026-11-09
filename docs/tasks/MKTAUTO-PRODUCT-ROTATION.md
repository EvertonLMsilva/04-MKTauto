# Rotação de produtos por ocorrência

## FIXED e CATALOG

Ausência de `selectionMode` equivale a `FIXED`: preserva produto/revisão da campanha Affiliate configurada, incluindo campanhas históricas. `CATALOG` escolhe automaticamente um produto antes de criar o contexto editorial de cada ocorrência. A campanha Kate existente não é convertida.

Não há novo banco, tabela, scheduler ou catálogo paralelo. Produtos e ofertas continuam em `affiliate_product_revisions` e `affiliate_campaign_revisions`. O catálogo operacional é a consulta desses registros no mesmo projeto da campanha recorrente.

## Cadastro persistido e elegibilidade

1. Cadastrar o projeto pelos endpoints `/projects` existentes.
2. Cadastrar o produto em `POST /affiliate/products`, com envelope `{ "idempotencyKey": "...", "product": { ... } }`, mantendo os contratos `affiliate-product/1.0.0` ou `affiliate-product/2.0.0`: identidade/revisão, nome, marca declarada, atributos com evidência, mídias e evidências.
3. Para rotação, o produto admite dois campos opcionais: `status` (`ACTIVE` ou `ARCHIVED`; ausência mantém o registro ativo) e `localImage`, com o mesmo contrato de origem de imagem já usado em campanhas locais. Produtos antigos sem esses campos continuam utilizáveis em FIXED. Arquivar exige nova revisão; não modificar revisões históricas.
4. Cadastrar uma oferta em `POST /affiliate/campaigns`, envelope `{ "idempotencyKey": "...", "campaign": { ... } }`: `schemaVersion: "affiliate-campaign/1.0.0"`, `campaignId`, `revision`, `projectId`, `productId`, `productRevision`, `affiliateUrl` HTTPS válido, `cta`, `disclosure`. Essa campanha Affiliate é o vínculo persistido entre produto e link; pode ser diferente da campanha recorrente que escolhe os produtos. Não é necessário configurar recorrência para cada oferta.
5. Ao revisar o produto, cadastrar também uma revisão da oferta que aponte para a revisão vigente. A rotação não recupera revisões antigas quando a revisão atual está inelegível.

Exemplo do campo `localImage` dentro do produto, usando valores reais do cadastro e da mídia local autorizada:

```json
{
  "mediaReference": "media:produto_imagem",
  "contentHash": "<SHA-256 real dos bytes PNG>",
  "origin": "OPERATOR_OWNED",
  "provider": null,
  "rights": {
    "usageBasis": "OWNED",
    "commercialUseAllowed": true,
    "evidence": [{
      "id": "ev_imagem",
      "kind": "MEDIA_USAGE_RIGHT",
      "sourceRef": "<registro real da autorização>",
      "recordedAt": "2026-11-07T13:00:00Z",
      "mediaAuthorization": {
        "mediaRef": "media:produto_imagem",
        "contentHash": "<mesmo SHA-256>",
        "commercialUse": "GRANTED",
        "processing": "GRANTED",
        "localProcessing": true,
        "externalProviders": []
      }
    }]
  }
}
```

O mesmo grant deve constar nas evidências do produto e sua referência em `product.media`. A origem e o provedor devem refletir a procedência real; não declarar mídia de terceiros como própria. Os bytes PNG precisam estar disponíveis no armazenamento local existente antes da produção. Cadastro de metadados não faz upload nem inventa direitos.

Elegibilidade exige revisão atual válida, estado não arquivado, nome, atributos/evidências comerciais validados, oferta vigente no mesmo projeto e briefing materializável. A imagem deve pertencer às mídias do produto e ter hash, procedência e autorização comercial/processamento local explícitos. Grants restritos a uma operação ou revisão QC não autorizam a rotação. Registros inválidos, sem link, evidência ou imagem apropriada ficam fora da seleção. Preço, estoque e comissão não são inferidos.

## Ativação

Usar a administração existente em `POST /content-operations/campaign-executions/local`:

```json
{
  "campaignId": "campanha_recorrente",
  "campaignRevision": 1,
  "projectVersion": 1,
  "requestId": "ativar_catalogo_001",
  "requestedAt": "2026-11-08T13:00:00Z",
  "selectionMode": "CATALOG",
  "recurrence": { "enabled": true }
}
```

CATALOG não recebe `localImage` no comando: a imagem acompanha o produto persistido. FIXED mantém o comando existente, com `localImage`. IDs são necessários no cadastro/configuração inicial; não diariamente. Um dia já reservado não muda de produto nem de modo: configurar uma nova data para trocar de FIXED para CATALOG, preservando o histórico. O horário e a timezone continuam herdados da recorrência existente, sem catch-up de dias perdidos. Para desabilitar, repetir a identidade/configuração inicial com novo `requestId` e `recurrence.enabled=false`.

## Algoritmo, congelamento e auditoria

A consulta considera a maior revisão de cada produto e de cada campanha/oferta. Havendo múltiplas ofertas elegíveis para o mesmo produto, o menor `campaignId` decide o vínculo, deterministicamente. Não há ranking comercial adequado nesse contrato; utiliza-se `ROUND_ROBIN_ID_V1`: ordenar IDs de produto, excluir a última seleção quando houver alternativa, escolher o primeiro ID maior que o cursor e voltar ao início quando necessário. Revisões não contornam o cooldown de identidade. Um único elegível pode repetir em outra data. O cursor é a última seleção persistida, mesmo que haja uma ocorrência intermediária sem candidato.

`BEGIN IMMEDIATE` protege a leitura do catálogo, o cursor e a reserva única `(campaign_id, production_date)`. O pedido `SCHEDULED` e o evento `PRODUCT_SELECTED` congelam produto/revisão, campanha/oferta e revisão do link, URL, identidade/hash e snapshot completo do briefing, imagem e método/motivo de seleção. O briefing persistido e o vínculo Affiliate da execução usam a campanha/oferta selecionada; a identidade da ocorrência continua sendo a campanha recorrente. Editorial, mídia e legenda usam esse briefing. Nenhuma aprovação/publicação é herdada.

Replay, dois schedulers concorrentes e restart recuperam a mesma ocorrência sem selecionar novamente nem avançar cursor. Alterações posteriores do catálogo não alteram seleções antigas. A criação do briefing após a reserva é idempotente e confere o hash congelado antes do editorial. Quando a oferta já possui proveniência Affiliate, uma nova revisão dessa mesma proveniência é vinculada atomicamente ao briefing da ocorrência, preservando os vínculos anteriores e sem repetir discovery/verificação externa.

Sem candidato, a ocorrência fica `WAITING_INPUT`, código `CATALOG_PRODUCT_REQUIRED`, sem editorial/mídia. Essa data não é reatribuída após cadastrar novos produtos; corrigir o cadastro para a próxima ocorrência, ou cancelar a ocorrência bloqueada. Não há seleção silenciosa de um produto inválido.

Consultar `GET /content-operations/campaign-executions/:id` (`selectionMode`, `productSelection`), `/:id/history` (`PRODUCT_SELECTED`) e `/affiliate/briefings/:briefingId`. O link/revisão selecionados ficam no histórico; as aprovações continuam vinculadas aos artefatos daquela ocorrência.

## Limitações e validação local

O MVP usa imagem estática autorizada e catálogo cadastrado pelas APIs existentes. Discovery automático e otimização comercial são pós-MVP. Não há scraping, importação externa, atualização automática de preços, ML ou uso de fal.ai nesta entrega. Não há validação de existência física da imagem durante a escolha; o workflow existente verifica bytes/hash antes de produzir mídia e bloqueia a produção se estiverem indisponíveis.

TDD e testes locais usam SQLite temporário com foreign keys ativas: A → B → C → A, produto único, revisões, arquivo/ausência de link/evidência/mídia, falta de candidatos, replay, restart, desativação e concorrência entre conexões/processos. O E2E HTTP/Nest executa seleção, criação de briefing, vínculo Affiliate e editorial reais para três datas; apenas o provedor editorial é fake e os transports de mídia/áudio são simulados. Reiniciar a aplicação preserva B; cada data persiste seu próprio roteiro. O fluxo para na ausência de TTS, sem render real, modelos pesados, chamada externa ou Meta. Custos externos: nenhuma chamada; custo de hardware/energia local: indisponível.

Verificação de 07/11/2026: 508 testes de Affiliate/Project/Content Operations passaram, incluindo 13 cenários novos de rotação e dois cenários de concorrência SQLite entre workers (FIXED/CATALOG). TypeScript, build e lint passaram; lint mantém os avisos preexistentes. `git diff --check` do escopo passou. O check global aponta somente uma linha em branco preexistente no EOF de `src/db/migrations/038_commercial_automation.sql:114`, preservada por estar fora da task. As 34 alterações locais protegidas permaneceram idênticas por SHA-256. Sem migration, uso do banco LIVE/principal, alteração de Docker, commit, push ou PR.

E2E HTTP adicional existente (`campaign.e2e-spec.ts`): 16 PASS, 2 FAIL na expectativa de a legenda conter `Publicidade` (linha 1414). As duas falhas foram reproduzidas carregando em memória as versões anteriores dos arquivos alterados nesta task diretamente de HEAD, com as alterações locais alheias preservadas; nenhum checkout/worktree/cópia do projeto foi criado. São pendências anteriores à rotação. O E2E novo de catálogo, que verifica três datas, editorial real e restart, passou. O teste auxiliar de baseline foi removido após a comparação.
