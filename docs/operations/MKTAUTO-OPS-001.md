# MKTAUTO-OPS-001 — operação local isolada

> Registro histórico do piloto OPS-001, executado no checkout e layout indicados
> abaixo. Seus caminhos, PIDs e evidências originais são preservados. Para o
> projeto atual com NestJS na raiz, consulte o [README](../../README.md) e a
> [estrutura vigente](../architecture/PROJECT_STRUCTURE.md). O runtime existente
> não é migrado nem reiniciado pela reestruturação de código.

Data das evidências: 10/11/2026. Base backend: `2e121214450d361167396c25618ef8bfe6dd55bc`, branch `codex/be-ops-local-001`. Durante a execução, `origin/main` avançou para `a644dadd1180b986f5558225360cd1b89aefc215` pelo PR #149. O piloto e os gates desta entrega usam a base auditada, sem merge/rebase; o provisionador/schema e o bootstrap permanecem iguais nesses commits.

**OPS_LOCAL_PASS=NO.** O runtime nativo, a leitura autenticada, o backup e a persistência de uma execução falha foram comprovados. A campanha parou em `ALIGNMENT_TEXT_DIVERGENT`; não houve MP4 final, QC final, aprovação ou publicação FAKE. O reinício não comprova idempotência de publicação.

## 1. Requisitos

- Windows, Node.js compatível com os manifests; a execução local usou Node `v24.18.0` e `node:sqlite`.
- Backend compilado por `npm run build`, dependências NestJS disponíveis em `backend/node_modules` e frontend existente em `D:\04-Projetos\23-MKTauto-front`, com suas dependências Vite/React.
- Portas loopback livres; neste piloto: backend `3124`, frontend `5187`. A CLI recusa portas ocupadas e não encerra seus ocupantes.
- Diretório novo em D:, absoluto, fora de qualquer repositório Git, sem links; seu pai deve existir. Medição prévia desta execução: aproximadamente 399 GB livres em D:.
- Para a produção audiovisual: FFmpeg/FFprobe nativos, Python/CTC e manifesto TTS local com arquivos e hashes válidos. Os recursos nativos verificados estavam em `D:\04-Projetos\MKTauto-runtime\p77-audio-closure`.
- Identidade QC individual legítima já provisionada, em arquivo privado externo. A inicialização não cria identidade nem lê sua credencial.

Docker, WSL, VHDX, serviços Windows e outros runtimes ficam fora do procedimento. Não iniciar containers nem usar o Piper Linux anterior. Manifests/licenças utilizados neste piloto autorizam somente o teste local isolado verificado; não constituem aprovação operacional permanente.

## 2. Variáveis e configuração privada

`init` recebe um JSON de recursos locais, plano ou com objeto `env`, e copia apenas estas chaves:

| Chaves | Finalidade |
| --- | --- |
| `FFMPEG_PATH`, `FFPROBE_PATH` | Executáveis locais absolutos |
| `LOCAL_TTS_MANIFEST`, `LOCAL_TTS_MANIFEST_SHA256` | Manifesto TTS autorizado e seu hash |
| `LOCAL_ALIGNMENT_PYTHON`, `LOCAL_ALIGNMENT_MODEL_ROOT`, `LOCAL_ALIGNMENT_MODEL_SHA256` | Python, modelo CTC instalado e hash |
| `LOCAL_ALIGNMENT_DEVICE`, `LOCAL_ALIGNMENT_TEXT_POLICY` | Configuração compatível do alinhador |

Exemplo de fonte já existente: `C:\Users\evert\AppData\Local\MKTauto\mvp-fake-001-53757880\config.json`. Esse caminho é uma fonte de recursos permitidos, não de banco, aprovações, estados ou segredos. O arquivo original não é alterado.

A CLI constrói o ambiente abaixo; não executar os workers com um ambiente completo herdado de outro runtime.

| Configuração gerada | Valor/escopo |
| --- | --- |
| `PROJECT_API_DATABASE`, `SOCIAL_HISTORY_DATABASE` | Mesmo `<root>\data\pilot.sqlite` |
| `FFMPEG_MEDIA_ROOT`, `FFMPEG_VOICE_ROOT`, `FFMPEG_RENDER_ROOT` | `<root>\media`, `voice`, `render` |
| `PUBLISHING_RENDER_ROOT` | Mesmo diretório de render |
| `LOCAL_MEDIA_EVIDENCE_ROOT` | `<root>\evidence` |
| `LOCAL_ALIGNMENT_EVIDENCE_KEY` | Chave nova privada por piloto; nunca imprimir |
| `TEMP`, `TMP` | `<root>\tmp` |
| `QC_IDENTITIES_FILE` | Caminho fornecido explicitamente por `--identities` |
| `PORT` | Porta backend escolhida |
| `VITE_API_BASE_URL` | Origem frontend loopback; nenhum segredo |
| `MKTAUTO_API_PROXY_TARGET` | Origem backend loopback |
| `CAMPAIGN_SCHEDULER_ENABLED`, `INSTAGRAM_SCHEDULER_ENABLED` | `false` |
| `OPERATIONAL_NOTIFICATIONS_ENABLED`, `DISCORD_NOTIFICATIONS_ENABLED` | `false` |
| `OPENAI_TTS_LIVE_ENABLED`, `INSTAGRAM_LIVE_POSTS_ENABLED`, `FACEBOOK_LIVE_POSTS_ENABLED` | `false` |
| `FAL_GENERATION_MODE`, `CONTENT_EDITORIAL_PROVIDER`, `SHOPEE_AFFILIATE_MODE`, `INSTAGRAM_PUBLICATION_MODE` | `fake` |
| `FACEBOOK_PUBLICATION_MODE` | Ausente; `false` e `fake` não são modos aceitos |
| `TEMPORAL_QC_MODE` | `offline` |
| `FFMPEG_VIDEO_POLICY_VERSION`, `FFMPEG_VIDEO_FRAME_RATE` | `ffmpeg-video-policy/1.0.0`, `30` |
| `INSTAGRAM_ACCOUNT_ID`, `INSTAGRAM_API_VERSION` | Identificação sintética `987654321001`, versão offline `v25.0` |
| `HF_HUB_OFFLINE`, `TRANSFORMERS_OFFLINE`, `HF_HUB_DISABLE_TELEMETRY` | `1` |

`FFMPEG_VIDEO_STAGING_ROOT` não deve ser definido: o staging oficial é `<render>\.staging`. Tokens OpenAI/Meta/Telegram/Discord, configuração FAL controlada, bancos anteriores, `NODE_OPTIONS` e proxies externos não são herdados. `VITE_*` é público e não recebe identidade QC, tokens ou caminhos privados.

## 3. Diretórios e identificação do ambiente

Piloto preservado desta task:

```text
D:\04-Projetos\23-MKTauto-ops-runtime\ops001-ce70d5a1\pilot
  private\config.json       configuração, recursos e chave privada
  private\current.json      UUID do conjunto atual de workers
  private\stop-<UUID>.request protocolo privado de encerramento
  data\pilot.sqlite         SQLite persistente exclusivo, schema 44
  media\                    PNG próprio e objetos identificados por hash
  voice\                    WAV vinculado ao roteiro/run
  render\                   saídas finais; nenhuma atingida nesta execução
  evidence\                 evidências locais
  tmp\                      temporários exclusivos
  logs\<UUID>-<role>.log     logs por início e papel
  runs\<UUID>\              manifest, launch e estado de cada worker
  backups\                  snapshots SQLite consistentes e metadados
```

`init` restringe a ACL do diretório novo ao usuário Windows atual e SYSTEM, com herança para os filhos. Não altera a identidade fonte. Configuração, manifests de controle, logs, bancos, backups e mídias ficam fora do Git; não publicar esses diretórios como anexos.

Captura após reinício: UUID de runtime `0d6c3b54-38ab-45ae-b381-8b61d3d63bf1`, PID backend `33708`, PID frontend `32040`. São evidências históricas, não instruções para encerrar PIDs; consultar `status` novamente.

## 4. Inicialização

Executar os comandos da CLI a partir de `D:\04-Projetos\23-MKTauto-ops-001`. Para o piloto existente, não executar `init` novamente:

```powershell
Set-Location D:\04-Projetos\23-MKTauto-ops-001
$pilotRoot = 'D:\04-Projetos\23-MKTauto-ops-runtime\ops001-ce70d5a1\pilot'
node scripts/ops-local/cli.mjs status --root $pilotRoot
node scripts/ops-local/cli.mjs start --root $pilotRoot
```

`start` verifica build/dependências, portas e configuração, inicia somente os dois wrappers identificados e verifica HTTP. O backend usa `validateConfiguration`, `NestFactory` e `AppModule` reais, escutando `127.0.0.1`. O frontend usa a API Vite e o `vite.config.ts` existente, com cwd no repositório frontend. O ambiente explícito tem precedência para o target do proxy. Nenhum scheduler, campanha ou publicação é acionado por `start`.

Para um **outro piloto novo**, escolher um pai exclusivo, medir espaço disponível e substituir os caminhos autorizados:

```powershell
$pilotParent = 'D:\04-Projetos\23-MKTauto-ops-runtime\ops001-<identificador-novo>'
New-Item -ItemType Directory -Path $pilotParent -ErrorAction Stop | Out-Null
$newPilotRoot = Join-Path $pilotParent 'pilot'
node scripts/ops-local/cli.mjs init --root $newPilotRoot --frontend 'D:\04-Projetos\23-MKTauto-front' --resources '<JSON-absoluto-de-recursos-locais>' --identities '<JSON-absoluto-QC-autorizado>' --backend-port 3124 --frontend-port 5187
```

`init` recusa root já existente e provisiona somente o arquivo novo via `provisionSchema(db, 44)`. Valida integridade e contexto social `fake` com identificador próprio. Não usa bancos existentes. A CLI administrativa global `db:provision` tem target padrão 43 e mensagem antiga sobre schema 42; não usá-la como evidência de schema 44. Uma inicialização incompleta preserva seu diretório para diagnóstico; não sobrescrever seus arquivos para repetir a tentativa.

## 5. Verificação de saúde e contrato

```powershell
node scripts/ops-local/cli.mjs status --root $pilotRoot
Invoke-WebRequest -Uri 'http://127.0.0.1:3124/' -MaximumRedirection 0
```

Separar as evidências:

| Nível | Evidência necessária |
| --- | --- |
| Processo | Workers próprios, papel/run corretos e estado `running` |
| HTTP | Resposta do listener loopback; o GET `/` não prova conexão de todos os módulos |
| Sessão | Login individual válido; 401/403 não são base vazia |
| Contrato | JSON compatível com o serviço da feature, sem HTML de fallback |
| Banco/schema | SQLite 44, integridade `ok`, contexto `fake`, histórico consistente |
| Negócio | Execução rastreável e gates concluídos; `FAILED` não é campanha concluída |

Consultas pelo frontend/proxy: `/operations/dashboard/summary`, `/operations/executions`, `/media/assets?pipelineRunId=<run_id>` e `/publishing/executions/<execution_id>/destinations`. Os quatro GETs foram validados com a sessão humana antes do reinício. Após reinício, o usuário refez o login e o console mostrou `evert` e a mesma campanha interrompida. A revisão automática do navegador interrompeu a navegação seguinte por não confirmar a URL com segurança; os quatro GETs e a projeção completa do React não foram revalidados nessa segunda sessão.

Para execuções RUNNING, pendências, QC, publicações e erros, reutilizar os endpoints existentes, o histórico `/content-operations/campaign-executions/<id>/history` e logs por UUID. Não adicionar um serviço paralelo de monitoramento.

## 6. Autenticação QC

Abrir `http://127.0.0.1:5187/operations` e autenticar-se no formulário existente com a identidade individual autorizada. Manter exatamente a mesma origem ao voltar ao React; não alternar `localhost`, `127.0.0.1` ou portas.

O backend valida loopback, papel/revogação, Host/Origin e CSRF nas mutações. O console administra cookie HttpOnly/SameSite=Strict e CSRF internamente. Não ler, exportar ou copiar cookies, tokens ou credenciais para scripts, logs, `VITE_*` ou armazenamento do frontend. Nenhum ator de aprovação deve ser fabricado pelo cliente.

A sessão dura até 30 minutos e é mantida em memória; reinício exige novo login. As decisões legítimas que existirem no banco não devem ser recriadas para compensar a expiração da sessão.

## 7. Campanha FAKE controlada

Preparar identificadores exclusivos, imagem própria/licenciada/autorizada e evidências reais. A fixture efetivamente usada foi um PNG algorítmico próprio 1080×1920: fundo azul `0x1641b8`, retângulo ciano `0x36d9ef`; nenhuma imagem externa foi copiada. Os bytes foram registrados por `LocalEvidenceStorage.put(bytes, 'png')` no root novo. O projeto usou `MIXED_MEDIA_V2`, duração 20–60 s, produto fictício “Cartão azul de teste” e URL reservada `https://example.invalid/ops001?...`, sem acesso a loja ou conta social real.

Cadastros oficiais no backend nativo `http://127.0.0.1:3124`, em ordem:

| POST | Corpo |
| --- | --- |
| `/projects` | `{idempotencyKey, actor, occurredAt, project}`; projeto com `id`, `name`, `version`, `niche`, `audience` e `channel.publishing.networks` |
| `/affiliate/products` | `{idempotencyKey, product}`; `affiliate-product/1.0.0`, `productId`, revisão 1, nome/marca, atributos com evidência, referência de mídia e evidências |
| `/affiliate/campaigns` | `{idempotencyKey, campaign}`; `affiliate-campaign/1.0.0`, IDs/revisões de projeto/produto, `affiliateUrl` HTTPS, `cta`, `disclosure` |
| `/content-operations/campaign-executions/local` | Corpo exato abaixo; o backend gera briefing e run |

```json
{
  "campaignId": "<campaign_id_novo>",
  "campaignRevision": 1,
  "projectVersion": 1,
  "requestId": "<request_id_novo>",
  "requestedAt": "<instante_ISO>",
  "localImage": {
    "mediaReference": "<referencia_presente_no_produto>",
    "contentHash": "<sha256_real_do_PNG>",
    "origin": "OPERATOR_OWNED",
    "provider": null,
    "rights": {
      "usageBasis": "OWNED",
      "commercialUseAllowed": true,
      "evidence": ["<objeto_MEDIA_USAGE_RIGHT_com_autorizacao_real>"]
    }
  }
}
```

O exemplo é um molde: `evidence` recebe objeto, não a string explicativa. Cada evidência possui `id`, `kind`, `sourceRef`, `recordedAt`; direitos de mídia incluem `mediaAuthorization` com referência/hash correspondentes, concessões de uso/processamento comprovadas, `localProcessing` e `externalProviders`. Não fabricar direitos para passar o gate. A documentação dos DTOs está em `backend/src/project/application/project-commands.dto.ts`, `backend/src/affiliate/domain/affiliate-contracts.ts` e `localRequestInput` em `native-campaign-workflow.ts`.

Não enviar `audioMode`, `runId` ou `publication` ao endpoint `/local`: não pertencem ao seu DTO. Repetir exatamente a solicitação deve devolver a mesma execução; uma identidade diferente na mesma campanha/dia gera conflito. Os helpers privados `seed.mjs` e `snapshot.mjs` deste piloto registram a execução, não são ferramentas distribuídas nem comandos de recuperação; não repetir o seed sobre a base já utilizada.

No console autenticado, selecionar a execução. O polling já chama `POST /operations/executions/<id>/advance`, somente para essa execução. “Verificar novamente” usa retry e avanço escopados. Não executar tick global ou inserir aprovações no banco. A aprovação humana do MP4 exato e as etapas de legenda/direitos/publicação FAKE devem ocorrer pelos contratos existentes quando seus gates forem atingidos. Esta execução não chegou a esses gates.

| Evidência real do piloto | Valor |
| --- | --- |
| Campanha | `campaign_ops001_b4dbd4b7a2dc` |
| Execução | `47783ecb-b277-4e3d-9dd8-8977ceb1345f` |
| Run de negócio | `run_c48ad5a0bb46cbaee348b942a5482191` |
| Mídia | `image_auto:ae6da80325f2df8ab029afd52033bd7d1ddef228f0b6dd74fe8a94e7c624fd15` |
| Etapas concluídas | CONTEXT, EDITORIAL, SCENES, VIDEO_GENERATION, MEDIA_QC, AUDIO |
| Estado final | FAILED, `ALIGNMENT_TEXT_DIVERGENT`, `retrySafe=false` |
| Artefatos | PNG próprio e WAV de aproximadamente 20 s; sem MP4 final |
| QC final / aprovação / publicação FAKE | Não alcançados |

## 8. Consulta pelo React

Abrir `http://127.0.0.1:5187`, após login pelo console da mesma origem. Consultar dashboard, execução, mídia e destinos. O proxy existente encaminha somente `/operations` e os GETs específicos de assets/destinos; não é um proxy genérico para os cadastros do item 7.

Exibir a falha e os dados efetivamente persistidos. `MEDIA_QC` da imagem validou hash/PNG/direitos/vínculo; não equivale a relatório de QC final de vídeo. Ausência de publicação nesta base é resultado real, não publicação concluída. O frontend valida os JSONs; resposta HTML ou erro de transporte permanece erro.

## 9. Reinício

```powershell
node scripts/ops-local/cli.mjs stop --root $pilotRoot
node scripts/ops-local/cli.mjs status --root $pilotRoot
node scripts/ops-local/cli.mjs start --root $pilotRoot
node scripts/ops-local/cli.mjs status --root $pilotRoot
```

Manter exatamente o root anterior; não chamar `init`, seed ou publicação. Refazer login e repetir leituras autorizadas.

Reinício gracioso efetivamente validado: mesmo SQLite 44, integridade `ok`, execução versão 3 com 17 eventos, 1 execução, 1 imagem, 0 relatórios de QC final e 0 publicações. Três arquivos de mídia/voz/render mantiveram seus SHA-256. Snapshot preservado: `d6e55893bfab229c50a0b929b64f1b4c62611ee2a507b86cf087f535595eeaa1`.

Replay de `POST /content-operations/campaign-executions/local` com o corpo original após reinício retornou HTTP 201, mesmos IDs e snapshot inalterado. Isso comprova persistência do estado FAILED e idempotência do agendamento. Não comprova persistência/idempotência de publicação concluída, pois nenhuma ocorreu.

## 10. Recuperação conservadora

Após interrupção, primeiro consultar `status`, logs, histórico e estado persistido. Tratar HTTP indisponível, sessão expirada, conflito, FAILED e `WAITING_RECONCILIATION` como situações distintas. Um erro de transporte não autoriza repetir um efeito externo.

O proxy Vite tem timeout de 5000 ms. Foram observados quatro `socket hang up` durante avanço longo; isso não demonstra que o backend cancelou a etapa. Consultar a execução antes de qualquer nova ação. O frontend/configuração Vite permaneceram somente leitura.

Para o caso atual, preservar `FAILED/ALIGNMENT_TEXT_DIVERGENT`; `retrySafe=false` impede tratar a falha como simples retomada segura. Não editar estado, eventos, hashes ou gates; não descartar o áudio já registrado e não recriar aprovação. Reiniciar o runtime apenas reabre a mesma base; não corrige divergência de áudio.

Gravação própria/licenciada é um mecanismo formal geral: no estado permitido, antes de AUDIO concluído, console → modo `RECORDING` → multipart `/operations/executions/<id>/audio`, campo `audio` WAV PCM 24 kHz/mono/16 bits até 20 MiB e campos `usageBasis`, `commercialUseAllowed`, `statement` reais. Entretanto o ramo `LOCAL_IMAGES` atual chama `automaticAudio()` incondicionalmente e ignora `RECORDING`; não há fallback funcional direto para esta campanha. Alterar apenas o DTO ou agendar nova tentativa repetiria o problema. Correção de produção está fora da allowlist desta task.

## 11. Backup consistente

```powershell
node scripts/ops-local/cli.mjs backup --root $pilotRoot
```

A CLI usa `node:sqlite backup` com origem somente leitura, destino exclusivo em `backups` e validação de schema 44/integridade. Um backup online real foi criado e validado neste piloto; os testes focados também exercitam backup com WAL ativo. Não copiar manualmente `.sqlite`, `-wal` e `-shm` enquanto houver conexões ativas.

O comando cobre o banco, não arquiva mídia, configuração ou identidade QC. Para preservar o conjunto completo, encerrar graciosamente o piloto, manter as mídias imutáveis e seus hashes e guardar configuração/evidências em armazenamento privado autorizado. A CLI não implementa restauração; não sobrescrever o piloto nem trocar seu banco por um backup como recuperação automática.

## 12. Encerramento seguro

Usar exclusivamente `stop --root <root>` para os wrappers desta entrega. Ele grava uma solicitação com root/UUID/token de controle; o wrapper correspondente chama `app.close()` ou `vite.close()` e registra seu encerramento. Não depende de `process.kill(SIGTERM)` no Windows e não envia sinal de encerramento a PIDs.

Os registros por início são preservados. Se houver `GRACEFUL_STOP_TIMEOUT`, `START_ROLLBACK_INCOMPLETE`, `LIFECYCLE_BUSY` ou worker `unverified`, inspecionar evidências e identidade do processo; não matar ocupantes de porta, apagar locks ativos, mover bancos ou limpar diretórios para esconder o problema. O rollback de início parcial usa o mesmo protocolo gracioso. Não criar tarefa agendada ou inicialização automática do Windows.

## 13. Limitações e resultado operacional

- `OPS_LOCAL_PASS=NO`: a campanha não concluiu alinhamento, composição, legendas, render, QC final, aprovação exata ou publicação FAKE.
- Fonte `LOCAL_IMAGES` ignora a opção de gravação; defeito identificado por leitura de produção, preservada sem alterações.
- Timeout do proxy pode interromper a resposta de uma mutação longa; não houve alteração de contrato para contorná-lo.
- Recursos e licença eSpeak foram utilizados para teste isolado; o áudio real falhou na validação textual. O recurso Piper anterior é Linux e não foi usado nesta execução nativa.
- Persistência/replay de FAILED foram comprovados; recuperação de campanha interrompida com efeito externo e idempotência de publicação continuam não comprovadas.
- Sessão QC é temporária e local; o proxy Vite é de desenvolvimento. A CLI não instala dependências, não faz build automaticamente nem restaura backup.
- Nenhuma chamada paga, publicação LIVE, conta social real, mudança Docker/VHDX ou alteração de banco operacional existente foi executada. Custos computacionais locais não foram medidos.

## 14. Próximas melhorias e fechamento

Tratar a seleção de áudio em `LOCAL_IMAGES` em tarefa de produção autorizada, com TDD preservando direitos, vínculo/hash de roteiro e QC. Avaliar o timeout do proxy em escopo frontend autorizado. Depois das correções, reproduzir em piloto novo e comprovar o ciclo FAKE completo, aprovação humana legítima, persistência e ausência de publicação duplicada após reinício. Não habilitar schedulers ou LIVE como parte dessas correções.

Resultados dos gates finais:

| Verificação | Resultado |
| --- | --- |
| Testes focados dos scripts operacionais | 11 PASS; sintaxe dos quatro `.mjs` PASS |
| Suíte unitária backend | 1676 PASS, 1 SKIP; 147 arquivos aprovados e 1 ignorado |
| Suíte E2E | 116 PASS, 26 arquivos |
| Testes da raiz | 47 PASS, 1 FAIL; teste existente de Compose não conseguiu executar `docker compose ... config` |
| Testes Python aplicáveis | 8 PASS |
| Build | PASS, executado pelo `npm test` da raiz antes dos testes Node |
| Lint | PASS: 0 erros, 8 avisos preexistentes |
| `git diff --check` / revisão de allowlist | PASS para os cinco arquivos novos deste tópico; nenhuma alteração de produção |
| Leitura/UI autorizada após novo login pós-reinício | Console autenticado com a campanha preservada; quatro GETs/React completo não revalidados após interrupção da proteção de URL do navegador |

Uma primeira execução unitária com temporários em D: apresentou quatro falhas em casos SQLite de 5–8 s e foi encerrada somente nos processos daquele job. Os mesmos dois arquivos passaram em 31/31 casos com temporários pequenos e descartáveis no volume padrão do Windows, mantendo dois workers, timeouts e assertions. A suíte padrão foi reexecutada nesse ambiente; seus resultados finais constam na tabela. Piloto, modelos, mídias, logs e backups continuam em D:; nenhum teste ou código de produção foi alterado.

O gate da raiz executou o teste existente `test/docker-runtime.test.js`, que tenta consultar a configuração Compose. Essa chamada deveria ter sido identificada antes da execução, pois `docker compose` estava explicitamente fora do escopo. Ela falhou com `unknown shorthand flag: 'f' in -f` (exit 125), sem iniciar/parar containers ou alterar configuração, volumes ou VHDX. Não houve nova tentativa, instalação de plugin ou alteração do teste para fazê-lo passar. O gate global da raiz permanece FAIL; a PR deve permanecer Draft. Logs completos e resultados de cada job ficam no diretório privado `quality-native-temp` do tópico.

Entrega funcional deste tópico: quatro scripts/testes em `scripts/ops-local/` e este documento. Fechamento autorizado em Draft PR contra `main`, após gates/revisão, somente na branch da entrega. Registrar URL e SHAs no relatório final; não realizar merge. A utilidade dos scripts de lifecycle não altera o resultado operacional parcial registrado acima.
