# Documentação do MKTauto

As instruções da task aprovada e o [AGENTS.md](../AGENTS.md) orientam a
execução. O [workflow](PROJECT_WORKFLOW.md) descreve o processo; o
[template de task](TASK_SPEC.md) registra escopo, contratos, custos e aceite.
Documentos de planejamento não autorizam execução LIVE nem comprovam que uma
capacidade está implementada.

## Referências técnicas

- [Visão de produto](CONTENT_AUTOMATION_MVP_PROJECT.md),
  [pipeline modular](MODULAR_VIDEO_PIPELINE.md) e [roadmap](TOPIC_ROADMAP.md):
  decisões e histórico de planejamento. Confronte estados antigos com a task,
  os contratos NestJS e os PRs correspondentes antes de executar instruções.
- [Contrato de ofertas Shopee](tasks/P7.1-SHOPEE-OFFERS-001-contract.md) e
  [contrato de links Shopee](tasks/P7.1-SHOPEE-LINKS-001-contract.md).
- [AffiliateCampaignSourceV1](../backend/src/affiliate/domain/affiliate-campaign-source.ts):
  origem comercial versionada. O
  [AffiliateService](../backend/src/affiliate/application/affiliate.service.ts)
  resolve a origem pelo briefing; não é necessário reconstruí-la de uma URL.
- [EditorialFlowService](../backend/src/content/application/editorial-flow.service.ts):
  ideias e roteiros comerciais com contexto de briefing e origem Shopee.
- [VideoProductionPreparationV1](../backend/src/media/domain/video-production-preparation.ts)
  e [serviço de preparação](../backend/src/media/application/video-production-preparation.service.ts):
  cenas pendentes e necessidades de aquisição, sem executar produção.
- [ContentOperations](../backend/src/content-operations/application/content-operations.service.ts):
  contexto de execução;
  [StageRecoveryService](../backend/src/content-operations/application/stage-recovery.service.ts):
  recuperação das etapas existentes.

A preparação de vídeo distingue intenção de movimento real de imagem estática
ou animada. Movimento, direitos e disponibilidade não são certificados pelo
plano. O contrato de composição permanece separado e requer artefatos reais.

## Dados locais e histórico

Mídias do operador, comandos/exportações de projetos e arquivos de execução não
são fixtures públicas. Os caminhos locais específicos já identificados estão
no `.gitignore`; isso não autoriza seu descarte nem ignora extensões inteiras.
Fixtures versionadas permanecem em `backend/test/support` e nos testes.

Backlogs locais não aprovados, cópias históricas e instruções de CLIs removidas
não são documentação operacional vigente. As CLIs suportadas são definidas
por [scripts/operational-cli.mjs](../scripts/operational-cli.mjs); não execute
comandos antigos apenas porque aparecem em uma nota histórica.
