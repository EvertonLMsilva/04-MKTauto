# COMMERCIAL-003 — custos e prontidão de rentabilidade

Data: 10/11/2026. Persona: operador individual de canais temáticos.
Base: `dc0f5a49943f63d73492c993eb153557fd4209f3` (merge #135).
Branch/worktree isolados: `feature/mktauto-commercial-profitability` /
`D:/04-Projetos/_worktrees/mktauto-commercial-profitability`.

## Escopo e lacuna comprovada — C-01 / C-05

Reutilizado o mapa de COMMERCIAL-001. Commercial está nos arquivos
`publishing/*commercial-measurement*`; a alteração exclusiva desses contratos,
serviço e testes foi expressamente autorizada pelo usuário. Sem alteração do
fluxo Publishing, Finance, Affiliate, migrations ou schemas.

Antes desta entrega, a observação guardava o valor reportado de comissão, mas
não distinguia prevista, confirmada ou cancelada. O teste da nova prontidão
falhou antes da implementação. A extensão acrescenta estado opcional e uma
projeção de rentabilidade; não cria endpoint, ledger ou importador.

## Custos e vínculos — C-02 / C-03

Leituras existentes de `FinanceService`: `getLedgerV2ByPipelineRun` e
`getGlobalOperation`. O ledger V2 contém eventos originais, ajustes, totais por
moeda e demonstrativos TTS de reconciliação. Categorias disponíveis:
production_cost, ai_cost, media_cost, voice_cost e publishing_cost.

Evento genérico identifica run, projeto/versão, categoria, origem, regra de
atribuição, datas e IDs opcionais de conteúdo/artefato. Seu token de origem não
comprova sozinho se o valor é estimado ou faturado. A projeção o classifica
RECORDED_UNCLASSIFIED; não infere confirmação pelo nome do provedor.

O contrato TTS tipado permite comprovação mais forte: RECONCILED, netCostUsd,
billing.evidenceReference e reconciliationReference. Somente demonstrativos
reconciliados com esses dados entram em reconciledCostsByCurrency. Estados
pendentes são UNRECONCILED, mantendo o valor original separado do reconciliado.
Estimativas de planejamento e tetos de orçamento não viram despesa comprovada.

Zero reconciliado é conhecido, inclusive após ajuste integral do evento
original; ausência de evento/demonstrativo não vira zero. GPU, energia,
infraestrutura e processamento local continuam sem medição comprovada.
Outras categorias ficam disponíveis no ledger e na classificação pendente,
sem serem promovidas automaticamente a custos faturados.

A identidade Commercial conserva projeto/versão, produto/revisão, oferta
Affiliate/revisão, campanha de execução, run, execução, operação, publicação,
plataforma, pacote e link. Custos pertencem à run. Seu subtotal não é aditivo
entre publicações da mesma run nem comprova alocação individual por post.
Não há agregado novo por campanha; qualquer consolidação futura deve
deduplicar pipelineRunId e preservar moedas, períodos e escopo da evidência.

## Contrato de rentabilidade — C-04

O input existente de resultados aceita o campo opcional commissionStatus:
UNKNOWN, EXPECTED, CONFIRMED ou CANCELLED. CONFIRMED exige valor KNOWN.
Omissão preserva a normalização histórica e inputHash; observações antigas
não ganham confirmação implícita. Estado não participa da identidade da série:
mudar prevista → confirmada → cancelada exige revisão atual e motivo, como as
demais retificações. Campos omitidos numa correção não são herdados.

CONFIRMED continua sendo declaração auditável do operador sobre sourceReference,
com actor, período e histórico; não é verificação automática da Shopee. A base
é explicitada como OPERATOR_REPORTED_SOURCE_REFERENCE. Sem atribuição
DIRECT_PUBLICATION, nem um relatório confirmado autoriza comissão individual.
CANCELLED preserva o valor reportado/histórico e exclui a comissão confirmada
apurável; não inventa estorno nem substitui o valor por zero.

Campos novos no resumo, sob profitability:

| Campo | Significado |
|---|---|
| reportedCommissionStatus | Estado declarado da fonte; antigos ficam UNKNOWN |
| confirmedCommission | Comissão declarada confirmada, conhecida e diretamente atribuída |
| costEvidence | Eventos registrados sem classificação ou demonstrativos reconciliados/pendentes |
| reconciledCostsByCurrency | Subtotal TTS comprovado pelo contrato Finance, incluindo zero explícito |
| partialNetResult | Comissão confirmada menos subtotal TTS reconciliado na mesma moeda |
| status | PARTIAL quando esse saldo existe; caso contrário NOT_CALCULABLE |
| definitive | Sempre false neste corte |
| netProfit, margin, roi | UNKNOWN enquanto completude e alocação não forem comprovadas |
| pendingEvidence | Pendências explícitas de confirmação, reconciliação, custeio e atribuição |

partialNetResultScope explicita que só desconta custos TTS reconciliados; não
é lucro completo. Valores monetários usam inteiros de escala 18, saída decimal
em texto e moeda original. Não há float nem conversão cambial.

Política para cálculo definitivo futuro: resultado líquido exige receita de
afiliado confirmada e custos completos/comprovados no mesmo escopo/período e
moeda; margem = resultado / receita de afiliado; ROI = resultado / custo total.
Receita de afiliado não se confunde com valor bruto da mercadoria vendida.
Denominador zero, dado desconhecido, falta de alocação ou moeda incompatível
impedem a razão. O corte atual não possui evidência de completude, portanto
não calcula razões nem promove saldos parciais a lucro definitivo.

Compatibilidade: commission, reportedCommission, knownCost e knownNetResult
continuam com a semântica anterior. São valores reportados/subtotais; não
devem ser apresentados como confirmação ou lucro definitivo. Para os novos
indicadores, consumir profitability. Nenhum histórico/hash antigo é regravado.

## Consumo futuro — C-07

Usar as consultas GET existentes por execução, operação social ou publicação
manual em `/publishing/.../commercial-results`. identity e publication oferecem
os vínculos e recibos; observations/history oferecem evidências e revisões;
knownCostsByCurrency e costLedger mostram o ledger registrado; profitability
mostra comissão confirmada reportada, subtotal reconciliado e pendências.
grossRevenue continua KNOWN/UNKNOWN conforme o relatório e a atribuição.
Não há frontend, chamada externa ou nova rota nesta entrega.

## Validação — C-06

SQLite descartável e fixtures explicitamente fictícias, sem dispatch TTS.
O teste nativo prepara registros de leitura e ajuste no banco temporário,
usa as validações/leituras reais do Finance e confere persistência após restart.
As consultas Commercial não alteram eventos nem ajustes financeiros.

Cobertura: dados ausentes, comissão antiga/prevista/confirmada/cancelada,
retificação e conflito de revisão, custo não classificado, TTS pendente e
reconciliado positivo/zero, 18 casas, moedas diferentes, duas publicações com
link comum e relatório de campanha, reprocessamento/replay por outra chave,
histórico imutável e E2E HTTP na rota existente.

Resultados em 10/11/2026:

- `npx vitest run src/publishing src/finance src/affiliate src/content-operations --maxWorkers=4`:
  934 PASS em 76 arquivos.
- Após acrescentar os casos explícitos de ausência de importação e duas
  publicações com link comum, execução final dos dois arquivos
  `commercial-measurement*.spec.ts`: 57 PASS. Estes resultados se sobrepõem
  à suíte anterior; não são uma contagem adicional de testes únicos.
- `npx vitest run --config vitest.config.e2e.ts test/finance.e2e-spec.ts test/finance-adjustments.e2e-spec.ts test/publishing.e2e-spec.ts --maxWorkers=3`:
  5 PASS em três arquivos. O E2E HTTP Commercial adicional está nos 57 focados.
- TypeScript, build, lint (oito avisos preexistentes, sem erros), Prettier dos
  cinco arquivos TypeScript do escopo e diff-check: PASS.

Não houve chamada externa ou faturamento real. Artefatos verificáveis são os
testes versionados, a extensão Commercial e este registro de evidências.

## Limites e continuidade — C-08

Nenhuma inspeção de SQLite LIVE nem comprovação de custos, vendas ou comissões
operacionais reais. Sem deploy, scheduler, publicação, conta Shopee, grants ou
chamada paga. Worktrees existentes preservados. Finance é somente leitura no
produto; os únicos registros simulados são fixtures dos bancos descartáveis.

COMMERCIAL-002 permanece READY_AWAITING_REAL_SHOPEE_SAMPLE. Relatórios reais e
autorizados são necessários para mapear estados/comissões Shopee, sem presumir
layout ou atribuição. Política de custeio completo e evidências de outras
categorias continuam pendentes para lucro/margem/ROI definitivos.
AFFILIATE-001 permanece READY_AWAITING_APPROVAL. Sem outro tópico iniciado.
Um único PR; USER_ONLY_MERGE, sem auto-merge.
