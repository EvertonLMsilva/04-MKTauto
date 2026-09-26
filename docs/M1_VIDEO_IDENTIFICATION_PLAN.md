# M1 — plano de identificação de vídeos

## Objetivo e limite

M1 recebe **um upload local por item**, comprova sua identidade técnica e reúne
a declaração de origem/direitos antes de liberar qualquer processamento de
conteúdo. Sua única saída aceita pelo M2 é um `VideoAssetManifest` válido no
estado `READY_FOR_TRANSCRIPTION`.

M1 não interpreta o assunto do vídeo, não transcreve, não cria roteiro e não
edita. A IA não é necessária neste módulo: identidade, limites, direitos,
estados e deduplicação são regras determinísticas com revisão humana.

## Decisões de desenho

### Entrada e armazenamento

O menor fluxo seguro é uma criação em duas etapas:

1. `POST /api/video-assets` recebe metadados sanitizados e a declaração de
   origem/condição de uso, cria o item e devolve ID e endpoint de upload;
2. `PUT /api/video-assets/:id/content` recebe somente o corpo binário e o grava
   em streaming em um arquivo temporário privado.

Isso evita carregar o vídeo em memória e dispensa parser multipart no primeiro
corte. O nome fornecido pelo usuário é apenas metadado; o nome físico é um ID
gerado pelo sistema. O arquivo temporário usa sufixo `.part`, fica fora de
`public/` e do Git e só é promovido atomicamente após validação.

Os limites são configuráveis. Tamanho é conferido no cabeçalho, quando presente,
e durante o streaming. O servidor nunca aceita caminho enviado pelo cliente nem
expõe caminho absoluto na resposta.

### Identidade, duplicação e direitos

SHA-256 é calculado durante a gravação e identifica o conteúdo binário. Um hash
já conhecido não cria outro ativo silenciosamente: a API retorna conflito com o
ID existente. Reutilização explícita e múltiplas declarações para o mesmo ativo
podem ser adicionadas depois, se o uso real exigir; direitos nunca são herdados
automaticamente de outro envio.

A declaração usa `OWN`, `LICENSED` ou `AUTHORIZED`, com origem e referência de
prova obrigatórias conforme a opção. A referência aponta para evidência mantida
fora do Git e não contém o documento privado. Somente revisão humana pode marcar
o item como verde. Popularidade, autoria de roteiro novo ou uso de um trecho não
substituem licença/autorização.

### Inspeção técnica

Validação combina assinatura do arquivo, MIME declarado, extensão apenas como
sinal auxiliar e `ffprobe` invocado sem shell, com timeout e saída limitada. O
manifesto normaliza contêiner, codecs, duração, dimensões, FPS e presença de
áudio. Arquivo corrompido, sem stream de vídeo, fora dos limites ou incompatível
com a allowlist é rejeitado e não avança.

Antivírus e transcodificação de normalização ficam adiados. O MVP reduz o risco
mantendo staging privado, não executável e não servido; essa decisão deve ser
revista antes de aceitar uploads de usuários não confiáveis pela internet.

## Contrato de saída

`VideoAssetManifest` é versionado e contém somente dados sanitizados:

- `schemaVersion`, `assetId`, `sha256`, `byteSize` e referência opaca privada;
- MIME detectado, contêiner, codecs, duração, largura, altura, FPS e áudio;
- nome original sanitizado apenas para exibição;
- origem declarada, condição de uso, referência de prova e revisão humana;
- estado, alertas/códigos de erro e timestamps relevantes;
- versão das regras e da ferramenta de inspeção usadas.

O manifesto não contém caminho absoluto, mídia, prova privada, segredo, prompt
ou texto extraído do vídeo.

## Estados e transições

```text
CREATED -> UPLOADING -> UPLOADED -> VALIDATING
                                      |       |
                                      |       -> VALIDATION_FAILED
                                      v
                              AWAITING_RIGHTS_REVIEW
                                  |           |
                                  |           -> REJECTED
                                  v
                         READY_FOR_TRANSCRIPTION

UPLOADING -> UPLOAD_FAILED
```

- reenvio só é aceito após `UPLOAD_FAILED`, antes de existir conteúdo válido;
- validação repetida com o mesmo hash e versão de regras é idempotente;
- mudança na declaração ou prova invalida a revisão anterior;
- `REJECTED` e `READY_FOR_TRANSCRIPTION` não mudam sem uma nova versão auditada;
- somente `READY_FOR_TRANSCRIPTION` satisfaz o contrato de entrada do M2.

## Divisão de R02

Cada fatia abaixo é um tópico e um PR. A ordem reduz risco sem criar arquitetura
de fila ou processamento criativo antecipado.

| ID | Tópico | Entrega observável | Depende de |
|---|---|---|---|
| R02A | Contrato, estados e limites | Schema versionado, transições, códigos de erro, configuração e testes de domínio definem o M1 sem receber mídia. | V05 |
| R02B | Upload privado em streaming | Criação em duas etapas grava um arquivo `.part` privado, aplica limite durante o stream e bloqueia caminho/sobrescrita/exposição pública. | R02A |
| R02C | Identidade e inspeção técnica | SHA-256, assinatura e `ffprobe` produzem metadados normalizados; inválidos são descartados com motivo estável. | R02B |
| R02D | Persistência, deduplicação e recuperação | SQLite preserva manifesto, auditoria e idempotência; duplicatas, retries e resíduos parciais têm comportamento testado. | R02C |
| R02E | Origem, direitos e revisão | Declaração, referência externa de prova e decisão humana determinística controlam o gate verde. | R02D |
| R02F | Integração e prova ponta a ponta | Interface local envia um vídeo, mostra progresso/estado, registra métricas sanitizadas e entrega manifesto aprovado ao limite do M2. | R02E |

### R02A — contrato, estados e limites

- criar tipos/validadores de `VideoAssetManifest`, declaração e erros;
- implementar a máquina de estados e invariantes sem I/O de mídia;
- definir allowlist e limites por configuração, com defaults documentados;
- testar transições válidas, rejeições, revisão invalidada e sanitização;
- registrar ameaça e política de retenção mínima do staging.

Aceite: o domínio rejeita qualquer tentativa de chegar a
`READY_FOR_TRANSCRIPTION` sem validação técnica e revisão humana verdes.

### R02B — upload privado em streaming

- criar item e receber corpo binário sem buffer integral;
- gerar referência opaca e nome físico interno;
- limitar bytes no preflight e no streaming;
- remover parcial em cancelamento/falha e impedir traversal/sobrescrita;
- garantir que a mídia não seja servida por rota pública.

Aceite: upload válido termina em `UPLOADED`; arquivo grande, interrompido ou
malicioso termina em estado de falha sem resíduo utilizável.

### R02C — identidade e inspeção técnica

- calcular SHA-256 durante o stream e comparar sinais do formato;
- executar `ffprobe` com argumentos fixos, timeout e limite de saída;
- normalizar metadados e aplicar allowlist/limites;
- promover atomicamente somente o arquivo tecnicamente válido;
- usar fixtures mínimas próprias/licenciadas fora do Git ou geradas em teste.

Aceite: o mesmo arquivo gera a mesma identidade e metadados; corrupção e formato
incompatível produzem códigos reproduzíveis.

### R02D — persistência, deduplicação e recuperação

- adicionar persistência SQLite específica de ativos e eventos;
- tratar hash repetido como conflito explícito, sem herdar direitos;
- tornar criação, upload e validação idempotentes onde o contrato permitir;
- recuperar estado consistente após reinício e limpar temporários órfãos;
- não acoplar o novo domínio ao JSON de runs da descoberta.

Aceite: retries não duplicam ativo nem eventos de transição e reinício não perde
o manifesto aceito.

### R02E — origem, direitos e revisão

- validar declaração `OWN`, `LICENSED` ou `AUTHORIZED`;
- guardar apenas referência sanitizada à prova externa;
- reutilizar o padrão atual de revisão humana sem copiar o modelo de descoberta;
- bloquear avanço enquanto a revisão estiver pendente ou rejeitada;
- auditar ator, decisão, motivo e timestamp sem armazenar prova privada.

Aceite: nenhuma regra ou agente marca direitos verdes automaticamente.

### R02F — integração e prova ponta a ponta

- adicionar seletor de arquivo, declaração, progresso, erros e revisão local;
- exibir somente manifesto e estado sanitizados;
- medir espera, processamento, falhas e retrabalho, sem conteúdo privado em log;
- provar um vídeo válido, uma duplicata, um inválido e direitos pendentes;
- disponibilizar ao M2 somente ID e manifesto em `READY_FOR_TRANSCRIPTION`.

Aceite: um operador conclui o M1 de forma reproduzível e o limite com M2 é
demonstrado sem iniciar transcrição.

## Reuso e preservações

- reutilizar o padrão de SQLite de `src/store.js`, mas com tabelas e métodos de
  ativos próprios;
- reutilizar validação e testes de contratos de `src/domain/contracts.js` sem
  misturar o schema de descoberta com o de mídia;
- reutilizar o padrão de revisão humana de `RunStore`, adaptado às transições de
  direitos do ativo;
- reutilizar o servidor HTTP atual apenas enquanto streaming, limites e limpeza
  puderem ser implementados com segurança;
- não usar os adapters de YouTube/Wikimedia para baixar o arquivo do M1;
- não introduzir agentes de IA no M1, pois não há subproblema criativo ou
  probabilístico que justifique custo e risco adicionais.

## Riscos residuais e gatilhos de mudança

- uploads externos não confiáveis exigirão antivírus, isolamento adicional,
  autenticação forte e quotas antes de exposição pública;
- fila/jobs só entram se R02F demonstrar bloqueio, concorrência ou recuperação
  incompatíveis com o fluxo síncrono;
- object storage só entra quando execução remota, volume ou retenção tornarem o
  disco local insuficiente;
- múltiplos vídeos, react e composição continuam pós-MVP e não alteram o modelo
  de um ativo por item deste corte.
