# MKTAUTO-A-FIRST-MANUAL-PUBLICATION-010

Frente A — Publishing. Entrega offline: handoff de vídeo e conciliação manual posterior, persistente e auditável. O recibo original permanece imutável. Nenhuma publicação real foi executada ou autorizada.

Base inicial preservada: `c7b86c64646aa63698b9e557d8d7cc69a99d9a0f`. Retomada sincronizada por fast-forward com `27cbc27cd02f2af82bcb01715a45ba1b59968905`; CORE/RELEASE #218 e Affiliate #219 MERGED. A autorização de retomada ampliou a allowlist para a extensão e os consumidores Publishing. Os quatro arquivos anteriores foram preservados, sem descarte, antes da continuação. Sem banco operacional, deploy ou alteração Finance/Media.

## Fluxo existente

Todos os comandos abaixo já existem. Comandos recebem `{ "input": ..., "idempotencyKey": "..." }`; consultas são GET. Não foi criado serviço de publicação paralelo.

| Operação                    | Endpoint                                                  |
| --------------------------- | --------------------------------------------------------- |
| Preparar pacote             | `POST /publishing/packages`                               |
| Consultar pacote            | `GET /publishing/packages/:hash`                          |
| Revisar pacote exato        | `POST /publishing/reviews`                                |
| Consultar revisão           | `GET /publishing/packages/:hash/review`                   |
| Consultar prontidão         | `GET /publishing/packages/:hash/manual-release-readiness` |
| Obter handoff               | `GET /publishing/packages/:hash/manual-handoff`           |
| Registrar publicação manual | `POST /publishing/manual-publications`                    |
| Consultar registro          | `GET /publishing/manual-publications/:id`                 |
| Listar por pacote           | `GET /publishing/manual-publications?packageHash=:hash`   |
| Registrar resultados        | `POST /publishing/results`                                |
| Consultar resultados        | `GET /publishing/manual-publications/:id/results`         |

Prontidão e handoff exigem `LocalQcGuard`, retornam `Cache-Control: no-store` e reutilizam os gates oficiais de `ManualDistributionService`. O registro revalida os gates, inclusive aprovação revogada, antes de gravar. GET de handoff não significa publicação confirmada.

Novas operações, também protegidas por `LocalQcGuard` e `no-store`:

- `POST /publishing/manual-publications/:id/reconciliations`: evento explícito com envelope `input`/`idempotencyKey`.
- `GET /publishing/manual-publications/:id/reconciliations`: histórico imutável.
- `GET /publishing/manual-publications/:id/effective`: recibo original, histórico, estado efetivo e origem da confirmação. O GET original continua devolvendo o recibo original sem alterações.

## Ferramenta local de preparação

Na raiz do repositório:

```powershell
node scripts/ops-local/first-manual-publication.mjs --package-hash <SHA256_DO_PACOTE> --platform instagram --account <ID_DA_CONTA>
```

O comando imprime uma consulta JavaScript autocontida. Execute-a no console do navegador **na sessão local de QC já autenticada**, com a origem local do runtime autorizado. O navegador utiliza sua sessão HttpOnly existente; a ferramenta não lê cookie, segredo, arquivo de credencial, `.env`, armazenamento do navegador ou banco. Não passe tokens ou credenciais ao comando. Nenhuma chamada HTTP acontece ao gerar a consulta pelo Node.

A consulta emitida executa somente GET de prontidão, registros do pacote e handoff. Recusa origem não local, redirects, pacote diferente, destino/conta incorretos, gates incompletos, identidade/revisão/hash divergentes, ausência de QC ou revisão exata. Mantém legenda, CTA, disclosure, link afiliado/SubIDs e `finalCaption` exatamente como recebidos, sem reconstrução. Mostra bloqueios e próxima ação, excluindo dados privados do pacote. A prontidão física corresponde à verificação de hash existente, não a uma nova inspeção de codec no comando.

Resultado de preparação: `READY_FOR_OPERATOR_HANDOFF` ou `BLOCKED_MANUAL_PUBLICATION`. Sempre `publicationAuthorized: false` e `publicationConfirmed: false`. Registro existente interrompe a preparação de nova postagem. Para recibo original UNCONFIRMED, consulta também o estado efetivo; sem conciliação orienta observar e não repostar, com conciliação orienta consultar registro e resultados. Erro de consulta ou autenticação bloqueia sem repetição automática.

## Procedimento humano mínimo

Este procedimento é para uma operação futura, explicitamente autorizada, em runtime liberado por CORE/RELEASE. Não representa autorização de publicação nesta task.

1. **Consultar prontidão.** Selecione o pacote exato, rede e conta. Execute a consulta na sessão local já autenticada e exija todos os gates PASS. Se houver bloqueio, interrompa. Antes de qualquer postagem, confira também os registros existentes do mesmo pacote para evitar duplicação.
2. **Obter arquivo e legenda aprovados.** Use o download autorizado existente na tela local de QC/Operations. Quando existir uma execução vinculada, a rota é `GET /operations/executions/:executionId/final.mp4?download=1`. Não invente `executionId` a partir de `pipelineRunId`. Compare o SHA-256 do arquivo com `handoff.video.sha256` e use `handoff.finalCaption` sem modificar texto, CTA, disclosure ou link. Não publique se vídeo, revisão, pacote, direitos ou decisão forem diferentes.
3. **Publicar manualmente.** Somente após autorização humana da operação, entre na rede e conta indicadas. Envie o MP4 aprovado e a legenda exata. Esta ferramenta não faz upload nem posta. Resultado incerto exige observação antes de qualquer nova tentativa.
4. **Registrar evidência observada.** Reúna ID remoto, permalink e referência documental verificável da publicação. Pelo endpoint existente `POST /publishing/manual-publications`, informe `packageHash`, `actor`, `publishedAt`, `externalId`, `externalUrl`, `evidenceReference` e `state`, dentro do envelope com chave idempotente. `PUBLISHED` somente com confirmação externa efetiva. Sem confirmação, use `UNCONFIRMED`, ID/URL desconhecidos como `null` e uma referência ao registro da tentativa incerta; essa referência não é um recibo confirmado. Não invente evidência para preencher o campo obrigatório. Preserve a chave e o payload para replay da mesma tentativa.
5. **Consultar registro e resultados.** Consulte o ID devolvido e a lista por pacote. Reinício não exige nova postagem ou novo registro. Para uma publicação confirmada, o comando existente de resultados recebe `publicationId`, `periodStart`, `periodEnd`, `sourceReference`, `attribution`, `clicks`, `sales`, `revenue` e `commissions`. Métricas indisponíveis devem permanecer `{ "status": "UNKNOWN", "reason": "NOT_REPORTED" }`; não inferir vendas, comissões ou lucro. Resultados de `UNCONFIRMED` são rejeitados pelo contrato atual.
6. **Conciliar incerteza.** Observe manualmente a postagem na conta correta e preserve ID, permalink e referência documental da evidência efetivamente conferida. Não reposte nem altere SQLite. Consulte o recibo original e envie a conciliação explícita abaixo, pela sessão local autenticada. Depois consulte `/effective` e `/reconciliations`. O recibo original permanece UNCONFIRMED; o estado efetivo só passa a PUBLISHED com o evento válido. Sem evidência suficiente, preserve UNCONFIRMED e não registre resultados comerciais.

## Contrato e evidência posterior

Contrato: `manual-publication-reconciliation/1.0.0`. Exemplo de estrutura, não um comando para execução operacional nesta task:

```json
{
  "input": {
    "publicationId": "<ID_ORIGINAL>",
    "packageHash": "<HASH_DO_PACOTE>",
    "originalReceiptHash": "<CONTENT_HASH_DO_RECIBO_ORIGINAL>",
    "platform": "instagram",
    "account": "<CONTA_EXATA>",
    "externalId": "<ID_OBSERVADO>",
    "externalUrl": "https://www.instagram.com/reel/<CODIGO_OBSERVADO>/",
    "publishedAt": "<DATA_OBSERVADA_ISO_8601>",
    "evidenceReference": "<REFERENCIA_DOCUMENTAL_CONFERIDA_PELO_OPERADOR>",
    "confirmationOrigin": "OPERATOR_ATTESTED"
  },
  "idempotencyKey": "<CHAVE_ESTAVEL_DA_CONCILIACAO>"
}
```

Não envie `operatorId`, `recordedAt` ou `state`: identidade vem do guard e é revalidada no serviço; instante vem do servidor. Não basta enviar state=PUBLISHED no POST original. O evento inclui hash canônico, ID determinístico, hash do recibo e revisão originais, escopo, origem e chave idempotente. Replay da mesma confirmação preserva evento e instante; confirmação conflitante é rejeitada.

Em autenticação pela sessão do navegador, use o mecanismo CSRF existente: consulte `GET /operations/session` na mesma origem e envie o `csrfToken` recebido em `X-Qc-Csrf` no POST de conciliação, mantendo a sessão gerenciada pelo navegador. Isso não expõe o cookie HttpOnly nem autoriza declarar outra identidade. A ferramenta de preparação permanece estritamente GET e não executa esse POST.

`OPERATOR_ATTESTED` significa declaração de operador autenticado que verificou manualmente a evidência. O servidor valida campos obrigatórios, vínculo exato, permalink de post da rede correta e ausência de reutilização de ID/URL por publicação incompatível; não acessa a rede nem verifica o conteúdo do documento externamente. **Não é PLATFORM_VERIFIED.** Este fluxo não emite PLATFORM_VERIFIED; essa origem exige verificação independente e não está implementada. UNCONFIRMED continua sem confirmação suficiente. A referência documental não pode estar vazia e não deve apontar a evidência inventada.

URLs aceitas neste fluxo são permalinks canônicos de posts/reels Instagram e posts/videos/reels Facebook. Links encurtados que dependem de redirecionamento não são aceitos. Host www, barra final e parâmetros de rastreamento não permitem duplicar evidência. Nenhuma rede/provedor novo foi adicionado.

## Extensão SQLite e provisionamento

`manual_publication_reconciliation_v1.sql` cria somente tabela/índices/triggers aditivos, com FKs para pacote e publicação originais, evento único por publicação, unicidade de chave e evidência, restrições de escopo/origem e proibição de UPDATE/DELETE. Não modifica `manual_distribution_records` nem `035_manual_distribution.sql`.

O provisionamento administrativo existente aplica a extensão a schema >=42 e registra versão 1, nome e SHA-256 em `schema_lineage_extensions_v1`. Mantém `PRAGMA user_version` e a linhagem 001–044; checksum ou objetos divergentes bloqueiam atomicamente. O runtime não provisiona no startup nem durante a conciliação. Schema ausente gera `DISTRIBUTION_RECONCILIATION_SCHEMA_REQUIRED`. Nenhuma extensão foi aplicada a banco operacional nesta entrega.

Transações BEGIN IMMEDIATE revalidam gates e recibo após reservar a escrita. Conciliação, deduplicação e persistência são atômicas. Resultados antigos são preservados; os dois consumidores comerciais passam a resolver a projeção confirmada, mantendo produto, campanha, run, pacote e review originais.

## Reprodução e resolução do bloqueio original

O E2E preservado, ampliado na retomada, usa MP4 sintético fisicamente decodificado e banco SQLite descartável:

1. Prepara pacote e revisão específica pelos endpoints existentes.
2. Registra `UNCONFIRMED`, sem ID/URL remotos confirmados.
3. Tenta anexar uma observação posterior com nova chave idempotente, sem HTTP social.
4. Recebe **HTTP 409 / DISTRIBUTION_PUBLICATION_CONFLICT**. O registro original e todas as tabelas permanecem intactos.
5. Tenta registrar resultados e recebe **HTTP 400 / DISTRIBUTION_CONFIRMED_PUBLICATION_REQUIRED**.

Essa rejeição permanece intencional: o POST original e `ManualDistributionRepository.put` continuam impedindo substituir o recibo. Após reproduzi-la, o E2E usa o novo comando de conciliação, reinicia aplicação/serviços e comprova estado efetivo PUBLISHED/OPERATOR_ATTESTED, com original intacto e handoff sem repostagem. O outro E2E comprova os consumidores comerciais, sem métricas de vendas/comissões inventadas.

O escopo ampliado foi autorizado na retomada do mesmo A-010. Não foi criado novo tópico-pai nem serviço de publicação paralelo.

## Evidências e retomada

Todos os dados são `FICTITIOUS_TEST_ONLY`. A fixture usa o catálogo e Publishing nativos com SQLite descartável. Os ports Media fornecem somente evidência da fixture: MP4 H.264/AAC original gerado por FFmpeg, probe real e decode integral local; direitos e revisão são declarações exclusivas do teste, nunca decisões operacionais. Não se afirma QC comercial real, conexão com Meta ou publicação remota.

Os testes cobrem replay de pacote/registro, handoff sem escritas, aprovação de outro pacote, revogação, QC ausente, mídia alterada, consulta após reiniciar a aplicação/serviços e preservação do arquivo e histórico. A ferramenta também bloqueia gates incompletos, origem externa e registro existente.

```powershell
npx vitest run src/modules/publishing/first-manual-publication.spec.ts
npx vitest run --config vitest.config.e2e.ts src/modules/publishing/first-manual-publication.e2e-spec.ts
npx tsc --noEmit
npm run build
npm run lint
git diff --check
```

Controle do tópico-pai: seis grupos de aceite originais, agora completos pelo escopo de retomada: inventário/reprodução; handoff; gates/contrato; E2E/persistência/provisionamento; procedimento e consumidores comerciais; validação/entrega. Os oito passos T01–T08 da retomada pertencem a esses seis grupos, sem nova entrega independente. Após validação integral: commit, push e único Draft PR A-010. `USER_ONLY_MERGE`. Uso operacional depende de revisão, merge, provisionamento administrativo e autorização específicos; esta task não executa essas ações.

Validação: 572 testes Publishing/provisionamento PASS, 6 testes físicos de imagem opt-in não executados; 77 E2Es distintos PASS, incluindo piloto físico CORE/RELEASE executado com FFmpeg/FFprobe local. TypeScript, build, smoke de provisionamento compilado em memória, lint global mais o script, Prettier e diff-check PASS. Avisos de lint somente preexistentes. Replay após reinício, dois workers reais, rollback após INSERT e leitura de evento corrompido cobertos. Todos os recibos e estados confirmados novos são exclusivamente FICTITIOUS_TEST_ONLY/OPERATOR_ATTESTED, sem confirmação remota real.
