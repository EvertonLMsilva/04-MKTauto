# Alertas operacionais — Telegram e Discord somente de saída

## Arquitetura e alcance

`OperationalNotificationPort` separa a aplicação dos adapters Telegram, Discord, Null e Fake. `OperationalAlertsService` lê transições confirmadas nos eventos de campanha e Publishing, registra a intenção e só então chama cada adapter fora da transação. O fan-out é uma composição mínima de portas no mesmo dispatcher/event store; não existe segundo subsistema ou ledger de notificações. Controllers, repositories e domínio não fazem chamadas de transporte.

Após as correções DDD V1/V2, `CampaignOperationsPort` fornece execução, estado, estágio de aprovação e auditoria; `PublishingOperationsPort` fornece pacote/revisão, aprovação vigente, reconciliação, destino/rede e recibo. A seleção de alertas fica na Application de Notifications, dependente de portas. Seu repository compõe contratos públicos, sem SQL ou imports da infraestrutura interna dos outros BCs. Content Operations mantém a verificação da identidade, a revalidação síncrona e a gravação de ATTEMPTED na mesma transação `BEGIN IMMEDIATE`; o commit antecede qualquer envio HTTP. Os readers dos BCs usam o mesmo banco, protegido contra escritas concorrentes durante essa revalidação. Eventos, chaves, baselines e recibos históricos são preservados, sem migration.

Os canais habilitados são processados independentemente, com baseline, intenção e recibo próprios. Falha de transporte/configuração em um canal não impede tentativa no outro. O processamento paralelo espera os resultados de ambos, sem propagar falhas para a campanha.

O serviço é integrado ao módulo NestJS, ao processamento existente de campanhas, às mutações de pacote/confirmação manual e às operações de publicação/recibo Instagram. Não há novo timer, segundo scheduler, endpoint inbound, webhook receptor no MKTauto, Gateway Discord, bot conversacional ou comando administrativo. Consultas, healthchecks, polling sem transição e sucessos de etapas internas não geram alertas.

Mensagens orientam o operador a usar o MKTauto. Não aprovam render/pacote, não publicam, não reconciliam e não alteram credenciais ou regras comerciais. Nenhum dos canais concede permissões.

## Alertas MVP

| Tipo | Fonte persistida e ação |
|---|---|
| RENDER_READY_FOR_REVIEW | WAITING_INPUT por aprovação exata, com render/QC/preview persistidos; revisar e aprovar no MKTauto |
| PACKAGE_READY_FOR_REVIEW | Aprovação do render exato e pacote/legenda persistidos, ainda sem revisão do pacote; revisar o destino e a versão exata |
| PUBLICATION_SUCCEEDED | Operação PUBLISHED com recibo remoto coincidente e sem reconciliação pendente, ou confirmação manual PUBLISHED; inclui permalink HTTPS quando válido |
| OPERATION_FAILED | Falha terminal confirmada; apresenta etapa e classificação pública permitida, nunca texto bruto do provider |
| NO_ELIGIBLE_PRODUCT | WAITING_INPUT com CATALOG_PRODUCT_REQUIRED; revisar catálogo/link/evidências/imagem |
| PUBLICATION_UNCERTAIN | Estado remoto incerto ou espera de reconciliação na publicação; **Não reenviar manualmente; reconciliação necessária.** |
| AUTH_CONFIGURATION_REQUIRED | Códigos estruturados de autenticação, permissão ou configuração Meta; revisar no MKTauto |

Os textos incluem campanha, produto e data de produção; pacote/publicação também incluem destino. Não é necessário copiar hashes ou IDs de render para executar a revisão. O produto vem do briefing/seleção congelados; na ausência de elegível, informa que não há produto definido. A confirmação oficial em modo fake é marcada SIMULAÇÃO. Links enviados são permalinks HTTPS normalizados, sem credenciais, porta não padrão, query string ou fragmento; hosts locais/IPs e caminhos fora do formato permitido são rejeitados. Destino/rede vêm dos fatos públicos de Publishing, com cobertura de rede fictícia e sem implementação de Facebook. Nomes são limitados/redigidos; mensagens não carregam stack traces, bodies de erro, links afiliados, tokens nem configuração privada.

## Idempotência, tentativa e falhas

Reutiliza `campaign_execution_events`; nenhuma migration ou tabela foi criada. Eventos operacionais guardam kind, identidade/hash da fonte, chave lógica, destino pseudonimizado por SHA-256, status, message ID ou erro classificado. Destinos usam namespaces telegram: e discord:. A identidade Discord deriva do ID do webhook, mantendo os recibos quando seu token é rotacionado. Token, chat ID e URL privada do webhook não são gravados nesses eventos. Eventos de notificação não alteram status, versão, claim, updated_at, recorrência ou aprovações da execução.

A primeira ativação de cada destino registra um baseline do histórico existente: não envia um backlog de alertas antigos. Reinícios seguintes usam esse baseline persistido. Cada intenção é exclusiva por ocorrência, tipo, fonte lógica e destino/canal. Telegram entregue não impede Discord para uma transição elegível em ambos; falha Telegram não reenvia um Discord já entregue, e vice-versa. Datas/campanhas diferentes são independentes; polling, replay e novo recibo da mesma publicação não consomem uma nova intenção. Duas instâncias disputam a intenção sob BEGIN IMMEDIATE, antes do POST.

O MVP faz **uma tentativa por transição/destino**, sem retry automático, inclusive após HTTP 500. ATTEMPTED é gravado antes da rede; em seguida vem DELIVERED, FAILED ou UNCERTAIN. Se o processo cair entre a intenção e a confirmação, após 30 segundos a intenção sem resultado recebe UNCERTAIN/NOTIFICATION_PROCESS_INTERRUPTED, sem novo POST. Isso prioriza no máximo um envio: uma queda pode perder um alerta, mas nunca libera publicação nem finge confirmação. Não se promete entrega garantida/exatamente uma vez: os serviços externos não participam da transação SQLite.

Falha, timeout ou erro de um canal não desfazem nem interrompem a transição da campanha nem cancelam a entrega no outro. Não há repetição indefinida. O estado real continua disponível no MKTauto; o histórico pode ser consultado pelo endpoint existente `/content-operations/campaign-executions/:id/history`, filtrando eventos OPERATIONAL_NOTIFICATION_*. Essa consulta não dispara mensagens.

## Criação e configuração humanas

### Telegram

1. Criar um bot pelo [@BotFather e procedimento oficial](https://core.telegram.org/bots/features#creating-a-new-bot), usando `/newbot`, e guardar o token privadamente. O MKTauto não cria bots.
2. Abrir uma conversa privada com o bot e enviar `/start`.
3. Obter o `message.chat.id` dessa conversa com uma consulta pontual oficial a [getUpdates](https://core.telegram.org/bots/api#getupdates), usando timeout 0 ou ferramenta oficial equivalente. Não deixar polling rodando nem configurar webhook. Não colar a URL com token em logs, histórico compartilhado ou capturas. getUpdates não funciona enquanto houver webhook ativo; não reutilizar automaticamente um bot de outro serviço.
4. Salvar os valores somente no arquivo privado efetivamente usado pelo Compose: `private/kate-mkt/instagram-live/docker-runtime.env`, ou no arquivo indicado por MKTAUTO_RUNTIME_ENV. O `runtime.env` de outro processo não é carregado automaticamente por esse Compose.

```dotenv
OPERATIONAL_NOTIFICATIONS_ENABLED=true
TELEGRAM_BOT_TOKEN=<token privado obtido pelo usuário>
TELEGRAM_CHAT_ID=<chat_id numérico privado da conversa>
```

Os placeholders não são credenciais válidas. Não versionar o arquivo, token ou chat ID. Não acrescentar defaults públicos em `environment:` que sobrescrevam o env_file privado. O Compose existente já injeta o arquivo completo; não foi necessário alterar Dockerfile/Compose, mídia ou modelos.

O adapter usa a [Bot API oficial/sendMessage](https://core.telegram.org/bots/api#sendmessage), POST HTTPS com chat_id/text, timeout de cinco segundos e sem recursos pagos/allow_paid_broadcast. Não loga URL com token nem resposta bruta. Configuração ausente usa Null e registra OPERATIONAL_NOTIFICATIONS_DISABLED. Enabled=true com credenciais ausentes/inválidas desabilita explicitamente com OPERATIONAL_NOTIFICATIONS_CONFIGURATION_REQUIRED; não usa bot/chat fake em LIVE. Problema de banco desabilita o dispatcher com erro operacional genérico e preserva a inicialização do app.

### Discord Incoming Webhook

Criar manualmente um webhook em um canal de texto, pelas configurações do servidor → Integrações → Webhooks, escolher o canal e copiar sua URL conforme o [procedimento oficial Discord](https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks). Não criar bot, aplicação Gateway ou endpoint receptor no MKTauto. Salvar a URL somente no mesmo arquivo privado efetivamente carregado pelo Compose:

```dotenv
DISCORD_NOTIFICATIONS_ENABLED=true
DISCORD_WEBHOOK_URL=<URL privada do Incoming Webhook>
```

O [Execute Webhook oficial](https://docs.discord.com/developers/resources/webhook#execute-webhook) recebe POST com content e allowed_mentions.parse vazio, impedindo menções acidentais de produto/campanha. O adapter limita content a 2000 caracteres, usa HTTPS, timeout de cinco segundos, redirect:error e wait=true para obter o message ID. Não usa embeds, uploads, comandos ou recursos pagos. Resposta sem recibo válido fica UNCERTAIN; erros só expõem códigos DISCORD_*, nunca URL/token/body bruto.

O MVP aceita URLs padrão discord.com/api/webhooks/... e a variante com versão de API, para canal de texto. Não suporta parâmetros thread_id/thread_name de fóruns ou outros hosts/proxies. Discord desabilitado não exige URL. Habilitado com URL inválida/ausente usa Null com DISCORD_NOTIFICATIONS_CONFIGURATION_REQUIRED; Telegram continua funcionando. Nunca há fallback fake em LIVE.

### Seleção independente dos canais

OPERATIONAL_NOTIFICATIONS_ENABLED controla somente Telegram, preservando o nome existente. DISCORD_NOTIFICATIONS_ENABLED controla somente Discord; não depende do flag Telegram.

| Telegram | Discord | OPERATIONAL_NOTIFICATIONS_ENABLED | DISCORD_NOTIFICATIONS_ENABLED |
|---|---|---|---|
| Habilitado | Desabilitado | true | false |
| Desabilitado | Habilitado | false | true |
| Ambos | Ambos | true | true |
| Nenhum | Nenhum | false | false |

Com ambos desabilitados, o runtime continua normalmente sem chamadas. Não versionar token, chat ID, URL de webhook ou o arquivo privado. Não criar interpolação com defaults no Compose que sobrescreva esse env-file.

## Docker, ativação e desabilitação

Na primeira instalação do código, construir a imagem com o cache existente; os pesos continuam nos bind mounts, sem baixar/reconstruir modelos:

```powershell
docker compose -f compose.live.yml build mktauto
docker compose -f compose.live.yml up -d --no-deps mktauto
docker compose -f compose.live.yml ps
```

Após apenas mudar as variáveis privadas, basta `docker compose -f compose.live.yml up -d --no-deps mktauto`. Não usar down, limpeza de volumes ou reinício do Windows. Confirmar running/healthy e o log operacional, sem produzir campanha para testar canais. Para verificar presença das variáveis, imprimir apenas booleans; não usar docker inspect de todo Config.Env ou compose config completo, pois expõem segredos.

```powershell
docker compose -f compose.live.yml exec -T mktauto node -e "console.log(JSON.stringify({telegramEnabled:process.env.OPERATIONAL_NOTIFICATIONS_ENABLED==='true',tokenConfigured:!!process.env.TELEGRAM_BOT_TOKEN,chatConfigured:!!process.env.TELEGRAM_CHAT_ID,discordEnabled:process.env.DISCORD_NOTIFICATIONS_ENABLED==='true',webhookConfigured:!!process.env.DISCORD_WEBHOOK_URL}))"
```

Desabilitar Telegram: OPERATIONAL_NOTIFICATIONS_ENABLED=false. Desabilitar Discord: DISCORD_NOTIFICATIONS_ENABLED=false. Aplicar up -d após modificar o arquivo privado. Isso não pausa a recorrência nem muda aprovações/publicação. Não apagar histórico de notificações para tentar forçar replay.

## Diagnóstico e validação

TELEGRAM_AUTH_REQUIRED: conferir token/BotFather privadamente. TELEGRAM_DESTINATION_REJECTED: conferir chat ID, conversa iniciada e eventual bloqueio do bot. TELEGRAM_RATE_LIMIT/HTTP_ERROR: conferir disponibilidade/limites antes de um teste humano controlado. TELEGRAM_TIMEOUT/NETWORK_UNCERTAIN/RESPONSE_UNCERTAIN ou PROCESS_INTERRUPTED: entrega não confirmada, sem retry automático. Nunca usar logs de exceção contendo URL/token para investigar. Falhas do dispatcher geram somente códigos públicos e não fazem o pipeline falhar.

DISCORD_AUTH_REQUIRED/DESTINATION_REJECTED/WEBHOOK_UNAVAILABLE: conferir privadamente a integração, URL e canal no Discord. DISCORD_RATE_LIMIT/HTTP_ERROR: verificar disponibilidade/limites, sem retry automático. DISCORD_TIMEOUT/NETWORK_UNCERTAIN/RESPONSE_UNCERTAIN: entrega não confirmada; não reenviar automaticamente. A correção de um canal não apaga nem repete o recibo do outro.

Os testes usam SQLite temporário e transporte fake, sem banco LIVE, Telegram real, Meta real, modelos pesados ou mídia real. O E2E conserva os gates reais de aprovação exata, pacote e publicação Instagram fake: render → alerta → aprovação → pacote → alerta → aprovação → recibo → alerta de publicação; restart não duplica. São verificados timeout/HTTP 500, Null, campos privados, concorrência, destinos, campanhas/datas independentes e crash após intenção durável.

Na inspeção local de 08/11/2026, nenhuma credencial Telegram válida ou webhook Discord estava configurado nos arquivos privados verificados. Nenhuma mensagem real foi enviada e o runtime LIVE não foi recriado. USER_ACTION_REQUIRED: configurar os canais desejados no arquivo efetivamente carregado: token/chat ID e flag Telegram, URL privada e flag Discord. Após código e testes aprovados e configuração humana, o único teste real Discord autorizado por esta task é: “MKTauto: notificações Discord configuradas com sucesso.” Não enviar mensagens de campanha fake para validar o canal.

Validação local dos dois canais: 593 testes PASS em 54 arquivos de Notifications/Publishing/Content Operations/Affiliate, incluindo os 35 testes focados de notificações. E2E integrado PASS: render, pacote e publicação chegam uma vez a cada canal, com seis recibos DELIVERED e nenhum reenvio após restart. O E2E foi repetido após ajuste de tipagem do transporte fake. TypeScript/build PASS; lint PASS com somente os oito avisos preexistentes. Compose config --quiet e os dois testes Docker existentes passaram. Um container efêmero da imagem local, sem rede ou mounts de banco, recebeu as cinco variáveis por env-file com valores fictícios e imprimiu somente booleans; foi removido ao terminar. Esse smoke valida a injeção de ambiente, sem implantar o código novo em LIVE. Dockerfile, Compose, modelos e configuração privada permaneceram inalterados. Custo local de hardware/energia: UNKNOWN.

Diff do escopo/arquivos novos: PASS. O diff global conserva apenas o whitespace preexistente na migration 038, fora desta entrega. As 34 alterações locais protegidas permanecem idênticas por SHA-256. Sem banco LIVE nos testes, alteração de Finance, commit, push ou PR.
