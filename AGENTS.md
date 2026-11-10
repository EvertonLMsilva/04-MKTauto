# MKTauto --- AGENTS

## Regra central

Use o **ChatGPT para pensar e especificar** e o **Codex para executar
mudanças no repositório**.

O Codex não deve redescobrir decisões já registradas na task.

## Leitura mínima obrigatória

Para uma implementação:

1.  leia este `AGENTS.md`;
2.  leia **somente a task indicada**;
3.  leia **somente os arquivos permitidos/necessários pela task**;
4.  use `rg`/busca pontual apenas quando faltar um símbolo ou
    dependência necessária.

Não leia o roadmap completo, histórico, documentação de produto ou
outros módulos por padrão. Só amplie a leitura quando a task estiver
incorreta/incompleta e isso bloquear a execução.

## Execução

-   Um tópico funcional de tamanho útil por vez; agrupe subtarefas relacionadas
    sem criar microtarefas ou entregas independentes no mesmo tópico.
-   Reaproveite módulos e preserve Ports & Adapters e contratos existentes.
-   Preserve mudanças locais do usuário.
-   Não faça refatoração lateral.
-   Não altere contratos fora do escopo.
-   Não masque erros nem enfraqueça validações para fazer teste passar.
-   TDD proporcional ao risco: obrigatório para domínio, estados, permissões,
    idempotência e contratos; documentação exige somente validação documental.
-   APIs pagas e pipelines LIVE exigem autorização explícita; execução paga
    também exige orçamento. Use fixtures/mocks nos testes comuns.
-   Registre custos de execução conhecidos e explicite valores indisponíveis;
    ausência de custo não significa zero.
-   Diagnostique falhas antes de corrigir; não repita tentativa bloqueada
    sem evidência nova.
-   Integrações externas devem ser fake/mock nos testes automáticos,
    salvo smoke test explicitamente autorizado.
-   Execute primeiro testes focados. Suíte maior somente quando a task
    ou o risco exigir.
-   Revise apenas o diff da task.
-   Sem dúvida bloqueante, execute sem pedir confirmações repetidas.
-   Com dúvida bloqueante, pare e retorne: `BLOCKED`, causa, evidência
    mínima e pergunta única.

## Economia extrema de contexto

-   Não repetir análise, prompt, arquitetura ou evidência já presentes
    na task.
-   Não produzir explicações longas durante implementação.
-   Não investigar módulos não relacionados "por garantia".
-   Não gerar documentação adicional que a task não peça.
-   Não preparar o próximo tópico.
-   Não criar subagentes por padrão.
-   Não fazer múltiplas validações equivalentes.
-   Preferir alteração pequena + teste focado + diff focado.
-   Se a task exigir exploração ampla, pare: ela deve voltar ao ChatGPT
    para ser refinada.

## Estratégia vigente

Affiliate-First: cadastro manual de produtos e imagens reais autorizadas;
roteiros pela IA existente; fal.ai para cenas, música e narração somente
quando o modelo suportar; FFmpeg para composição e correções locais;
aprovação humana da versão exata e publicação manual inicial.
Registrar custos e resultados comerciais. SaaS e automação avançada
aguardam validação comercial. O Planner especifica cada implementação.

## Diretório canônico permanente

Toda implementação deve ocorrer exclusivamente em
`D:\04-Projetos\23-MKTauto`. Não criar novos Git worktrees nem cópias do
projeto para desenvolvimento. Preserve alterações locais e use branches
no checkout original, após verificar a segurança da troca de branch.

## Git

Um tópico pai corresponde a uma branch/PR quando o fechamento for autorizado;
subtarefas relacionadas usam commits úteis na mesma branch.

Commit, push e PR só quando a task explicitamente solicitar ou quando o
fluxo do projeto já estiver executando a etapa de fechamento. Nunca
limpar, sobrescrever ou incluir mudanças locais alheias à task.

## Proteções invariantes

-   Somente mídia própria, licenciada ou autorizada.
-   Sem scraping/repostagem irregular.
-   Aprovação humana da versão exata antes de publicação no MVP.
-   APIs oficiais quando houver efeito externo.
-   Segredos, tokens, mídia privada, transcrições, logs e runtime fora
    do Git.
-   IA pode sugerir; regras, direitos, estados e efeitos externos
    permanecem determinísticos.

## Saída padrão do Codex

``` text
STATUS: DONE | BLOCKED | FAILED
ALTERADO:
- <arquivos>

TESTES:
- <comando>: PASS | FAIL

OBSERVAÇÃO:
- <somente risco, bloqueio ou decisão indispensável>
```

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
