/**
 * Semantic versions, and the ranges `app.json` gives for the platform it runs on
 * (app-definition-v2.md, section 3). A range is one or more comparators, all of which must hold:
 * `>=1.0.0 <2.0.0`, `^1.2.0`, `~1.2.0` or `1.2.0`. There is no `||`, no `x` and no hyphen range.
 * Versions are compared by precedence, a prerelease before its release.
 */
const VERSION =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const COMPARATOR = /^(>=|<=|>|<|=|\^|~)?(.+)$/;

export interface Version {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly string[];
}

interface Comparator {
  readonly operator: '>=' | '<=' | '>' | '<' | '=';
  readonly version: Version;
}

export function parseVersion(text: string): Version | null {
  const match = VERSION.exec(text);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

export function compareVersions(a: Version, b: Version): number {
  for (const part of ['major', 'minor', 'patch'] as const) {
    if (a[part] !== b[part]) return a[part] < b[part] ? -1 : 1;
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0)
    return b.prerelease.length - a.prerelease.length;
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index++) {
    const [x, y] = [a.prerelease[index], b.prerelease[index]];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const [m, n] = [/^\d+$/.test(x), /^\d+$/.test(y)];
    if (m && n) return Number(x) < Number(y) ? -1 : 1;
    if (m !== n) return m ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/** The comparators of a range, or `null` when the text is not one. */
export function parseRange(text: string): readonly Comparator[] | null {
  const parts = text.trim().split(/\s+/);
  const comparators: Comparator[] = [];
  for (const part of parts) {
    const match = COMPARATOR.exec(part);
    const version = match ? parseVersion(match[2]) : null;
    if (!match || !version) return null;
    const operator = match[1] ?? '=';
    if (operator === '^' || operator === '~') {
      const upper =
        operator === '~' || (version.major === 0 && version.minor > 0)
          ? { major: version.major, minor: version.minor + 1, patch: 0 }
          : version.major > 0
            ? { major: version.major + 1, minor: 0, patch: 0 }
            : { major: 0, minor: 0, patch: version.patch + 1 };
      comparators.push(
        { operator: '>=', version },
        { operator: '<', version: { ...upper, prerelease: [] } },
      );
    } else comparators.push({ operator: operator as Comparator['operator'], version });
  }
  return text.trim() === '' ? null : comparators;
}

export function satisfies(version: Version, range: readonly Comparator[]): boolean {
  return range.every(({ operator, version: bound }) => {
    const order = compareVersions(version, bound);
    switch (operator) {
      case '>=':
        return order >= 0;
      case '<=':
        return order <= 0;
      case '>':
        return order > 0;
      case '<':
        return order < 0;
      case '=':
        return order === 0;
    }
  });
}
