/**
 * Version number comparison for library deduplication, a pragmatic port of
 * HMCL's `VersionNumber.compare`: splits into numeric and non-numeric
 * chunks and compares chunk-wise.
 */
export function compareVersions(a: string, b: string): number {
  const da = splitChunks(a);
  const db = splitChunks(b);
  const len = Math.max(da.length, db.length);
  for (let i = 0; i < len; i++) {
    const ca = da[i];
    const cb = db[i];
    if (ca === undefined || cb === undefined) {
      const rest = (ca === undefined ? db : da).slice(i);
      // A suffix like "-beta" marks a pre-release: it sorts below the
      // plain release. A numeric continuation means a genuine bump.
      if (/^[-.]?[A-Za-z]/.test(rest[0] ?? '')) {
        return ca === undefined ? 1 : -1;
      }
      return ca === undefined ? -1 : 1;
    }
    const c = compareChunk(ca, cb);
    if (c !== 0) return c;
  }
  return 0;
}

function splitChunks(version: string): string[] {
  return version.split(/([0-9]+)/).filter((s) => s.length > 0);
}

function isNumeric(chunk: string): boolean {
  return /^[0-9]+$/.test(chunk);
}

function compareChunk(a: string, b: string): number {
  const na = isNumeric(a);
  const nb = isNumeric(b);
  if (na && nb) {
    const ia = BigInt(a);
    const ib = BigInt(b);
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  }
  if (na !== nb) return na ? -1 : 1; // numbers sort before strings
  return a < b ? -1 : a > b ? 1 : 0;
}
