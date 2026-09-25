# Roadmap de tópicos do MKTauto

## Estado atual

| ID | Estado | Entrega | Evidência/aceite |
|---|---|---|---|
| B00 | CONCLUÍDO | Governança e cadastro local | Projeto reconhecido no Codex; documentos-base presentes. |
| V00 | CONCLUÍDO | Viabilidade e primeiro corte do MVP | Hipóteses, gates e rota de parada aprovados em 24/09/2026. |
| V01 | CONCLUÍDO | Repriorização para estúdio de cortes dinâmicos | PR #5 mergeado em 24/09/2026 (`fb1fd5d`). |
| R01 | EM EXECUÇÃO | Fluxo real e baseline interno | Protocolo aprovado; aguarda execução e métricas dos três lotes autorizados. |
| R01A | CONCLUÍDO | Instrumento local de descoberta assistida | PR #8 mergeado em 25/09/2026 (`6706ba6`). |
| R02 | PENDENTE | Descoberta dinâmica de nichos e fontes | Depende de R01 e da validação de R01A. |
| R03 | PENDENTE | Experimento criativo concierge | Depende de R02. |
| R04 | PENDENTE | Contratos determinísticos e adaptadores | Depende de R03 e G1. |
| R05 | PENDENTE | Fundação e múltiplos perfis | Depende de R04 e G2. |
| R06 | PENDENTE | Descoberta e preparação | Depende de R05. |
| R07 | PENDENTE | Produção dinâmica e exportação | Depende de R06. |
| R08 | PENDENTE | Instagram: publicação e insights | Depende de R07 e G3. |
| R09 | PENDENTE | Painel, piloto e decisão | Depende de R08. |

Somente R01 ficará desbloqueado após o merge de V01. Cada tópico pode ser
dividido antes da execução quando houver mais de uma entrega independente, risco
elevado ou oportunidade de entregar valor menor e demonstrável.

## Corte aprovado do MVP

Permitir que um operador individual administre vários perfis temáticos em
`pt-BR` e transforme vídeos encontrados por nicho em cortes verticais autorais,
dinâmicos, revisados e mensuráveis. O fluxo termina com publicação aprovada no
Instagram e painel de desempenho; exportação manual permanece como fallback.

Defaults aprovados:

- uma persona: operador individual de um portfólio de perfis temáticos;
- vários perfis, mas um perfil e um lote processados por vez;
- busca assistida por fontes e APIs permitidas, sem scraping irregular;
- variações com narração, texto sobreposto, legendas ou múltiplos trechos;
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
| R02 | Validar descoberta dinâmica | R01 | Ranking manual e ao menos uma fonte/API oficial são comparados; o `top 5` mantém score explicável e cada fonte candidata preserva origem e condição de uso. |
| R03 | Provar o processo criativo | R02 | Processo concierge produz e avalia variações narradas, textuais, legendadas e multitrecho com ferramentas existentes. |
| R04 | Definir domínio e adaptadores | R03 | Estados, invariantes e contratos mínimos de fonte, IA, renderização, publicação, insights, monetização e parceiros são testáveis. |
| R05 | Criar fundação | R04 | Aplicação reproduzível para um operador e múltiplos perfis, com configuração editorial e auditoria mínima. |
| R06 | Implementar descoberta e preparação | R05 | Busca permitida, seleção, importação, transcrição e marcação de trechos funcionam no fluxo principal. |
| R07 | Implementar produção dinâmica | R06 | Roteiro, narração/texto, legendas, composição vertical, revisão, renderização e exportação completam um corte. |
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

- `Source`: localizar candidatos e preservar origem;
- `ContentIntelligence`: transcrever, sugerir trechos e criar roteiro;
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
demonstrou o instrumento, mas não comprova estabilidade: a segunda execução só
pode ocorrer em ou após 01/10/2026. Nenhum lote foi iniciado, e o tempo da
sessão assistida não foi tratado como tempo ativo do operador.

G0 permanece aberto e R02 continua bloqueado. A decisão intermediária é
`iterar R01` até a segunda rodada, a confirmação de três fontes verdes e a
execução medida de L01–L03. Mídia, provas de autorização e outros dados privados
não devem ser adicionados ao repositório.

### R01A — instrumentação antecipada aprovada

Em 25/09/2026, o usuário aprovou antecipar uma aplicação local pequena porque a
repetição manual antes de qualquer instrumento não oferecia retorno suficiente.
R01A não substitui G0: usa YouTube Data API como primeiro sinal oficial, OpenAI
para sugerir agrupamentos e regras determinísticas para validar evidência,
calcular scores, aplicar gates e limitar diversidade.

A fixture da rodada 1 revelou erros aritméticos no registro manual e foi usada
para corrigir scores sem trocar componentes ou pesos. Execuções ao vivo continuam
dependentes de chaves locais não commitadas; vídeo popular não recebe estado
verde automaticamente.

O PR #8 foi mergeado em 25/09/2026 (`6706ba6`). A aplicação local, os nove
testes, a fixture, a revisão humana e os adaptadores de YouTube/OpenAI encerram
R01A. A execução ao vivo permanece uma validação de R01 e não libera G0 nem R02.

## Riscos residuais

- Busca não implica licença de uso; cada fonte precisa manter origem e condição
  declarada antes de processamento ou publicação.
- Acesso, permissões e métricas do Instagram podem mudar e serão revalidados em
  R08 somente em conta profissional de teste.
- Receita pode vir de fontes que o Instagram não expõe; o MVP aceita entrada
  manual/CSV antes de novos adaptadores.
- Conteúdo dinâmico pode não gerar audiência ou lucro; R09 mede, não promete.
- Renderização, transcrição e IA podem inviabilizar custo ou latência; R03 mede
  antes da fundação.
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
