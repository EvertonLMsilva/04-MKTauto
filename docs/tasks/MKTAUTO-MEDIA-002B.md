# MKTAUTO-MEDIA-002B — registro de migração

Composição inicial migrada para Media/NestJS: validação, preparação imutável,
render V1 ligado a CompositionPlan V1/V2, persistência de render/linhagem/recibo
em transação e recuperação idempotente do recibo. Ports: VideoComposer,
InitialRenderRepository, RenderRepository e RenderStorage. Testes usam composer
fake, bancos temporários e bytes locais; não executam FFmpeg ou APIs.

Endpoints: POST /media/compositions, GET /media/compositions/:id,
GET /media/renders/:id. VIDEO_COMPOSER é injetável; o provider padrão retorna
COMPOSER_UNAVAILABLE (503) até existir adapter TS de execução autorizado.

## Dependências que impedem remoção do JavaScript

- VideoCompositionService: preview-runtime.js e commercial-hybrid-service.js.
- VideoRenderRepository: quality-control-repository.js, além dos testes legados.
- LocalVideoStorage: ffmpeg-video-composer.js e ffmpeg-subtitle-renderer.js.
- VideoRenderService: testes legados de render/arquitetura.
- FfmpegVideoComposer mantém resolução física, inspeção/decodificação e execução
  no legado. O adapter TS de armazenamento cobre apenas o render inicial;
  reconciliação de legendas/híbrido permanece fora desta etapa.

Nenhum consumidor legado substituído ou arquivo legado removido: a paridade do
serviço e da persistência não comprova a paridade do pipeline FFmpeg completo.
Sem dependência nova obrigatória de Finance ou Content Operations; as consultas
existentes de execução/roteiro continuam pelos ports já utilizados por Media.
Custos externos conhecidos nesta validação: nenhuma chamada executada. Custos
de infraestrutura local não mensurados.
