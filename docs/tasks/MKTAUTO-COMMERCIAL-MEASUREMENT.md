# Mensuração comercial mínima por publicação

## Modelo e identidade

Publishing já possui `recordResults`, contratos KNOWN/UNKNOWN e registros imutáveis `manual_distribution_records` de tipo `RESULTS`. A mensuração operacional reutiliza esses registros e os recibos de idempotência existentes em `affiliate_commands`. Não há migration, novo banco, ledger financeiro ou scheduler.

O resolver parte de executionId, operationId Instagram ou publicationId manual. Resolve internamente pacote aprovado/publicado, execução, campanha, vínculo Affiliate e briefing. No modo CATALOG, confere produto/revisão, campanha/revisão da oferta, URL e hash do briefing contra a seleção congelada da ocorrência. A campanha recorrente e a campanha Affiliate da oferta podem ser diferentes; ambas são apresentadas. A consulta não troca o produto pelo cadastro mais recente.

Para Instagram oficial, exige operação `PUBLISHED`, sem reconciliação pendente e com recibo remoto cujo mediaId coincida com a operação. O recibo oferece publishedAt, remoteMediaId e permalink. O modo `fake`/`live` acompanha a identidade, sem confundir teste com publicação real. Para publicação manual, exige confirmação `PUBLISHED`; ID externo ou permalink ausentes ficam UNKNOWN. Pacotes sem publicação confirmada e registros sem vínculo de execução válido não recebem resultados.

O registro V2 congela a identidade resolvida, período, fonte, atribuição, operador declarado, métricas, revisão, horário de registro e hash do resultado anterior. Produto, link e suas revisões não podem ser fornecidos pelo cliente. O cadastro posterior de outra revisão não altera resultados históricos.

## Campos medidos e UNKNOWN

| Grupo | Campos | Fonte atual |
|---|---|---|
| Publicação | publishedAt, remoteMediaId, permalink, modo de execução | Recibo Instagram persistido ou confirmação manual |
| Instagram | views, reach, impressions, engagement | Registro manual auditável; não há chamada Insights |
| Afiliado | clicks, sales (quantidade de vendas/pedidos reportada), revenue (receita bruta), commissions | Relatório/evidência indicado pelo operador |
| Finance | Eventos de custo, ajustes, totais por moeda e reconciliações | Ledger V2 existente, somente leitura |
| Resultado | commission, knownCost, knownNetResult | Apenas operandos conhecidos e diretamente atribuídos |

Contadores são inteiros não negativos. Valores monetários são decimais em texto com até 18 casas e moeda explícita. O valor `0` só é conhecido quando declarado pela fonte; ausência não vira zero. Métrica omitida recebe `{ "status": "UNKNOWN", "reason": "NOT_REPORTED" }`. Também é permitido enviar UNKNOWN com motivo explícito. A resposta inclui `unknownFields` e `unknownCosts`.

`DIRECT_PUBLICATION` representa a declaração do operador de que a evidência se refere àquela publicação exata. `CAMPAIGN_REPORTED` e `UNATTRIBUTED` preservam os números reportados no histórico, mas não os atribuem à publicação: comissão, vendas, métricas e resultado líquido dessa publicação permanecem UNKNOWN. Atribuição omitida é UNATTRIBUTED. `sourceReference` deve identificar relatório, recibo ou evidência que possa ser conferida; `actor` é uma declaração auditável, não uma autenticação externa nem uma validação automática da fonte.

## Registro e consulta

Usar os endpoints existentes de Publishing, acrescidos das rotas:

| Identidade já disponível | Registrar (POST) e consultar (GET) |
|---|---|
| Execução | `/publishing/executions/:executionId/commercial-results` |
| Operação Instagram | `/publishing/social-operations/:operationId/commercial-results` |
| Confirmação manual | `/publishing/manual-publications/:publicationId/commercial-results` |

Exemplo de corpo POST, com números apenas ilustrativos — substituir por valores e referências realmente observados:

```json
{
  "idempotencyKey": "resultado_relatorio_001",
  "input": {
    "actor": "operador_001",
    "sourceReference": "report:afiliado-exportacao-001",
    "periodStart": "2026-11-08T03:00:00Z",
    "periodEnd": "2026-11-09T03:00:00Z",
    "attribution": "DIRECT_PUBLICATION",
    "metrics": { "views": { "status": "KNOWN", "value": 123 } },
    "clicks": { "status": "UNKNOWN", "reason": "Sem fonte verificável" },
    "sales": { "status": "KNOWN", "value": 1 },
    "commissions": { "status": "KNOWN", "amount": "10.20", "currency": "BRL" }
  }
}
```

Não copiar hashes de pacote, produto ou briefing. O servidor usa a identidade da rota. O endpoint antigo `POST /publishing/results` continua funcionando; seus resultados manuais persistidos são incluídos na consulta comercial, com revisão inicial derivada 1, sem reescrever o registro antigo.

## Replay, correções e períodos

A série de observações é identificada por publicação, período normalizado em UTC, fonte e atribuição. O primeiro registro usa `expectedRevision=0` (padrão). Reenviar o mesmo conteúdo com a mesma chave ou outra chave não duplica a observação. A consulta pela execução ou pela operação Instagram chega à mesma série.

Uma correção usa novo `idempotencyKey`, `expectedRevision` igual à revisão atual e `correctionReason` obrigatório, com o snapshot completo corrigido dos campos que se deseja manter. Campos omitidos na correção ficam UNKNOWN; não há merge silencioso. A nova revisão referencia o hash anterior. Reutilizar chave com conteúdo diferente, corrigir uma revisão obsoleta ou alterar um resultado sem declarar correção retorna conflito. A transação existente protege revisão e recibo de idempotência.

`history` mantém todas as revisões; `observations` contém a revisão vigente de cada série. O resumo escolhe a série registrada mais recentemente, com desempate determinístico por hash. `observationScope` mostra período, fonte, atribuição e revisão. Relatórios de fontes/períodos sobrepostos não são somados: isso evita duplicar comissão, vendas ou métricas cumulativas. Não há importação que atribua vendas automaticamente nem resolução automática de divergências entre fontes.

## Custos e resultado conhecido

`knownCost` é o subtotal monetário do ledger Finance V2 da execução, incluindo ajustes persistidos. `costLedger` expõe os eventos e evidências que fundamentam esse valor. Sem eventos monetários, o custo é UNKNOWN. Mais de uma moeda torna o custo consolidado UNKNOWN; os totais permanecem disponíveis em `knownCostsByCurrency`. Não se faz câmbio.

Quando comissão diretamente atribuída e custo monetário são conhecidos na mesma moeda, calcula-se exatamente `knownNetResult = commission - knownCost`, inclusive resultados negativos. Comissão desconhecida, custo desconhecido ou moedas incompatíveis mantêm o líquido UNKNOWN. Esse campo desconta **somente custos monetários registrados**: não é lucro total nem ROI. `knownNetResultScope` explicita o alcance; `costCompleteness` permanece UNKNOWN. Não somar novamente o mesmo custo de execução quando houver mais de uma publicação; `costScope` identifica o vínculo compartilhado.

Hardware/energia local continuam UNKNOWN, pois não há medição implementada. Operações Finance pendentes/desconhecidas, reconciliações TTS desconhecidas e custos UNKNOWN explicitamente registrados nas etapas do workflow aparecem em `unknownCosts`. Nada é gravado no Finance pela mensuração; os limites de US$ 1/dia e US$ 20/mês permanecem inalterados. Custos reais podem ser registrados pelo contrato Finance existente (`POST /finance/costs`), com evidência/origem e vínculo da execução, sem preços fictícios.

## Limitações e validação

Não há frontend, dashboard, analytics avançado, atribuição estatística, discovery, scraping, fal.ai ou integração de relatórios Shopee. O adapter Meta atual é usado apenas pelo fluxo já existente de publicação/recibo; esta mensuração não consulta Meta Insights, Shopee, serviços externos ou APIs pagas. Os números manuais não são tratados como verificação automática de vendas pela plataforma. Publicação, permissões e aprovações existentes continuam obrigatórias; a mensuração não libera publicação nem modifica seus gates.

Os testes usam SQLite temporário com foreign keys ativas. Cobrem confirmação, CATALOG A → B → A, produto/link congelados após revisão futura, publicações independentes do mesmo produto, replay, correções, restart, compatibilidade com recordResults, precisão decimal, custo ausente, comissão ausente/zero, moedas incompatíveis e atribuição não direta. O E2E HTTP usa seleção real, vínculo Affiliate real, pacote e aprovação persistidos e publicação Instagram confirmada pelo adapter fake. Registra resultados e consulta o mesmo resumo por execução/operação, sem Meta real, mídia produzida ou chamada paga. Custo de hardware/energia dos testes: UNKNOWN.

Validação de 08/11/2026: `vitest run src/publishing src/finance src/affiliate src/content-operations` — 645 PASS em 62 arquivos, incluindo os 13 testes novos. Após os últimos campos de evidência no resumo, os 13 testes focados passaram novamente. TypeScript, build e lint: PASS; somente oito avisos preexistentes no lint. Diff do escopo e dos arquivos novos: PASS. O diff global conserva o whitespace preexistente em `src/db/migrations/038_commercial_automation.sql:114`. As 34 alterações locais protegidas permaneceram idênticas por SHA-256. Sem uso de banco LIVE/principal, migration, alteração de limites Finance, commit, push ou PR.
