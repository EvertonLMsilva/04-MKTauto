# R01A — aplicação local de descoberta assistida

## Objetivo

Reduzir o custo da descoberta sem transformar IA em autoridade de negócio. A
aplicação coleta sinais permitidos, pede à IA agrupamentos de micronichos e usa
regras locais para calcular scores, aplicar gates e limitar diversidade.

## Responsabilidades

- YouTube Data API: fornece vídeos populares do Brasil e métricas públicas.
- OpenAI Responses API: agrupa os sinais e sugere candidatos ligados aos IDs de
  evidência recebidos.
- Domínio local: rejeita evidência desconhecida, valida componentes, calcula as
  notas, aplica gates e monta o top 5.
- Operador: confirma direitos, segurança, relevância e aprovação final.

A integração usa Structured Outputs com JSON Schema, conforme a
[documentação oficial da OpenAI](https://developers.openai.com/api/docs/guides/structured-outputs).
Vídeo popular no YouTube sempre entra com fonte verde `false`; popularidade não
é licença de adaptação.

## Execução

```powershell
npm test
npm start
```

Sem chaves, a interface carrega os 20 candidatos da rodada 1 por fixture. A
execução atual requer no ambiente:

- `YOUTUBE_API_KEY`;
- `OPENAI_API_KEY`;
- `OPENAI_MODEL`, opcional, com default `gpt-6-astra`;
- `PORT`, opcional, com default `3000`.

O banco local fica em `data/mktauto.sqlite` e não entra no Git. A aplicação não
armazena chaves, descrições completas de vídeos, mídia ou provas de direito.

## Limites deste corte

- apenas uma fonte de sinais ao vivo;
- sem download, transcrição, edição ou publicação;
- sem decisão automática de direitos;
- sem promoção automática de nicho;
- sem execução ao vivo validada quando as chaves não estiverem disponíveis.

## Aceite demonstrável

- fixture da rodada 1 produz 20 candidatos e o top 5 recalculado;
- operador pode aprovar ou rejeitar localmente cada item do top 5;
- pesos são lidos de `config/discovery.json`;
- candidato sem fonte verde não entra no top 5;
- evidência inventada pela IA é rejeitada;
- no máximo dois candidatos do mesmo macronicho entram no top 5;
- testes não realizam chamadas pagas nem consomem quota.
