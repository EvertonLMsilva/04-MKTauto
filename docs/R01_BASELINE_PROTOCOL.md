# R01 — protocolo de fluxo real e baseline interno

## Objetivo e limites

Medir como um operador individual transforma três fontes autorizadas em cortes
verticais revisáveis usando ferramentas já existentes. Este protocolo não cria
aplicação, não automatiza o fluxo e não autoriza publicação.

Mídia, autorizações, nomes pessoais, URLs privadas e arquivos renderizados ficam
fora do Git. No repositório entram apenas identificadores sanitizados e métricas
agregadas.

## Desenho do exercício

- Executar três lotes, um perfil por vez.
- Preferir três nichos do portfólio; usar menos nichos somente quando o registro
  final explicar como o recorte reduz variáveis sem comprometer G0.
- Cada lote parte de uma fonte própria, licenciada ou autorizada, cuja prova é
  conferida antes do cronômetro e referenciada apenas por um ID interno.
- Produzir, a partir da mesma fonte de cada lote, uma versão de cada família:
  narrada, texto sobre vídeo, legendada e multitrecho.
- Não publicar. A saída termina em exportação local e revisão humana da versão
  exata.

O exercício planejado contém 3 fontes e 12 variações. A quantidade candidata do
lote inicial será decidida depois das medições, não presumida por este protocolo.

## Preparação de cada lote

Registrar fora do Git a prova de direito de uso. No resumo sanitizado, preencher:

| Campo | Registro permitido no Git |
|---|---|
| Lote | `L01`, `L02` ou `L03` |
| Perfil/nicho | Nome genérico, sem conta ou pessoa identificável |
| Fonte | ID interno não reversível |
| Condição de uso | `própria`, `licenciada` ou `autorizada` |
| Prova conferida | `sim` ou `não`; sem anexar a prova |
| Entrada | Duração, resolução e tamanho, sem nome de arquivo |
| Ferramentas | Nome e versão; sem conta, token ou caminho privado |
| Limites prévios | Teto de tempo ativo e custo aceito pelo operador |

Um lote não começa se a origem, a condição de uso ou a prova aplicável não
estiverem registradas.

## Medição do fluxo

Cronometrar cada etapa com um relógio monotônico. `Tempo ativo` é o período em
que o operador toma decisões ou manipula a ferramenta. `Espera` é processamento
sem intervenção. Pausas pessoais não entram em nenhum dos dois.

| Etapa | Ativo (min) | Espera (min) | Custo incremental (R$) | Falhas | Retrabalhos | Saída |
|---|---:|---:|---:|---:|---:|---|
| Busca | | | | | | candidatos |
| Seleção e direitos | | | | | | fonte válida |
| Roteiro | | | | | | roteiro revisado |
| Corte | | | | | | trechos montados |
| Narração/texto | | | | | | camada editorial |
| Legendas | | | | | | legenda revisada |
| Revisão | | | | | | decisão humana |
| Renderização | | | | | | versão exata |
| Exportação | | | | | | arquivo local |
| **Total do lote** | | | | | | |

Uma `falha` impede a saída esperada da etapa. Um `retrabalho` é a repetição de
uma etapa já concluída. Para cada ocorrência, registrar categoria, etapa de
origem, minutos ativos adicionais e se alterou roteiro, fonte ou estrutura.

Custos incluem somente consumo incremental atribuível ao lote. Assinaturas já
pagas são registradas separadamente e rateadas apenas se isso for necessário
para a decisão.

## Rubric definida antes da execução

Cada versão recebe nota inteira de 1 a 5, exceto segurança, que é um gate.

| Critério | 1 | 3 | 5 |
|---|---|---|---|
| Utilidade | sem valor reconhecível | entrega parte da promessa | entrega completa e acionável |
| Dinamismo | ritmo prejudica retenção | ritmo adequado com pontos fracos | ritmo e mudanças sustentam atenção |
| Clareza | mensagem confusa | compreensível com esforço | compreensão imediata |
| Fidelidade | distorce a fonte | pequenas imprecisões sem mudar sentido | preserva sentido, contexto e atribuição |
| Segurança | reprova se houver dúvida de direito, política, pessoa, marca, música ou alegação | — | aprova somente sem pendência identificada |

Uma versão é `aceitável` quando segurança aprova, nenhuma das outras notas é
menor que 3 e a média dessas quatro notas é pelo menos 4,0.

`Edição leve` exige no máximo 10 minutos ativos e não pode trocar fonte, formato,
estrutura principal ou sentido. São permitidos ajustes locais de texto, timing,
volume, enquadramento ou uma correção de legenda. Acima disso, classificar como
edição substancial.

## Resumo sanitizado por formato

| Lote | Formato | Duração (s) | Resolução | Tamanho (MB) | Ativo (min) | Espera (min) | Custo (R$) | Retrabalho (min) | U | D | C | F | Segurança | Decisão |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| L01 | narrado | | | | | | | | | | | | | |
| L01 | texto | | | | | | | | | | | | | |
| L01 | legendado | | | | | | | | | | | | | |
| L01 | multitrecho | | | | | | | | | | | | | |
| L02 | narrado | | | | | | | | | | | | | |
| L02 | texto | | | | | | | | | | | | | | | |
| L02 | legendado | | | | | | | | | | | | | |
| L02 | multitrecho | | | | | | | | | | | | | |
| L03 | narrado | | | | | | | | | | | | | |
| L03 | texto | | | | | | | | | | | | | | | |
| L03 | legendado | | | | | | | | | | | | | | | |
| L03 | multitrecho | | | | | | | | | | | | | |

## Decisão ao final de R01

- `avançar R02`: os três lotes foram fornecidos e concluídos, com origem e
  condição de uso registradas, e todas as etapas possuem tempo ativo, espera,
  custo, falha e retrabalho. Isso satisfaz G0; qualidade criativa continua sendo
  evidência para o recorte, não substitui G1.
- `iterar R01`: um ou dois lotes terminaram, ou há lacunas de medição corrigíveis
  em uma nova rodada curta, sem dúvida de direitos ou segurança.
- `stop/reposicionar`: nenhum lote válido pode ser fornecido/executado, há risco
  de direitos sem resolução, ou o fluxo excede os limites de tempo/custo que o
  operador declarou antes do teste sem existir um recorte menor útil.

O fechamento agrega medianas e totais por etapa, lote e formato; registra o
menor formato, duração, resolução, tamanho e quantidade de lote sustentados pela
evidência; e não inclui mídia nem evidência privada.
