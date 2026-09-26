# Próximo tópico — R02A Contrato, estados e limites do M1

> Executar somente após o merge de V05. Este tópico define o domínio de M1 sem
> receber, armazenar ou inspecionar mídia real.

## Resultado

- Problema: M1 possui limites e estados descritos, mas ainda não tem contrato de
  código que impeça transições inválidas ou dados privados na API.
- Resultado observável: schemas versionados, máquina de estados e configuração
  validada tornam explícito o que R02B–R02F devem obedecer.
- Valor: reduzir retrabalho e testar direitos, segurança e idempotência antes de
  manipular arquivos grandes.

## Persona principal

Operador individual de perfis temáticos em `pt-BR`, responsável por enviar um
vídeo próprio, licenciado ou autorizado e declarar sua origem.

## Escopo

1. Criar contratos versionados para manifesto técnico, declaração de origem,
   revisão humana, alertas e erros sanitizados.
2. Implementar e testar os estados `CREATED`, `UPLOADING`, `UPLOADED`,
   `VALIDATING`, `AWAITING_RIGHTS_REVIEW`, `READY_FOR_TRANSCRIPTION`,
   `UPLOAD_FAILED`, `VALIDATION_FAILED` e `REJECTED`.
3. Impedir `READY_FOR_TRANSCRIPTION` sem validação técnica e revisão humana
   verdes.
4. Invalidar revisão anterior quando declaração ou referência de prova mudar.
5. Definir configuração validada para tamanho, duração, dimensões, contêineres,
   codecs, timeout e retenção de temporários, sem executar `ffprobe`.
6. Garantir que serialização pública rejeite/remova caminhos absolutos, prova
   privada, mídia, segredos e campos desconhecidos.
7. Registrar threat model e política de retenção mínimos para orientar R02B.

## Reuso

- padrões de validação de `src/domain/contracts.js`;
- padrão de revisão humana de `src/store.js`, sem acoplar ativos às runs de
  descoberta;
- convenções atuais de configuração e testes Node.

## Fora de escopo

- endpoint ou interface de upload;
- criação de diretório, streaming ou persistência de mídia;
- hash, assinatura, MIME, `ffprobe` ou deduplicação;
- tabelas SQLite de ativos e auditoria;
- transcrição, OCR, visão, conteúdo, roteiro, edição ou publicação;
- agentes de IA: todas as decisões deste tópico são determinísticas.

## Testes e aceite

- [ ] Schemas aceitam um manifesto mínimo válido e rejeitam campos/tipos
      inválidos com códigos estáveis.
- [ ] Toda transição permitida e proibida possui teste focado.
- [ ] Direitos pendentes/rejeitados ou validação falha bloqueiam o M2.
- [ ] Alteração de declaração/prova invalida aprovação anterior.
- [ ] Configuração fora dos limites falha na inicialização.
- [ ] Serialização pública não expõe caminho ou dado privado.
- [ ] Testes existentes continuam passando e o roadmap registra a evidência.

Este prompt autoriza somente R02A. R02B começa apenas após o merge do PR de
R02A.
