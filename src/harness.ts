import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runTestCases, type CaseModule } from './runner.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: harness <case-dir> <generated-pkg-dir>');
    process.exit(2);
  }
  const caseDir = resolve(args[0]);
  const pkgDir = resolve(args[1]);
  const indexUrl = pathToFileURL(resolve(pkgDir, 'dist', 'index.js')).href;

  let mod: CaseModule | null = null;
  let loadError: string | null = null;
  try {
    mod = (await import(indexUrl)) as CaseModule;
  } catch (e: any) {
    loadError = e?.message ?? String(e);
  }

  const summary = runTestCases(caseDir, mod, loadError);
  console.log(`pass: ${summary.passed}  fail: ${summary.failed}`);
  for (const r of summary.results) {
    if (r.status === 'fail') {
      console.log(`  - ${r.testFile}#${r.testCaseId}/${r.resultName}: ${r.reason}`);
    }
  }
  process.exit(summary.failed > 0 ? 1 : 0);
}

main();
