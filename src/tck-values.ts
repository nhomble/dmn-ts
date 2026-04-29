// Helpers for interpreting TCK test-case XML values. These translate the
// `<value>...</value>` text (with optional `xsi:type` annotations) into
// the JS primitives we feed into the generated decisions for comparison.
// Kept separate from the rest of `runner.ts` so the conversion logic can
// be unit-tested without spinning up an end-to-end run.

// Best-effort coercion for a `<value>` whose `xsi:type` is unspecified.
// TCK XMLs commonly elide the type, so we fall back to: literal-true/false,
// the empty string (preserved!), `null` (the word) → null, and anything
// that round-trips through `Number()` as a finite value → number. Anything
// else stays as-is.
export function smartCoerce(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === '' || raw === 'null') return raw === '' ? '' : null;
  // A signed decimal (also accepts the leading-dot form `.041`) that
  // round-trips through `Number` is treated as number.
  if (/^-?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/.test(raw)) {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return raw;
}

// Coerce a `<value xsi:type="...">` text. The XML Schema namespace prefix
// (`xsd:` / `xs:` / etc.) varies across test files, so we match on the
// local part. Recognised numeric types funnel through `Number`; everything
// else passes through unchanged (including string and any user types).
export function castByXsi(raw: string, xsi: string | undefined): unknown {
  if (xsi === undefined) return smartCoerce(raw);
  const local = xsi.includes(':') ? (xsi.split(':').pop() as string) : xsi;
  if (
    local === 'decimal' ||
    local === 'integer' ||
    local === 'double' ||
    local === 'long' ||
    local === 'float'
  ) {
    return Number(raw);
  }
  if (local === 'boolean') return raw === 'true';
  return raw;
}

// Reduce a candidate ISO 8601 duration string to a canonical form so two
// equivalent representations (e.g. `P1Y` and `P1Y0M`) compare equal in
// `deepEqual`. Returns null for anything that doesn't parse as a duration.
export function normalizeIsoDuration(s: string): string | null {
  const m = /^(-?)P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(s);
  if (!m) return null;
  const [, sign, y, mo, d, h, mi, sec] = m;
  // Reject empty `P` (no body at all).
  if (!y && !mo && !d && !h && !mi && !sec) return null;
  const yn = Number(y ?? 0);
  const mn = Number(mo ?? 0);
  const dn = Number(d ?? 0);
  const hn = Number(h ?? 0);
  const min = Number(mi ?? 0);
  const sn = Number(sec ?? 0);
  return `${sign}|${yn}|${mn}|${dn}|${hn}|${min}|${sn}`;
}
