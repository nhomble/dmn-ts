import { XMLParser } from 'fast-xml-parser';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileFeel, FEEL_RUNTIME_SOURCE } from './feel.js';
import { toJsIdent } from './ident.js';

export { toJsIdent };

export interface DmnInputData {
  id?: string;
  name: string;
  typeRef?: string;
}

export interface DmnDecisionTableInput {
  text: string;
}

export interface DmnDecisionTableOutput {
  name?: string;
  typeRef?: string;
  outputValues?: string[];
}

export interface DmnDecisionTableRule {
  inputEntries: string[];
  outputEntries: string[];
}

export interface DmnDecisionTable {
  hitPolicy: string;
  aggregation?: string;
  inputs: DmnDecisionTableInput[];
  outputs: DmnDecisionTableOutput[];
  rules: DmnDecisionTableRule[];
}

export interface DmnDecision {
  id?: string;
  name: string;
  typeRef?: string;
  requiredInputs: string[];
  requiredDecisions: string[];
  literalExpressionText?: string;
  decisionTable?: DmnDecisionTable;
}

export interface DmnBkmParameter {
  name: string;
  typeRef?: string;
}

export interface DmnBkm {
  id?: string;
  name: string;
  typeRef?: string;
  parameters: DmnBkmParameter[];
  bodyText?: string;
}

export interface DmnModel {
  name: string;
  inputData: DmnInputData[];
  decisions: DmnDecision[];
  bkms: DmnBkm[];
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
  removeNSPrefix: true,
  isArray: (name) =>
    [
      'decision',
      'inputData',
      'informationRequirement',
      'businessKnowledgeModel',
      'formalParameter',
    ].includes(name),
});

function arr<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

export function parseDmn(xml: string): DmnModel {
  const parsed = xmlParser.parse(xml);
  const defs = parsed.definitions;
  if (!defs) throw new Error('No <definitions> root element');

  const idToName = new Map<string, string>();

  const inputDataRaw = arr<any>(defs.inputData);
  const inputData: DmnInputData[] = inputDataRaw.map((n) => {
    const id = n['@_id'];
    const name = n['@_name'];
    if (id) idToName.set(id, name);
    return { id, name, typeRef: n.variable?.['@_typeRef'] };
  });

  const decisionRaw = arr<any>(defs.decision);
  for (const n of decisionRaw) {
    if (n['@_id']) idToName.set(n['@_id'], n['@_name']);
  }

  const bkmRaw = arr<any>(defs.businessKnowledgeModel);
  for (const n of bkmRaw) {
    if (n['@_id']) idToName.set(n['@_id'], n['@_name']);
  }
  const bkms: DmnBkm[] = bkmRaw.map((n) => {
    const enc = n.encapsulatedLogic;
    const parameters: DmnBkmParameter[] = enc
      ? arr<any>(enc.formalParameter).map((p) => ({
          name: p['@_name'],
          typeRef: p['@_typeRef'],
        }))
      : [];
    const bodyText: string | undefined = enc?.literalExpression?.text;
    return {
      id: n['@_id'],
      name: n['@_name'],
      typeRef: n.variable?.['@_typeRef'],
      parameters,
      bodyText,
    };
  });

  const resolveHref = (href: string): string => {
    const id = href.startsWith('#') ? href.slice(1) : href;
    return idToName.get(id) ?? id;
  };

  const decisions: DmnDecision[] = decisionRaw.map((n) => {
    const reqs = arr<any>(n.informationRequirement);
    const requiredInputs: string[] = [];
    const requiredDecisions: string[] = [];
    for (const r of reqs) {
      if (r.requiredInput?.['@_href']) {
        requiredInputs.push(resolveHref(r.requiredInput['@_href']));
      } else if (r.requiredDecision?.['@_href']) {
        requiredDecisions.push(resolveHref(r.requiredDecision['@_href']));
      }
    }
    const literalExpressionText: string | undefined =
      n.literalExpression?.text ?? undefined;

    let decisionTable: DmnDecisionTable | undefined;
    if (n.decisionTable) {
      const dt = n.decisionTable;
      const inputs: DmnDecisionTableInput[] = arr<any>(dt.input).map((i) => ({
        text: i.inputExpression?.text ?? '',
      }));
      const outputs: DmnDecisionTableOutput[] = arr<any>(dt.output).map((o) => {
        const ovText: string | undefined = o.outputValues?.text;
        const outputValues = ovText
          ? parseOutputValuesList(String(ovText))
          : undefined;
        return {
          name: o['@_name'],
          typeRef: o['@_typeRef'],
          outputValues,
        };
      });
      const rules: DmnDecisionTableRule[] = arr<any>(dt.rule).map((r) => ({
        inputEntries: arr<any>(r.inputEntry).map((e) => String(e?.text ?? '')),
        outputEntries: arr<any>(r.outputEntry).map((e) => String(e?.text ?? '')),
      }));
      decisionTable = {
        hitPolicy: dt['@_hitPolicy'] ?? 'UNIQUE',
        aggregation: dt['@_aggregation'],
        inputs,
        outputs,
        rules,
      };
    }
    return {
      id: n['@_id'],
      name: n['@_name'],
      typeRef: n.variable?.['@_typeRef'],
      requiredInputs,
      requiredDecisions,
      literalExpressionText,
      decisionTable,
    };
  });

  return {
    name: defs['@_name'] ?? 'model',
    inputData,
    decisions,
    bkms,
  };
}

// Splits a string on top-level commas (skipping commas inside strings, parens, brackets).
function splitTopLevelCommas(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inStr = false;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      cur += c;
      if (c === '\\' && i + 1 < s.length) {
        cur += s[++i];
      } else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      cur += c;
      continue;
    }
    if (c === '(' || c === '[') {
      depth++;
      cur += c;
      continue;
    }
    if (c === ')' || c === ']') {
      depth--;
      cur += c;
      continue;
    }
    if (c === ',' && depth === 0) {
      const t = cur.trim();
      if (t !== '') out.push(t);
      cur = '';
      continue;
    }
    cur += c;
  }
  const t = cur.trim();
  if (t !== '') out.push(t);
  return out;
}

function feelExpr(text: string, allNames: string[]): string {
  return compileFeel(text, allNames);
}

// Parses an outputValues text body like `"Approved","Declined"` into the
// priority-ordered list of output values.
function parseOutputValuesList(text: string): string[] {
  const parts = splitTopLevelCommas(text);
  return parts.map((p) => {
    const t = p.trim();
    if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
      return t.slice(1, -1);
    }
    return t;
  });
}

// Translates a FEEL unary test (the `inputEntry` body of a decision-table rule)
// into a JS boolean expression evaluating against `inputExprJs`. Comparisons
// route through the FEEL runtime so null inputs and string compares behave as
// FEEL expects.
function translateUnaryTest(
  testText: string,
  inputExprJs: string,
  allNames: string[],
): string {
  const t = testText.trim();
  if (t === '' || t === '-') return 'true';

  const parts = splitTopLevelCommas(t);
  if (parts.length > 1) {
    return (
      '(' +
      parts
        .map((p) => translateUnaryTest(p, inputExprJs, allNames))
        .join(' || ') +
      ')'
    );
  }

  if (t.startsWith('not(') && t.endsWith(')')) {
    return `!(${translateUnaryTest(t.slice(4, -1), inputExprJs, allNames)})`;
  }

  const compMatch = /^(<=|>=|<|>|=)\s*(.+)$/.exec(t);
  if (compMatch) {
    const opMap: Record<string, string> = {
      '<': 'lt',
      '<=': 'le',
      '>': 'gt',
      '>=': 'ge',
      '=': 'eq',
    };
    const fn = opMap[compMatch[1]];
    const rhs = feelExpr(compMatch[2], allNames);
    return `feel.${fn}(${inputExprJs}, ${rhs})`;
  }

  const rangeMatch = /^([\[\(])\s*(.+?)\s*\.\.\s*(.+?)\s*([\]\)])$/.exec(t);
  if (rangeMatch) {
    const [, open, low, high, close] = rangeMatch;
    const lowFn = open === '[' ? 'ge' : 'gt';
    const highFn = close === ']' ? 'le' : 'lt';
    const lowExpr = feelExpr(low, allNames);
    const highExpr = feelExpr(high, allNames);
    return `(feel.${lowFn}(${inputExprJs}, ${lowExpr}) && feel.${highFn}(${inputExprJs}, ${highExpr}))`;
  }

  // Default: equality with the literal/expression
  const rhs = feelExpr(t, allNames);
  return `feel.eq(${inputExprJs}, ${rhs})`;
}

function emitHitPolicyTail(
  hitPolicy: string,
  aggregation: string | undefined,
  outputs: DmnDecisionTableOutput[],
  outputIsObject: boolean,
): string[] {
  const hp = hitPolicy.trim().toUpperCase();
  const sortLines: string[] = [];
  if (hp === 'PRIORITY' || hp === 'OUTPUT ORDER') {
    const orderingCol = outputs.findIndex(
      (o) => o.outputValues && o.outputValues.length > 0,
    );
    if (orderingCol >= 0) {
      const order = outputs[orderingCol].outputValues!;
      const valueAccess = outputIsObject
        ? `(m as any)[${JSON.stringify(outputs[orderingCol].name ?? '')}]`
        : `(m as any)`;
      sortLines.push(`    const __order: any[] = ${JSON.stringify(order)};`);
      sortLines.push(
        `    const __pri = (m: any) => { const i = __order.indexOf(${valueAccess}); return i < 0 ? __order.length : i; };`,
      );
      sortLines.push(`    __matches.sort((a, b) => __pri(a) - __pri(b));`);
    }
  }

  let ret: string;
  if (hp === 'COLLECT') {
    const agg = (aggregation ?? '').toUpperCase();
    if (agg === 'SUM') {
      ret = `return __matches.length === 0 ? null : __matches.reduce((s: any, m: any) => s + Number(m), 0);`;
    } else if (agg === 'COUNT') {
      ret = `return __matches.length;`;
    } else if (agg === 'MIN') {
      ret = `return __matches.length === 0 ? null : __matches.reduce((s: any, m: any) => Number(m) < Number(s) ? m : s);`;
    } else if (agg === 'MAX') {
      ret = `return __matches.length === 0 ? null : __matches.reduce((s: any, m: any) => Number(m) > Number(s) ? m : s);`;
    } else {
      ret = `return __matches;`;
    }
  } else if (hp === 'UNIQUE' || hp === 'ANY' || hp === 'FIRST' || hp === 'PRIORITY') {
    ret = `return __matches.length === 0 ? null : __matches[0];`;
  } else if (hp === 'RULE ORDER' || hp === 'OUTPUT ORDER') {
    ret = `return __matches;`;
  } else {
    ret = `return __matches.length === 0 ? null : __matches[0];`;
  }

  return [...sortLines, `    ${ret}`];
}

function emitDecisionTableFn(
  decision: DmnDecision,
  table: DmnDecisionTable,
  allNames: string[],
): string {
  const inputBindings = decision.requiredInputs.map((n) => {
    const ident = toJsIdent(n);
    return `    const ${ident}: any = ctx[${JSON.stringify(n)}];`;
  });
  const decisionBindings = decision.requiredDecisions.map((n) => {
    const ident = toJsIdent(n);
    return `    const ${ident}: any = decisions[${JSON.stringify(n)}](ctx);`;
  });

  const inputExprsJs = table.inputs.map((i) => feelExpr(i.text, allNames));

  const outputIsObject =
    table.outputs.length > 1 ||
    (table.outputs.length === 1 && !!table.outputs[0].name);

  const lines: string[] = [];
  lines.push(`  ${JSON.stringify(decision.name)}: (ctx) => {`);
  lines.push(...inputBindings);
  lines.push(...decisionBindings);
  inputExprsJs.forEach((e, idx) => {
    lines.push(`    const __in${idx}: any = ${e};`);
  });
  lines.push(`    const __matches: any[] = [];`);

  table.rules.forEach((rule, ri) => {
    const tests = rule.inputEntries.map((entry, idx) =>
      translateUnaryTest(entry, `__in${idx}`, allNames),
    );
    const cond = tests.length === 0 ? 'true' : tests.join(' && ');
    let outExpr: string;
    if (outputIsObject) {
      const parts = table.outputs.map((o, oi) => {
        const v = feelExpr(rule.outputEntries[oi] ?? '', allNames);
        return `${JSON.stringify(o.name ?? `output${oi}`)}: ${v}`;
      });
      outExpr = `{ ${parts.join(', ')} }`;
    } else {
      outExpr = feelExpr(rule.outputEntries[0] ?? '', allNames);
    }
    lines.push(`    // rule ${ri + 1}`);
    lines.push(`    if (${cond}) { __matches.push(${outExpr}); }`);
  });

  lines.push(
    ...emitHitPolicyTail(
      table.hitPolicy,
      table.aggregation,
      table.outputs,
      outputIsObject,
    ),
  );
  lines.push(`  },`);
  return lines.join('\n');
}

function emitDecisionFn(decision: DmnDecision, allNames: string[]): string {
  if (decision.decisionTable) {
    return emitDecisionTableFn(decision, decision.decisionTable, allNames);
  }
  const inputBindings = decision.requiredInputs.map((n) => {
    const ident = toJsIdent(n);
    return `    const ${ident}: any = ctx[${JSON.stringify(n)}];`;
  });
  const decisionBindings = decision.requiredDecisions.map((n) => {
    const ident = toJsIdent(n);
    return `    const ${ident}: any = decisions[${JSON.stringify(n)}](ctx);`;
  });
  const expr = decision.literalExpressionText
    ? feelExpr(decision.literalExpressionText, allNames)
    : '/* TODO: non-literal expression not yet supported */ undefined';
  return [
    `  ${JSON.stringify(decision.name)}: (ctx) => {`,
    ...inputBindings,
    ...decisionBindings,
    `    return ${expr};`,
    `  },`,
  ].join('\n');
}

function emitBkm(bkm: DmnBkm, allNames: string[]): string {
  const params = bkm.parameters
    .map((p) => `${toJsIdent(p.name)}: any`)
    .join(', ');
  const localNames = [...allNames, ...bkm.parameters.map((p) => p.name)];
  const body = bkm.bodyText
    ? compileFeel(bkm.bodyText, localNames)
    : 'undefined';
  return `function ${toJsIdent(bkm.name)}(${params}): any {\n  return ${body};\n}`;
}

export function emitTs(model: DmnModel): string {
  const allNames = [
    ...model.inputData.map((i) => i.name),
    ...model.decisions.map((d) => d.name),
    ...model.bkms.map((b) => b.name),
  ];
  const bkmDefs = model.bkms.map((b) => emitBkm(b, allNames));
  return [
    `// @generated by tom-rools — do not edit by hand`,
    `// source DMN model: ${model.name}`,
    ``,
    FEEL_RUNTIME_SOURCE,
    ...bkmDefs,
    bkmDefs.length ? '' : null,
    `export type DecisionFn = (ctx: Record<string, unknown>) => unknown;`,
    ``,
    `export const inputDataNames: readonly string[] = ${JSON.stringify(
      model.inputData.map((i) => i.name),
    )};`,
    ``,
    `export const decisions: Record<string, DecisionFn> = {`,
    ...model.decisions.map((d) => emitDecisionFn(d, allNames)),
    `};`,
    ``,
  ]
    .filter((l): l is string => l !== null)
    .join('\n');
}

function pkgName(modelName: string): string {
  const slug = modelName
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `dmn-${slug || 'model'}`;
}

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
}
