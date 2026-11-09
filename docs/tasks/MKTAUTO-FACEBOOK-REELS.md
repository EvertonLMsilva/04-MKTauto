# Facebook Reels — Publishing multirrede e schema 43

## Entrega e arquitetura

A migration 043 adiciona reservas multirrede; o motor continua sendo
SocialPublicationService. DestinationPublicationService coordena a distribuição
explícita de um render existente, com os contratos públicos de Content
Operations e Finance. Nenhum pipeline de produção ou timer foi adicionado.

Publishing é proprietário das operações, reservas, aprovações comerciais e
recibos. Notifications recebe os fatos normalizados pelo PublishingOperationsPort;
seus adapters Telegram e Discord permanecem inalterados.

## Schema e identidade

043_multi_network_publication_reservations.sql adiciona uma tabela de reservas
com execução, rede, conta, destino canônico, campanha, artefato, operação, pacote,
revisão aprovada e timestamp. Estado, sessão, tentativas, eventos e recibos ficam
no ledger social existente, sem uma segunda cópia desses registros.

Há unicidade por execução/rede/conta e por campanha/artefato/rede/conta. Triggers
vinculam pacote, rede, conta, execução/run, artefato e revisão aprovada, impedem
mutações das reservas e verificam duplicidade entre reservas Instagram históricas
e novas em ambas as direções. A verificação de operações históricas sem reserva
também ocorre sob BEGIN IMMEDIATE no repository.

Reservas Instagram antigas são consultadas junto das novas, sem backfill,
renomeação de IDs ou alteração das migrations 001–042. Contas Facebook novas usam
facebook_reels:<PageID> no ledger; o adapter traduz para o PageID numérico.
Isso separa o índice de IDs remotos por rede sem mudar os identificadores
Instagram históricos. A aprovação do pacote Facebook continua usando o PageID
numérico, sua própria legenda, identidade de render/QC e hash.

O provisionamento explícito cria bancos até 43 e atualiza 42 para 43 em uma
transação. Reexecução é idempotente; falhas revertem DDL, histórico e user_version.
Sessões de aplicação não executam migrations. Não aplicar este upgrade em LIVE
como parte desta entrega.

## Finance e compatibilidade

FinanceSchemaCompatibility centraliza as versões explícitas 39–43 e a
habilitação dos ajustes a partir de 40. Versões futuras continuam rejeitadas.
Os demais adapters SQLite necessários ao bootstrap aceitam 43, conservando
as versões históricas e checks existentes.

Os limites de US$ 1/dia e US$ 20/mês, precisão de 18 casas, ajustes, evidências,
reconciliação, idempotência e tratamento de UNKNOWN permanecem intactos. O
coordenador consulta Finance por seu contrato público e bloqueia uma fonte com
estado UNKNOWN. Recibos de publicação informam custo UNKNOWN, nunca zero.

## Configuração e aprovação

Variáveis futuras, exclusivamente em configuração privada:

- FACEBOOK_PUBLICATION_MODE=live;
- FACEBOOK_PAGE_ID (página de referência Kate: 1355505384315575);
- FACEBOOK_API_VERSION (versão Graph explicitamente configurada);
- FACEBOOK_PAGE_ACCESS_TOKEN;
- FACEBOOK_APP_ACCESS_TOKEN, para inspecionar validade/escopos do Page Token;
- FACEBOOK_LIVE_POSTS_ENABLED=false por padrão.

A ausência do modo desabilita o adapter. Testes injetam portas em modo fake com
fetch simulado; não existe fallback de LIVE para fake. Antes de efeitos remotos,
o adapter confirma a página por /me e verifica token PAGE válido e o escopo
pages_manage_posts por debug_token. Tokens e respostas brutas não são persistidos
em operações ou erros. Permissões Instagram não são usadas como autorização
Facebook.

Preparar o pacote pelo serviço/API de pacotes existente, com platform=facebook,
conta da página e a identidade exata do mesmo render/QC. Revisar esse pacote pelo
serviço de revisão existente. Aprovação Instagram não libera Facebook. Mudança
de legenda, conta ou artefato exige revisão própria; revogação bloqueia novos
efeitos. Adicionar um pacote não agenda nem publica automaticamente.

## API e transporte

Rotas novas, protegidas pelo guard existente de identidade do revisor:

- GET /publishing/executions/:id/destinations: operações e recibos das redes,
  incluindo reservas Instagram históricas; não exige hashes manuais;
- POST /publishing/executions/:id/facebook-reels, body com accountId:
  distribui explicitamente o pacote Facebook aprovado daquela execução/conta.

Sessão, upload local binário, consulta de status, finalização e leitura do
recibo usam FacebookReelsAdapter. A URL de upload vem da resposta oficial e é
validada contra host, versão e video_id; não é inventada nem aceita redirects.
O MP4 é lido pelo contrato público de Media e verificado por hash. Antes do
primeiro POST, ffprobe confirma MP4/H.264, áudio AAC quando presente, 9:16,
resolução mínima 540x960, frame rate mínimo 23 e duração de 4–60 segundos.
O perfil é conservador e deve ser homologado na versão Graph selecionada.

Upload confirmado não é publicação confirmada. A finalização só ocorre após
processamento confirmado; a resposta success da finalização não basta para
notificar. O recibo exige leitura remota do mesmo video_id com publicação
concluída, timestamp válido e permalink validado quando disponível.

## Recuperação e concorrência

Cada efeito tem intenção persistida antes da chamada HTTP e nenhuma transação
SQLite fica aberta durante a rede. Timeout ou perda do processo deixam o
resultado incerto: o fluxo consulta status sem repetir automaticamente o POST.
Sessões confirmadas e upload reconhecido são reutilizados após restart.
Resultado de criação incerto sem video_id não cria uma sessão substituta.

Publicação com recibo confirmado retorna o mesmo recibo. Falha Facebook não
repete nem remove Instagram. As transições com versão do ledger e as reservas
únicas protegem concorrência. Reconciliação é feita pelos GETs do mesmo motor;
uma nova chamada explícita ao endpoint retoma somente etapas seguramente
confirmadas, sem autorização para refazer efeitos incertos.

## Validação e homologação

Testes usam SQLite temporário com foreign keys ativas, Page API simulada,
perfil Media simulado no E2E e bytes de fixture de contêiner MP4; nenhum codec ou
vídeo de produção é regenerado. O perfil físico tem testes próprios de rejeição.
O E2E Nest/HTTP exercita aprovação independente, duas publicações, dois recibos,
fan-out de Notifications e restart sem novas submissões. Regressões cobrem
Finance, limites, UNKNOWN, ajustes, histórico Instagram e endpoints existentes.

Referências oficiais consultadas:

- [Sessão Reel](https://www.postman.com/meta/facebook/request/rgkn91u/1-create-reel)
- [Upload local](https://www.postman.com/meta/facebook/request/ps1ahe4/2-a-upload-local-reel)
- [Status](https://www.postman.com/meta/facebook/request/dtugkus/3-optional-get-upload-session-status)
- [Finalização](https://www.postman.com/meta/facebook/request/juhnm3q/4-publish-reel)

A entrega valida o fluxo offline. Homologação LIVE futura exige autorização
explícita, backup/upgrade administrativo do banco, confirmação da página e dos
escopos, MP4 real autorizado, revisão comercial por rede e confirmação dos
estados retornados pela versão Graph configurada. Nenhuma publicação, upload
externo, pagamento, banco LIVE/principal ou container LIVE foi acionado aqui.
Nenhuma chamada paga; custo computacional local não medido.

Débito técnico fora desta mudança: FalFinanceService mantém uma referência de
tipo ao repository de infraestrutura, anterior à migração; os contratos sociais
legados ainda usam any e nomes de ports específicos de Instagram para funções
compartilhadas. Não foram reescritos BCs ou contratos históricos para corrigir
esses pontos.
