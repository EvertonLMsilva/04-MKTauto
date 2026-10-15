import { createHash } from 'node:crypto';
export function adaptationHash(value) { return createHash('sha256').update(stable(value)).digest('hex'); }
function stable(value) { return JSON.stringify(value && typeof value === 'object'
  ? Array.isArray(value) ? value.map(item => JSON.parse(stable(item))) : Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(stable(value[key]))])) : value); }
