// Small FEEL expression parser + emitter. Covers the subset needed for cl2/1.1:
// or / and / comparison / +-*/** / unary -, not(...) / member access / function call /
// number, string, boolean, null literals / multi-word identifiers (longest-match
// against `knownNames`).

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toJsIdent } from './ident.js';

export type FeelNode =
  | { type: 'num'; value: number }
  | { type: 'str'; value: string }
  | { type: 'bool'; value: boolean }
  | { type: 'null' }
  | { type: 'ident'; name: string }
  | { type: 'unary'; op: '-' | 'not'; arg: FeelNode }
  | { type: 'binop'; op: string; left: FeelNode; right: FeelNode }
  | { type: 'paren'; expr: FeelNode }
  | {
      type: 'call';
      fn: FeelNode;
      args: FeelNode[];
      namedArgs?: { name: string; value: FeelNode }[];
    }
  | { type: 'member'; obj: FeelNode; name: string }
  | { type: 'if'; cond: FeelNode; thenE: FeelNode; elseE: FeelNode }
  | { type: 'list'; items: FeelNode[] }
  | { type: 'context'; entries: { key: string; value: FeelNode }[] }
  | { type: 'index'; list: FeelNode; index: FeelNode }
  | {
      type: 'for';
      bindings: { name: string; range: FeelNode }[];
      body: FeelNode;
    }
  | {
      type: 'quant';
      kind: 'some' | 'every';
      bindings: { name: string; range: FeelNode }[];
      body: FeelNode;
    }
  | { type: 'between'; value: FeelNode; lo: FeelNode; hi: FeelNode }
  | { type: 'in'; value: FeelNode; list: FeelNode }
  | { type: 'instanceof'; value: FeelNode; typeName: string }
  | { type: 'temporal'; value: string }
  | {
      type: 'unaryTests';
      tests: Array<
        | { kind: 'cmp'; op: string; rhs: FeelNode }
        | { kind: 'expr'; expr: FeelNode }
      >;
    }
  | {
      type: 'lambda';
      params: string[];
      // Optional declared type per parameter (parallel to `params`). Used
      // to validate arguments at call time — a non-conforming value coerces
      // to null at the boundary.
      paramTypes?: (string | undefined)[];
      body: FeelNode;
    }
  | {
      type: 'range';
      lo: FeelNode;
      hi: FeelNode;
      openLow: boolean;
      openHigh: boolean;
    };

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'str'; value: string }
  | { kind: 'ident'; name: string }
  | { kind: 'kw'; name: string }
  | { kind: 'op'; op: string }
  | { kind: 'punct'; ch: string }
  | { kind: 'temporal'; value: string };

const KEYWORDS = new Set([
  'and',
  'or',
  'not',
  'true',
  'false',
  'null',
  'if',
  'then',
  'else',
  'for',
  'in',
  'return',
  'some',
  'every',
  'satisfies',
  'between',
  'instance',
  'of',
  'function',
]);
const MULTI_OPS = ['<=', '>=', '!=', '**'];
const SINGLE_OPS = ['<', '>', '=', '+', '-', '*', '/'];
const PUNCT = new Set(['(', ')', '[', ']', '{', '}', ',', '.', ':']);

// Parameter order for FEEL builtins, used to map named arguments to positions.
// Keyed by the FEEL builtin name (the same key as FEEL_BUILTINS).
export const FEEL_BUILTIN_PARAMS: Record<string, string[]> = {
  count: ['list'],
  sum: ['list'],
  min: ['list'],
  max: ['list'],
  mean: ['list'],
  all: ['list'],
  any: ['list'],
  sublist: ['list', 'start position', 'length'],
  append: ['list', 'item'],
  concatenate: ['list'],
  reverse: ['list'],
  'list contains': ['list', 'element'],
  'distinct values': ['list'],
  flatten: ['list'],
  product: ['list'],
  'string length': ['string'],
  substring: ['string', 'start position', 'length'],
  'substring before': ['string', 'match'],
  'substring after': ['string', 'match'],
  'upper case': ['string'],
  'lower case': ['string'],
  contains: ['string', 'match'],
  'starts with': ['string', 'match'],
  'ends with': ['string', 'match'],
  matches: ['input', 'pattern', 'flags'],
  replace: ['input', 'pattern', 'replacement', 'flags'],
  split: ['string', 'delimiter'],
  'string join': ['list', 'delimiter'],
  // FEEL spec uses `n` for math fns that operate on a single number;
  // `number` for abs/even/odd specifically.
  floor: ['n'],
  ceiling: ['n'],
  abs: ['n'],
  modulo: ['dividend', 'divisor'],
  sqrt: ['number'],
  log: ['number'],
  exp: ['number'],
  odd: ['number'],
  even: ['number'],
  decimal: ['n', 'scale'],
  number: ['from', 'grouping separator', 'decimal separator'],
  string: ['from'],
  // Multi-arity constructors: signature is the union of all named-param
  // forms, with leading slots padded as `undefined` when the call uses a
  // later form. The runtime strips those at call time.
  date: ['from', 'year', 'month', 'day'],
  time: ['from', 'hour', 'minute', 'second', 'offset'],
  'date and time': ['from', 'date', 'time'],
  duration: ['from'],
  'years and months duration': ['from', 'to'],
  'insert before': ['list', 'position', 'newItem'],
  'index of': ['list', 'match'],
  union: ['list'],
  remove: ['list', 'position'],
  median: ['list'],
  stddev: ['list'],
  mode: ['list'],
  sort: ['list', 'precedes'],
  'get value': ['m', 'key'],
  'get entries': ['m'],
  'context put': ['context', 'key', 'value'],
  'context merge': ['contexts'],
  'day of year': ['date'],
  'day of week': ['date'],
  'month of year': ['date'],
  'week of year': ['date'],
  'list replace': ['list', 'position', 'newItem'],
  is: ['value1', 'value2'],
  range: ['from'],
  'round up': ['n', 'scale'],
  'round down': ['n', 'scale'],
  'round half up': ['n', 'scale'],
  'round half down': ['n', 'scale'],
  context: ['entries'],
};

// Builtin FEEL function names (multi-word ones must be in the names list so the
// tokenizer matches them as a single identifier). Mapped to the JS-safe name
// of the corresponding helper in the runtime.
export const FEEL_BUILTINS: Record<string, string> = {
  count: 'count',
  sum: 'sum',
  min: 'min',
  max: 'max',
  mean: 'mean',
  all: 'all',
  any: 'any',
  sublist: 'sublist',
  append: 'append',
  concatenate: 'concatenate',
  reverse: 'reverse',
  'list contains': 'list_contains',
  'distinct values': 'distinct_values',
  flatten: 'flatten',
  product: 'product',
  'string length': 'string_length',
  substring: 'substring',
  'substring before': 'substring_before',
  'substring after': 'substring_after',
  'upper case': 'upper_case',
  'lower case': 'lower_case',
  contains: 'contains',
  'starts with': 'starts_with',
  'ends with': 'ends_with',
  matches: 'matches',
  replace: 'replace',
  split: 'split',
  'string join': 'string_join',
  floor: 'floor',
  ceiling: 'ceiling',
  abs: 'abs',
  modulo: 'modulo',
  sqrt: 'sqrt',
  log: 'log',
  exp: 'exp',
  odd: 'odd',
  even: 'even',
  decimal: 'decimal',
  number: 'number',
  string: 'string',
  'is defined': 'is_defined',
  date: 'date',
  time: 'time',
  'date and time': 'date_and_time',
  duration: 'duration',
  'years and months duration': 'years_and_months_duration',
  'insert before': 'insert_before',
  'index of': 'index_of',
  union: 'union',
  remove: 'remove',
  median: 'median',
  stddev: 'stddev',
  mode: 'mode',
  sort: 'sort',
  'get value': 'get_value',
  'get entries': 'get_entries',
  'context put': 'context_put',
  'context merge': 'context_merge',
  'day of year': 'day_of_year',
  'day of week': 'day_of_week',
  'month of year': 'month_of_year',
  'week of year': 'week_of_year',
  'list replace': 'list_replace',
  is: 'is_fn',
  range: 'range_fn',
  'round up': 'round_up',
  'round down': 'round_down',
  'round half up': 'round_half_up',
  'round half down': 'round_half_down',
  context: 'context_fn',
};

// All parameter names referenced by FEEL_BUILTIN_PARAMS, flattened — these must
// be recognized by the tokenizer (multi-word names like "start position") so
// named-argument calls parse correctly.
const FEEL_PARAM_NAMES: string[] = Array.from(
  new Set(Object.values(FEEL_BUILTIN_PARAMS).flat()),
);

// Match a known FEEL identifier (possibly multi-word like `date and time`) at
// position `i`, allowing arbitrary whitespace between words. Returns the
// number of input characters consumed, or null if no match.
function matchMultiWord(
  input: string,
  name: string,
  i: number,
): number | null {
  if (!name.includes(' ')) {
    return input.startsWith(name, i) ? name.length : null;
  }
  const parts = name.split(' ');
  let cur = i;
  for (let k = 0; k < parts.length; k++) {
    if (k > 0) {
      while (cur < input.length && /\s/.test(input[cur])) cur++;
      if (cur >= input.length) return null;
    }
    if (!input.startsWith(parts[k], cur)) return null;
    cur += parts[k].length;
  }
  return cur - i;
}

function isWordChar(c: string): boolean {
  if (!c) return false;
  if (/[A-Za-z0-9_]/.test(c)) return true;
  if (c >= '\uD800' && c <= '\uDBFF') return true;
  return /\p{L}|\p{N}|\p{Extended_Pictographic}/u.test(c);
}

// Tests whether the code point starting at `input[i]` is a valid identifier
// start char. Surrogate pairs (e.g. emoji like 🐎) need to be reassembled
// before being tested against `/u` regexes.
function isUnicodeIdentStart(input: string, i: number): boolean {
  const c = input[i];
  if (c >= '\uD800' && c <= '\uDBFF' && i + 1 < input.length) {
    const cp = input.slice(i, i + 2);
    return /\p{L}|\p{Extended_Pictographic}/u.test(cp);
  }
  return /\p{L}|\p{Extended_Pictographic}/u.test(c);
}

function tokenize(input: string, knownNames: string[]): Token[] {
  // Model names first (same-length ties go to input order with stable sort, so
  // user-declared names win over builtins of the same length). Param names
  // come last; they're only consulted in named-arg call positions.
  const allNames = [
    ...knownNames,
    ...Object.keys(FEEL_BUILTINS),
    ...FEEL_PARAM_NAMES,
  ];
  const sortedNames = allNames.sort((a, b) => b.length - a.length);
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    // Line comment
    if (c === '/' && input[i + 1] === '/') {
      i += 2;
      while (i < input.length && input[i] !== '\n') i++;
      continue;
    }
    // Block comment
    if (c === '/' && input[i + 1] === '*') {
      i += 2;
      while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) i++;
      if (i < input.length) i += 2;
      continue;
    }

    // Number
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(input[i + 1] ?? ''))) {
      const m = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(input.slice(i));
      if (m) {
        tokens.push({ kind: 'num', value: Number(m[0]) });
        i += m[0].length;
        continue;
      }
    }

    // Temporal literal: @"..."
    if (c === '@' && input[i + 1] === '"') {
      let j = i + 2;
      let raw = '';
      while (j < input.length && input[j] !== '"') {
        if (input[j] === '\\' && j + 1 < input.length) {
          raw += input[j + 1];
          j += 2;
        } else {
          raw += input[j];
          j++;
        }
      }
      if (j < input.length) j++;
      tokens.push({ kind: 'temporal', value: raw });
      i = j;
      continue;
    }
    // String
    if (c === '"') {
      let j = i + 1;
      let raw = '';
      while (j < input.length && input[j] !== '"') {
        if (input[j] === '\\' && j + 1 < input.length) {
          const esc = input[j + 1];
          if (esc === 'n') raw += '\n';
          else if (esc === 't') raw += '\t';
          else if (esc === 'r') raw += '\r';
          else if (esc === '"') raw += '"';
          else if (esc === '\\') raw += '\\';
          else if (esc === "'") raw += "'";
          else if (esc === '/') raw += '/';
          else if (esc === 'b') raw += '\b';
          else if (esc === 'f') raw += '\f';
          else if (esc === 'u' && /^[0-9A-Fa-f]{4}/.test(input.slice(j + 2, j + 6))) {
            // Per FEEL: `\uXXXX` is a 4-hex-digit Unicode code unit.
            raw += String.fromCharCode(parseInt(input.slice(j + 2, j + 6), 16));
            j += 6;
            continue;
          } else if (esc === 'U' && /^[0-9A-Fa-f]{6}/.test(input.slice(j + 2, j + 8))) {
            // FEEL: `\UXXXXXX` is a 6-hex-digit Unicode code point (DMN 1.3+).
            raw += String.fromCodePoint(parseInt(input.slice(j + 2, j + 8), 16));
            j += 8;
            continue;
          }
          // Unknown escape — preserve verbatim so regex metachars like
          // `\s`, `\d`, `\w` survive into runtime regex compilation.
          else raw += '\\' + esc;
          j += 2;
        } else {
          raw += input[j];
          j++;
        }
      }
      tokens.push({ kind: 'str', value: raw });
      i = j + 1;
      continue;
    }

    // Range operator `..` — must come before single `.` punctuation.
    if (c === '.' && input[i + 1] === '.') {
      tokens.push({ kind: 'op', op: '..' });
      i += 2;
      continue;
    }

    // Multi-char operator
    let matchedOp = false;
    for (const op of MULTI_OPS) {
      if (input.startsWith(op, i)) {
        tokens.push({ kind: 'op', op });
        i += op.length;
        matchedOp = true;
        break;
      }
    }
    if (matchedOp) continue;

    // Single-char operator
    if (SINGLE_OPS.includes(c)) {
      tokens.push({ kind: 'op', op: c });
      i++;
      continue;
    }

    // Punctuation
    if (PUNCT.has(c)) {
      tokens.push({ kind: 'punct', ch: c });
      i++;
      continue;
    }

    // Identifier — try longest known multi-word name first, else single-word.
    // Unicode letters (and a couple of symbol classes — for emoji etc.) are
    // valid identifier chars per the FEEL spec; surrogate pairs cover the
    // astral-plane range like 🐎.
    if (/[A-Za-z_]/.test(c) || isUnicodeIdentStart(input, i)) {
      let matchedName: string | null = null;
      let matchedLen = 0;
      for (const name of sortedNames) {
        const consumed = matchMultiWord(input, name, i);
        if (consumed != null) {
          const before = i === 0 ? ' ' : input[i - 1];
          const after =
            i + consumed >= input.length ? ' ' : input[i + consumed];
          if (!isWordChar(before) && !isWordChar(after)) {
            matchedName = name;
            matchedLen = consumed;
            break;
          }
        }
      }
      if (matchedName) {
        tokens.push({ kind: 'ident', name: matchedName });
        i += matchedLen;
        continue;
      }
      // Single-token identifier — ASCII letters/digits/underscore plus
      // Unicode letters and pictographs (emoji like 🐎). We avoid the broader
      // `Emoji` and `So` classes because they include ASCII operator chars
      // (`*`, etc.) which would swallow the next operator into the ident.
      const m = /^(?:[A-Za-z_]|\p{L}|\p{Extended_Pictographic})(?:[A-Za-z0-9_]|\p{L}|\p{N}|\p{Extended_Pictographic})*/u.exec(input.slice(i));
      if (m) {
        if (KEYWORDS.has(m[0])) tokens.push({ kind: 'kw', name: m[0] });
        else tokens.push({ kind: 'ident', name: m[0] });
        i += m[0].length;
        continue;
      }
    }

    throw new Error(
      `feel tokenize: unexpected character ${JSON.stringify(c)} at index ${i} of ${JSON.stringify(input)}`,
    );
  }
  return tokens;
}

class Parser {
  private pos = 0;
  // Counter: when > 0 we're inside a bracketed range/list/test group. While
  // set, postfix `[` is not consumed as an index, so an outer alt-range closer
  // like `[1..10[` works.
  private inBracket = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): FeelNode {
    const expr = this.parseExpression();
    if (this.pos < this.tokens.length) {
      throw new Error(`feel parse: trailing tokens at ${this.pos}`);
    }
    return expr;
  }

  private parseExpression(): FeelNode {
    if (this.isKw('if')) {
      this.next();
      const cond = this.parseExpression();
      if (!this.isKw('then')) throw new Error('feel parse: expected then');
      this.next();
      const thenE = this.parseExpression();
      if (!this.isKw('else')) throw new Error('feel parse: expected else');
      this.next();
      const elseE = this.parseExpression();
      return { type: 'if', cond, thenE, elseE };
    }
    if (this.isKw('for')) {
      this.next();
      const bindings = [this.parseInBinding()];
      while (this.isPunct(',')) {
        this.next();
        bindings.push(this.parseInBinding());
      }
      if (!this.isKw('return')) throw new Error('feel parse: expected return');
      this.next();
      const body = this.parseExpression();
      return { type: 'for', bindings, body };
    }
    if (this.isKw('some') || this.isKw('every')) {
      const kindTok = this.next() as { kind: 'kw'; name: string };
      const kind: 'some' | 'every' =
        kindTok.name === 'every' ? 'every' : 'some';
      const bindings = [this.parseInBinding()];
      while (this.isPunct(',')) {
        this.next();
        bindings.push(this.parseInBinding());
      }
      if (!this.isKw('satisfies'))
        throw new Error('feel parse: expected satisfies');
      this.next();
      const body = this.parseExpression();
      return { type: 'quant', kind, bindings, body };
    }
    return this.parseOr();
  }

  // Parses one item inside a `(...)` group: either a positive unary test
  // (e.g. `< X`, `>= Y`) or a regular expression (which may itself be a range
  // when followed by `..`).
  private parseTestItem():
    | { kind: 'cmp'; op: string; rhs: FeelNode }
    | { kind: 'expr'; expr: FeelNode } {
    const t = this.peek();
    if (
      t?.kind === 'op' &&
      ['<=', '>=', '<', '>', '=', '!='].includes(t.op)
    ) {
      const op = (this.next() as { kind: 'op'; op: string }).op;
      const rhs = this.parseAdd();
      return { kind: 'cmp', op, rhs };
    }
    return { kind: 'expr', expr: this.parseExpression() };
  }

  private skipTypeArgs(): void {
    if (!this.isOp('<')) return;
    this.next();
    let depth = 1;
    while (depth > 0 && this.peek()) {
      const t = this.next();
      if (t.kind === 'op') {
        if (t.op === '<') depth++;
        else if (t.op === '>') depth--;
      }
    }
  }

  private parseLambdaParam(): { name: string; typeRef?: string } {
    const t = this.next();
    if (t.kind !== 'ident')
      throw new Error('feel parse: expected parameter name');
    if (this.isPunct(':')) {
      this.next();
      // Capture the type annotation. It may be a multi-word ident
      // (`date and time`), a namespace-prefixed name (`feel:string`), or
      // a `.member` chain — collect identifier tokens through optional
      // `:` separators (after the first segment) and `.` member access.
      const parts: string[] = [];
      let first = true;
      while (true) {
        if (!first && this.isPunct(':')) {
          // Namespace prefix: emit unchanged, the typeRef is `prefix:name`.
          this.next();
          parts.push(':');
        }
        const nt = this.peek();
        if (nt?.kind === 'ident' || nt?.kind === 'kw') {
          this.next();
          parts.push(nt.name);
          first = false;
          continue;
        }
        break;
      }
      while (this.isPunct('.')) {
        this.next();
        const nt = this.peek();
        if (nt?.kind === 'ident' || nt?.kind === 'kw') {
          this.next();
        }
      }
      // Re-collapse the parts: idents joined with spaces, but `:`
      // (namespace separator) joins without surrounding spaces.
      let typeRef = '';
      for (const p of parts) {
        if (p === ':') typeRef += ':';
        else typeRef += (typeRef && !typeRef.endsWith(':') ? ' ' : '') + p;
      }
      return { name: t.name, typeRef: typeRef || undefined };
    }
    return { name: t.name };
  }

  private parseInBinding(): { name: string; range: FeelNode } {
    const t = this.next();
    if (t.kind !== 'ident')
      throw new Error('feel parse: expected binding name');
    if (!this.isKw('in')) throw new Error('feel parse: expected in');
    this.next();
    const range = this.parseOr();
    return { name: t.name, range };
  }

  private peek(off = 0): Token | undefined {
    return this.tokens[this.pos + off];
  }
  private next(): Token {
    return this.tokens[this.pos++];
  }
  private isOp(op: string): boolean {
    const t = this.peek();
    return t?.kind === 'op' && t.op === op;
  }
  private isKw(name: string): boolean {
    const t = this.peek();
    return t?.kind === 'kw' && t.name === name;
  }
  private isPunct(ch: string): boolean {
    const t = this.peek();
    return t?.kind === 'punct' && t.ch === ch;
  }

  private parseOr(): FeelNode {
    let left = this.parseAnd();
    while (this.isKw('or')) {
      this.next();
      left = { type: 'binop', op: 'or', left, right: this.parseAnd() };
    }
    return left;
  }
  private parseAnd(): FeelNode {
    let left = this.parseComp();
    while (this.isKw('and')) {
      this.next();
      left = { type: 'binop', op: 'and', left, right: this.parseComp() };
    }
    return left;
  }
  private parseComp(): FeelNode {
    const left = this.parseAdd();
    if (this.isKw('between')) {
      this.next();
      const lo = this.parseAdd();
      if (!this.isKw('and')) throw new Error('feel parse: expected and');
      this.next();
      const hi = this.parseAdd();
      return { type: 'between', value: left, lo, hi };
    }
    if (this.isKw('in')) {
      this.next();
      const t = this.peek();
      if (
        t?.kind === 'op' &&
        ['<=', '>=', '<', '>', '=', '!='].includes(t.op)
      ) {
        const op = (this.next() as { kind: 'op'; op: string }).op;
        const right = this.parseAdd();
        return { type: 'binop', op, left, right };
      }
      const list = this.parseAdd();
      return { type: 'in', value: left, list };
    }
    if (this.isKw('instance')) {
      this.next();
      if (!this.isKw('of')) throw new Error('feel parse: expected of');
      this.next();
      const first = this.next();
      const parts: string[] = [
        first.kind === 'ident'
          ? first.name
          : first.kind === 'kw'
            ? first.name
            : '',
      ];
      while (this.peek()?.kind === 'ident' || this.peek()?.kind === 'kw') {
        const t = this.next();
        parts.push(t.kind === 'ident' ? t.name : t.kind === 'kw' ? t.name : '');
      }
      // Skip generic params `<…>` and optional `-> type` for function/range/list.
      this.skipTypeArgs();
      while (this.isOp('-') && this.peek(1)?.kind === 'op' && (this.peek(1) as any).op === '>') {
        this.next();
        this.next();
        // Return type: ident (possibly multi-word) followed by optional <…>.
        while (this.peek()?.kind === 'ident' || this.peek()?.kind === 'kw') {
          this.next();
        }
        this.skipTypeArgs();
      }
      return {
        type: 'instanceof',
        value: left,
        typeName: parts.filter((p) => p).join(' '),
      };
    }
    const compOps = ['<=', '>=', '!=', '<', '>', '='];
    const t = this.peek();
    if (t?.kind === 'op' && compOps.includes(t.op)) {
      this.next();
      return { type: 'binop', op: t.op, left, right: this.parseAdd() };
    }
    return left;
  }
  private parseAdd(): FeelNode {
    let left = this.parseMul();
    while (this.isOp('+') || this.isOp('-')) {
      const op = (this.next() as { kind: 'op'; op: string }).op;
      left = { type: 'binop', op, left, right: this.parseMul() };
    }
    if (this.isOp('..')) {
      this.next();
      const hi = this.parseAdd();
      return { type: 'range', lo: left, hi, openLow: false, openHigh: false };
    }
    return left;
  }
  private parseMul(): FeelNode {
    let left = this.parseExp();
    while (this.isOp('*') || this.isOp('/')) {
      const op = (this.next() as { kind: 'op'; op: string }).op;
      left = { type: 'binop', op, left, right: this.parseExp() };
    }
    return left;
  }
  private parseExp(): FeelNode {
    let left = this.parseUnary();
    while (this.isOp('**')) {
      this.next();
      left = { type: 'binop', op: '**', left, right: this.parseUnary() };
    }
    return left;
  }
  private parseUnary(): FeelNode {
    if (this.isOp('-')) {
      this.next();
      return { type: 'unary', op: '-', arg: this.parseUnary() };
    }
    if (this.isKw('not')) {
      this.next();
      if (this.isPunct('(')) {
        this.next();
        const arg = this.parseOr();
        if (!this.isPunct(')')) throw new Error('feel parse: expected )');
        this.next();
        return { type: 'unary', op: 'not', arg };
      }
      return { type: 'unary', op: 'not', arg: this.parseUnary() };
    }
    return this.parsePostfix();
  }
  private parsePostfix(): FeelNode {
    let expr = this.parsePrimary();
    while (
      this.isPunct('.') ||
      this.isPunct('(') ||
      (this.isPunct('[') && this.inBracket === 0)
    ) {
      if (this.isPunct('.')) {
        this.next();
        // FEEL field names can be multi-word (e.g. `time offset`). Allow the
        // first token to be a keyword (some types have `in` etc. as fields),
        // then gather subsequent ident tokens only.
        const first = this.peek();
        if (first?.kind !== 'ident' && first?.kind !== 'kw') {
          throw new Error('feel parse: expected member name');
        }
        const parts: string[] = [
          (this.next() as { kind: 'ident' | 'kw'; name: string }).name,
        ];
        while (this.peek()?.kind === 'ident') {
          parts.push((this.next() as { kind: 'ident'; name: string }).name);
        }
        expr = { type: 'member', obj: expr, name: parts.join(' ') };
      } else if (this.isPunct('(')) {
        this.next();
        const positional: FeelNode[] = [];
        const named: { name: string; value: FeelNode }[] = [];
        if (!this.isPunct(')')) {
          this.parseCallArg(positional, named);
          while (this.isPunct(',')) {
            this.next();
            this.parseCallArg(positional, named);
          }
        }
        if (!this.isPunct(')')) throw new Error('feel parse: expected )');
        this.next();
        expr = {
          type: 'call',
          fn: expr,
          args: positional,
          namedArgs: named.length ? named : undefined,
        };
      } else {
        // list/filter index — `expr[N]`
        this.next();
        const index = this.parseExpression();
        if (!this.isPunct(']')) throw new Error('feel parse: expected ]');
        this.next();
        expr = { type: 'index', list: expr, index };
      }
    }
    return expr;
  }

  // Parse a single call argument: either `name(s): expr` (named, possibly
  // multi-word) or `expr` (positional). Look ahead for `ident+ :` and only
  // consume that prefix when the colon is the next non-ident token.
  private parseCallArg(
    positional: FeelNode[],
    named: { name: string; value: FeelNode }[],
  ): void {
    let i = this.pos;
    while (this.tokens[i]?.kind === 'ident') i++;
    const after = this.tokens[i];
    if (i > this.pos && after?.kind === 'punct' && after.ch === ':') {
      const parts: string[] = [];
      while (this.peek()?.kind === 'ident') {
        parts.push((this.next() as { kind: 'ident'; name: string }).name);
      }
      this.next(); // consume ':'
      named.push({ name: parts.join(' '), value: this.parseExpression() });
      return;
    }
    positional.push(this.parseExpression());
  }
  private parsePrimary(): FeelNode {
    const t = this.peek();
    if (!t) throw new Error('feel parse: unexpected end');
    if (t.kind === 'num') {
      this.next();
      return { type: 'num', value: t.value };
    }
    if (t.kind === 'str') {
      this.next();
      return { type: 'str', value: t.value };
    }
    if (t.kind === 'temporal') {
      this.next();
      return { type: 'temporal', value: t.value };
    }
    if (t.kind === 'kw') {
      if (t.name === 'true') {
        this.next();
        return { type: 'bool', value: true };
      }
      if (t.name === 'false') {
        this.next();
        return { type: 'bool', value: false };
      }
      if (t.name === 'null') {
        this.next();
        return { type: 'null' };
      }
      if (t.name === 'function') {
        this.next();
        if (!this.isPunct('('))
          throw new Error('feel parse: expected ( after function');
        this.next();
        const paramSpecs: { name: string; typeRef?: string }[] = [];
        if (!this.isPunct(')')) {
          paramSpecs.push(this.parseLambdaParam());
          while (this.isPunct(',')) {
            this.next();
            paramSpecs.push(this.parseLambdaParam());
          }
        }
        if (!this.isPunct(')')) throw new Error('feel parse: expected )');
        this.next();
        // Optional FEEL function return-type annotation: `: typeName` (ignored).
        if (this.isPunct(':')) {
          this.next();
          this.parsePrimary();
        }
        const body = this.parseExpression();
        const params = paramSpecs.map((p) => p.name);
        const paramTypes = paramSpecs.some((p) => p.typeRef)
          ? paramSpecs.map((p) => p.typeRef)
          : undefined;
        return { type: 'lambda', params, paramTypes, body };
      }
    }
    if (t.kind === 'ident') {
      this.next();
      return { type: 'ident', name: t.name };
    }
    // Alternative range syntax: `]X..Y]` (≡ `(X..Y]`), `]X..Y[` (≡ `(X..Y)`).
    if (t.kind === 'punct' && t.ch === ']') {
      this.next();
      this.inBracket++;
      const inner = this.parseAdd();
      // parseAdd handles `..` itself, so `inner` is normally already a range.
      let lo: FeelNode;
      let hi: FeelNode;
      if (inner.type === 'range') {
        lo = inner.lo;
        hi = inner.hi;
      } else {
        if (!this.isOp('..')) throw new Error('feel parse: expected ..');
        this.next();
        lo = inner;
        hi = this.parseAdd();
      }
      const closeT = this.peek();
      if (
        !(closeT?.kind === 'punct' &&
          (closeT.ch === ')' || closeT.ch === ']' || closeT.ch === '['))
      ) {
        throw new Error('feel parse: expected ) or ] or [');
      }
      const closer = closeT.ch;
      this.next();
      this.inBracket--;
      return {
        type: 'range',
        lo,
        hi,
        openLow: true,
        openHigh: closer === ')' || closer === '[',
      };
    }
    if (t.kind === 'punct' && t.ch === '(') {
      this.next();
      this.inBracket++;
      const items = [this.parseTestItem()];
      while (this.isPunct(',')) {
        this.next();
        items.push(this.parseTestItem());
      }
      const closeT = this.peek();
      if (
        !(closeT?.kind === 'punct' &&
          (closeT.ch === ')' || closeT.ch === ']' || closeT.ch === '['))
      ) {
        throw new Error('feel parse: expected ) or ] or [');
      }
      const closer = closeT.ch;
      this.next();
      this.inBracket--;
      if (items.length > 1) {
        return { type: 'unaryTests', tests: items };
      }
      const only = items[0];
      if (only.kind === 'cmp') {
        const op = only.op;
        const rhs = only.rhs;
        if (op === '!=') {
          return { type: 'unaryTests', tests: [only] };
        }
        const nullNode: FeelNode = { type: 'null' };
        if (op === '>')
          return { type: 'range', lo: rhs, hi: nullNode, openLow: true, openHigh: true };
        if (op === '>=')
          return { type: 'range', lo: rhs, hi: nullNode, openLow: false, openHigh: true };
        if (op === '<')
          return { type: 'range', lo: nullNode, hi: rhs, openLow: true, openHigh: true };
        if (op === '<=')
          return { type: 'range', lo: nullNode, hi: rhs, openLow: true, openHigh: false };
        return { type: 'range', lo: rhs, hi: rhs, openLow: false, openHigh: false };
      }
      // Plain expression
      const inner = only.expr;
      if (
        inner.type === 'range' &&
        (closer === ')' || closer === ']')
      ) {
        return {
          type: 'range',
          lo: inner.lo,
          hi: inner.hi,
          openLow: true,
          openHigh: closer === ')',
        };
      }
      if (closer !== ')') throw new Error('feel parse: expected )');
      return { type: 'paren', expr: inner };
    }
    if (t.kind === 'punct' && t.ch === '[') {
      this.next();
      this.inBracket++;
      if (this.isPunct(']')) {
        this.next();
        this.inBracket--;
        return { type: 'list', items: [] };
      }
      const first = this.parseExpression();
      // Bracketed range: `[2..4]`, `[2..4)`, `[2..4[`. Outer `[` means openLow=false.
      if (
        first.type === 'range' &&
        (this.isPunct(')') || this.isPunct(']') || this.isPunct('['))
      ) {
        const closer = (this.peek() as { kind: 'punct'; ch: string }).ch;
        this.next();
        this.inBracket--;
        return {
          type: 'range',
          lo: first.lo,
          hi: first.hi,
          openLow: false,
          openHigh: closer === ')' || closer === '[',
        };
      }
      const items: FeelNode[] = [first];
      while (this.isPunct(',')) {
        this.next();
        items.push(this.parseExpression());
      }
      if (!this.isPunct(']')) throw new Error('feel parse: expected ]');
      this.next();
      this.inBracket--;
      return { type: 'list', items };
    }
    if (t.kind === 'punct' && t.ch === '{') {
      this.next();
      const entries: { key: string; value: FeelNode }[] = [];
      if (!this.isPunct('}')) {
        entries.push(this.parseContextEntry());
        while (this.isPunct(',')) {
          this.next();
          entries.push(this.parseContextEntry());
        }
      }
      if (!this.isPunct('}')) throw new Error('feel parse: expected }');
      this.next();
      return { type: 'context', entries };
    }
    throw new Error(
      `feel parse: unexpected token ${JSON.stringify(t)} at ${this.pos}`,
    );
  }

  private parseContextEntry(): { key: string; value: FeelNode } {
    let key: string;
    const t = this.next();
    if (t.kind === 'str') {
      key = t.value;
    } else if (t.kind === 'ident' || t.kind === 'kw') {
      // Greedily consume idents/keywords/operators until the `:` that
      // separates the key from the value. Adjacent idents pick up a
      // joining space; operator-glued forms like `foo+bar` don't.
      let key2 = t.kind === 'kw' ? t.name : t.name;
      let lastWasIdent = true;
      while (this.pos < this.tokens.length && !this.isPunct(':')) {
        const next = this.tokens[this.pos];
        if (next.kind === 'ident' || next.kind === 'kw') {
          const name = next.kind === 'kw' ? next.name : next.name;
          key2 += (lastWasIdent ? ' ' : '') + name;
          lastWasIdent = true;
          this.pos++;
        } else if (next.kind === 'op') {
          key2 += next.op;
          lastWasIdent = false;
          this.pos++;
        } else {
          break;
        }
      }
      key = key2;
    } else {
      throw new Error('feel parse: expected context key');
    }
    if (!this.isPunct(':')) throw new Error('feel parse: expected :');
    this.next();
    const value = this.parseExpression();
    return { key, value };
  }
}

const BINOP_TO_RUNTIME: Record<string, string> = {
  and: 'and',
  or: 'or',
  '+': 'add',
  '-': 'sub',
  '*': 'mul',
  '/': 'div',
  '**': 'pow',
  '=': 'eq',
  '!=': 'neq',
  '<': 'lt',
  '<=': 'le',
  '>': 'gt',
  '>=': 'ge',
};

export interface CompileContext {
  signatures: Record<string, string[]>;
  validatableTypes?: Set<string>;
  // User-defined type names whose itemDefinition is `isCollection: true`. We
  // skip the FEEL singleton-unwrap on decisions returning these (otherwise
  // `[["a","b"]]` gets flattened to `["a","b"]` before list validation).
  collectionTypes?: Set<string>;
  // Set when compiling the predicate body of a list-filter `expr[predicate]`.
  // Free identifier references then fall back to property access on the
  // current `item`, per FEEL filter scope rules.
  inFilterScope?: boolean;
  // FEEL-name → JS-ident remap for context-entry locals that don't share
  // the canonical `toJsIdent` name (e.g. when the entry name shadows a
  // module-level binding like a BKM or decision service).
  localBindings?: Record<string, string>;
  // Module-scope names (BKMs, decision services, decisions). When a context
  // entry's name collides with one of these, the local is given a different
  // JS ident to avoid TDZ shadowing of the module function.
  moduleScopeNames?: Set<string>;
  // DMN spec version of the source model. A few semantics are version-gated:
  // duplicate-key context literals were valid in 1.1/1.2 (last wins) and
  // became errors in 1.3+ (DMN14-178).
  dmnVersion?: '1.1' | '1.2' | '1.3' | '1.4' | '1.5' | 'unknown';
  // User-defined function-item types — `<functionItem outputTypeRef="X">`.
  // Used by the emitter to forward function-typed BKM/decision return
  // validation to the underlying output type instead of the function type.
  functionItems?: Map<string, { outputTypeRef?: string }>;
  // Map from input-data name to its declared typeRef. Used by the decision
  // prelude to validate inputs at the boundary.
  inputDataTypes?: Map<string, string>;
  // Names known to be in the current JS scope (input data, decisions,
  // BKMs, lambda parameters, context-entry locals, etc.). When a name is
  // in scope it wins over a same-named FEEL builtin during identifier
  // emission — common collisions: `product`, `count`, `number`.
  inScopeNames?: Set<string>;
}

const DEFAULT_CTX: CompileContext = { signatures: {} };

// Walks the AST checking for any `ident` node with the given name. Used to
// detect `partial` references in for-loop bodies.
function referencesName(node: FeelNode, name: string): boolean {
  switch (node.type) {
    case 'ident':
      return node.name === name;
    case 'unary':
      return referencesName(node.arg, name);
    case 'binop':
      return referencesName(node.left, name) || referencesName(node.right, name);
    case 'paren':
      return referencesName(node.expr, name);
    case 'call':
      return (
        referencesName(node.fn, name) ||
        node.args.some((a) => referencesName(a, name)) ||
        (node.namedArgs ?? []).some((na) => referencesName(na.value, name))
      );
    case 'member':
      return referencesName(node.obj, name);
    case 'if':
      return (
        referencesName(node.cond, name) ||
        referencesName(node.thenE, name) ||
        referencesName(node.elseE, name)
      );
    case 'list':
      return node.items.some((i) => referencesName(i, name));
    case 'context':
      return node.entries.some((e) => referencesName(e.value, name));
    case 'index':
      return (
        referencesName(node.list, name) || referencesName(node.index, name)
      );
    case 'for':
    case 'quant':
      return (
        node.bindings.some((b) => referencesName(b.range, name)) ||
        referencesName(node.body, name)
      );
    case 'between':
      return (
        referencesName(node.value, name) ||
        referencesName(node.lo, name) ||
        referencesName(node.hi, name)
      );
    case 'in':
      return referencesName(node.value, name) || referencesName(node.list, name);
    case 'instanceof':
      return referencesName(node.value, name);
    case 'lambda':
      return referencesName(node.body, name);
    case 'range':
      return referencesName(node.lo, name) || referencesName(node.hi, name);
    case 'unaryTests':
      return node.tests.some((t) =>
        t.kind === 'cmp' ? referencesName(t.rhs, name) : referencesName(t.expr, name),
      );
    default:
      return false;
  }
}

function emitIdent(name: string, ctx?: CompileContext): string {
  // Local context-entry rebinding wins (e.g. when the entry name shadows
  // a module-scope BKM/service of the same name).
  const remapped = ctx?.localBindings?.[name];
  if (remapped) return remapped;
  // Inside a filter predicate: prefer a property of the iterated item over
  // any same-named outer binding (so `[{a:1}][a > 0]` reads each item's `a`
  // and `[{item:1}][item > 0]` reads each item's `item` rather than the
  // whole iteration variable). Fall back to the JS-scope variable, then
  // to a same-named FEEL builtin, then to null.
  if (ctx?.inFilterScope) {
    const key = JSON.stringify(name);
    const ident = toJsIdent(name);
    const builtinFallback = FEEL_BUILTINS[name]
      ? `feel.${FEEL_BUILTINS[name]}`
      : 'null';
    return `((item != null && typeof item === 'object' && ${key} in (item as any)) ? feel.prop(item, ${key}) : (typeof ${ident} !== 'undefined' ? ${ident} : ${builtinFallback}))`;
  }
  // A name that's in scope wins over a same-named builtin — `product`,
  // `count`, `number` are common parameter names that also name builtins.
  if (ctx?.inScopeNames?.has(name)) return toJsIdent(name);
  if (FEEL_BUILTINS[name]) return `feel.${FEEL_BUILTINS[name]}`;
  return toJsIdent(name);
}

// Some FEEL builtins have alternative parameter names across DMN versions
// (DMN 1.5 added `match` as a synonym for `position` in `list replace`, etc.).
// Map alternative names to the canonical name in FEEL_BUILTIN_PARAMS.
const FEEL_PARAM_ALIASES: Record<string, Record<string, string>> = {
  'list replace': { match: 'position' },
  'context put': { keys: 'key' },
};

function lookupSignature(
  fn: FeelNode,
  ctx: CompileContext,
): string[] | undefined {
  if (fn.type !== 'ident') return undefined;
  return ctx.signatures[fn.name] ?? FEEL_BUILTIN_PARAMS[fn.name];
}

function resolveParamAlias(fnName: string, paramName: string): string {
  return FEEL_PARAM_ALIASES[fnName]?.[paramName] ?? paramName;
}

export function emitFeelNode(
  node: FeelNode,
  ctx: CompileContext = DEFAULT_CTX,
): string {
  switch (node.type) {
    case 'num':
      return JSON.stringify(node.value);
    case 'str':
      return JSON.stringify(node.value);
    case 'bool':
      return node.value ? 'true' : 'false';
    case 'null':
      return 'null';
    case 'ident':
      return emitIdent(node.name, ctx);
    case 'paren':
      return `(${emitFeelNode(node.expr, ctx)})`;
    case 'unary':
      if (node.op === 'not') return `feel.not(${emitFeelNode(node.arg, ctx)})`;
      return `feel.neg(${emitFeelNode(node.arg, ctx)})`;
    case 'binop': {
      const fn = BINOP_TO_RUNTIME[node.op];
      if (!fn) throw new Error(`feel emit: unknown binop ${node.op}`);
      return `feel.${fn}(${emitFeelNode(node.left, ctx)}, ${emitFeelNode(node.right, ctx)})`;
    }
    case 'call': {
      const positional = node.args.map((a) => emitFeelNode(a, ctx));
      if (node.namedArgs && node.namedArgs.length) {
        const sig = lookupSignature(node.fn, ctx);
        const fnName = node.fn.type === 'ident' ? node.fn.name : '';
        if (sig) {
          // FEEL: any named arg not in the signature is an error → null.
          for (const na of node.namedArgs) {
            if (!sig.includes(resolveParamAlias(fnName, na.name))) return 'null';
          }
          for (const na of node.namedArgs) {
            const canonical = resolveParamAlias(fnName, na.name);
            const idx = sig.indexOf(canonical);
            const v = emitFeelNode(na.value, ctx);
            while (positional.length <= idx) positional.push('undefined');
            positional[idx] = v;
          }
        } else {
          // No statically-known signature — emit a runtime call helper that
          // checks the function value for an attached `__params` array
          // (FEEL lambda) and maps named args by position.
          const props = node.namedArgs
            .map(
              (na) => `${JSON.stringify(na.name)}: ${emitFeelNode(na.value, ctx)}`,
            )
            .join(', ');
          return `feel.call_named(${emitFeelNode(node.fn, ctx)}, { ${props} })`;
        }
      }
      // Calls to unknown / non-function values resolve to null, not a
      // runtime error. Builtins are safe and not wrapped (the cost of a
      // try/catch on every numeric op would be wasted). For idents, we
      // use a `typeof`-probe so a missing name doesn't ReferenceError.
      if (node.fn.type === 'ident' && !FEEL_BUILTINS[node.fn.name]) {
        const ident = toJsIdent(node.fn.name);
        return `feel.try_call(() => (typeof ${ident} !== 'undefined' ? ${ident} : null), [${positional.join(', ')}])`;
      }
      if (node.fn.type !== 'ident') {
        return `feel.try_call(() => ${emitFeelNode(node.fn, ctx)}, [${positional.join(', ')}])`;
      }
      return `${emitFeelNode(node.fn, ctx)}(${positional.join(', ')})`;
    }
    case 'member':
      return `feel.prop(${emitFeelNode(node.obj, ctx)}, ${JSON.stringify(node.name)})`;
    case 'if': {
      // FEEL `if` semantics: `true` → then, `false` or `null` → else,
      // any other non-boolean value (string, number, list, …) → null.
      // The null-→-else carve-out matches every TCK 0032 fixture; the
      // non-boolean → null rule is what 1150 boxed-conditional asserts.
      const cond = emitFeelNode(node.cond, ctx);
      const thenE = emitFeelNode(node.thenE, ctx);
      const elseE = emitFeelNode(node.elseE, ctx);
      return `(() => { const __c: any = (${cond}); return __c === true ? (${thenE}) : (__c === false || __c === null) ? (${elseE}) : null; })()`;
    }
    case 'list':
      return `[${node.items.map((i) => emitFeelNode(i, ctx)).join(', ')}]`;
    case 'context': {
      // DMN14-178 (DMN 1.3+): duplicate context-entry keys are an error.
      // Earlier versions silently let later entries overwrite earlier ones.
      const seen = new Set<string>();
      let hasDup = false;
      for (const e of node.entries) {
        if (seen.has(e.key)) {
          hasDup = true;
          break;
        }
        seen.add(e.key);
      }
      const isDmn13Plus =
        ctx?.dmnVersion === '1.3' ||
        ctx?.dmnVersion === '1.4' ||
        ctx?.dmnVersion === '1.5';
      if (hasDup && isDmn13Plus) return 'null';
      // Each entry's value can reference earlier entries by name. Emit a
      // function-scoped block where the key becomes a `let` for backward
      // references AND we collect the values into the returned object.
      const lines: string[] = [];
      const props: string[] = [];
      const declared = new Set<string>();
      for (let i = 0; i < node.entries.length; i++) {
        const e = node.entries[i];
        const tmp = `__ce_${i}`;
        lines.push(`const ${tmp}: any = ${emitFeelNode(e.value, ctx)};`);
        const baseIdent = toJsIdent(e.key);
        const isValidIdent = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(baseIdent);
        if (isValidIdent) {
          if (declared.has(baseIdent)) {
            lines.push(`${baseIdent} = ${tmp};`);
          } else {
            lines.push(`let ${baseIdent}: any = ${tmp};`);
            declared.add(baseIdent);
          }
        }
        props.push(`${JSON.stringify(e.key)}: ${tmp}`);
      }
      return `(() => { ${lines.join(' ')} return { ${props.join(', ')} }; })()`;
    }
    case 'index': {
      const filterCtx: CompileContext = { ...ctx, inFilterScope: true };
      return `feel.indexOrFilter(${emitFeelNode(node.list, ctx)}, (item: any) => ${emitFeelNode(node.index, filterCtx)})`;
    }
    case 'for': {
      // FEEL's `for` exposes a magic name `partial` to the iteration body —
      // the list of results computed so far. When the body references it,
      // emit a manual loop that maintains that accumulator.
      if (node.bindings.length === 1 && referencesName(node.body, 'partial')) {
        const b = node.bindings[0];
        const inner = emitFeelNode(node.body, ctx);
        return `(() => { const __it: any = feel.iterateOrNull(${emitFeelNode(b.range, ctx)}); if (__it === null) return null; const partial: any[] = []; for (const ${toJsIdent(b.name)} of __it) { partial.push(${inner}); } return partial; })()`;
      }
      // Each binding range is iterated; non-iterable input → null result.
      let inner = emitFeelNode(node.body, ctx);
      for (let i = node.bindings.length - 1; i >= 0; i--) {
        const b = node.bindings[i];
        const isLast = i === node.bindings.length - 1;
        const method = isLast ? 'map' : 'flatMap';
        inner = `(() => { const __it: any = feel.iterateOrNull(${emitFeelNode(b.range, ctx)}); return __it === null ? null : __it.${method}((${toJsIdent(b.name)}: any) => ${inner}); })()`;
      }
      return inner;
    }
    case 'quant': {
      // FEEL `some`/`every`: a non-boolean satisfies result poisons the
      // whole expression to null. Iterate manually so we can short-circuit
      // and detect that case (vs. JS's `Array.prototype.some` coercion).
      const b = node.bindings[0];
      const isEvery = node.kind === 'every';
      const seed = isEvery ? 'true' : 'false';
      const winValue = isEvery ? 'false' : 'true';
      return `(() => {
        const __it: any = feel.iterateOrNull(${emitFeelNode(b.range, ctx)});
        if (__it === null) return null;
        let __r: any = ${seed};
        for (const ${toJsIdent(b.name)} of __it) {
          const __v: any = ${emitFeelNode(node.body, ctx)};
          if (typeof __v !== 'boolean') return null;
          if (__v === ${winValue}) __r = ${winValue};
        }
        return __r;
      })()`;
    }
    case 'between':
      return `feel.and(feel.le(${emitFeelNode(node.lo, ctx)}, ${emitFeelNode(node.value, ctx)}), feel.le(${emitFeelNode(node.value, ctx)}, ${emitFeelNode(node.hi, ctx)}))`;
    case 'in':
      return `feel.list_contains(${emitFeelNode(node.list, ctx)}, ${emitFeelNode(node.value, ctx)})`;
    case 'instanceof':
      return `feel.instance_of(${emitFeelNode(node.value, ctx)}, ${JSON.stringify(node.typeName)}, typeof __itemDefs !== 'undefined' ? __itemDefs : undefined)`;
    case 'unaryTests': {
      const fns = node.tests.map((t) => {
        if (t.kind === 'cmp') {
          const opMap: Record<string, string> = {
            '<': 'lt',
            '<=': 'le',
            '>': 'gt',
            '>=': 'ge',
            '=': 'eq',
            '!=': 'neq',
          };
          const fn = opMap[t.op];
          return `(__item: any) => feel.${fn}(__item, ${emitFeelNode(t.rhs, ctx)}) === true`;
        }
        return `(__item: any) => feel.eq(__item, ${emitFeelNode(t.expr, ctx)}) === true`;
      });
      return `{ __feel: 'tests', tests: [${fns.join(', ')}] }`;
    }
    case 'temporal': {
      const v = node.value;
      const lit = JSON.stringify(v);
      if (/^-?P/.test(v)) return `feel.duration(${lit})`;
      if (/^-?\d+-\d{2}-\d{2}T/.test(v)) return `feel.date_and_time(${lit})`;
      if (/^-?\d+-\d{2}-\d{2}$/.test(v)) return `feel.date(${lit})`;
      if (/^\d{2}:\d{2}/.test(v)) return `feel.time(${lit})`;
      return 'null';
    }
    case 'lambda': {
      const params = node.params.map((p) => `${toJsIdent(p)}: any`).join(', ');
      const paramsLit = JSON.stringify(node.params);
      // Validate any typed parameters at the boundary — a non-conforming
      // argument coerces to null per FEEL.
      const validations: string[] = [];
      if (node.paramTypes) {
        for (let i = 0; i < node.params.length; i++) {
          const tr = node.paramTypes[i];
          if (!tr) continue;
          const pIdent = toJsIdent(node.params[i]);
          validations.push(
            `if (${pIdent} !== null && ${pIdent} !== undefined && (typeof __itemDefs !== 'undefined' ? feel.validate(${pIdent}, ${JSON.stringify(tr)}, __itemDefs) : feel.coerce(${pIdent}, ${JSON.stringify(tr)})) === null) return null;`,
          );
        }
      }
      const bodyExpr = emitFeelNode(node.body, ctx);
      const fnBody = validations.length
        ? `{ ${validations.join(' ')} return ${bodyExpr}; }`
        : bodyExpr;
      const arrow = validations.length
        ? `((${params}): any => ${fnBody})`
        : `((${params}): any => ${fnBody})`;
      return `Object.assign(${arrow}, { __params: ${paramsLit} as readonly string[] })`;
    }
    case 'range': {
      return `feel.range(${emitFeelNode(node.lo, ctx)}, ${emitFeelNode(node.hi, ctx)}, ${node.openLow}, ${node.openHigh})`;
    }
  }
}

export function compileFeel(
  text: string,
  knownNames: string[],
  ctx: CompileContext = DEFAULT_CTX,
): string {
  const tokens = tokenize(text, knownNames);
  const parser = new Parser(tokens);
  const ast = parser.parse();
  // Thread the in-scope names into emit context so identifier emission
  // prefers a JS local over a same-named FEEL builtin (e.g. `product`,
  // `number`, `count` are common parameter names that also name builtins).
  const inScopeNames = new Set(knownNames);
  return emitFeelNode(ast, { ...ctx, inScopeNames });
}

// Reads src/runtime.ts (the source-of-truth) at runtime so the tool can copy
// it into generated packages alongside the emitted index.ts. Cached.
let _runtimeSourceCache: string | null = null;
export function getRuntimeSource(): string {
  if (_runtimeSourceCache !== null) return _runtimeSourceCache;
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '..', 'src', 'runtime.ts'),
    resolve(here, 'runtime.ts'),
  ];
  for (const p of candidates) {
    try {
      _runtimeSourceCache = readFileSync(p, 'utf8');
      return _runtimeSourceCache;
    } catch {
      /* try next */
    }
  }
  throw new Error('feel: could not locate runtime.ts source');
}

