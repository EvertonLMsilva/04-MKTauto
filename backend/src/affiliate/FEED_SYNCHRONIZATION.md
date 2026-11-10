# Comparação offline de feeds — AFFILIATE-006

Fluxo explícito, sem inicializar NestJS/SQLite, acessar a Shopee ou cadastrar dados.
Reutiliza `readQualificationFeeds`, CSV UTF-8, SHA-256 e `qualifyFeedRows`.
O leitor existente não muda para seus consumidores anteriores; somente este fluxo
solicita a observação opcional da coluna `currency`.

## 1. Capturar uma versão de uma origem

Preparar um config privado no formato da triagem, contendo **exatamente um feed**.
Preservar o `feedId` e uma referência documental estável de origem entre versões.
`expectedSha256` pode fixar o arquivo esperado; o leitor sempre calcula e compara
SHA-256 antes/depois da leitura. Fonte/config que mudar durante a captura falha.

Criar `snapshot-request.json` fora do Git:

```json
{
  "configPath": "catalog-single-source.json",
  "feedId": "200149",
  "sourceRef": "documento-privado:origem-do-feed-200149",
  "obtained": null,
  "reference": null,
  "validUntil": null
}
```

Depois do build, a partir da raiz do repositório:

```powershell
node backend/dist/affiliate/synchronize-feeds.js snapshot --input C:/private/snapshot-request.json --output C:/private/snapshot-v1.json
```

Os caminhos relativos de entrada são resolvidos em relação ao JSON de pedido;
`sourcePath` continua relativo ao config CSV. A saída precisa ser um arquivo novo.
Nenhuma entrada, versão anterior ou relatório é sobrescrito.

O snapshot guarda origem declarada, arquivo, bytes/hash, headers/mapeamento,
versão interna `affiliate-observed-csv/1.0.0` e observações brutas por item/registro.
Essa versão **não afirma ser um layout oficial Shopee**. A identidade cobre todo
o conteúdo e metadados do artefato, sem depender do relógio da execução.
Dados JSON de atributos usam o hasher canônico existente na comparação.

Datas opcionais exigem `{ "at": "<ISO com timezone>", "evidenceRef": "<documento>" }`.
Sem evidência, manter `null`. Nome do arquivo, mtime e `sourceUpdatedAt` isolado
não comprovam obtenção, atualização do produto ou validade comercial.
Referências documentais declaradas não são autenticadas automaticamente.

## 2. Comparar versões compatíveis

```json
{
  "before": "snapshot-v1.json",
  "after": "snapshot-v2.json",
  "evaluatedAt": "2026-11-10T12:00:00Z",
  "registeredCatalog": null
}
```

```powershell
node backend/dist/affiliate/synchronize-feeds.js compare --input C:/private/comparison-request.json --output C:/private/comparison-report.json
```

Repetir a mesma entrada em outro processo reproduz `reportId` e bytes do relatório.
Mudanças nos snapshots, contexto exportado ou instante de avaliação mudam a identidade.
O hash detecta corrupção; não é assinatura nem prova de titularidade/proveniência.

Origem/provider/feedId/referência e versão/mapeamento precisam ser compatíveis.
Headers podem mudar de ordem sem transformar fatos iguais em alterações.
**200149 e 200150 são fontes diferentes, não uma sequência temporal.**
Sem datas de referência documentadas, a ordem fornecida é `ORDER_UNVERIFIED`.
Datas de referência invertidas são recusadas.

O relatório distingue inclusão, ausência, alterações observáveis de título,
atributos/categorias, preço informado, links, mídia reportada e moeda, além de
duplicados, incompletos e ausência de mudança observável. Contém registro/linha,
campos presentes/ausentes e motivos da triagem; IDs inválidos continuam nas
evidências de registros incompletos. Duplicados bloqueiam propostas automáticas.

Ausência não prova exclusão/indisponibilidade na loja. Igualdade observável não
confirma estabilidade comercial. Valores monetários são literais históricos;
moeda reportada é preservada literalmente ou `null`, sem conversão/inferência.
Disponibilidade, comissão e preço atual nunca são confirmados pelo fluxo.
Validade documentada é apresentada como `EXPIRED`, `WITHIN_DOCUMENTED_VALIDITY`
ou `UNPROVEN`, sempre com `storeVerification=NOT_VERIFIED`.

## 3. Preparar atualizações para revisão

`registeredCatalog`, quando fornecido, aponta para um **export JSON** revisado,
não um banco SQLite. Cada entrada contém:

```text
{externalProductId, mappingEvidenceRef, product: <DTO existente>, offers: [<DTO existente>]}
```

O vínculo item/produto precisa de evidência declarada. Repetição de identidade,
oferta de outro produto/revisão ou DTO inválido falha. O export não comprova que
sejam as revisões vigentes: `currentRevisionsVerified=false` permanece explícito.

Uma nova descrição/título ou mudança de atributos prepara a revisão seguinte
e o impacto nas ofertas fornecidas. Título já igual ao export não provoca revisão
desnecessária. A proposta conserva mídia, localImage, direitos e evidências antigas,
anexando somente evidência de especificação do novo snapshot. **Não cria grants.**
Os atributos antigos não são sobrescritos por mapeamentos presumidos: os novos
atributos observados ficam separados para revisão humana de conflitos/mapeamento.
Preço/link isolados não viram especificação estática nem revisão de produto.
Nenhum link afiliado é substituído; mudança de URL exige revisão específica.

Propostas incompletas/duplicadas não produzem minuta de produto. As demais têm
checagem do contrato existente e chaves idempotentes derivadas dos objetos, mas
**`finalPayload=null`, `catalogEligible=false` e `registrationAuthorized=false`**.
Revisar validade, dados, atributos, direitos e associação afiliada, confirmar
projeto/revisões vigentes e então reutilizar a prévia de cadastro existente.
Cadastro e aplicação de revisões dependem de autorização posterior específica.

## Limite dos feeds históricos disponíveis

Os dois feeds históricos já triados são de origens distintas. Sem uma segunda
versão documentada da mesma origem, não há delta real demonstrado. Não interpretar
o relatório dos testes fictícios como alteração de valores comerciais reais.
Não há scheduler, CATALOG ativado, importação operacional ou integração automática.
