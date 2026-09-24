# Content Automation Engine — Fundação do MVP

**Status:** proposta para validação
**Fase atual:** planejamento; nenhuma implementação autorizada
**Fonte conceitual:** transcrição `snapinsta-1790258748879.txt`, fornecida pelo usuário
**Última atualização:** 2026-09-24

## 1. Resumo executivo

A fonte descreve uma operação em que alguém coleta vídeos virais de uma página estrangeira, aplica um template, gera 25 publicações, agenda tudo no Instagram e, após ganhar alcance, promove produtos da Shopee como afiliado.

O produto proposto preserva o valor operacional — **produzir, revisar e distribuir conteúdo em lote** — sem depender de cópia não autorizada nem de promessas de renda. O sistema transforma mídia própria, licenciada ou expressamente autorizada em pacotes de conteúdo localizados para um projeto editorial. Cada pacote passa por revisão humana antes de exportação ou publicação. Métricas futuras fecham o ciclo de aprendizado.

O MVP deve responder a uma pergunta central:

> Um operador consegue transformar insumos autorizados em conteúdos publicáveis, consistentes e rastreáveis, com muito menos trabalho manual e sem perder controle editorial?

Não tentaremos provar, no mesmo ciclo, descoberta automática de tendências, crescimento de audiência, geração completa de vídeo, atribuição de vendas e otimização autônoma.

## 2. Visão e princípios

### Visão

Ser o espaço de trabalho que converte oportunidades de conteúdo em uma operação editorial repetível: **entrada autorizada → análise → variações → revisão → distribuição → medição**.

### Usuário inicial

Um criador ou pequeno operador de conteúdo que administra uma página em português, recebe de 5 a 25 vídeos por lote e hoje prepara manualmente título, legenda, CTA, hashtags e calendário.

### Promessa do MVP

Para um lote válido, gerar rascunhos estruturados e revisáveis em minutos, preservar a origem e os direitos de cada ativo e entregar um pacote pronto para publicação manual ou para um piloto controlado via API oficial.

### Princípios

- Autorização e rastreabilidade antes de automação.
- Humano no circuito antes de qualquer efeito externo.
- APIs oficiais e aderência aos termos das plataformas.
- IA para sugestão; código determinístico para regras e efeitos.
- Monólito modular antes de microserviços.
- Medir o fluxo antes de criar um motor de aprendizado.
- Promessas de produtividade verificáveis; nenhuma promessa de viralização ou renda.

## 3. Hipóteses a validar

| ID | Hipótese | Evidência necessária | Decisão se falsa |
|---|---|---|---|
| H1 | O usuário aceita fornecer apenas mídia própria/licenciada e declarar os direitos. | 5 entrevistas e 3 lotes reais autorizados. | Reposicionar para conteúdo criado pelo próprio usuário ou bibliotecas licenciadas. |
| H2 | Metadados gerados por IA economizam pelo menos 50% do tempo de preparação. | Comparação cronometrada manual versus assistida. | Reduzir geração e focar templates/workflow. |
| H3 | Pelo menos 70% dos rascunhos ficam utilizáveis com edição leve. | Avaliação humana em 30 itens; rubric definida previamente. | Melhorar contexto, prompts e validação antes de integrar publicação. |
| H4 | Exportação resolve a primeira validação sem publicação automática. | Usuários concluem o fluxo e publicam os pacotes exportados. | Priorizar integração oficial de publicação. |
| H5 | A API oficial do Instagram atende conta, formato, permissões, revisão e limites do piloto. | Spike com documentação atual e conta de teste. | Manter exportação/manual como limite do MVP. |
| H6 | Há uma forma oficial e contratualmente permitida de consultar produtos/links da Shopee no mercado-alvo. | Confirmação documental/comercial. | Afiliados continuam fora do MVP ou usam cadastro manual posterior. |

## 4. Escopo do MVP

### Incluído

1. Criar um projeto editorial com nicho, público, idioma, tom, palavras proibidas e CTA padrão.
2. Enviar um lote pequeno de vídeos e metadados suportados, com declaração de origem, licença/autorização e validade de uso.
3. Validar arquivo, tamanho, formato, duplicidade básica e presença dos campos de direitos.
4. Extrair metadados técnicos e, se necessário, uma transcrição do áudio por serviço aprovado.
5. Gerar um rascunho estruturado por item: assunto, hook, título, legenda, hashtags, CTA e alertas.
6. Aplicar template editorial simples aos metadados; edição/renderização avançada de vídeo não faz parte do primeiro corte.
7. Exibir fila de revisão com estados, comparação com a fonte, edição e aprovação/rejeição.
8. Gerar pacote exportável (manifesto e arquivos/metadados) pronto para operação manual.
9. Registrar eventos mínimos de auditoria, erros, tempos do funil, uso/custo de IA e resultado de exportação.

### Corte vertical proposto

Um único operador, um único idioma de saída (`pt-BR`), um projeto por vez,
metadados editoriais para Instagram, exportação manual, lotes limitados e um
conjunto pequeno de formatos documentados. O limite exato de lote e arquivo será
decidido em R01/R02 após medir o fluxo, custo e latência.

### Fora do MVP (explícito)

- Scraping, download ou repostagem automática de páginas de terceiros.
- Descoberta autônoma de tendências e ranking de viralidade.
- Geração integral de vídeo por IA, clonagem de voz ou avatares.
- Editor de vídeo completo, biblioteca de templates complexos e renderização em escala.
- TikTok, YouTube, Facebook, X ou publicação multicanal.
- Publicação automática no Instagram e analytics de publicação.
- Stories automáticos e inserção automática de links de afiliados.
- Catálogo, matching, comissão, atribuição ou payout da Shopee.
- Aprendizado autônomo, experimentos A/B automáticos e recomendação de horário.
- Equipes, organizações, cobrança, marketplace de templates e aplicativo móvel.
- Promessas ou otimização direta de receita/viralização.

Qualquer item acima exige um novo tópico aprovado, validação jurídica/plataforma e critérios próprios.

## 5. Critérios de sucesso e guardrails

### Métricas de resultado do piloto

- 3 operadores concluem ao menos 2 lotes cada sem assistência do time.
- Tempo mediano entre upload válido e lote revisável é menor que 10 minutos para 10 itens, excluindo indisponibilidade externa.
- Redução mediana de pelo menos 50% no tempo ativo de preparação contra baseline manual.
- Pelo menos 70% dos rascunhos são aprovados após no máximo edição leve, segundo rubric acordada.
- Pelo menos 95% dos itens mantém origem, declaração de direitos e histórico de revisão rastreáveis.
- 100% dos efeitos externos são precedidos por aprovação humana registrável.

### Guardrails operacionais

- Zero publicação de item rejeitado, sem autorização de direitos ou fora do estado permitido.
- Zero segredo em repositório/log e zero token de integração armazenado em texto puro.
- Custos e falhas por provedor visíveis por lote.
- Conteúdo sinalizado por política não pode avançar sem resolução humana.

Sucesso do MVP valida eficiência e controle do workflow, não crescimento, viralidade ou renda.

## 6. Workflow e estados

```text
Projeto editorial
      ↓
Upload + origem + direitos
      ↓
Validação determinística ── falha → correção/rejeição
      ↓
Processamento síncrono no primeiro corte
  metadados → transcrição → geração estruturada → checagens
      ↓
Rascunho revisável
      ↓
edição humana → aprovação explícita
      ↓
exportação manual
      ↓
auditoria + métricas operacionais
```

Estados mínimos do item:

`RECEIVED → VALIDATING → PROCESSING → NEEDS_REVIEW → APPROVED → EXPORTING → COMPLETED`

Saídas laterais: `VALIDATION_FAILED`, `PROCESSING_FAILED`, `REJECTED` e
`EXPORT_FAILED`, com tentativa controlada quando segura. Transições são
determinísticas, autorizadas, idempotentes e auditadas. Editar um item aprovado
cria nova versão e invalida a aprovação anterior.

## 7. Módulos do produto

| Módulo | Responsabilidade no MVP | Limite importante |
|---|---|---|
| Identidade e acesso | Sessão, proprietário e autorização básica. | Sem organizações ou RBAC complexo. |
| Projetos editoriais | Briefing, idioma, tom, regras e defaults. | Um fluxo editorial simples. |
| Ingestão e direitos | Upload, validação, hash, origem, licença e expiração. | Recusa item sem declaração obrigatória. |
| Fluxo de processamento | Estados, falhas e progresso do processamento síncrono inicial. | Fila/jobs somente se medições provarem necessidade. |
| Content Intelligence | Transcrição e sugestões estruturadas. | Saída não é fato nem autorização. |
| Policy Engine | Regras de schema, proibições, alertas e bloqueios. | Não depende apenas de moderação por IA. |
| Review Workspace | Visualização, edição, versionamento, aprovação e rejeição. | Aprovação individual ou em lote com confirmação. |
| Exportação | Pacote exportável para publicação manual. | Sem publisher no MVP. |
| Auditoria e observabilidade | Eventos, métricas, erros, custo e correlação. | Sem armazenar prompts/conteúdo sensível por padrão. |

## 8. Arquitetura adiada por gate

V00 removeu arquitetura, stack, fila, publisher e entidades físicas como decisões
antecipadas. R01–R03 validam o fluxo com processo e ferramentas existentes. R04
só define contrato de domínio, ameaças e arquitetura mínima se o gate G1 comprovar
valor; R05 só cria fundação técnica após o gate G3.

Continuam válidos como restrições, não como escolha de tecnologia:

- versões, direitos, aprovação e exportação precisam ser determinísticos e
  auditáveis;
- mídia deve permanecer privada e segredos não podem entrar em logs/repositório;
- saída de IA deve obedecer schema versionado e revisão humana;
- adaptadores devem evitar acoplamento desnecessário a provedores;
- processamento começa síncrono e fila/jobs dependem de evidência de latência,
  volume ou falha.

## 9. Integrações e APIs a validar

Não assumir disponibilidade com base em material promocional. Cada integração precisa de documentação oficial atual, conta de teste e registro de limites.

### Instagram / Meta

Validar antes de implementar:

- tipos de conta suportados e vínculo necessário;
- fluxo OAuth, permissões, revisão do app e modo de desenvolvimento;
- formatos de Reels aceitos, hospedagem temporária do arquivo e etapas de criação/publicação;
- agendamento nativo versus agendamento pelo nosso worker;
- limites, expiração de token, webhooks, insights disponíveis e retenção;
- exigências de exclusão de dados, branding e termos de automação.

**Gate:** sem spike aprovado, o MVP termina em exportação manual.

### Shopee Affiliate

Validar disponibilidade oficial no Brasil, elegibilidade, autenticação, catálogo, geração de deep links, regras de divulgação, atribuição, limites e permissão para automação.

**Gate:** nenhuma integração Shopee entra no MVP. O resultado do spike apenas informa roadmap.

### IA, transcrição e moderação

Comparar provedores por qualidade em `pt-BR`, structured output, política de retenção/treinamento, região, latência, limites, custo, moderação e tratamento de falhas. Criar dataset autorizado de avaliação antes de escolher.

### Infraestrutura

Validar armazenamento privado, fila/jobs, banco, criptografia/KMS, antivírus ou varredura de arquivo, limites de upload e observabilidade. Priorizar o menor conjunto operacional que satisfaça os guardrails.

## 10. IA versus responsabilidades determinísticas

### IA pode

- transcrever áudio;
- classificar assunto e extrair estrutura editorial;
- sugerir hook, título, legenda, hashtags e CTA;
- traduzir/localizar com contexto;
- apontar riscos e duplicidade semântica como sinal auxiliar.

### Código determinístico deve

- validar formato, tamanho, hash, campos obrigatórios e schema;
- aplicar regras de direitos, expiração, aprovação e transição de estado;
- controlar permissões, rate limit, retries e idempotência;
- impedir publicação sem aprovação válida;
- versionar conteúdo e preservar a trilha de auditoria;
- calcular métricas e custo a partir de eventos conhecidos;
- executar exportação/publicação apenas por comando autorizado.

### Controles de IA

- Prompts e schemas versionados; modelo/versão/latência/custo registrados.
- Conteúdo enviado pelo usuário é dado não confiável, nunca instrução de sistema.
- Saída passa por parsing, limites de tamanho, regras proibidas e revisão humana.
- Não apresentar alegações factuais geradas como verificadas.
- Dataset de avaliação sem dados de terceiros não autorizados.
- Fallback explícito para timeout, recusa, saída inválida e indisponibilidade.

## 11. Direitos autorais, plataforma e segurança editorial

1. Exigir origem (`próprio`, `licenciado`, `autorizado`) e prova/referência de autorização quando aplicável.
2. Registrar titular, escopo, territórios, plataformas, expiração e observações; bloquear uso vencido ou incompatível.
3. Proibir no produto rotas de download/scraping de terceiros sem base contratual e técnica aprovada.
4. Exibir atribuição quando a licença exigir; preservar fonte e hash do original.
5. Oferecer remoção e bloqueio de republicação por hash em caso de disputa/takedown.
6. Exigir revisão de marcas, música, imagem de pessoas, alegações comerciais e disclosure publicitário.
7. Identificar conteúdo sintético quando lei ou plataforma exigir.
8. Usar apenas APIs oficiais e respeitar rate limits, termos e restrições de automação.

Uma declaração do usuário reduz ambiguidade operacional, mas não substitui revisão jurídica. Antes de produção pública ou afiliados, termos de uso, política de privacidade, política de takedown e regras locais de publicidade precisam de revisão profissional.

## 12. Segurança e privacidade

- Modelo de ameaça antes da primeira integração externa.
- Menor privilégio em contas, tokens e service accounts; segredos em cofre e criptografia em trânsito/repouso.
- Tokens OAuth separados por ambiente, rotacionáveis e revogáveis.
- Upload por URL temporária, allowlist de formatos, limites de tamanho, inspeção de MIME e varredura de malware.
- Isolamento por proprietário em toda consulta; testes contra IDOR e acesso cruzado.
- Proteção CSRF/SSRF, validação de URL e nenhum fetch arbitrário fornecido pelo usuário.
- Logs sem tokens, URLs assinadas, PII desnecessária ou conteúdo integral.
- Retenção configurada para mídia, transcrições, logs e backups; exclusão verificável.
- Auditoria append-only para upload, direitos, edição, aprovação, exportação, publicação e revogação.
- Runbook para token comprometido, publicação indevida, vazamento e takedown.

## 13. Dados e observabilidade

### Eventos mínimos

`asset_received`, `asset_validated`, `generation_started/completed/failed`,
`review_edited`, `review_approved/rejected`, `export_completed/failed` e
`rights_revoked`.

Cada evento leva `correlation_id`, ator, projeto, item, versão, timestamp e resultado; nunca segredo. Eventos de produto e auditoria podem compartilhar origem, mas têm políticas de acesso e retenção distintas.

### Métricas

- conversão e tempo por etapa do funil;
- taxa de falha/tentativa por etapa e provedor;
- aceitação sem edição, edição leve, rejeição e motivo;
- latência e custo de IA por item/lote;
- taxa de exportação bem-sucedida;
- violações bloqueadas pelos guardrails.

### Alertas e SLO piloto

No piloto, registrar crescimento de falhas externas, exportação inconsistente e
aumento anormal de custo. Alertas, dashboards e SLO só entram após baseline e
volume que os justifiquem.

## 14. Estratégia de testes e TDD

### Pirâmide prática

- **Unidade/TDD:** estados, permissões, direitos, expiração, idempotência, custo e regras editoriais.
- **Contrato:** schemas de IA, armazenamento, transcrição e Meta; fixtures sanitizadas e fakes locais.
- **Integração:** banco, fila, objeto, outbox e worker em ambiente efêmero.
- **E2E:** upload autorizado → geração fake → revisão → exportação; publicação só em conta sandbox/teste.
- **Segurança:** isolamento entre usuários, upload malicioso, URLs, segredos em logs e autorização de efeitos.
- **Avaliação de IA:** conjunto versionado, rubric humana, regressão de qualidade, segurança e custo.

### Regras

- Escrever primeiro o teste para regras de domínio e bugs reproduzíveis.
- Testes reais contra provedores são opt-in, nunca requisito da suíte local rápida.
- Não usar snapshots opacos para aprovar conteúdo de IA; validar schema e propriedades, e avaliar qualidade separadamente.
- Relógio, IDs e provedores devem ser controláveis nos testes.
- Critérios de aceite viram cenários demonstráveis; cobertura percentual sozinha não define qualidade.

## 15. Riscos e mitigação

| Risco | Impacto | Mitigação/Gate |
|---|---|---|
| Violação de copyright, música ou imagem | Crítico | Ingestão autorizada, prova, bloqueio por expiração, takedown e revisão. |
| Suspensão por termos da plataforma | Alto | API oficial, spike documental, conta de teste, rate limit e kill switch. |
| Publicação errada/duplicada | Alto | Aprovação versionada, idempotência, outbox, confirmação e auditoria. |
| Conteúdo inadequado ou alucinado | Alto | Schema, policy engine, revisão humana e avaliação de IA. |
| Vazamento de mídia/tokens | Crítico | Storage privado, URLs temporárias, cofre, menor privilégio e logs sanitizados. |
| Custo/latência de IA inviável | Médio/alto | Limites por lote, orçamento, cache seguro, métricas e comparação de provedores. |
| Dependência de provedor/API | Alto | Adaptadores, exportação como fallback e decisões por evidência. |
| Produto não economiza tempo | Alto | Baseline manual, piloto cedo e gate antes de publicação/analytics. |
| Expectativa de renda/viralidade | Médio/alto | Posicionamento explícito, métricas operacionais e nenhuma alegação garantida. |
| Shopee sem API adequada | Médio | Manter afiliados fora do MVP; validar comercialmente antes do roadmap. |

## 16. Roadmap pós-MVP

Cada fase depende de dados da anterior e nova revisão de políticas:

1. **Publicação confiável:** mais contas, calendário, webhooks, reconciliação e analytics oficiais.
2. **Produção ampliada:** templates visuais licenciados, legendas no vídeo e renderização controlada.
3. **Inteligência de desempenho:** métricas normalizadas, cohorts, sugestões explicáveis e testes A/B aprovados.
4. **Descoberta autorizada:** fontes oficiais/licenciadas, sinais de tendência e fila de oportunidades.
5. **Afiliados:** catálogo oficial, disclosure, matching como sugestão, atribuição e aprovação humana.
6. **Multicanal e equipes:** novos adaptadores, papéis, aprovação em equipe e billing.

O sistema nunca deve evoluir para automação irrestrita de cópia ou publicação sem responsabilização.

## 17. Roadmap mínimo aprovado no V00

V00 consolidou T00–T18 em sete entregas. A matriz completa de decisões, gates e
riscos residuais está em `docs/TOPIC_ROADMAP.md`.

| ID | Entrega | Depende de | Resultado mínimo |
|---|---|---|---|
| R01 | Descoberta, direitos e baseline | V00 | Operadores/lotes acessíveis; fluxo e baseline medidos; lote, rubric, direitos e dados permitidos definidos. |
| R02 | Experimento concierge de geração | R01 | Amostra autorizada compara qualidade, tempo, custo, retenção e falhas de soluções existentes. |
| R03 | Revisão e exportação manual | R02 | Processo completo executado sem aplicação; formato de exportação usado pelo operador. |
| R04 | Contrato determinístico e riscos | gate G1 | Domínio, estados, regras, ameaças e retenção derivados do fluxo comprovado. |
| R05 | Fundação e entrada autorizada | R04 | Base técnica e primeira capacidade determinística testada. |
| R06 | Corte geração–revisão–exportação | R05 | Fluxo implementado com aprovação da versão exata e exportação segura. |
| R07 | Piloto instrumentado e decisão | R06 | 3 operadores × 2 lotes; decisão `go`, `iterate` ou `stop` baseada no baseline. |

Somente R01 está pronto para análise. T08 e T16–T18 permanecem adiados; fila,
publicação, analytics e afiliados exigem evidência e novos gates.

## 18. Definition of Ready e Done

### Ready

- Problema, resultado, fora de escopo e critérios de aceite estão claros.
- Dependências concluídas e decisão bloqueadora registrada.
- Riscos de direitos, segurança e efeitos externos avaliados.
- Plano de teste e observabilidade proporcional definido.

### Done

- Critérios demonstrados e testes relevantes passando.
- Mudança pequena, revisada e sem escopo incidental.
- Documentação/ADR atualizados; segredos e dados sensíveis ausentes.
- Métricas/logs necessários presentes e sanitizados.
- Riscos residuais e próximo tópico desbloqueado registrados.

## 19. Decisões do V00 e pendências de R01

Decisões aprovadas:

1. O primeiro piloto termina em exportação manual.
2. O MVP gera metadados; composição visual e edição de vídeo ficam fora.
3. O processo começa concierge/manual e síncrono.
4. Meta, publicação, analytics e Shopee não são dependências do MVP.
5. Nenhuma implementação começa antes dos gates de matéria-prima, valor e
   construção.

R01 deve produzir evidência para as pendências restantes:

1. operador real e baseline do fluxo atual;
2. formatos, duração, tamanho e quantidade do lote inicial;
3. definição mensurável de “edição leve”;
4. prova de direitos, retenção, categorias proibidas e responsável jurídico;
5. orçamento e prazo aceitáveis por lote;
6. dados que podem ser enviados a provedores, região e retenção.

Até R01 concluir essas respostas, a ação correta é descoberta e decisão — não
implementação.
