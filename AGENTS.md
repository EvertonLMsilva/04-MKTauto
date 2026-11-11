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

## Main e checkout canônicos

A `main` é a referência oficial do código integrado. O checkout canônico
fica em `D:\04-Projetos\23-MKTauto` e deve ser preservado.

Não desenvolver funcionalidades nem criar commits funcionais diretamente
na `main`. Cada tópico deve utilizar branch própria. Atualizar a `main`
por fast-forward somente quando for seguro, com checkout limpo e sem
interferir em trabalho ativo.

## Worktrees autorizados

Worktrees isolados são permitidos e recomendados para tarefas paralelas.
Criar novos worktrees somente quando necessário e autorizado pela task.
Não criar worktrees adicionais para testes ou análises simples sem
justificativa.

Cada worktree deve:

- Estar associado a um tópico-pai e utilizar branch própria.
- Partir da `main` atualizada e ocupar diretório exclusivo.
- Preservar o checkout original e suas alterações locais.
- Não reutilizar worktrees de outras frentes.
- Ser identificado no relatório da task, com diretório, branch e HEAD.

Local recomendado: `D:\04-Projetos\_worktrees\`.

## Frentes e isolamento

- **CORE:** arquitetura, migrações, organização e limpeza.
- **A:** Publishing e distribuição.
- **B:** Produção, Media, TTS, CTC e vídeos.
- **C:** Shopee, Affiliate e Commercial.

Cada frente possui seu próprio tópico-pai e subtópicos. CORE é uma frente
estrutural adicional e não substitui as três frentes funcionais.

É proibido:

- Duas frentes editarem simultaneamente o mesmo arquivo, inclusive em
  worktrees diferentes.
- Alterar worktrees de outras frentes.
- Usar bancos LIVE como fixtures.
- Alterar Docker operacional sem autorização explícita.
- Acessar ou modificar credenciais fora do escopo autorizado.

Em conflito de escopo, parar, registrar `BLOCKED_CROSS_SCOPE` com evidência
mínima e solicitar coordenação antes de prosseguir no escopo conflitante.

## Sincronização e preservação

Antes de cada tópico, confirmar `origin/main`, HEAD, branch, diretório do
worktree e status Git. Verificar alterações concorrentes relevantes antes
de trocar a branch ou reconciliar alterações.

Se houver outro processo modificando o checkout de trabalho, parar e
retornar `BLOCKED_CONCURRENT_WRITER`. Não sobrescrever trabalho concorrente.

Não utilizar `git reset --hard`, `git clean -fdx` ou force push para corrigir
divergências. Preservar commits e arquivos de trabalho não integrados.

## Encerramento de worktrees

Ao concluir um tópico:

- Confirmar integração ou arquivamento.
- Confirmar ausência de alterações pendentes.
- Confirmar preservação de commits exclusivos.
- Confirmar inexistência de processos consumidores.
- Registrar destino dos backups quando aplicável.

Não excluir worktrees automaticamente após merge. A remoção deve ocorrer
somente em tarefa de limpeza autorizada, após essas verificações.

## Git

Um tópico pai corresponde a uma branch/PR quando o fechamento for autorizado;
subtarefas relacionadas usam commits úteis na mesma branch.

Commits intermediários são permitidos por subtópico dentro do fluxo
autorizado. Abrir um único PR por tópico-pai concluído; não abrir PR
artificial quando não houver alteração. Uma atualização de governança pode
ter PR exclusivo quando a própria task o solicitar explicitamente.

Commit, push e PR só quando a task explicitamente solicitar ou quando o
fluxo do projeto já estiver executando a etapa de fechamento. Nunca
limpar, sobrescrever ou incluir mudanças locais alheias à task.

Não executar merge automático. `USER_ONLY_MERGE`: o merge cabe ao usuário.

## Arquitetura NestJS aprovada

O MKTauto terá um único backend operacional NestJS, estruturado em módulos.
A estrutura-alvo é:

``` text
src/modules/
src/infrastructure/
src/shared/
python/
test/
scripts/
docker/
```

A pasta `backend/` será eliminada pela task de reestruturação correspondente.
Não antecipar mudanças de caminhos em atualizações de governança. Até a
migração terminar, os caminhos antigos permanecem válidos.

## Autorização operacional

Mudanças de código não autorizam automaticamente deploy, chamadas pagas,
publicações, alterações em SQLite LIVE, reinício de containers, ativação de
schedulers, criação de grants ou exclusão de dados. Essas ações exigem
autorização explícita no respectivo escopo; gastos também exigem orçamento.
Preservar todos os gates operacionais existentes, incluindo Finance, QC,
direitos comerciais, aprovação humana, auditoria e recuperação.

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
