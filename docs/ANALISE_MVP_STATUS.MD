# MKTauto — Repriorização para operação funcional e primeira receita

Diagnóstico preliminar — validação do código atual pendente

Nossa prioridade a partir de agora será colocar o MKTauto funcionando de ponta a ponta, localmente, com o menor conjunto possível de funcionalidades necessárias para produzir conteúdo, publicá-lo e começar a medir receitas.

Vamos inverter a lógica de desenvolvimento anterior: em vez de concluir todos os módulos antes de operar, vamos concluir somente aquilo que impede a primeira operação comercial.

## 1. O que consideraremos um MKTauto funcional

O projeto só estará operacionalmente pronto quando conseguirmos executar este fluxo:

1\. Selecionar produto afiliado

Produto real, oferta verificável e link de comissão

2\. Produzir conteúdo

Roteiro, mídia, voz, vídeo e legenda

3\. Validar e aprovar

Vídeo reproduzível, link correto e direitos de uso

4\. Publicar de verdade

Começar manualmente se a API bloquear o lançamento

5\. Medir resultados

Publicações, cliques e comissões confirmadas

Não vamos exigir que esse fluxo seja completamente automatizado na primeira versão. A automação integral virá depois que a primeira execução comercial estiver comprovada.

Critério central: um vídeo válido, publicado em um canal real, com um produto afiliado correto e uma forma verificável de atribuir os resultados.

## 2. O que já sabemos do projeto

Com base nos resultados anteriores de desenvolvimento e auditoria:

| Componente                  | Situação conhecida                                    | Decisão                           |
| --------------------------- | ----------------------------------------------------- | --------------------------------- |
| Backend NestJS              | Implementado                                          | Preservar como backend principal  |
| SQLite e migrations         | Schema 42 anteriormente validado                      | Reutilizar                        |
| Seleção de produtos         | Base de campanha afiliada existente                   | Validar entrada real              |
| Pesquisa e ideias           | Funcionalidades implementadas                         | Usar apenas o necessário          |
| Geração de roteiro/legendas | Implementada em parte relevante                       | Testar com conteúdo real          |
| Produção de vídeo           | Pipeline existente                                    | Confirmar arquivo MP4 final       |
| Aprovação e direitos        | Regras implementadas                                  | Manter verificações obrigatórias  |
| Instagram fake              | Testes anteriormente aprovados                        | Preservar para testes             |
| Instagram real              | Código anterior identificado, operação não comprovada | Investigar caminho até publicação |
| Agendamento                 | Integração real pendente                              | Não bloquear publicação manual    |
| Frontend                    | Problema de inicialização já observado                | Deixar para a última fase         |

Essa é uma fotografia histórica, não uma certificação do estado atual. A leitura direta do repositório ainda não foi possível: as consultas ao Dev Orchestrator foram bloqueadas ou ficaram indisponíveis. Não vou classificar funcionalidades como testadas hoje sem evidência.

## 3. Repriorização oficial: abandonar a sequência antiga como ordem de execução

O roadmap antigo P1 → P2 → P3 → P4 → P5 → P6 foi construído para concluir a migração arquitetural. Essa etapa já avançou bastante.

Não faz sentido continuar atacando tarefas residuais de migração, organização de fixtures ou remoção de código sem antes provar o funcionamento comercial.

Vamos criar uma trilha de lançamento funcional, preservando os IDs históricos e sem apagar decisões anteriores.

| Nova prioridade | Tópico                 | Objetivo                                          | Esforço relativo |
| --------------- | ---------------------- | ------------------------------------------------- | ---------------- |
| P0.1            | Runtime local          | Subir NestJS, SQLite e dependências               | Baixo            |
| P0.2            | Fluxo comercial        | Executar uma campanha por caminho real do sistema | Médio            |
| P0.3            | Produção de vídeo      | Gerar MP4 comercial completo                      | Médio/alto       |
| P0.4            | Aprovação e exportação | Liberar pacote pronto para publicação             | Baixo/médio      |
| P0.5            | Publicação real        | Publicar primeiro Reel e registrar resultado      | Médio            |
| P0.6            | Medição comercial      | Registrar links, visitas e comissões              | Médio            |
| P0.7            | Rotina repetível       | Produzir novamente após reinício                  | Médio            |
| P1.1            | Automação              | Agendamento e publicação automática               | Médio/alto       |
| P2.1            | Frontend               | Interface operacional consolidada                 | Depois           |

Os esforços são comparativos, não estimativas de horas. Todos precisam ser ajustados após a inspeção do código atual.

### O que vamos tirar do caminho crítico

- Refinamentos visuais, design e reorganização do frontend.
- Google Drive e armazenamento externo, salvo necessidade efetivamente comprovada.
- Infraestrutura de nuvem, Kubernetes, escalabilidade e microsserviços.
- Migração de fixtures e remoção adicional de legado sem dependência funcional.
- Expansão para múltiplas redes sociais, contas e campanhas simultâneas.
- Análise avançada por IA de tendências de todas as plataformas.
- Otimizações sofisticadas, dashboards completos e novos agentes.

Vamos manter somente as proteções diretamente ligadas ao funcionamento correto: não publicar conteúdo sem direitos, não duplicar postagens, não perder o histórico e não fazer chamadas pagas inesperadas.

## 4. Três bloqueios que merecem investigação prioritária

### A. Providers configuráveis não significam geração funcional

Um relatório técnico posterior à migração identificou que os módulos Content e Publishing possuíam configurações fake ou indisponíveis.

Portanto, ter controllers e serviços NestJS registrados não comprova geração real de conteúdo ou publicação real.&#x20;

Pasted text(6).txt



Nossa primeira investigação deve identificar, para cada etapa, qual provider está realmente conectado, quais dependências locais exige e se entrega um artefato utilizável.

Para o primeiro lançamento, devemos preferir FFmpeg, mídia própria e ferramentas locais já existentes. Não precisamos integrar um novo serviço pago de IA se conseguirmos produzir um bom vídeo com os recursos instalados.

### B. A publicação Instagram é o provável maior bloqueio de integração

Uma auditoria anterior encontrou no legado JavaScript um publisher Instagram com operações reais de criação de mídia, consulta de processamento e publicação.

Porém, o levantamento posterior do NestJS informa que o módulo Publishing ainda trabalha com modo fake ou indisponível.&#x20;

Pasted text.txt

Pasted text(6).txt



Isso cria uma decisão importante:

Não ressuscitar o backend legado inteiro. Devemos estudar o adapter que já existia, identificar o que ainda é aproveitável e conectar a capacidade necessária ao módulo Publishing atual.

Outro problema identificado é que a publicação via URL pode exigir que a Meta consiga acessar o vídeo por HTTPS. O armazenamento privado ou simplesmente ter o MP4 no disco local não resolve automaticamente essa exigência.&#x20;

Pasted text.txt



Para não bloquear a primeira receita, proponho:

1. Primeira publicação: exportação local e postagem manual em conta própria.
2. Segunda etapa: adaptar o transporte oficial para publicação automatizada.
3. Terceira etapa: agendamento persistente e reconciliação automática.

Assim conseguimos validar a venda antes de investir no mecanismo de publicação automática.

### C. Ainda falta comprovar a medição comercial completa

O módulo Finance já possui mecanismos de reservas, registros e reconciliação, mas isso não demonstra que o sistema consiga importar efetivamente as comissões de uma plataforma de afiliados.

Precisamos distinguir três informações:

| Informação | Como começaremos                                |
| ---------- | ----------------------------------------------- |
| Publicação | ID/permalink ou registro manual                 |
| Cliques    | Métricas de links ou relatórios da plataforma   |
| Comissões  | Importação de CSV ou lançamento com comprovante |

Não precisamos construir um sistema financeiro completo. Precisamos de um relatório simples que permita responder: qual produto, em qual vídeo, gerou quanto de comissão validada?

## 5. Ordem das primeiras tarefas técnicas

Sugiro executar uma tarefa por vez, sempre com testes focados e sem alterar arquivos fora do escopo aprovado.

MKT-LIVE-001 — Auditoria do caminho crítico

Primeira tarefa

Somente leitura, sem implementar.

Inspecionar especificamente:

- Bootstrap, configuração e persistência SQLite.
- `NativeCampaignWorkflow` e módulos Affiliate, Content, Media, Publishing e Finance.
- Providers concretos efetivamente habilitados.
- Produção de MP4, aprovação e exportação comercial.
- Disponibilidade de publicação manual e integração real.
- Registros de links e comissões.

Entrega: relatório com código/arquivo/linha, comandos de execução, evidência de testes existentes e bloqueios exatos, em ordem de dependência.

MKT-LIVE-002 — Primeira campanha completa offline

Executar produto → roteiro → mídia → render → QC → aprovação → exportação, usando dados comerciais e artefatos reais, sem publicação externa.

Aceite: um MP4 reproduzível, pacote de publicação completo e operação persistida no SQLite.

MKT-LIVE-003 — Primeira publicação comercial

Utilizar uma conta própria, conteúdo aprovado e registro de publicação real.

Aceite: permalink verificável, conteúdo correto e ausência de duplicação.

MKT-LIVE-004 — Primeira medição

Vincular o vídeo ao produto, link afiliado e relatório de comissões.

Aceite: demonstrar a atribuição e conciliação de pelo menos um evento comercial verificável; não exigir uma venda real para considerar o software funcional.

MKT-LIVE-005 — Operação local repetível

Repetir a produção com outro produto ou conteúdo e recuperar uma execução após reiniciar os serviços.

Aceite: nenhuma edição manual do banco ou alteração de código entre campanhas.

## 6. O que vamos considerar pronto

Checklist de lançamento

0/7

Backend NestJS inicia localmente

SQLite, configuração e dependências operacionais

Campanha afiliada é criada

Produto real e link verificável

Vídeo comercial é gerado

MP4 válido com áudio, legenda e mídia permitida

Pacote é aprovado e exportado

Artefatos exatos e metadados corretos

Publicação real é registrada

Postagem no canal próprio e permalink

Resultado comercial é mensurável

Link rastreável e conciliação de comissões

Processo pode ser repetido

Sem modificar código nem banco manualmente

Checklist para registrar nossas próximas validações. Os itens não estão marcados porque ainda não foram revalidados no ambiente local atual.

## 7. O que ainda falta para uma auditoria conclusiva

Consegui recuperar documentação técnica do MKTauto e evidências históricas, mas não consegui acessar diretamente o repositório local nesta consulta. Portanto, não seria correto afirmar que já identifiquei todos os bloqueios atuais.

Para fechar esse diagnóstico, a MKT-LIVE-001 precisa confirmar a branch, HEAD, alterações locais e execução real dos módulos. Também deve verificar se houve alterações depois do último levantamento conhecido.

A arquitetura que devemos preservar é:

`CLI/HTTP mínimo → NestJS → SQLite + FFmpeg + providers locais → exportação/publicação → medição`

Sem novo backend, sem serviços desnecessários e sem frontend como dependência do lançamento.

Minha recomendação final: nossa próxima atividade deve ser exclusivamente a MKT-LIVE-001, não uma implementação. Depois do relatório, atacaremos o primeiro bloqueio funcional comprovado, concluiremos seus testes e abriremos um PR específico para cada tópico implementado.

O objetivo deixa de ser terminar o MKTauto inteiro e passa a ser operar o MKTauto comercialmente, medir os resultados e melhorar apenas o que demonstrar necessidade.&#x20;