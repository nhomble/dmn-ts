// Public entry point: orchestrates the parse → emit pipeline and writes
// out a buildable TypeScript package. The two phases live in their own
// modules — keep this file thin so importers see a clear surface.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getRuntimeSource } from './feel.js';
import { toJsIdent } from './ident.js';
import type { DmnModel } from './dmn-model.js';
import { emitTs } from './dmn-emit.js';

// Re-export the public API so existing importers (`cli.ts`, `batch.test.ts`,
// downstream consumers) don't have to learn the internal layout.
export { toJsIdent };
export { parseDmn, type ParseOptions } from './dmn-parse.js';
export { emitTs, type EmitOptions } from './dmn-emit.js';
export type {
  DmnBkm,
  DmnBkmParameter,
  DmnContext,
  DmnContextEntry,
  DmnDecision,
  DmnDecisionService,
  DmnDecisionTable,
  DmnDecisionTableInput,
  DmnDecisionTableOutput,
  DmnDecisionTableRule,
  DmnInputData,
  DmnInvocation,
  DmnInvocationBinding,
  DmnItemDefinition,
  DmnModel,
  DmnRelation,
  DmnRelationRow,
  DmnVersion,
} from './dmn-model.js';

function pkgName(modelName: string): string {
  const slug = modelName
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `dmn-${slug || 'model'}`;
}

// Materialize a model as a self-contained TypeScript package on disk:
// `package.json`, `tsconfig.json`, `src/index.ts` (the generated decisions),
// and a copy of the FEEL runtime alongside it.
export function emitPackage(model: DmnModel, outDir: string): void {
  mkdirSync(join(outDir, 'src'), { recursive: true });

  const pkgJson = {
    name: pkgName(model.name),
    version: '0.0.0',
    private: true,
    type: 'module',
    main: './dist/index.js',
    types: './dist/index.d.ts',
    scripts: { build: 'tsc -p tsconfig.json' },
    devDependencies: { typescript: '^5.6.0' },
  };

  const tsconfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      outDir: 'dist',
      rootDir: 'src',
      strict: true,
      declaration: true,
      esModuleInterop: true,
      skipLibCheck: true,
    },
    include: ['src/**/*.ts'],
  };

  writeFileSync(
    join(outDir, 'package.json'),
    JSON.stringify(pkgJson, null, 2) + '\n',
  );
  writeFileSync(
    join(outDir, 'tsconfig.json'),
    JSON.stringify(tsconfig, null, 2) + '\n',
  );
  writeFileSync(join(outDir, 'src', 'index.ts'), emitTs(model));
  writeFileSync(join(outDir, 'src', 'runtime.ts'), getRuntimeSource());
}
