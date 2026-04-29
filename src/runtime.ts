// FEEL runtime helpers — used by every generated tom-rools module.
// Edit this file in source-of-truth form; transpiler copies it into output packages.

export const feel: any = {
  neg(a: any): any {
    if (a == null) return null;
    return -Number(a);
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
    if (!body) body = '0Y';
    return `${sign}P${body}`;
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
    return `${sign}P${date}${time ? 'T' + time : ''}`;
  },
  is_duration(v: any): boolean {
    return typeof v === 'string' && /^-?P/.test(v);
  },
  is_date_or_dt(v: any): boolean {
    if (typeof v !== 'string') return false;
    return /^-?\d{4,9}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2})?/.test(v);
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
    if (typeof a === 'string' || typeof b === 'string') return String(a) + String(b);
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
      // Negate the duration and add.
      const negated = b.startsWith('-') ? b.slice(1) : '-' + b;
      return feel.add_date_duration(a, negated);
    }
    if (feel.is_date_or_dt(a) && feel.is_date_or_dt(b)) {
      return feel.diff_dates(a, b);
    }
    if (typeof a !== 'number' || typeof b !== 'number') return null;
    return a - b;
  },
  mul(a: any, b: any): any {
    if (a == null || b == null) return null;
    if (feel.is_duration(a) && typeof b === 'number') return feel.scale_duration(a, b);
    if (feel.is_duration(b) && typeof a === 'number') return feel.scale_duration(b, a);
    if (typeof a !== 'number' || typeof b !== 'number') return null;
    return a * b;
  },
  div(a: any, b: any): any {
    if (a == null || b == null) return null;
    if (feel.is_duration(a) && typeof b === 'number') {
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
    const dtMatch = /^(-?\d{4,9}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2}(?:\.\d+)?)/.exec(d);
    if (dtMatch) {
      const baseSec = feel.dt_to_seconds(dur);
      if (baseSec != null) {
        // Force UTC for naive date-and-time strings (no timezone suffix).
        const dForParse = /Z|[+-]\d{2}:\d{2}$/.test(d) ? d : d + 'Z';
        const ms = Date.parse(dForParse);
        if (!Number.isNaN(ms)) {
          const out = new Date(ms + baseSec * 1000);
          const iso = out.toISOString().slice(0, 19);
          return iso;
        }
      }
      const months = feel.ym_to_months(dur);
      if (months != null) {
        const dForParse = /Z|[+-]\d{2}:\d{2}$/.test(d) ? d : d + 'Z';
        const ms = Date.parse(dForParse);
        if (!Number.isNaN(ms)) {
          const out = new Date(ms);
          out.setUTCMonth(out.getUTCMonth() + months);
          return out.toISOString().slice(0, 19);
        }
      }
    }
    return null;
  },
  diff_dates(a: any, b: any): any {
    if (typeof a !== 'string' || typeof b !== 'string') return null;
    // For pure dates: result is a days-and-time duration.
    const dateA = /^(-?\d{4,9})-(\d{2})-(\d{2})$/.exec(a);
    const dateB = /^(-?\d{4,9})-(\d{2})-(\d{2})$/.exec(b);
    if (dateA && dateB) {
      const tA = Date.UTC(Number(dateA[1]), Number(dateA[2]) - 1, Number(dateA[3]));
      const tB = Date.UTC(Number(dateB[1]), Number(dateB[2]) - 1, Number(dateB[3]));
      return feel.dt_format((tA - tB) / 1000);
    }
    const aForParse = /Z|[+-]\d{2}:\d{2}$/.test(a) ? a : a + 'Z';
    const bForParse = /Z|[+-]\d{2}:\d{2}$/.test(b) ? b : b + 'Z';
    const tA = Date.parse(aForParse);
    const tB = Date.parse(bForParse);
    if (!Number.isNaN(tA) && !Number.isNaN(tB)) {
      return feel.dt_format((tA - tB) / 1000);
    }
    return null;
  },
  pow(a: any, b: any): any {
    if (a == null || b == null) return null;
    const r = Math.pow(Number(a), Number(b));
    return Number.isFinite(r) ? r : null;
  },
  eq(a: any, b: any): any {
    if (a === null && b === null) return true;
    if (a == null || b == null) return false;
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
      if (Array.isArray(a) !== Array.isArray(b)) return false;
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
  lt(a: any, b: any): any {
    if (a == null || b == null) return null;
    if (typeof a === 'string' && typeof b === 'string') return a < b;
    return Number(a) < Number(b);
  },
  le(a: any, b: any): any {
    if (a == null || b == null) return null;
    if (typeof a === 'string' && typeof b === 'string') return a <= b;
    return Number(a) <= Number(b);
  },
  gt(a: any, b: any): any {
    if (a == null || b == null) return null;
    if (typeof a === 'string' && typeof b === 'string') return a > b;
    return Number(a) > Number(b);
  },
  ge(a: any, b: any): any {
    if (a == null || b == null) return null;
    if (typeof a === 'string' && typeof b === 'string') return a >= b;
    return Number(a) >= Number(b);
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
        lo == null ||
        hi == null ||
        typeof lo !== 'number' ||
        typeof hi !== 'number' ||
        !Number.isInteger(lo) ||
        !Number.isInteger(hi)
      ) {
        return [];
      }
      if (Math.abs(hi - lo) > 1_000_000) return [];
      const out: number[] = [];
      const step = lo <= hi ? 1 : -1;
      const cur = openLow ? lo + step : lo;
      const end = openHigh ? hi - step : hi;
      if (step > 0) for (let i = cur; i <= end; i++) out.push(i);
      else for (let i = cur; i >= end; i--) out.push(i);
      return out;
    }
    return [];
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
    list = feel.asList(list) as any;
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
      // constant predicate — apply uniformly
      return probe ? list.slice() : [];
    }
    return list.filter((it: any) => fn(it) === true);
  },
  count(list: any): any {
    return Array.isArray(list) ? list.length : null;
  },
  sum(...args: any[]): any {
    const items = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
    let s = 0;
    for (const x of items) {
      if (x == null) return null;
      s += Number(x);
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
    const items = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
    if (items.length === 0) return null;
    let s = 0;
    for (const x of items) {
      if (x == null) return null;
      s += Number(x);
    }
    return s / items.length;
  },
  all(...args: any[]): any {
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
      const { lo, hi, openLow, openHigh } = list;
      const lower = lo == null ? true : openLow ? feel.lt(lo, item) : feel.le(lo, item);
      const upper = hi == null ? true : openHigh ? feel.lt(item, hi) : feel.le(item, hi);
      return lower === true && upper === true;
    }
    if (list && typeof list === 'object' && list.__feel === 'tests') {
      // Positive unary tests — match if any test passes. Tests may themselves
      // reference ranges/lists; predicate already returns true/false.
      return list.tests.some((fn: any) => fn(item) === true);
    }
    list = feel.asList(list) as any;
    if (!Array.isArray(list)) return null;
    for (const x of list) {
      // Recurse into nested ranges/lists/tests for in-membership semantics.
      if (x && typeof x === 'object' && (x.__feel === 'range' || x.__feel === 'tests')) {
        if (feel.list_contains(x, item) === true) return true;
        continue;
      }
      if (Array.isArray(x)) {
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
  product(list: any): any {
    list = feel.asList(list) as any;
    if (!Array.isArray(list)) return null;
    let p = 1;
    for (const x of list) {
      if (x == null) return null;
      p *= Number(x);
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
    if (!Array.isArray(list) || position == null) return null;
    let i = Number(position);
    if (!Number.isFinite(i)) return null;
    if (i < 0) i = list.length + i + 1;
    if (i < 1 || i > list.length) return null;
    const out = [...list];
    out[i - 1] = newItem;
    return out;
  },
  median(list: any): any {
    if (!Array.isArray(list) || list.length === 0) return null;
    const nums = list.map(Number).sort((a, b) => a - b);
    if (nums.some((n) => !Number.isFinite(n))) return null;
    const mid = Math.floor(nums.length / 2);
    return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
  },
  stddev(list: any): any {
    if (!Array.isArray(list) || list.length < 2) return null;
    const nums = list.map(Number);
    if (nums.some((n) => !Number.isFinite(n))) return null;
    const m = nums.reduce((s, x) => s + x, 0) / nums.length;
    const v = nums.reduce((s, x) => s + (x - m) * (x - m), 0) / (nums.length - 1);
    return Math.sqrt(v);
  },
  mode(list: any): any {
    list = feel.asList(list) as any;
    if (!Array.isArray(list)) return null;
    if (list.length === 0) return [];
    const counts = new Map<any, number>();
    for (const x of list) counts.set(x, (counts.get(x) ?? 0) + 1);
    let max = 0;
    for (const v of counts.values()) if (v > max) max = v;
    const modes: any[] = [];
    for (const [k, v] of counts) if (v === max) modes.push(k);
    return modes.sort();
  },
  sort(list: any, precedes: any): any {
    list = feel.asList(list) as any;
    if (!Array.isArray(list)) return null;
    if (typeof precedes !== 'function') return [...list].sort();
    return [...list].sort((a: any, b: any) => (precedes(a, b) === true ? -1 : 1));
  },
  get_value(m: any, key: any): any {
    if (m == null || typeof m !== 'object' || Array.isArray(m)) return null;
    if (typeof key !== 'string') return null;
    return key in m ? (m as Record<string, unknown>)[key] : null;
  },
  get_entries(m: any): any {
    if (m == null || typeof m !== 'object' || Array.isArray(m)) return null;
    return Object.entries(m).map(([key, value]) => ({ key, value }));
  },
  context_put(context: any, key: any, value: any): any {
    if (context == null || typeof context !== 'object' || Array.isArray(context)) return null;
    if (typeof key !== 'string') return null;
    return { ...(context as object), [key]: value };
  },
  context_merge(contexts: any): any {
    if (!Array.isArray(contexts)) return null;
    const out: Record<string, unknown> = {};
    for (const c of contexts) {
      if (c == null || typeof c !== 'object' || Array.isArray(c)) return null;
      Object.assign(out, c);
    }
    return out;
  },
  day_of_year(d: any): any {
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
  day_of_week(d: any): any {
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
  month_of_year(d: any): any {
    if (typeof d !== 'string') return null;
    const m = /^-?\d+-(\d{2})-\d{2}/.exec(d);
    if (!m) return null;
    const names = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    return names[Number(m[1]) - 1] ?? null;
  },
  // Property access — handles object fields and the implicit fields exposed
  // by date/time/dateTime/duration string values (year, month, day, hour, …).
  prop(obj: any, key: string): any {
    if (obj == null) return null;
    if (typeof obj === 'string') return feel.temporal_prop(obj, key);
    if (Array.isArray(obj)) {
      // Expanded ranges (closed-closed integer ranges) — best-effort props.
      if (key === 'start') return obj[0] ?? null;
      if (key === 'end') return obj[obj.length - 1] ?? null;
      if (key === 'start included' || key === 'end included') return true;
      return null;
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
        if (key === 'time offset' || key === 'timezone') return dtMatch[9] || null;
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
      if (key === 'time offset' || key === 'timezone') return tMatch[5] || null;
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
  week_of_year(d: any): any {
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
    return typeof s === 'string' ? s.length : null;
  },
  substring(s: any, start: any, length?: any): any {
    if (typeof s !== 'string') return null;
    let st = Number(start);
    if (st < 0) st = s.length + st + 1;
    st = st - 1;
    if (length == null || length?.__named) return s.slice(Math.max(0, st));
    return s.slice(Math.max(0, st), Math.max(0, st) + Number(length));
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
  matches(s: any, pat: any): any {
    if (typeof s !== 'string' || typeof pat !== 'string') return null;
    try {
      return new RegExp(pat).test(s);
    } catch {
      return null;
    }
  },
  replace(s: any, pat: any, rep: any): any {
    if (typeof s !== 'string' || typeof pat !== 'string' || typeof rep !== 'string') return null;
    try {
      return s.replace(new RegExp(pat, 'g'), rep);
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
  string_join(list: any, sep?: any): any {
    list = feel.asList(list) as any;
    if (!Array.isArray(list)) return null;
    const s = sep == null || sep?.__named ? '' : String(sep);
    return list.map((x) => (x == null ? '' : String(x))).join(s);
  },
  floor(...args: any[]): any {
    if (args.length !== 1) return null;
    const n = args[0];
    if (typeof n !== 'number' || !Number.isFinite(n)) return null;
    return Math.floor(n);
  },
  ceiling(...args: any[]): any {
    if (args.length !== 1) return null;
    const n = args[0];
    if (typeof n !== 'number' || !Number.isFinite(n)) return null;
    return Math.ceil(n);
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
  decimal(n: any, scale: any): any {
    if (n == null || scale == null) return null;
    const s = Number(scale);
    const f = Math.pow(10, s);
    return Math.round(Number(n) * f) / f;
  },
  number(s: any): any {
    if (s == null) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  },
  string(v: any): any {
    if (v == null) return null;
    if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return String(v);
    return null;
  },
  is_defined(v: any): any {
    return v !== undefined;
  },
  // FEEL range(s) — string-form range constructor (DMN 1.5).
  range_fn(s: any): any {
    if (typeof s !== 'string') return null;
    const m = /^([\[\(\]])\s*(.+?)\s*\.\.\s*(.+?)\s*([\]\)\[])$/.exec(s);
    if (!m) return null;
    const opener = m[1];
    const closer = m[4];
    const parse = (x: string): any => {
      const t = x.trim();
      if (t === 'null') return null;
      if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
      if (/^"/.test(t) && /"$/.test(t)) {
        try {
          return JSON.parse(t);
        } catch {
          return null;
        }
      }
      if (t.startsWith('@"') && t.endsWith('"')) {
        return t.slice(2, -1);
      }
      return null;
    };
    const lo = parse(m[2]);
    const hi = parse(m[3]);
    if (lo === undefined || hi === undefined) return null;
    return {
      __feel: 'range',
      lo,
      hi,
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
    return feel.eq(a, b);
  },
  instance_of(v: any, typeName: string): any {
    if (v == null) return false;
    const local = typeName.includes(':') ? typeName.split(':').pop() : typeName;
    switch (local) {
      case 'string':
        return typeof v === 'string';
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
      case 'years and months duration':
      case 'days and time duration':
        return typeof v === 'string' && /^-?P/.test(v);
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
      // Validate explicit `+HH:MM` / `-HH:MM` offsets (range ±14:00).
      if (tz && tz !== 'Z' && !tz.startsWith('@')) {
        const tzM = /^([+-])(\d{2}):(\d{2})$/.exec(tz);
        if (tzM) {
          const oH = Number(tzM[2]);
          const oM = Number(tzM[3]);
          if (oH > 14 || oM > 59) return null;
        }
      }
      const head = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      const tzNorm = tz === '+00:00' || tz === '-00:00' ? 'Z' : tz;
      return head + (frac ?? '') + (tzNorm ?? '');
    };
    if (args.length === 1) {
      const a = args[0];
      if (typeof a !== 'string') return null;
      // Accept a date-and-time string and extract the time portion.
      const dtTime = /T(\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}|@[A-Za-z_+\-/]+)?)$/.exec(a);
      const candidate = dtTime ? dtTime[1] : a;
      const m = /^(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2}|@[A-Za-z_+\-/]+)?$/.exec(candidate);
      if (!m) return null;
      return fmtTime(Number(m[1]), Number(m[2]), Number(m[3]), m[4], m[5]);
    }
    if (args.length >= 3) {
      if (args.slice(0, 3).some((a) => a == null)) return null;
      const [h, m, s] = args.map(Number);
      return fmtTime(h, m, s);
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
      const m = /^(-?\d{4,9}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}|@[A-Za-z_+\-/]+)?)$/.exec(a);
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
    // Reject empty body (`P` alone)
    if (!m[2] && !m[3] && !m[4] && !m[5] && !m[6] && !m[7]) {
      // Allow strings that explicitly pass through the T marker only if a 0-second is emitted
      // Otherwise normalize to PT0S for inputs like "P0D".
    }
    const sign = m[1] || '';
    let y = Number(m[2] || '0');
    let mo = Number(m[3] || '0');
    let d = Number(m[4] || '0');
    let h = Number(m[5] || '0');
    let mi = Number(m[6] || '0');
    let sec = Number(m[7] || '0');
    const fracDigits = m[8] ? m[8].replace(/0+$/, '') : '';
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
    return `${sign}P${date}${time ? 'T' + time : ''}`;
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

