# MKTauto — regras do projeto

## Comunicação e escopo

- Responder em português, com objetividade e economia de tokens.
- Trabalhar em um tópico por conversa e por branch.
- Todo tópico concluído exige commit, push e PR aberto; o próximo tópico só
  começa após o merge.
- Antes de alterar arquivos, declarar tópico, entrega, fora de escopo e aceite.
- Sem dúvida bloqueante, executar o escopo aprovado sem pedir confirmações repetidas.
- Não repetir prompts, análises ou pacotes já aprovados.

## Fluxo obrigatório

1. Ler somente os trechos necessários de `docs/TOPIC_ROADMAP.md`,
   `docs/PROJECT_WORKFLOW.md` e `docs/CONTENT_AUTOMATION_MVP_PROJECT.md`.
2. Verificar Git e preservar mudanças locais do usuário.
3. Selecionar exatamente uma persona principal.
4. Consolidar o pacote de trabalho e obter aprovação antes de implementar.
5. Alterar somente o necessário; usar TDD para domínio, estados, permissões,
   idempotência e contratos.
6. Executar testes focados, revisar o diff e atualizar o roadmap com evidência.
7. Com remoto disponível, concluir cada tópico com commit, push e PR.
8. Após a confirmação do merge, exibir na resposta o prompt completo do próximo
   tópico sem iniciá-lo. Se nenhum tópico estiver desbloqueado, exibir o prompt
   de retomada do tópico bloqueado com sua condição de desbloqueio.

Somente o commit-base do bootstrap, necessário para criar a branch principal, é
exceção à exigência de PR.

## Economia com qualidade

- Reutilizar decisões; reler apenas o indispensável com `rg` e recortes.
- Agrupar buscas, alterações e testes relacionados.
- Normalmente limitar cada saída de ferramenta a 8–10 mil tokens.
- Fazer no máximo uma validação intermediária e uma final, salvo falha real.
- Até 35 chamadas de ferramenta é referência. Ao projetar ou atingir 45,
  concluir a etapa segura e dividir o tópico antes de ampliar.
- Limites de gasto nunca autorizam omitir testes, segurança, direitos ou aceite.

## Agentes

- Subagentes somente quando o pacote aprovado autorizar paralelismo e as
  subtarefas forem independentes, limitadas e sem edição conflitante.
- Cada subagente recebe objetivo, arquivos permitidos e saída esperada.
- O agente principal lê as regras, integra, verifica e responde pelo resultado.
- Não duplicar investigações nem criar outra tarefa Codex para subtrabalho.

## Proteções do produto

- Usar apenas mídia própria, licenciada ou autorizada; sem scraping/repostagem irregular.
- Toda publicação do MVP exige aprovação humana da versão exata.
- IA sugere conteúdo; regras, direitos, estados e efeitos externos são determinísticos.
- Usar APIs oficiais e manter exportação manual como fallback.
- Nunca commitar segredos, tokens, mídia privada, transcrições, logs ou runtime.
- Não limpar, sobrescrever ou incluir mudanças locais do usuário sem autorização.

Um tópico só termina com aceite demonstrado, testes pertinentes passando, diff
restrito, documentação coerente, riscos residuais registrados e PR aberto.

## Entrega funcional e continuidade

Estas regras complementam todas as regras anteriores e orientam a entrega em andamento:

1. **Entrega primeiro:** priorizar funcionalidades completas e utilizáveis, com integração entre os componentes necessários.
2. **MVP end-to-end:** declarar DONE somente com o fluxo integrado funcionando e evidências verificáveis. Distinguir validação offline de execução real e identificar os artefatos produzidos.
3. **Sem fragmentação:** corrigir defeitos internos comprovados encontrados durante a entrega no mesmo escopo e PR, sem criar microtarefas ou PRs separados para cada erro.
4. **Economia de tokens:** reutilizar decisões e diagnósticos; evitar investigações repetidas, prompts excessivos e testes redundantes, sem omitir validações necessárias.
5. **Autonomia técnica:** resolver decisões de implementação pela arquitetura existente; não transferir ao usuário identificadores internos, decisões técnicas seguras ou procedimentos manuais que pertençam ao produto.
6. **Qualidade:** preservar TDD proporcional ao risco, contratos, regressões relevantes, dados operacionais, auditoria, retomada e idempotência.
7. **Segurança financeira:** nenhuma chamada paga ou publicação real sem autorização explícita e, para gastos, orçamento. Preservar Finance, QC, direitos comerciais e todos os gates existentes.
8. **Transparência:** não declarar DONE sem comprovar funcionamento; informar apenas bloqueios reais e comprovados, com evidência mínima, sem fabricar resultados ou aprovações.
9. **Continuidade:** concluir a entrega em andamento antes de propor melhorias ou demandas futuras. Falhas internas necessárias ao aceite pertencem à entrega atual.
10. **Fluxo de trabalho:** ChatGPT atua como Planner/Revisor e Codex como Executor. Usar um PR por entrega funcional, incluindo correções e regras pertinentes, sem merge automático.
