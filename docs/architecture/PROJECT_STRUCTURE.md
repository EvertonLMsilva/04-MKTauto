# Estrutura do projeto

O repositório é um único projeto npm e backend operacional NestJS. Os comandos
são executados na raiz e o frontend React permanece em outro repositório.

```text
src/
  main.ts
  bootstrap.ts
  app.module.ts
  modules/
    project/
    research/
    affiliate/
    content/
    content-operations/
    media/
    publishing/
    finance/
    notifications/
    operations/
  infrastructure/
    administration/
    database/migrations/
python/
  alignment/
  tts/
test/
  support/
test-support/
scripts/
  ops-local/
docker/
docs/
package.json
package-lock.json
nest-cli.json
tsconfig.json
tsconfig.build.json
vitest.config.ts
vitest.config.e2e.ts
.oxlintrc.json
.prettierrc
Dockerfile
compose.live.yml
```

Os módulos mantêm suas divisões reais de application, domain e infrastructure,
controllers, providers e exports. Não foram criados módulos vazios nem serviços
duplicados. Não há utilitários que precisem ser extraídos nesta migração;
`src/shared/` fica reservado para contratos/utilitários realmente compartilhados
quando necessários, sem criar diretório vazio.

## Compilação e recursos

`nest build` usa `src/` como rootDir e gera `dist/main.js`, `dist/bootstrap.js`,
`dist/app.module.js`, `dist/modules/` e `dist/infrastructure/`. Os assets Nest
copiam os 53 SQL sem alterar conteúdo para
`dist/infrastructure/database/migrations/`. O provisioner e os administradores
usam caminhos relativos válidos tanto em source quanto em `dist/`.

`provisionSchema` continua sendo o único mecanismo de migrations. Preserva
ordem, versões e linhagens existentes, incluindo schema 44. A CLI administrativa
`npm run db:provision -- <SQLite-absoluto>` mantém seu target padrão 43;
ops-local provisiona schema 44 explicitamente ao inicializar um root novo.
Bootstrap apenas lê e valida o banco configurado.

Os adapters de Media localizam os scripts em `python/` a partir de sua própria
posição em source ou no pacote compilado. Python continua restrito a TTS e
alinhamento especializados; não é outro backend. Locks, scripts e hashes
foram preservados; modelos e manifests operacionais não são alterados.

## Dependências e testes

Um único `package-lock.json` mantém as mesmas resoluções do backend anterior.
NestJS 12, reflect-metadata e RxJS são dependências de aplicação; TypeScript 6,
Nest CLI, Vitest 4, Vite 8, Oxlint e Prettier compõem as ferramentas existentes.
Não houve atualização oportunista de versões.

Testes unitários podem ficar próximos aos módulos; integração, E2E e fixtures
compartilhadas ficam em `test/`. O runner Node conserva os contratos históricos
e cobre ops-local. O inventário histórico de consumidores permanece intacto;
o teste de desacoplamento traduz os caminhos antigos sem aceitar runtime JS
aposentado. Os comandos completos estão no [README](../../README.md).

## Runtime e preservação

O Dockerfile usa a raiz em todas as etapas da aplicação; o runtime recebe
`dist/`, dependências de produção, metadata npm e `python/`. A allowlist de
`.dockerignore` exclui dados privados, dependências locais, testes e caches.
O Compose conserva integralmente os bind mounts e a imagem operacional não é
substituída por este trabalho.

O pacote compilado é validado sem a árvore `src/`, em banco descartável e com
providers FAKE. Os protocolos de identidade e recuperação de ops-local mantêm
os mesmos arquivos de controle e roles.

Foram removidos somente o README gerado pelo scaffold Nest e a configuração
local de EOL do diretório intermediário aposentado; os demais arquivos foram
movidos ou consolidados. As CLIs aposentadas com consumidores nos testes de
cutover conservam seus guardas explícitos. Documentos de piloto e inventários
históricos mantêm as evidências da época. Nenhum worktree físico, cache privado,
banco, modelo, mídia aprovada ou backup foi removido. Espaço físico recuperado
não foi aferido e não é declarado como economia.
