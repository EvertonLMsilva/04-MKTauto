import { PostgresError } from './postgres.errors.js';

export const POSTGRES_CONFIG = Symbol('POSTGRES_CONFIG');
export interface PostgresConfig {
  readonly host: string;
  readonly port: number;
  readonly database: 'mktauto';
  readonly user: string;
  readonly password: string;
  readonly ssl?: boolean;
  readonly max?: number;
  readonly connectionTimeoutMillis?: number;
  readonly idleTimeoutMillis?: number;
}
export type PostgresConnectionConfig = PostgresConfig;

export function validatePostgresConfig(config: PostgresConfig): PostgresConfig {
  if (
    !config ||
    !config.host ||
    !config.user ||
    !config.password ||
    !config.database ||
    config.port === undefined
  )
    throw new PostgresError('POSTGRES_CONFIGURATION_REQUIRED');
  if (
    typeof config.host !== 'string' ||
    config.host !== config.host.trim() ||
    /[\s\0]/.test(config.host) ||
    typeof config.user !== 'string' ||
    config.user !== config.user.trim() ||
    /[\r\n\0]/.test(config.user) ||
    typeof config.password !== 'string' ||
    config.password.includes('\0') ||
    config.database !== 'mktauto' ||
    !Number.isInteger(config.port) ||
    config.port < 1 ||
    config.port > 65535 ||
    (config.ssl !== undefined && typeof config.ssl !== 'boolean')
  )
    throw new PostgresError('POSTGRES_CONFIGURATION_INVALID');
  const max = config.max ?? 10;
  const connectionTimeoutMillis = config.connectionTimeoutMillis ?? 5000;
  const idleTimeoutMillis = config.idleTimeoutMillis ?? 30000;
  if (
    !Number.isInteger(max) ||
    max < 1 ||
    max > 100 ||
    !Number.isInteger(connectionTimeoutMillis) ||
    connectionTimeoutMillis < 1 ||
    connectionTimeoutMillis > 3600000 ||
    !Number.isInteger(idleTimeoutMillis) ||
    idleTimeoutMillis < 1 ||
    idleTimeoutMillis > 3600000
  )
    throw new PostgresError('POSTGRES_CONFIGURATION_INVALID');
  // Select fields explicitly: connectionString and arbitrary pg options cannot override identity.
  return Object.freeze({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: config.ssl ?? false,
    max,
    connectionTimeoutMillis,
    idleTimeoutMillis,
  });
}

export function loadPostgresConfig(
  env: NodeJS.ProcessEnv = process.env,
): PostgresConfig {
  const required = [
    'POSTGRES_HOST',
    'POSTGRES_PORT',
    'POSTGRES_DATABASE',
    'POSTGRES_USER',
    'POSTGRES_PASSWORD',
  ];
  if (required.some((key) => !env[key]))
    throw new PostgresError('POSTGRES_CONFIGURATION_REQUIRED');
  if (
    !/^\d+$/.test(env.POSTGRES_PORT!) ||
    (env.POSTGRES_SSL !== undefined &&
      !['true', 'false'].includes(env.POSTGRES_SSL))
  )
    throw new PostgresError('POSTGRES_CONFIGURATION_INVALID');
  return validatePostgresConfig({
    host: env.POSTGRES_HOST!,
    port: Number(env.POSTGRES_PORT),
    database: env.POSTGRES_DATABASE as 'mktauto',
    user: env.POSTGRES_USER!,
    password: env.POSTGRES_PASSWORD!,
    ssl: env.POSTGRES_SSL === 'true',
  });
}
