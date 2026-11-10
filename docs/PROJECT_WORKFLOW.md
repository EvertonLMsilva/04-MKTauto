# MKTauto --- workflow econômico

## Objetivo

Maximizar qualidade por token: **ChatGPT especifica; Codex executa**.

## Fluxo

``` text
ROADMAP
  ↓
ChatGPT escolhe o tópico funcional desbloqueado de tamanho útil
  ↓
ChatGPT cria/refina TASK com entrega verificável
  ↓
READY_FOR_CODEX
  ↓
Codex lê AGENTS + TASK + arquivos permitidos
  ↓
implementa + testes focados + diff focado
  ↓
DONE ou BLOCKED
  ↓
evidência mínima
  ↓
fechamento Git/PR quando aplicável
  ↓
próxima TASK desbloqueada
```

## Estados de task

`PLANNED → READY_FOR_CODEX → IN_PROGRESS → DONE`

Exceções: `BLOCKED` e `CANCELLED`.

## Responsabilidade do ChatGPT

Antes do Codex:

-   decidir arquitetura;
-   reduzir escopo;
-   identificar dependências;
-   definir contratos;
-   definir arquivos prováveis/permitidos;
-   definir testes;
-   definir aceite;
-   declarar explicitamente o que não fazer;
-   pesquisar APIs/viabilidade quando necessário;
-   separar entregas independentes, agrupando subtarefas necessárias à mesma entrega;
-   priorizar reuso e preservar Ports & Adapters e contratos existentes;
-   especificar autorização e orçamento antes de qualquer LIVE pago.

## Responsabilidade do Codex

-   confirmar somente o mínimo necessário no código;
-   criar/alterar os arquivos definidos;
-   implementar a menor mudança;
-   executar testes focados;
-   revisar o diff;
-   parar.

O Codex não deve redesenhar arquitetura, reorganizar roadmap ou escolher
a próxima prioridade durante uma task de implementação.

## Quando devolver ao ChatGPT

Retornar `BLOCKED` quando:

-   contrato real contradiz a task;
-   arquivo/símbolo necessário não existe;
-   decisão arquitetural está ausente;
-   integração externa exige decisão não especificada;
-   seria necessário ampliar significativamente o escopo;
-   teste revela problema fora da responsabilidade da task.

## Validação proporcional

1.  teste(s) diretamente afetado(s);
2.  integração próxima somente quando necessária;
3.  suíte completa apenas em gates, mudanças transversais ou quando
    explicitamente exigida.

Segurança, direitos, idempotência e contratos nunca são reduzidos para
economizar tokens.

TDD acompanha o risco: domínio, estados, permissões, idempotência e contratos
exigem testes prévios; documentação exige verificações documentais. Testes comuns
usam fixtures/mocks. APIs pagas e pipelines LIVE exigem autorização explícita.
Registre custos conhecidos e custos indisponíveis sem convertê-los em zero.
Diagnostique a causa antes de corrigir; sem evidência nova, não repita tentativas
bloqueadas.

## Fechamento

Um tópico pai usa uma branch/PR, com subtarefas em commits úteis, somente quando
a etapa Git estiver autorizada. Preserve mudanças locais alheias à task.

A evidência de uma task deve ser curta: arquivos alterados, testes
executados e risco/bloqueio relevante. Histórico detalhado de PRs fica
em `docs/history/ROADMAP_HISTORY.md`, não no roadmap operacional.
