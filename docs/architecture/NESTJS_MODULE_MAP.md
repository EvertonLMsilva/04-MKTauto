# Mapa de módulos NestJS

`AppModule` é a composição da aplicação. Os 13 módulos existentes foram
preservados com controllers, providers, exports e contratos. Nenhum módulo
novo foi necessário para esta reorganização.

| Diretório em `src/modules/` | Módulo | Responsabilidade |
| --- | --- | --- |
| `project/` | `ProjectModule` | Projetos, comandos e snapshots versionados |
| `research/` | `ResearchModule` | Pesquisa, tendências, catálogo de pesquisa e shortlist |
| `affiliate/` | `AffiliateModule` | Shopee dinâmica, produtos, ofertas, descoberta e catálogo Affiliate |
| `content/` | `ContentModule` | Ideias, roteiros e fluxo editorial |
| `content-operations/` | `ContentOperationsModule` | Runs, ocorrências, contratos e retomada de etapas |
| `content-operations/` | `CampaignOperationsModule` | Port público de operações e histórico de campanhas |
| `content-operations/` | `CampaignOrchestrationModule` | Orquestração de campanhas, scheduler e recuperação |
| `media/` | `MediaModule` | Narração, TTS/CTC, áudio, composição, legendas, FFmpeg, render e QC técnico |
| `publishing/` | `PublishingModule` | Destinos, elegibilidade, aprovação, Instagram/Facebook e recibos |
| `publishing/` | `PublishingOperationsModule` | Port público de operações de publicação |
| `finance/` | `FinanceModule` | Orçamento, custos, reservas e reconciliações financeiras |
| `notifications/` | `OperationalNotificationsModule` | Notificações e alertas operacionais pelos ports públicos |
| `operations/` | `OperationsModule` | APIs administrativas e console operacional do fluxo existente |

## Composição e dependências

Project, Research e Finance preservam seus providers próprios. Affiliate importa
Project. Content Operations importa Project e Affiliate; Campaign Operations e
Publishing Operations expõem seus ports e importam Affiliate. Notifications
consome Campaign Operations e Publishing Operations pelos contratos públicos.

Content compõe Research, Affiliate, Content Operations e Finance. Media compõe
Content, Affiliate, Content Operations e Finance. Publishing compõe Media,
Affiliate, Finance, Campaign Operations e Notifications. Campaign Orchestration
coordena os módulos do fluxo; Operations compõe Campaign Orchestration, Media,
Publishing e Affiliate. Essas relações mantêm os imports reais anteriores,
sem criar um módulo global concentrador.

## Componentes que não são módulos de negócio

`src/infrastructure/administration/` contém provisionamento e ferramentas
administrativas existentes. `src/infrastructure/database/migrations/` contém os
SQL preservados byte a byte. Não foram criados módulos Nest vazios para scripts,
DTOs, funções puras ou interfaces.

`python/` fornece executáveis especializados chamados por adapters de Media;
`scripts/ops-local/` conserva o controle identificado dos workers. Não há segundo
scheduler, mecanismo de migrations, catálogo comercial ou backend operacional.

Aprovações humanas, direitos, Finance, QC, idempotência e efeitos externos
permanecem nos contratos e gates determinísticos existentes.
