# R01 — Descoberta, direitos e baseline

## Resultado da análise

**Decisão em 24/09/2026: `stop/reposicionar`. G0 não satisfeito e R02 não
autorizado.**

O repositório não contém evidência sanitizada de operadores entrevistados,
fluxos observados, lotes reais acessíveis ou autorizações verificáveis. Também
não há responsável jurídico designado. Criar amostra, simular tempos ou escolher
provedor nessas condições substituiria descoberta por hipótese e contrariaria o
gate de matéria-prima.

Esta decisão não afirma inexistência de usuários ou mídia autorizada; afirma
somente que eles não foram demonstrados por evidência disponível ao projeto.

## Escopo e fonte da decisão

- Persona principal: **Análise**.
- Produto observado: criador ou pequeno operador de uma página em português,
  um operador e um projeto por vez, saída `pt-BR`.
- Fluxo pretendido: mídia autorizada → metadados editoriais → revisão humana →
  exportação manual.
- Fonte examinada: documentos versionados do projeto e estado do Git.
- Não realizado: contato externo, coleta de dados pessoais, cópia de mídia,
  teste de provedor, implementação ou geração de conteúdo.

## Evidência de matéria-prima

### Operadores

| ID sanitizado | Acesso confirmado | Fluxo observado | Baseline válido |
|---|---:|---:|---:|
| O-01 a O-05 | não | não | não |

Um operador só conta como acessível quando concordar com observação do fluxo e
uso de métricas agregadas, sem nome, contato, cliente ou conteúdo no repositório.

### Lotes

| ID sanitizado | Operador | Itens | Evidência externa de direitos | Situação |
|---|---|---:|---|---|
| L-01 | não atribuído | 0 | ausente | inacessível |
| L-02 | não atribuído | 0 | ausente | inacessível |
| L-03 | não atribuído | 0 | ausente | inacessível |

A mídia e a autorização privada devem permanecer em ferramenta segura sob
controle do operador. O repositório recebe apenas ID sanitizado, tipo de origem,
escopo confirmado, validade e resultado da verificação.

## Protocolo de observação e baseline

Cada operador deve executar seu processo normal, sem orientação para parecer
mais eficiente. Cronometrar somente tempo ativo e registrar espera separadamente.

| Etapa | Início | Fim | Tempo ativo | Espera | Retrabalho e causa |
|---|---|---|---:|---:|---|
| Receber e conferir mídia | primeiro contato com o lote | lote aceito/rejeitado | — | — | — |
| Conferir origem e direitos | início da checagem | direitos confirmados/bloqueados | — | — | — |
| Entender o conteúdo | primeira reprodução | contexto suficiente | — | — | — |
| Preparar metadados | primeiro rascunho | título, legenda, CTA e hashtags completos | — | — | — |
| Revisar e corrigir | primeira revisão | versão aprovada pelo operador | — | — | — |
| Organizar a entrega | início da organização | pacote manual pronto | — | — | — |

Para cada lote, registrar quantidade de itens válidos, tempo ativo total e por
etapa, mediana por item, número de reaberturas e principais causas de retrabalho.
O baseline só é comparável se a definição das etapas e o cronômetro forem os
mesmos nos três lotes. Orçamento e prazo aceitáveis por lote também devem ser
perguntados; hoje estão **não definidos**.

## Hipótese operacional a validar

Estes limites permitem um teste uniforme, mas não são requisito de produto nem
decisão de arquitetura:

- lote inicial: **10 itens**, formando a amostra-alvo de 30 itens com 3 lotes;
- contêiner: **MP4 ou MOV**;
- duração por item: **15 a 90 segundos**;
- tamanho por item: **até 250 MB**;
- saída: título, legenda, CTA e hashtags em `pt-BR`, sem alterar o vídeo.

Qualquer operador real que trabalhe fora desses limites deve gerar uma decisão
`iterar`, não uma exclusão silenciosa da descoberta.

## Definição testável de edição leve

Um rascunho exige edição leve quando o operador gasta **no máximo 2 minutos de
tempo ativo** e faz apenas uma ou mais destas alterações:

- ortografia, pontuação, concordância ou adequação de tom;
- ajuste curto de título, CTA ou ordem/remoção de hashtags;
- correção factual pontual explícita na mídia ou no briefing;
- remoção de trecho inadequado sem substituir a ideia central.

É edição pesada se houver reescrita da ideia central, pesquisa externa,
retranscrição, inclusão de informação não disponível, mudança de posicionamento
ou mais de 2 minutos de trabalho ativo. Bloqueio por direitos ou política nunca é
classificado como edição.

## Rubric e plano da amostra

A amostra planejada é de **30 itens reais autorizados: 10 por lote, um lote por
operador sempre que possível**. A seleção deve ocorrer antes de gerar rascunhos e
sem escolher apenas os itens mais fáceis.

Cada item recebe `0` (falha), `1` (parcial) ou `2` (atende) em:

1. fidelidade ao conteúdo e ausência de invenções;
2. clareza e correção em `pt-BR`;
3. aderência ao tom, público e objetivo informados;
4. completude de título, legenda, CTA e hashtags;
5. segurança editorial: sem alegação proibida, exposição indevida ou conflito
   com o briefing.

Um item é **utilizável com edição leve** quando não tem bloqueio de direitos ou
política, obtém pelo menos 8/10, não recebe zero em fidelidade nem segurança e
respeita a definição de até 2 minutos. O alvo posterior é pelo menos 21 de 30
itens (70%). R01 apenas fixa a medição; a avaliação ocorre em R02, se G0 abrir.

## Direitos e controles operacionais mínimos

### Origens admitidas no experimento

- obra criada integralmente pelo operador;
- obra encomendada com licença ou cessão compatível com o uso pretendido;
- mídia de biblioteca licenciada, quando a licença cobrir uso comercial,
  alterações pretendidas e envio ao processador;
- material de terceiro com autorização expressa que identifique obra, titular,
  escopo, canais, território e prazo.

Link público, crédito, ausência de marca-d'água ou declaração genérica do usuário
não provam autorização. Conteúdo obtido por scraping, download ou repostagem não
entra no experimento.

### Registro mínimo da verificação

Manter fora do repositório o documento original e registrar aqui apenas dados
sanitizados: ID da evidência, origem, quem verificou, data da verificação,
escopo, território, validade e situação (`válida`, `pendente`, `expirada` ou
`revogada`). Item pendente, expirado ou revogado fica bloqueado.

### Categorias excluídas até revisão jurídica

- mídia sem cadeia de autorização verificável;
- dados pessoais sensíveis, documentos, contatos ou conteúdo confidencial;
- imagem ou voz de menor de idade;
- conteúdo sexual, violento, discriminatório ou que incentive ilícito;
- alegações médicas, financeiras, eleitorais ou outras reguladas;
- imagem, voz, marca ou obra de terceiro sem autorização específica.

### Validade, retenção, bloqueio e takedown

- validar direitos antes de qualquer envio e novamente antes da exportação;
- expiração ou revogação bloqueia processamento e invalida aprovação anterior;
- pedido de takedown interrompe uso/exportação imediatamente, preserva somente o
  registro mínimo do incidente e exige remoção manual pelo operador onde houver
  publicação anterior;
- mídia de trabalho deve permanecer fora do Git e ser eliminada ao fim do
  experimento ou antes, em caso de revogação;
- prazo jurídico para conservar autorização e registro do incidente permanece
  **bloqueado até designação de responsável jurídico**.

Responsáveis operacionais provisórios: o operador confirma origem/escopo e o
responsável do experimento verifica o checklist. **Pendências jurídicas não têm
responsável designado; nenhum piloto público pode começar até essa designação e
validação profissional.**

## Dados e provedores

Se G0 abrir, o experimento só poderá enviar ao provedor:

- arquivo de mídia autorizado;
- briefing editorial mínimo sem dados pessoais;
- idioma, tom, palavras proibidas e CTA;
- texto gerado necessário à avaliação.

É proibido enviar documentos de autorização, nomes/contatos, identificadores de
clientes, credenciais, métricas privadas, dados sensíveis ou mídia bloqueada.

Decisão conservadora para R02: processamento no Brasil; sem treinamento com os
dados; retenção do provedor desativada ou limitada ao processamento, com exclusão
confirmada em até 24 horas. Qualquer transferência internacional, retenção maior
ou uso para melhoria de modelo exige aprovação prévia do responsável jurídico.
Se nenhum provedor atender, usar ferramenta local aprovada ou manter `stop`.

## Critérios de decisão

| Decisão | Critério |
|---|---|
| `avançar` | 3 operadores acessíveis; 3 lotes reais, totalizando ao menos 30 itens; autorização verificável; baseline dos 3 lotes completo; responsável jurídico designado e controles acima aceitos. |
| `iterar` | Há matéria-prima autorizada, mas persona, limites do lote, medição ou controles precisam de ajuste delimitado antes do experimento. |
| `stop/reposicionar` | Não há 3 lotes autorizados/acessíveis; autorização é incompatível com processamento; não há responsável para pendências jurídicas; ou operadores não demonstram demanda/tempo relevante. |

Decisão atual: **`stop/reposicionar` por ausência de operadores e lotes
demonstrados e por responsável jurídico não designado.**

## Aceite e condição de retomada

| Critério | Estado | Evidência |
|---|---|---|
| Operadores e 3 lotes autorizados acessíveis, ou `stop/reposicionar` registrado | atendido pela rota de parada | inventário vazio e decisão acima |
| Fluxo e baseline manual mensurados | não atendido | nenhum fluxo real observado |
| Lote inicial e edição leve definidos de forma testável | atendido provisoriamente | limites e regra de 2 minutos |
| Rubric e amostra de 30 itens planejadas | atendido | plano 3 × 10 e rubric 0–2 |
| Direitos, retenção, proibições e responsável jurídico | bloqueado parcialmente | controles definidos; responsável e prazo jurídico ausentes |
| Dados, região e retenção de provedor decididos | atendido de forma conservadora | minimização, Brasil e até 24 horas |
| R02 aprovado somente se G0 satisfeito | atendido | R02 não autorizado |

Para retomar, apresentar fora do Git os contatos consentidos de até 5 operadores,
três referências de lote e suas provas de autorização, além do nome/função do
responsável jurídico. No repositório entram somente os registros sanitizados e
tempos agregados. Enquanto isso, não iniciar R02 nem qualquer implementação.
