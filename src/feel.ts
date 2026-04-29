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
  | { type: 'lambda'; params: string[]; body: FeelNode }
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
  abs: ['number'],
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
};

// All parameter names referenced by FEEL_BUILTIN_PARAMS, flattened — these must
// be recognized by the tokenizer (multi-word names like "start position") so
// named-argument calls parse correctly.
const FEEL_PARAM_NAMES: string[] = Array.from(
  new Set(Object.values(FEEL_BUILTIN_PARAMS).flat()),
);

function isWordChar(c: string): boolean {
  return /[A-Za-z0-9_]/.test(c);
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
          else raw += esc;
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
    if (/[A-Za-z_]/.test(c)) {
      let matchedName: string | null = null;
      for (const name of sortedNames) {
        if (input.startsWith(name, i)) {
          const before = i === 0 ? ' ' : input[i - 1];
          const after =
            i + name.length >= input.length ? ' ' : input[i + name.length];
          if (!isWordChar(before) && !isWordChar(after)) {
            matchedName = name;
            break;
          }
        }
      }
      if (matchedName) {
        tokens.push({ kind: 'ident', name: matchedName });
        i += matchedName.length;
        continue;
      }
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(input.slice(i));
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

  private parseLambdaParam(): string {
    const t = this.next();
    if (t.kind !== 'ident')
      throw new Error('feel parse: expected parameter name');
    if (this.isPunct(':')) {
      this.next();
      // Skip type annotation (ident, possibly multi-word, possibly `.member` chain).
      while (this.peek()?.kind === 'ident' || this.peek()?.kind === 'kw') {
        this.next();
      }
      while (this.isPunct('.')) {
        this.next();
        if (this.peek()?.kind === 'ident' || this.peek()?.kind === 'kw') {
          this.next();
        }
      }
    }
    return t.name;
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
        const params: string[] = [];
        if (!this.isPunct(')')) {
          params.push(this.parseLambdaParam());
          while (this.isPunct(',')) {
            this.next();
            params.push(this.parseLambdaParam());
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
        return { type: 'lambda', params, body };
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
    const t = this.next();
    let key: string;
    if (t.kind === 'ident') key = t.name;
    else if (t.kind === 'str') key = t.value;
    else throw new Error('feel parse: expected context key');
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
  // FEEL function name → ordered parameter names (for named-arg → positional mapping)
  signatures: Record<string, string[]>;
}

const DEFAULT_CTX: CompileContext = { signatures: {} };

function emitIdent(name: string): string {
  if (FEEL_BUILTINS[name]) return `feel.${FEEL_BUILTINS[name]}`;
  return toJsIdent(name);
}

function lookupSignature(
  fn: FeelNode,
  ctx: CompileContext,
): string[] | undefined {
  if (fn.type !== 'ident') return undefined;
  return ctx.signatures[fn.name] ?? FEEL_BUILTIN_PARAMS[fn.name];
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
      return emitIdent(node.name);
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
        if (sig) {
          // FEEL: any named arg not in the signature is an error → null.
          for (const na of node.namedArgs) {
            if (!sig.includes(na.name)) return 'null';
          }
          for (const na of node.namedArgs) {
            const idx = sig.indexOf(na.name);
            const v = emitFeelNode(na.value, ctx);
            while (positional.length <= idx) positional.push('undefined');
            positional[idx] = v;
          }
        } else {
          const props = node.namedArgs
            .map(
              (na) => `${JSON.stringify(na.name)}: ${emitFeelNode(na.value, ctx)}`,
            )
            .join(', ');
          positional.push(`{ __named: { ${props} } }`);
        }
      }
      return `${emitFeelNode(node.fn, ctx)}(${positional.join(', ')})`;
    }
    case 'member':
      return `feel.prop(${emitFeelNode(node.obj, ctx)}, ${JSON.stringify(node.name)})`;
    case 'if':
      return `((${emitFeelNode(node.cond, ctx)}) ? (${emitFeelNode(node.thenE, ctx)}) : (${emitFeelNode(node.elseE, ctx)}))`;
    case 'list':
      return `[${node.items.map((i) => emitFeelNode(i, ctx)).join(', ')}]`;
    case 'context': {
      const props = node.entries
        .map((e) => `${JSON.stringify(e.key)}: ${emitFeelNode(e.value, ctx)}`)
        .join(', ');
      return `{ ${props} }`;
    }
    case 'index':
      return `feel.indexOrFilter(${emitFeelNode(node.list, ctx)}, (item: any) => ${emitFeelNode(node.index, ctx)})`;
    case 'for': {
      let inner = emitFeelNode(node.body, ctx);
      for (let i = node.bindings.length - 1; i >= 0; i--) {
        const b = node.bindings[i];
        const isLast = i === node.bindings.length - 1;
        inner = `feel.iterate(${emitFeelNode(b.range, ctx)}).${isLast ? 'map' : 'flatMap'}((${toJsIdent(b.name)}: any) => ${inner})`;
      }
      return inner;
    }
    case 'quant': {
      const b = node.bindings[0];
      const method = node.kind === 'every' ? 'every' : 'some';
      return `feel.iterate(${emitFeelNode(b.range, ctx)}).${method}((${toJsIdent(b.name)}: any) => ${emitFeelNode(node.body, ctx)} === true)`;
    }
    case 'between':
      return `feel.and(feel.le(${emitFeelNode(node.lo, ctx)}, ${emitFeelNode(node.value, ctx)}), feel.le(${emitFeelNode(node.value, ctx)}, ${emitFeelNode(node.hi, ctx)}))`;
    case 'in':
      return `feel.list_contains(${emitFeelNode(node.list, ctx)}, ${emitFeelNode(node.value, ctx)})`;
    case 'instanceof':
      return `feel.instance_of(${emitFeelNode(node.value, ctx)}, ${JSON.stringify(node.typeName)})`;
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
      return `((${params}): any => ${emitFeelNode(node.body, ctx)})`;
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
  return emitFeelNode(ast, ctx);
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

