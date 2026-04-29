// FEEL runtime helpers — used by every generated tom-rools module.
// Edit this file in source-of-truth form; transpiler copies it into output packages.

export const feel: any = {
  neg(a: any): any {
    if (a == null) return null;
    if (typeof a === 'string' && /^-?P/.test(a)) {
      return a.startsWith('-') ? a.slice(1) : '-' + a;
    }
    if (typeof a === 'number') return Number.isFinite(a) ? -a : null;
    return null;
  },
  not(a: any): any {
    if (a == null) return null;
    if (typeof a !== 'boolean') return null;
    return !a;
  },
  and(a: any, b: any): any {
    // Three-valued logic, strictly typed: non-boolean operands → null
    // (except when the other side short-circuits to false).
    if (a === false || b === false) return false;
    if (a !== true && a !== null) return null;
    if (b !== true && b !== null) return null;
    if (a === null || b === null) return null;
    return true;
  },
  or(a: any, b: any): any {
    if (a === true || b === true) return true;
    if (a !== false && a !== null) return null;
    if (b !== false && b !== null) return null;
    if (a === null || b === null) return null;
    return false;
  },
  // ---- Duration / date helpers (used by add/sub/mul/div) ----
  // Years-and-months duration → total months; null if not Y/M-only.
  ym_to_months(s: any): any {
    if (typeof s !== 'string') return null;
    const m = /^(-?)P(?:(\d+)Y)?(?:(\d+)M)?$/.exec(s);
    if (!m || (!m[2] && !m[3])) return null;
    const sign = m[1] === '-' ? -1 : 1;
    return sign * (Number(m[2] || '0') * 12 + Number(m[3] || '0'));
  },
  ym_format(months: any): any {
    const n = Number(months);
    if (!Number.isFinite(n)) return null;
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(Math.trunc(n));
    const y = Math.floor(abs / 12);
    const mo = abs % 12;
    let body = '';
    if (y) body += `${y}Y`;
    if (mo) body += `${mo}M`;
    if (!body) body = '0M';
    return `${n === 0 ? '' : sign}P${body}`;
  },
  // Days-and-time duration → total seconds (may be fractional); null otherwise.
  dt_to_seconds(s: any): any {
    if (typeof s !== 'string') return null;
    const m = /^(-?)P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)(?:\.(\d+))?S)?)?$/.exec(s);
    if (!m) return null;
    if (!m[2] && !m[3] && !m[4] && !m[5]) return null;
    const sign = m[1] === '-' ? -1 : 1;
    const d = Number(m[2] || '0');
    const h = Number(m[3] || '0');
    const mi = Number(m[4] || '0');
    const sec =
      Number(m[5] || '0') + (m[6] ? Number('0.' + m[6]) : 0);
    return sign * (d * 86400 + h * 3600 + mi * 60 + sec);
  },
  dt_format(totalSec: any): any {
    const n = Number(totalSec);
    if (!Number.isFinite(n)) return null;
    const sign = n < 0 ? '-' : '';
    let abs = Math.abs(n);
    const d = Math.floor(abs / 86400); abs -= d * 86400;
    const h = Math.floor(abs / 3600); abs -= h * 3600;
    const mi = Math.floor(abs / 60); abs -= mi * 60;
    const s = abs;
    let date = '';
    if (d) date += `${d}D`;
    let time = '';
    if (h) time += `${h}H`;
    if (mi) time += `${mi}M`;
    if (s !== 0) {
      const isInt = Number.isInteger(s);
      time += isInt ? `${s}S` : `${s}S`;
    }
    if (!date && !time) date = '0D';
    const isZero = totalSec === 0;
    return `${isZero ? '' : sign}P${date}${time ? 'T' + time : ''}`;
  },
  is_duration(v: any): boolean {
    return typeof v === 'string' && /^-?P/.test(v);
  },
  is_date_or_dt(v: any): boolean {
    if (typeof v !== 'string') return false;
    return /^-?\d{4,9}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2})?/.test(v);
  },
  is_time(v: any): boolean {
    return typeof v === 'string' && /^\d{2}:\d{2}:\d{2}/.test(v) && !v.includes('T');
  },
  // Parse a FEEL time string into seconds-since-midnight (TZ stripped).
  _time_to_seconds(t: any): number | null {
    if (typeof t !== 'string') return null;
    const m = /^(\d{2}):(\d{2}):(\d{2})(\.\d+)?/.exec(t);
    if (!m) return null;
    const frac = m[4] ? Number(m[4]) : 0;
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + frac;
  },
  add_time_duration(t: any, dur: any): any {
    if (typeof t !== 'string' || typeof dur !== 'string') return null;
    const m = /^(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2}(?::\d{2})?|@[A-Za-z_+\-/]+)?$/.exec(t);
    if (!m) return null;
    const sec = feel.dt_to_seconds(dur);
    if (sec == null) return null;
    let total = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + sec;
    // Wrap into [0, 86400)
    total = ((total % 86400) + 86400) % 86400;
    const h = Math.floor(total / 3600);
    const mi = Math.floor((total % 3600) / 60);
    const s = total - h * 3600 - mi * 60;
    return feel.time(h, mi, s, m[5] ?? null);
  },
  add(a: any, b: any): any {
    if (a == null || b == null) return null;
    if (feel.is_duration(a) && feel.is_duration(b)) {
      const yA = feel.ym_to_months(a), yB = feel.ym_to_months(b);
      if (yA != null && yB != null) return feel.ym_format(yA + yB);
      const dA = feel.dt_to_seconds(a), dB = feel.dt_to_seconds(b);
      if (dA != null && dB != null) return feel.dt_format(dA + dB);
      return null;
    }
    if (feel.is_date_or_dt(a) && feel.is_duration(b)) {
      return feel.add_date_duration(a, b);
    }
    if (feel.is_date_or_dt(b) && feel.is_duration(a)) {
      return feel.add_date_duration(b, a);
    }
    if (feel.is_time(a) && feel.is_duration(b)) {
      return feel.add_time_duration(a, b);
    }
    if (feel.is_time(b) && feel.is_duration(a)) {
      return feel.add_time_duration(b, a);
    }
    // FEEL: same-type strict; cross-type → null. Plain string + plain string
    // is concat; duration/date/time strings are excluded above.
    if (
      typeof a === 'string' &&
      typeof b === 'string' &&
      !feel.is_duration(a) &&
      !feel.is_duration(b) &&
      !feel.is_date_or_dt(a) &&
      !feel.is_date_or_dt(b) &&
      !feel.is_time(a) &&
      !feel.is_time(b)
    ) {
      return a + b;
    }
    if (typeof a !== 'number' || typeof b !== 'number') return null;
    return a + b;
  },
  sub(a: any, b: any): any {
    if (a == null || b == null) return null;
    if (feel.is_duration(a) && feel.is_duration(b)) {
      const yA = feel.ym_to_months(a), yB = feel.ym_to_months(b);
      if (yA != null && yB != null) return feel.ym_format(yA - yB);
      const dA = feel.dt_to_seconds(a), dB = feel.dt_to_seconds(b);
      if (dA != null && dB != null) return feel.dt_format(dA - dB);
      return null;
    }
    if (feel.is_date_or_dt(a) && feel.is_duration(b)) {
      const negated = b.startsWith('-') ? b.slice(1) : '-' + b;
      return feel.add_date_duration(a, negated);
    }
    if (feel.is_date_or_dt(a) && feel.is_date_or_dt(b)) {
      return feel.diff_dates(a, b);
    }
    if (feel.is_time(a) && feel.is_duration(b)) {
      const negated = b.startsWith('-') ? b.slice(1) : '-' + b;
      return feel.add_time_duration(a, negated);
    }
    if (feel.is_time(a) && feel.is_time(b)) {
      // time - time = days-and-time duration (TZ-stripped seconds delta).
      const tA = feel._time_to_seconds(a);
      const tB = feel._time_to_seconds(b);
      if (tA == null || tB == null) return null;
      return feel.dt_format(tA - tB);
    }
    if (typeof a !== 'number' || typeof b !== 'number') return null;
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return a - b;
  },
  mul(a: any, b: any): any {
    if (a == null || b == null) return null;
    if (feel.is_duration(a) && typeof b === 'number' && Number.isFinite(b)) return feel.scale_duration(a, b);
    if (feel.is_duration(b) && typeof a === 'number' && Number.isFinite(a)) return feel.scale_duration(b, a);
    if (typeof a !== 'number' || typeof b !== 'number') return null;
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return a * b;
  },
  div(a: any, b: any): any {
    if (a == null || b == null) return null;
    if (feel.is_duration(a) && typeof b === 'number' && Number.isFinite(b)) {
      if (b === 0) return null;
      return feel.scale_duration(a, 1 / b);
    }
    if (feel.is_duration(a) && feel.is_duration(b)) {
      const yA = feel.ym_to_months(a), yB = feel.ym_to_months(b);
      if (yA != null && yB != null) return yB === 0 ? null : yA / yB;
      const dA = feel.dt_to_seconds(a), dB = feel.dt_to_seconds(b);
      if (dA != null && dB != null) return dB === 0 ? null : dA / dB;
      return null;
    }
    if (typeof a !== 'number' || typeof b !== 'number') return null;
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    if (b === 0) return null;
    return a / b;
  },
  scale_duration(d: any, n: any): any {
    if (typeof d !== 'string' || typeof n !== 'number') return null;
    const ym = feel.ym_to_months(d);
    if (ym != null) return feel.ym_format(Math.trunc(ym * n));
    const dt = feel.dt_to_seconds(d);
    if (dt != null) return feel.dt_format(dt * n);
    return null;
  },
  add_date_duration(d: any, dur: any): any {
    if (typeof d !== 'string' || typeof dur !== 'string') return null;
    // Pure date? then we add years/months/days, integer arithmetic.
    const dateOnly = /^(-?\d{4,9})-(\d{2})-(\d{2})$/.exec(d);
    const ym = feel.ym_to_months(dur);
    if (dateOnly && ym != null) {
      const y = Number(dateOnly[1]);
      const mo = Number(dateOnly[2]);
      const da = Number(dateOnly[3]);
      const total = y * 12 + (mo - 1) + ym;
      const newY = Math.floor(total / 12);
      const newMo = (total % 12 + 12) % 12 + 1;
      return feel.date(newY, newMo, da);
    }
    const dt = feel.dt_to_seconds(dur);
    if (dateOnly && dt != null) {
      const y = Number(dateOnly[1]);
      const mo = Number(dateOnly[2]);
      const da = Number(dateOnly[3]);
      // Convert to a JS Date in UTC, add seconds, convert back. Won't preserve fractional seconds.
      const base = new Date(Date.UTC(Math.abs(y), mo - 1, da));
      base.setUTCSeconds(base.getUTCSeconds() + dt);
      return feel.date(
        base.getUTCFullYear() * (y < 0 ? -1 : 1),
        base.getUTCMonth() + 1,
        base.getUTCDate(),
      );
    }
    // Date-and-time: extract date + time, manipulate, recombine.
    const dtMatch = /^(-?\d{4,9}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-]\d{2}:\d{2}(?::\d{2})?|@[A-Za-z_+\-/]+)?$/.exec(d);
    if (dtMatch) {
      const tzSuffix = dtMatch[3] ?? '';
      const baseSec = feel.dt_to_seconds(dur);
      if (baseSec != null) {
        // Build a UTC ms timestamp for the input. Manual construction handles
        // negative years and IANA suffixes (which Date.parse rejects).
        const ms = feel._dt_to_utc_ms(dtMatch[1], dtMatch[2], tzSuffix);
        if (ms != null) {
          const out = new Date(ms + baseSec * 1000);
          return feel._format_dt_with_tz(out, tzSuffix);
        }
      }
      const months = feel.ym_to_months(dur);
      if (months != null) {
        const dateOnly = dtMatch[1];
        const timeOnly = dtMatch[2];
        const newDate = feel.add_date_duration(dateOnly, dur);
        if (newDate) return `${newDate}T${timeOnly}${tzSuffix}`;
      }
    }
    return null;
  },
  // Parse a `YYYY-MM-DD` date and `HH:MM:SS(.fff)?` time + optional tz into a
  // UTC ms timestamp. Returns null on parse failure.
  _dt_to_utc_ms(dateStr: any, timeStr: any, tzSuffix: any): any {
    if (typeof dateStr !== 'string' || typeof timeStr !== 'string') return null;
    const dm = /^(-?)(\d+)-(\d{2})-(\d{2})$/.exec(dateStr);
    if (!dm) return null;
    const sign = dm[1] === '-' ? -1 : 1;
    const y = sign * Number(dm[2]);
    const mo = Number(dm[3]) - 1;
    const da = Number(dm[4]);
    const tm = /^(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(timeStr);
    if (!tm) return null;
    const h = Number(tm[1]);
    const mi = Number(tm[2]);
    const sec = Number(tm[3]);
    const fracMs = tm[4] ? Number('0.' + tm[4]) * 1000 : 0;
    // setUTCFullYear handles negative / extended years that Date.UTC doesn't.
    const dt = new Date(0);
    dt.setUTCFullYear(y, mo, da);
    dt.setUTCHours(h, mi, sec, Math.round(fracMs));
    let ms = dt.getTime();
    if (tzSuffix && tzSuffix !== 'Z' && !tzSuffix.startsWith('@')) {
      const m = /^([+-])(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(tzSuffix);
      if (m) {
        const sgn = m[1] === '-' ? -1 : 1;
        const offSec = sgn * (Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4] || 0));
        ms -= offSec * 1000;
      }
    }
    // Note: caller must apply the IANA-zone offset separately (via
    // `_iana_offset_min`) when needed for comparisons. Date-arithmetic call
    // sites preserve the wall-clock text and don't want the IANA fold.
    return ms;
  },
  _iana_offset_min(date: any, ianaZone: any): number | null {
    if (!(date instanceof Date) || typeof ianaZone !== 'string') return null;
    try {
      const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: ianaZone,
        timeZoneName: 'longOffset',
      });
      const parts = fmt.formatToParts(date);
      const offsetStr = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
      if (offsetStr === 'GMT') return 0;
      const m = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(offsetStr);
      if (!m) return null;
      const sign = m[1] === '-' ? -1 : 1;
      return sign * (Number(m[2]) * 60 + Number(m[3] || 0));
    } catch {
      return null;
    }
  },
  // Format a UTC `Date` in the requested offset (e.g. "+11:00", "Z", or "" for
  // naive output without any suffix).
  _format_dt_with_tz(dt: any, tzSuffix: string): any {
    if (!(dt instanceof Date)) return null;
    let offsetMin = 0;
    if (tzSuffix === 'Z' || tzSuffix.startsWith('@')) {
      offsetMin = 0;
    } else if (/^[+-]\d{2}:\d{2}(?::\d{2})?$/.test(tzSuffix)) {
      const sign = tzSuffix[0] === '-' ? -1 : 1;
      offsetMin = sign * (Number(tzSuffix.slice(1, 3)) * 60 + Number(tzSuffix.slice(4, 6)));
    }
    const shifted = new Date(dt.getTime() + offsetMin * 60_000);
    const y = shifted.getUTCFullYear();
    const sign = y < 0 ? '-' : '';
    const yStr = String(Math.abs(y)).padStart(4, '0');
    const mo = String(shifted.getUTCMonth() + 1).padStart(2, '0');
    const d = String(shifted.getUTCDate()).padStart(2, '0');
    const h = String(shifted.getUTCHours()).padStart(2, '0');
    const mi = String(shifted.getUTCMinutes()).padStart(2, '0');
    const s = String(shifted.getUTCSeconds()).padStart(2, '0');
    return `${sign}${yStr}-${mo}-${d}T${h}:${mi}:${s}${tzSuffix}`;
  },
  diff_dates(a: any, b: any): any {
    if (typeof a !== 'string' || typeof b !== 'string') return null;
    const dateA = /^(-?\d{4,9})-(\d{2})-(\d{2})$/.exec(a);
    const dateB = /^(-?\d{4,9})-(\d{2})-(\d{2})$/.exec(b);
    // Both pure dates → days-and-time duration.
    if (dateA && dateB) {
      const tA = Date.UTC(Number(dateA[1]), Number(dateA[2]) - 1, Number(dateA[3]));
      const tB = Date.UTC(Number(dateB[1]), Number(dateB[2]) - 1, Number(dateB[3]));
      return feel.dt_format((tA - tB) / 1000);
    }
    const isDtZoned = (s: string) =>
      /T.+(?:Z|[+-]\d{2}:\d{2}(?::\d{2})?|@[A-Za-z_+\-/]+)$/.test(s);
    // Parse a value to its UTC-instant ms, treating a pure date as UTC
    // midnight (so `date - zoned dateAndTime` is well-defined).
    const parse = (s: string, dateMatch: RegExpExecArray | null): number | null => {
      if (dateMatch) {
        return Date.UTC(
          Number(dateMatch[1]),
          Number(dateMatch[2]) - 1,
          Number(dateMatch[3]),
        );
      }
      const m = /^(-?\d{4,9}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-]\d{2}:\d{2}(?::\d{2})?|@[A-Za-z_+\-/]+)?$/.exec(s);
      if (!m) return null;
      const [, dateP, timeP, tz] = m;
      const ms = feel._dt_to_utc_ms(dateP, timeP, tz ?? '');
      if (ms == null) return null;
      if (tz && tz.startsWith('@')) {
        const off = feel._iana_offset_min(new Date(ms), tz.slice(1));
        if (off == null) return null;
        return ms - off * 60_000;
      }
      return ms;
    };
    // Mixing naive and zoned dateTimes is undefined. A pure date "implies
    // UTC" so it must pair with a zoned datetime — naive datetime + date
    // mixes naive + UTC implicit → null.
    const aZoned = !dateA && isDtZoned(a);
    const bZoned = !dateB && isDtZoned(b);
    if (!dateA && !dateB && aZoned !== bZoned) return null;
    if ((dateA && !dateB && !bZoned) || (dateB && !dateA && !aZoned)) {
      return null;
    }
    const tA = parse(a, dateA);
    const tB = parse(b, dateB);
    if (tA == null || tB == null) return null;
    return feel.dt_format((tA - tB) / 1000);
  },
  pow(a: any, b: any): any {
    if (a == null || b == null) return null;
    if (typeof a !== 'number' || typeof b !== 'number') return null;
    const r = Math.pow(a, b);
    return Number.isFinite(r) ? r : null;
  },
  eq(a: any, b: any): any {
    if (a === null && b === null) return true;
    if (a == null || b == null) return false;
    if (typeof a !== typeof b) return null;
    // Time and date-and-time equality is to second resolution (TCK 1.3+):
    // strip fractional seconds before comparing.
    if (typeof a === 'string' && typeof b === 'string') {
      // Durations: same-family compare numerically; cross-family → null.
      if (/^-?P/.test(a) && /^-?P/.test(b)) {
        const yA = feel.ym_to_months(a);
        const yB = feel.ym_to_months(b);
        const dA = feel.dt_to_seconds(a);
        const dB = feel.dt_to_seconds(b);
        // Special-case the canonical zero P0M / PT0S — equal across families.
        if ((yA === 0 || dA === 0) && (yB === 0 || dB === 0)) return true;
        if (yA != null && yB != null) return yA === yB;
        if (dA != null && dB != null) return dA === dB;
        return null;
      }
      const isTime = feel.is_time(a) && feel.is_time(b);
      const isDt =
        /^-?\d{4,9}-\d{2}-\d{2}T/.test(a) && /^-?\d{4,9}-\d{2}-\d{2}T/.test(b);
      if (isDt) {
        // Both zoned: compare instants (so `+00:00` == `@Etc/UTC`,
        // `+02:00` == `@Europe/Paris` for a wall time inside CEST, etc.).
        const aZoned = /T.+(?:Z|[+-]\d{2}:\d{2}(?::\d{2})?|@[A-Za-z_+\-/]+)$/.test(a);
        const bZoned = /T.+(?:Z|[+-]\d{2}:\d{2}(?::\d{2})?|@[A-Za-z_+\-/]+)$/.test(b);
        if (aZoned !== bZoned) return null;
        if (aZoned && bZoned) {
          const dtA = /^(-?\d{4,9}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-]\d{2}:\d{2}(?::\d{2})?|@[A-Za-z_+\-/]+)$/.exec(a);
          const dtB = /^(-?\d{4,9}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-]\d{2}:\d{2}(?::\d{2})?|@[A-Za-z_+\-/]+)$/.exec(b);
          if (dtA && dtB) {
            const toInstant = (dateP: string, timeP: string, tz: string): number | null => {
              const ms = feel._dt_to_utc_ms(dateP, timeP, tz);
              if (ms == null) return null;
              if (tz.startsWith('@')) {
                const off = feel._iana_offset_min(new Date(ms), tz.slice(1));
                if (off == null) return null;
                return ms - off * 60_000;
              }
              return ms;
            };
            const msA = toInstant(dtA[1], dtA[2], dtA[3]);
            const msB = toInstant(dtB[1], dtB[2], dtB[3]);
            if (msA != null && msB != null) {
              // Equality is to second resolution per TCK 1.3+.
              return Math.floor(msA / 1000) === Math.floor(msB / 1000);
            }
          }
        }
        return a.replace(/\.\d+/, '') === b.replace(/\.\d+/, '');
      }
      if (isTime) {
        // Compare instants when both carry zone info — including IANA
        // zones, which we resolve via the current date for offset lookup.
        const tzA = /(?:Z|[+-]\d{2}:\d{2}(?::\d{2})?|@[A-Za-z_+\-/]+)$/.exec(a);
        const tzB = /(?:Z|[+-]\d{2}:\d{2}(?::\d{2})?|@[A-Za-z_+\-/]+)$/.exec(b);
        if (tzA && tzB) {
          const refDate = '1970-01-01';
          const msA = feel._dt_to_utc_ms(refDate, a.slice(0, tzA.index), tzA[0]);
          const msB = feel._dt_to_utc_ms(refDate, b.slice(0, tzB.index), tzB[0]);
          let aMs = msA;
          let bMs = msB;
          if (typeof aMs === 'number' && tzA[0].startsWith('@')) {
            const off = feel._iana_offset_min(new Date(aMs), tzA[0].slice(1));
            if (off == null) return null;
            aMs -= off * 60_000;
          }
          if (typeof bMs === 'number' && tzB[0].startsWith('@')) {
            const off = feel._iana_offset_min(new Date(bMs), tzB[0].slice(1));
            if (off == null) return null;
            bMs -= off * 60_000;
          }
          if (typeof aMs === 'number' && typeof bMs === 'number') {
            return Math.floor(aMs / 1000) === Math.floor(bMs / 1000);
          }
        }
        return a.replace(/\.\d+/, '') === b.replace(/\.\d+/, '');
      }
    }
    if (typeof a === 'number' && typeof b === 'number') {
      if (a === b) return true;
      const diff = Math.abs(a - b);
      const scale = Math.max(Math.abs(a), Math.abs(b));
      return diff < 1e-9 || (scale > 0 && diff / scale < 1e-9);
    }
    if (
      a && b &&
      typeof a === 'object' && typeof b === 'object' &&
      (a as any).__feel === 'range' && (b as any).__feel === 'range'
    ) {
      return (
        feel.eq((a as any).lo, (b as any).lo) === true &&
        feel.eq((a as any).hi, (b as any).hi) === true &&
        (a as any).openLow === (b as any).openLow &&
        (a as any).openHigh === (b as any).openHigh
      );
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++)
        if (feel.eq(a[i], b[i]) !== true) return false;
      return true;
    }
    if (typeof a === 'object' && typeof b === 'object') {
      // List vs context: cross-type → null per FEEL.
      if (Array.isArray(a) !== Array.isArray(b)) return null;
      const ak = Object.keys(a);
      const bk = Object.keys(b);
      if (ak.length !== bk.length) return false;
      for (const k of ak) if (feel.eq((a as any)[k], (b as any)[k]) !== true) return false;
      return true;
    }
    return a === b;
  },
  neq(a: any, b: any): any {
    const r = feel.eq(a, b);
    return r == null ? null : !r;
  },
  // Compare two duration strings. Returns numeric difference (a-b) where
  // both are same family (years-months OR days-time), or null otherwise.
  _dur_cmp(a: any, b: any): any {
    if (typeof a !== 'string' || typeof b !== 'string') return null;
    if (!/^-?P/.test(a) || !/^-?P/.test(b)) return null;
    const ymA = feel.ym_to_months(a),
      ymB = feel.ym_to_months(b);
    if (ymA != null && ymB != null) return ymA - ymB;
    const dtA = feel.dt_to_seconds(a),
      dtB = feel.dt_to_seconds(b);
    if (dtA != null && dtB != null) return dtA - dtB;
    return null;
  },
  lt(a: any, b: any): any {
    if (a == null || b == null) return null;
    if (typeof a === 'string' && typeof b === 'string') {
      if (/^-?P/.test(a) && /^-?P/.test(b)) {
        const d = feel._dur_cmp(a, b);
        return d == null ? null : d < 0;
      }
      return a < b;
    }
    if (typeof a !== 'number' || typeof b !== 'number') return null;
    return a < b;
  },
  le(a: any, b: any): any {
    if (a == null || b == null) return null;
    if (typeof a === 'string' && typeof b === 'string') {
      if (/^-?P/.test(a) && /^-?P/.test(b)) {
        const d = feel._dur_cmp(a, b);
        return d == null ? null : d <= 0;
      }
      return a <= b;
    }
    if (typeof a !== 'number' || typeof b !== 'number') return null;
    return a <= b;
  },
  gt(a: any, b: any): any {
    if (a == null || b == null) return null;
    if (typeof a === 'string' && typeof b === 'string') {
      if (/^-?P/.test(a) && /^-?P/.test(b)) {
        const d = feel._dur_cmp(a, b);
        return d == null ? null : d > 0;
      }
      return a > b;
    }
    if (typeof a !== 'number' || typeof b !== 'number') return null;
    return a > b;
  },
  ge(a: any, b: any): any {
    if (a == null || b == null) return null;
    if (typeof a === 'string' && typeof b === 'string') {
      if (/^-?P/.test(a) && /^-?P/.test(b)) {
        const d = feel._dur_cmp(a, b);
        return d == null ? null : d >= 0;
      }
      return a >= b;
    }
    if (typeof a !== 'number' || typeof b !== 'number') return null;
    return a >= b;
  },
  // Validate a value against either a FEEL primitive type or a user-defined
  // item definition. Returns the value if it conforms, else null.
  validate(v: any, typeRef: any, itemDefs: any, opts?: { noSingleton?: boolean }): any {
    if (v === null || v === undefined) return null;
    if (typeof typeRef !== 'string') return v;
    const local = typeRef.includes(':') ? typeRef.split(':').pop()! : typeRef;
    const def = itemDefs && itemDefs[local];
    if (def) {
      // A `<functionItem>` typeRef requires the value to be callable. A
      // non-function — even one that *looks* like the declared output —
      // doesn't satisfy a function type.
      if (def.isFunction) {
        return typeof v === 'function' ? v : null;
      }
      if (def.isCollection) {
        // FEEL singleton-list rule: a single non-list value flows into a
        // list-typed slot as a one-element list — but only at the top-level
        // (a typed decision return). Inside a structure the rule doesn't
        // apply, so a scalar where a list is expected is a type error.
        if (!Array.isArray(v)) {
          if (opts?.noSingleton) return null;
          v = [v];
        }
        // List-element validation: recurse, allowing the singleton-list
        // rule again at this nested level (so a list-of-lists tolerates
        // scalar elements via auto-wrap).
        if (def.base) {
          for (const item of v) {
            if (item === null) continue;
            if (feel.validate(item, def.base, itemDefs) === null) return null;
          }
        } else if (def.components && def.components.length) {
          // A collection with components attached describes a list of
          // contexts sharing that component shape — validate each row.
          for (const item of v) {
            if (item === null) continue;
            if (feel._validateComponents(item, def.components, itemDefs) === null)
              return null;
          }
        }
        return v;
      }
      // Validate the base type — but only the *structure*, not its
      // allowedValues. When this type defines its own allowedValueTests,
      // those override the base's; when it has none, the base's still
      // apply (so we run the full base-validate in that case).
      if (def.base) {
        const inheritFromBase = !def.allowedValueTests;
        if (inheritFromBase) {
          if (feel.validate(v, def.base, itemDefs) === null) return null;
        } else {
          if (feel._validateStructural(v, def.base, itemDefs) === null) return null;
        }
      }
      // This type's own allowedValueTests — each is a compiled FEEL unary test.
      if (def.allowedValueTests) {
        const ok = def.allowedValueTests.some((t: any) => {
          try {
            return t(v) === true;
          } catch {
            return false;
          }
        });
        if (!ok) return null;
      }
      // Validate structural components against the declared shape.
      if (def.components && def.components.length) {
        if (feel._validateComponents(v, def.components, itemDefs) === null) {
          return null;
        }
      }
      return v;
    }
    return feel.coerce(v, typeRef);
  },
  // Validate `v` against an array of component descriptors (the structural
  // shape of an item definition). Every named component must be present
  // (extra fields are allowed — FEEL is open-world), and when a component
  // declares a typeRef the value is recursively validated against it.
  // `isCollection` components require a list of values that each conform
  // to the declared element typeRef. Returns the value or null.
  _validateComponents(v: any, components: any[], itemDefs: any): any {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
    for (const c of components) {
      const fieldVal = (v as Record<string, unknown>)[c.name];
      if (fieldVal === undefined) return null;
      if (fieldVal === null) continue;
      if (c.isCollection) {
        if (!Array.isArray(fieldVal)) return null;
        if (c.typeRef) {
          for (const elem of fieldVal as unknown[]) {
            if (elem === null) continue;
            if (feel.validate(elem, c.typeRef, itemDefs, { noSingleton: true }) === null)
              return null;
          }
        }
        continue;
      }
      if (c.typeRef) {
        const validated = feel.validate(fieldVal, c.typeRef, itemDefs, { noSingleton: true });
        if (validated === null) return null;
      }
    }
    return v;
  },
  // Like `validate` but skips allowedValueTests at every level — used to
  // check structural compatibility against a base type when the derived
  // type overrides allowedValues.
  _validateStructural(v: any, typeRef: any, itemDefs: any): any {
    if (v === null || v === undefined) return null;
    if (typeof typeRef !== 'string') return v;
    const local = typeRef.includes(':') ? typeRef.split(':').pop()! : typeRef;
    const def = itemDefs && itemDefs[local];
    if (def) {
      if (def.isCollection) {
        if (!Array.isArray(v)) return null;
        if (def.base) {
          for (const item of v) {
            if (item === null) continue;
            if (feel._validateStructural(item, def.base, itemDefs) === null) return null;
          }
        }
        return v;
      }
      if (def.base) {
        if (feel._validateStructural(v, def.base, itemDefs) === null) return null;
      }
      if (def.components && def.components.length) {
        if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
        for (const c of def.components) {
          const fieldVal = (v as Record<string, unknown>)[c.name];
          if (fieldVal === undefined) return null;
          if (c.typeRef && fieldVal !== null) {
            if (feel._validateStructural(fieldVal, c.typeRef, itemDefs) === null) return null;
          }
        }
      }
      return v;
    }
    return feel.coerce(v, typeRef);
  },
  coerce(v: any, typeRef: string): any {
    if (v === null || v === undefined) return null;
    const local = typeRef.includes(':') ? typeRef.split(':').pop()! : typeRef;
    switch (local) {
      case 'string':
        return typeof v === 'string' ? v : null;
      case 'number':
        return typeof v === 'number' && Number.isFinite(v) ? v : null;
      case 'boolean':
        return typeof v === 'boolean' ? v : null;
      case 'date':
        return typeof v === 'string' && /^-?\d{4,9}-\d{2}-\d{2}$/.test(v)
          ? v
          : null;
      case 'time':
        return typeof v === 'string' &&
          /^\d{2}:\d{2}:\d{2}/.test(v) &&
          !v.includes('T')
          ? v
          : null;
      case 'dateTime':
      case 'date and time':
        return typeof v === 'string' && /T/.test(v) ? v : null;
      case 'duration':
      case 'years and months duration':
      case 'days and time duration':
        return typeof v === 'string' && /^-?P/.test(v) ? v : null;
      default:
        return v;
    }
  },
  // FEEL singleton-list rule: when a list of length 1 is used in a context
  // expecting a single value, unwrap to the element.
  singleton(v: any): any {
    if (Array.isArray(v) && v.length === 1) return v[0];
    return v;
  },
  // FEEL range. When lo/hi are integers, expand into a numeric array suitable
  // for iteration; otherwise return a tagged bounds object that list_contains
  // and other helpers know how to test.
  range(lo: any, hi: any, openLow = false, openHigh = false): any {
    if (lo == null && hi == null) return null;
    return { __feel: 'range', lo, hi, openLow, openHigh };
  },
  // Build an "unbounded" range from a comparison form (`< X`, `> X`, …).
  // Stored with a distinct shape so equality with a literal-endpoint
  // range distinguishes (`(< 10) != (null..10)`).
  unbounded_range(
    lo: any,
    hi: any,
    openLow: boolean,
    openHigh: boolean,
    unboundedLow: boolean,
    unboundedHigh: boolean,
  ): any {
    return {
      __feel: 'range',
      lo,
      hi,
      openLow,
      openHigh,
      unboundedLow,
      unboundedHigh,
    };
  },
  iterate(v: any): any[] {
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object' && (v as any).__feel === 'range') {
      const { lo, hi, openLow, openHigh } = v as {
        lo: any;
        hi: any;
        openLow: boolean;
        openHigh: boolean;
      };
      if (
        typeof lo === 'number' &&
        typeof hi === 'number' &&
        Number.isInteger(lo) &&
        Number.isInteger(hi)
      ) {
        if (Math.abs(hi - lo) > 1_000_000) return [];
        const out: number[] = [];
        const step = lo <= hi ? 1 : -1;
        const cur = openLow ? lo + step : lo;
        const end = openHigh ? hi - step : hi;
        if (step > 0) for (let i = cur; i <= end; i++) out.push(i);
        else for (let i = cur; i >= end; i--) out.push(i);
        return out;
      }
      // Date ranges: iterate day-by-day.
      const isDate = (s: any) =>
        typeof s === 'string' && /^-?\d{4,9}-\d{2}-\d{2}$/.test(s);
      if (isDate(lo) && isDate(hi)) {
        const out: string[] = [];
        const ascending = lo <= hi;
        const stepDur = ascending ? 'P1D' : '-P1D';
        let cur = openLow
          ? feel.add_date_duration(lo, stepDur)
          : lo;
        const end = openHigh
          ? feel.add_date_duration(hi, ascending ? '-P1D' : 'P1D')
          : hi;
        if (cur == null || end == null) return [];
        let safety = 1_000_000;
        if (ascending) {
          while (cur <= end && safety-- > 0) {
            out.push(cur);
            cur = feel.add_date_duration(cur, stepDur);
            if (cur == null) break;
          }
        } else {
          while (cur >= end && safety-- > 0) {
            out.push(cur);
            cur = feel.add_date_duration(cur, stepDur);
            if (cur == null) break;
          }
        }
        return out;
      }
      return [];
    }
    return [];
  },
  // Like `iterate`, but returns null for non-iterable values (e.g. a string
  // range). Used by `for`/`some`/`every` to propagate FEEL's null semantics.
  iterateOrNull(v: any): any[] | null {
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object' && (v as any).__feel === 'range') {
      const { lo, hi } = v as { lo: any; hi: any };
      const isInt = (x: any) => typeof x === 'number' && Number.isInteger(x);
      const isDate = (x: any) =>
        typeof x === 'string' && /^-?\d{4,9}-\d{2}-\d{2}$/.test(x);
      if (isInt(lo) && isInt(hi)) return feel.iterate(v);
      if (isDate(lo) && isDate(hi)) return feel.iterate(v);
      return null;
    }
    return null;
  },
  // Treat a value as a list. Arrays pass through; ranges expand. Anything
  // else is null (a "not a list" signal for callers).
  asList(v: any): any[] | null {
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object' && (v as any).__feel === 'range') {
      return feel.iterate(v);
    }
    return null;
  },
  index(list: any, idx: any): any {
    list = feel.asList(list) as any;
    if (!Array.isArray(list)) return null;
    const i = Number(idx);
    if (!Number.isFinite(i)) return null;
    if (i > 0) return list[i - 1] ?? null;
    if (i < 0) return list[list.length + i] ?? null;
    return null;
  },
  // Used for postfix `list[expr]` — the parser doesn't know whether expr is
  // a number (indexing) or a predicate (filtering), so we probe at runtime.
  // `fn` is a closure that takes an `item` parameter; if it doesn't reference
  // the parameter, the value is treated as the index, otherwise as a filter.
  indexOrFilter(list: any, fn: any): any {
    if (list === null || list === undefined) return null;
    const asList = feel.asList(list);
    // Per FEEL singleton rule, a scalar `value[1]` is equivalent to `[value][1]`.
    list = asList ?? [list];
    if (!Array.isArray(list)) return null;
    let probe: any;
    let probed = true;
    try {
      probe = fn(undefined);
    } catch {
      probed = false;
    }
    if (probed && typeof probe === 'number') {
      return feel.index(list, probe);
    }
    if (probed && typeof probe === 'boolean' && list.every((it: any) => fn(it) === probe)) {
      return probe ? list.slice() : [];
    }
    // Filter mode: predicate must return a boolean per element. A null
    // result excludes that element (common for property accesses on items
    // that lack the property); any other non-boolean poisons to null.
    const out: any[] = [];
    for (const it of list) {
      let r: any;
      try {
        r = fn(it);
      } catch {
        return null;
      }
      if (r === null) continue;
      if (typeof r !== 'boolean') return null;
      if (r) out.push(it);
    }
    return out;
  },
  count(list: any): any {
    return Array.isArray(list) ? list.length : null;
  },
  sum(...args: any[]): any {
    const items =
      args.length === 1 && (Array.isArray(args[0]) || feel.asList(args[0])) !== null
        ? (feel.asList(args[0]) as any[])
        : args;
    if (!Array.isArray(items) || items.length === 0) return null;
    let s = 0;
    for (const x of items) {
      if (typeof x !== 'number' || !Number.isFinite(x)) return null;
      s += x;
    }
    return s;
  },
  min(...args: any[]): any {
    const items = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
    if (items.length === 0) return null;
    let best: any = items[0];
    for (let i = 1; i < items.length; i++) {
      const v = items[i];
      if (v == null) return null;
      if (feel.lt(v, best) === true) best = v;
    }
    return best;
  },
  max(...args: any[]): any {
    const items = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
    if (items.length === 0) return null;
    let best: any = items[0];
    for (let i = 1; i < items.length; i++) {
      const v = items[i];
      if (v == null) return null;
      if (feel.gt(v, best) === true) best = v;
    }
    return best;
  },
  mean(...args: any[]): any {
    const items =
      args.length === 1 && (Array.isArray(args[0]) || feel.asList(args[0])) !== null
        ? (feel.asList(args[0]) as any[])
        : args;
    if (!Array.isArray(items) || items.length === 0) return null;
    let s = 0;
    for (const x of items) {
      if (typeof x !== 'number' || !Number.isFinite(x)) return null;
      s += x;
    }
    return s / items.length;
  },
  all(...args: any[]): any {
    if (args.length === 0) return null;
    const items =
      args.length === 1 && (Array.isArray(args[0]) || feel.asList(args[0])) !== null
        ? (feel.asList(args[0]) as any[])
        : args;
    if (!Array.isArray(items)) return null;
    let sawNull = false;
    for (const x of items) {
      if (x === false) return false;
      if (x !== true) sawNull = true;
    }
    return sawNull ? null : true;
  },
  any(...args: any[]): any {
    if (args.length === 0) return null;
    const items =
      args.length === 1 && (Array.isArray(args[0]) || feel.asList(args[0])) !== null
        ? (feel.asList(args[0]) as any[])
        : args;
    if (!Array.isArray(items)) return null;
    let sawNull = false;
    for (const x of items) {
      if (x === true) return true;
      if (x !== false) sawNull = true;
    }
    return sawNull ? null : false;
  },
  sublist(list: any, start: any, length?: any): any {
    list = feel.asList(list) as any;
    if (!Array.isArray(list)) return null;
    let s = Number(start);
    if (s < 0) s = list.length + s + 1;
    s = s - 1;
    if (length == null || length?.__named) return list.slice(Math.max(0, s));
    return list.slice(Math.max(0, s), Math.max(0, s) + Number(length));
  },
  append(list: any, ...items: any[]): any {
    list = feel.asList(list) as any;
    if (!Array.isArray(list)) return null;
    return [...list, ...items];
  },
  concatenate(...lists: any[]): any {
    const out: any[] = [];
    for (const l of lists) {
      if (!Array.isArray(l)) return null;
      out.push(...l);
    }
    return out;
  },
  reverse(list: any): any {
    return Array.isArray(list) ? [...list].reverse() : null;
  },
  list_contains(list: any, item: any): any {
    if (list && typeof list === 'object' && list.__feel === 'range') {
      const { lo, hi, openLow, openHigh, unboundedLow, unboundedHigh } = list;
      // Unbounded endpoints (from `< X`) skip that side of the check;
      // literal-null endpoints make the `in` test undefined (null).
      const loNull = lo === null;
      const hiNull = hi === null;
      if ((loNull && !unboundedLow) || (hiNull && !unboundedHigh)) return null;
      if (item == null) return null;
      // A degenerate `=X` range (point range, both endpoints same and
      // closed) collapses to equality — handles types like booleans and
      // lists where `<` / `<=` are undefined.
      if (!openLow && !openHigh && !loNull && !hiNull && feel.eq(lo, hi) === true) {
        return feel.eq(lo, item) === true;
      }
      const lower = unboundedLow
        ? true
        : openLow
          ? feel.lt(lo, item)
          : feel.le(lo, item);
      const upper = unboundedHigh
        ? true
        : openHigh
          ? feel.lt(item, hi)
          : feel.le(item, hi);
      if (lower == null || upper == null) return null;
      return lower === true && upper === true;
    }
    if (list && typeof list === 'object' && list.__feel === 'tests') {
      // Positive unary tests — match if any test passes. Tests may themselves
      // reference ranges/lists; predicate already returns true/false.
      return list.tests.some((fn: any) => fn(item) === true);
    }
    if (list == null) return null;
    // FEEL singleton rule: scalar `x in v` treats v as `[v]`.
    const asList = feel.asList(list);
    list = asList ?? [list];
    if (!Array.isArray(list)) return null;
    // When `item` is itself a collection (array or non-tagged object), prefer
    // direct equality with each element. Otherwise (scalar item) recurse into
    // nested arrays so `1 in [[1,2,3]]` is true.
    const itemIsCollection =
      Array.isArray(item) ||
      (item != null &&
        typeof item === 'object' &&
        !(item as any).__feel);
    for (const x of list) {
      if (x && typeof x === 'object' && (x.__feel === 'range' || x.__feel === 'tests')) {
        if (feel.list_contains(x, item) === true) return true;
        continue;
      }
      if (!itemIsCollection && Array.isArray(x)) {
        if (feel.list_contains(x, item) === true) return true;
        continue;
      }
      if (feel.eq(x, item) === true) return true;
    }
    return false;
  },
  distinct_values(list: any): any {
    list = feel.asList(list) as any;
    if (!Array.isArray(list)) return null;
    const out: any[] = [];
    for (const x of list) {
      if (!out.some((y) => feel.eq(x, y) === true)) out.push(x);
    }
    return out;
  },
  flatten(list: any): any {
    list = feel.asList(list) as any;
    if (!Array.isArray(list)) return null;
    const out: any[] = [];
    const rec = (xs: any[]) => {
      for (const x of xs) Array.isArray(x) ? rec(x) : out.push(x);
    };
    rec(list);
    return out;
  },
  product(...args: any[]): any {
    const items =
      args.length === 1 && (Array.isArray(args[0]) || feel.asList(args[0])) !== null
        ? (feel.asList(args[0]) as any[])
        : args;
    if (!Array.isArray(items) || items.length === 0) return null;
    let p = 1;
    for (const x of items) {
      if (typeof x !== 'number' || !Number.isFinite(x)) return null;
      p *= x;
    }
    return p;
  },
  insert_before(list: any, position: any, newItem: any): any {
    list = feel.asList(list) as any;
    if (!Array.isArray(list)) return null;
    const i = Number(position);
    if (!Number.isFinite(i) || i < 1 || i > list.length + 1) return null;
    return [...list.slice(0, i - 1), newItem, ...list.slice(i - 1)];
  },
  index_of(list: any, match: any): any {
    list = feel.asList(list) as any;
    if (!Array.isArray(list)) return null;
    const out: number[] = [];
    list.forEach((x: any, i: number) => {
      if (feel.eq(x, match) === true) out.push(i + 1);
    });
    return out;
  },
  union(...lists: any[]): any {
    const items = lists.length === 1 && Array.isArray(lists[0]) ? lists[0] : lists;
    const out: any[] = [];
    for (const l of items) {
      if (!Array.isArray(l)) {
        if (!out.some((y) => feel.eq(l, y) === true)) out.push(l);
        continue;
      }
      for (const x of l) if (!out.some((y) => feel.eq(x, y) === true)) out.push(x);
    }
    return out;
  },
  remove(list: any, position: any): any {
    list = feel.asList(list) as any;
    if (!Array.isArray(list)) return null;
    const i = Number(position);
    if (!Number.isFinite(i) || i < 1 || i > list.length) return null;
    return [...list.slice(0, i - 1), ...list.slice(i)];
  },
  list_replace(list: any, position: any, newItem: any): any {
    if (position == null) return null;
    // Singleton-list rule: a scalar non-list `list` is coerced to `[list]`.
    if (!Array.isArray(list)) {
      if (list == null) return null;
      list = [list];
    }
    // Accept either a numeric position (1-based, decimals truncate) or a
    // predicate `(item, newItem) -> boolean` that selects which entries
    // to replace.
    if (typeof position === 'function') {
      if (position.length !== 2) return null;
      const out: any[] = [];
      for (const it of list) {
        let r: any;
        try {
          r = position(it, newItem);
        } catch {
          return null;
        }
        if (typeof r !== 'boolean') return null;
        out.push(r ? newItem : it);
      }
      return out;
    }
    if (typeof position !== 'number' || !Number.isFinite(position)) return null;
    let i = Math.trunc(position);
    if (i < 0) i = list.length + i + 1;
    if (i < 1 || i > list.length) return null;
    const out = [...list];
    out[i - 1] = newItem;
    return out;
  },
  median(...args: any[]): any {
    const items =
      args.length === 1 && (Array.isArray(args[0]) || feel.asList(args[0])) !== null
        ? (feel.asList(args[0]) as any[])
        : args;
    if (!Array.isArray(items) || items.length === 0) return null;
    if (items.some((n) => typeof n !== 'number' || !Number.isFinite(n))) return null;
    const nums = items.slice().sort((a, b) => a - b);
    const mid = Math.floor(nums.length / 2);
    return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
  },
  stddev(...args: any[]): any {
    const items =
      args.length === 1 && (Array.isArray(args[0]) || feel.asList(args[0])) !== null
        ? (feel.asList(args[0]) as any[])
        : args;
    if (!Array.isArray(items) || items.length < 2) return null;
    if (items.some((n) => typeof n !== 'number' || !Number.isFinite(n))) return null;
    const m = items.reduce((s, x) => s + x, 0) / items.length;
    const v = items.reduce((s, x) => s + (x - m) * (x - m), 0) / (items.length - 1);
    return Math.sqrt(v);
  },
  mode(...args: any[]): any {
    // Zero-arity call is undefined.
    if (args.length === 0) return null;
    // Single null arg → null (per FEEL: null is not a list).
    if (args.length === 1 && args[0] === null) return null;
    const items =
      args.length === 1 && (Array.isArray(args[0]) || feel.asList(args[0])) !== null
        ? (feel.asList(args[0]) as any[])
        : args;
    if (!Array.isArray(items)) return null;
    if (items.length === 0) return [];
    for (const x of items) {
      if (typeof x !== 'number' || !Number.isFinite(x)) return null;
    }
    const counts = new Map<any, number>();
    for (const x of items) counts.set(x, (counts.get(x) ?? 0) + 1);
    let max = 0;
    for (const v of counts.values()) if (v > max) max = v;
    const modes: any[] = [];
    for (const [k, v] of counts) if (v === max) modes.push(k);
    return modes.sort((a, b) => a - b);
  },
  sort(list: any, precedes: any): any {
    list = feel.asList(list) as any;
    if (!Array.isArray(list)) return null;
    if (typeof precedes !== 'function') return [...list].sort();
    return [...list].sort((a: any, b: any) => (precedes(a, b) === true ? -1 : 1));
  },
  get_value(...args: any[]): any {
    if (args.length !== 2) return null;
    const [m, key] = args;
    if (m == null || typeof m !== 'object' || Array.isArray(m)) return null;
    if (typeof key !== 'string') return null;
    return key in m ? (m as Record<string, unknown>)[key] : null;
  },
  get_entries(m: any, ...rest: any[]): any {
    if (rest.length > 0) return null;
    if (m == null || typeof m !== 'object' || Array.isArray(m)) return null;
    return Object.entries(m).map(([key, value]) => ({ key, value }));
  },
  context_put(context: any, key: any, value: any, ...rest: any[]): any {
    if (rest.length > 0) return null;
    if (context == null || typeof context !== 'object' || Array.isArray(context)) return null;
    if (value === undefined) return null;
    if (typeof key === 'string') {
      return { ...(context as object), [key]: value };
    }
    if (Array.isArray(key)) {
      if (key.length === 0) return null;
      if (!key.every((k) => typeof k === 'string')) return null;
      const [head, ...tail] = key;
      if (tail.length === 0) {
        return { ...(context as object), [head]: value };
      }
      // Intermediate path segments must already point at a context (or be
      // missing entirely — we then create the chain). Pointing at a scalar
      // or list is a structural error.
      const inner = (context as Record<string, unknown>)[head];
      let innerCtx: Record<string, unknown>;
      if (inner === undefined) {
        innerCtx = {};
      } else if (
        inner !== null &&
        typeof inner === 'object' &&
        !Array.isArray(inner)
      ) {
        innerCtx = inner as Record<string, unknown>;
      } else {
        return null;
      }
      const updated = feel.context_put(innerCtx, tail, value);
      if (updated === null) return null;
      return { ...(context as object), [head]: updated };
    }
    return null;
  },
  context_merge(contexts: any, ...rest: any[]): any {
    if (rest.length > 0) return null;
    // Singleton-list rule: a single context flows in as `[context]`.
    if (
      contexts &&
      typeof contexts === 'object' &&
      !Array.isArray(contexts) &&
      !(contexts as any).__feel
    ) {
      contexts = [contexts];
    }
    if (!Array.isArray(contexts)) return null;
    const out: Record<string, unknown> = {};
    for (const c of contexts) {
      if (c == null || typeof c !== 'object' || Array.isArray(c)) return null;
      Object.assign(out, c);
    }
    return out;
  },
  day_of_year(d: any, ...rest: any[]): any {
    if (rest.length > 0) return null;
    if (typeof d !== 'string') return null;
    const m = /^(-?)(\d+)-(\d{2})-(\d{2})/.exec(d);
    if (!m) return null;
    const y = (m[1] === '-' ? -1 : 1) * Number(m[2]);
    const mo = Number(m[3]);
    const da = Number(m[4]);
    const dt = new Date(Date.UTC(Math.abs(y), mo - 1, da));
    const start = new Date(Date.UTC(Math.abs(y), 0, 1));
    return Math.floor((dt.getTime() - start.getTime()) / 86_400_000) + 1;
  },
  day_of_week(d: any, ...rest: any[]): any {
    if (rest.length > 0) return null;
    if (typeof d !== 'string') return null;
    const m = /^(-?)(\d+)-(\d{2})-(\d{2})/.exec(d);
    if (!m) return null;
    const dt = new Date(Date.UTC(
      (m[1] === '-' ? -1 : 1) * Number(m[2]),
      Number(m[3]) - 1,
      Number(m[4]),
    ));
    const names = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    return names[dt.getUTCDay()];
  },
  month_of_year(d: any, ...rest: any[]): any {
    if (rest.length > 0) return null;
    if (typeof d !== 'string') return null;
    const m = /^-?\d+-(\d{2})-\d{2}/.exec(d);
    if (!m) return null;
    const names = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    return names[Number(m[1]) - 1] ?? null;
  },
  // Property access — handles object fields and the implicit fields exposed
  // by date/time/dateTime/duration string values (year, month, day, hour, …).
  _tz_to_offset_dur(tz: any): any {
    if (!tz || typeof tz !== 'string') return null;
    if (tz === 'Z') return 'PT0S';
    if (tz.startsWith('@')) return null;
    const m = /^([+-])(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(tz);
    if (!m) return null;
    const sign = m[1] === '-' ? -1 : 1;
    const total = sign * (Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4] || 0));
    return feel.dt_format(total);
  },
  _tz_to_zone_name(tz: any): any {
    if (!tz || typeof tz !== 'string') return null;
    if (tz.startsWith('@')) return tz.slice(1);
    return null;
  },
  prop(obj: any, key: string): any {
    if (obj == null) return null;
    if (typeof obj === 'string') return feel.temporal_prop(obj, key);
    if (Array.isArray(obj)) {
      // Range-property fast paths (for ranges that were collapsed to arrays).
      if (key === 'start') return obj[0] ?? null;
      if (key === 'end') return obj[obj.length - 1] ?? null;
      if (key === 'start included' || key === 'end included') return true;
      // FEEL "path" navigation: list.field returns the field of each element.
      return obj.map((it: any) => feel.prop(it, key));
    }
    if (typeof obj === 'object') {
      const o = obj as Record<string, unknown>;
      if ((o as any).__feel === 'range') {
        if (key === 'start') return (o as any).lo;
        if (key === 'end') return (o as any).hi;
        if (key === 'start included') return !(o as any).openLow;
        if (key === 'end included') return !(o as any).openHigh;
        return null;
      }
      return key in o ? o[key] : null;
    }
    return null;
  },
  temporal_prop(s: string, key: string): any {
    const dtMatch = /^(-?)(\d+)-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(.*))?$/.exec(s);
    if (dtMatch) {
      const sign = dtMatch[1] === '-' ? -1 : 1;
      const y = sign * Number(dtMatch[2]);
      const mo = Number(dtMatch[3]);
      const d = Number(dtMatch[4]);
      if (key === 'year') return y;
      if (key === 'month') return mo;
      if (key === 'day') return d;
      if (key === 'weekday') {
        const dt = new Date(Date.UTC(Math.abs(y), mo - 1, d));
        return ((dt.getUTCDay() + 6) % 7) + 1;
      }
      if (dtMatch[5] !== undefined) {
        if (key === 'hour') return Number(dtMatch[5]);
        if (key === 'minute') return Number(dtMatch[6]);
        if (key === 'second') return Number(dtMatch[7]);
        if (key === 'time offset') return feel._tz_to_offset_dur(dtMatch[9]);
        if (key === 'timezone') return feel._tz_to_zone_name(dtMatch[9]);
      } else {
        if (key === 'hour' || key === 'minute' || key === 'second') return 0;
        if (key === 'time offset' || key === 'timezone') return null;
      }
      return null;
    }
    const tMatch = /^(\d{2}):(\d{2}):(\d{2})(\.\d+)?(.*)$/.exec(s);
    if (tMatch) {
      if (key === 'hour') return Number(tMatch[1]);
      if (key === 'minute') return Number(tMatch[2]);
      if (key === 'second') return Number(tMatch[3]);
      if (key === 'time offset') return feel._tz_to_offset_dur(tMatch[5]);
      if (key === 'timezone') return feel._tz_to_zone_name(tMatch[5]);
      return null;
    }
    const durMatch = /^(-?)P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)(?:\.\d+)?S)?)?$/.exec(s);
    if (durMatch) {
      const sign = durMatch[1] === '-' ? -1 : 1;
      const isYM = !durMatch[4] && !durMatch[5] && !durMatch[6] && !durMatch[7];
      const isDT = !durMatch[2] && !durMatch[3];
      // Years-and-months and days-and-time durations expose disjoint property
      // sets. Cross-type access returns null per DMN spec evolution.
      if (key === 'years') return isDT ? null : sign * Number(durMatch[2] || 0);
      if (key === 'months') return isDT ? null : sign * Number(durMatch[3] || 0);
      if (key === 'days') return isYM ? null : sign * Number(durMatch[4] || 0);
      if (key === 'hours') return isYM ? null : sign * Number(durMatch[5] || 0);
      if (key === 'minutes') return isYM ? null : sign * Number(durMatch[6] || 0);
      if (key === 'seconds') return isYM ? null : sign * Number(durMatch[7] || 0);
      return null;
    }
    return null;
  },
  week_of_year(d: any, ...rest: any[]): any {
    if (rest.length > 0) return null;
    if (typeof d !== 'string') return null;
    const m = /^(-?)(\d+)-(\d{2})-(\d{2})/.exec(d);
    if (!m) return null;
    const y = (m[1] === '-' ? -1 : 1) * Number(m[2]);
    const dt = new Date(Date.UTC(Math.abs(y), Number(m[3]) - 1, Number(m[4])));
    // ISO 8601 week number.
    const target = new Date(dt.getTime());
    target.setUTCDate(target.getUTCDate() + 3 - ((target.getUTCDay() + 6) % 7));
    const week1 = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
    return 1 + Math.round(((target.getTime() - week1.getTime()) / 86_400_000 - 3 + ((week1.getUTCDay() + 6) % 7)) / 7);
  },
  string_length(s: any): any {
    s = feel.singleton(s);
    if (typeof s !== 'string') return null;
    // FEEL counts Unicode code points, so a single emoji or astral char is
    // length 1 even though it's two UTF-16 code units in JS.
    return [...s].length;
  },
  substring(s: any, start: any, length?: any): any {
    if (typeof s !== 'string') return null;
    // FEEL operates on code points, so split into a code-point array first
    // and slice in those terms. Emoji and astral chars are 1 unit each.
    const cps = [...s];
    let st = Number(start);
    if (st < 0) st = cps.length + st + 1;
    st = st - 1;
    if (length == null || length?.__named) return cps.slice(Math.max(0, st)).join('');
    return cps.slice(Math.max(0, st), Math.max(0, st) + Number(length)).join('');
  },
  substring_before(s: any, sub: any): any {
    if (typeof s !== 'string' || typeof sub !== 'string') return null;
    const i = s.indexOf(sub);
    return i < 0 ? '' : s.slice(0, i);
  },
  substring_after(s: any, sub: any): any {
    if (typeof s !== 'string' || typeof sub !== 'string') return null;
    const i = s.indexOf(sub);
    return i < 0 ? '' : s.slice(i + sub.length);
  },
  upper_case(s: any): any {
    s = feel.singleton(s);
    return typeof s === 'string' ? s.toUpperCase() : null;
  },
  lower_case(s: any): any {
    s = feel.singleton(s);
    return typeof s === 'string' ? s.toLowerCase() : null;
  },
  contains(s: any, sub: any): any {
    if (typeof s !== 'string' || typeof sub !== 'string') return null;
    return s.includes(sub);
  },
  starts_with(s: any, p: any): any {
    if (typeof s !== 'string' || typeof p !== 'string') return null;
    return s.startsWith(p);
  },
  ends_with(s: any, p: any): any {
    if (typeof s !== 'string' || typeof p !== 'string') return null;
    return s.endsWith(p);
  },
  // Convert FEEL regex flags (XPath: i, s, m, x, q) to JS RegExp flags.
  // Returns null for any unrecognized flag, mirroring FEEL's strict semantics.
  _xpath_flags(s: string): string | null {
    let out = '';
    let isUnicode = false;
    for (const c of s) {
      if (c === 'i') {
        out += c;
        // XPath case-insensitive matching is Unicode-aware (Kelvin K vs k);
        // add JS `u` so the engine performs full case folding.
        isUnicode = true;
      } else if (c === 'm' || c === 's') out += c;
      else if (c === 'x' || c === 'q') {
        /* handled at pattern level (x: ignore-whitespace; q: literal) */
      } else {
        return null;
      }
    }
    if (isUnicode) out += 'u';
    return out;
  },
  _xpath_pattern(pat: string, flags: string): string {
    if (flags.includes('q')) {
      // q: pattern matches the literal string. Escape regex metachars.
      return pat.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
    }
    let out = pat;
    if (flags.includes('x')) {
      // Strip comments and whitespace per XPath rules. Per the spec the
      // `x` flag removes whitespace from the regexp UNLESS it appears
      // inside a `[...]` character class. Backslashes don't protect
      // whitespace from removal — `hello\ sworld` collapses to
      // `hello\sworld` (i.e. the escape rebinds to the next non-space).
      let result = '';
      let inClass = false;
      for (let i = 0; i < pat.length; i++) {
        const c = pat[i];
        if (!inClass) {
          if (c === '#') {
            while (i < pat.length && pat[i] !== '\n') i++;
            continue;
          }
          if (/\s/.test(c)) continue;
        }
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        result += c;
      }
      out = result;
    }
    // XPath character-class subtraction `[A-Z-[OI]]` → JS-compatible
    // negative-lookahead form `(?![OI])[A-Z]`.
    out = out.replace(
      /\[([^\]\\]+(?:\\.[^\]\\]*)*)-\[([^\]\\]+(?:\\.[^\]\\]*)*)\]\]/g,
      '(?![$2])[$1]',
    );
    // XPath Unicode block names (`\p{IsBasicLatin}`) → equivalent JS
    // character ranges. JS's Unicode property names use the `Script=` /
    // `Block=` long forms; the XPath `IsXxx` shortcut isn't recognised.
    out = out.replace(/\\p\{Is([A-Za-z0-9]+)\}/g, (_, block: string) => {
      const range = feel._xpath_block_range(block);
      return range ?? `[${'\\u0000-\\uffff'}]`;
    });
    out = out.replace(/\\P\{Is([A-Za-z0-9]+)\}/g, (_, block: string) => {
      const range = feel._xpath_block_range(block);
      // Negate by switching to a negated character class.
      if (!range) return '';
      // `[abc]` → `[^abc]`.
      return range.startsWith('[') ? '[^' + range.slice(1) : range;
    });
    return out;
  },
  // Map an XPath Unicode-block short name to an equivalent JS character
  // range. Only the few that show up in TCK fixtures are wired up.
  _xpath_block_range(name: string): string | null {
    const map: Record<string, string> = {
      BasicLatin: '[\\u0000-\\u007F]',
      Latin1Supplement: '[\\u0080-\\u00FF]',
      LatinExtendedA: '[\\u0100-\\u017F]',
      LatinExtendedB: '[\\u0180-\\u024F]',
    };
    return map[name] ?? null;
  },
  matches(s: any, pat: any, flags?: any, ...rest: any[]): any {
    if (rest.length > 0) return null;
    if (typeof s !== 'string' || typeof pat !== 'string') return null;
    // FEEL: null flags is equivalent to no flags supplied.
    if (flags !== undefined && flags !== null && typeof flags !== 'string') return null;
    const f = typeof flags === 'string' ? flags : '';
    let jsFlags = feel._xpath_flags(f);
    if (jsFlags === null) return null;
    const patStr = feel._xpath_pattern(pat, f);
    // The JS `u` flag enables Unicode-aware semantics — required for
    // `\p{...}` property escapes, and it makes invalid patterns throw
    // rather than silently mis-compile (e.g. lone backreferences become
    // octal escapes without `u`). XPath wants the strict behaviour, so
    // we always add it.
    if (!jsFlags.includes('u')) jsFlags += 'u';
    try {
      return new RegExp(patStr, jsFlags).test(s);
    } catch {
      return null;
    }
  },
  replace(s: any, pat: any, rep: any, flags?: any, ...rest: any[]): any {
    if (rest.length > 0) return null;
    if (typeof s !== 'string' || typeof pat !== 'string' || typeof rep !== 'string') return null;
    if (flags !== undefined && flags !== null && typeof flags !== 'string') return null;
    const f = typeof flags === 'string' ? flags : '';
    const jsFlagsBase = feel._xpath_flags(f);
    if (jsFlagsBase === null) return null;
    const jsFlags = jsFlagsBase + 'g';
    const patStr = feel._xpath_pattern(pat, f);
    // XPath replacement: `$0` is the full match; JS uses `$&`. The `$$&`
    // replacement string yields a literal `$&` (the `$$` is an escape for
    // `$`), avoiding the JS engine's own interpretation of `$&`.
    const jsRep = rep.replace(/\$0/g, '$$&');
    try {
      return s.replace(new RegExp(patStr, jsFlags), jsRep);
    } catch {
      return null;
    }
  },
  split(s: any, sep: any): any {
    if (typeof s !== 'string' || typeof sep !== 'string') return null;
    try {
      return s.split(new RegExp(sep));
    } catch {
      return s.split(sep);
    }
  },
  string_join(list: any, sep?: any, ...rest: any[]): any {
    if (rest.length > 0) return null;
    // Singleton-list rule: a scalar string is treated as `[scalar]`.
    if (typeof list === 'string') list = [list];
    else list = feel.asList(list) as any;
    if (!Array.isArray(list)) return null;
    // Every element must be a string (or null, which is filtered out).
    for (const x of list) {
      if (x !== null && typeof x !== 'string') return null;
    }
    if (sep !== undefined && sep !== null && typeof sep !== 'string') return null;
    const s = typeof sep === 'string' ? sep : '';
    // Null elements are skipped, not stringified to "null"; the separator is
    // also skipped between adjacent surviving elements.
    return list.filter((x: any) => x !== null).join(s);
  },
  // DMN 1.4+ floor/ceiling accept an optional scale argument (digits after
  // the decimal). The scale is truncated and bounded by the BigDecimal range.
  floor(...args: any[]): any {
    if (args.length < 1 || args.length > 2) return null;
    const n = args[0];
    if (typeof n !== 'number' || !Number.isFinite(n)) return null;
    if (args.length === 1) return Math.floor(n);
    const scale = args[1];
    if (typeof scale !== 'number' || !Number.isFinite(scale)) return null;
    const s = Math.trunc(scale);
    if (s < -6111 || s > 6176) return null;
    const f = Math.pow(10, s);
    return Math.floor(n * f) / f;
  },
  ceiling(...args: any[]): any {
    if (args.length < 1 || args.length > 2) return null;
    const n = args[0];
    if (typeof n !== 'number' || !Number.isFinite(n)) return null;
    if (args.length === 1) return Math.ceil(n);
    const scale = args[1];
    if (typeof scale !== 'number' || !Number.isFinite(scale)) return null;
    const s = Math.trunc(scale);
    if (s < -6111 || s > 6176) return null;
    const f = Math.pow(10, s);
    return Math.ceil(n * f) / f;
  },
  abs(...args: any[]): any {
    if (args.length !== 1) return null;
    const n = args[0];
    if (typeof n === 'number' && Number.isFinite(n)) return Math.abs(n);
    if (typeof n === 'string' && /^-?P/.test(n)) {
      return n.startsWith('-') ? n.slice(1) : n;
    }
    return null;
  },
  modulo(...args: any[]): any {
    if (args.length !== 2) return null;
    const [a, b] = args;
    if (typeof a !== 'number' || typeof b !== 'number') return null;
    if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
    return a - b * Math.floor(a / b);
  },
  sqrt(...args: any[]): any {
    if (args.length !== 1) return null;
    const n = args[0];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return null;
    return Math.sqrt(n);
  },
  log(...args: any[]): any {
    if (args.length !== 1) return null;
    const n = args[0];
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null;
    return Math.log(n);
  },
  exp(...args: any[]): any {
    if (args.length !== 1) return null;
    const n = args[0];
    if (typeof n !== 'number' || !Number.isFinite(n)) return null;
    const r = Math.exp(n);
    return Number.isFinite(r) ? r : null;
  },
  odd(...args: any[]): any {
    if (args.length !== 1) return null;
    const n = args[0];
    if (typeof n !== 'number' || !Number.isFinite(n)) return null;
    return Math.abs(Math.trunc(n)) % 2 === 1;
  },
  even(...args: any[]): any {
    if (args.length !== 1) return null;
    const n = args[0];
    if (typeof n !== 'number' || !Number.isFinite(n)) return null;
    return Math.abs(Math.trunc(n)) % 2 === 0;
  },
  // FEEL DMN 1.4+ rounding functions. Each scales by 10^scale, applies the
  // requested rounding mode, then scales back.
  // FEEL spec: scale must be in [-6111, 6176] (Java BigDecimal MathContext);
  // out-of-range scales return null.
  _checkRound(n: any, scale: any, ...rest: any[]): boolean {
    if (rest.length > 0) return false;
    if (typeof n !== 'number' || typeof scale !== 'number') return false;
    if (!Number.isFinite(n) || !Number.isFinite(scale)) return false;
    const s = Math.trunc(scale);
    if (s < -6111 || s > 6176) return false;
    return true;
  },
  // When the requested precision exceeds what JS doubles can represent
  // (`10^scale` overflows or underflows), the rounding is a no-op — JS
  // can't represent more digits than the value already carries.
  _roundScaled(n: number, scale: number, mode: 'up' | 'down' | 'half-up' | 'half-down'): number {
    const f = Math.pow(10, scale);
    if (!Number.isFinite(f) || f === 0) return n;
    const x = n * f;
    if (!Number.isFinite(x)) return n;
    let rounded: number;
    switch (mode) {
      case 'up':
        rounded = x >= 0 ? Math.ceil(x) : Math.floor(x);
        break;
      case 'down':
        rounded = x >= 0 ? Math.floor(x) : Math.ceil(x);
        break;
      case 'half-up':
        rounded = x >= 0 ? Math.floor(x + 0.5) : -Math.floor(-x + 0.5);
        break;
      case 'half-down':
        rounded = x >= 0 ? Math.ceil(x - 0.5) : -Math.ceil(-x - 0.5);
        break;
    }
    return rounded / f;
  },
  round_up(n: any, scale: any, ...rest: any[]): any {
    if (!feel._checkRound(n, scale, ...rest)) return null;
    return feel._roundScaled(n as number, Math.trunc(scale), 'up');
  },
  round_down(n: any, scale: any, ...rest: any[]): any {
    if (!feel._checkRound(n, scale, ...rest)) return null;
    return feel._roundScaled(n as number, Math.trunc(scale), 'down');
  },
  round_half_up(n: any, scale: any, ...rest: any[]): any {
    if (!feel._checkRound(n, scale, ...rest)) return null;
    return feel._roundScaled(n as number, Math.trunc(scale), 'half-up');
  },
  round_half_down(n: any, scale: any, ...rest: any[]): any {
    if (!feel._checkRound(n, scale, ...rest)) return null;
    return feel._roundScaled(n as number, Math.trunc(scale), 'half-down');
  },
  decimal(n: any, scale: any): any {
    if (n == null || scale == null) return null;
    if (typeof n !== 'number' || typeof scale !== 'number') return null;
    if (!Number.isFinite(n) || !Number.isFinite(scale)) return null;
    const s = Math.trunc(scale);
    const f = Math.pow(10, s);
    // FEEL uses round-half-to-even (banker's rounding) per BigDecimal default.
    const x = n * f;
    const floored = Math.floor(x);
    const diff = x - floored;
    let rounded: number;
    if (diff < 0.5) rounded = floored;
    else if (diff > 0.5) rounded = floored + 1;
    else rounded = floored % 2 === 0 ? floored : floored + 1;
    return rounded / f;
  },
  number(...args: any[]): any {
    if (args.length === 1) {
      const s = args[0];
      if (s == null) return null;
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    }
    if (args.length === 3) {
      const [s, group, dec] = args;
      if (typeof s !== 'string') return null;
      if (group != null && typeof group !== 'string') return null;
      if (dec != null && typeof dec !== 'string') return null;
      // Default decimal separator is `.` when the caller passes null.
      const decSep = typeof dec === 'string' ? dec : '.';
      // FEEL: separators must differ if both are non-null
      if (group && decSep && group === decSep) return null;
      // The string may only contain digits, sign, exponent, the declared
      // group separator, and the declared decimal separator. A literal `.`
      // when `dec` is something else (e.g. `:`) is a parse error.
      const allowed = new Set(['0','1','2','3','4','5','6','7','8','9','-','+','e','E']);
      if (group) for (const c of group) allowed.add(c);
      for (const c of decSep) allowed.add(c);
      for (const c of s) {
        if (!allowed.has(c)) return null;
      }
      let str = s;
      if (group) str = str.split(group).join('');
      if (decSep !== '.') str = str.split(decSep).join('.');
      if (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(str)) return null;
      const n = Number(str);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  },
  string(v: any, ...rest: any[]): any {
    // FEEL `string` takes exactly one argument; extra args → null.
    if (rest.length > 0) return null;
    if (v === null || v === undefined) return null;
    // Top-level string is returned verbatim (no quoting); nested strings
    // inside a list/context get quoted by `_formatFeelValue`.
    if (typeof v === 'string') return v;
    return feel._formatFeelValue(v);
  },
  // Render a FEEL value as a string in FEEL syntax: lists with `[...]`,
  // contexts with `{key: value}`, strings quoted with internal quotes
  // backslash-escaped, primitives as-is.
  _formatFeelValue(v: any): string {
    if (v === null) return 'null';
    if (typeof v === 'string') return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) return `[${v.map((x) => feel._formatFeelValue(x)).join(', ')}]`;
    if (typeof v === 'object') {
      const entries = Object.entries(v).map(([k, val]) => {
        // FEEL bare name: ASCII letters/digits/underscore (must start with
        // letter/underscore). Anything else gets the quoted-string form.
        const bare = /^[A-Za-z_][A-Za-z0-9_]*$/.test(k);
        const renderedKey = bare
          ? k
          : `"${k.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
        return `${renderedKey}: ${feel._formatFeelValue(val)}`;
      });
      return `{${entries.join(', ')}}`;
    }
    return String(v);
  },
  is_defined(v: any): any {
    return v !== undefined;
  },
  // Current instant. The `@Etc/UTC` zone makes the value an `instance of
  // date and time` and avoids any host-timezone leak into the output.
  // Both `now()` and `today()` take no arguments — extras → null.
  now(...args: any[]): any {
    if (args.length > 0) return null;
    const d = new Date();
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
    const da = String(d.getUTCDate()).padStart(2, '0');
    const h = String(d.getUTCHours()).padStart(2, '0');
    const mi = String(d.getUTCMinutes()).padStart(2, '0');
    const s = String(d.getUTCSeconds()).padStart(2, '0');
    return `${String(y).padStart(4, '0')}-${mo}-${da}T${h}:${mi}:${s}@Etc/UTC`;
  },
  today(...args: any[]): any {
    if (args.length > 0) return null;
    const d = new Date();
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
    const da = String(d.getUTCDate()).padStart(2, '0');
    return `${String(y).padStart(4, '0')}-${mo}-${da}`;
  },
  // Safely invoke a value as a function. Used for bare-ident call sites
  // where the resolved value may be undefined (unknown name), null, or a
  // non-function — all of which FEEL spells as null.
  try_call(getFn: () => any, args: any[]): any {
    let fn: any;
    try {
      fn = getFn();
    } catch {
      return null;
    }
    if (typeof fn !== 'function') return null;
    try {
      return fn(...args);
    } catch {
      return null;
    }
  },
  // Invoke a FEEL function value with a named-arg context. Lambdas carry an
  // `__params` array (set by the emitter); we map names → positions and call
  // positionally. As a fallback, pass the named-args object through.
  call_named(fn: any, named: Record<string, unknown>): any {
    if (typeof fn !== 'function') return null;
    const params = (fn as any).__params as readonly string[] | undefined;
    if (params) {
      // Reject any name not in the signature (FEEL spec: extra named arg → null).
      for (const k of Object.keys(named)) {
        if (!params.includes(k)) return null;
      }
      const args = params.map((p) => named[p]);
      return fn(...args);
    }
    return fn({ __named: named });
  },
  // FEEL range(s) — string-form range constructor (DMN 1.5).
  // FEEL context(entries) — list of {key, value} objects → context value.
  context_fn(entries: any): any {
    // FEEL singleton-list rule: a single context flows in as `[context]`.
    if (
      entries &&
      typeof entries === 'object' &&
      !Array.isArray(entries) &&
      !(entries as any).__feel
    ) {
      entries = [entries];
    }
    if (!Array.isArray(entries)) return null;
    const out: Record<string, unknown> = {};
    for (const e of entries) {
      if (!e || typeof e !== 'object' || typeof (e as any).key !== 'string')
        return null;
      const k = (e as any).key;
      if (Object.prototype.hasOwnProperty.call(out, k)) return null;
      // Spec: a missing `value` (the entry has only `key`) → null result.
      if (!('value' in (e as object))) return null;
      out[k] = (e as any).value;
    }
    return out;
  },
  range_fn(s: any, ...rest: any[]): any {
    if (rest.length > 0) return null;
    if (typeof s !== 'string') return null;
    const trimmed = s.trim();
    const m = /^([\[\(\]])\s*(.+?)\s*\.\.\s*(.+?)\s*([\]\)\[])$/.exec(trimmed);
    if (!m) return null;
    const opener = m[1];
    const closer = m[4];
    const parseEndpoint = (x: string): { value: any; kind: string } | null => {
      const t = x.trim();
      if (t === 'null') return { value: null, kind: 'null' };
      if (/^-?\d+(\.\d+)?$/.test(t)) return { value: Number(t), kind: 'number' };
      if (/^"/.test(t) && /"$/.test(t)) {
        try {
          return { value: JSON.parse(t), kind: 'string' };
        } catch {
          return null;
        }
      }
      if (t.startsWith('@"') && t.endsWith('"')) {
        const raw = t.slice(2, -1);
        if (/^-?\d{4,9}-\d{2}-\d{2}T/.test(raw)) return { value: raw, kind: 'dateTime' };
        if (/^-?\d{4,9}-\d{2}-\d{2}$/.test(raw)) return { value: raw, kind: 'date' };
        if (/^\d{2}:\d{2}/.test(raw)) return { value: raw, kind: 'time' };
        if (/^-?P/.test(raw)) return { value: raw, kind: 'duration' };
        return { value: raw, kind: 'string' };
      }
      // Function-call literal endpoints like date("…"), time("…"), etc.
      const callM = /^(date and time|date|time|duration|number)\s*\(\s*"([^"]+)"\s*\)$/.exec(t);
      if (callM) {
        const fn = callM[1];
        const arg = callM[2];
        if (fn === 'date') {
          const v = feel.date(arg);
          return v == null ? null : { value: v, kind: 'date' };
        }
        if (fn === 'time') {
          const v = feel.time(arg);
          return v == null ? null : { value: v, kind: 'time' };
        }
        if (fn === 'date and time') {
          const v = feel.date_and_time(arg);
          return v == null ? null : { value: v, kind: 'dateTime' };
        }
        if (fn === 'duration') {
          return /^-?P/.test(arg) ? { value: arg, kind: 'duration' } : null;
        }
      }
      return null;
    };
    const loE = parseEndpoint(m[2]);
    const hiE = parseEndpoint(m[3]);
    if (!loE || !hiE) return null;
    if (loE.value === null && hiE.value === null) return null;
    // Endpoints must agree on type (both null is excluded above).
    if (
      loE.value !== null &&
      hiE.value !== null &&
      loE.kind !== hiE.kind
    ) {
      return null;
    }
    // Ordering: low must be <= high.
    if (loE.value !== null && hiE.value !== null) {
      if (feel.lt(hiE.value, loE.value) === true) return null;
    }
    return {
      __feel: 'range',
      lo: loE.value,
      hi: hiE.value,
      openLow: opener === '(' || opener === ']',
      openHigh: closer === ')' || closer === '[',
    };
  },
  // FEEL is(a,b) — strict same-value-and-type test.
  is_fn(a: any, b: any): any {
    if (a === null && b === null) return true;
    if (a === null || b === null) return false;
    if (typeof a !== typeof b) return false;
    if (typeof a === 'number') return a === b;
    if (typeof a === 'string' && typeof b === 'string') {
      // For datetimes/times, `is` checks wall-clock + zone match (not the
      // instant), so "12:00:00-01:00" and "17:00:00+04:00" are NOT
      // `is`-equal even though they're the same instant.
      const isDt = (s: string) => /^-?\d{4,9}-\d{2}-\d{2}T/.test(s);
      if ((isDt(a) && isDt(b)) || (feel.is_time(a) && feel.is_time(b))) {
        return a === b;
      }
      // For durations, `is` is family-strict: a years-months duration is
      // never `is`-equal to a days-time duration even when both are zero
      // (`P0Y` vs `P0D`). `feel.eq` treats zero specially across
      // families; that doesn't carry over here.
      if (/^-?P/.test(a) && /^-?P/.test(b)) {
        const aIsYm = feel.ym_to_months(a) != null;
        const bIsYm = feel.ym_to_months(b) != null;
        if (aIsYm !== bIsYm) return false;
        return a === b;
      }
    }
    return feel.eq(a, b);
  },
  instance_of(v: any, typeName: string, itemDefs?: any, typeArgs?: string): any {
    if (v == null) return false;
    // Allow callers to pass `name<args>` as a single string — split off
    // the args here so recursive calls don't have to do the parsing.
    if (typeArgs == null && typeName.includes('<')) {
      const lt = typeName.indexOf('<');
      const inner = typeName.slice(lt);
      // Strip the matching trailing `>`.
      let depth = 0;
      let end = -1;
      for (let i = 0; i < inner.length; i++) {
        if (inner[i] === '<') depth++;
        else if (inner[i] === '>') {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      if (end > 0) {
        typeArgs = inner.slice(1, end).trim();
        typeName = typeName.slice(0, lt).trim();
      }
    }
    const local = typeName.includes(':') ? typeName.split(':').pop() : typeName;
    // Generic-shape checks: `list<T>` requires every element to be a T;
    // `context<a: T, b: U>` requires the value to be a context with each
    // declared field conforming to its declared type.
    if (typeArgs) {
      if (local === 'list') {
        if (!Array.isArray(v)) return false;
        const elemType = typeArgs.trim();
        return v.every(
          (it) => feel.instance_of(it, elemType, itemDefs) === true,
        );
      }
      if (local === 'context') {
        if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
        // Parse `name: type, name2: type2` into entries. Type values may
        // contain nested generic args (`list<T>`) — split on top-level
        // commas only.
        const fields: { name: string; type: string }[] = [];
        let depth = 0;
        let cur = '';
        const flush = () => {
          const idx = cur.indexOf(':');
          if (idx >= 0) {
            fields.push({
              name: cur.slice(0, idx).trim(),
              type: cur.slice(idx + 1).trim(),
            });
          }
          cur = '';
        };
        for (const c of typeArgs) {
          if (c === '<') {
            depth++;
            cur += c;
          } else if (c === '>') {
            depth--;
            cur += c;
          } else if (c === ',' && depth === 0) {
            flush();
          } else {
            cur += c;
          }
        }
        if (cur.trim()) flush();
        for (const f of fields) {
          const fv = (v as Record<string, unknown>)[f.name];
          if (fv === undefined) return false;
          if (fv !== null && feel.instance_of(fv, f.type, itemDefs) !== true) {
            return false;
          }
        }
        return true;
      }
      if (local === 'range') {
        if (!(typeof v === 'object' && (v as any).__feel === 'range')) return false;
        const elemType = typeArgs.trim();
        const lo = (v as any).lo;
        const hi = (v as any).hi;
        if (lo !== null && feel.instance_of(lo, elemType, itemDefs) !== true) return false;
        if (hi !== null && feel.instance_of(hi, elemType, itemDefs) !== true) return false;
        return true;
      }
    }
    // User-defined item definitions delegate to their base type. allowedValues
    // are NOT considered for `instance of` per FEEL spec.
    if (itemDefs && local && itemDefs[local]) {
      const def = itemDefs[local];
      if (def.isCollection) {
        if (!Array.isArray(v)) return false;
        if (!def.base) return true;
        return v.every((it: any) => feel.instance_of(it, def.base, itemDefs) === true);
      }
      if (def.components && def.components.length) {
        if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
        for (const c of def.components) {
          const fv = (v as Record<string, unknown>)[c.name];
          if (fv === undefined) return false;
          if (c.typeRef && fv !== null && feel.instance_of(fv, c.typeRef, itemDefs) !== true) {
            return false;
          }
        }
        return true;
      }
      if (def.base) return feel.instance_of(v, def.base, itemDefs);
      return true;
    }
    switch (local) {
      case 'string':
        return (
          typeof v === 'string' &&
          !/^-?\d{4,9}-\d{2}-\d{2}/.test(v) &&
          !/^\d{2}:\d{2}:\d{2}/.test(v) &&
          !/^-?P/.test(v)
        );
      case 'number':
        return typeof v === 'number' && Number.isFinite(v);
      case 'boolean':
        return typeof v === 'boolean';
      case 'date':
        return typeof v === 'string' && /^-?\d{4,9}-\d{2}-\d{2}$/.test(v);
      case 'time':
        return typeof v === 'string' && /^\d{2}:\d{2}:\d{2}/.test(v) && !v.includes('T');
      case 'dateTime':
      case 'date and time':
        return typeof v === 'string' && /T/.test(v);
      case 'duration':
        return typeof v === 'string' && /^-?P/.test(v);
      case 'years and months duration':
        return (
          typeof v === 'string' && feel.ym_to_months(v) !== null
        );
      case 'days and time duration':
        return (
          typeof v === 'string' && feel.dt_to_seconds(v) !== null
        );
      case 'list':
        return Array.isArray(v);
      case 'context':
        return typeof v === 'object' && !Array.isArray(v);
      case 'Any':
      case 'any':
        return true;
      case 'function':
        return typeof v === 'function';
      case 'range':
        return (
          (typeof v === 'object' && (v as any).__feel === 'range') ||
          Array.isArray(v)
        );
      default:
        // Unknown / user-defined type. Per FEEL TCK convention return false
        // when the value clearly doesn't fit; can't validate user types.
        return false;
    }
  },
  date(..._args: any[]): any {
    // Multi-arity: `date(s)` or `date(y, m, d)`. Named-arg calls may pad
    // leading slots with `undefined`; strip those.
    const args = _args.slice();
    while (args.length && args[0] === undefined) args.shift();
    const isLeap = (y: number) =>
      (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    const daysIn = (y: number, m: number) => {
      const t = [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      return t[m - 1];
    };
    const fmt = (y: number, m: number, d: number): string | null => {
      if (![y, m, d].every(Number.isFinite)) return null;
      if (y === 0 || m < 1 || m > 12 || d < 1) return null;
      if (Math.abs(y) > 999_999_999) return null;
      if (d > daysIn(Math.abs(y), m)) return null;
      const sign = y < 0 ? '-' : '';
      const yStr = String(Math.abs(y));
      return `${sign}${yStr.length < 4 ? yStr.padStart(4, '0') : yStr}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    };
    if (args.length === 1) {
      const a = args[0];
      if (typeof a !== 'string') return null;
      let iso: string;
      if (/^-?\d{4,9}-\d{2}-\d{2}$/.test(a)) {
        iso = a;
      } else {
        const dt = /^(-?\d{4,9}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}/.exec(a);
        if (!dt) return null;
        iso = dt[1];
      }
      // 5+ digit years must not start with 0 (no leading-zero extended year).
      const yearPart = iso.startsWith('-') ? iso.slice(1).split('-')[0] : iso.split('-')[0];
      if (yearPart.length > 4 && yearPart.startsWith('0')) return null;
      const neg = iso.startsWith('-');
      const body = neg ? iso.slice(1) : iso;
      const [y, m, d] = body.split('-').map(Number);
      return fmt(neg ? -y : y, m, d);
    }
    if (args.length === 3) {
      if (args.some((a) => a == null)) return null;
      const [y, m, d] = args.map(Number);
      return fmt(y, m, d);
    }
    return null;
  },
  time(..._args: any[]): any {
    const args = _args.slice();
    while (args.length && args[0] === undefined) args.shift();
    const fmtTime = (h: number, m: number, s: number, frac?: string, tz?: string): string | null => {
      if (![h, m, s].every(Number.isFinite)) return null;
      if (h < 0 || h > 23 || m < 0 || m > 59 || s < 0 || s >= 60) return null;
      // Allow ±HH:MM and ±HH:MM:SS offsets, range ±14:00.
      if (tz && tz !== 'Z' && !tz.startsWith('@')) {
        const tzM = /^([+-])(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(tz);
        if (tzM) {
          const oH = Number(tzM[2]);
          const oM = Number(tzM[3]);
          const oS = tzM[4] ? Number(tzM[4]) : 0;
          if (oH > 14 || oM > 59 || oS > 59) return null;
        }
      }
      // Validate IANA zone names against the real database.
      if (tz && tz.startsWith('@')) {
        const zone = tz.slice(1);
        try {
          new Intl.DateTimeFormat('en', { timeZone: zone });
        } catch {
          return null;
        }
      }
      // Format seconds with a leading zero on the integer part, preserving
      // any fractional component but trimming f64 noise (toFixed(9) plus
      // trailing-zero strip) so 1.3 renders as "01.3" not "01.3000…04".
      let sStr: string;
      if (Number.isInteger(s)) {
        sStr = String(s).padStart(2, '0');
      } else {
        const repr = s.toFixed(9).replace(/0+$/, '').replace(/\.$/, '');
        const [intPart, fracPart] = repr.split('.');
        sStr = intPart.padStart(2, '0') + (fracPart ? '.' + fracPart : '');
      }
      const head = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${sStr}`;
      const tzNorm = tz === '+00:00' || tz === '-00:00' ? 'Z' : tz;
      // Strip trailing zeros from the fractional component (and the lone dot).
      let fracOut = '';
      if (frac) {
        const trimmed = frac.replace(/0+$/, '');
        fracOut = trimmed === '.' ? '' : trimmed;
      }
      return head + fracOut + (tzNorm ?? '');
    };
    if (args.length === 1) {
      const a = args[0];
      if (typeof a !== 'string') return null;
      // A pure date string → midnight UTC.
      if (/^-?\d{4,9}-\d{2}-\d{2}$/.test(a)) {
        return '00:00:00Z';
      }
      // Accept a date-and-time string and extract the time portion.
      const dtTime = /T(\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}(?::\d{2})?|@[A-Za-z_+\-/]+)?)$/.exec(a);
      const candidate = dtTime ? dtTime[1] : a;
      const m = /^(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2}(?::\d{2})?|@[A-Za-z_+\-/]+)?$/.exec(candidate);
      if (!m) return null;
      return fmtTime(Number(m[1]), Number(m[2]), Number(m[3]), m[4], m[5]);
    }
    if (args.length >= 3) {
      if (args.slice(0, 3).some((a) => a == null)) return null;
      const [h, m, s] = args.map(Number);
      // Optional 4th arg: timezone offset, expressed either as `±HH:MM`/`Z`
      // or as a days-and-time duration (which we convert to ±HH:MM).
      let tz: string | undefined = undefined;
      if (args[3] != null) {
        if (typeof args[3] === 'string') {
          if (/^Z|[+-]\d{2}:\d{2}$/.test(args[3]) || /^@[A-Za-z_+\-/]+$/.test(args[3])) {
            tz = args[3];
          } else if (/^-?P/.test(args[3])) {
            const sec = feel.dt_to_seconds(args[3]);
            if (sec == null) return null;
            if (sec === 0) tz = 'Z';
            else {
              const sign = sec < 0 ? '-' : '+';
              const abs = Math.abs(sec);
              const oh = Math.floor(abs / 3600);
              const om = Math.floor((abs % 3600) / 60);
              const os = Math.floor(abs % 60);
              tz = `${sign}${String(oh).padStart(2, '0')}:${String(om).padStart(2, '0')}${os ? ':' + String(os).padStart(2, '0') : ''}`;
            }
          } else {
            return null;
          }
        } else {
          return null;
        }
      }
      return fmtTime(h, m, s, undefined, tz);
    }
    return null;
  },
  date_and_time(..._args: any[]): any {
    const args = _args.slice();
    while (args.length && args[0] === undefined) args.shift();
    if (args.length === 1) {
      const a = args[0];
      if (typeof a !== 'string') return null;
      // Accept a pure date string — append midnight.
      if (/^-?\d{4,9}-\d{2}-\d{2}$/.test(a)) {
        const d = feel.date(a);
        return d ? `${d}T00:00:00` : null;
      }
      // Normalize T24:00:00 (end-of-day) to T00:00:00 on the next calendar day.
      let normalized = a;
      const eod = /^(-?\d{4,9}-\d{2}-\d{2})T24:00:00((?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}(?::\d{2})?|@[A-Za-z_+\-/]+)?)$/.exec(a);
      if (eod) {
        const next = feel.add_date_duration(eod[1], 'P1D');
        if (!next) return null;
        normalized = `${next}T00:00:00${eod[2]}`;
      }
      const m = /^(-?\d{4,9}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}(?::\d{2})?|@[A-Za-z_+\-/]+)?)$/.exec(normalized);
      if (!m) return null;
      const d = feel.date(m[1]);
      const t = feel.time(m[2]);
      return d && t ? `${d}T${t}` : null;
    }
    if (args.length === 2) {
      if (args.some((a) => a == null)) return null;
      const d = feel.date(args[0]);
      const t = feel.time(args[1]);
      return d && t ? `${d}T${t}` : null;
    }
    return null;
  },
  duration(s: any): any {
    if (typeof s !== 'string') return null;
    const m = /^(-)?P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)(?:\.(\d*))?S)?)?$/.exec(s);
    if (!m) return null;
    // `P` alone (and `P` followed only by an empty `T`) isn't a valid duration.
    if (!m[2] && !m[3] && !m[4] && !m[5] && !m[6] && !m[7]) {
      return null;
    }
    const sign = m[1] || '';
    let y = Number(m[2] || '0');
    let mo = Number(m[3] || '0');
    let d = Number(m[4] || '0');
    let h = Number(m[5] || '0');
    let mi = Number(m[6] || '0');
    let sec = Number(m[7] || '0');
    const fracDigits = m[8] ? m[8].replace(/0+$/, '') : '';
    // If the input only carries years/months (no day/time), emit the
    // years-and-months canonical form via ym_format.
    // Classify by the presence of capture groups in the input string, not
    // their parsed numeric values — `P0M` and `P0Y` are years-and-months
    // (even though both components are zero) and should round-trip as YM.
    const hasY = m[2] !== undefined;
    const hasMo = m[3] !== undefined;
    const hasD = m[4] !== undefined;
    const hasH = m[5] !== undefined;
    const hasMi = m[6] !== undefined;
    const hasS = m[7] !== undefined;
    const isYmOnly = (hasY || hasMo) && !hasD && !hasH && !hasMi && !hasS;
    if (isYmOnly) {
      const totalMonths = (sign === '-' ? -1 : 1) * (y * 12 + mo);
      return feel.ym_format(totalMonths);
    }
    // Normalize: roll over seconds → minutes → hours → days. Don't roll
    // months → years (months can exceed 12 when crossing year boundaries
    // wasn't part of the input). Days don't roll into months (variable length).
    if (sec >= 60) {
      mi += Math.floor(sec / 60);
      sec = sec % 60;
    }
    if (mi >= 60) {
      h += Math.floor(mi / 60);
      mi = mi % 60;
    }
    if (h >= 24) {
      d += Math.floor(h / 24);
      h = h % 24;
    }
    if (mo >= 12) {
      y += Math.floor(mo / 12);
      mo = mo % 12;
    }
    let date = '';
    if (y) date += `${y}Y`;
    if (mo) date += `${mo}M`;
    if (d) date += `${d}D`;
    let time = '';
    if (h) time += `${h}H`;
    if (mi) time += `${mi}M`;
    if (sec !== 0 || fracDigits) {
      time += `${sec}${fracDigits ? '.' + fracDigits : ''}S`;
    }
    if (!date && !time) time = '0S';
    // Drop sign when result is canonical zero.
    const isZero = !y && !mo && !d && !h && !mi && sec === 0 && !fracDigits;
    return `${isZero ? '' : sign}P${date}${time ? 'T' + time : ''}`;
  },
  years_and_months_duration(from: any, to: any): any {
    if (typeof from !== 'string' || typeof to !== 'string') return null;
    const parseFull = (s: string): { y: number; m: number; d: number } | null => {
      const m = /^(-?)(\d+)-(\d{2})-(\d{2})/.exec(s);
      if (!m) return null;
      const sgn = m[1] === '-' ? -1 : 1;
      return { y: sgn * Number(m[2]), m: Number(m[3]), d: Number(m[4]) };
    };
    const a = parseFull(from);
    const b = parseFull(to);
    if (!a || !b) return null;
    // Whole calendar months between the two dates.
    let months = (b.y - a.y) * 12 + (b.m - a.m);
    if (months > 0 && b.d < a.d) months -= 1;
    if (months < 0 && b.d > a.d) months += 1;
    const sign = months < 0 ? '-' : '';
    const abs = Math.abs(months);
    const years = Math.floor(abs / 12);
    const remM = abs % 12;
    let body = '';
    if (years) body += `${years}Y`;
    if (remM) body += `${remM}M`;
    if (!body) body = '0M';
    return `${sign}P${body}`;
  },
};

