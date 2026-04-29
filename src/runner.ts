import { XMLParser } from 'fast-xml-parser';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { castByXsi, normalizeIsoDuration, smartCoerce } from './tck-values.js';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: false,
  parseTagValue: false,
  // Test xml `<value>XYZ </value>` significantly preserves trailing/leading
  // whitespace; trimming would mask real string semantics.
  trimValues: false,
  isArray: (name) =>
    ['testCase', 'inputNode', 'resultNode', 'component', 'item'].includes(name),
});

function arr<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
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
    if (diff < 1e-8) return true;
    const scale = Math.max(Math.abs(a), Math.abs(b));
    return scale > 0 && diff / scale < 1e-8;
  }
  if (typeof a === 'string' && typeof b === 'string') {
    const an = normalizeIsoDuration(a);
    const bn = normalizeIsoDuration(b);
    if (an !== null && bn !== null) return an === bn;
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
type DecisionServices = Record<string, (...args: unknown[]) => unknown>;
type DecisionServiceParams = Record<string, readonly string[]>;

export interface CaseModule {
  decisions?: Decisions;
  decisionServices?: DecisionServices;
  decisionServiceParams?: DecisionServiceParams;
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
      const inputs: unknown[] = [];
      for (const inNode of arr<any>(tc.inputNode)) {
        const v = parseTestNodeBody(inNode);
        ctx[inNode['@_name']] = v;
        inputs.push(v);
      }
      const isService =
        tc['@_type'] === 'decisionService' && tc['@_invocableName'];
      const serviceName = isService ? (tc['@_invocableName'] as string) : null;
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
        try {
          let actual: unknown;
          if (serviceName) {
            const services = mod?.decisionServices;
            const svc = services?.[serviceName];
            if (!svc) {
              record('fail', `no decision service named ${JSON.stringify(serviceName)}`);
              continue;
            }
            // Map inputNodes to service parameter positions by name when
            // the module exports a signature; fall back to positional order
            // for older generated modules.
            const sig = mod?.decisionServiceParams?.[serviceName];
            const args: unknown[] = sig
              ? sig.map((p) => ctx[p])
              : inputs;
            actual = svc(...args);
            // Multi-output services return a context keyed by output decision
            // name; the resultNode names a specific output, so extract it.
            if (
              actual &&
              typeof actual === 'object' &&
              !Array.isArray(actual) &&
              Object.prototype.hasOwnProperty.call(actual, name)
            ) {
              actual = (actual as Record<string, unknown>)[name];
            }
          } else {
            const fn = decisions[name];
            if (!fn) {
              record('fail', `no decision named ${JSON.stringify(name)}`);
              continue;
            }
            actual = fn(ctx);
          }
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
