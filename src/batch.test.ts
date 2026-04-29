#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { emitTs, loadDmnTree } from './transpile.js';
import { getRuntimeSource } from './feel.js';
import {
  type CaseModule,
  type TestResult,
  runTestCases,
  listTestFiles,
} from './runner.js';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const TOOL_ROOT = resolve(SCRIPT_DIR, '..');

interface CaseRecord {
  name: string;
  caseDir: string;
  dmnPath: string;
  transpileError?: string;
  loadError?: string;
  results: TestResult[];
  passed: number;
  failed: number;
  // When set, the case matched an entry in `tck-ignore.json`. Its
  // transpile errors and failed assertions are tracked as informational
  // but excluded from the CI exit-code calculation.
  ignoredReason?: string;
}

interface IgnoreEntry {
  match: string;
  reason: string;
}

function loadIgnoreList(): IgnoreEntry[] {
  const path = resolve(TOOL_ROOT, 'tck-ignore.json');
  if (!existsSync(path)) return [];
  try {
    const cfg = JSON.parse(readFileSync(path, 'utf8'));
    return Array.isArray(cfg.cases) ? cfg.cases : [];
  } catch {
    return [];
  }
}

function matchIgnore(name: string, ignores: IgnoreEntry[]): string | undefined {
  for (const e of ignores) {
    if (name.includes(e.match)) return e.reason;
  }
  return undefined;
}

function findCaseDirs(root: string): string[] {
  // A case dir is one that contains a .dmn file directly inside it.
  const out: string[] = [];
  const SKIP = new Set(['translator', '.git', 'node_modules']);
  function walk(dir: string) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    let hasDmn = false;
    const subdirs: string[] = [];
    for (const e of entries) {
      const full = join(dir, e);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isFile() && e.endsWith('.dmn')) hasDmn = true;
      else if (st.isDirectory() && !SKIP.has(e)) subdirs.push(full);
    }
    if (hasDmn) out.push(dir);
    for (const s of subdirs) walk(s);
  }
  walk(root);
  return out.sort();
}

function findDmnFile(caseDir: string): string | null {
  const dmns = readdirSync(caseDir).filter((e) => e.endsWith('.dmn'));
  if (dmns.length === 0) return null;
  // Prefer one whose basename matches the dir name; else the shortest.
  const slug = basename(caseDir);
  const preferred = dmns.find((d) => d.startsWith(slug)) ?? dmns[0];
  return join(caseDir, preferred);
}

function countExpectedTests(caseDir: string): number {
  let count = 0;
  for (const tf of listTestFiles(caseDir)) {
    const xml = readFileSync(join(caseDir, tf), 'utf8');
    // Crude but cheap: count <resultNode occurrences.
    const matches = xml.match(/<resultNode\b/g);
    if (matches) count += matches.length;
  }
  return count;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const positional = args.filter((a, i) => !(a === '-o' || args[i - 1] === '-o'));
  const oIdx = args.indexOf('-o');
  const outDir =
    oIdx >= 0 && args[oIdx + 1]
      ? resolve(args[oIdx + 1])
      : resolve(TOOL_ROOT, 'out', 'suite');
  const tckRoot = positional[0] ? resolve(positional[0]) : null;
  if (!tckRoot) {
    console.error('Usage: batch <tck-root> [-o <out-dir>]');
    process.exit(2);
  }

  const caseDirs = findCaseDirs(tckRoot);
  const ignoreList = loadIgnoreList();
  console.log(
    `found ${caseDirs.length} case(s) under ${tckRoot}` +
      (ignoreList.length ? ` (ignore list: ${ignoreList.length} entr${ignoreList.length === 1 ? 'y' : 'ies'})` : ''),
  );

  if (existsSync(outDir)) rmSync(outDir, { recursive: true });
  mkdirSync(join(outDir, 'cases'), { recursive: true });
  // One shared FEEL runtime for all cases.
  writeFileSync(join(outDir, 'cases', 'runtime.ts'), getRuntimeSource());

  const records: CaseRecord[] = [];
  const slugFor = (caseDir: string): string => {
    const rel = relative(tckRoot, caseDir) || basename(caseDir);
    return rel.split(sep).join('__').replace(/[^A-Za-z0-9_-]/g, '_');
  };
  for (const caseDir of caseDirs) {
    const slug = slugFor(caseDir);
    const dmnPath = findDmnFile(caseDir);
    const rec: CaseRecord = {
      name: slug,
      caseDir,
      dmnPath: dmnPath ?? '',
      results: [],
      passed: 0,
      failed: 0,
      ignoredReason: matchIgnore(slug, ignoreList),
    };
    if (!dmnPath) {
      rec.transpileError = 'no .dmn file found';
      records.push(rec);
      continue;
    }
    try {
      // Two-pass parse for the host plus its siblings so cross-namespace
      // hrefs and transitive imports resolve before emit. `loadDmnTree`
      // returns one resolved model per file.
      const allFiles = readdirSync(rec.caseDir)
        .filter((f) => f.endsWith('.dmn'))
        .map((f) => join(rec.caseDir, f));
      const tree = loadDmnTree(allFiles);
      const model = tree.get(dmnPath);
      if (!model) throw new Error('host model failed to parse');
      const ts = emitTs(model, { runtimeImport: '../runtime.js' });
      const dest = join(outDir, 'cases', slug);
      mkdirSync(dest, { recursive: true });
      writeFileSync(join(dest, 'index.ts'), ts);
    } catch (e: any) {
      rec.transpileError = e?.message ?? String(e);
    }
    records.push(rec);
  }

  const tsconfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      outDir: 'dist',
      rootDir: 'cases',
      strict: true,
      declaration: false,
      esModuleInterop: true,
      skipLibCheck: true,
      noEmitOnError: false,
    },
    include: ['cases/**/*.ts'],
  };
  writeFileSync(
    join(outDir, 'tsconfig.json'),
    JSON.stringify(tsconfig, null, 2) + '\n',
  );

  console.log('compiling generated TS...');
  const tscPath = resolve(TOOL_ROOT, 'node_modules', '.bin', 'tsc');
  const tsc = spawnSync(tscPath, ['-p', join(outDir, 'tsconfig.json')], {
    cwd: TOOL_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  if (tsc.status !== 0) {
    const diag = (tsc.stdout + tsc.stderr).split('\n').filter(Boolean);
    console.log(
      `tsc reported ${diag.length} line(s) of diagnostics (continuing — JS may still have been emitted).`,
    );
  } else {
    console.log('tsc: clean.');
  }

  for (const rec of records) {
    if (rec.transpileError) {
      const summary = runTestCases(
        rec.caseDir,
        null,
        `transpile: ${rec.transpileError}`,
      );
      rec.results = summary.results;
      rec.passed = summary.passed;
      rec.failed = summary.failed;
      continue;
    }
    const compiledJs = join(outDir, 'dist', rec.name, 'index.js');
    let mod: CaseModule | null = null;
    let loadError: string | null = null;
    if (!existsSync(compiledJs)) {
      loadError = 'no compiled output (tsc emit suppressed)';
    } else {
      try {
        mod = (await import(pathToFileURL(compiledJs).href)) as CaseModule;
      } catch (e: any) {
        loadError = e?.message ?? String(e);
      }
    }
    const summary = runTestCases(rec.caseDir, mod, loadError);
    rec.results = summary.results;
    rec.passed = summary.passed;
    rec.failed = summary.failed;
    if (loadError) rec.loadError = loadError;
  }

  const active = records.filter((r) => !r.ignoredReason);
  const ignored = records.filter((r) => r.ignoredReason);
  const totalPassed = records.reduce((s, r) => s + r.passed, 0);
  const totalFailed = records.reduce((s, r) => s + r.failed, 0);
  const total = totalPassed + totalFailed;
  // Active = not on the ignore list. Only these contribute to the exit code.
  const activeFailed = active.reduce((s, r) => s + r.failed, 0);
  const fullyPassing = records.filter((r) => r.failed === 0 && r.passed > 0).length;
  const transpileFailed = active.filter((r) => r.transpileError).length;
  const loadFailed = active.filter((r) => r.loadError).length;
  const ignoredTests = ignored.reduce((s, r) => s + r.passed + r.failed, 0);

  writeFileSync(
    join(outDir, 'report.json'),
    JSON.stringify(
      {
        tckRoot,
        totals: {
          cases: records.length,
          casesFullyPassing: fullyPassing,
          casesTranspileFailed: transpileFailed,
          casesLoadFailed: loadFailed,
          casesIgnored: ignored.length,
          tests: total,
          passed: totalPassed,
          failed: totalFailed,
          testsIgnored: ignoredTests,
        },
        cases: records.map((r) => ({
          name: r.name,
          passed: r.passed,
          failed: r.failed,
          transpileError: r.transpileError,
          loadError: r.loadError,
          ignoredReason: r.ignoredReason,
          failures: r.results
            .filter((x) => x.status === 'fail')
            .slice(0, 200)
            .map((x) => ({
              tc: `${x.testFile}#${x.testCaseId}/${x.resultName}`,
              reason: x.reason,
            })),
        })),
      },
      null,
      2,
    ) + '\n',
  );

  const activePassed = totalPassed - ignored.reduce((s, r) => s + r.passed, 0);
  const activeTotal = activePassed + activeFailed;

  console.log('');
  console.log(
    `cases: ${fullyPassing}/${records.length} fully passing  (${transpileFailed} transpile-failed, ${loadFailed} load-failed${ignored.length ? `, ${ignored.length} ignored` : ''})`,
  );
  console.log(
    `tests: ${activePassed}/${activeTotal} passing  (${activeFailed} failures${ignoredTests ? `, ${ignoredTests} on ignored cases` : ''})`,
  );
  console.log(`report: ${join(outDir, 'report.json')}`);
  if (activeFailed > 0) process.exit(1);
}

await main();
