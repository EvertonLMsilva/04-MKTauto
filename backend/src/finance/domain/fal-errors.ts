export function falFailure(code: any, field: any = 'provider') {
  return Object.assign(new Error(`${code}: ${field}`), { code, field });
}
