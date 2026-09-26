# Próximo tópico — R02 Módulo 1: identificação de vídeos

> Executar somente após o merge de V04. Este tópico implementa e prova apenas o
> primeiro módulo; transcrição, compreensão e edição pertencem aos módulos
> seguintes.

## Resultado

- Problema: o sistema ainda não recebe um arquivo de vídeo com identidade,
  origem, direitos e metadados técnicos reproduzíveis.
- Resultado observável: um upload local válido produz um `VideoAssetManifest`
  versionado, persistido e aprovado para seguir ao M2.
- Valor esperado: impedir que arquivos duplicados, inválidos ou sem condição de
  uso conhecida consumam transcrição e IA.

## Persona principal

Operador individual de perfis temáticos em `pt-BR`, responsável por enviar um
vídeo próprio, licenciado ou autorizado e declarar sua origem.

## Escopo

1. Criar entrada local de um vídeo por item, mantendo a mídia em diretório
   privado e ignorado pelo Git.
2. Exigir declaração de origem e condição de uso; decisão verde continua humana
   e determinística.
3. Validar nome, extensão, assinatura/MIME, contêiner, codecs, duração, resolução,
   tamanho e integridade com regras locais e `ffprobe`.
4. Calcular SHA-256 em streaming, detectar duplicação e atribuir ID interno.
5. Impedir path traversal, sobrescrita, exposição pela pasta pública e arquivos
   acima dos limites configurados.
6. Persistir `VideoAssetManifest` versionado sem caminho privado exposto pela API.
7. Modelar estados mínimos `UPLOADED`, `VALIDATING`, `READY_FOR_TRANSCRIPTION`,
   `VALIDATION_FAILED` e `REJECTED` com transições testadas e idempotentes.
8. Registrar tempo ativo, espera, custo, falhas, retrabalho e motivo de rejeição.
9. Reutilizar store, revisão humana e contratos existentes sempre que o limite
   do módulo permitir.

## Fora de escopo

- Extrair áudio, transcrever, executar OCR ou analisar quadros; isso é M2/R03.
- Identificar tema, fatos, momentos ou ângulos editoriais; isso é M3/R04.
- Criar roteiro, narração, legenda ou renderização; isso é M4/R05.
- Otimizar hook, ritmo ou metadados; isso é M5/R06.
- Receber vários arquivos no mesmo item, criar react, publicar ou integrar
  Instagram.
- Colocar mídia, provas privadas, caminhos locais ou dados pessoais no Git.

## Contrato mínimo

`VideoAssetManifest` deve conter somente dados sanitizados:

- versão do schema e ID interno;
- SHA-256, tamanho, MIME/contêiner e codecs;
- duração, largura, altura, fps e presença de áudio;
- origem e condição de uso declaradas, estado de direitos e revisão;
- estado do item, alertas técnicos e timestamps de criação/validação;
- referência opaca ao armazenamento privado, nunca caminho absoluto na API.

## Aceite

- [ ] Upload válido chega a `READY_FOR_TRANSCRIPTION` com manifesto reproduzível.
- [ ] Mesmo conteúdo não cria segundo ativo silenciosamente.
- [ ] Arquivo inválido, grande demais ou com caminho malicioso é rejeitado.
- [ ] Direitos pendentes impedem avanço ao M2.
- [ ] Transições, idempotência e contrato possuem testes focados.
- [ ] API não expõe caminho privado nem serve a mídia como arquivo público.
- [ ] Métricas do módulo são registradas sem mídia ou dados privados no Git.
- [ ] M2 recebe somente manifestos aprovados e tecnicamente válidos.

Este prompt autoriza somente M1. Não autoriza iniciar transcrição, agentes de
conteúdo, edição, refino, publicação ou os itens pós-MVP.
