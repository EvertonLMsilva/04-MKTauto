# AFFILIATE-005 — preparação assistida para revisão humana

Data: 10/11/2026. Persona: operador individual de canais temáticos.
Base: `96d9b5c16185ec953d58a5819357388329f0abc1` (merge #141).
Branch/worktree isolados: `feature/mktauto-affiliate-assisted-preview` /
`D:/04-Projetos/_worktrees/mktauto-affiliate-005`.

## C-01 / C-05 — lacuna e implementação

AFFILIATE-004 entregou fatos classificados e razões, mas não uma operação para
montar, completar e validar produto/oferta para revisão. A regressão do novo
contrato falhou antes da implementação pela ausência dessa operação.

Implementados somente em Affiliate: serviço de pré-visualização, controller,
CLI offline e leitor físico sem escrita, com seus testes. Reutilizados triagem,
RegisterProductDto/RegisterCampaignDto, validadores de produto/oferta, regras
de direitos CATALOG, leitor de projeto, repositório em modo readOnly e o inspetor
PNG puro já existente de Media. Nenhum arquivo Media foi alterado.
Cadastro, revisões, rotação, congelamento e permissões existentes não mudam.

## C-02 / C-04 — entrada e pacote auditável

Nova operação necessária: `POST /affiliate/feed-qualifications/preview`, HTTP 200,
sem cadastro, aprovação, grant, publicação ou outro efeito operacional.
O POST apenas transporta a proposta/evidências para avaliação. Nesta tarefa,
nenhum POST real foi enviado; apenas HTTP local dos testes descartáveis.

Entrada mínima, substituindo pelos valores reais da seleção:

```json
{
  "reportId": "<reportId atual da triagem>",
  "externalProductId": "4251540175",
  "projectId": "project_kate_mkt",
  "recordedAt": "<instante ISO da coleta da evidência do feed>"
}
```

reportId é conferido contra nova leitura da triagem; fonte alterada retorna 409.
Somente um PRE_CANDIDATE canônico pode ser preparado. O serviço propõe IDs
determinísticos por itemid e revisão inicial 1, sujeita à verificação do contexto.
Não inventa disponibilidade de revisão em cadastro real.

Nome, categoria, identidade e referência de feed/hash/registro alimentam o
produto V2. Marca ausente usa NOT_PROVIDED; marca posteriormente documentada
pode ser informada pelo contrato existente. Preço histórico e moeda desconhecida
ficam em commercialSnapshot, nunca como campos novos ou preço estático no DTO.

O resultado inclui productDraft/offerDraft nos envelopes atuais, versões,
erros por campo, pendências, mídia, evidência afiliada, contexto, hash do pacote
e os fatos comerciais não confirmados. Uma minuta sem mídia/link fica
explicitamente BLOCKED e finalPayload=null, sem alegação de objeto válido.

Para completar a proposta, reenviar os objetos product/campaign dos envelopes
apresentados, preservando identidade, nome, projeto, vínculo e evidência do feed.
Esses campos continuam sendo os contratos existentes, não DTOs paralelos.
O campo opcional affiliateEvidence reutiliza o formato DiscoveryEvidence:
sourceRef, recordedAt com timezone e subjectHash de
`affiliateHash({ externalProductId, affiliateUrl })`. Sem referência/binding
coerentes, a afiliação continua pendente. URL do anúncio/URL curta não é prova.
São aceitos os hosts afiliados da política existente, sem flexibilizá-la.

Evidência declarada é apresentada para conferência documental humana; sua
presença não autentica a Shopee, o documento ou a licença automaticamente.
O pacote explicita OPERATOR_DOCUMENTED_DECLARATIONS_REQUIRE_HUMAN_REVIEW.

## C-03 — mídia e direitos

O produto completo precisa de localImage e referências/evidências coerentes
com o contrato atual. A elegibilidade existente exige hash e referência exatos,
uso comercial, processamento local e evidências reutilizáveis tanto no produto
quanto na origem local; permissões restritas a QC/operação não servem.
O serviço não cria nem transforma grants em nome do operador.

O leitor usa o armazenamento já estabelecido:
`FFMPEG_MEDIA_ROOT/sha256/<prefixo>/<sha256>.png`. Abre em modo leitura,
verifica caminhos canônicos sem symlinks, arquivo até 20 MiB, SHA-256 dos bytes
e o mesmo inspetor PNG de Media. Não chama mkdir/put, não registra mídia, não
baixa imagem remota e não lê caminhos arbitrários enviados pelo cliente.
Ausência, corrupção ou direitos insuficientes mantêm o bloqueio.

## Contexto, revisão, replay e aprovação

Na aplicação, o serviço verifica projeto e revisões usando somente leituras:
revisão já existente precisa ser idêntica, revisão nova deve ser consecutiva,
e revisão ultrapassada/conflitante fica bloqueada. Nenhuma revisão é sobrescrita
ou incrementada silenciosamente. A prévia não consome chave de cadastro.

Com todos os gates técnicos, retorna READY_FOR_OPERATOR_REVIEW e finalPayload
com os dois envelopes atuais. Mesmo assim, registrationAuthorized=false e
operationallyRegistered=false. Esse estado não autoriza executar cadastro.
O operador precisa conferir a documentação e autorizar os objetos exatos.
Guardar o pacote aprovado e seu hash, inclusive a prova de afiliação que fica
no pacote de revisão, sem inventar vínculo de origem API para um produto CSV.

As chaves propostas derivam dos objetos, e packageHash cobre os fatos,
evidências, versões, contexto e resultado. Mesma entrada/fontes/contexto/bytes
produz a mesma prévia após nova instância. Mudanças exigem nova revisão humana.
Não há tabela, receipt ou cache de prévias criado; revalidar o pacote antes de
um cadastro autorizado. Os gates posteriores de produção/publicação permanecem.

## CLI offline e pacote real — C-07

Após build, a partir da raiz, em PowerShell:

```powershell
$env:AFFILIATE_DISCOVERY_CONFIG = 'C:/private/catalog.local.json'
node backend/dist/affiliate/preview-product.js --input C:/private/preview-input.json --output C:/private/new-preview.json
```

A CLI não recebe repositório/leitor de projeto e não abre banco operacional.
PROJECT_SCOPE_UNVERIFIED e REVISION_SCOPE_UNVERIFIED permanecem como pendências.
Ela grava somente um novo artefato, com wx, sem substituir entrada ou saída
anterior. Não executa POST, cadastro ou campanha. A verificação do contexto
operacional deve ocorrer depois, em acesso autorizado, antes da decisão final.

Pacote real gerado pelo código compilado para o cesto N04:

- Item 4251540175; registro lógico CSV 1138 do feed 200149; SHA-256
  `1cb4965282cebd3b433f90f65d69b5a90ad0a37a69a63d82ed1dd713b8c540d3`.
- Nome reportado: Cesto Multiuso Organizador 35cm Aramado Fruteira de Parede
  Modelo N04. Categoria reportada: Kitchenware.
- Produto proposto: prod_shopee_4251540175, revisão 1, marca NOT_PROVIDED,
  media vazio; oferta offer_shopee_4251540175, revisão 1, projeto proposto
  project_kate_mkt, link afiliado null. CTA/disclosure estão na minuta.
- Valor histórico 45.9, moeda/atualidade/estoque/comissão não comprovados;
  sem preço nos DTOs ou afirmação de rentabilidade.
- Pacote BLOCKED, finalPayload=null, sem autorização. Faltam imagem exata,
  direitos reutilizáveis, link/prova afiliada e contexto/revisões verificados.
- Caixa 11 litros 52862826489 e suporte 3 em 1 58262019089 preservados como
  alternativas, sem promoção a ofertas elegíveis.

Artefatos fora do Git em `C:/Users/evert/.codex/outputs/affiliate-005-20261110/`:
entrada e cesto-preview.json produzidos pela CLI, replay e pacote de revisão.
Nenhuma imagem histórica foi reaproveitada e nenhuma permissão real foi criada.

Próximo passo externo: fornecer imagem/bytes e documento que identifique sua
origem/titular, hash, uso comercial, processamento local e reutilização; fornecer
o link afiliado e sua associação verificável ao item. Completar os objetos,
verificar contexto/revisões, revisar o hash e só então solicitar autorização
específica de cadastro pelos endpoints existentes. D1/D2 continuam desabilitados.

## C-06 / C-08 — validação e limites

Testes com SQLite descartável: dados completos e pendentes, marca ausente, moeda
ausente e preço histórico fora do DTO, link sem prova, imagem ausente, direitos
ausentes/insuficientes/QC, hash físico divergente, entrada malformada, revisão de
oferta, CATALOG, replay/restart, objetos duplicados, contexto offline e HTTP.
Permissões positivas são explicitamente FICTITIOUS_TEST_ONLY. O teste verifica
que a prévia preserva os bytes do SQLite e não insere produto/oferta; só o teste
de revisões faz cadastro fictício explícito para preparar seu cenário.

Resultados em 10/11/2026:

- 329 testes Affiliate/rotação/fluxo local PASS em 25 arquivos, incluindo os 15
  novos e HTTP da prévia; sete E2E HTTP Affiliate/contexto PASS em dois arquivos.
- A regressão também demonstrou e corrigiu, neste mesmo escopo, o risco de
  apresentar o indicador CATALOG positivo apenas pelo validador de metadados:
  o indicador público agora exige todos os gates, inclusive afiliação, mídia
  física, projeto e revisões. Proposta bloqueada mantém o indicador false.
- TypeScript, build, lint, Prettier do escopo e diff-check: PASS. Oito avisos
  preexistentes no lint, sem erros.
- CLI real offline produziu o pacote do cesto e uma execução nova com a mesma
  entrada reproduziu bytes e packageHash; sem POST ou banco operacional.
- packageHash real bloqueado:
  `24cf3f9df781632a0169a202ea676c9c1ebf2a4d7b5ed87d4fcbe1c223f5fded`.
  SHA-256 do artefato:
  `e7dcadecbaa38a205e233573e75372bbad6c29d5572d0fdeb14d02e1b11c837b`.

O artefato operator-review-package.json reúne o cesto e as alternativas
preservadas. Nenhuma aprovação humana foi inferida ou produzida.

Validação técnica não comprova licença, venda ou cadastro reais. Sem SQLite
LIVE, conta Shopee, download/geração de mídia real, chamada paga, publicação,
deploy, scheduler ou campanha D1/D2. Worktrees anteriores preservados.
COMMERCIAL-002 e AFFILIATE-001 mantêm seus bloqueios existentes.
Um PR; USER_ONLY_MERGE, sem auto-merge ou próximo tópico iniciado.
