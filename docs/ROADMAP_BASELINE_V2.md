# Roadmap baseline V2 — proposta para revisão humana

**Estado: PROPOSED.** Base de evidência: `origin/main` em
`2b9952144de747d31292903b96077de9fb1da3cb` (10/11/2026). Esta
proposta somente se torna oficial após revisão e merge manual pelo usuário.
Não autoriza LIVE, gastos, publicação, deploy nem alteração de prioridades por
si só.

## Substituição da contagem informal

A referência anterior de **59 subtópicos: 31 DONE, 11 PARTIAL, 17 PENDING**
permanece histórica e **não reconciliada**. Não há lista versionada que
identifique seus 59 IDs e critérios. A tabela inicial de
[`history/ROADMAP_HISTORY.md`](history/ROADMAP_HISTORY.md) tem 57 linhas e uma
linha `R02A--R02G` agrupada (63 IDs se expandida); ela descreve outro recorte e
não é denominador desta proposta. O inventário abaixo é uma **nova unidade de
medição**, definida pelas capacidades vigentes do MVP V1. Nenhum percentual
V2 deve ser apresentado como revisão aritmética de 31/59.

## Escopo e regras de contagem

O MVP V1 vigente pede um vídeo por campanha por dia, seleção de produto
afiliado, roteiro, voz local, mídias, render, QC, revisão humana, distribuição
autorizada e recuperação, com orçamento global de produção de US$ 1/dia e
US$ 20/mês. Contamos **19 resultados distintos** abaixo, uma vez cada.
Dependências, correções, testes, commits, PRs e filhos de implementação são
evidência desses resultados, não novas unidades. `MVP-04` cobre a orquestração
diária; `PUBLISHING-002` cobre a coordenação entre destinos; `PUBLISHING-003`
cobre recuperação; `PUBLISHING-004` cobre a fila operacional. Esses critérios
não se sobrepõem. IDs `V1-*` são propostos apenas onde não há ID estável para
o resultado; IDs anteriores permanecem intactos.

Implementação: `DONE` exige entrega técnica integrada e evidência para o
critério técnico declarado; `PARTIAL` cobre parte demonstrada; `PENDING` ainda
não demonstra a capacidade; `BLOCKED` tem dependência externa identificada;
`UNVERIFIED` significa evidência insuficiente. Integração: `MERGED`, `PR_OPEN`,
`PENDING` ou `NOT_APPLICABLE`. Operação: `ACCEPTED` exige aceite humano e
evidência da condição operacional inteira, `PARTIAL` demonstra só uma parte,
`BLOCKED` tem gate conhecido, `NOT_TESTED` não demonstra a execução real,
`NOT_APPLICABLE` não exige execução operacional e `UNVERIFIED` carece de fonte.
Merge e teste offline nunca equivalem a `ACCEPTED`.

### Inventário canônico proposto do MVP V1

Abreviações: A/B/C = Frentes A/B/C; `T/I/O` = implementação / integração /
operação. PRs são evidência de integração, sem aceite automático. O critério
operacional de cada linha é necessário para `ACCEPTED`.

| ID | Resultado; frente/módulo; pai; dependência | Critério técnico / critério operacional | T / I / O | Evidência e lacuna |
|---|---|---|---|---|
| AFFILIATE-004 | Qualificar feeds locais; B/Affiliate; V1; fontes autorizadas | Classificação auditável e limites / feed real validado para seleção | DONE / MERGED / PARTIAL | PR #141, task `AFFILIATE-004`; sem seleção comercial final |
| AFFILIATE-005 | Preparar prévia de produto/oferta; B/Affiliate; V1; AFFILIATE-004 | Pacote revisável com razões e imagens autorizadas / revisão humana vigente | DONE / MERGED / NOT_TESTED | PR #142, task `AFFILIATE-005`; prévia não é cadastro aprovado |
| AFFILIATE-006 | Comparar revisões de feed; B/Affiliate; V1; AFFILIATE-004 | Sincronização e comparação auditáveis / revisão de mudança real aprovada | DONE / MERGED / NOT_TESTED | PR #148; ID proposto para esta entrega, sem task canônica própria |
| AFFILIATE-001 | Cadastrar produto/campanha elegíveis; B/Affiliate; V1; revisão e direitos | Cadastro vinculado, evidências e aprovação / produto e oferta reais aprovados | PARTIAL / MERGED / BLOCKED | Base #126/#128; roadmap registra `READY_AWAITING_APPROVAL` |
| V1-EDITORIAL-01 | Gerar roteiro fundamentado; A/Content Operations; V1; produto e projeto | Roteiro com origem e revisão / roteiro de ocorrência real aprovado | DONE / MERGED / PARTIAL | Base #126/#128, correção #133; não comprova ciclo diário inteiro |
| V1-MEDIA-01 | Produzir voz, mídia e MP4 final; A/Media; V1; roteiro e direitos | Voz local, alinhamento, render e hashes reproduzíveis / Kokoro e artefato final reais homologados no ciclo | PARTIAL / MERGED / PARTIAL | #130/#132/#140 e `MKTAUTO-MVP-03-LIVE`; Piper não prova Kokoro do V1 |
| V1-QC-01 | Revisar render e pacote exatos; A/Content Operations; V1; V1-MEDIA-01 | QC e decisões por hash/revisão / aprovação humana vigente de cada ocorrência | DONE / MERGED / PARTIAL | Base #126/#128; `MKTAUTO-MVP-FINAL`; uma aprovação não autoriza datas futuras |
| MVP-04 | Repetir uma execução por campanha e data; A/Content Operations; V1; Affiliate, Media e Finance | Identidade por dia, scheduler e replay seguros / D1 e D2 reais com recibos e custos | DONE / MERGED / NOT_TESTED | #128 e `MKTAUTO-MVP-04`; documento explicita ausência de homologação diária contínua |
| V1-PUBLISHING-IG-01 | Publicar Instagram autorizado; A/Publishing; V1; V1-QC-01 | Operação, reconciliação e recibo / publicação real da ocorrência corrente com recibo | DONE / MERGED / PARTIAL | Base #126/#128; `MKTAUTO-MVP-03-LIVE` registra um Reel real, não D1/D2 |
| PUBLISHING-FB-001 | Publicar Facebook autorizado; A/Publishing; V1; V1-QC-01 | Supersession, grant por operação e recibo / Reel real confirmado sem duplicação | DONE / MERGED / UNVERIFIED | #127/#138; não há aceite operacional completo versionado nesta baseline |
| PUBLISHING-002 | Coordenar destinos recorrentes; A/Publishing; V1; operações por destino | Instagram/Facebook independentes sem grant implícito / ocorrência real multidestino validada | DONE / MERGED / NOT_TESTED | #144; validação offline não prova execução real conjunta |
| PUBLISHING-003 | Recuperar incerteza multidestino; A/Publishing; V1; PUBLISHING-002 | Reconcile/replay sem POST cego / falha real recuperada com evidência | DONE / MERGED / NOT_TESTED | #146; não contar novamente #144 |
| PUBLISHING-004 | Expor fila operacional; A/Publishing; V1; PUBLISHING-002 | Fila e estados consultáveis / operador usa fila em ciclo real | DONE / MERGED / NOT_TESTED | #149; não prova publicação |
| V1-FINANCE-01 | Aplicar orçamento global de produção; C/Finance; V1; custos/providers | US$ 1/dia e US$ 20/mês, `UNKNOWN` distinto de zero / custos reais reconciliados nos dois limites | PARTIAL / MERGED / BLOCKED | Base #126/#128, #139; falta evidência do ciclo V1 completo e custos reais |
| COMMERCIAL-001 | Rastrear publicação e atribuição; C/Commercial; V1; recibo e CTA | Vínculos e fontes auditáveis / cliques e resultados reais conferidos | DONE / MERGED / NOT_TESTED | #135 e task `COMMERCIAL-001`; fixtures não comprovam resultados reais |
| COMMERCIAL-002 | Conciliar venda/comissão Shopee; C/Commercial; V1; amostra autorizada | Importação/validação sem inventar layout / amostra real conciliada | BLOCKED / PENDING / BLOCKED | `COMMERCIAL-001`/`COMMERCIAL-003`: falta amostra real Shopee aprovada |
| COMMERCIAL-003 | Expor prontidão de rentabilidade; C/Commercial; V1; Finance e COMMERCIAL-001 | Custos e estados de prontidão auditáveis / lucro real somente com comissão conciliada | DONE / MERGED / BLOCKED | #139 e task `COMMERCIAL-003`; COMMERCIAL-002 pendente |
| V1-OPS-01 | Operar release local isolado; transversal/Operations; V1; stack integrada | Lifecycle e observabilidade com providers fake / D1/D2 reais em runtime aprovado | DONE / MERGED / NOT_TESTED | #134/#150; piloto FAKE não é homologação LIVE |
| FE01 | Integrar frontend React por API; transversal/Frontend; V1; contratos backend estáveis | Fluxo React revisa, aprova e acompanha / usuário conclui fluxo real pela UI | UNVERIFIED / PENDING / UNVERIFIED | `tasks/FE01.md`; frontend em repositório próprio, código e PR não verificados |

O ID proposto `AFFILIATE-006` corresponde apenas à sincronização do PR #148;
`V1-*` não renomeia `P1`–`P5`, `E*`, `FND*` ou `FE01`. A aprovação desta
proposta deve confirmar a granularidade desses resultados antes de torná-los
baseline oficial.

## Indicadores reproduzíveis

Com denominador de 19 linhas da tabela (inclusive `UNVERIFIED`):

- **Implementação técnica DONE: 14/19 = 73,68%.** `PARTIAL` = 3,
  `BLOCKED` = 1, `UNVERIFIED` = 1. Parcial não recebe fração de crédito.
- **Aceite operacional ACCEPTED: 0/19 = 0%.** A evidência versionada comprova
  fatos operacionais parciais, como um Reel Instagram, mas não registra aceite
  humano integral dos critérios V1 desta tabela. `PARTIAL` = 5,
  `BLOCKED` = 4, `NOT_TESTED` = 8, `UNVERIFIED` = 2.
- **Roadmap ampliado: N/A.** MVP V2 (seis peças por ciclo), YouTube, Threads,
  TikTok, Ads Manager, cloud e SaaS têm escopo aprovado em nível de fase, mas
  não um conjunto completo de IDs e critérios de tópico. Não usar 19 como
  denominador dessas fases.

Os percentuais são de **proposta**, não progresso oficial até aprovação.
`UNVERIFIED` permanece no denominador V1 para evitar inflar o resultado.

## PRs #126–#150: mapa sem dupla contagem

Todos os PRs listados abaixo aparecem `MERGED` em `main` até o SHA acima.
Um PR de correção ou teste reforça a linha indicada e não cria uma unidade.

| PR | Entrega vinculada ao inventário ou histórico |
|---|---|
| #126 | Baseline histórica P0/P1/P2; fundamento de Affiliate, Media, QC, Finance e Publishing |
| #127 | PUBLISHING-FB-001, supersession e autorização |
| #128 | MVP-04, editorial, QC, Finance e integração operacional histórica |
| #129 | UI operacional existente; não comprova FE01 React |
| #130 | V1-MEDIA-01, correção de providers locais |
| #131 | AFFILIATE-001/V1-QC-01, vínculo oferta–pacote |
| #132 | V1-MEDIA-01, alinhamento e legendas |
| #133 | V1-EDITORIAL-01, correção Ollama |
| #134 | V1-OPS-01, endpoint do dashboard |
| #135 | COMMERCIAL-001, rastreamento |
| #136 | Governança Affiliate-First; decisão documental, sem tópico adicional |
| #137 | V1-MEDIA-01, regressão de duração |
| #138 | PUBLISHING-FB-001, correção do FINISH |
| #139 | COMMERCIAL-003, prontidão de rentabilidade |
| #140 | MEDIA-004 histórica e V1-MEDIA-01; Piper não substitui Kokoro |
| #141 | AFFILIATE-004 |
| #142 | AFFILIATE-005 |
| #143 | V1-OPS-01, correção de harness de notificações |
| #144 | PUBLISHING-002 |
| #145 | COMMERCIAL-001/PUBLISHING-002, correção de fixtures de grant |
| #146 | PUBLISHING-003 |
| #147 | Gates de teste transversal; sem tópico adicional |
| #148 | AFFILIATE-006 |
| #149 | PUBLISHING-004 |
| #150 | V1-OPS-01, piloto local FAKE |

## Histórico e fases fora do denominador V1

- **Histórico antigo:** `B00`, `V*`, `R*`, `PC*`, `E*`, `FND*`, `AI*`,
  `P0`–`P5` e seus filhos continuam no roadmap e no histórico com os IDs
  originais. `P5.2`–`P5.4` são referência da progressão de publicação;
  resultados específicos V1 acima não os contam novamente. Estados antigos
  preservados nos documentos não são automaticamente atualizados por merges.
- **MVP V2:** vídeo principal, duas imagens e três postagens por ciclo,
  distribuição escalonada. Futuro; tópicos e denominador ainda não aprovados.
- **Expansão multiplataforma:** YouTube, Threads e TikTok exigem contratos,
  permissões e gates próprios. Instagram/Facebook V1 são as linhas atuais.
- **Ads Manager, cloud e SaaS:** posteriores à V2 ou à validação comercial;
  sem prioridade ou percentual V1. Frontend React está em repositório separado;
  esta proposta não atribui aceite a código não inspecionado.

## Bloqueios e ordem recomendada

1. Concluir AFFILIATE-001 com decisão humana e produto/oferta reais elegíveis;
   manter fontes, direitos e evidências auditáveis.
2. Demonstrar V1-MEDIA-01 e V1-QC-01 no runtime integrado, incluindo Kokoro,
   MP4 final e aprovação exata. Não inferir Kokoro a partir do PR Piper.
3. Reconciliar V1-FINANCE-01 com custos reais, indisponibilidades e ambos os
   limites antes de qualquer execução paga.
4. Homologar MVP-04 em D1/D2 e a distribuição por destino, com grants
   específicos, recibos, recuperação de `UNKNOWN` e operações independentes.
5. Obter amostra Shopee autorizada para COMMERCIAL-002; só então validar
   resultados e rentabilidade reais.
6. Inspecionar o repositório React separado antes de alterar FE01 de
   `UNVERIFIED`. Não priorizar cloud, SaaS ou Ads Manager para fechar o V1.

Não há nesta proposta confirmação de homologação operacional completa da
Frente A, B ou C. O próximo gate é revisão humana do inventário, da
granularidade e dos critérios; o merge pertence exclusivamente ao usuário.
