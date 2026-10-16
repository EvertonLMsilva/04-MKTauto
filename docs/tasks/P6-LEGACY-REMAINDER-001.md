# P6-LEGACY-REMAINDER-001 — desacoplamento residual

STATUS: DONE
BRANCH: codex/p1-affiliate-campaign
HEAD_BASE: 8b951d595867af5ab17bfcc4bf1b5f2cad675b5e

A decisão do Planner nesta conversa autoriza substituir concorrência JS × NestJS por dois workers NestJS independentes. A garantia de interoperabilidade com o runtime JS aposentado deixa de ser requisito. Permanecem exclusividade, limites financeiros, contabilização única, reconciliação idempotente e recuperação persistida.

## Entrega

- Os workers executam o grafo real de FinanceSession, com conexões independentes ao mesmo SQLite e barreira compartilhada. IDs de threads distintos são verificados. Nenhum mock executa as operações concorrentes.
- Os 39 módulos importados diretamente pelos testes mistos alcançavam 57 módulos legados. Esses consumidores agora usam observações históricas fixas: 538 vetores de contratos e 5.786 chamadas/efeitos SQL em 270 cenários, capturados contra o JS original com 495 testes unitários e 55 E2E passando. Os leitores de referência recusam entradas/cenários desconhecidos e verificam o consumo das observações. Não há gravador nem fallback ao código sob teste no repositório.
- O teste de fronteira cobre os consumidores listados no inventário e os novos helpers. A reintrodução de URL para o runtime legado foi rejeitada antes da validação verde.
- Nenhum cenário funcional foi excluído; as duas variantes redundantes de concorrência com participante JS foram aposentadas conforme autorização. Os demais asserts e nomes históricos dos cenários foram preservados.
- Resultado residual: **57 desacoplados; 0 módulos alcançados pelos consumidores identificados**. Isso não significa exclusão física dos arquivos.

## Preservação e remoção futura

Nenhum arquivo foi removido nesta execução. Os 16 candidatos protegidos anteriores e suas cópias em `P6-FINAL-CODE-CLEANUP-2026-10-15T17-04-21-060Z/files` mantêm os SHA-256 do manifesto original. Os 57 candidatos residuais também foram copiados e receberam manifesto SHA-256 em `D:\04-Projetos\23-MKTauto-backups\P6-REMAINDER-CONTINUE`. Qualquer remoção continua pendente de autorização específica.

Migrations, bancos reais, contratos públicos, dependência source-map-support e alterações locais anteriores foram preservados. A lista exata de consumidores, arquivos alterados, candidatos e hashes está em [P6-LEGACY-REMAINDER-001.inventory.json](P6-LEGACY-REMAINDER-001.inventory.json).

## Validação

- RED/GREEN financeiro: a exigência de IDs distintos falhou antes da alteração do worker e passou depois. Finance/TTS/ajustes: 29 testes; com a fronteira: 30.
- `npm run test:all`: PASS — 43 Node, 496 backend, 55 E2E e 7 Python; 1 teste operacional já marcado como skipped.
- `npm run build`: PASS, executado pelo test:all.
- `backend/node_modules/.bin/tsc --noEmit --incremental false -p backend/tsconfig.json`: PASS.
- `npm --prefix backend run lint`: PASS; três avisos no-control-regex em Publishing fora do diff desta task.
- Diff-check direcionado e integridade dos backups: registrados no inventário.

Nenhum LIVE, API paga, download, pipeline comercial, commit, push ou PR foi executado. Custo de computação local indisponível. Novos inputs nas referências históricas exigem evidência independente explícita; não são inferidos do NestJS. P7 não foi iniciado.
