# AFFILIATE-004 — pré-qualificação dos feeds locais

Data: 10/11/2026. Persona: operador individual de canais temáticos.
Base confirmada: `f4925e5bd9881cd693674ab3c1bf6f7773490b82` (merge #140).
Branch/worktree isolados: `feature/mktauto-affiliate-feed-qualification` /
`D:/04-Projetos/_worktrees/mktauto-affiliate-004`.

## C-01 / C-05 — lacuna e reuso

O discovery existente usa `CsvDiscoverySource` / `ConfiguredDiscoverySource`
e requer uma coluna JSON de evidências completas. A configuração dos dois
feeds brutos tem apenas mapeamento de itemid/title, sem discovery. O ranking
de ofertas verificadas não representa a triagem preliminar desses arquivos.
AFFILIATE-003 precisou de scripts externos ao produto; não havia operação de
produto para repetir essa triagem. O teste do novo contrato falhou antes da
implementação porque o serviço ainda não existia.

Implementados somente em Affiliate: leitura configurada sem escrita, política
determinística, serviço, GET paginado e entrada CLI de lote. Reutilizados
`csvRecords` (UTF-8 estrito, CSV multilinha, limites e erros recuperáveis),
`fileDigest`, hash canônico, imutabilidade e validadores Affiliate existentes.
Não se altera o discovery anterior, seus DTOs, scoring, persistência ou seleção.
Sem novos schemas, migrations, cadastros, grants ou chamadas externas.

## C-02 / C-03 — critérios e evidências

Política: `affiliate-feed-prequalification/1.0.0`. Cada registro mantém feedId,
rowNumber lógico do CSV (cabeçalho é registro 1), identidade textual, nome,
URLs reportadas, categoria, preço histórico e razões. O relatório contém
cabeçalhos, SHA-256, tamanho, contagem, mapeamento e atualização declarada de
cada fonte. Hash de arquivo não autentica licença nem atualidade comercial.

- Identidade: itemid decimal positivo, preservado em texto, sem arredondamento.
- Dados essenciais: nome não vazio, sem caractere de substituição, e URL HTTPS
  Shopee com shop/item na rota e item igual ao itemid. Validação local não prova
  existência atual do anúncio nem associação afiliada.
- Duplicação: agrupar por itemid; representante canônico é o menor feedId e
  rowNumber. Comparar nome, product_link, price, sale_price e URL curta.
  Divergências nesses campos bloqueiam todas as ocorrências do ID; não há merge
  silencioso. Múltiplos valores do mesmo attr_id não são rejeitados só por isso.
- Atributos: JSON, quando presente, deve ser array com até 200 entradas, attr_id
  numérico e formatted_value textual não vazio/íntegro. A ausência fica explícita.
- Preço histórico: decimal positivo, até 18 casas, preservado em texto. Valor
  ausente fica null; malformado gera razão. Moeda e preço atual não são inferidos.
- Imagem remota é apenas uma URL reportada. Não prova bytes locais, integridade,
  titularidade, direitos comerciais ou processamento autorizado.
- URL curta reportada não é comprovação de afiliação. Proveniência comercial,
  disponibilidade, comissão, moeda e atualização continuam sem confirmação.

Classificações primárias: INCOMPLETE_DATA para erros, DUPLICATE para ocorrência
não canônica sem outros erros e PRE_CANDIDATE para dados analisáveis canônicos.
Razões independentes descrevem confirmação comercial, mídia e direitos pendentes.
Não há pontuação de vendas, demanda, comissão ou rentabilidade.
`catalogEligible` permanece false: essa etapa não recebe nem fabrica o conjunto
de evidências necessário à aprovação de uma oferta. O próximo gate é completar
e validar o onboarding, e não iniciar campanha/publicação.

O reportId deriva da versão da política e das fontes/mapeamentos ordenados;
não depende do relógio nem da ordem dos feeds na configuração. Nenhuma seleção
operacional é reservada. Reprocessamento/restart apenas reproduzem o relatório.
Arquivos são hashados antes/depois da leitura; mudança invalida a apuração.
`expectedSha256` opcional permite fixar uma fonte conhecida.

## C-04 — integração com onboarding

Os fatos da triagem alimentam o preparo dos DTOs existentes de produto/oferta,
sem conversão automática em entidades aprovadas. O teste usa esses fatos para
montar um produto V2 e comprova que os validadores existentes o bloqueiam sem
mídia. Não se rotula candidato CSV como seleção da API Shopee.

Procedimento após escolher um pré-candidato:

1. Conferir fatos/proveniência e referências de feed/hash/registro.
2. Completar marca conforme o contrato V2; ausência não vira marca inventada.
   Manter preço fora do produto/roteiro quando moeda e atualização faltarem.
3. Disponibilizar imagem exata, hash e documento verificável de uso comercial,
   processamento local e reutilização, respeitando seus limites reais.
4. Conferir link afiliado e vínculo ao produto/projeto, sem presumir que a URL
   do anúncio ou o redirecionamento identifique a conta afiliada.
5. Preparar produto/revisão e oferta/revisão, usando os DTOs, evidências e
   validadores existentes. Conferir identidades/revisões antes do cadastro.
6. Obter autorização humana dos objetos finais; somente então usar o cadastro
   existente. Esta entrega não executa esse passo operacional.
7. Validar CATALOG, briefing congelado, pacote, restart/replay em ambiente
   descartável. Rotação, validação física e gates existentes são preservados.

## Operação reutilizável

Configuração pelo `AFFILIATE_DISCOVERY_CONFIG` existente. Os feeds sem coluna
discovery podem ser usados nesta triagem; nenhum arquivo privado é alterado.
O serviço não inicializa banco, runtime de publicação ou cache de discovery.

Após o build, a partir da raiz do projeto, em PowerShell:

```powershell
$env:AFFILIATE_DISCOVERY_CONFIG = 'C:/private/catalog.local.json'
node backend/dist/affiliate/qualify-feeds.js --output C:/private/new-qualification-report.json
```

O destino precisa ser novo; `wx` impede substituir feeds/configuração/relatórios
ou qualquer arquivo existente. Sem --output, emite JSON em stdout. O relatório
completo preserva a lista auditável, sem repetir a leitura para cada página.

API: `GET /affiliate/feed-qualifications?offset=0&limit=50`. Limite máximo 500.
Paginação opcionalmente recebe reportId; alteração das fontes retorna 409.
A API lê o caminho configurado no servidor, nunca um caminho fornecido na query.
Não aceita outros parâmetros nem cadastra produtos. Cada chamada relê as fontes;
para auditoria integral de lotes grandes, preferir o relatório da CLI.

## C-06 / C-07 — testes e execução real

Testes: CSV sem discovery, incompleto, duplicado/conflitante, UTF-8 inválido,
registro excessivo, preço sem moeda, atributos inválidos, gates de mídia/direitos,
DTO existente, determinismo/reabertura, hash esperado, relatório alterado,
CLI sem sobrescrita, HTTP paginado e rejeição de caminho na query. Sem grants
fictícios novos. As fixtures usam arquivos temporários e bloqueiam fetch.

Resultados em 10/11/2026:

- Testes Affiliate + rotação + fluxo local: 314 PASS em 24 arquivos, incluindo
  sete testes novos e E2E HTTP da triagem. O fluxo local e os testes de rotação
  preservam a cobertura de SQLite descartável, CATALOG, congelamento e replay.
- E2E HTTP Affiliate e contexto de run: sete PASS em dois arquivos.
- TypeScript (`tsc --noEmit`), build, lint, Prettier do escopo e diff-check: PASS.
  Lint conserva oito avisos preexistentes, sem erros.
- CLI compilada executada integralmente nos feeds reais, fora do ambiente LIVE;
  repetição em nova instância reproduziu o relatório byte a byte por SHA-256.

Execução local real, somente leitura, nos feeds 200149 e 200150:

- 110.000 registros, 109.515 IDs distintos.
- 109.512 pré-candidatos; 485 ocorrências duplicadas; três incompletos
  (dois títulos corrompidos e um conjunto de atributos inválido).
- Zero ofertas elegíveis. Todos exigem evidências comerciais, mídia e direitos.
- Fontes preservadas: SHA-256
  `1cb4965282cebd3b433f90f65d69b5a90ad0a37a69a63d82ed1dd713b8c540d3`
  e `79a95cc21cf72e97c06ad6deb4b52734841425e020a43ad8be93064f01c6c5bd`.
- Segunda execução por nova instância reproduziu o SHA-256 integral do relatório:
  `8b84d7b3171ab40ccea8fa76c4d2b4828f83b22a9f93e46d61a698d8c49501c7`.
- reportId: `31bfa3860a5cade690c43d2486bf775aa9569eb1817826fcfa9a4ef7ba4cb3c0`.

Artefatos locais fora do Git:
`C:/Users/evert/.codex/outputs/affiliate-004-20261110/feed-qualification-report.json`
(lista completa) e `qualification-summary.json` no mesmo diretório (resumo).
Os IDs 4251540175 (cesto N04), 52862826489 (caixa 11 litros) e 58262019089
(suporte 3 em 1) continuam pré-candidatos, preservando AFFILIATE-003.
Nenhum deles tem oferta/mídia autorizada por esta apuração.

Sem acesso SQLite LIVE, registro real, download de mídia, conta Shopee, chamada
paga, deploy, scheduler ou publicação. Nenhum worktree anterior foi alterado.
Limite residual: apuração técnica do feed não é autenticação de direitos nem
confirmação comercial. COMMERCIAL-002 continua aguardando relatório real Shopee;
AFFILIATE-001 continua aguardando aprovação. Um PR, USER_ONLY_MERGE; sem próximo
tópico iniciado.
