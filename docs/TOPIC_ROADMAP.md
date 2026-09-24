# Roadmap de tópicos

## Estado atual

| ID | Estado | Entrega | Evidência/aceite |
|---|---|---|---|
| B00 | CONCLUÍDO | Governança e cadastro local | Projeto reconhecido no Codex; documentos-base presentes. |
| V00 | CONCLUÍDO | Viabilidade, reuso e ordem do MVP | T00–T18 avaliados; escopo, consolidações, gates e roadmap R01–R07 aprovados em 24/09/2026. |
| R01 | BLOQUEADO — STOP/REPOSICIONAR | Descoberta, direitos e baseline | G0 não satisfeito: sem evidência de operadores, lotes autorizados ou responsável jurídico; protocolo e condições de retomada em `docs/R01_DISCOVERY_BASELINE.md`. |

R01 registrou a rota de parada em 24/09/2026. R02 e todos os tópicos de
implementação permanecem não autorizados até a condição de retomada de R01 e G0
serem satisfeitos.

## Corte aprovado do MVP

Validar se um pequeno operador consegue transformar mídia autorizada em
metadados editoriais revisados e em um pacote para publicação manual com pelo
menos 50% menos trabalho, preservando origem, direitos, versão e aprovação
humana.

Defaults aprovados:

- uma persona: criador ou pequeno operador de uma página em português;
- um operador, um projeto e `pt-BR` no primeiro corte;
- geração de metadados, sem composição ou edição de vídeo;
- exportação manual, sem publicação automática;
- processamento síncrono enquanto custo e latência permitirem;
- Shopee, analytics de publicação e descoberta fora do MVP;
- experimento concierge/manual antes de construir aplicação.

## Decisões sobre os candidatos T00–T18

| Candidato | Decisão | Destino e razão |
|---|---|---|
| T00 | manter | Base de R01: usuário, fluxo, lote, baseline e sucesso. |
| T01 | fundir | Direitos e compliance entram em R01 como gate, não como trilha separada. |
| T02 | fundir | IA entra em R02; Meta vira gate pós-piloto; Shopee vai ao pós-MVP. |
| T03 | fundir | Domínio e estados entram em R04 após a prova de valor. |
| T04 | fundir | Arquitetura e ameaças entram em R04, limitadas ao fluxo comprovado. |
| T05 | manter | R05 cria a fundação somente após o gate de construção. |
| T06 | fundir | Briefing mínimo entra na ingestão de R05; sem CRUD prematuro. |
| T07 | manter | R05 implementa entrada autorizada como primeira capacidade determinística. |
| T08 | adiar | Fila/jobs só entram se medições provarem necessidade. |
| T09 | fundir | Dataset, rubric e baseline entram em R01/R02. |
| T10 | manter | R02 prova o serviço; R06 integra somente após aprovação. |
| T11 | fundir | Regras determinísticas entram em R04/R06; revisão humana trata alertas. |
| T12 | manter | R03 valida o processo; R06 implementa apenas a fricção comprovada. |
| T13 | manter | Exportação é a saída do menor MVP em R03/R06. |
| T14 | fundir | Métricas mínimas entram em R07; sem plataforma de observabilidade antecipada. |
| T15 | manter | R07 executa o piloto e decide `go`, `iterate` ou `stop`. |
| T16 | adiar | Publicação Instagram depende de R07 e de novo spike oficial. |
| T17 | adiar | Insights dependem de publicação e de uma decisão útil previamente definida. |
| T18 | adiar | Afiliados dependem de R07, acesso oficial/contratual e novo gate jurídico. |

## Roadmap mínimo aprovado

| ID | Entrega mínima | Depende de | Aceite objetivo |
|---|---|---|---|
| R01 | Descoberta, direitos e baseline | V00 | Até 5 entrevistas; acesso a 3 lotes autorizados; fluxo observado e cronometrado; formato/lote provisório; “edição leve”, prova de direitos, dados permitidos e critérios de interrupção definidos. |
| R02 | Experimento concierge de geração | R01 | Amostra autorizada avaliada com rubric; qualidade, tempo, custo, retenção e falhas comparados; provedor recomendado ou decisão de não prosseguir. |
| R03 | Revisão e exportação manual | R02 | Fonte, versão, edição, aprovação e exportação simuladas com ferramenta existente; formato utilizado em publicação manual; gargalos registrados. |
| R04 | Contrato determinístico e riscos | gate G1 | Estados, invariantes, direitos, versionamento, autorização, regras, fluxo de dados, ameaças e retenção derivados do processo comprovado. |
| R05 | Fundação e entrada autorizada | R04 | Base técnica reproduzível; briefing mínimo; entrada suportada, manifesto de direitos, validações e auditoria essencial demonstrados por testes. |
| R06 | Corte geração–revisão–exportação | R05 | Provedor integrado; schema validado; revisão da versão exata; aprovação invalidada por edição; somente item aprovado exportado; E2E passando. |
| R07 | Piloto instrumentado e decisão | R06 | 3 operadores executam 2 lotes cada; tempo, qualidade, rastreabilidade, custo e falhas comparados ao baseline; decisão `go`, `iterate` ou `stop`. |

## Gates de decisão

| Gate | Condição para avançar |
|---|---|
| G0 — matéria-prima | Existem operadores acessíveis e pelo menos 3 lotes reais com autorização verificável. |
| G1 — valor | Geração assistida demonstra economia plausível e qualidade aceitável; caso contrário, iterar ou parar antes de construir. |
| G2 — operação | Revisão e exportação manual completam o fluxo; interface própria só trata fricção observada. |
| G3 — construção | O fluxo comprovado justifica software próprio e R04 está aprovado. |
| G4 — publicação | Somente após R07 mostrar que exportação manual é gargalo e um spike Meta for aprovado. |
| G5 — afiliados | Somente após R07, com acesso oficial/contratual, disclosure e revisão jurídica próprios. |

## Dependências e riscos residuais

- R01 está bloqueado por ausência demonstrada de operadores, mídia autorizada e
  responsável jurídico. Ver o [registro de análise](R01_DISCOVERY_BASELINE.md).
- Envio de mídia a provedores depende de decisão sobre dados, região e retenção.
- A declaração do usuário não substitui autorização compatível nem revisão
  profissional antes de produção pública.
- Meta é tecnicamente possível para contas profissionais, mas não integra o MVP.
- Não há evidência aprovada de API pública Shopee adequada ao produto; o fluxo
  manual/nativo é o único reuso aceito até novo gate.
- Fila, dashboards, publicação e analytics não são dependências do corte vertical.

## Evidências externas consultadas no V00

Consultadas em 24/09/2026; devem ser revalidadas no gate correspondente:

- [Instagram API with Instagram Login — coleção mantida pela Meta](https://www.postman.com/meta/instagram/folder/1z5vxzu/instagram-api-with-instagram-login): contas profissionais e permissão específica de publicação.
- [Termos do Programa de Afiliados Shopee](https://help.shopee.com.br/portal/10/article/124094-Programa-de-Afiliados-da-Shopee-Termos-e-Condi%C3%A7%C3%B5es) e [parceria Shopee–Instagram](https://help.shopee.com.br/portal/10/article/223917): confirmam fluxos oficiais manual/nativo, mas não provam API pública adequada ao produto.
- [OpenAI Audio API](https://platform.openai.com/docs/api-reference/audio) e [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs): comprovam opções prontas para transcrição e saída estruturada, sujeitas à avaliação em R02.
- [Lei 9.610/1998](https://www.planalto.gov.br/ccivil_03/leis/l9610.htm) e [LGPD](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm): fundamentam o gate de autorização, finalidade, retenção e segurança; a aplicação ao produto exige responsável jurídico.

## Regra de execução

Cada tópico começa em análise no Chat. Implementação só ocorre após dependências,
gate e pacote curto aprovados. A abordagem manual ou pronta deve ser testada
antes de construção própria.
