# Próximo tópico — R02 Ingestão e compreensão do vídeo enviado

> Executar somente após o merge de V02. Este tópico prova a entrada upload-first
> antes de automatizar roteiro, narração, legendas ou renderização final.

## Resultado

- Problema: o sistema ainda não recebe um vídeo e não produz um contexto local,
  estruturado e reproduzível para a criação editorial.
- Resultado observável: um vídeo fornecido pelo operador gera validação técnica,
  hash, transcrição com timestamps e análise visual quando a fala não for
  suficiente.
- Valor esperado: dar ao Ollama contexto confiável para criar conteúdo novo no
  tópico seguinte, sem enviar mídia privada a um provedor externo.

## Persona principal

Operador individual de perfis temáticos em `pt-BR`, responsável por fornecer um
vídeo próprio, licenciado ou autorizado e revisar o contexto extraído.

## Escopo

1. Receber um vídeo local mantido fora do Git e uma declaração de origem/direito.
2. Validar allowlist de contêiner/MIME, duração, tamanho e integridade; calcular
   SHA-256 e impedir duplicação acidental.
3. Extrair áudio mono 16 kHz com FFmpeg para área temporária ignorada.
4. Transcrever localmente com `faster-whisper`, incluindo idioma e timestamps por
   segmento; timestamps por palavra entram somente se custo e precisão permitirem.
5. Definir um critério determinístico de transcrição insuficiente ou ausência de
   fala.
6. Para esse caso, amostrar quadros e avaliar um modelo de visão local no Ollama,
   sem enviar o vídeo completo ao modelo.
7. Produzir um pacote JSON versionado com metadados, transcrição, descrição
   visual, alertas e referências temporais.
8. Medir tempo ativo, espera, CPU/GPU, memória, falhas e retrabalho.

## Fora de escopo

- Criar roteiro, narração, legenda final ou renderizar o corte; isso pertence a
  R03.
- Receber vários vídeos no mesmo item; composição multivídeo está no backlog
  pós-MVP.
- Buscar ou baixar vídeos da internet.
- Publicar, integrar Instagram ou criar armazenamento público.
- Colocar mídia, áudio, transcrição privada, modelos ou dados pessoais no Git.

## Base mínima

- Git em `main` após o merge de V02.
- FFmpeg disponível localmente.
- Python isolado para `faster-whisper` e Ollama local ativo.
- Um vídeo com fala e um vídeo sem fala suficiente, ambos com direito de uso
  declarado pelo operador.

## Aceite

- [ ] Upload válido produz hash e metadados técnicos reproduzíveis.
- [ ] Vídeo com fala produz transcrição local com timestamps úteis.
- [ ] Vídeo sem fala suficiente aciona análise visual local e registra o motivo.
- [ ] O pacote de contexto referencia somente intervalos existentes na entrada.
- [ ] Tempos, recursos, falhas e retrabalho são medidos.
- [ ] Nenhuma mídia, transcrição privada ou segredo entra no Git.
- [ ] R03 recebe contrato e evidência suficientes para criar roteiro e plano de
      corte novos.

Este prompt autoriza somente o spike de ingestão e compreensão local. Não
autoriza publicação nem implementação antecipada do motor completo.
