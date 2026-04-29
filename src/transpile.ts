// Public entry point: orchestrates the parse → emit pipeline and writes
// out a buildable TypeScript package. The two phases live in their own
// modules — keep this file thin so importers see a clear surface.

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getRuntimeSource } from './feel.js';
import { toJsIdent } from './ident.js';
import type { DmnModel } from './dmn-model.js';
import { emitTs } from './dmn-emit.js';
import { mergeImport, parseDmn } from './dmn-parse.js';

// Re-export the public API so existing importers (`cli.ts`, `batch.test.ts`,
// downstream consumers) don't have to learn the internal layout.
export { toJsIdent };
export { parseDmn, mergeImport, type ParseOptions } from './dmn-parse.js';
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

// Recursively walk `dir` collecting every `.dmn` file. Skips dot-dirs and
// `node_modules` so an output dir nested under the input doesn't get pulled
// in accidentally.
export function findDmnFiles(dir: string): string[] {
  const out: string[] = [];
  const SKIP = new Set(['node_modules', 'dist', 'out']);
  function walk(d: string): void {
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.startsWith('.') || SKIP.has(e)) continue;
      const full = join(d, e);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full);
      else if (st.isFile() && e.endsWith('.dmn')) out.push(full);
    }
  }
  walk(dir);
  return out.sort();
}

// Two-pass parse for a set of DMN files: first pass builds the
// (namespace → idMap) registry so cross-namespace `href`s resolve, then
// each model is re-parsed with that registry, then `mergeImport` is run
// transitively so every host model carries its imports' bkms / decisions /
// itemDefinitions under the import alias. Returns one resolved model per
// input file path.
export function loadDmnTree(filePaths: string[]): Map<string, DmnModel> {
  const xmlByPath = new Map<string, string>();
  for (const p of filePaths) {
    try {
      xmlByPath.set(p, readFileSync(p, 'utf8'));
    } catch {
      /* skip unreadable */
    }
  }

  const externalIds = new Map<string, Map<string, string>>();
  const nsByPath = new Map<string, string>();
  const pathByNs = new Map<string, string>();
  for (const [p, xml] of xmlByPath) {
    try {
      const m = parseDmn(xml);
      if (m.namespace) {
        externalIds.set(m.namespace, m.idMap);
        nsByPath.set(p, m.namespace);
        pathByNs.set(m.namespace, p);
      }
    } catch {
      /* not a parseable DMN file — drop it */
    }
  }

  const resolved = new Map<string, DmnModel>();
  for (const [p, xml] of xmlByPath) {
    if (!nsByPath.has(p)) continue;
    try {
      resolved.set(p, parseDmn(xml, { externalIds }));
    } catch {
      /* skip */
    }
  }

  const merged = new Set<string>();
  function mergeFor(path: string, seen: Set<string>): void {
    if (merged.has(path)) return;
    merged.add(path);
    const m = resolved.get(path);
    if (!m) return;
    for (const imp of m.imports) {
      if (!imp.namespace || seen.has(imp.namespace)) continue;
      const targetPath = pathByNs.get(imp.namespace);
      if (!targetPath || !resolved.has(targetPath)) continue;
      const nextSeen = new Set(seen);
      nextSeen.add(imp.namespace);
      mergeFor(targetPath, nextSeen);
      mergeImport(m, imp.name, resolved.get(targetPath)!);
    }
  }
  for (const p of resolved.keys()) {
    mergeFor(p, new Set([resolved.get(p)?.namespace ?? '']));
  }

  return resolved;
}

// Materialize multiple models into one shared TypeScript package — single
// `package.json`, single shared `runtime.ts`, one `<slug>.ts` per model.
// Used by the CLI's folder-input mode where you want all models in a tree
// emitted side-by-side without per-model boilerplate.
export function emitMultiPackage(
  models: Array<{ slug: string; model: DmnModel }>,
  outDir: string,
  packageName = 'dmn-models',
): void {
  mkdirSync(join(outDir, 'src'), { recursive: true });

  const pkgJson = {
    name: packageName,
    version: '0.0.0',
    private: true,
    type: 'module',
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
  writeFileSync(join(outDir, 'src', 'runtime.ts'), getRuntimeSource());
  for (const { slug, model } of models) {
    writeFileSync(
      join(outDir, 'src', `${slug}.ts`),
      emitTs(model, { runtimeImport: './runtime.js' }),
    );
  }
}
