# MKTAUTO-MEDIA-002C — adapter FFmpeg TypeScript

Composição inicial V1 (PNG) e V2 (PNG/MP4, TRIM/LOOP) pelo port
`VideoComposer`, sem dependência JavaScript em produção. Preserva a ordem dos
inputs, filtergraph, argumentos, 1080×1920, 30 FPS, H.264 High 4.0, CRF 20,
AAC LC mono 48 kHz/192 kbps e identidade SHA-256. Render, linhagem e recibo
continuam no serviço e na transação implementados em MEDIA-002B.

O probe aceita a tolerância de um frame CFR do legado e devolve a duração
exata do plano ao serviço. Hashes e propriedades físicas são verificados nas
cópias consumidas; vídeo de entrada e saída são decodificados e inspecionados
antes da promoção. Artefatos reutilizados também são revalidados.

Execução sem shell, argumentos estruturados, logs limitados, timeout,
cancelamento e monitoração do limite de saída. A promessa do processo termina
após `close`, antes da limpeza do staging. Falhas de limpeza são explícitas e
preservam a causa original. Falhas de persistência revertem render, linhagem e
recibo; conteúdo já promovido por hash pode permanecer para reutilização,
como no legado, sem excluir artefatos compartilhados por requisições concorrentes.

## Ativação

Provider Nest usa `FFMPEG_PATH`, `FFPROBE_PATH`, `FFMPEG_VOICE_ROOT`,
`FFMPEG_MEDIA_ROOT` e `FFMPEG_RENDER_ROOT`, com a mesma política versionada do
legado. Só ativa com configuração válida, binários regulares acessíveis e
diretórios acessíveis; wrappers de shell e staging simbólico são recusados.
Configuração ausente/inválida mantém `COMPOSER_UNAVAILABLE` (503). Essas
checagens não executam binários; compatibilidade real exige validação
operacional futura explicitamente autorizada. `FFMPEG_PROCESS_RUNNER` permite
injetar o executor fake sem substituir o adapter ou o provider de composição.

## Dependências restantes

- `preview-runtime.js` e `p4-runtime.js` ainda constroem `FfmpegVideoComposer`
  JavaScript; a migração desses fluxos não está autorizada nesta etapa.
- `ffmpeg-subtitle-renderer.js` e `ffmpeg-quality-inspector.js` importam seu
  `runProcess`. Legendagem, inspeção de qualidade, híbrido e adaptação
  multiplataforma permanecem no legado, fora da composição inicial.
- Nenhum arquivo legado removido. Testes de paridade importam o legado apenas
  como referência; o provisionamento de fixtures de voz usa o repositório JS.

## Validação

TDD com executor fake e arquivos/bancos temporários: sucesso, saída inválida,
integridade, limites, timeout, cancelamento, cleanup, replay, concorrência e
rollback após falha ao gravar recibo. Paridade dos comandos/filtergraphs e
saídas JS/TS para V1 e V2 TRIM/LOOP; E2E exercita o provider Nest real com
apenas o executor substituído por fake.

- Testes focados Media: 49 PASS; E2E relacionados: 7 PASS.
- Regressões legadas relacionadas: 19 PASS.
- TypeScript, build Nest com saída temporária e lint: PASS.
- Lint mantém três avisos preexistentes em Publishing; nenhum novo aviso.
- FFmpeg real, pipelines LIVE e APIs pagas não executados.
- Nenhum custo externo gerado por chamadas; custo local não mensurado.
