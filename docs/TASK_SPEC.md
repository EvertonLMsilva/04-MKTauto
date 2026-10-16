# TASK_SPEC --- contrato de entrega funcional

Cada task deve caber em um contexto pequeno e produzir **uma entrega
observável**.

``` markdown
# <ID> — <nome>

STATUS: PLANNED | READY_FOR_CODEX | IN_PROGRESS | BLOCKED | DONE
PRIORIDADE: <fase do roadmap>
TOPICO_PAI: <ID; uma branch/PR quando autorizado>
DEPENDE_DE: <IDs ou NENHUMA>

## Objetivo e valor
<1–3 frases>

## Evidência/decisões já tomadas
- <somente o necessário para não reinvestigar>

## Arquivos permitidos
- READ: <arquivos/símbolos>
- CREATE: <arquivos>
- MODIFY: <arquivos>

## Contrato
- Entrada:
- Saída:
- Erros/estados:
- Invariantes:

## Implementação
1. <mudança mínima>
2. <mudança mínima>

## Execução e custos
- Fixtures/mocks: <necessários>
- LIVE: não autorizado por padrão; autorização e orçamento se aplicável.
- Custos: <registro conhecido ou indisponível; sem inventar zero>

## Testes
- <TDD proporcional ao risco e comandos focados; documental quando aplicável>
1. <caso>
2. <caso>

## Aceite
- <condição objetiva>

## NÃO FAZER
- <fora de escopo>
- <refatorações proibidas>

## Retorno Codex
STATUS: DONE | BLOCKED | FAILED
ALTERADO:
TESTES:
OBSERVAÇÃO:
```

## Critério de tamanho útil

Agrupe subtarefas relacionadas à mesma entrega em commits úteis. Separe
capacidades independentes e migrações de UI/infra não necessárias à entrega.
Decisões arquiteturais abertas ou exploração ampla voltam ao Planner antes
de READY_FOR_CODEX. Reaproveite módulos e preserve contratos; diagnostique
falhas antes de corrigir e não repita bloqueios sem evidência nova.

A task não deve mandar o Codex "analisar o projeto", "decidir a melhor
arquitetura" ou "implementar tudo".
