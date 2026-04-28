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
  | { type: 'call'; fn: FeelNode; args: FeelNode[] }
  | { type: 'member'; obj: FeelNode; name: string };

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'str'; value: string }
  | { kind: 'ident'; name: string }
  | { kind: 'kw'; name: string }
  | { kind: 'op'; op: string }
  | { kind: 'punct'; ch: string };

const KEYWORDS = new Set(['and', 'or', 'not', 'true', 'false', 'null']);
const MULTI_OPS = ['<=', '>=', '!=', '**'];
const SINGLE_OPS = ['<', '>', '=', '+', '-', '*', '/'];
const PUNCT = new Set(['(', ')', '[', ']', '{', '}', ',', '.']);

function isWordChar(c: string): boolean {
  return /[A-Za-z0-9_]/.test(c);
}

function tokenize(input: string, knownNames: string[]): Token[] {
  const sortedNames = [...knownNames].sort((a, b) => b.length - a.length);
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
    const expr = this.parseOr();
    if (this.pos < this.tokens.length) {
      throw new Error(`feel parse: trailing tokens at ${this.pos}`);
    }
    return expr;
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
    while (this.isPunct('.') || this.isPunct('(')) {
      if (this.isPunct('.')) {
        this.next();
        const t = this.next();
        if (t.kind !== 'ident') {
          throw new Error('feel parse: expected member name');
        }
        expr = { type: 'member', obj: expr, name: t.name };
      } else {
        this.next();
        const args: FeelNode[] = [];
        if (!this.isPunct(')')) {
          args.push(this.parseOr());
          while (this.isPunct(',')) {
            this.next();
            args.push(this.parseOr());
          }
        }
        if (!this.isPunct(')')) throw new Error('feel parse: expected )');
        this.next();
        expr = { type: 'call', fn: expr, args };
      }
    }
    return expr;
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
      const inner = this.parseOr();
      if (!this.isPunct(')')) throw new Error('feel parse: expected )');
      this.next();
      return { type: 'paren', expr: inner };
    }
    throw new Error(
      `feel parse: unexpected token ${JSON.stringify(t)} at ${this.pos}`,
    );
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

export function emitFeelNode(node: FeelNode): string {
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
      return toJsIdent(node.name);
    case 'paren':
      return `(${emitFeelNode(node.expr)})`;
    case 'unary':
      if (node.op === 'not') return `feel.not(${emitFeelNode(node.arg)})`;
      return `feel.neg(${emitFeelNode(node.arg)})`;
    case 'binop': {
      const fn = BINOP_TO_RUNTIME[node.op];
      if (!fn) throw new Error(`feel emit: unknown binop ${node.op}`);
      return `feel.${fn}(${emitFeelNode(node.left)}, ${emitFeelNode(node.right)})`;
    }
    case 'call': {
      const args = node.args.map(emitFeelNode).join(', ');
      return `${emitFeelNode(node.fn)}(${args})`;
    }
    case 'member':
      return `${emitFeelNode(node.obj)}?.[${JSON.stringify(node.name)}]`;
  }
}

export function compileFeel(text: string, knownNames: string[]): string {
  const tokens = tokenize(text, knownNames);
  const parser = new Parser(tokens);
  const ast = parser.parse();
  return emitFeelNode(ast);
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
};
`;
