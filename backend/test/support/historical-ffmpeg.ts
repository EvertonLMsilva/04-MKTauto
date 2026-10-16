import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Independent normalized process traces, filter graphs, renders and policy
// captured from the retired composer. The native implementation still executes.
const data = JSON.parse(
  readFileSync(new URL('./frozen-ffmpeg.json', import.meta.url), 'utf8'),
);

export function frozenFfmpegAdapter(mode: string): unknown {
  if (!Object.hasOwn(data.adapter, mode))
    throw new Error('Unknown historical FFmpeg mode');
  return normalizedFfmpegTrace(data.adapter[mode]);
}

export function normalizedFfmpegTrace(value: any): any {
  if (typeof value === 'string' && /^<(stage|render)>/.test(value))
    return value.replaceAll('\\', '/');
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(normalizedFfmpegTrace);
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      normalizedFfmpegTrace(child),
    ]),
  );
}

export function frozenFfmpegConfig(
  roots: Record<string, string>,
  node: string,
): unknown {
  function resolve(value: any): any {
    if (typeof value === 'string') {
      if (value === '<node>') return node;
      for (const [key, path] of Object.entries(roots)) {
        const token = `<${key}>`;
        if (value.startsWith(token))
          return join(
            path,
            ...value.slice(token.length).split(/[\\/]/).filter(Boolean),
          );
      }
      return value;
    }
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(resolve);
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, resolve(child)]),
    );
  }
  return resolve(data.config);
}
