#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { emitPackage, parseDmn } from './transpile.js';

function usage(): never {
  console.error('Usage: tom-rools <input.dmn> -o <out-dir>');
  process.exit(2);
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length < 3) usage();
  const input = args[0];
  const oIdx = args.indexOf('-o');
  if (oIdx < 0 || !args[oIdx + 1]) usage();
  const outDir = resolve(args[oIdx + 1]);
  const xml = readFileSync(resolve(input), 'utf8');
  const model = parseDmn(xml);
  emitPackage(model, outDir);
  console.log(
    `tom-rools: emitted ${model.decisions.length} decision(s), ${model.inputData.length} input(s) → ${outDir}`,
  );
}

main();
