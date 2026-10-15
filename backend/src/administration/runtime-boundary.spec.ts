import { readFileSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

it('keeps all transitive runtime imports inside the native backend', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const visited = new Set<string>();
  function visit(file: string) {
    if (visited.has(file)) return;
    visited.add(file);
    const fromRoot = relative(root, file);
    expect(fromRoot.startsWith('..') || isAbsolute(fromRoot)).toBe(false);
    const source = readFileSync(file, 'utf8');
    const imports = [
      ...source.matchAll(
        /(?:from\s*|import\s*\(\s*|import\s*)['"]([^'"]+)['"]/g,
      ),
    ];
    for (const match of imports) {
      const name = match[1]!;
      if (name.startsWith('.'))
        visit(resolve(dirname(file), name.replace(/\.js$/, '.ts')));
    }
  }
  visit(resolve(root, 'main.ts'));
  visit(resolve(root, 'administration/provision.ts'));
  expect(visited.size).toBeGreaterThan(20);
});
