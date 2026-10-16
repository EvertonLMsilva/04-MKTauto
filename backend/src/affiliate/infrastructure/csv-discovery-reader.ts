import { createReadStream } from 'node:fs';
import { catalogError, errorCode } from './discovery-error.js';
export interface CsvOptions {
  delimiter: string;
  maxRecordChars: number;
  columns: Record<string, string>;
  recoverRecords?: boolean;
}
type CsvRecord = string[] | { errorCode: string };

// Memory is bounded by the stream chunk and configured maximum record length.
export async function* csvRecords(
  path: string,
  { delimiter, maxRecordChars, recoverRecords = false }: CsvOptions,
): AsyncGenerator<CsvRecord> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const stream = createReadStream(path);
  let row: string[] = [],
    field = '',
    state = 'START',
    length = 0,
    skipLF = false,
    first = true;
  let recordError: string | null = null;
  function consume(char: string): string[] | undefined {
    if (first) {
      first = false;
      if (char === '\uFEFF') return;
    }
    if (skipLF) {
      skipLF = false;
      if (char === '\n') return;
    }
    if (++length > maxRecordChars)
      throw catalogError('EXTERNAL_CATALOG_RECORD_TOO_LARGE');
    if (state === 'QUOTED') {
      if (char === '"') state = 'AFTER';
      else field += char;
      return;
    }
    if (state === 'AFTER' && char === '"') {
      field += char;
      state = 'QUOTED';
      return;
    }
    if (char === delimiter || char === '\n' || char === '\r') {
      row.push(field);
      field = '';
      state = 'START';
      if (char === delimiter) return;
      const complete = row;
      row = [];
      length = 0;
      skipLF = char === '\r';
      return complete;
    }
    if (state === 'AFTER' || (char === '"' && state !== 'START'))
      throw catalogError('EXTERNAL_CATALOG_INVALID_CSV');
    if (char === '"') state = 'QUOTED';
    else {
      state = 'FIELD';
      field += char;
    }
  }
  function consumeRecord(char: string): CsvRecord | undefined {
    if (recordError) {
      if (char === '\n' || char === '\r') {
        const errorCode = recordError;
        recordError = null;
        row = [];
        field = '';
        state = 'START';
        length = 0;
        skipLF = char === '\r';
        return { errorCode };
      }
      return;
    }
    try {
      return consume(char);
    } catch (error) {
      if (
        !recoverRecords ||
        errorCode(error) !== 'EXTERNAL_CATALOG_INVALID_CSV'
      )
        throw error;
      // Syntax errors outside quotes have a recoverable next record boundary.
      recordError = errorCode(error)!;
      row = [];
      field = '';
      state = 'START';
      length = 0;
    }
  }
  try {
    for await (const chunk of stream) {
      for (const char of decoder.decode(chunk, { stream: true })) {
        const complete = consumeRecord(char);
        if (complete) yield complete;
      }
    }
    for (const char of decoder.decode()) {
      const complete = consumeRecord(char);
      if (complete) yield complete;
    }
    if (recordError) {
      yield { errorCode: recordError };
      return;
    }
    if (state === 'QUOTED') {
      if (recoverRecords) {
        yield { errorCode: 'EXTERNAL_CATALOG_INVALID_CSV' };
        return;
      }
      throw catalogError('EXTERNAL_CATALOG_INVALID_CSV');
    }
    if (length) {
      row.push(field);
      yield row;
    }
  } finally {
    stream.destroy();
  }
}

// Row-local schema failures are returned as evidence, without poisoning peers.
// Invalid headers/encoding remain source errors. Recoverable syntax is row-local.
export async function* catalogRowEntries(
  path: string,
  options: CsvOptions,
): AsyncGenerator<{
  rowNumber: number;
  error?: { code: string };
  value?: Record<string, string>;
}> {
  let headers: string[] | undefined,
    rowNumber = 0;
  for await (const row of csvRecords(path, {
    ...options,
    recoverRecords: true,
  })) {
    rowNumber++;
    if (!Array.isArray(row)) {
      if (!headers) throw catalogError('EXTERNAL_CATALOG_INVALID_HEADERS');
      yield { rowNumber, error: { code: row.errorCode } };
      continue;
    }
    if (!headers) {
      headers = row;
      if (
        new Set(headers).size !== headers.length ||
        headers.some((h) => !h.length) ||
        Object.values(options.columns).some(
          (column) => !headers!.includes(column),
        )
      )
        throw catalogError('EXTERNAL_CATALOG_INVALID_HEADERS');
      continue;
    }
    if (row.length !== headers.length) {
      yield { rowNumber, error: { code: 'EXTERNAL_CATALOG_INVALID_CSV' } };
      continue;
    }
    const value = Object.fromEntries(
      Object.entries(options.columns).map(([field, column]) => [
        field,
        row[headers!.indexOf(column)],
      ]),
    );
    if (
      !value.externalId.trim() ||
      !value.name.trim() ||
      !value.discovery.trim()
    ) {
      yield { rowNumber, error: { code: 'EXTERNAL_CATALOG_REQUIRED_FIELD' } };
      continue;
    }
    yield { rowNumber, value };
  }
  if (!headers) throw catalogError('EXTERNAL_CATALOG_INVALID_HEADERS');
}
