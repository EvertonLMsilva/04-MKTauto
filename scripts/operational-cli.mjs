import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const unavailable = (command) => new Error(`COMMAND_UNAVAILABLE: ${command}; sem equivalente NestJS validado nesta entrada. Use os contratos públicos NestJS suportados.`);

// HTTP adapter only: no database access, provider execution or legacy imports.
export async function run(argv, dependencies = {}) {
  const [entry, ...args] = argv;
  if (!['project', 'preview', 'trend:shortlist'].includes(entry)) throw unavailable(entry);
  const command = entry === 'project' ? args.shift() : entry === 'preview' ? 'render' : 'shortlist';
  if (entry === 'project' && !['create', 'version', 'archive', 'latest', 'get', 'review', 'select'].includes(command)) throw unavailable(`project ${command}`);
  if (entry === 'preview' && !args.includes('--render-id')) throw unavailable('preview pipeline; consulta disponível: preview --render-id ID --api-url URL');
  const allowed = command === 'render' ? ['render-id'] : ['create', 'version', 'archive', 'shortlist'].includes(command) ? ['input'] : command === 'latest' ? ['project-id'] : ['project-id', 'version'];
  const options = {};
  if (args.length % 2) throw new Error('INVALID_OPTION: use --nome valor');
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].slice(2);
    if (!args[i].startsWith('--') || ![...allowed, 'api-url'].includes(key) || key in options || !args[i + 1]) throw new Error('INVALID_OPTION');
    options[key] = args[i + 1];
  }
  for (const key of allowed) if (!options[key]) throw new Error(`REQUIRED_OPTION: ${key}`);
  const env = dependencies.env ?? process.env;
  const base = options['api-url'] ?? env.MKTAUTO_API_URL;
  if (!base) throw new Error('API_URL_REQUIRED: configure MKTAUTO_API_URL ou --api-url');
  const url = new URL(base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('INVALID_API_URL: informe a origem HTTP NestJS');
  let path;
  let body;
  const encode = encodeURIComponent;
  if (command === 'render') path = `/media/renders/${encode(options['render-id'])}`;
  else if (command === 'shortlist') {
    path = '/research/shortlists';
    body = JSON.parse((dependencies.readText ?? ((file) => readFileSync(file, 'utf8')))(options.input));
  }
  else if (['create', 'version', 'archive'].includes(command)) {
    body = JSON.parse((dependencies.readText ?? ((file) => readFileSync(file, 'utf8')))(options.input));
    const id = command === 'archive' ? body.projectId : body.project?.id;
    if (command !== 'create' && typeof id !== 'string') throw new Error('PROJECT_ID_REQUIRED');
    path = command === 'create' ? '/projects' : `/projects/${encode(id)}/${command === 'version' ? 'versions' : 'archive'}`;
  } else {
    path = `/projects/${encode(options['project-id'])}`;
    if (command !== 'latest') {
      if (!/^[1-9]\d*$/.test(options.version) || !Number.isSafeInteger(Number(options.version))) throw new Error('INVALID_VERSION');
      path += `/versions/${options.version}`;
    }
  }
  const response = await (dependencies.fetch ?? fetch)(new URL(path, url), {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    redirect: 'error', signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`NEST_HTTP_${response.status}: operação rejeitada; sem fallback legado`);
  return response.json();
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { process.stdout.write(`${JSON.stringify(await run(process.argv.slice(2)), null, 2)}\n`); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
