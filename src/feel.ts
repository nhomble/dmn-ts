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
    };

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'str'; value: string }
  | { kind: 'ident'; name: string }
  | { kind: 'kw'; name: string }
  | { kind: 'op'; op: string }
  | { kind: 'punct'; ch: string };

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
  floor: ['n'],
  ceiling: ['n'],
  abs: ['n'],
  modulo: ['dividend', 'divisor'],
  sqrt: ['n'],
  log: ['n'],
  exp: ['n'],
  odd: ['n'],
  even: ['n'],
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

    // Number
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(input[i + 1] ?? ''))) {
      const m = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(input.slice(i));
      if (m) {
        tokens.push({ kind: 'num', value: Number(m[0]) });
        i += m[0].length;
        continue;
      }
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
        const t = this.next();
        if (t.kind !== 'ident') {
          throw new Error('feel parse: expected member name');
        }
        expr = { type: 'member', obj: expr, name: t.name };
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
    }
    if (t.kind === 'ident') {
      this.next();
      return { type: 'ident', name: t.name };
    }
    if (t.kind === 'punct' && t.ch === '(') {
      this.next();
      const inner = this.parseExpression();
      if (!this.isPunct(')')) throw new Error('feel parse: expected )');
      this.next();
      return { type: 'paren', expr: inner };
    }
    if (t.kind === 'punct' && t.ch === '[') {
      this.next();
      const items: FeelNode[] = [];
      if (!this.isPunct(']')) {
        items.push(this.parseExpression());
        while (this.isPunct(',')) {
          this.next();
          items.push(this.parseExpression());
        }
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
      return `${emitFeelNode(node.obj, ctx)}?.[${JSON.stringify(node.name)}]`;
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
        inner = `((${emitFeelNode(b.range, ctx)}) as any[]).${isLast ? 'map' : 'flatMap'}((${toJsIdent(b.name)}: any) => ${inner})`;
      }
      return inner;
    }
    case 'quant': {
      const b = node.bindings[0];
      const method = node.kind === 'every' ? 'every' : 'some';
      return `((${emitFeelNode(b.range, ctx)}) as any[]).${method}((${toJsIdent(b.name)}: any) => ${emitFeelNode(node.body, ctx)} === true)`;
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
    if (typeof a === 'object' && typeof b === 'object') {
      const ak = Object.keys(a);
      const bk = Object.keys(b);
      if (ak.length !== bk.length) return false;
      for (const k of ak) if (!feel.eq(a[k], b[k])) return false;
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
  index(list: any, idx: any): any {
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
    if (!Array.isArray(list)) return null;
    for (const x of list) if (x !== true) return x === false ? false : null;
    return true;
  },
  any(list: any): any {
    if (!Array.isArray(list)) return null;
    let sawNull = false;
    for (const x of list) {
      if (x === true) return true;
      if (x !== false) sawNull = true;
    }
    return sawNull ? null : false;
  },
  sublist(list: any, start: any, length?: any): any {
    if (!Array.isArray(list)) return null;
    let s = Number(start);
    if (s < 0) s = list.length + s + 1;
    s = s - 1;
    if (length == null || length?.__named) return list.slice(Math.max(0, s));
    return list.slice(Math.max(0, s), Math.max(0, s) + Number(length));
  },
  append(list: any, ...items: any[]): any {
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
    if (!Array.isArray(list)) return null;
    for (const x of list) if (feel.eq(x, item) === true) return true;
    return false;
  },
  distinct_values(list: any): any {
    if (!Array.isArray(list)) return null;
    const out: any[] = [];
    for (const x of list) {
      if (!out.some((y) => feel.eq(x, y) === true)) out.push(x);
    }
    return out;
  },
  flatten(list: any): any {
    if (!Array.isArray(list)) return null;
    const out: any[] = [];
    const rec = (xs: any[]) => {
      for (const x of xs) Array.isArray(x) ? rec(x) : out.push(x);
    };
    rec(list);
    return out;
  },
  product(list: any): any {
    if (!Array.isArray(list)) return null;
    let p = 1;
    for (const x of list) {
      if (x == null) return null;
      p *= Number(x);
    }
    return p;
  },
  insert_before(list: any, position: any, newItem: any): any {
    if (!Array.isArray(list)) return null;
    const i = Number(position);
    if (!Number.isFinite(i) || i < 1 || i > list.length + 1) return null;
    return [...list.slice(0, i - 1), newItem, ...list.slice(i - 1)];
  },
  index_of(list: any, match: any): any {
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
    if (!Array.isArray(list)) return null;
    const i = Number(position);
    if (!Number.isFinite(i) || i < 1 || i > list.length) return null;
    return [...list.slice(0, i - 1), ...list.slice(i)];
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
    if (!Array.isArray(list)) return null;
    const s = sep == null || sep?.__named ? '' : String(sep);
    return list.map((x) => (x == null ? '' : String(x))).join(s);
  },
  floor(n: any): any {
    return n == null ? null : Math.floor(Number(n));
  },
  ceiling(n: any): any {
    return n == null ? null : Math.ceil(Number(n));
  },
  abs(n: any): any {
    return n == null ? null : Math.abs(Number(n));
  },
  modulo(a: any, b: any): any {
    if (a == null || b == null || Number(b) === 0) return null;
    return Number(a) % Number(b);
  },
  sqrt(n: any): any {
    if (n == null) return null;
    const r = Math.sqrt(Number(n));
    return Number.isFinite(r) ? r : null;
  },
  log(n: any): any {
    if (n == null) return null;
    const r = Math.log(Number(n));
    return Number.isFinite(r) ? r : null;
  },
  exp(n: any): any {
    if (n == null) return null;
    const r = Math.exp(Number(n));
    return Number.isFinite(r) ? r : null;
  },
  odd(n: any): any {
    return n == null ? null : Math.abs(Number(n)) % 2 === 1;
  },
  even(n: any): any {
    return n == null ? null : Math.abs(Number(n)) % 2 === 0;
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
  date(...args: any[]): any {
    const fmt = (y: number, m: number, d: number): string | null => {
      if (![y, m, d].every(Number.isFinite)) return null;
      // FEEL allows negative years (BCE); reject year 0 and invalid month/day.
      if (y === 0 || m < 1 || m > 12 || d < 1 || d > 31) return null;
      const dt = new Date(Date.UTC(Math.abs(y), m - 1, d));
      if (
        Math.abs(y) > 0 && dt.getUTCFullYear() !== Math.abs(y)
      ) return null;
      if (dt.getUTCMonth() + 1 !== m || dt.getUTCDate() !== d) return null;
      const sign = y < 0 ? '-' : '';
      return \`\${sign}\${String(Math.abs(y)).padStart(4, '0')}-\${String(m).padStart(2, '0')}-\${String(d).padStart(2, '0')}\`;
    };
    if (args.length === 1) {
      const a = args[0];
      if (typeof a !== 'string') return null;
      // Allow leading "-" for BCE.
      const dtMatch = /^(-?\\d{4}-\\d{2}-\\d{2})/.exec(a);
      const iso = dtMatch ? dtMatch[1] : a;
      if (!/^-?\\d{4}-\\d{2}-\\d{2}$/.test(iso)) return null;
      const neg = iso.startsWith('-');
      const body = neg ? iso.slice(1) : iso;
      const [y, m, d] = body.split('-').map(Number);
      return fmt(neg ? -y : y, m, d);
    }
    if (args.length === 3) {
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
      return head + (frac ?? '') + (tz ?? '');
    };
    if (args.length === 1) {
      const a = args[0];
      if (typeof a !== 'string') return null;
      const m = /^(\\d{2}):(\\d{2}):(\\d{2})(\\.\\d+)?(Z|[+-]\\d{2}:\\d{2})?$/.exec(a);
      if (!m) return null;
      return fmtTime(Number(m[1]), Number(m[2]), Number(m[3]), m[4], m[5]);
    }
    if (args.length >= 3) {
      const [h, m, s] = args.map(Number);
      return fmtTime(h, m, s);
    }
    return null;
  },
  date_and_time(...args: any[]): any {
    if (args.length === 1) {
      const a = args[0];
      if (typeof a !== 'string') return null;
      const m = /^(-?\\d{4}-\\d{2}-\\d{2})T(\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})?)$/.exec(a);
      if (!m) return null;
      const d = feel.date(m[1]);
      const t = feel.time(m[2]);
      return d && t ? \`\${d}T\${t}\` : null;
    }
    if (args.length === 2) {
      const d = feel.date(args[0]);
      const t = feel.time(args[1]);
      return d && t ? \`\${d}T\${t}\` : null;
    }
    return null;
  },
  duration(s: any): any {
    if (typeof s !== 'string') return null;
    return /^-?P/.test(s) ? s : null;
  },
  years_and_months_duration(from: any, to: any): any {
    if (typeof from !== 'string' || typeof to !== 'string') return null;
    const [y1, m1] = from.split('-').map(Number);
    const [y2, m2] = to.split('-').map(Number);
    let months = (y2 - y1) * 12 + (m2 - m1);
    const sign = months < 0 ? '-' : '';
    months = Math.abs(months);
    return \`\${sign}P\${Math.floor(months / 12)}Y\${months % 12}M\`;
  },
};
`;
