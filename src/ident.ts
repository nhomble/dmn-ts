// FEEL names allow spaces and special characters; map to a JS-safe identifier.
export function toJsIdent(name: string): string {
  let s = name.replace(/[^A-Za-z0-9_]/g, '_');
  if (/^[0-9]/.test(s)) s = '_' + s;
  return s;
}
