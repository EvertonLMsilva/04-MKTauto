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

O projeto possui seis frentes: CORE, A, B, C, D e E.

- **CORE:** arquitetura, infraestrutura, PostgreSQL, migrations, persistência,
  integração estrutural e governança.
- **A — Publishing:** Instagram, Facebook, publicação, distribuição,
  autorizações sociais, recibos e recuperação.
- **B — Produção:** Content, Media, roteiros, TTS, CTC, vídeo, composição,
  legendas e QC técnico.
- **C — Affiliate e Commercial:** Shopee, produtos, ofertas, catálogo comercial,
  links afiliados, comissões comerciais, atribuição e medição de receita.
- **D — Finance:** orçamento, custos, reservas financeiras, reconciliação,
  limites e evidências financeiras.
- **E — Operations:** orquestração funcional, campanhas diárias, scheduler,
  execuções, recuperação e integração operacional dos módulos.

Cada frente possui seu próprio tópico-pai e subtópicos. CORE é a frente
estrutural e não substitui as cinco frentes funcionais.

CORE possui migrations e infraestrutura PostgreSQL, inclusive nos schemas
dos demais domínios. D possui regras de negócio e contratos Finance; E possui
as regras funcionais de Operations. C mantém Shopee e receitas comerciais,
A mantém os efeitos de publicação social e B mantém a geração de conteúdo e
mídia. Integração estrutural de CORE não transfere as regras desses domínios;
a integração operacional dos módulos pertence a E.

Não duplicar módulos existentes nem transferir automaticamente arquivos ou
regras de negócio. Em arquivos compartilhados, a task deve definir o ownership
de edição e coordená-lo com as demais frentes. Arquivos reservados por outra
frente exigem autorização explícita antes de serem modificados.

A ampliação de CORE/A/B/C para seis frentes é prospectiva: preservar o
histórico documental, sem reclassificar retroativamente PRs ou entregas.
Esta atualização não altera as 19 unidades do roadmap MVP V1 nem autoriza
modificar seu histórico.

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
STATUS: DONE | PARTIAL | BLOCKED | FAILED
PARENT_STATUS: <estado do tópico-pai, conforme política abaixo>
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

## Política de tópicos-pai — ChatGPT e Codex

Aplica-se às seis frentes CORE, A, B, C, D e E, preservando a matriz de
responsabilidade, o isolamento e as proteções operacionais deste documento.

### T01 — Planejamento pelo ChatGPT

Antes de preparar um prompt de implementação, o ChatGPT deve:

1. Identificar a frente responsável e consultar a governança vigente quando
   tiver acesso ao repositório.
2. Considerar o último tópico concluído, os PRs integrados e pendentes e as
   dependências entre frentes.
3. Definir um único tópico-pai, seus subtópicos executáveis e critérios
   verificáveis de conclusão.
4. Verificar o que já foi implementado para não recriar funcionalidades;
   uma branch antiga não representa necessariamente a `main` atual.

### T02 — Identificação antes do prompt

Todo prompt apresentado pelo ChatGPT deve ser precedido de uma identificação
breve, fora do prompt técnico: frente responsável, objetivo da implementação,
ferramenta recomendada, modelo LLM recomendado e esforço de raciocínio.

### T03 — Um prompt por tópico-pai

**UM PROMPT = UM TÓPICO-PAI.** O prompt deve conter os subtópicos necessários
à entrega completa. Não gerar um prompt separado por subtópico nem fragmentar
uma entrega funcional em PRs artificiais. Todos os subtópicos permanecem na
mesma branch e no mesmo PR; commits intermediários úteis são permitidos no
fluxo autorizado pela seção Git.

### T04 — Ciclo completo de implementação

O Codex deve verificar baseline e checkout/worktree, identificar e ordenar os
subtópicos, implementá-los, executar testes direcionados, corrigir falhas
introduzidas, validar contratos e integração e realizar as verificações
finais exigidas. Preparar commits e abrir o único PR somente no fechamento
autorizado pela task ou pelo fluxo Git existente, após cumprir e validar
todos os critérios obrigatórios do tópico-pai. Não executar merge.

Em resultado PARTIAL/BLOCKED, preservar o trabalho válido na mesma branch.
Após resolver o impedimento, retomar o mesmo tópico-pai e o mesmo PR, se já
existir, sem abrir outro. Não abrir PR enquanto faltarem critérios
obrigatórios. Tarefas exclusivamente documentais exigem validação documental,
sem testes de aplicação alheios ao escopo.

### T05 — Separação entre frentes

Cada frente mantém seu chat de planejamento próprio, tópicos-pai
independentes, subtópicos, branches próprias, worktrees isolados, allowlist
exata de arquivos, testes focados e um único PR por tópico-pai. O ChatGPT deve
distribuir implementações independentes entre as frentes para permitir execução
paralela, respeitando a matriz de responsabilidade vigente. Não atribuir
simultaneamente à mesma frente duas demandas que exijam tópicos-pai
independentes.

Declarar dependências entre frentes; não modificar implicitamente seu escopo.
Permanece proibida a edição simultânea do mesmo arquivo por frentes distintas,
inclusive em worktrees diferentes. Divergências de classificação de prompts
devem ser registradas para decisão explícita, sem redistribuir ownership.

### T06 — Controle de progresso

Todo retorno de implementação deve complementar a saída padrão com:

- Frente e tópico-pai.
- Último tópico concluído, tópico atual e próximo tópico; informar quando
  não houver próximo tópico definido/autorizado, sem antecipar sua execução.
- Total de subtópicos, concluídos, parciais, pendentes e quantidade faltante
  (parciais + pendentes).
- Diretório de trabalho, branch, HEAD, status dos testes, estado do PR e
  bloqueios remanescentes.

Contar somente subtópicos realmente identificados e validados. O total deve
corresponder à soma de concluídos, parciais e pendentes, sem percentuais
inventados. Informar o estado real do PR, incluindo Draft quando aplicável.

Manter o controle por frente e um consolidado das seis frentes no planejamento
e nos relatórios de coordenação, usando registros verificáveis. Identificar
informações indisponíveis e não presumir progresso de frentes não consultadas
nem contar a mesma entrega mais de uma vez.

### T07 — Critérios de conclusão e evidência

- **DONE:** todos os critérios obrigatórios foram cumpridos e validados.
- **PARTIAL:** há implementação válida, mas faltam requisitos ou validações.
- **BLOCKED:** um impedimento comprovado inviabiliza a continuação.
- **READY_FOR_PR:** tópico-pai completo e validado, pronto para abrir o PR
  quando seu fechamento estiver autorizado.
- **PR_OPEN:** PR do tópico-pai criado; revisão e merge pertencem ao usuário.

READY_FOR_PR e PR_OPEN descrevem a fase do tópico-pai em PARENT_STATUS;
STATUS descreve o resultado da execução. PR aberto não significa integração
nem autoriza cutover. FAILED permanece disponível para falha de execução,
sem substituir a classificação de requisitos incompletos ou bloqueios.

Diferenciar falhas introduzidas de falhas globais comprovadamente
preexistentes. Não corrigir silenciosamente arquivos fora da allowlist nem
declarar testes globais PASS quando houver falhas. Registrar falhas externas
com evidência mínima e frente responsável, encaminhando-as pelo fluxo de
coordenação autorizado, sem ampliar automaticamente a task. Distinguir
testes focados de validação global e validação offline de execução real.

### T08 — Revisão, merge e continuidade

Mantêm-se um PR por tópico-pai, revisão manual pelo operador e
`USER_ONLY_MERGE`, sem merge automático. Correções solicitadas na revisão
permanecem na mesma branch/PR. Iniciar novo tópico-pai somente após fechamento
do anterior ou decisão explícita de continuidade. Nenhuma dessas etapas
dispensa as autorizações operacionais da seção correspondente.
