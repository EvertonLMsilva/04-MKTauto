# Roadmap baseline V2 — inventário documental integrado

**Estado documental: INTEGRATED — PR #151 MERGED.** Base desta revisão:
`origin/main` em `28eebc367bebf55667a8300d7568328cfab4398c`
(10/11/2026). O PR #151 foi integrado por `EvertonLMsilva`, sem auto-merge;
a proposta deixou de aguardar integração Git. Separar três dimensões:

- **Integração Git:** comprovada pelo merge acima; não manter `PROPOSED` como
  estado documental atual.
- **Aprovação da baseline:** os 19 resultados são a referência documental
  integrada. Estas correções e os conflitos de critério explicitados abaixo
  continuam sujeitos à revisão humana; `MERGED` não comprova, sozinho, uma
  decisão de alterar o requisito histórico de voz nem o aceite dos resultados.
- **Autorizações operacionais:** dependem das decisões específicas de recurso,
  imagem, janela e ocorrência. Aprovar a baseline não autoriza LIVE, gastos,
  publicação ou deploy, nem renova autorizações anteriores.

## Substituição da contagem informal

A referência anterior de **59 subtópicos: 31 DONE, 11 PARTIAL, 17 PENDING**
permanece histórica e **não reconciliada**. Não há lista versionada que
identifique seus 59 IDs e critérios. A tabela inicial de
[`history/ROADMAP_HISTORY.md`](history/ROADMAP_HISTORY.md) tem 57 linhas e uma
linha `R02A--R02G` agrupada (63 IDs se expandida); ela descreve outro recorte e
não é denominador desta baseline. O inventário abaixo é uma **nova unidade de
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
não se sobrepõem. IDs `V1-*` foram definidos apenas onde não havia ID estável para
o resultado; IDs anteriores permanecem intactos.

Frentes vigentes: **A = Publishing; B = Media/produção; C =
Affiliate/Commercial. Operations é transversal**, incluindo recorrência e
coordenação do fluxo entre frentes; não pertence exclusivamente à Frente A.
QC e frontend também atravessam os módulos. MEDIA-004 e MEDIA-005 fornecem
evidência para resultados existentes: MEDIA-005 se vincula ao release
operacional V1 em `V1-OPS-01`, com evidência de mídia em `V1-MEDIA-01`, sem
acrescentar linha ou unidade ao denominador.

Implementação: `DONE` exige entrega técnica integrada e evidência para o
critério técnico declarado; `PARTIAL` cobre parte demonstrada; `PENDING` ainda
não demonstra a capacidade; `BLOCKED` tem dependência externa identificada;
`UNVERIFIED` significa evidência insuficiente. Integração: `MERGED`, `PR_OPEN`,
`PENDING` ou `NOT_APPLICABLE`. Operação: `ACCEPTED` exige aceite humano e
evidência da condição operacional inteira, `PARTIAL` demonstra só uma parte,
`BLOCKED` tem gate conhecido, `NOT_TESTED` não demonstra a execução real,
`NOT_APPLICABLE` não exige execução operacional e `UNVERIFIED` carece de fonte.
Merge e teste offline nunca equivalem a `ACCEPTED`.

### Inventário documental integrado do MVP V1

Abreviações: A/B/C = Frentes A/B/C; `T/I/O` = implementação / integração /
operação. PRs são evidência de integração, sem aceite automático. O critério
operacional de cada linha é necessário para `ACCEPTED`.

| ID | Resultado; frente/módulo; pai; dependência | Critério técnico / critério operacional | T / I / O | Evidência e lacuna |
|---|---|---|---|---|
| AFFILIATE-004 | Qualificar feeds locais; C/Affiliate; V1; fontes autorizadas | Classificação auditável e limites / feed real validado para seleção | DONE / MERGED / PARTIAL | PR #141, task `AFFILIATE-004`; sem seleção comercial final |
| AFFILIATE-005 | Preparar prévia de produto/oferta; C/Affiliate; V1; AFFILIATE-004 | Pacote revisável com razões e imagens autorizadas / revisão humana vigente | DONE / MERGED / NOT_TESTED | PR #142, task `AFFILIATE-005`; prévia não é cadastro aprovado |
| AFFILIATE-006 | Comparar revisões de feed; C/Affiliate; V1; AFFILIATE-004 | Sincronização e comparação auditáveis / revisão de mudança real aprovada | DONE / MERGED / NOT_TESTED | PR #148; ID documental desta entrega, sem task canônica própria |
| AFFILIATE-001 | Cadastrar produto/campanha elegíveis; C/Affiliate; V1; revisão e direitos | Cadastro vinculado, evidências e aprovação / produto e oferta reais aprovados | PARTIAL / MERGED / BLOCKED | Base #126/#128; roadmap registra `READY_AWAITING_APPROVAL` |
| V1-EDITORIAL-01 | Gerar roteiro fundamentado; B/Produção (Content Operations); V1; produto e projeto | Roteiro com origem e revisão / roteiro de ocorrência real aprovado | DONE / MERGED / PARTIAL | Base #126/#128, correção #133; não comprova ciclo diário inteiro |
| V1-MEDIA-01 | Produzir voz, mídia e MP4 final; B/Media; V1; roteiro e direitos | Voz local, alinhamento, render e hashes reproduzíveis / Kokoro e artefato final reais homologados no ciclo | DONE / MERGED / PARTIAL | #130/#132/#140, MEDIA-004 e MEDIA-005 Tasks 123–125 comprovam o critério técnico com Piper Cadu; critério histórico Kokoro e ciclo operacional integral continuam sem fechamento |
| V1-QC-01 | Revisar render e pacote exatos; transversal/QC e Operations; V1; V1-MEDIA-01 | QC e decisões por hash/revisão / aprovação humana vigente de cada ocorrência | DONE / MERGED / PARTIAL | Base #126/#128; `MKTAUTO-MVP-FINAL`; uma aprovação não autoriza datas futuras |
| MVP-04 | Repetir uma execução por campanha e data; transversal/Operations; V1; Affiliate, Media e Finance | Identidade por dia, scheduler e replay seguros / D1 e D2 reais com recibos e custos | DONE / MERGED / NOT_TESTED | #128 e `MKTAUTO-MVP-04`; documento explicita ausência de homologação diária contínua |
| V1-PUBLISHING-IG-01 | Publicar Instagram autorizado; A/Publishing; V1; V1-QC-01 | Operação, reconciliação e recibo / publicação real da ocorrência corrente com recibo | DONE / MERGED / PARTIAL | Base #126/#128; `MKTAUTO-MVP-03-LIVE` registra um Reel real, não D1/D2 |
| PUBLISHING-FB-001 | Publicar Facebook autorizado; A/Publishing; V1; V1-QC-01 | Supersession, grant por operação e recibo / Reel real confirmado sem duplicação | DONE / MERGED / PARTIAL | #127/#138 e relatório da Task 112: sucessora PUBLISHED v12, Reel e recibo persistido, sem repetição de CREATE/UPLOAD/FINISH registrada; risco residual da sessão original UNKNOWN e aceite humano integral do critério não comprovado |
| PUBLISHING-002 | Coordenar destinos recorrentes; A/Publishing; V1; operações por destino | Instagram/Facebook independentes sem grant implícito / ocorrência real multidestino validada | DONE / MERGED / NOT_TESTED | #144; validação offline não prova execução real conjunta |
| PUBLISHING-003 | Recuperar incerteza multidestino; A/Publishing; V1; PUBLISHING-002 | Reconcile/replay sem POST cego / falha real recuperada com evidência | DONE / MERGED / NOT_TESTED | #146; não contar novamente #144 |
| PUBLISHING-004 | Expor fila operacional; A/Publishing; V1; PUBLISHING-002 | Fila e estados consultáveis / operador usa fila em ciclo real | DONE / MERGED / NOT_TESTED | #149; não prova publicação |
| V1-FINANCE-01 | Aplicar orçamento global de produção; C/Finance; V1; custos/providers | US$ 1/dia e US$ 20/mês, `UNKNOWN` distinto de zero / custos reais reconciliados nos dois limites | PARTIAL / MERGED / BLOCKED | Base #126/#128, #139; falta evidência do ciclo V1 completo e custos reais |
| COMMERCIAL-001 | Rastrear publicação e atribuição; C/Commercial; V1; recibo e CTA | Vínculos e fontes auditáveis / cliques e resultados reais conferidos | DONE / MERGED / NOT_TESTED | #135 e task `COMMERCIAL-001`; fixtures não comprovam resultados reais |
| COMMERCIAL-002 | Conciliar venda/comissão Shopee; C/Commercial; V1; amostra autorizada | Importação/validação sem inventar layout / amostra real conciliada | BLOCKED / PENDING / BLOCKED | `COMMERCIAL-001`/`COMMERCIAL-003`: falta amostra real Shopee aprovada |
| COMMERCIAL-003 | Expor prontidão de rentabilidade; C/Commercial; V1; Finance e COMMERCIAL-001 | Custos e estados de prontidão auditáveis / lucro real somente com comissão conciliada | DONE / MERGED / BLOCKED | #139 e task `COMMERCIAL-003`; COMMERCIAL-002 pendente |
| V1-OPS-01 | Operar release local isolado; transversal/Operations; V1; stack integrada | Lifecycle e observabilidade com providers fake / D1/D2 reais em runtime aprovado | DONE / MERGED / PARTIAL | #134/#150 e MEDIA-005 Task 125: release V1 DEPLOYED_SMOKE_PASS por DECISION-04 específica; D1/D2 não autorizados. Perímetro local B aceito com risco residual, sem isolamento exclusivo comprovado |
| FE01 | Integrar frontend React por API; transversal/Frontend; V1; contratos backend estáveis | Fluxo React revisa, aprova e acompanha / usuário conclui fluxo real pela UI | UNVERIFIED / PENDING / UNVERIFIED | `tasks/FE01.md`; frontend em repositório próprio, código e PR não verificados |

O ID documental `AFFILIATE-006` corresponde apenas à sincronização do PR #148;
`V1-*` não renomeia `P1`–`P5`, `E*`, `FND*` ou `FE01`. A aprovação desta
revisão não acrescenta tópicos nem conta MEDIA-005 separadamente. Os 19 IDs e
os critérios da tabela anterior foram preservados; as alterações de estado
decorrem das evidências e da separação entre critério técnico e operacional.

## Decisões comprovadas e limites de escopo

### Voz histórica Kokoro e aprovação Piper Cadu

O requisito de Kokoro aprovado em 13/10/2026 permanece registrado no roadmap.
MEDIA-004 registra a escolha humana de Piper cadu-medium, pausa adicional zero
e aprovação do vídeo exato de hash
`6abdba4e6c4c090bd2fd7e335944b48f91255dbed61aa07473d9f808ad31dd4c`.
O PR #140 integra essa implementação. A candidata MEDIA-005 Task 123 reutiliza
outro MP4 anteriormente aprovado, de hash
`76d669c5955b53e61513fc151176205e7f14a248bb0074b8eb4d5940cf6325ee`,
após conferir equivalência de código, recursos, configuração e artefato. Os dois
hashes não identificam o mesmo vídeo; não se transfere aprovação entre arquivos.
A Task 123 registra 1.458 testes PASS, Piper real e CTC CPU. A Task 124 aprova a imagem
exata para release e as condições específicas; a DECISION-04 da Task 125
autoriza e comprova o deploy dos manifests derivados exatos, inclusive Piper.

Isso comprova o critério técnico já existente de `V1-MEDIA-01`: voz local,
alinhamento, render e hashes reproduzíveis. Por isso T passa de `PARTIAL` para
`DONE`, mantendo O em `PARTIAL`. **Aprovação de Piper para o artefato e o release
descritos não é uma dispensa geral do requisito Kokoro no MVP V1.** O relatório
125 ainda registra Kokoro `BLOCKED`. Falta reconciliar expressamente o critério
global de voz com a decisão específica de Piper; o texto histórico e o critério
operacional da tabela não são substituídos por inferência.

### Facebook: publicação comprovada e aceite ainda não integral

O relatório privado `PUBLISHING-FB-RESUME-FINISH-112` registra a sucessora
`PUBLISHED`, versão 12, media ID `1386462946673852`, recibo persistido e
[Reel registrado](https://www.facebook.com/reel/1386462946673852/). Registra uma
intenção FINISH, sem repetição de CREATE, UPLOAD ou FINISH. Essa evidência
justifica O de `UNVERIFIED` para `PARTIAL`; não cabe afirmar ausência de
publicação real. A sessão original conserva progresso `UNKNOWN` e risco de
bytes não observados; custo permanece `UNKNOWN`. O campo remoto `created_time`
não prova o instante da publicação. Ator QC e autorização de execução não
comprovam, por si sós, aceite humano posterior do critério operacional inteiro.
Sem esse aceite e o fechamento das ressalvas aplicáveis, não marcar `ACCEPTED`.

### MEDIA-005: release operacional V1 com autorização própria

`V1-OPS-01` incorpora o release MEDIA-005, sem criar um vigésimo resultado.
O registro final da Task 125 é `DEPLOYED_SMOKE_PASS`: imagem
`sha256:d0822016fc8c533a67c05f67a340989eb13d0c14b128b8c34f78bbe727303e3a`,
source `2b9952144de747d31292903b96077de9fb1da3cb`, backup e restauração privada
de teste PASS, API/QC/Finance 200 e preservação do recibo Facebook. A decisão
humana foi **somente a janela e a recuperação limitada descritas**; não decorreu
do merge do PR #151. O perímetro B foi aceito com risco residual de acesso por
outros clientes locais; não se comprovou isolamento exclusivo. O critério e o
nome históricos de release isolado continuam com essa ressalva explícita.

Essa operação real parcial altera O de `NOT_TESTED` para `PARTIAL`; não comprova
D1/D2. Schedulers, publicação e TTS pago permaneceram desabilitados; nenhuma
nova publicação, inferência ou geração integrou o deploy. A autorização daquela
janela não se renova nem habilita futuras operações por efeito deste documento.

Fontes preexistentes consultadas, mantidas privadas e não anexadas ao Git:

- `private/kate-mkt/facebook-publishing/task112-20261110T054350Z-6f6872c0/result.json`
  e `receipt-recovery-response.json` no mesmo diretório.
- `D:/04-Projetos/MKTauto-runtime/media-005-123-2b99521/RESULT.json` e
  `media-005-124-2b99521/OPERATOR_APPROVAL_124.json`, sob o mesmo root privado.
- `D:/04-Projetos/MKTauto-runtime/media-005-125-2b99521/RELATORIO_125.txt`,
  `execution/FINAL_STATUS.json` e `operator/DECISION_04.AUTHORIZED.json`.

Esta correção consulta documentos e relatórios, sem acesso a SQLite LIVE,
consultas novas à Meta, testes operacionais ou alterações de runtime.

## Indicadores reproduzíveis

Com denominador de 19 linhas da tabela (inclusive `UNVERIFIED`):

- **Implementação técnica DONE: 15/19 = 78,95%.** `PARTIAL` = 2,
  `BLOCKED` = 1, `UNVERIFIED` = 1. Parcial não recebe fração de crédito.
- **Aceite operacional ACCEPTED: 0/19 = 0%.** A documentação e os relatórios
  preexistentes citados comprovam fatos parciais, como Reels Instagram/Facebook e o release
  MEDIA-005, mas não comprova aceite humano integral dos critérios V1 desta
  tabela. `PARTIAL` = 7, `BLOCKED` = 4, `NOT_TESTED` = 7, `UNVERIFIED` = 1.
- **Roadmap ampliado: N/A.** MVP V2 (seis peças por ciclo), YouTube, Threads,
  TikTok, Ads Manager, cloud e SaaS têm escopo aprovado em nível de fase, mas
  não um conjunto completo de IDs e critérios de tópico. Não usar 19 como
  denominador dessas fases.

Os percentuais medem a referência documental integrada e suas evidências;
não certificam aceite comercial, homologação integral ou autorização LIVE.
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
| #140 | MEDIA-004 e V1-MEDIA-01; Piper aprovado no escopo específico, sem dispensa geral do requisito Kokoro |
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

O PR #151 integra esta baseline documental; não é um resultado funcional novo.
MEDIA-005 é um processo de release e suas decisões próprias, vinculado a
`V1-OPS-01` e às evidências de `V1-MEDIA-01`, sem novo ID no inventário.

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
  esta baseline não atribui aceite a código não inspecionado.

## Bloqueios e ordem recomendada

1. Concluir AFFILIATE-001 com decisão humana e produto/oferta reais elegíveis;
   manter fontes, direitos e evidências auditáveis.
2. Reconciliar o requisito global Kokoro com Piper já aprovado para o artefato
   e o release específicos; manter o aceite operacional V1 parcial. Homologar
   o ciclo e V1-QC-01 com MP4 e aprovação exatos, sem repetir aprovações já válidas.
3. Reconciliar V1-FINANCE-01 com custos reais, indisponibilidades e ambos os
   limites antes de qualquer execução paga.
4. Homologar MVP-04 em D1/D2 e a distribuição por destino, com grants
   específicos, recibos, recuperação de `UNKNOWN` e operações independentes.
5. Obter amostra Shopee autorizada para COMMERCIAL-002; só então validar
   resultados e rentabilidade reais.
6. Inspecionar o repositório React separado antes de alterar FE01 de
   `UNVERIFIED`. Não priorizar cloud, SaaS ou Ads Manager para fechar o V1.

Não há nesta baseline confirmação de homologação operacional completa da
Frente A, B ou C. O próximo gate é revisão humana destas correções, decisão
expressa sobre o conflito de voz e comprovação dos aceites integrais restantes.
O merge pertence exclusivamente ao usuário e não libera LIVE automaticamente.
