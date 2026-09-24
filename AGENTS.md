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
8. Após merge, gerar o prompt do próximo tópico sem iniciá-lo.

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
