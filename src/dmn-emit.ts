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
  const functionItems = new Map<string, { outputTypeRef?: string }>();
  for (const it of model.itemDefinitions) {
    if (it.isFunction) {
      functionItems.set(it.name, { outputTypeRef: it.functionOutputTypeRef });
    }
  }
  const inputDataTypes = new Map<string, string>();
  for (const i of model.inputData) {
    if (i.typeRef) inputDataTypes.set(i.name, i.typeRef);
  }
  return {
    signatures,
    validatableTypes,
    collectionTypes,
    moduleScopeNames,
    dmnVersion: model.dmnVersion,
    functionItems,
    inputDataTypes,
  };
}

// Build a JS-source literal describing the model's user-defined types
// (item definitions). The generated runtime helper consumes this to validate
// decision returns against allowedValues / base types.
// Build the JS-source bindings prelude shared by every decision-emit
// path (literal, table, context, invocation, relation, list). Each input
// data with a declared typeRef is validated at the boundary so a
// non-conforming value lands as null in the decision body. The `let`
// form is used for context bodies where downstream code reassigns; the
// `const` form is the default elsewhere.
function emitDecisionPrelude(
  decision: DmnDecision,
  cctx: CompileContext,
  decl: 'const' | 'let' = 'const',
): string[] {
  const lines: string[] = [];
  for (const n of decision.requiredInputs) {
    const ident = toJsIdent(n);
    const t = cctx.inputDataTypes?.get(n);
    if (
      t &&
      (isScalarTypeRef(t) || cctx.validatableTypes?.has(typeRefLocal(t)))
    ) {
      lines.push(
        `    ${decl} ${ident}: any = (() => { const __v = ctx[${JSON.stringify(n)}]; return __v === null || __v === undefined ? __v : feel.validate(__v, ${JSON.stringify(t)}, __itemDefs); })();`,
      );
    } else {
      lines.push(`    ${decl} ${ident}: any = ctx[${JSON.stringify(n)}];`);
    }
  }
  for (const n of decision.requiredDecisions) {
    const ident = toJsIdent(n);
    lines.push(
      `    ${decl} ${ident}: any = ctx[${JSON.stringify(n)}] !== undefined ? ctx[${JSON.stringify(n)}] : decisions[${JSON.stringify(n)}](ctx);`,
    );
  }
  return lines;
}

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
    if (it.isFunction) {
      fields.push('isFunction: true');
      if (it.functionOutputTypeRef)
        fields.push(`functionOutputTypeRef: ${JSON.stringify(it.functionOutputTypeRef)}`);
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
    const inputValues = table.inputs[idx]?.inputValues;
    if (inputValues && inputValues.length) {
      // `<inputValues>` constrains the input — values that don't match
      // any of the listed unary tests are coerced to null before rules
      // are evaluated. Compile each constraint as a unary-test predicate.
      const tests = inputValues
        .map((iv) => translateUnaryTest(iv, '__raw', allNames))
        .join(' || ');
      lines.push(
        `    const __in${idx}: any = (() => { const __raw: any = ${e}; return (${tests}) ? __raw : null; })();`,
      );
    } else {
      lines.push(`    const __in${idx}: any = ${e};`);
    }
  });
  lines.push(`    const __matches: any[] = [];`);
  // Wrap a compiled cell with `feel.validate(cell, typeRef)` when the
  // cell or its column declares a type. Both forms can apply — the cell
  // type, when present, takes precedence over the column type.
  const wrapCell = (oi: number, raw: string, cellTypeRef?: string): string => {
    const t = cellTypeRef ?? table.outputs[oi]?.typeRef;
    if (
      !t ||
      !(isScalarTypeRef(t) || cctx.validatableTypes?.has(typeRefLocal(t)))
    ) {
      return raw;
    }
    const isCol = cctx.collectionTypes?.has(typeRefLocal(t));
    const inner = isCol ? raw : `feel.singleton(${raw})`;
    return `feel.validate(${inner}, ${JSON.stringify(t)}, __itemDefs)`;
  };
  table.rules.forEach((rule, ri) => {
    const tests = rule.inputEntries.map((entry, idx) =>
      translateUnaryTest(entry, `__in${idx}`, allNames),
    );
    const cond = tests.length === 0 ? 'true' : tests.join(' && ');
    let outExpr: string;
    if (outputIsObject) {
      const parts = table.outputs.map((o, oi) => {
        const cell = rule.outputEntries[oi];
        const v = feelExpr(cell?.text ?? '', allNames, cctx);
        const validated = wrapCell(oi, v, cell?.typeRef);
        return `${JSON.stringify(o.name ?? `output${oi}`)}: ${validated}`;
      });
      outExpr = `{ ${parts.join(', ')} }`;
    } else {
      const cell = rule.outputEntries[0];
      const v = feelExpr(cell?.text ?? '', allNames, cctx);
      outExpr = wrapCell(0, v, cell?.typeRef);
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
  const prelude = emitDecisionPrelude(decision, cctx);
  // Wrap the decision-table body in an IIFE so we can validate its
  // return value against the decision's declared typeRef.
  const t = decision.typeRef;
  const validates =
    t &&
    (isScalarTypeRef(t) || cctx.validatableTypes?.has(typeRefLocal(t)));
  if (!validates) {
    return [
      `  ${JSON.stringify(decision.name)}: (ctx) => {`,
      ...prelude,
      ...emitDecisionTableBody(table, allNames, cctx),
      `  },`,
    ].join('\n');
  }
  const isCol = cctx.collectionTypes?.has(typeRefLocal(t!));
  const inner = isCol ? '__r' : 'feel.singleton(__r)';
  return [
    `  ${JSON.stringify(decision.name)}: (ctx) => {`,
    ...prelude,
    `    const __r: any = (() => {`,
    ...emitDecisionTableBody(table, allNames, cctx),
    `    })();`,
    `    return feel.validate(${inner}, ${JSON.stringify(t)}, __itemDefs);`,
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
// nested context). When the entry's `<variable typeRef="...">` constrains
// the value, we wrap the result with `feel.validate` so a non-conforming
// computed value lands as null in the resulting context.
function emitContextEntryBody(
  e: DmnContextEntry,
  allNames: string[],
  cctx: CompileContext,
): string {
  let body: string;
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
    const tableBody = emitDecisionTableBody(e.decisionTable, allNames, cctx);
    body = `(() => {\n${tableBody.join('\n')}\n  })()`;
  } else if (e.invocation) {
    body = emitInvocationCall(e.invocation, allNames, cctx);
  } else if (e.context) {
    body = emitContextValue(e.context, allNames, cctx);
  } else {
    body = e.bodyText ? feelExpr(e.bodyText, allNames, cctx) : 'undefined';
  }
  return maybeValidate(body, e.typeRef, cctx);
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
  // Context bodies can reassign these later (e.g. when a context entry
  // shadows the same name) so they're declared as `let`.
  for (const line of emitDecisionPrelude(decision, cctx, 'let')) {
    lines.push(line);
  }
  for (const n of decision.requiredInputs) declared.add(toJsIdent(n));
  for (const n of decision.requiredDecisions) declared.add(toJsIdent(n));

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
  const prelude = emitDecisionPrelude(decision, cctx);
  let expr = emitInvocationCall(inv, allNames, cctx);
  if (decision.typeRef && (isScalarTypeRef(decision.typeRef) || cctx.validatableTypes?.has(typeRefLocal(decision.typeRef)))) {
    const isCollection = cctx.collectionTypes?.has(typeRefLocal(decision.typeRef));
    const inner = isCollection ? expr : `feel.singleton(${expr})`;
    expr = `feel.validate(${inner}, ${JSON.stringify(decision.typeRef)}, __itemDefs)`;
  }
  return [
    `  ${JSON.stringify(decision.name)}: (ctx) => {`,
    ...prelude,
    `    return ${expr};`,
    `  },`,
  ].join('\n');
}

// Wrap a compiled value with `feel.validate` when the supplied typeRef
// is something we can check against (a scalar or a known item type).
// Used by relation cells, list elements, context entries — places where
// the typeRef is an explicit annotation, not the decision's variable.
function maybeValidate(
  expr: string,
  typeRef: string | undefined,
  cctx: CompileContext,
): string {
  if (
    !typeRef ||
    !(isScalarTypeRef(typeRef) || cctx.validatableTypes?.has(typeRefLocal(typeRef)))
  ) {
    return expr;
  }
  const isCol = cctx.collectionTypes?.has(typeRefLocal(typeRef));
  const inner = isCol ? expr : `feel.singleton(${expr})`;
  return `feel.validate(${inner}, ${JSON.stringify(typeRef)}, __itemDefs)`;
}

function emitRelationFn(
  decision: DmnDecision,
  rel: DmnRelation,
  allNames: string[],
  cctx: CompileContext,
): string {
  const prelude = emitDecisionPrelude(decision, cctx);
  const items = rel.rows.map((row) => {
    const props = rel.columns.map((col, i) => {
      const cell = row.cells[i];
      const v = cell ? feelExpr(cell.text, allNames, cctx) : 'null';
      // A cell typeRef overrides its column's typeRef.
      const cellType = cell?.typeRef ?? col.typeRef;
      const validated = maybeValidate(v, cellType, cctx);
      return `${JSON.stringify(col.name)}: ${validated}`;
    });
    return `{ ${props.join(', ')} }`;
  });
  let retExpr = `[${items.join(', ')}]`;
  retExpr = maybeValidate(retExpr, decision.typeRef, cctx);
  return [
    `  ${JSON.stringify(decision.name)}: (ctx) => {`,
    ...prelude,
    `    return ${retExpr};`,
    `  },`,
  ].join('\n');
}

function emitListFn(
  decision: DmnDecision,
  items: { text: string; typeRef?: string }[],
  allNames: string[],
  cctx: CompileContext,
): string {
  const prelude = emitDecisionPrelude(decision, cctx);
  const elements = items.map((it) => {
    const v = it.text ? feelExpr(it.text, allNames, cctx) : 'null';
    return maybeValidate(v, it.typeRef, cctx);
  });
  let expr = `[${elements.join(', ')}]`;
  expr = maybeValidate(expr, decision.typeRef, cctx);
  return [
    `  ${JSON.stringify(decision.name)}: (ctx) => {`,
    ...prelude,
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
  const prelude = emitDecisionPrelude(decision, cctx);
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
    ...prelude,
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
  // Look up declared types for each input — inputData has its own typeRef,
  // input decisions get theirs from the corresponding decision's variable.
  // At service entry we coerce each argument through `feel.validate`; a
  // mismatched value lands as null in the service's evaluation context.
  const inputTypes = new Map<string, string>();
  for (const n of ds.inputData) {
    const i = model.inputData.find((x) => x.name === n);
    if (i?.typeRef) inputTypes.set(n, i.typeRef);
  }
  for (const n of ds.inputDecisions) {
    const d = model.decisions.find((x) => x.name === n);
    if (d?.typeRef) inputTypes.set(n, d.typeRef);
  }
  // When the service's variable typeRef is a functionItem, its parameter
  // declarations override whatever types the underlying input/decision
  // happen to carry — the function signature wins at the boundary.
  if (ds.typeRef) {
    const fnItem = model.itemDefinitions.find(
      (it) => it.name === typeRefLocal(ds.typeRef!) && it.isFunction,
    );
    if (fnItem?.functionParameters) {
      for (const p of fnItem.functionParameters) {
        if (p.typeRef) inputTypes.set(p.name, p.typeRef);
      }
    }
  }
  const inputCoercions = inputNames
    .filter((n) => {
      const t = inputTypes.get(n);
      return (
        t && (isScalarTypeRef(t) || model.itemDefinitions.some((it) => it.name === typeRefLocal(t)))
      );
    })
    .map((n) => {
      const ident = toJsIdent(n);
      const t = inputTypes.get(n)!;
      // FEEL spec: a value that doesn't conform to the declared type is
      // silently coerced to null at the boundary. The singleton-list rule
      // also applies — a one-element list flowing into a scalar slot
      // unwraps to the element first.
      return `${ident} = ${ident} === null || ${ident} === undefined ? ${ident} : feel.validate(feel.singleton(${ident}), ${JSON.stringify(t)}, __itemDefs);`;
    });
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
  // Validate the result against the service's declared typeRef. When the
  // typeRef points to a `<functionItem outputTypeRef="X">` we redirect to
  // the function's *return* type (the service IS the function), otherwise
  // a non-function output would always fail validation.
  const fnDef = ds.typeRef
    ? model.itemDefinitions.find(
        (it) => it.name === typeRefLocal(ds.typeRef!) && it.isFunction,
      )
    : undefined;
  const validateType = fnDef ? fnDef.functionOutputTypeRef : ds.typeRef;
  const wrapValidate = (expr: string) =>
    validateType ? `feel.validate(${expr}, ${JSON.stringify(validateType)}, __itemDefs)` : expr;
  const ret = unwrapsSingle
    ? `return ${wrapValidate(`decisions[${JSON.stringify(ds.outputDecisions[0])}](__svcCtx)`)};`
    : `return ${wrapValidate(`{ ${calls} }`)};`;
  const nullRet = `return null;`;
  // Reject when the call shape doesn't match the declared inputs — wrong
  // arity, or any required slot left as `undefined` (vs explicit null,
  // which is a valid FEEL value).
  const undefinedCheck = inputNames.length
    ? ` || ${inputNames.map((n) => `${toJsIdent(n)} === undefined`).join(' || ')}`
    : '';
  const body = [
    `if (arguments.length !== ${arity}${undefinedCheck}) ${nullRet}`,
    ...inputCoercions,
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
  // Validate typed parameters at the boundary. DMN 1.2 silently coerces a
  // non-conforming argument to null and continues the body evaluation
  // (so e.g. `arg != null` can still observe the coerced null). DMN 1.3+
  // treats it as an error and short-circuits the whole invocation to null.
  const coerceToNull = cctx.dmnVersion === '1.1' || cctx.dmnVersion === '1.2';
  const paramValidations: string[] = [];
  for (const p of bkm.parameters) {
    if (p.typeRef && (isScalarTypeRef(p.typeRef) || cctx.validatableTypes?.has(typeRefLocal(p.typeRef)))) {
      const ident = toJsIdent(p.name);
      const onFail = coerceToNull ? `${ident} = null;` : 'return null;';
      paramValidations.push(
        `if (${ident} !== undefined && ${ident} !== null && feel.validate(${ident}, ${JSON.stringify(p.typeRef)}, __itemDefs) === null) ${onFail}`,
      );
    }
  }
  const paramValidationBlock = paramValidations.length
    ? `  ${paramValidations.join('\n  ')}\n`
    : '';
  // Wrap a body expression with the body-typeRef validation. DMN 1.2 puts
  // the type on the BKM's `<variable typeRef="...">`; DMN 1.3+ moves it
  // onto the `<literalExpression typeRef="...">`. Either way the
  // singleton-list rule applies, so `[arg]` from a `number`-typed body
  // unwraps to the scalar before validation.
  //
  // When the body type is a `<functionItem outputTypeRef="X">`, the BKM
  // itself is the function — what we actually validate is the body's
  // return value against `outputTypeRef`, not the body against the
  // function-item type (a non-function value would always fail).
  const rawBodyType = bkm.bodyTypeRef ?? bkm.typeRef;
  const bodyType = (() => {
    if (!rawBodyType) return undefined;
    const local = typeRefLocal(rawBodyType);
    const fnDef = cctx.functionItems?.get(local);
    return fnDef ? fnDef.outputTypeRef : rawBodyType;
  })();
  const wrapBody = (expr: string): string => {
    if (
      !bodyType ||
      !(isScalarTypeRef(bodyType) || cctx.validatableTypes?.has(typeRefLocal(bodyType)))
    ) {
      return expr;
    }
    const isCollection = cctx.collectionTypes?.has(typeRefLocal(bodyType));
    const inner = isCollection ? expr : `feel.singleton(${expr})`;
    return `feel.validate(${inner}, ${JSON.stringify(bodyType)}, __itemDefs)`;
  };
  // The body may itself be a FEEL function expression (`function(a) ...`).
  // Either way, the BKM is a callable: `bkm(...formalParams)` returns the
  // body value — which is a lambda when the body starts with `function(`.
  if (bkm.decisionTable) {
    const body = emitDecisionTableBody(bkm.decisionTable, localNames, cctx);
    return `function ${toJsIdent(bkm.name)}(${params}): any {\n${paramValidationBlock}${body.join('\n')}\n}`;
  }
  if (bkm.context) {
    const value = wrapBody(emitContextValue(bkm.context, localNames, cctx));
    return `function ${toJsIdent(bkm.name)}(${params}): any {\n${paramValidationBlock}    return ${value};\n}`;
  }
  if (bkm.invocation) {
    const expr = wrapBody(emitInvocationCall(bkm.invocation, localNames, cctx));
    return `function ${toJsIdent(bkm.name)}(${params}): any {\n${paramValidationBlock}    return ${expr};\n}`;
  }
  const body = text ? wrapBody(compileFeel(text, localNames, cctx)) : 'undefined';
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
