# Workflow econômico do MKTauto

## Princípio

Usar o **Chat para pensar** e o **Codex para executar** somente quando houver
uma mudança de repositório aprovada. O processo deve custar menos que o valor da
decisão ou entrega que produz.

## Modos de trabalho

Selecionar apenas um:

- **Análise:** problema, viabilidade, reuso, alternativas e decisão; sem código.
- **Implementação:** menor mudança aprovada, com testes proporcionais.
- **Validação:** evidência reproduzível; não corrigir no mesmo tópico.
- **Documentação:** atualizar decisões, operação ou release já comprovados.

Especialidades como IA, frontend, integrações, segurança e backend são critérios
da tarefa, não personas separadas. Isso evita burocracia e troca desnecessária de
contexto.

## Estados

`PENDENTE → EM ANÁLISE → APROVADO → EM EXECUÇÃO → CONCLUÍDO`.

Usar `BLOQUEADO` somente com impedimento explícito e condição de retomada.

## Fluxo mínimo

1. Definir um problema, resultado e fora de escopo.
2. No Chat, verificar necessidade, viabilidade, soluções existentes, APIs
   oficiais, custo, risco e menor corte útil.
3. Se não houver mudança no repositório, concluir no Chat.
4. Se houver implementação, aprovar um pacote curto antes de usar o Codex.
5. No Codex, verificar a base, executar apenas o pacote, testar e revisar o diff.
6. Registrar decisão, aceite, risco residual e próximo tópico desbloqueado.

## Pacote curto padrão

```markdown
# <ID — entrega>
- Resultado e valor:
- Evidências/decisões:
- Arquivos e mudanças:
- Fora de escopo/preservações:
- Testes e aceite:
- Dúvida bloqueante: Nenhuma | <pergunta>
```

Usar pacote ampliado somente para integração externa, migração, dados sensíveis,
direitos autorais, segurança ou múltiplos módulos. Nesses casos, acrescentar
base Git exata, riscos, rollback, custos e aprovação externa.

## Controles de custo

- Não repetir análise, pacote ou evidência já aprovada.
- Ler símbolos e recortes; carregar documento inteiro somente quando necessário.
- Agrupar buscas, edições e testes.
- Uma validação intermediária e uma final normalmente bastam.
- Dividir quando houver mais de uma entrega independente ou projeção acima de
  45 chamadas de ferramenta.
- Não coletar métricas detalhadas enquanto não houver volume que justifique.
- Testes, segurança, direitos e aceite nunca são reduzidos para economizar.

## Conclusão

Um tópico termina quando entrega valor observável, atende o aceite e registra
somente: resultado, verificações, riscos residuais e próximo passo. PR, métricas
ou documentação adicional só são exigidos quando realmente aplicáveis.
