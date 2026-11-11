export function catalogError(code: string, cause?: unknown) {
  return Object.assign(new Error(code, cause ? { cause } : undefined), {
    code,
  });
}
export function errorCode(error: unknown): string | undefined {
  return error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : undefined;
}
