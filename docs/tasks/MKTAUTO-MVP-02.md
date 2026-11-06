# MVP-02 — produção local agendada

O aceite cobriu **um ciclo real** do scheduler NestJS existente: execução `6b2a49e1-f6f2-4f94-9259-f901907db2a0`, MP4 de 20 s, QC `PASS` e resultado persistido. Após reiniciar o backend e repetir a solicitação, permaneceram os mesmos ID de execução, 29 eventos, ID de render, hash e data de modificação do arquivo. O estado final é `WAITING_INPUT` com `EXACT_HUMAN_APPROVAL_REQUIRED`; aprovação e publicação não foram executadas. Um ciclo não homologa operação diária contínua nem publicação.

## Operação oficial

No PowerShell, a partir da raiz do repositório, configure variáveis de ambiente por mecanismo privado (valores abaixo são placeholders):

```powershell
$env:PROJECT_API_DATABASE = '<caminho-absoluto-do-sqlite-isolado>'
$env:SOCIAL_HISTORY_DATABASE = $env:PROJECT_API_DATABASE
$env:CAMPAIGN_SCHEDULER_ENABLED = 'true'
$env:INSTAGRAM_SCHEDULER_ENABLED = 'false'
$env:CONTENT_EDITORIAL_PROVIDER = 'ollama'
$env:OLLAMA_MODEL = 'gemma3:4b'
$env:LOCAL_TTS_MANIFEST = '<manifesto-local-licenciado-do-Kokoro-pf_dora>'
$env:LOCAL_TTS_MANIFEST_SHA256 = '<sha256-do-manifesto>'
$env:LOCAL_ALIGNMENT_PYTHON = '<python-do-ambiente-local-configurado>'
$env:LOCAL_ALIGNMENT_MODEL_ROOT = '<diretorio-do-modelo-local>'
$env:FFMPEG_PATH = '<ffmpeg-executavel>'
$env:FFPROBE_PATH = '<ffprobe-executavel>'
$env:FFMPEG_MEDIA_ROOT = '<diretorio-da-midia-autorizada>'
$env:FFMPEG_VOICE_ROOT = '<diretorio-de-voz>'
$env:FFMPEG_RENDER_ROOT = '<diretorio-de-render>'
$env:PUBLISHING_RENDER_ROOT = $env:FFMPEG_RENDER_ROOT
$env:LOCAL_MEDIA_EVIDENCE_ROOT = '<diretorio-de-evidencias>'
$env:PORT = '3000'
npm run build
npm run db:provision
npm start
```

O banco deve ser exclusivo da operação, provisionado pelo backend, com foreign keys ativas. As demais configurações de licença, alinhamento e mídia exigidas pelos adapters existentes também devem estar presentes. Os diretórios precisam existir e ser acessíveis; `PUBLISHING_RENDER_ROOT` deve apontar para o mesmo render de `FFMPEG_RENDER_ROOT`. `npm start` usa `backend/dist/main.js`; o bootstrap valida o banco e encerra o scheduler no `Ctrl+C` (`SIGINT`).

Registre cada campanha elegível pelo contrato `POST /content-operations/campaign-executions/local`, com `campaignId`, `campaignRevision`, `projectVersion`, `requestId`, `requestedAt` e `localImage` com mídia e direitos autorizados. `requestedAt` define o instante agendado; o scheduler processa quando vencer. Consultas: `GET /content-operations/campaign-executions/{executionId}`, `GET .../{executionId}/history` e `GET .../{executionId}/result`. Repetir a mesma solicitação retorna a mesma execução; alteração na mesma campanha/data gera conflito. Há no máximo um master por campanha/data em `America/Sao_Paulo`, sem cota única entre campanhas; orçamento global e elegibilidade seguem as regras existentes. Falta de insumo, QC falho ou resultado incerto não é sucesso. Aprovação humana da versão exata permanece necessária antes de qualquer publicação.

O `run.mjs` privado foi apenas o acionador e observador do teste local, usando os mesmos serviços NestJS. Nenhuma lógica de produção ou agendamento exclusiva dele é necessária no runtime oficial.
