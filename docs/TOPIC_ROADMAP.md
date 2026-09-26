# Roadmap de tópicos do MKTauto

## Estado atual

| ID | Estado | Entrega | Evidência/aceite |
|---|---|---|---|
| B00 | CONCLUÍDO | Governança e cadastro local | Projeto reconhecido no Codex; documentos-base presentes. |
| V00 | CONCLUÍDO | Viabilidade e primeiro corte do MVP | Hipóteses, gates e rota de parada aprovados em 24/09/2026. |
| V01 | CONCLUÍDO | Repriorização para estúdio de cortes dinâmicos | PR #5 mergeado em 24/09/2026 (`fb1fd5d`). |
| R01 | CONCLUÍDO | Fluxo real e baseline interno | PR #10 mergeado; três cortes aprovados e decisão `iterar R01` pela lacuna de tempo ativo. |
| R01A | CONCLUÍDO | Instrumento local de descoberta assistida | PR #8 mergeado em 25/09/2026 (`6706ba6`). |
| V02 | CONCLUÍDO | Repriorização para entrada por upload | PR #11 mergeado em 26/09/2026 (`b7c921e`). |
| V03 | EM EXECUÇÃO | Estrutura futura para vídeos de react | Define duas faixas sincronizadas, layouts, áudio, legendas e direitos. |
| R02 | PENDENTE | Ingestão e compreensão do vídeo enviado | Depende de V02; usa evidência de R01 sem repetir descoberta. |
| R03 | PENDENTE | Experimento criativo upload-first | Depende de R02. |
| R04 | PENDENTE | Contratos determinísticos e adaptadores | Depende de R03 e G1. |
| R05 | PENDENTE | Fundação e múltiplos perfis | Depende de R04 e G2. |
| R06 | PENDENTE | Ingestão e preparação | Depende de R05. |
| R07 | PENDENTE | Produção dinâmica e exportação | Depende de R06. |
| R08 | PENDENTE | Instagram: publicação e insights | Depende de R07 e G3. |
| R09 | PENDENTE | Painel, piloto e decisão | Depende de R08. |

V02 é uma repriorização documental aprovada após o merge do PR #10. Cada tópico
pode ser dividido antes da execução quando houver mais de uma entrega
independente, risco elevado ou oportunidade de entregar valor menor e
demonstrável.

## Corte aprovado do MVP

Permitir que um operador individual administre vários perfis temáticos em
`pt-BR`, envie um vídeo próprio/licenciado e o transforme em um novo corte
vertical autoral, narrado, legendado, revisado e mensurável. O fluxo termina com
publicação aprovada no Instagram e painel de desempenho; exportação manual
permanece como fallback.

Defaults aprovados:

- uma persona: operador individual de um portfólio de perfis temáticos;
- vários perfis, mas um perfil e um lote processados por vez;
- upload manual como entrada principal, com origem e condição de uso declaradas;
- transcrição local; análise visual local quando a fala não explicar o vídeo;
- um corte por entrada, com roteiro novo, narração e legendas sincronizadas;
- revisão humana da versão renderizada antes de qualquer publicação;
- Instagram como primeiro adaptador de publicação e insights;
- receita manual/importada e lucro estimado, sem promessa de monetização;
- contratos pequenos para adicionar plataformas e parceiros após o MVP;
- mídia, tokens, provas privadas e dados pessoais sempre fora do Git.

## Prioridade e entregas

| ID | Entrega mínima | Depende de | Aceite objetivo |
|---|---|---|---|
| V01 | Reposicionar visão e roadmap | V00 | Documentos coerentes com cortes dinâmicos, múltiplos perfis, Instagram inicial e extensibilidade posterior. |
| R01 | Medir o fluxo interno | V01 | Um operador executa 3 lotes reais; etapas, tempo ativo, espera, retrabalho, custo e resultado são registrados sem mídia no Git. |
| R01A | Instrumentar a descoberta | Rodada 1 de R01 | Aplicação local coleta sinais oficiais, usa IA para sugerir candidatos e calcula ranking explicável por regras testadas. |
| V02 | Reposicionar entrada do MVP | PR #10 | Documentos tornam upload único o fluxo principal e composição multivídeo um item explícito de backlog. |
| V03 | Estruturar react no backlog | V02 | Fonte e reação possuem faixas, sincronização, layouts, áudio, legendas e direitos rastreáveis. |
| R02 | Validar ingestão e compreensão | V02 | Um upload válido produz hash, metadados, áudio, transcrição com timestamps e análise visual quando necessária, sem mídia no Git. |
| R03 | Provar criação upload-first | R02 | Processo concierge cria roteiro novo, plano de trechos, narração e legendas para um corte feito somente com o vídeo enviado. |
| R04 | Definir domínio e adaptadores | R03 | Estados, invariantes e contratos mínimos de fonte, IA, renderização, publicação, insights, monetização e parceiros são testáveis. |
| R05 | Criar fundação | R04 | Aplicação reproduzível para um operador e múltiplos perfis, com configuração editorial e auditoria mínima. |
| R06 | Implementar ingestão e preparação | R05 | Upload, validação, transcrição, análise visual e marcação de trechos funcionam no fluxo principal. |
| R07 | Implementar produção dinâmica | R06 | Roteiro novo, narração, legendas, composição vertical, revisão, renderização e exportação completam um corte. |
| R08 | Integrar Instagram | R07 | Conta profissional conecta; somente versão aprovada publica; estado e insights são reconciliados; exportação cobre falha externa. |
| R09 | Entregar painel e piloto | R08 | Painel cruza perfil, vídeo, formato, visualizações, interações, custo, receita e lucro estimado; piloto decide `go`, `iterate` ou `stop`. |

R07 produz o primeiro gerador utilizável, R08 entrega o produto conectado e R09
encerra o MVP medido. Novos canais, parceiros e otimizações não interrompem essa
sequência.

## Gates de decisão

| Gate | Condição para avançar |
|---|---|
| G0 — fluxo | O operador interno consegue fornecer e executar 3 lotes representativos com origem registrada. |
| G1 — valor criativo | Ao menos um formato dinâmico produz resultado aceitável com economia mensurável contra o baseline. |
| G2 — construção | O processo concierge comprova o fluxo e justifica aplicação própria. |
| G3 — Instagram | Conta profissional de teste, permissões e documentação oficial permitem publicar e ler insights. |
| G4 — lançamento | Direitos, políticas, privacidade, retenção, takedown e operação pública recebem revisão específica antes da publicação real. |
| G5 — expansão | Cada novo canal ou parceiro demonstra acesso oficial, valor e regras próprias antes de ganhar adaptador. |

Desenvolvimento e testes anteriores a G4 usam apenas mídia própria, licenciada
ou expressamente autorizada. A revisão jurídica formal foi adiada, não removida,
e não autoriza scraping, repostagem irregular ou publicação de material sem base
de uso registrada.

## Fronteiras de adaptadores

O domínio não dependerá diretamente da Meta, de uma rede de afiliados ou de um
provedor de IA. Os contratos entram somente quando exigidos pelo fluxo comprovado:

- `Source`: receber o arquivo enviado e preservar origem, hash e condição de uso;
- `ContentIntelligence`: transcrever, analisar quadros quando necessário,
  sugerir trechos e criar roteiro novo;
- `Renderer`: compor e renderizar a versão revisável;
- `Publisher`: publicar a versão exata aprovada;
- `Insights`: coletar e reconciliar métricas;
- `Monetization`: registrar receitas e custos;
- `Partner`: consultar ofertas e produzir referências rastreáveis.

O MVP implementa Instagram para publicação e insights. Shopee é apenas um
possível adaptador futuro; outras plataformas e parceiros seguem o mesmo gate,
sem generalização antecipada.

## Painel do MVP

O painel começa com dados manuais ou CSV e evolui para insights oficiais do
Instagram em R08. Deve responder, por perfil, vídeo e formato:

- quantas visualizações e interações ocorreram;
- qual foi o custo registrado de produção e ferramentas;
- qual receita foi informada ou importada;
- qual o lucro estimado (`receita - custos`);
- quais formatos merecem continuar, iterar ou parar.

Metabase OSS é candidato para spike por ser gratuito e customizável dentro dos
limites da licença. Reuso só será escolhido se for menor que um painel nativo e
não criar custo, licença ou integração desproporcional.

## Registro de decisões

### R01 anterior — descoberta, direitos e baseline

Em 24/09/2026, o primeiro recorte registrou `stop/reposicionar` por não haver
operadores externos, lotes autorizados ou responsável jurídico demonstrados.
A decisão foi correta para aquele recorte e permanece como histórico.

### V01 — repriorização do MVP

Em 24/09/2026, o usuário esclareceu que:

- o projeto operará perfis próprios, não prestará serviço a terceiros;
- uma única pessoa poderá administrar vários perfis e nichos;
- o valor principal é buscar fontes, criar conteúdo e montar cortes dinâmicos;
- o Instagram deve estar integrado no MVP;
- desempenho, receita e lucro estimado precisam ficar visíveis;
- plataformas e parceiros futuros devem entrar por adaptadores;
- a revisão jurídica formal ocorrerá antes do lançamento público.

V01 substitui o recorte `metadados-only/export-only` de V00, preservando revisão
humana, origem, controles determinísticos, mídia fora do Git e fallback manual.

### R01 — protocolo aprovado

Em 24/09/2026, foi aprovado o protocolo sanitizado de execução em
`docs/R01_BASELINE_PROTOCOL.md`. O exercício compara as quatro famílias em três
lotes, separa tempo ativo de espera e registra custos, falhas, retrabalhos e uma
rubric definida antes da avaliação.

A pesquisa em `docs/R01_NICHE_RESEARCH.md` usa jogos, inspiração e carros de luxo
como exemplos do formato editorial, não como portfólio fixo. O método registrado
em `docs/R01_DYNAMIC_NICHE_DISCOVERY.md` deve ranquear semanalmente cinco nichos;
três candidatos elegíveis e diversos alimentam os lotes do baseline.

O usuário esclareceu que o fluxo candidato não exige gravação própria: ele deve
encontrar vídeos existentes com direito de adaptação e produzir cortes com valor
editorial substancial. Mudanças superficiais não satisfazem o produto, e direito
de uso continua sendo gate independente da transformação criativa.

Fontes agora recebem estado `verde`, `amarelo` ou `vermelho`. Somente fontes
verdes entram nos lotes; mídia oficial com termos ambíguos orienta pauta, mas não
segue para publicação até que o uso proposto esteja coberto.

Em 24/09/2026, a primeira rodada manual assistida avaliou 20 candidatos e gerou
um `top 5` provisório, registrado em `docs/R01_EXECUTION_LOG.md`. A rodada
demonstrou o instrumento, mas não comprova estabilidade. Em 25/09/2026, o
usuário esclareceu que a janela antes prevista para 01/10/2026 não pode bloquear
o avanço do MVP e autorizou a segunda execução imediata. Nenhum lote foi
iniciado, e o tempo da sessão assistida não foi tratado como tempo ativo do
operador.

G0 permanece aberto e R02 continua bloqueado. A decisão intermediária é
`iterar R01` até a segunda rodada, a confirmação de três fontes verdes e a
execução medida de L01–L03. Mídia, provas de autorização e outros dados privados
não devem ser adicionados ao repositório.

### R01A — instrumentação antecipada aprovada

Em 25/09/2026, o usuário aprovou antecipar uma aplicação local pequena porque a
repetição manual antes de qualquer instrumento não oferecia retorno suficiente.
R01A não substitui G0: usa YouTube Data API como primeiro sinal oficial, IA para
sugerir agrupamentos e regras determinísticas para validar evidência, calcular
scores, aplicar gates e limitar diversidade. A versão inicial usou OpenAI; para
a rodada 2, o usuário definiu Ollama local como provedor, sem chave externa de IA.

A fixture da rodada 1 revelou erros aritméticos no registro manual e foi usada
para corrigir scores sem trocar componentes ou pesos. Execuções ao vivo continuam
dependentes da chave local do YouTube não commitada e do Ollama ativo; vídeo
popular não recebe estado verde automaticamente.

O PR #8 foi mergeado em 25/09/2026 (`6706ba6`). A aplicação local, os nove
testes, a fixture, a revisão humana e os adaptadores iniciais encerraram R01A.
A troca para Ollama local integra a execução da rodada 2 de R01. A execução ao
vivo permanece uma validação de R01 e não libera G0 nem R02.

Em 25/09/2026, a rodada 2 antecipada coletou 49 sinais oficiais e produziu 20
candidatos únicos com duas evidências cada. O ranking provisório foi diverso,
mas somente motos utilitárias permaneceu comparável ao top 5 da rodada 1. A
revisão humana aprovou quatro itens e rejeitou um. Três fontes reutilizáveis do
Wikimedia Commons foram confirmadas. Após recorte explícito do usuário, L01–L03
produziram um corte narrado e legendado por nicho, três saídas locais medidas.
As três versões exatas foram aprovadas pelo usuário em 25/09/2026. G0 permanece
aberto somente pela lacuna de tempo ativo; a decisão segue `iterar R01`, sem
bloqueio de calendário.

### V02 — entrada por upload e backlog multivídeo

Em 26/09/2026, o usuário definiu upload manual como entrada principal do MVP.
Para cada vídeo, o sistema deve extrair/transcrever o áudio localmente, recorrer
a análise visual local quando a fala não bastar, criar abordagem e roteiro novos
com o Ollama, selecionar trechos somente do arquivo enviado e produzir um corte
com narração nova e legendas sincronizadas. A versão exata continua sujeita a
aprovação humana.

A composição de um único vídeo a partir de vários uploads do mesmo assunto foi
adicionada ao backlog pós-MVP. Essa evolução deverá validar direitos e hash de
cada entrada, preservar a origem por trecho e impedir que um arquivo rejeitado
participe da montagem.

### V03 — estrutura futura para vídeos de react

Em 26/09/2026, vídeos de react foram adicionados ao backlog pós-MVP. O formato
terá dois ativos independentes: o vídeo-fonte e uma faixa de reação/comentário
fornecida pelo operador. Ambos exigem origem, hash, condição de uso, transcrição
e aprovação próprias.

A timeline deverá alternar eventos de fonte e reação sem perder sincronização,
com layouts `fonte em tela cheia`, `reação em tela cheia`, `picture-in-picture`
e `dividido`. O mixer deverá aplicar prioridade da fala e redução controlada do
áudio-fonte; as legendas identificarão o locutor. Cada trecho renderizado deverá
preservar referência ao ativo e intervalo de origem.

React não cria autorização automática sobre o vídeo-fonte. Direitos, contexto,
atribuição, segurança e aprovação humana da versão exata continuam gates.

## Backlog pós-MVP aprovado

| ID | Capacidade | Dependência | Aceite futuro |
|---|---|---|---|
| P01 | Composição multivídeo por assunto | R09 e G4 | Vários uploads aprovados formam um vídeo novo com origem por trecho. |
| P02 | Vídeo de react | R09, G4 e captura de reação | Fonte e reação sincronizadas geram uma versão revisável com layouts, áudio e legendas por locutor. |

## Riscos residuais

- Busca não implica licença de uso; cada fonte precisa manter origem e condição
  declarada antes de processamento ou publicação.
- Acesso, permissões e métricas do Instagram podem mudar e serão revalidados em
  R08 somente em conta profissional de teste.
- Receita pode vir de fontes que o Instagram não expõe; o MVP aceita entrada
  manual/CSV antes de novos adaptadores.
- Conteúdo dinâmico pode não gerar audiência ou lucro; R09 mede, não promete.
- Transcrição e visão local podem inviabilizar custo ou latência; R02 mede antes
  do experimento criativo. R03 mede roteiro, voz, legenda e renderização.
- Metabase OSS tem obrigações e limites de customização; R09 pode preferir painel
  nativo pequeno.
- Publicação real permanece bloqueada por G4, mesmo que a integração técnica já
  funcione em ambiente de teste.

## Evidências externas atuais

Consultadas em 24/09/2026 e sujeitas a revalidação no tópico correspondente:

- [Instagram API — coleção oficial da Meta](https://www.postman.com/meta/instagram/collection/6yqw8pt/instagram-api): conexão de contas profissionais, publicação e insights.
- [Metabase embedding](https://www.metabase.com/docs/latest/embedding) e [licença](https://www.metabase.com/license): opção OSS para dashboard, com limites de incorporação e customização.
- [Lei 9.610/1998](https://www.planalto.gov.br/ccivil_03/leis/l9610.htm): reprodução, adaptação, citação e pequenos trechos exigem análise do caso e origem registrada.

## Regra de execução

Cada tópico começa em análise no Chat, tem pacote curto aprovado, altera somente
o necessário e termina com aceite demonstrado, testes pertinentes, diff restrito,
roadmap atualizado, commit, push e PR. O próximo tópico começa apenas após o merge.
