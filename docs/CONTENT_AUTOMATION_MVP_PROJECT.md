# MKTauto — estúdio de cortes dinâmicos

**Status:** V01 repriorizado; implementação ainda não autorizada
**Fase atual:** planejamento; nenhuma implementação autorizada
**Fonte conceitual:** transcrição `snapinsta-1790258748879.txt`, fornecida pelo usuário
**Última atualização:** 2026-09-24

## 1. Resumo executivo

A operação-alvo administra perfis temáticos próprios: encontra vídeos relevantes
por nicho, cria uma abordagem editorial, produz cortes verticais dinâmicos,
publica no Instagram e aprende com desempenho, custo e receita.

O produto preserva o valor operacional — **descobrir, criar, revisar, publicar e
medir conteúdo em lote** — sem depender de scraping irregular nem de promessa de
renda. Cada versão renderizada passa por revisão humana antes de exportação ou
publicação. Instagram é o primeiro adaptador; outros canais e parceiros entram
depois do MVP por contratos pequenos e comprovados.

O MVP deve responder a uma pergunta central:

> Um operador consegue transformar fontes relevantes em cortes verticais
> dinâmicos, publicá-los com controle e identificar quais formatos merecem
> continuar, com muito menos trabalho manual?

Não tentaremos provar, no mesmo ciclo, crescimento garantido, atribuição completa
de vendas, otimização autônoma, múltiplas plataformas e múltiplos parceiros.

## 2. Visão e princípios

### Visão

Ser o espaço de trabalho que converte oportunidades de conteúdo em uma operação
editorial repetível: **descoberta → seleção → criação → corte → revisão →
publicação → medição**.

### Usuário inicial

Um operador individual que administra um portfólio de perfis temáticos em
português, seleciona vídeos por nicho e hoje combina manualmente roteiro,
trechos, narração, texto, legendas, renderização, publicação e métricas.

### Promessa do MVP

Para um lote válido, gerar variações verticais revisáveis — narradas, textuais,
legendadas ou multitrecho —, preservar a origem, publicar a versão aprovada no
Instagram e mostrar desempenho, custo, receita e lucro estimado.

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
| H1 | Busca assistida encontra fontes úteis por nicho sem depender de scraping irregular. | 3 lotes reais e comparação entre busca manual e fonte/API oficial. | Manter curadoria e importação manuais. |
| H2 | Assistência reduz pelo menos 50% do tempo ativo até um corte revisável. | Comparação cronometrada manual versus assistida. | Reduzir automação e focar templates/workflow. |
| H3 | Pelo menos 70% das variações ficam utilizáveis com edição leve. | Avaliação humana em 30 cortes; rubric definida previamente. | Melhorar contexto, seleção e templates antes de integrar publicação. |
| H4 | Narração, texto, legendas e multitrecho cobrem o primeiro portfólio. | Três lotes comparados por formato, nicho e retrabalho. | Cortar formatos sem valor ou criar tópico específico. |
| H5 | A API oficial do Instagram atende conexão, publicação, revisão e insights do piloto. | Spike atual e conta profissional de teste. | Preservar exportação e métricas manuais como fallback. |
| H6 | Custos, receita informada e insights permitem decisão por vídeo e perfil. | Painel usado no piloto para decidir continuar, iterar ou parar. | Simplificar métricas antes de adicionar parceiros. |

## 4. Escopo do MVP

### Incluído

1. Cadastrar vários perfis com nicho, público, idioma, tom e regras editoriais.
2. Buscar candidatos por tema em fontes permitidas e aceitar importação manual.
3. Manter URL/origem, condição de uso declarada e dados técnicos do arquivo.
4. Transcrever, sugerir trechos e permitir ajuste humano do intervalo.
5. Gerar abordagem, roteiro, título, legenda, hashtags, CTA e alertas.
6. Criar variações narradas, com texto, legendas ou múltiplos trechos.
7. Compor e renderizar vídeo vertical em templates pequenos e testados.
8. Revisar a versão exata, editar, aprovar/rejeitar e exportar.
9. Publicar a versão aprovada no Instagram por API oficial, com fallback manual.
10. Coletar insights e registrar custos, receita informada e lucro estimado.
11. Exibir painel mínimo por perfil, vídeo e formato.

### Corte vertical proposto

Um único operador, `pt-BR`, vários perfis cadastráveis e somente um perfil/lote
processado por vez. O fluxo cobre descoberta assistida, quatro famílias iniciais
de corte, publicação e insights no Instagram e painel mínimo. O limite exato de
lote, arquivo e templates será decidido em R01–R03 após medir o processo.

### Fora do MVP (explícito)

- Download/repostagem irregular, scraping e descoberta autônoma irrestrita.
- Geração integral de vídeo por IA, clonagem de voz ou avatares.
- Editor genérico, templates complexos e renderização em escala.
- TikTok, YouTube, Facebook, X ou publicação multicanal.
- Publicação sem revisão humana e postagem real antes do gate de lançamento.
- Stories automáticos e inserção automática de links de afiliados.
- Catálogo, matching, comissão, atribuição ou payout de parceiros.
- Aprendizado autônomo, experimentos A/B automáticos e recomendação de horário.
- Equipes, organizações, cobrança, marketplace de templates e aplicativo móvel.
- Promessas ou otimização direta de receita/viralização.

Qualquer item acima exige um novo tópico aprovado, validação jurídica/plataforma e critérios próprios.

## 5. Critérios de sucesso e guardrails

### Métricas de resultado do piloto

- O operador conclui 3 lotes representativos no fluxo completo.
- Tempo mediano entre seleção válida e corte revisável é pelo menos 50% menor que o baseline manual.
- Redução mediana de pelo menos 50% no tempo ativo de preparação contra baseline manual.
- Pelo menos 70% dos 30 cortes avaliados são aprovados após no máximo edição leve, segundo rubric acordada.
- Pelo menos 95% dos itens mantém origem, declaração de direitos e histórico de revisão rastreáveis.
- 100% dos efeitos externos são precedidos por aprovação humana registrável.
- Publicação e insights do Instagram funcionam em conta profissional de teste, com exportação manual como fallback.
- O painel permite comparar visualizações, interações, custo, receita informada e lucro estimado por perfil e formato.

### Guardrails operacionais

- Zero publicação de item rejeitado, sem autorização de direitos ou fora do estado permitido.
- Zero segredo em repositório/log e zero token de integração armazenado em texto puro.
- Custos e falhas por provedor visíveis por lote.
- Conteúdo sinalizado por política não pode avançar sem resolução humana.

Sucesso do MVP valida eficiência e controle do workflow, não crescimento, viralidade ou renda.

## 6. Workflow e estados

```text
Perfil temático
      ↓
busca por nicho → candidato + origem
      ↓
seleção + importação + validação ── falha → correção/rejeição
      ↓
Processamento síncrono no primeiro corte
  transcrição → trechos → roteiro → narração/texto → composição
      ↓
versão vertical renderizada
      ↓
edição humana → aprovação explícita
      ↓
exportação ou publicação no Instagram
      ↓
insights + custo + receita + painel
```

Estados mínimos do item:

`DISCOVERED → SELECTED → VALIDATING → PROCESSING → RENDERING → NEEDS_REVIEW → APPROVED → PUBLISHING → PUBLISHED`

Saídas laterais: `VALIDATION_FAILED`, `PROCESSING_FAILED`, `RENDER_FAILED`,
`REJECTED`, `EXPORT_FAILED` e `PUBLISH_FAILED`, com tentativa controlada quando segura. Transições são
determinísticas, autorizadas, idempotentes e auditadas. Editar um item aprovado
cria nova versão e invalida a aprovação anterior.

## 7. Módulos do produto

| Módulo | Responsabilidade no MVP | Limite importante |
|---|---|---|
| Identidade e acesso | Sessão, proprietário e autorização básica. | Sem organizações ou RBAC complexo. |
| Perfis editoriais | Nicho, público, idioma, tom, regras e defaults. | Vários perfis; um perfil/lote ativo por vez. |
| Descoberta de fontes | Busca por nicho, candidatos e origem. | APIs/fontes permitidas; sem scraping irregular. |
| Ingestão e origem | Importação, validação, hash e condição de uso declarada. | Mídia e evidências privadas fora do Git. |
| Fluxo de processamento | Estados, falhas e progresso do processamento síncrono inicial. | Fila/jobs somente se medições provarem necessidade. |
| Content Intelligence | Transcrição, trechos, roteiro, texto e metadados. | Saída não é fato nem autorização. |
| Composição e renderização | Narração, texto, legendas, multitrecho e saída vertical. | Templates pequenos; sem editor genérico. |
| Policy Engine | Regras de schema, proibições, alertas e bloqueios. | Não depende apenas de moderação por IA. |
| Review Workspace | Visualização, edição, versionamento, aprovação e rejeição. | Aprovação da versão renderizada exata. |
| Publicação | Exportação e adaptador oficial do Instagram. | Falha externa não elimina o fallback manual. |
| Insights e monetização | Métricas, custos, receita e lucro estimado. | Receita começa manual/CSV; sem promessa de retorno. |
| Painel | Comparação por perfil, vídeo e formato. | Metabase OSS ou painel nativo somente após spike. |
| Auditoria e observabilidade | Eventos, erros, custo e correlação. | Sem armazenar prompts/conteúdo sensível por padrão. |

## 8. Arquitetura adiada por gate

V01 mantém stack, fila e entidades físicas adiadas. R01–R03 validam o fluxo com
processo e ferramentas existentes. R04 define somente contratos exigidos pela
evidência; R05 cria a fundação técnica após G2.

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

**Gate:** R08 implementa o primeiro adaptador somente após G3; falha ou falta de
acesso preserva exportação manual e impede publicação real.

### Parceiros e monetização

Shopee é apenas um candidato. Cada parceiro futuro deve validar disponibilidade
oficial, elegibilidade, autenticação, catálogo, links, divulgação, atribuição,
limites e permissão para automação.

**Gate:** nenhuma integração de parceiro entra no MVP. Receita manual/CSV permite
validar o painel sem bloquear o fluxo principal.

### IA, transcrição e moderação

Comparar provedores por qualidade em `pt-BR`, structured output, política de retenção/treinamento, região, latência, limites, custo, moderação e tratamento de falhas. Criar dataset autorizado de avaliação antes de escolher.

### Infraestrutura

Validar armazenamento privado, fila/jobs, banco, criptografia/KMS, antivírus ou varredura de arquivo, limites de upload e observabilidade. Priorizar o menor conjunto operacional que satisfaça os guardrails.

## 10. IA versus responsabilidades determinísticas

### IA pode

- transcrever áudio;
- classificar assunto e sugerir trechos relevantes;
- sugerir roteiro, hook, título, legenda, hashtags e CTA;
- sugerir variação narrada, textual, legendada ou multitrecho;
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

`candidate_discovered/selected`, `asset_received/validated`,
`generation_started/completed/failed`, `render_completed/failed`,
`review_edited`, `review_approved/rejected`, `export_completed/failed`,
`publication_completed/failed`, `insights_synced/failed` e `rights_revoked`.

Cada evento leva `correlation_id`, ator, perfil, item, versão, timestamp e
resultado; nunca segredo. Eventos de produto e auditoria podem compartilhar
origem, mas têm políticas de acesso e retenção distintas.

### Métricas

- conversão e tempo por etapa do funil;
- taxa de falha/tentativa por etapa e provedor;
- aceitação sem edição, edição leve, rejeição e motivo;
- latência e custo de IA por item/lote;
- taxa de renderização, exportação, publicação e sincronização bem-sucedida;
- visualizações e interações por perfil, vídeo e formato;
- custo, receita informada e lucro estimado;
- violações bloqueadas pelos guardrails.

### Alertas e SLO piloto

No piloto, registrar crescimento de falhas externas, publicação inconsistente e
aumento anormal de custo. O painel mínimo entra em R09; alertas e SLO completos
só entram após volume que os justifique.

## 14. Estratégia de testes e TDD

### Pirâmide prática

- **Unidade/TDD:** estados, permissões, direitos, expiração, idempotência, custo e regras editoriais.
- **Contrato:** schemas de IA, armazenamento, transcrição e Meta; fixtures sanitizadas e fakes locais.
- **Integração:** banco, fila, objeto, outbox e worker em ambiente efêmero.
- **E2E:** candidato → importação → geração fake → renderização → revisão → exportação; publicação só em conta profissional de teste.
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
| Parceiro sem API adequada | Médio | Manter parceiros fora do MVP e validar cada adaptador separadamente. |

## 16. Roadmap pós-MVP

Cada fase depende de dados da anterior e nova revisão de políticas:

1. **Operação ampliada:** calendário, webhooks, reconciliação e mais contas.
2. **Produção ampliada:** novos templates, formatos e renderização em escala.
3. **Inteligência de desempenho:** cohorts, sugestões explicáveis e testes A/B aprovados.
4. **Descoberta ampliada:** mais fontes oficiais/licenciadas e sinais de tendência.
5. **Parceiros:** catálogos oficiais, disclosure, links, atribuição e aprovação humana.
6. **Multicanal e equipes:** novos adaptadores, papéis, aprovação em equipe e billing.

O sistema nunca deve evoluir para automação irrestrita de cópia ou publicação sem responsabilização.

## 17. Roadmap mínimo repriorizado no V01

V01 substituiu o recorte `metadados-only/export-only` por dez tópicos pequenos,
contados desde a própria repriorização. A matriz de gates e evidências está em
`docs/TOPIC_ROADMAP.md`.

| ID | Entrega | Depende de | Resultado mínimo |
|---|---|---|---|
| V01 | Repriorização | V00 | Visão, persona, fluxo, integração inicial e roadmap coerentes. |
| R01 | Fluxo e baseline | V01 | Um operador executa 3 lotes e mede tempo, custo e retrabalho. |
| R02 | Descoberta | R01 | Busca manual e fonte/API oficial comparadas por nicho. |
| R03 | Experimento criativo | R02 | Quatro famílias de corte avaliadas por rubric. |
| R04 | Contratos e adaptadores | R03/G1 | Domínio e contratos mínimos testáveis. |
| R05 | Fundação | R04/G2 | Aplicação reproduzível para vários perfis. |
| R06 | Descoberta e preparação | R05 | Busca, seleção, importação, transcrição e trechos funcionam. |
| R07 | Produção dinâmica | R06 | Roteiro, composição, revisão, renderização e exportação funcionam. |
| R08 | Instagram | R07/G3 | Publicação aprovada e insights oficiais funcionam com fallback. |
| R09 | Painel e piloto | R08 | Desempenho, custo, receita e lucro estimado suportam decisão final. |

R01 fica pronto para análise somente após o merge de V01. Um tópico pode ser
dividido quando isso reduzir risco ou antecipar valor, sem ampliar o MVP.

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

## 19. Decisões do V01 e pendências de R01

Decisões aprovadas:

1. O operador administra perfis próprios de diferentes nichos.
2. O MVP produz cortes dinâmicos e não somente metadados.
3. O processo começa concierge/manual e síncrono.
4. Instagram é o primeiro adaptador obrigatório, com exportação como fallback.
5. O painel combina insights, custos e receita manual/importada.
6. Outros canais e parceiros ficam pós-MVP e entram por adaptadores.
7. Nenhuma implementação começa antes dos gates de fluxo, valor e construção.

R01 deve produzir evidência para as pendências restantes:

1. baseline do operador interno em três lotes;
2. nichos e fontes representativos;
3. formatos, duração, tamanho e quantidade do lote inicial;
4. definição mensurável de edição leve e qualidade aceitável;
5. orçamento e prazo aceitáveis por lote;
6. origem e condição de uso registradas, sem mídia no Git.

Até R01 concluir essas respostas, a ação correta é descoberta e decisão — não
implementação.
