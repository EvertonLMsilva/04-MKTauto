import { createHash } from 'node:crypto';
export function adaptationHash(value: any): any {
  return createHash('sha256').update(stable(value)).digest('hex');
}
function stable(value: any): any {
  return JSON.stringify(
    value && typeof value === 'object'
      ? Array.isArray(value)
        ? value.map((item: any) => JSON.parse(stable(item)))
        : Object.fromEntries(
            Object.keys(value)
              .sort((a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0))
              .map((key: any) => [key, JSON.parse(stable(value[key]))]),
          )
      : value,
  );
}
