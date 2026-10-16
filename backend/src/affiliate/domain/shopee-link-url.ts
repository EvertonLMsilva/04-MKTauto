export function validateShopeeUrl(
  value: unknown,
  hosts: ReadonlySet<string>,
  code: string,
  fail: (code: string) => never,
): string {
  if (
    typeof value !== 'string' ||
    value.length > 2048 ||
    !value.startsWith('https://') ||
    /\s|\\/.test(value) ||
    value.includes('#') ||
    value
      .split('')
      .some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
  )
    fail(code);
  try {
    const url = new URL(value);
    const rawAuthority = value.slice('https://'.length).split(/[/?#]/, 1)[0];
    // Reject even default ports, encoded authorities and normalized ambiguous hosts.
    if (
      !hosts.has(url.hostname) ||
      rawAuthority !== url.hostname ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      url.pathname === '/'
    )
      fail(code);
    for (const [key, entry] of url.searchParams) {
      if (
        /^(token|access_token|secret|credential|signature|authorization|password|api_key|redirect|redirect_url|redirect_uri|url|next|target|dest|destination)$/i.test(
          key,
        ) ||
        /^(?:https?:)?\/\//i.test(entry)
      )
        fail(code);
    }
  } catch {
    fail(code);
  }
  return value;
}
