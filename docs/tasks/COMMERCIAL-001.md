# COMMERCIAL-001 — rastreamento comercial por publicação

Data: 10/11/2026. Base: `d64b24aea4d20341387e2403a630327b98b5a883`
(origin/main, merge #133). Persona: operador individual de canais temáticos.
Branch: `feature/mktauto-commercial-tracking`.

## Entrega e limites

Reutilizar a mensuração existente e completar o escopo de projeto no retorno.
A correção restrita à projeção Commercial em `publishing/*commercial-measurement*`
foi expressamente autorizada nesta execução. Não altera o fluxo de publicação,
Finance, estados, direitos, contratos Affiliate ou gates. AFFILIATE-001 permanece
em READY_AWAITING_APPROVAL; nenhum cadastro operacional foi realizado.

## C-01 / C-02 / C-04 — mapa e vínculos

Não existe um módulo Nest separado chamado Commercial. O caminho operacional é:

| Etapa | Implementação / identidade persistida |
|---|---|
| Produto e oferta | `affiliate/domain/affiliate-contracts.ts`: produto/revisão e `AffiliateCampaign`/revisão com URL |
| Seleção da ocorrência | `content-operations/infrastructure/campaign.repository.ts`: execução, campanha recorrente e seleção congelada |
| Vínculo de produção | `affiliate/application/affiliate-run-context.service.ts`: run, briefing e hash |
| Pacote aprovado | `publishing/application/manual-distribution.service.ts`: projeto/versão, produto, oferta, briefing e render exatos |
| Recibo social | `publishing/infrastructure/social-publication.repository.ts`: operação, rede, modo fake/live, mediaId, estado e remoteReceipt |
| Destino ativo | `publishing/infrastructure/destination-reservations.repository.ts`: reserva e sucessor Facebook, quando houver |
| Resolução Commercial | `publishing/infrastructure/commercial-measurement.repository.ts`: confere os vínculos congelados; rejeita recibo ausente/inconsistente ou publicação não confirmada |
| Histórico e resumo | `publishing/application/commercial-measurement.service.ts`: observações, revisões, custos e valores desconhecidos |
| Custos | `finance/application/finance.service.ts`: `getLedgerV2ByPipelineRun` e `getGlobalOperation`, somente leitura |

Consultas existentes (GET) em `publishing/publishing.controller.ts`:

- `/publishing/executions/:id/commercial-results`
- `/publishing/social-operations/:id/commercial-results`
- `/publishing/manual-publications/:id/commercial-results`

`identity.campaignId/campaignRevision` identifica a campanha de execução.
`identity.affiliateLink.campaignId/campaignRevision` identifica a oferta Affiliate
congelada; não se cria um novo offerId nem se presume que os dois pares coincidam.
O contrato Shopee possui offerId próprio, mas não comprova atribuição de venda.

A lacuna comprovada era a ausência de `identity.projectId/projectVersion` no
retorno Commercial. Agora ambos vêm do pacote imutável. Novas observações os
congelam; consultas de V2 antigos complementam apenas a projeção de leitura,
mantendo registros, hashes e recibos de replay originais. Não há migration.

Operações PREPARED permanecem consultáveis pelo histórico social existente e
são recusadas pela mensuração confirmada. Múltiplos destinos publicados exigem
seleção explícita da operação. Estado PUBLISHED e recibo são requisitos da
resolução; o resumo já apresenta mediaId, publishedAt, permalink e modo.

## C-03 — evidências e atribuição

Reutilizados os registros append-only RESULTS em `manual_distribution_records`
e os recibos transacionais em `affiliate_commands`, sem outro ledger.

- KNOWN com zero significa zero declarado; ausência nunca vira zero.
- UNKNOWN com reason preserva motivo explícito. Sem observações, history e
  observations são vazios e observationScope é null; dados ainda não recebidos
  não são confundidos com uma observação recebida contendo valores UNKNOWN.
- Cada observação guarda período UTC, sourceReference, actor, atribuição,
  revisão, inputHash, recordedAt e hash anterior. Cliques e sales são contagens;
  revenue e commissions são decimais com moeda. sales não é um ledger de pedidos.
- DIRECT_PUBLICATION é uma declaração auditável do operador sobre evidência
  específica, não confirmação automática da plataforma. CAMPAIGN_REPORTED e
  UNATTRIBUTED conservam o relatório sem transferir seus totais à publicação.
- Compartilhar URL não comprova correspondência individual. Não existe rateio
  automático entre publicações. Custo de run compartilhado não é aditivo por post.
- Fonte/período/atribuição/publicação identificam a série; replay não duplica,
  correção exige revisão atual e motivo. Fontes/períodos sobrepostos não se somam.

Dados reais de cliques, pedidos, comissões ou rentabilidade não foram consultados
nem comprovados nesta execução. Todos os números dos testes são fictícios.
Não há novo status que afirme verificação externa automática.

## C-06 — preparação de COMMERCIAL-002 / Shopee

Formato de relatório real comprovado neste tópico: **nenhum**. Os contratos
`affiliate/domain/shopee-affiliate-contracts.ts` são internos e tratam ofertas,
estimativas e links (incluindo subIds); não documentam exportação de vendas.
Não foi implementado importador baseado em um layout presumido.

Condição de retomada: amostra real autorizada e sanitizada de relatório Shopee,
com sua origem, período e documentação dos campos, além de autorização do pacote
de importação. Verificar na amostra:

- formato, encoding, separadores, timezone e moeda;
- chave estável de pedido/item/evento, estado, cancelamentos e estornos;
- período da venda e da comissão, valores e precisão;
- campanha/SubID ou outro identificador realmente presente e sua associação
  verificável ao link e à publicação;
- semântica de exportações cumulativas, revisões e duplicados.

Conciliação futura deve deduplicar por identidade comprovada da fonte, manter
evidência e histórico de correções, distinguir estimativa de comissão confirmada
e impedir soma de snapshots sobrepostos. Sem correspondência demonstrável,
conservar escopo de campanha ou não atribuído. Uma URL comum ou um pedido sem
SubID verificável não autoriza comissão individual por publicação.

## C-05 / C-07 — validação

Os testes existentes de `publishing/commercial-measurement.spec.ts` já cobrem
Instagram PUBLISHED, Facebook PREPARED recusado e PUBLISHED fictício, produto e
oferta congelados, repetição do mesmo produto/link, dados ausentes, evidências
simuladas, replay por rotas/chaves diferentes, correções e reabertura do serviço.
Usam SQLite descartável e verificação de foreign keys. O E2E HTTP integrado nesse
arquivo usa adaptador fake e bloqueia fetch externo.

Regressão adicionada: V2 anterior sem projeto, sem desabilitar triggers de
imutabilidade; reabertura, consulta enriquecida e replay conservam integralmente
as linhas RESULTS e os recibos de comando. Asserções de projeto também nos fluxos
manual, Facebook schemas 43/44 e HTTP. As regressões falharam antes da correção.

Resultados em 10/11/2026:

- `npx vitest run src/publishing/commercial-measurement.spec.ts --maxWorkers=2`:
  41 PASS, incluindo E2E HTTP Commercial e a nova regressão histórica.
- `npx vitest run src/publishing src/affiliate src/content-operations src/finance --maxWorkers=4`:
  920 PASS em 75 arquivos.
- `npx vitest run --config vitest.config.e2e.ts test/affiliate.e2e-spec.ts test/affiliate-run-context.e2e-spec.ts test/publishing.e2e-spec.ts src/content-operations/campaign.e2e-spec.ts`:
  29 PASS em quatro arquivos.
- `npx tsc --noEmit`, `npm run build`, `npm run lint`: PASS; lint conserva
  oito avisos em arquivos não alterados, sem erros.
- Prettier dos três arquivos TypeScript alterados e `git diff --check`: PASS.

Execução inteiramente offline, com fixtures e bancos temporários; sem comprovação
operacional de venda ou comissão real. Não foram gerados relatórios comerciais
reais. Artefatos versionados: correção, regressão e este mapa/registro de evidências.

## Riscos residuais e continuidade

Validação offline com publicação fake não comprova venda, comissão, publicação
real ou lucro. Evidência manual exige conferência humana. COMMERCIAL-002 depende
da amostra real; não bloqueia a entrega técnica de COMMERCIAL-001.
Nenhum banco LIVE foi aberto, nenhuma API externa/paga foi chamada, nenhuma
publicação, grant, recorrência D1/D2 ou alteração financeira real foi executada.
Worktrees existentes e minutas de AFFILIATE-001 preservados.

C-08: um único PR desta entrega, sem auto-merge. Revisão e merge exclusivamente
pelo usuário. O próximo tópico não é iniciado nesta execução.
