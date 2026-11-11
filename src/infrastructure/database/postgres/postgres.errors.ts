import { DatabaseError } from 'pg';

export class PostgresError extends Error {
  constructor(
    readonly code: string,
    readonly sqlState?: string,
  ) {
    super(code);
    this.name = 'PostgresError';
  }
}

export function postgresFailure(code: string, error: unknown): PostgresError {
  const candidate =
    error && typeof error === 'object' && 'code' in error
      ? error.code
      : undefined;
  const sqlState =
    typeof candidate === 'string' && /^[0-9A-Z]{5}$/.test(candidate)
      ? candidate
      : undefined;
  return new PostgresError(code, sqlState);
}

export function isPostgresDriverError(error: unknown): boolean {
  if (error instanceof DatabaseError) return true;
  if (!error || typeof error !== 'object') return false;
  if (
    'code' in error &&
    typeof error.code === 'string' &&
    (/^[0-9A-Z]{5}$/.test(error.code) ||
      /^(ECONNREFUSED|ECONNRESET|ENETUNREACH|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH)$/.test(
        error.code,
      ))
  )
    return true;
  return (
    error instanceof Error &&
    /^(Connection terminated|Connection closed|timeout exceeded when trying to connect)/.test(
      error.message,
    )
  );
}
