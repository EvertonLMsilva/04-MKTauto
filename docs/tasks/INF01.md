# INF01 --- Workers & Containers

## Objetivo

Separar execução pesada após o fluxo funcional estar estável, sem
microserviços prematuros.

### INF01.1 --- Workload inventory

Medir responsabilidades, duração, falhas e recursos antes de separar.

### INF01.2 --- Worker boundary

Escolher primeira responsabilidade com benefício real de isolamento.

### INF01.3 --- Job handoff

Contrato de fila/claim/retry/idempotência usando padrões comprovados.

### INF01.4 --- Media worker

Extrair somente se geração de mídia justificar processo separado.

### INF01.5 --- Composer worker

Extrair somente se FFmpeg justificar isolamento.

### INF01.6 --- Publisher worker

Isolar efeitos externos quando Publishing estiver desbloqueado.

### INF01.7 --- Container baseline

Containerizar componentes CPU/aplicação estáveis primeiro.

### INF01.8 --- Local development compose

Compose mínimo para serviços realmente extraídos; não criar catálogo de
containers vazios.

### INF01.9 --- Host ComfyUI bridge

MKTauto containerizado acessa ComfyUI/H3 no host de forma configurável.

### INF01.10 --- GPU container feasibility

Somente depois: avaliar NVIDIA Container Toolkit/ambiente suportado e
estabilidade.

### INF01.11 --- H3 container

Bloqueado até INF01.10 provar valor e compatibilidade; não antecipar.
