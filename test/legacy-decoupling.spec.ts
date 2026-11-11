import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const legacyRoot = resolve(root, 'src');
const inventory = JSON.parse(
  readFileSync(
    new URL(
      '../docs/tasks/P6-LEGACY-REMAINDER-001.inventory.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as { consumers: string[] };

it('keeps the residual mixed-test consumers independent from the retired JS runtime', () => {
  const imports: string[] = [];
  for (const name of [
    ...inventory.consumers,
    'test/support/historical-residual-contracts.ts',
    'test/support/historical-residual-persistence.ts',
  ]) {
    const current = name.replace(/^backend\/src\/administration\//, 'src/infrastructure/administration/').replace(/^backend\/src\//, 'src/modules/').replace(/^backend\/test\//, 'test/');
    const path = resolve(root, current);
    const source = ts.createSourceFile(
      name,
      readFileSync(path, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    function visit(node: ts.Node) {
      if (
        ts.isStringLiteralLike(node) &&
        node.text.startsWith('.') &&
        node.text.endsWith('.js')
      ) {
        const target = relative(legacyRoot, resolve(dirname(path), node.text));
        if (!target.startsWith('..') && !isAbsolute(target) && !existsSync(resolve(dirname(path), node.text.replace(/\.js$/, '.ts'))))
          imports.push(`${name}: ${node.text}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  expect(imports).toEqual([]);
});
