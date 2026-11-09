# MVP — revisão e publicação por execução

1. Iniciar `npm start` com o banco operacional, modelos locais, scheduler e conta já configurados.
2. A campanha recorrente produz e aguarda revisão. Consultar `GET /content-operations/campaign-executions/{executionId}/review` com a autenticação QC existente.
3. Revisar o render/preview e QC apresentados. A resposta inclui `reviewId`, identificador opaco da apresentação, preservado após restart.
4. Enviar a decisão para `POST /content-operations/campaign-executions/{executionId}/approvals`. O corpo contém somente `reviewId` recebido na consulta, `decision` (`APPROVED` ou `REJECTED`) e `justification` (texto ou `null`; rejeição exige justificativa). A identidade do revisor vem da autenticação.
5. Retomar com `POST /content-operations/campaign-executions/{executionId}/resume`, corpo `{}`. O backend prepara o pacote e aguarda sua aprovação independente.
6. Consultar novamente `/review`. Revisar o pacote, `finalCaption`, CTA/disclosure/link, render e destino apresentados.
7. Enviar a decisão para `POST /content-operations/campaign-executions/{executionId}/package-approvals`, usando o `reviewId` dessa nova consulta, `decision` e `justification`.
8. Retomar novamente com `/resume`, corpo `{}`. O backend resolve pacote/destino, revalida os gates e continua a publicação.
9. Acompanhar `GET /content-operations/campaign-executions/{executionId}` e `/result` até `SUCCEEDED` com recibo. Em incerteza, `/resume` reconcilia a operação existente; não criar outra solicitação de publicação.

O cliente devolve automaticamente o `reviewId` da resposta correspondente; não monta identidade técnica do render ou do pacote. Nenhum passo exige abrir SQLite, editar arquivos JSON ou transportar identificadores internos entre serviços. Chamadas históricas continuam disponíveis.

Se houver alteração da revisão, destino ou ambiguidade de pacote, a decisão é bloqueada: consultar e revisar novamente. Um replay da decisão devolve seu resultado persistido; não autoriza outra versão. Cada nova ocorrência exige aprovações próprias.
