// Small FEEL expression parser + emitter. Covers the subset needed for cl2/1.1:
// or / and / comparison / +-*/** / unary -, not(...) / member access / function call /
// number, string, boolean, null literals / multi-word identifiers (longest-match
// against `knownNames`).

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
  floor: ['number'],
  ceiling: ['number'],
  abs: ['number'],
  modulo: ['dividend', 'divisor'],
  sqrt: ['number'],
  log: ['number'],
  exp: ['number'],
  odd: ['number'],
  even: ['number'],
  decimal: ['n', 'scale'],
  number: ['from'],
  string: ['from'],
  date: ['from'],
  time: ['from'],
  'date and time': ['from'],
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
      // FEEL `in` may be followed by a positive unary test:
      // `x in <= 10` ↔ `x <= 10`, similarly for <, >, >=, =. Otherwise it's
      // list/range membership.
      const t = this.peek();
      if (t?.kind === 'op' && ['<=', '>=', '<', '>', '='].includes(t.op)) {
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
      // Type name may be multi-word (e.g. `date and time`).
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
    while (this.isPunct('.') || this.isPunct('(') || this.isPunct('[')) {
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

  // Parse a single call argument: either `name: expr` (named) or `expr` (positional).
  private parseCallArg(
    positional: FeelNode[],
    named: { name: string; value: FeelNode }[],
  ): void {
    const t = this.peek();
    const colon = this.peek(1);
    if (t?.kind === 'ident' && colon?.kind === 'punct' && colon.ch === ':') {
      const nameTok = this.next() as { kind: 'ident'; name: string };
      this.next(); // consume ':'
      named.push({ name: nameTok.name, value: this.parseExpression() });
    } else {
      positional.push(this.parseExpression());
    }
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
    if (t.kind === 'punct' && t.ch === '(') {
      this.next();
      // Positive unary test as expression: `(> X)`, `(<= X)`, etc.
      const lookOp = this.peek();
      if (
        lookOp?.kind === 'op' &&
        ['<=', '>=', '<', '>', '='].includes(lookOp.op)
      ) {
        const op = (this.next() as { kind: 'op'; op: string }).op;
        const operand = this.parseExpression();
        if (!this.isPunct(')')) throw new Error('feel parse: expected )');
        this.next();
        const nullNode: FeelNode = { type: 'null' };
        if (op === '>')
          return { type: 'range', lo: operand, hi: nullNode, openLow: true, openHigh: true };
        if (op === '>=')
          return { type: 'range', lo: operand, hi: nullNode, openLow: false, openHigh: true };
        if (op === '<')
          return { type: 'range', lo: nullNode, hi: operand, openLow: true, openHigh: true };
        if (op === '<=')
          return { type: 'range', lo: nullNode, hi: operand, openLow: true, openHigh: false };
        // = X → singleton range
        return { type: 'range', lo: operand, hi: operand, openLow: false, openHigh: false };
      }
      const inner = this.parseExpression();
      // Bracketed range: `(2..4)` or `(2..4]`. Outer `(` means openLow=true.
      if (
        inner.type === 'range' &&
        (this.isPunct(')') || this.isPunct(']'))
      ) {
        const closer = (this.peek() as { kind: 'punct'; ch: string }).ch;
        this.next();
        return {
          type: 'range',
          lo: inner.lo,
          hi: inner.hi,
          openLow: true,
          openHigh: closer === ')',
        };
      }
      if (!this.isPunct(')')) throw new Error('feel parse: expected )');
      this.next();
      return { type: 'paren', expr: inner };
    }
    if (t.kind === 'punct' && t.ch === '[') {
      this.next();
      if (this.isPunct(']')) {
        this.next();
        return { type: 'list', items: [] };
      }
      const first = this.parseExpression();
      // Bracketed range: `[2..4]` or `[2..4)`. Outer `[` means openLow=false.
      if (
        first.type === 'range' &&
        (this.isPunct(')') || this.isPunct(']'))
      ) {
        const closer = (this.peek() as { kind: 'punct'; ch: string }).ch;
        this.next();
        return {
          type: 'range',
          lo: first.lo,
          hi: first.hi,
          openLow: false,
          openHigh: closer === ')',
        };
      }
      const items: FeelNode[] = [first];
      while (this.isPunct(',')) {
        this.next();
        items.push(this.parseExpression());
      }
      if (!this.isPunct(']')) throw new Error('feel parse: expected ]');
      this.next();
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
          for (const na of node.namedArgs) {
            const idx = sig.indexOf(na.name);
            const v = emitFeelNode(na.value, ctx);
            if (idx < 0) positional.push(v);
            else {
              while (positional.length <= idx) positional.push('undefined');
              positional[idx] = v;
            }
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

// Inlined into every generated module so output stays self-contained.
export const FEEL_RUNTIME_SOURCE = `const feel: any = {
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
    if (a === false || b === false) return false;
    if (a == null || b == null) return null;
    return Boolean(a) && Boolean(b);
  },
  or(a: any, b: any): any {
    if (a === true || b === true) return true;
    if (a == null || b == null) return null;
    return Boolean(a) || Boolean(b);
  },
  add(a: any, b: any): any {
    if (a == null || b == null) return null;
    if (typeof a === 'string' || typeof b === 'string') return String(a) + String(b);
    return Number(a) + Number(b);
  },
  sub(a: any, b: any): any {
    if (a == null || b == null) return null;
    return Number(a) - Number(b);
  },
  mul(a: any, b: any): any {
    if (a == null || b == null) return null;
    return Number(a) * Number(b);
  },
  div(a: any, b: any): any {
    if (a == null || b == null) return null;
    if (Number(b) === 0) return null;
    return Number(a) / Number(b);
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
  // Used for postfix \`list[expr]\` — the parser doesn't know whether expr is
  // a number (indexing) or a predicate (filtering), so we probe at runtime.
  // \`fn\` is a closure that takes an \`item\` parameter; if it doesn't reference
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
      if (items[i] == null) return null;
      if (Number(items[i]) < Number(best)) best = items[i];
    }
    return best;
  },
  max(...args: any[]): any {
    const items = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
    if (items.length === 0) return null;
    let best: any = items[0];
    for (let i = 1; i < items.length; i++) {
      if (items[i] == null) return null;
      if (Number(items[i]) > Number(best)) best = items[i];
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
  all(list: any): any {
    list = feel.asList(list) as any;
    if (!Array.isArray(list)) return null;
    for (const x of list) if (x !== true) return x === false ? false : null;
    return true;
  },
  any(list: any): any {
    list = feel.asList(list) as any;
    if (!Array.isArray(list)) return null;
    let sawNull = false;
    for (const x of list) {
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
    list = feel.asList(list) as any;
    if (!Array.isArray(list)) return null;
    for (const x of list) if (feel.eq(x, item) === true) return true;
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
    const m = /^(-?)(\\d+)-(\\d{2})-(\\d{2})/.exec(d);
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
    const m = /^(-?)(\\d+)-(\\d{2})-(\\d{2})/.exec(d);
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
    const m = /^-?\\d+-(\\d{2})-\\d{2}/.exec(d);
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
    const dtMatch = /^(-?)(\\d+)-(\\d{2})-(\\d{2})(?:T(\\d{2}):(\\d{2}):(\\d{2})(\\.\\d+)?(.*))?$/.exec(s);
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
    const tMatch = /^(\\d{2}):(\\d{2}):(\\d{2})(\\.\\d+)?(.*)$/.exec(s);
    if (tMatch) {
      if (key === 'hour') return Number(tMatch[1]);
      if (key === 'minute') return Number(tMatch[2]);
      if (key === 'second') return Number(tMatch[3]);
      if (key === 'time offset' || key === 'timezone') return tMatch[5] || null;
      return null;
    }
    const durMatch = /^(-?)P(?:(\\d+)Y)?(?:(\\d+)M)?(?:(\\d+)D)?(?:T(?:(\\d+)H)?(?:(\\d+)M)?(?:(\\d+)(?:\\.\\d+)?S)?)?$/.exec(s);
    if (durMatch) {
      const sign = durMatch[1] === '-' ? -1 : 1;
      if (key === 'years') return sign * Number(durMatch[2] || 0);
      if (key === 'months') return sign * Number(durMatch[3] || 0);
      if (key === 'days') return sign * Number(durMatch[4] || 0);
      if (key === 'hours') return sign * Number(durMatch[5] || 0);
      if (key === 'minutes') return sign * Number(durMatch[6] || 0);
      if (key === 'seconds') return sign * Number(durMatch[7] || 0);
      return null;
    }
    return null;
  },
  week_of_year(d: any): any {
    if (typeof d !== 'string') return null;
    const m = /^(-?)(\\d+)-(\\d{2})-(\\d{2})/.exec(d);
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
    return typeof s === 'string' ? s.toUpperCase() : null;
  },
  lower_case(s: any): any {
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
        return typeof v === 'string' && /^-?\\d{4,9}-\\d{2}-\\d{2}$/.test(v);
      case 'time':
        return typeof v === 'string' && /^\\d{2}:\\d{2}:\\d{2}/.test(v) && !v.includes('T');
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
      default:
        return null;
    }
  },
  date(...args: any[]): any {
    const isLeap = (y: number) =>
      (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    const daysIn = (y: number, m: number) => {
      const t = [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      return t[m - 1];
    };
    const fmt = (y: number, m: number, d: number): string | null => {
      if (![y, m, d].every(Number.isFinite)) return null;
      if (y === 0 || m < 1 || m > 12 || d < 1) return null;
      if (d > daysIn(Math.abs(y), m)) return null;
      const sign = y < 0 ? '-' : '';
      const yStr = String(Math.abs(y));
      return \`\${sign}\${yStr.length < 4 ? yStr.padStart(4, '0') : yStr}-\${String(m).padStart(2, '0')}-\${String(d).padStart(2, '0')}\`;
    };
    if (args.length === 1) {
      const a = args[0];
      if (typeof a !== 'string') return null;
      let iso: string;
      if (/^-?\\d{4,9}-\\d{2}-\\d{2}$/.test(a)) {
        iso = a;
      } else {
        // Accept full date-and-time and extract the date prefix.
        const dt = /^(-?\\d{4,9}-\\d{2}-\\d{2})T\\d{2}:\\d{2}:\\d{2}/.exec(a);
        if (!dt) return null;
        iso = dt[1];
      }
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
  time(...args: any[]): any {
    const fmtTime = (h: number, m: number, s: number, frac?: string, tz?: string): string | null => {
      if (![h, m, s].every(Number.isFinite)) return null;
      if (h < 0 || h > 23 || m < 0 || m > 59 || s < 0 || s >= 60) return null;
      const head = \`\${String(h).padStart(2, '0')}:\${String(m).padStart(2, '0')}:\${String(s).padStart(2, '0')}\`;
      // Canonicalize +00:00 / -00:00 to Z; preserve other offsets and IANA zones.
      const tzNorm = tz === '+00:00' || tz === '-00:00' ? 'Z' : tz;
      return head + (frac ?? '') + (tzNorm ?? '');
    };
    if (args.length === 1) {
      const a = args[0];
      if (typeof a !== 'string') return null;
      // Accept a date-and-time string and extract the time portion.
      const dtTime = /T(\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2}|@[A-Za-z_+\\-/]+)?)$/.exec(a);
      const candidate = dtTime ? dtTime[1] : a;
      const m = /^(\\d{2}):(\\d{2}):(\\d{2})(\\.\\d+)?(Z|[+-]\\d{2}:\\d{2}|@[A-Za-z_+\\-/]+)?$/.exec(candidate);
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
  date_and_time(...args: any[]): any {
    if (args.length === 1) {
      const a = args[0];
      if (typeof a !== 'string') return null;
      // Accept a pure date string — append midnight.
      if (/^-?\\d{4,9}-\\d{2}-\\d{2}$/.test(a)) {
        const d = feel.date(a);
        return d ? \`\${d}T00:00:00\` : null;
      }
      const m = /^(-?\\d{4,9}-\\d{2}-\\d{2})T(\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2}|@[A-Za-z_+\\-/]+)?)$/.exec(a);
      if (!m) return null;
      const d = feel.date(m[1]);
      const t = feel.time(m[2]);
      return d && t ? \`\${d}T\${t}\` : null;
    }
    if (args.length === 2) {
      if (args.some((a) => a == null)) return null;
      const d = feel.date(args[0]);
      const t = feel.time(args[1]);
      return d && t ? \`\${d}T\${t}\` : null;
    }
    return null;
  },
  duration(s: any): any {
    if (typeof s !== 'string') return null;
    const m = /^(-)?P(?:(\\d+)Y)?(?:(\\d+)M)?(?:(\\d+)D)?(?:T(?:(\\d+)H)?(?:(\\d+)M)?(?:(\\d+)(?:\\.(\\d*))?S)?)?$/.exec(s);
    if (!m) return null;
    // Reject empty body (\`P\` alone)
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
    if (y) date += \`\${y}Y\`;
    if (mo) date += \`\${mo}M\`;
    if (d) date += \`\${d}D\`;
    let time = '';
    if (h) time += \`\${h}H\`;
    if (mi) time += \`\${mi}M\`;
    if (sec !== 0 || fracDigits) {
      time += \`\${sec}\${fracDigits ? '.' + fracDigits : ''}S\`;
    }
    if (!date && !time) time = '0S';
    return \`\${sign}P\${date}\${time ? 'T' + time : ''}\`;
  },
  years_and_months_duration(from: any, to: any): any {
    if (typeof from !== 'string' || typeof to !== 'string') return null;
    const parseFull = (s: string): { y: number; m: number; d: number } | null => {
      const m = /^(-?)(\\d+)-(\\d{2})-(\\d{2})/.exec(s);
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
    if (years) body += \`\${years}Y\`;
    if (remM) body += \`\${remM}M\`;
    if (!body) body = '0M';
    return \`\${sign}P\${body}\`;
  },
};
`;
