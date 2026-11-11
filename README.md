# MKTauto

Backend NestJS modular para a operação Affiliate-First: projetos e snapshots,
pesquisa, catálogo de produtos autorizados, conteúdo, mídia, custos e publicação
com os gates existentes de direitos, QC e aprovação humana da versão exata.
O frontend React permanece em repositório separado.

## Instalação e execução

Requer Node.js 24 ou superior. Python é necessário para os testes e adapters
especializados; FFmpeg, vozes e modelos dependem da configuração local autorizada.

```powershell
npm ci
npm run build
npm run db:provision -- 'D:\caminho-absoluto\ambiente-descartavel.sqlite'
```

Configure as variáveis descritas em `.env.example`, incluindo
`PROJECT_API_DATABASE` com caminho absoluto para o banco do ambiente autorizado.
A inicialização apenas valida o banco; não aplica migrations automaticamente.
O comando administrativo acima mantém o target padrão 43 do provisioner.
Schema 44 é suportado explicitamente por `provisionSchema(db, 44)` e pelo
`init` de ops-local para um piloto novo. Os testes usam somente SQLite descartável.

```powershell
npm start
npm run start:dev
npm run start:prod
```

`start` e `start:prod` executam `dist/main.js` e carregam `.env` quando existir.
`start:dev` usa Nest em watch e requer as variáveis exportadas no processo.
A porta padrão é 3000. A configuração real define os providers e gates;
iniciar o código não concede autorização para operação LIVE.

## Comandos e validação

| Comando | Comportamento |
| --- | --- |
| `npm run build` | Compila NestJS e copia os recursos SQL para `dist/` |
| `npm run lint` | Oxlint com análise de tipos em `src/` e `test/` |
| `npx tsc --noEmit --incremental false` | Verifica os tipos da aplicação e testes |
| `npm test` | Build, testes Node/ops-local e testes unitários NestJS |
| `npm run test:node` | Build e runner Node, incluindo os protocolos de ops-local |
| `npm run test:unit` | Vitest: testes `*.spec.ts` |
| `npm run test:e2e` | Vitest: testes `*.e2e-spec.ts` |
| `npm run test:python` | Unittest de alinhamento e TTS |
| `npm run test:compiled` | Pacote sem `src/`: SQL, schema 44, bootstrap e Project HTTP |
| `npm run test:all` | Node, unitários NestJS, E2E e Python |

Os testes comuns usam fakes/mocks para integrações externas. O smoke CTC com
modelo real permanece opt-in; não baixa modelos durante os testes comuns.

A CLI pública encaminha os comandos suportados à API NestJS:

```powershell
npm run project -- create --input .\project-create.json --api-url http://127.0.0.1:3000
npm run project -- latest --project-id project_001 --api-url http://127.0.0.1:3000
npm run trend:shortlist -- --input .\shortlist.json --api-url http://127.0.0.1:3000
npm run preview -- --render-id render_001 --api-url http://127.0.0.1:3000
```

Também aceita `MKTAUTO_API_URL` como origem da API. Os payloads preservam seus
contratos e chaves de idempotência. A CLI não abre bancos diretamente.
As entradas aposentadas `start:legacy`, `video:live`, `trend:daily`,
`trend:export`, `drive:authorize` e `drive:upload` permanecem como guardas de
compatibilidade: retornam `COMMAND_UNAVAILABLE`, sem executar um runtime antigo.

## Estrutura e recursos

- [Estrutura do projeto](docs/architecture/PROJECT_STRUCTURE.md).
- [Mapa de módulos NestJS](docs/architecture/NESTJS_MODULE_MAP.md).
- Aplicação: `src/main.ts`, `src/bootstrap.ts`, `src/app.module.ts` e `src/modules/`.
- Administração: `src/infrastructure/administration/`.
- SQL: `src/infrastructure/database/migrations/`; o build empacota os mesmos
  arquivos em `dist/infrastructure/database/migrations/`.
- Python especializado: `python/alignment/` e `python/tts/`, invocado pelos
  adapters de Media. Requirements, algoritmos, modelos e direitos são preservados.

O diretório intermediário antigo não contém mais arquivos versionados.
Diretórios ignorados de checkouts anteriores não devem ser apagados por esse motivo.
Não há segundo backend, scheduler ou catálogo.

## Operação local e Docker

A partir da raiz com build e dependências instalados:

```powershell
node scripts/ops-local/cli.mjs status --root '<root-absoluto-do-piloto>'
```

A CLI preserva identidade de workers, start/status/stop, histórico e recuperação.
Seu `init` provisiona somente um root novo, conforme os recursos e a identidade
QC explicitamente fornecidos. Não reutilize bancos operacionais como fixtures.
O [registro do piloto OPS-001](docs/operations/MKTAUTO-OPS-001.md) conserva suas
evidências e caminhos históricos.

O Dockerfile compila na raiz e empacota `dist/`, `node_modules/`, `package.json`
e `python/`. O comando do container é `node dist/main.js`. Os bind mounts e
nomes operacionais em `compose.live.yml` foram preservados. A imagem de produção
existente continua independente desta migração; deploy, substituição da imagem,
reinício, schedulers, gastos e publicação exigem autorização operacional própria.

Segredos, modelos, bancos, mídias privadas, evidências e logs ficam fora do Git.
As regras obrigatórias de trabalho estão em [AGENTS.md](AGENTS.md).
