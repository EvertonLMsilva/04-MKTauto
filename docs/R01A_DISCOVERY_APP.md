# R01A — aplicação local de descoberta assistida

## Objetivo

Reduzir o custo da descoberta sem transformar IA em autoridade de negócio. A
aplicação coleta sinais permitidos, pede à IA agrupamentos de micronichos e usa
regras locais para calcular scores, aplicar gates e limitar diversidade.

## Responsabilidades

- YouTube Data API: fornece vídeos populares do Brasil e métricas públicas.
- Wikimedia Commons API: encontra arquivos de mídia oficialmente baixáveis e
  preserva origem, licença declarada, termos e necessidade de atribuição.
- Ollama local: agrupa os sinais e sugere candidatos ligados aos IDs de
  evidência recebidos, sem enviar os sinais a um provedor externo de IA.
- Domínio local: rejeita evidência desconhecida, valida componentes, calcula as
  notas, aplica gates e monta o top 5 elegível ou o ranking provisório com
  direitos pendentes.
- Operador: confirma direitos, segurança, relevância e aprovação final.

A integração usa Structured Outputs com JSON Schema, conforme a
[documentação oficial do Ollama](https://docs.ollama.com/capabilities/structured-outputs).
Vídeo popular no YouTube sempre entra com fonte verde `false`; popularidade não
é licença de adaptação.

A busca de mídia aceita somente licenças explícitas do recorte (`CC0`, domínio
público e `CC BY`) e nunca promove a fonte automaticamente. A confirmação verde
continua humana; o arquivo e a prova detalhada permanecem fora do Git.

## Execução

```powershell
npm test
npm start
```

Sem a chave do YouTube, a interface carrega os 20 candidatos da rodada 1 por
fixture. A execução atual requer o Ollama ativo e, no ambiente:

- `YOUTUBE_API_KEY`;
- `OLLAMA_MODEL`, opcional, com default `qwen3:4b`;
- `OLLAMA_BASE_URL`, opcional, com default `http://127.0.0.1:11434`;
- `OLLAMA_NUM_CTX`, opcional, com default `16384` para limitar memória local;
- `PORT`, opcional, com default `3000`.

O banco local fica em `data/mktauto.sqlite` e não entra no Git. A aplicação não
armazena chaves, descrições completas de vídeos, mídia ou provas de direito.

## Limites deste corte

- apenas uma API de sinais ao vivo, diversificada por categorias oficiais;
- a aplicação registra URLs oficiais, mas mídia, transcrição, edição e
  publicação permanecem fora dela;
- sem decisão automática de direitos;
- sem promoção automática de nicho;
- execução ao vivo depende da chave local do YouTube e do Ollama ativo.

## Aceite demonstrável

- fixture da rodada 1 produz 20 candidatos e o top 5 recalculado;
- operador pode aprovar ou rejeitar localmente cada item do top 5;
- pesos são lidos de `config/discovery.json`;
- candidato sem fonte verde não entra no top 5;
- candidato que falha somente em fonte verde pode aparecer no ranking
  provisório, sem promoção automática;
- evidência inventada pela IA é rejeitada;
- no máximo dois candidatos do mesmo macronicho entram no top 5;
- testes não realizam chamadas pagas nem consomem quota.
