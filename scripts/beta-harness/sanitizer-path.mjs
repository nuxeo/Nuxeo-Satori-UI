/** Stable audit keys, independent of native discovery paths and TypeScript's slash spelling. */
export function auditPath(file, root) {
  const key = file.replaceAll('\\', '/');
  const prefix = root ? `${root.replaceAll('\\', '/').replace(/\/$/, '')}/` : '';
  return prefix && key.startsWith(prefix) ? key.slice(prefix.length) : key;
}
