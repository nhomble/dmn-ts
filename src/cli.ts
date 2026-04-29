#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';
import {
  emitMultiPackage,
  emitPackage,
  findDmnFiles,
  loadDmnTree,
  parseDmn,
} from './transpile.js';

function usage(): never {
  console.error('Usage: tom-rools <input.dmn | input-dir> -o <out-dir>');
  process.exit(2);
}

function slugify(path: string, baseDir: string): string {
  const rel = relative(baseDir, path).replace(/\.dmn$/, '');
  return rel.split(/[\\/]/).join('__').replace(/[^A-Za-z0-9_-]/g, '_');
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length < 3) usage();
  const input = resolve(args[0]);
  const oIdx = args.indexOf('-o');
  if (oIdx < 0 || !args[oIdx + 1]) usage();
  const outDir = resolve(args[oIdx + 1]);

  const stat = statSync(input);
  if (stat.isDirectory()) {
    const files = findDmnFiles(input);
    if (files.length === 0) {
      console.error(`tom-rools: no .dmn files found under ${input}`);
      process.exit(1);
    }
    const tree = loadDmnTree(files);
    const models = [...tree.entries()].map(([p, m]) => ({
      slug: slugify(p, input),
      model: m,
    }));
    emitMultiPackage(models, outDir, `dmn-${basename(input) || 'models'}`);
    const totalDecisions = models.reduce((s, { model }) => s + model.decisions.length, 0);
    console.log(
      `tom-rools: emitted ${models.length} model(s) (${totalDecisions} decision(s) total) → ${outDir}`,
    );
  } else {
    const xml = readFileSync(input, 'utf8');
    const model = parseDmn(xml);
    emitPackage(model, outDir);
    console.log(
      `tom-rools: emitted ${model.decisions.length} decision(s), ${model.inputData.length} input(s) → ${outDir}`,
    );
  }
}

main();
