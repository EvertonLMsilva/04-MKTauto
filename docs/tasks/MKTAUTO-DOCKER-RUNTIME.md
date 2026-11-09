# Runtime Docker local — Kate MKT

## Pré-requisitos e limites

Docker Desktop com engine Linux/WSL2, Compose com suporte a `env_file.format: raw`, diretórios privados existentes e Ollama do Windows com `gemma3:4b`. Executar os comandos na raiz do checkout. Não manter simultaneamente o runtime Node do Windows e o container sobre o LIVE.

A imagem usa Node 24, Python 3.12, FFmpeg/ffprobe e dois ambientes Python separados. CTC reutiliza `backend/python/alignment/requirements.lock`; Kokoro usa `docker/kokoro.lock`, extraído do ambiente aprovado. Pesos e credenciais não entram na imagem. Não usar venv Windows no Linux.

## Comandos

```powershell
docker compose -f compose.live.yml build
docker compose -f compose.live.yml up -d
docker compose -f compose.live.yml ps
docker compose -f compose.live.yml logs -f mktauto
docker compose -f compose.live.yml restart mktauto
docker compose -f compose.live.yml stop
```

O comando do container é `node backend/dist/main.js`, o bootstrap NestJS oficial. O healthcheck consulta somente `GET /` a cada 15 segundos. A API é exposta em `127.0.0.1:3123` (variável `MKTAUTO_PORT`). Logs têm rotação de três arquivos de 10 MB.

## Configuração e persistência

Compose recebe `.env` sem interpolar valores e o arquivo privado `private/kate-mkt/instagram-live/docker-runtime.env`. Nunca imprimir `docker compose config` completo: ele contém segredos. Para validar sintaxe, usar `config --quiet`.

| Windows (relativo ao projeto salvo indicação) | Container | Acesso |
|---|---|---|
| `private/kate-mkt/instagram-live` | `/data/live` | leitura/escrita |
| `private/kate-mkt/mvp01-nestjs-20261106/final/media` | `/data/media` | leitura |
| `private/kate-mkt/mvp02-daily-20261106/render` | `/data/render` | leitura/escrita |
| `private/kate-mkt/mvp02-daily-20261106/voice` | `/data/voice` | leitura/escrita |
| `private/kate-mkt/mvp02-daily-20261106/evidence` | `/data/evidence` | leitura/escrita |
| `%USERPROFILE%/.kate-tts/kokoro` | `/models/kokoro` | leitura |
| `D:/04-Projetos/MKTauto-runtime/p77-audio-closure/alignment-model` | `/models/alignment` | leitura |

Os arquivos privados de licença/configuração Kokoro são montados individualmente. O manifesto Linux deve preservar licença, modelo, voz, parâmetros e evidências aprovadas, adaptando caminhos e o hash do executável Python Linux. Seu hash é fixado no ambiente privado. Não substituir aprovações humanas.

`PROJECT_API_DATABASE` e `SOCIAL_HISTORY_DATABASE` apontam exclusivamente para `/data/live/kate-mkt-live.sqlite`. O diretório completo mantém SQLite/WAL/SHM juntos. Restart, recriação e rebuild não removem bind mounts. Nunca executar limpeza de volumes ou copiar a validação sobre o LIVE.

## Scheduler e publicação

`CAMPAIGN_SCHEDULER_ENABLED=true`; timezone `America/Sao_Paulo`. A campanha `kate_mkt_campaign_001` tem recorrência persistida às 10h. O scheduler não faz catch-up. Cada ocorrência exige suas próprias aprovações; publicação LIVE permanece desabilitada nesta configuração. Nenhuma configuração Docker concede autorização comercial.

## Validação isolada e atualização

Antes do primeiro LIVE e de alterações de imagem, usar backup consistente do SQLite em diretório privado separado. Na sessão PowerShell de validação:

```powershell
$env:MKTAUTO_LIVE_DIR = './private/kate-mkt/instagram-live/docker-validation'
$env:MKTAUTO_PORT = '3124'
docker compose -p mktauto-validation -f compose.live.yml up -d
docker compose -p mktauto-validation -f compose.live.yml restart mktauto
docker compose -p mktauto-validation -f compose.live.yml up -d --force-recreate
docker compose -p mktauto-validation -f compose.live.yml down
Remove-Item Env:MKTAUTO_LIVE_DIR, Env:MKTAUTO_PORT
```

Só iniciar com scheduler ativo quando a ocorrência do dia já estiver concluída e não houver trabalho pendente que possa produzir/publicar. Conferir execuções, eventos e recibos antes/depois. Não simular mudança de relógio. Testar Ollama `/api/tags` e inferência curta sem conteúdo comercial; carregar Kokoro e importar CTC sem gerar mídia.

Após validação, `build` seguido de `up -d --force-recreate` atualiza a imagem preservando os dados. Se o Python Linux mudar, revisar novamente o hash do executável no manifesto privado antes de retomar.

## Ollama, reboot e diagnóstico

`OLLAMA_BASE_URL` fica no ambiente privado. O endereço candidato é `http://host.docker.internal:11434`; só é considerado homologado após acesso real a partir do container. Não baixar modelo substituto nem modificar firewall automaticamente. Se inacessível, verificar Ollama ativo, bind e regras existentes.

`restart: unless-stopped` recupera o container quando o Docker reinicia, exceto se ele foi parado explicitamente. No Windows, habilitar **Start Docker Desktop when you sign in** em Settings → General. Isso depende do login do usuário; não constitui serviço garantido antes do login. Ollama também precisa estar ativo no host. Não foi criado serviço Windows ou tarefa agendada.

Nesta máquina, `AutoStart=false` foi observado nas configurações do Docker Desktop. A interação com a interface foi interrompida pelo usuário; essa opção não foi alterada. A recuperação após login permanece dependente de habilitá-la.

Falha no healthcheck: consultar logs, existência dos bind mounts, porta e configuração. Erro de licença/modelo: conferir hashes e mounts, sem enfraquecer validações. Erro SQLite: conferir caminho e ausência de outro runtime concorrente. Não alterar manualmente estados ou aprovações.

## Evidência desta entrega

TDD de configuração: dois testes falharam inicialmente pela ausência de Dockerfile/Compose e passaram após implementação. `docker compose config --quiet`: PASS. O contexto enviado ao build tinha aproximadamente 2 MB, sem bancos, modelos ou credenciais.

Ollama: `/api/tags` acessível de um container Linux pelo endereço configurado, com `gemma3:4b`; inferência curta retornou `OK` (3 tokens), sem conteúdo comercial. Nenhum modelo foi baixado. Custo local de hardware/energia: UNKNOWN.

Validação de 07/11/2026, encerrada aproximadamente às 21h48 (America/Sao_Paulo):

- Build Linux: PASS. Imagem `mktauto:local`, digest `sha256:83df2af0e5401a320993be4ee9d08edefbd7995aadb98c9d05cc711089cdaffa`.
- Verificador NestJS de licença/configuração Kokoro: PASS. Kokoro carregado com os pesos existentes, sem sintetizar áudio.
- Python/CTC: imports sob o limite existente de memória, hashes dos modelos e versões do ambiente verificados: PASS. Nenhum peso baixado.
- FFmpeg e ffprobe 5.1.9 disponíveis; timezone observada `America/Sao_Paulo`.
- Cópia isolada: HEALTHY, HTTP 200; restart e force-recreate preservaram integralmente 2 execuções, 60 eventos de campanha e 21 eventos de publicação. O comparador serializa os registros SQLite para ignorar apenas diferenças de protótipo JavaScript, mantendo todos os campos. Container/rede de validação removidos; backup privado preservado.
- LIVE: HEALTHY, HTTP 200, scheduler habilitado e recorrência revisão 1, `enabled=true`, às 10h. Mesmos registros e recibos do baseline, sem novas execuções/aprovações/publicações.
- Próxima data elegível na verificação: 08/11/2026 às 10h (13h UTC), sem simulação de relógio ou produção futura.
- Container LIVE permanece ativo com `restart: unless-stopped`; publicação permanece desabilitada.

Pendência operacional: Docker Desktop ainda está com início no login desabilitado. Portanto a recuperação automática após reboot/login do Windows não foi concluída nem testada. Não houve commit, push, PR, alteração de regras de negócio ou chamada Meta.

## Checkpoint MKTAUTO-DOCKER-AUTOSTART-CLOSURE — 07/11/2026

- Configuração persistida do Docker Desktop (`%APPDATA%/Docker/settings-store.json`): `AutoStart=false`. Nenhuma configuração foi alterada; o início no login continua pendente.
- `docker compose -f compose.live.yml ps`: serviço `mktauto` running/healthy, imagem com o mesmo digest da validação acima, política `unless-stopped`; API HTTP 200 em `127.0.0.1:3123`.
- Scheduler habilitado no ambiente, bootstrap NestJS concluído, sem erros de `CampaignAdministration` nos logs dos últimos dez minutos. A inicialização existente instala o polling de um segundo quando habilitado.
- Consulta somente leitura ao SQLite LIVE montado em `/data/live/kate-mkt-live.sqlite`: 2 execuções concluídas, 60 eventos de campanha e 21 eventos de publicação, iguais ao baseline anterior. Recorrência persistida revisão 1, `enabled=true`, diariamente às 10h em `America/Sao_Paulo`. Nenhuma nova execução observada.
- Reinício do Docker Desktop não realizado: `go-postgres-1`, de outro projeto, estava ativo e saudável. Não há evidência de que sua interrupção seria segura. Windows não foi reiniciado; recuperação após reinício do Desktop e após login não foi homologada nesta etapa.
- Checkpoint restrito a `Dockerfile`, `.dockerignore`, `compose.live.yml`, `docker/kokoro.lock`, `test/docker-runtime.test.js` e este documento. Os arquivos de build referenciados já são rastreados; alterações locais de narração/formatação não são incluídas nem exigidas pela configuração Docker. A imagem LIVE foi construída com o checkout local; não foi feito novo build exclusivo de HEAD nesta etapa.
- Testes focados de Docker: 2/2 PASS; Compose `config --quiet`: PASS. Sem geração de mídia, chamada Meta, publicação, acesso ao banco principal, alteração de recorrência/aprovações, push ou PR.
