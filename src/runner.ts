import { XMLParser } from 'fast-xml-parser';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) =>
    ['testCase', 'inputNode', 'resultNode', 'component', 'item'].includes(name),
});

function arr<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function smartCoerce(raw: string): unknown {
  // No xsi:type — guess a sensible primitive. TCK XMLs often omit xsi.
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === '' || raw === 'null') return raw === '' ? '' : null;
  // A signed decimal that round-trips through Number is treated as number.
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(raw)) {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return raw;
}

function castByXsi(raw: string, xsi: string | undefined): unknown {
  if (xsi === undefined) return smartCoerce(raw);
  // The XML Schema namespace can be bound to either `xsd:` or `xs:` (or another
  // prefix). Strip whatever prefix is in use and match on the local name.
  const local = xsi.includes(':') ? (xsi.split(':').pop() as string) : xsi;
  if (local === 'decimal' || local === 'integer' || local === 'double' || local === 'long' || local === 'float') {
    return Number(raw);
  }
  if (local === 'boolean') return raw === 'true';
  return raw;
}

function parseValueNode(node: unknown): unknown {
  if (node === undefined || node === null) return null;
  if (typeof node === 'string') return smartCoerce(node);
  if (typeof node === 'number' || typeof node === 'boolean') return node;
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    if (obj['@_xsi:nil'] === 'true') return null;
    const xsi = obj['@_xsi:type'] as string | undefined;
    const text = (obj['#text'] as string | undefined) ?? '';
    return castByXsi(text, xsi);
  }
  return null;
}

function parseTestNodeBody(node: any): unknown {
  if (node === undefined || node === null) return null;
  if (typeof node === 'object' && node.list !== undefined) {
    const items = arr<any>(node.list?.item);
    return items.map((it) => parseTestNodeBody(it));
  }
  if (typeof node === 'object' && node.component) {
    const out: Record<string, unknown> = {};
    for (const c of arr<any>(node.component)) {
      out[c['@_name']] = parseTestNodeBody(c);
    }
    return out;
  }
  if (typeof node === 'object' && node.value !== undefined) {
    return parseValueNode(node.value);
  }
  return parseValueNode(node);
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') {
    if (a === b) return true;
    const diff = Math.abs(a - b);
    if (diff < 1e-9) return true;
    const scale = Math.max(Math.abs(a), Math.abs(b));
    return scale > 0 && diff / scale < 1e-9;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ak = Object.keys(a as object);
    const bk = Object.keys(b as object);
    if (ak.length !== bk.length) return false;
    for (const k of ak) {
      if (!deepEqual((a as any)[k], (b as any)[k])) return false;
    }
    return true;
  }
  return false;
}

export interface TestResult {
  testFile: string;
  testCaseId: string;
  resultName: string;
  status: 'pass' | 'fail';
  reason?: string;
}

export interface CaseRunSummary {
  results: TestResult[];
  passed: number;
  failed: number;
}

type Decisions = Record<string, (ctx: Record<string, unknown>) => unknown>;

export interface CaseModule {
  decisions?: Decisions;
}

export function listTestFiles(caseDir: string): string[] {
  return readdirSync(caseDir).filter(
    (f) => f.endsWith('.xml') && f.includes('-test-'),
  );
}

export function runTestCases(
  caseDir: string,
  mod: CaseModule | null,
  loadError: string | null,
): CaseRunSummary {
  const summary: CaseRunSummary = { results: [], passed: 0, failed: 0 };
  const testFiles = listTestFiles(caseDir);

  for (const tf of testFiles) {
    const xml = readFileSync(join(caseDir, tf), 'utf8');
    const parsed: any = xmlParser.parse(xml);
    const cases = arr<any>(parsed.testCases?.testCase);
    for (const tc of cases) {
      const id = tc['@_id'] ?? '?';
      const ctx: Record<string, unknown> = {};
      for (const inNode of arr<any>(tc.inputNode)) {
        ctx[inNode['@_name']] = parseTestNodeBody(inNode);
      }
      for (const rn of arr<any>(tc.resultNode)) {
        const name = rn['@_name'];
        const expected = parseTestNodeBody(rn.expected);
        const record = (status: 'pass' | 'fail', reason?: string) => {
          summary.results.push({
            testFile: tf,
            testCaseId: id,
            resultName: name,
            status,
            reason,
          });
          if (status === 'pass') summary.passed++;
          else summary.failed++;
        };
        if (loadError) {
          record('fail', `module load: ${loadError}`);
          continue;
        }
        const decisions = mod?.decisions;
        if (!decisions) {
          record('fail', 'module exports no decisions');
          continue;
        }
        const fn = decisions[name];
        if (!fn) {
          record('fail', `no decision named ${JSON.stringify(name)}`);
          continue;
        }
        try {
          const actual = fn(ctx);
          if (deepEqual(actual, expected)) record('pass');
          else
            record(
              'fail',
              `expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`,
            );
        } catch (e: any) {
          record('fail', `threw ${e?.message ?? String(e)}`);
        }
      }
    }
  }
  return summary;
}
