import { Script } from 'node:vm';
import {
  operationsPage,
  operationsScript,
  operationsStyles,
} from './operations-page.js';

test('operational page has a self-contained script, explicit human decisions and no credential persistence', () => {
  expect(() => new Script(operationsScript)).not.toThrow();
  expect(operationsPage).toContain('Aprovar mídia');
  expect(operationsPage).toContain('Rejeitar versão final');
  expect(operationsPage).toContain('type="password"');
  expect(operationsScript).not.toMatch(
    /localStorage|sessionStorage|innerHTML|document\.cookie/,
  );
  expect(operationsStyles).toContain('@media');
});
