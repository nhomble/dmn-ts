// `DmnModel` → TypeScript source. The emitter consumes the parsed model
// and produces a generated `index.ts` whose decisions/services are
// callable from a host Node program. All FEEL-text → JS-expression work is
// delegated to `feel.ts`'s `compileFeel`.

import {
  compileFeel,
  FEEL_BUILTINS,
  FEEL_BUILTIN_PARAMS,
  type CompileContext,
} from './feel.js';
import { toJsIdent } from './ident.js';
import type {
  DmnBkm,
  DmnContext,
  DmnContextEntry,
  DmnDecision,
  DmnDecisionService,
  DmnDecisionTable,
  DmnDecisionTableOutput,
  DmnInvocation,
  DmnInvocationBinding,
  DmnModel,
  DmnRelation,
} from './dmn-model.js';
import { splitTopLevelCommas } from './dmn-parse.js';
import { isScalarTypeRef, typeRefLocal } from './type-utils.js';

function feelExpr(
  text: string,
  allNames: string[],
  ctx?: CompileContext,
): string {
  return compileFeel(text, allNames, ctx);
}

function buildCompileContext(model: DmnModel): CompileContext {
  const signatures: Record<string, string[]> = {};
  for (const b of model.bkms) {
    signatures[b.name] = b.parameters.map((p) => p.name);
  }
  const validatableTypes = new Set(model.itemDefinitions.map((it) => it.name));
  const collectionTypes = new Set(
    model.itemDefinitions.filter((it) => it.isCollection).map((it) => it.name),
  );
  const moduleScopeNames = new Set<string>([
    ...model.bkms.map((b) => b.name),
    ...model.decisionServices.map((s) => s.name),
    ...model.decisions.map((d) => d.name),
  ]);
  return {
    signatures,
    validatableTypes,
    collectionTypes,
    moduleScopeNames,
    dmnVersion: model.dmnVersion,
  };
}

// Build a JS-source literal describing the model's user-defined types
// (item definitions). The generated runtime helper consumes this to validate
// decision returns against allowedValues / base types.
function emitItemDefsLiteral(model: DmnModel): string {
  const props = model.itemDefinitions.map((it) => {
    const fields: string[] = [];
    if (it.typeRef) fields.push(`base: ${JSON.stringify(it.typeRef)}`);
    if (it.isCollection) fields.push(`isCollection: true`);
    if (it.allowedValues) {
      // Compile each FEEL unary-test fragment into a predicate that runs
      // against the candidate value at validation time.
      const tests = it.allowedValues.map(
        (av) => `(__v: any) => ${translateUnaryTest(av, '__v', [])}`,
      );
      fields.push(`allowedValueTests: [${tests.join(', ')}]`);
    }
    if (it.components && it.components.length) {
      const comps = it.components
        .map(
          (c) =>
            `{ name: ${JSON.stringify(c.name)}${c.typeRef ? `, typeRef: ${JSON.stringify(c.typeRef)}` : ''}${c.isCollection ? ', isCollection: true' : ''} }`,
        )
        .join(', ');
      fields.push(`components: [${comps}]`);
    }
    return `${JSON.stringify(it.name)}: { ${fields.join(', ')} }`;
  });
  return `{ ${props.join(', ')} }`;
}

// Translates a FEEL unary test (the `inputEntry` body of a decision-table rule)
// into a JS boolean expression evaluating against `inputExprJs`. Comparisons
// route through the FEEL runtime so null inputs and string compares behave as
// FEEL expects.
export function translateUnaryTest(
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

// Emit the body lines of a decision-table evaluation (without any outer
// function wrapper). Indentation is 4 spaces.
function emitDecisionTableBody(
  table: DmnDecisionTable,
  allNames: string[],
  cctx: CompileContext,
): string[] {
  const inputExprsJs = table.inputs.map((i) =>
    feelExpr(i.text, allNames, cctx),
  );
  const outputIsObject =
    table.outputs.length > 1 ||
    (table.outputs.length === 1 && !!table.outputs[0].name);
  const lines: string[] = [];
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
        const v = feelExpr(rule.outputEntries[oi] ?? '', allNames, cctx);
        return `${JSON.stringify(o.name ?? `output${oi}`)}: ${v}`;
      });
      outExpr = `{ ${parts.join(', ')} }`;
    } else {
      outExpr = feelExpr(rule.outputEntries[0] ?? '', allNames, cctx);
    }
    lines.push(`    // rule ${ri + 1}`);
    lines.push(`    if (${cond}) { __matches.push(${outExpr}); }`);
  });
  // <defaultOutputEntry> — used when no rule matched.
  const hasDefaults = table.outputs.some((o) => o.defaultText);
  if (hasDefaults) {
    let defExpr: string;
    if (outputIsObject) {
      const parts = table.outputs.map((o, oi) => {
        const v = o.defaultText
          ? feelExpr(o.defaultText, allNames, cctx)
          : 'null';
        return `${JSON.stringify(o.name ?? `output${oi}`)}: ${v}`;
      });
      defExpr = `{ ${parts.join(', ')} }`;
    } else {
      defExpr = table.outputs[0].defaultText
        ? feelExpr(table.outputs[0].defaultText, allNames, cctx)
        : 'null';
    }
    lines.push(
      `    if (__matches.length === 0) { __matches.push(${defExpr}); }`,
    );
  }
  lines.push(
    ...emitHitPolicyTail(
      table.hitPolicy,
      table.aggregation,
      table.outputs,
      outputIsObject,
    ),
  );
  return lines;
}

function emitDecisionTableFn(
  decision: DmnDecision,
  table: DmnDecisionTable,
  allNames: string[],
  cctx: CompileContext,
): string {
  const inputBindings = decision.requiredInputs.map((n) => {
    const ident = toJsIdent(n);
    return `    const ${ident}: any = ctx[${JSON.stringify(n)}];`;
  });
  const decisionBindings = decision.requiredDecisions.map((n) => {
    const ident = toJsIdent(n);
    return `    const ${ident}: any = ctx[${JSON.stringify(n)}] !== undefined ? ctx[${JSON.stringify(n)}] : decisions[${JSON.stringify(n)}](ctx);`;
  });
  return [
    `  ${JSON.stringify(decision.name)}: (ctx) => {`,
    ...inputBindings,
    ...decisionBindings,
    ...emitDecisionTableBody(table, allNames, cctx),
    `  },`,
  ].join('\n');
}

function emitInvocationCall(
  inv: DmnInvocation,
  allNames: string[],
  cctx: CompileContext,
): string {
  if (!inv.fnText) return 'null';
  const fnText = inv.fnText.trim();
  const compiledArgValue = (b: DmnInvocationBinding) => {
    let expr = feelExpr(b.bodyText ?? 'null', allNames, cctx);
    if (b.typeRef && (isScalarTypeRef(b.typeRef) || cctx.validatableTypes?.has(typeRefLocal(b.typeRef)))) {
      // Validate the bound value against the parameter's declared type so
      // a non-conforming value coerces to null at the call boundary.
      expr = `feel.validate(${expr}, ${JSON.stringify(b.typeRef)}, __itemDefs)`;
    }
    return expr;
  };
  // Inline function definition: compile as a FEEL expression and call it.
  if (/^function\s*\(/.test(fnText)) {
    const fnExpr = compileFeel(fnText, allNames, cctx);
    const m = /^function\s*\(([^)]*)\)/.exec(fnText);
    const params = (m?.[1] ?? '')
      .split(',')
      .map((s) => s.trim().split(':')[0].trim())
      .filter((s) => s.length > 0);
    const positional = params.map((p) => {
      const b = inv.bindings.find((x) => x.name === p);
      return b ? compiledArgValue(b) : 'undefined';
    });
    return `(${fnExpr})(${positional.join(', ')})`;
  }
  const fnName = fnText;
  const sig = cctx.signatures[fnName] ?? FEEL_BUILTIN_PARAMS[fnName];
  const fnExpr = FEEL_BUILTINS[fnName]
    ? `feel.${FEEL_BUILTINS[fnName]}`
    : toJsIdent(fnName);
  if (sig) {
    const positional: string[] = sig.map((p) => {
      const b = inv.bindings.find((x) => x.name === p);
      return b ? compiledArgValue(b) : 'undefined';
    });
    for (const b of inv.bindings) {
      if (!sig.includes(b.name)) positional.push(compiledArgValue(b));
    }
    return `${fnExpr}(${positional.join(', ')})`;
  }
  const named = inv.bindings
    .map((b) => `${JSON.stringify(b.name)}: ${compiledArgValue(b)}`)
    .join(', ');
  return `${fnExpr}({ __named: { ${named} } })`;
}

// Generic per-entry body compiler. Returns the JS expression for whatever
// form the entry takes (literal, function-def, decision-table, invocation,
// nested context).
function emitContextEntryBody(
  e: DmnContextEntry,
  allNames: string[],
  cctx: CompileContext,
): string {
  if (e.functionParameters) {
    const fnLocalNames = [
      ...allNames,
      ...e.functionParameters.map((p) => p.name),
    ];
    const fnBody = e.bodyText
      ? feelExpr(e.bodyText, fnLocalNames, cctx)
      : 'undefined';
    const params = e.functionParameters
      .map((p) => `${toJsIdent(p.name)}: any`)
      .join(', ');
    const paramNames = JSON.stringify(e.functionParameters.map((p) => p.name));
    // Attach `__params` so a named-arg call site can map names → positions.
    return `Object.assign(((${params}): any => (${fnBody})), { __params: ${paramNames} as readonly string[] })`;
  }
  if (e.decisionTable) {
    const body = emitDecisionTableBody(e.decisionTable, allNames, cctx);
    return `(() => {\n${body.join('\n')}\n  })()`;
  }
  if (e.invocation) {
    return emitInvocationCall(e.invocation, allNames, cctx);
  }
  if (e.context) {
    return emitContextValue(e.context, allNames, cctx);
  }
  return e.bodyText ? feelExpr(e.bodyText, allNames, cctx) : 'undefined';
}

// Produce a JS expression that evaluates a context to either an object (when
// all entries are named) or the final unnamed entry.
function emitContextValue(
  context: DmnContext,
  allNames: string[],
  cctx: CompileContext,
): string {
  const localNames = [...allNames];
  const declared = new Set<string>();
  const lines: string[] = [];
  const namedKeys: { dmnName: string; ident: string }[] = [];
  let finalReturn: string | null = null;
  // Extend signatures with any context-defined functions so calls like
  // `boxedFnDefinition(b: x, a: y)` can resolve their named args.
  const localCctx: CompileContext = {
    ...cctx,
    signatures: { ...cctx.signatures },
    localBindings: { ...(cctx.localBindings ?? {}) },
  };
  for (const e of context.entries) {
    if (!e.name) continue;
    if (e.functionParameters) {
      localCctx.signatures[e.name] = e.functionParameters.map((p) => p.name);
      continue;
    }
    const text = (e.bodyText ?? '').trim();
    const fnMatch = /^function\s*\(([^)]*)\)/.exec(text);
    if (fnMatch) {
      const params = fnMatch[1]
        .split(',')
        .map((p) => p.trim().split(':')[0].trim())
        .filter((p) => p.length > 0);
      if (params.length) localCctx.signatures[e.name] = params;
    }
  }
  const chooseIdent = (i: number, name: string): string => {
    const base = toJsIdent(name);
    if (cctx.moduleScopeNames?.has(name)) {
      return `__local_${i}_${base}`;
    }
    return base;
  };
  for (let i = 0; i < context.entries.length; i++) {
    const e = context.entries[i];
    const body = emitContextEntryBody(e, localNames, localCctx);
    if (e.name) {
      const ident = chooseIdent(i, e.name);
      if (declared.has(ident)) {
        lines.push(`    ${ident} = ${body};`);
      } else {
        lines.push(`    let ${ident}: any = ${body};`);
        declared.add(ident);
      }
      namedKeys.push({ dmnName: e.name, ident });
      if (!localNames.includes(e.name)) localNames.push(e.name);
      localCctx.localBindings![e.name] = ident;
    } else {
      finalReturn = body;
    }
  }
  let ret: string;
  if (finalReturn !== null) {
    ret = finalReturn;
  } else {
    const props = namedKeys
      .map((k) => `${JSON.stringify(k.dmnName)}: ${k.ident}`)
      .join(', ');
    ret = `{ ${props} }`;
  }
  return `(() => {\n${lines.join('\n')}\n    return ${ret};\n  })()`;
}

function emitContextFn(
  decision: DmnDecision,
  context: DmnContext,
  allNames: string[],
  cctx: CompileContext,
): string {
  const declared = new Set<string>();
  const lines: string[] = [];
  for (const n of decision.requiredInputs) {
    const ident = toJsIdent(n);
    lines.push(`    let ${ident}: any = ctx[${JSON.stringify(n)}];`);
    declared.add(ident);
  }
  for (const n of decision.requiredDecisions) {
    const ident = toJsIdent(n);
    lines.push(`    let ${ident}: any = ctx[${JSON.stringify(n)}] !== undefined ? ctx[${JSON.stringify(n)}] : decisions[${JSON.stringify(n)}](ctx);`);
    declared.add(ident);
  }

  // Each entry's body may reference earlier entries by name. Extend the
  // visible-name list as we go so the FEEL tokenizer recognizes them, and
  // when the entry name shadows a module-scope binding (BKM, decision,
  // decision service) use a prefixed local ident so the JS `let` doesn't
  // put the module-scope reference into TDZ.
  const localNames: string[] = [...allNames];
  const localCctx: CompileContext = {
    ...cctx,
    signatures: { ...cctx.signatures },
    localBindings: { ...(cctx.localBindings ?? {}) },
  };
  for (const e of context.entries) {
    if (!e.name) continue;
    if (e.functionParameters) {
      localCctx.signatures[e.name] = e.functionParameters.map((p) => p.name);
      continue;
    }
    const text = (e.bodyText ?? '').trim();
    const fnMatch = /^function\s*\(([^)]*)\)/.exec(text);
    if (fnMatch) {
      const params = fnMatch[1]
        .split(',')
        .map((p) => p.trim().split(':')[0].trim())
        .filter((p) => p.length > 0);
      if (params.length) localCctx.signatures[e.name] = params;
    }
  }
  const namedKeys: { dmnName: string; ident: string }[] = [];
  let finalReturn: string | null = null;
  const chooseIdent = (i: number, name: string): string => {
    const base = toJsIdent(name);
    if (cctx.moduleScopeNames?.has(name)) {
      return `__local_${i}_${base}`;
    }
    return base;
  };
  for (let i = 0; i < context.entries.length; i++) {
    const e = context.entries[i];
    const body = emitContextEntryBody(e, localNames, localCctx);
    if (e.name) {
      const ident = chooseIdent(i, e.name);
      if (declared.has(ident)) {
        lines.push(`    ${ident} = ${body};`);
      } else {
        lines.push(`    let ${ident}: any = ${body};`);
        declared.add(ident);
      }
      namedKeys.push({ dmnName: e.name, ident });
      if (!localNames.includes(e.name)) localNames.push(e.name);
      // Register the binding so subsequent entries' FEEL emit resolves the
      // entry name to this local rather than the module-scope function.
      localCctx.localBindings![e.name] = ident;
    } else {
      finalReturn = body;
    }
  }
  let retExpr: string;
  if (finalReturn !== null) {
    retExpr = finalReturn;
  } else {
    const props = namedKeys
      .map((k) => `${JSON.stringify(k.dmnName)}: ${k.ident}`)
      .join(', ');
    retExpr = `{ ${props} }`;
  }
  if (decision.typeRef && (isScalarTypeRef(decision.typeRef) || cctx.validatableTypes?.has(typeRefLocal(decision.typeRef)))) {
    const isCollection = cctx.collectionTypes?.has(typeRefLocal(decision.typeRef));
    const inner = isCollection ? retExpr : `feel.singleton(${retExpr})`;
    retExpr = `feel.validate(${inner}, ${JSON.stringify(decision.typeRef)}, __itemDefs)`;
  }

  return [
    `  ${JSON.stringify(decision.name)}: (ctx) => {`,
    ...lines,
    `    return ${retExpr};`,
    `  },`,
  ].join('\n');
}

function emitInvocationFn(
  decision: DmnDecision,
  inv: DmnInvocation,
  allNames: string[],
  cctx: CompileContext,
): string {
  const inputBindings = decision.requiredInputs.map((n) => {
    const ident = toJsIdent(n);
    return `    const ${ident}: any = ctx[${JSON.stringify(n)}];`;
  });
  const decisionBindings = decision.requiredDecisions.map((n) => {
    const ident = toJsIdent(n);
    return `    const ${ident}: any = ctx[${JSON.stringify(n)}] !== undefined ? ctx[${JSON.stringify(n)}] : decisions[${JSON.stringify(n)}](ctx);`;
  });
  let expr = emitInvocationCall(inv, allNames, cctx);
  if (decision.typeRef && (isScalarTypeRef(decision.typeRef) || cctx.validatableTypes?.has(typeRefLocal(decision.typeRef)))) {
    const isCollection = cctx.collectionTypes?.has(typeRefLocal(decision.typeRef));
    const inner = isCollection ? expr : `feel.singleton(${expr})`;
    expr = `feel.validate(${inner}, ${JSON.stringify(decision.typeRef)}, __itemDefs)`;
  }
  return [
    `  ${JSON.stringify(decision.name)}: (ctx) => {`,
    ...inputBindings,
    ...decisionBindings,
    `    return ${expr};`,
    `  },`,
  ].join('\n');
}

function emitRelationFn(
  decision: DmnDecision,
  rel: DmnRelation,
  allNames: string[],
  cctx: CompileContext,
): string {
  const inputBindings = decision.requiredInputs.map((n) => {
    const ident = toJsIdent(n);
    return `    const ${ident}: any = ctx[${JSON.stringify(n)}];`;
  });
  const decisionBindings = decision.requiredDecisions.map((n) => {
    const ident = toJsIdent(n);
    return `    const ${ident}: any = ctx[${JSON.stringify(n)}] !== undefined ? ctx[${JSON.stringify(n)}] : decisions[${JSON.stringify(n)}](ctx);`;
  });
  const items = rel.rows.map((row) => {
    const props = rel.columns.map((col, i) => {
      const cell = row.cells[i];
      const v = cell ? feelExpr(cell, allNames, cctx) : 'null';
      return `${JSON.stringify(col)}: ${v}`;
    });
    return `{ ${props.join(', ')} }`;
  });
  let retExpr = `[${items.join(', ')}]`;
  if (decision.typeRef && (isScalarTypeRef(decision.typeRef) || cctx.validatableTypes?.has(typeRefLocal(decision.typeRef)))) {
    retExpr = `feel.validate(${retExpr}, ${JSON.stringify(decision.typeRef)}, __itemDefs)`;
  }
  return [
    `  ${JSON.stringify(decision.name)}: (ctx) => {`,
    ...inputBindings,
    ...decisionBindings,
    `    return ${retExpr};`,
    `  },`,
  ].join('\n');
}

function emitListFn(
  decision: DmnDecision,
  items: string[],
  allNames: string[],
  cctx: CompileContext,
): string {
  const inputBindings = decision.requiredInputs.map((n) => {
    const ident = toJsIdent(n);
    return `    const ${ident}: any = ctx[${JSON.stringify(n)}];`;
  });
  const decisionBindings = decision.requiredDecisions.map((n) => {
    const ident = toJsIdent(n);
    return `    const ${ident}: any = ctx[${JSON.stringify(n)}] !== undefined ? ctx[${JSON.stringify(n)}] : decisions[${JSON.stringify(n)}](ctx);`;
  });
  const elements = items.map((t) => (t ? feelExpr(t, allNames, cctx) : 'null'));
  let expr = `[${elements.join(', ')}]`;
  if (decision.typeRef && (isScalarTypeRef(decision.typeRef) || cctx.validatableTypes?.has(typeRefLocal(decision.typeRef)))) {
    expr = `feel.validate(${expr}, ${JSON.stringify(decision.typeRef)}, __itemDefs)`;
  }
  return [
    `  ${JSON.stringify(decision.name)}: (ctx) => {`,
    ...inputBindings,
    ...decisionBindings,
    `    return ${expr};`,
    `  },`,
  ].join('\n');
}

function emitDecisionFn(
  decision: DmnDecision,
  allNames: string[],
  cctx: CompileContext,
): string {
  if (decision.decisionTable) {
    return emitDecisionTableFn(decision, decision.decisionTable, allNames, cctx);
  }
  if (decision.context) {
    return emitContextFn(decision, decision.context, allNames, cctx);
  }
  if (decision.invocation) {
    return emitInvocationFn(decision, decision.invocation, allNames, cctx);
  }
  if (decision.relation) {
    return emitRelationFn(decision, decision.relation, allNames, cctx);
  }
  if (decision.listItems) {
    return emitListFn(decision, decision.listItems, allNames, cctx);
  }
  const inputBindings = decision.requiredInputs.map((n) => {
    const ident = toJsIdent(n);
    return `    const ${ident}: any = ctx[${JSON.stringify(n)}];`;
  });
  const decisionBindings = decision.requiredDecisions.map((n) => {
    const ident = toJsIdent(n);
    return `    const ${ident}: any = ctx[${JSON.stringify(n)}] !== undefined ? ctx[${JSON.stringify(n)}] : decisions[${JSON.stringify(n)}](ctx);`;
  });
  let expr = decision.literalExpressionText
    ? feelExpr(decision.literalExpressionText, allNames, cctx)
    : '/* TODO: non-literal expression not yet supported */ undefined';
  if (decision.typeRef && (isScalarTypeRef(decision.typeRef) || cctx.validatableTypes?.has(typeRefLocal(decision.typeRef)))) {
    const isCollection = cctx.collectionTypes?.has(typeRefLocal(decision.typeRef));
    const inner = isCollection ? expr : `feel.singleton(${expr})`;
    expr = `feel.validate(${inner}, ${JSON.stringify(decision.typeRef)}, __itemDefs)`;
  }
  return [
    `  ${JSON.stringify(decision.name)}: (ctx) => {`,
    ...inputBindings,
    ...decisionBindings,
    `    return ${expr};`,
    `  },`,
  ].join('\n');
}

function emitDecisionService(ds: DmnDecisionService, model: DmnModel): string {
  // Per DMN spec the service signature is inputData first, then input
  // decisions (DMN13-163 / table 11.5). Single-output services unwrap to
  // the single decision's value at FEEL invocation sites (DMN 1.3+
  // behavior); the test harness extracts the requested output by name.
  const inputNames = [...ds.inputData, ...ds.inputDecisions];
  const params = inputNames
    .map((n) => `${toJsIdent(n)}: any`)
    .join(', ');
  const ctxParts = inputNames
    .map((n) => `${JSON.stringify(n)}: ${toJsIdent(n)}`)
    .join(', ');
  const calls = ds.outputDecisions
    .map(
      (o) =>
        `${JSON.stringify(o)}: decisions[${JSON.stringify(o)}](__svcCtx)`,
    )
    .join(', ');
  const arity = inputNames.length;
  // DMN13-163 (DMN 1.3+): a single-output decision service unwraps to
  // the underlying decision value. Earlier versions always return a
  // context keyed by output decision name. Arity mismatches always
  // collapse to null regardless of version — this is a call-error,
  // not a normal-output state.
  const unwrapsSingle =
    ds.outputDecisions.length === 1 &&
    model.dmnVersion !== '1.1' &&
    model.dmnVersion !== '1.2';
  // Validate the unwrapped result against the service's declared typeRef
  // (only meaningful when the service unwraps to a single output).
  const wrapValidate = (expr: string) =>
    ds.typeRef && unwrapsSingle ? `feel.validate(${expr}, ${JSON.stringify(ds.typeRef)}, __itemDefs)` : expr;
  const ret = unwrapsSingle
    ? `return ${wrapValidate(`decisions[${JSON.stringify(ds.outputDecisions[0])}](__svcCtx)`)};`
    : `return { ${calls} };`;
  const nullRet = `return null;`;
  // Reject when the call shape doesn't match the declared inputs — wrong
  // arity, or any required slot left as `undefined` (vs explicit null,
  // which is a valid FEEL value).
  const undefinedCheck = inputNames.length
    ? ` || ${inputNames.map((n) => `${toJsIdent(n)} === undefined`).join(' || ')}`
    : '';
  const body = [
    `if (arguments.length !== ${arity}${undefinedCheck}) ${nullRet}`,
    `const __svcCtx: any = { ${ctxParts} };`,
    ret,
  ].join('\n  ');
  return `function ${toJsIdent(ds.name)}(${params}): any {\n  ${body}\n}`;
}

function emitBkm(
  bkm: DmnBkm,
  allNames: string[],
  cctx: CompileContext,
): string {
  const text = (bkm.bodyText ?? '').trim();
  const localNames = [...allNames, ...bkm.parameters.map((p) => p.name)];
  const params = bkm.parameters
    .map((p) => `${toJsIdent(p.name)}: any`)
    .join(', ');
  // Validate typed parameters at the boundary — if any argument fails to
  // satisfy its declared type, FEEL says the whole invocation is null.
  const paramValidations: string[] = [];
  for (const p of bkm.parameters) {
    if (p.typeRef && (isScalarTypeRef(p.typeRef) || cctx.validatableTypes?.has(typeRefLocal(p.typeRef)))) {
      const ident = toJsIdent(p.name);
      paramValidations.push(
        `if (${ident} !== undefined && ${ident} !== null && feel.validate(${ident}, ${JSON.stringify(p.typeRef)}, __itemDefs) === null) return null;`,
      );
    }
  }
  const paramValidationBlock = paramValidations.length
    ? `  ${paramValidations.join('\n  ')}\n`
    : '';
  // The body may itself be a FEEL function expression (`function(a) ...`).
  // Either way, the BKM is a callable: `bkm(...formalParams)` returns the
  // body value — which is a lambda when the body starts with `function(`.
  if (bkm.decisionTable) {
    const body = emitDecisionTableBody(bkm.decisionTable, localNames, cctx);
    return `function ${toJsIdent(bkm.name)}(${params}): any {\n${paramValidationBlock}${body.join('\n')}\n}`;
  }
  if (bkm.context) {
    const value = emitContextValue(bkm.context, localNames, cctx);
    return `function ${toJsIdent(bkm.name)}(${params}): any {\n${paramValidationBlock}    return ${value};\n}`;
  }
  if (bkm.invocation) {
    const expr = emitInvocationCall(bkm.invocation, localNames, cctx);
    return `function ${toJsIdent(bkm.name)}(${params}): any {\n${paramValidationBlock}    return ${expr};\n}`;
  }
  const body = text ? compileFeel(text, localNames, cctx) : 'undefined';
  return `function ${toJsIdent(bkm.name)}(${params}): any {\n${paramValidationBlock}  return ${body};\n}`;
}

// Where the generated index.ts should import the runtime from. The default
// (`./runtime.js`) suits a single-case package; the batch runner overrides it
// to `'../runtime.js'` so all cases share one runtime file.
export interface EmitOptions {
  runtimeImport?: string;
}

export function emitTs(model: DmnModel, opts: EmitOptions = {}): string {
  const runtimeImport = opts.runtimeImport ?? './runtime.js';
  // Include item-definition component names as known multi-word identifiers
  // so filter predicates like `Flight List[ Flight Number = ... ]` tokenize
  // `Flight Number` as a single name.
  const componentNames = new Set<string>();
  for (const it of model.itemDefinitions) {
    for (const c of it.components ?? []) componentNames.add(c.name);
  }
  const allNames = [
    ...model.inputData.map((i) => i.name),
    ...model.decisions.map((d) => d.name),
    ...model.bkms.map((b) => b.name),
    ...model.decisionServices.map((s) => s.name),
    ...componentNames,
  ];
  const cctx = buildCompileContext(model);
  // Decision-service signatures contribute to named-arg resolution. Order
  // must match `emitDecisionService` (inputData first, then inputDecisions).
  for (const ds of model.decisionServices) {
    cctx.signatures[ds.name] = [...ds.inputData, ...ds.inputDecisions];
  }
  const bkmDefs = model.bkms.map((b) => emitBkm(b, allNames, cctx));
  const decisionServiceDefs = model.decisionServices.map((ds) =>
    emitDecisionService(ds, model),
  );
  return [
    `// @generated by tom-rools — do not edit by hand`,
    `// source DMN model: ${model.name}`,
    ``,
    `import { feel } from ${JSON.stringify(runtimeImport)};`,
    ``,
    `const __itemDefs: any = ${emitItemDefsLiteral(model)};`,
    ``,
    ...bkmDefs,
    bkmDefs.length ? '' : null,
    ...decisionServiceDefs,
    decisionServiceDefs.length ? '' : null,
    `export type DecisionFn = (ctx: Record<string, unknown>) => unknown;`,
    ``,
    `export const inputDataNames: readonly string[] = ${JSON.stringify(
      model.inputData.map((i) => i.name),
    )};`,
    ``,
    `export const decisions: Record<string, DecisionFn> = {`,
    ...model.decisions.map((d) => emitDecisionFn(d, allNames, cctx)),
    `};`,
    ``,
    model.decisionServices.length
      ? `export const decisionServices: Record<string, (...args: any[]) => any> = { ${model.decisionServices.map((s) => `${JSON.stringify(s.name)}: ${toJsIdent(s.name)}`).join(', ')} };`
      : null,
    model.decisionServices.length
      ? `export const decisionServiceParams: Record<string, readonly string[]> = { ${model.decisionServices.map((s) => `${JSON.stringify(s.name)}: ${JSON.stringify([...s.inputData, ...s.inputDecisions])}`).join(', ')} };`
      : null,
    model.decisionServices.length ? '' : null,
  ]
    .filter((l): l is string => l !== null)
    .join('\n');
}
