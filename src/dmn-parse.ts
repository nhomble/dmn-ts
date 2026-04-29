// DMN XML → `DmnModel`. Pure transformation: no FEEL compilation, no TS
// emission. The output of `parseDmn` is a fully-resolved data structure
// (hrefs resolved to names, boxed-expression sub-trees translated to FEEL
// text) that the emitter consumes without further XML knowledge.

import { XMLParser } from 'fast-xml-parser';
import type {
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
} from './dmn-model.js';

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
      'contextEntry',
      'binding',
      'column',
      'row',
      'decisionService',
      'outputDecision',
      'inputDecision',
      'itemDefinition',
      'itemComponent',
      'import',
    ].includes(name),
});

function arr<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

// Map a DMN root `xmlns` URL to a version label. Each spec release uses a
// different dated namespace URL — match against the YYYYMMDD fragment.
export function detectDmnVersion(xml: string): DmnModel['dmnVersion'] {
  const xmlnsMatch = /xmlns(?::[^=]+)?="([^"]*DMN[^"]*)"/.exec(xml);
  const ns = xmlnsMatch?.[1] ?? '';
  if (/20151101/.test(ns)) return '1.1';
  if (/20180521/.test(ns)) return '1.2';
  if (/20191111/.test(ns)) return '1.3';
  if (/20211108/.test(ns)) return '1.4';
  if (/20240513|20230324|20240324/.test(ns)) return '1.5';
  return 'unknown';
}

// Splits a string on top-level commas (skipping commas inside strings,
// parens, brackets). Used by both the DMN parser (to split allowed-values
// lists, output-values lists) and the emitter (to translate decision-table
// input entries with comma-separated alternatives).
export function splitTopLevelCommas(s: string): string[] {
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

// Translate a boxed `<functionDefinition>` (which may itself nest more
// `<functionDefinition>`s for currying) into FEEL `function(...)` text.
// Parameter typeRefs (`<formalParameter typeRef="...">`) are preserved
// as `: typeRef` annotations so the FEEL parser can hand them to the
// emitter for boundary validation.
function functionDefToFeelText(fd: any): string {
  const fdParams = arr<any>(fd.formalParameter)
    .filter((p) => typeof p['@_name'] === 'string')
    .map((p) => {
      const name = p['@_name'];
      const t = p['@_typeRef'];
      return t ? `${name}: ${t}` : name;
    });
  let body: string;
  if (fd.functionDefinition) {
    body = functionDefToFeelText(fd.functionDefinition);
  } else {
    body = fd.literalExpression?.text ?? 'null';
  }
  return `function(${fdParams.join(', ')}) ${body}`;
}

// Extract the FEEL-text body of a boxed sub-expression element. The DMN
// schema uses literalExpression most often, but the same slot can carry
// any expression form — we recurse into those by re-using the relevant
// translators.
function boxedExprText(node: any): string {
  if (!node) return 'null';
  if (node.literalExpression?.text != null) return String(node.literalExpression.text);
  if (node.functionDefinition) return functionDefToFeelText(node.functionDefinition);
  if (node.some) return quantifiedToFeelText(node.some, 'some');
  if (node.every) return quantifiedToFeelText(node.every, 'every');
  if (node.for) return forBoxedToFeelText(node.for);
  if (node.filter) return filterBoxedToFeelText(node.filter);
  if (node.conditional) return conditionalBoxedToFeelText(node.conditional);
  if (node.list) {
    const items = arr<any>(node.list.literalExpression).map((le) =>
      String(le?.text ?? 'null'),
    );
    return `[${items.join(', ')}]`;
  }
  return 'null';
}

function quantifiedToFeelText(node: any, kw: 'some' | 'every'): string {
  const v = node['@_iteratorVariable'] ?? 'item';
  const inExpr = boxedExprText(node.in);
  const sat = boxedExprText(node.satisfies);
  return `${kw} ${v} in (${inExpr}) satisfies (${sat})`;
}

function forBoxedToFeelText(node: any): string {
  const v = node['@_iteratorVariable'] ?? 'item';
  const inExpr = boxedExprText(node.in);
  const ret = boxedExprText(node.return);
  return `for ${v} in (${inExpr}) return (${ret})`;
}

function filterBoxedToFeelText(node: any): string {
  const inExpr = boxedExprText(node.in);
  const match = boxedExprText(node.match);
  return `(${inExpr})[${match}]`;
}

function conditionalBoxedToFeelText(node: any): string {
  const cond = boxedExprText(node.if);
  const thenE = boxedExprText(node.then);
  const elseE = boxedExprText(node.else);
  return `if (${cond}) then (${thenE}) else (${elseE})`;
}

function parseRelationXml(rel: any): DmnRelation {
  const columns = arr<any>(rel.column).map((c) => ({
    name: c['@_name'] ?? '',
    typeRef: c['@_typeRef'],
  }));
  const rows: DmnRelationRow[] = arr<any>(rel.row).map((r) => ({
    cells: arr<any>(r.literalExpression).map((le) => ({
      text: String(le?.text ?? ''),
      typeRef: le?.['@_typeRef'],
    })),
  }));
  return { columns, rows };
}

function parseInvocationXml(inv: any): DmnInvocation {
  const bindings: DmnInvocationBinding[] = arr<any>(inv.binding).map((b) => ({
    name: b.parameter?.['@_name'] ?? '',
    typeRef: b.parameter?.['@_typeRef'],
    bodyText: b.literalExpression?.text,
  }));
  return {
    fnText: inv.literalExpression?.text,
    bindings,
  };
}

function parseContextXml(ctx: any): DmnContext {
  const entries: DmnContextEntry[] = arr<any>(ctx.contextEntry).map(parseContextEntryXml);
  return { entries };
}

function parseContextEntryXml(e: any): DmnContextEntry {
  const out: DmnContextEntry = {
    name: e.variable?.['@_name'],
    typeRef: e.variable?.['@_typeRef'],
  };
  if (e.functionDefinition) {
    const fd = e.functionDefinition;
    out.bodyText = fd.literalExpression?.text;
    out.functionParameters = arr<any>(fd.formalParameter).map((p) => ({
      name: p['@_name'],
      typeRef: p['@_typeRef'],
    }));
    return out;
  }
  if (e.decisionTable) {
    out.decisionTable = parseDecisionTableXml(e.decisionTable);
    return out;
  }
  if (e.invocation) {
    out.invocation = parseInvocationXml(e.invocation);
    return out;
  }
  if (e.context) {
    out.context = parseContextXml(e.context);
    return out;
  }
  out.bodyText = e.literalExpression?.text;
  return out;
}

function parseDecisionTableXml(dt: any): DmnDecisionTable {
  const inputs: DmnDecisionTableInput[] = arr<any>(dt.input).map((i) => {
    const ivText: string | undefined = i.inputValues?.text;
    return {
      text: i.inputExpression?.text ?? '',
      inputValues: ivText
        ? splitTopLevelCommas(String(ivText)).map((s) => s.trim())
        : undefined,
    };
  });
  const outputs: DmnDecisionTableOutput[] = arr<any>(dt.output).map((o) => {
    const ovText: string | undefined = o.outputValues?.text;
    const outputValues = ovText
      ? parseOutputValuesList(String(ovText))
      : undefined;
    return {
      name: o['@_name'],
      typeRef: o['@_typeRef'],
      outputValues,
      defaultText: o.defaultOutputEntry?.text,
    };
  });
  const rules: DmnDecisionTableRule[] = arr<any>(dt.rule).map((r) => ({
    inputEntries: arr<any>(r.inputEntry).map((e) => String(e?.text ?? '')),
    outputEntries: arr<any>(r.outputEntry).map((e) => ({
      text: String(e?.text ?? ''),
      typeRef: e?.['@_typeRef'],
    })),
  }));
  return {
    hitPolicy: dt['@_hitPolicy'] ?? 'UNIQUE',
    aggregation: dt['@_aggregation'],
    inputs,
    outputs,
    rules,
  };
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

// When provided, the parser treats a namespace-qualified href
// (`http://…#_id`) by looking up `_id` in the matching namespace's id map
// instead of leaving the bare id as the resolved name. The runner builds
// this from sibling models before parsing the host.
export interface ParseOptions {
  externalIds?: Map<string, Map<string, string>>;
}

export function parseDmn(xml: string, opts: ParseOptions = {}): DmnModel {
  const parsed = xmlParser.parse(xml);
  const defs = parsed.definitions;
  if (!defs) throw new Error('No <definitions> root element');

  const dmnVersion = detectDmnVersion(xml);

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
    let bodyText: string | undefined = enc?.literalExpression?.text;
    // A boxed `<functionDefinition>` body is the FEEL-text equivalent of an
    // anonymous `function(p1, ...) <body>` expression. Nested definitions
    // produce curried lambdas.
    if (!bodyText && enc?.functionDefinition) {
      bodyText = functionDefToFeelText(enc.functionDefinition);
    }
    // Body-level typeRef constrains the BKM's return value at call time.
    const bodyTypeRef: string | undefined =
      enc?.literalExpression?.['@_typeRef'] ?? enc?.['@_typeRef'];
    const bkmTable = enc?.decisionTable
      ? parseDecisionTableXml(enc.decisionTable)
      : undefined;
    const bkmContext = enc?.context ? parseContextXml(enc.context) : undefined;
    const bkmInvocation = enc?.invocation
      ? parseInvocationXml(enc.invocation)
      : undefined;
    return {
      id: n['@_id'],
      name: n['@_name'],
      typeRef: n.variable?.['@_typeRef'],
      bodyTypeRef,
      parameters,
      bodyText,
      decisionTable: bkmTable,
      context: bkmContext,
      invocation: bkmInvocation,
    };
  });

  // Build a namespace → alias map from this model's `<import>` elements
  // so cross-namespace hrefs can be qualified with the import alias.
  const importsRaw = arr<any>(defs.import).map((n) => ({
    name: n['@_name'] ?? '',
    namespace: n['@_namespace'] ?? '',
  }));
  const aliasByNs = new Map<string, string>();
  for (const i of importsRaw) {
    if (i.namespace && i.name) aliasByNs.set(i.namespace, i.name);
  }

  const resolveHref = (href: string): string => {
    // Hrefs may be local (`#_id`) or namespace-qualified
    // (`http://…#_id`); the part after the `#` is always the local ID.
    const hashIdx = href.indexOf('#');
    const id = hashIdx >= 0 ? href.slice(hashIdx + 1) : href;
    if (hashIdx > 0) {
      const ns = href.slice(0, hashIdx);
      // Cross-namespace href: resolve the id in the imported model's
      // map and qualify the result with the import alias so it lines
      // up with the names produced by `mergeImport` later.
      if (ns !== defs['@_namespace']) {
        const externalMap = opts.externalIds?.get(ns);
        const localName = externalMap?.get(id);
        if (localName) {
          const alias = aliasByNs.get(ns);
          return alias ? `${alias}.${localName}` : localName;
        }
      }
    }
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
    let literalExpressionText: string | undefined =
      n.literalExpression?.text ?? undefined;
    // Boxed `<functionDefinition>` decision body — the decision IS a lambda.
    if (!literalExpressionText && n.functionDefinition) {
      literalExpressionText = functionDefToFeelText(n.functionDefinition);
    }
    // Boxed quantified expressions `<some>` / `<every>` (DMN 1.4+).
    if (!literalExpressionText && (n.some || n.every)) {
      literalExpressionText = quantifiedToFeelText(n.some ?? n.every, n.some ? 'some' : 'every');
    }
    // Boxed `<for>` and `<filter>` follow the same shape and translate to
    // their FEEL textual forms.
    if (!literalExpressionText && n.for) {
      literalExpressionText = forBoxedToFeelText(n.for);
    }
    if (!literalExpressionText && n.filter) {
      literalExpressionText = filterBoxedToFeelText(n.filter);
    }
    if (!literalExpressionText && n.conditional) {
      literalExpressionText = conditionalBoxedToFeelText(n.conditional);
    }

    const decisionTable = n.decisionTable
      ? parseDecisionTableXml(n.decisionTable)
      : undefined;
    const context: DmnContext | undefined = n.context
      ? parseContextXml(n.context)
      : undefined;
    const invocation: DmnInvocation | undefined = n.invocation
      ? parseInvocationXml(n.invocation)
      : undefined;
    const relation: DmnRelation | undefined = n.relation
      ? parseRelationXml(n.relation)
      : undefined;
    const listItems = n.list?.literalExpression
      ? arr<any>(n.list.literalExpression).map((le) => ({
          text: String(le?.text ?? ''),
          typeRef: le?.['@_typeRef'],
        }))
      : undefined;
    return {
      id: n['@_id'],
      name: n['@_name'],
      typeRef: n.variable?.['@_typeRef'],
      requiredInputs,
      requiredDecisions,
      literalExpressionText,
      decisionTable,
      context,
      invocation,
      relation,
      listItems,
    };
  });

  const decisionServiceRaw = arr<any>(defs.decisionService);
  const decisionServices: DmnDecisionService[] = decisionServiceRaw.map((n) => ({
    id: n['@_id'],
    name: n['@_name'],
    typeRef: n.variable?.['@_typeRef'],
    outputDecisions: arr<any>(n.outputDecision)
      .map((o) => resolveHref(o['@_href'] ?? ''))
      .filter((s) => s),
    inputDecisions: arr<any>(n.inputDecision)
      .map((o) => resolveHref(o['@_href'] ?? ''))
      .filter((s) => s),
    inputData: arr<any>(n.inputData)
      .map((o) => resolveHref(o['@_href'] ?? ''))
      .filter((s) => s),
  }));

  const itemDefinitionRaw = arr<any>(defs.itemDefinition);
  const itemDefinitions: DmnItemDefinition[] = itemDefinitionRaw.map((n) => {
    const ovText: string | undefined = n.allowedValues?.text;
    const fi = n.functionItem;
    return {
      name: n['@_name'] ?? '',
      typeRef: n.typeRef ?? n.typeRef?.['#text'],
      isCollection: n['@_isCollection'] === 'true',
      // Keep entries as raw FEEL unary-test text so the emitter can compile
      // ranges, comparisons, and quoted literals uniformly.
      allowedValues: ovText
        ? splitTopLevelCommas(String(ovText)).map((s) => s.trim())
        : undefined,
      components: arr<any>(n.itemComponent).map((c) => ({
        name: c['@_name'] ?? '',
        typeRef: c.typeRef ?? c.typeRef?.['#text'],
        isCollection: c['@_isCollection'] === 'true',
      })),
      isFunction: !!fi,
      functionOutputTypeRef: fi?.['@_outputTypeRef'],
      functionParameters: fi
        ? arr<any>(fi.parameters).map((p) => ({
            name: p['@_name'] ?? '',
            typeRef: p['@_typeRef'],
          }))
        : undefined,
    };
  });

  const imports = importsRaw;

  return {
    name: defs['@_name'] ?? 'model',
    namespace: defs['@_namespace'],
    inputData,
    decisions,
    bkms,
    decisionServices,
    itemDefinitions,
    imports,
    idMap: idToName,
    dmnVersion,
  };
}

// Replace every occurrence of `oldName` with `newName` in `text`,
// matching only at FEEL-name boundaries (whitespace / punctuation) and
// skipping the contents of string literals. Used when prefixing
// imported items so references inside their bodies pick up the new
// qualified name without mangling string contents like "Hello, World".
function rewriteName(text: string, oldName: string, newName: string): string {
  let out = '';
  let i = 0;
  const isBoundary = (c: string | undefined) =>
    c === undefined || /[^A-Za-z0-9_]/.test(c);
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      // Copy the whole string literal verbatim, honouring `\` escapes.
      out += c;
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < text.length) {
          out += text[i] + text[i + 1];
          i += 2;
          continue;
        }
        out += text[i];
        i++;
      }
      if (i < text.length) {
        out += text[i];
        i++;
      }
      continue;
    }
    if (
      text.startsWith(oldName, i) &&
      isBoundary(text[i - 1]) &&
      isBoundary(text[i + oldName.length])
    ) {
      out += newName;
      i += oldName.length;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

// Inline an imported model into the host: every BKM / decision / item
// definition from `imported` is added to `host` under the qualified name
// `<alias>.<name>`. Body references to the renamed names are rewritten so
// transitive imports keep pointing at the right item after the merge.
export function mergeImport(
  host: DmnModel,
  alias: string,
  imported: DmnModel,
): void {
  const prefix = `${alias}.`;
  const rename = (name: string) => `${prefix}${name}`;
  // Names whose references inside imported bodies need to track the
  // rename. Item definitions only show up as typeRefs (handled below).
  const referenceNames = new Set<string>([
    ...imported.bkms.map((b) => b.name),
    ...imported.decisions.map((d) => d.name),
    ...imported.inputData.map((i) => i.name),
    ...imported.decisionServices.map((s) => s.name),
  ]);
  // Sort longest-first so a rename of `A.B` doesn't accidentally consume
  // a substring of `A.B.C`.
  const sortedRefs = [...referenceNames].sort((a, b) => b.length - a.length);
  const rewrite = (text: string | undefined): string | undefined => {
    if (!text) return text;
    let out = text;
    for (const n of sortedRefs) out = rewriteName(out, n, rename(n));
    return out;
  };
  const rewriteTypeRef = (t: string | undefined): string | undefined => {
    if (!t) return t;
    const local = t.includes(':') ? t.split(':').pop()! : t;
    return imported.itemDefinitions.some((it) => it.name === local)
      ? rename(local)
      : t;
  };
  for (const it of imported.itemDefinitions) {
    host.itemDefinitions.push({
      ...it,
      name: rename(it.name),
      typeRef: rewriteTypeRef(it.typeRef),
      components: it.components?.map((c) => ({
        ...c,
        typeRef: rewriteTypeRef(c.typeRef),
      })),
    });
  }
  for (const b of imported.bkms) {
    host.bkms.push({
      ...b,
      name: rename(b.name),
      typeRef: rewriteTypeRef(b.typeRef),
      bodyText: rewrite(b.bodyText),
      parameters: b.parameters.map((p) => ({
        ...p,
        typeRef: rewriteTypeRef(p.typeRef),
      })),
    });
  }
  for (const d of imported.decisions) {
    host.decisions.push({
      ...d,
      name: rename(d.name),
      typeRef: rewriteTypeRef(d.typeRef),
      requiredInputs: d.requiredInputs.map(rename),
      requiredDecisions: d.requiredDecisions.map(rename),
      literalExpressionText: rewrite(d.literalExpressionText),
    });
  }
  for (const i of imported.inputData) {
    host.inputData.push({
      ...i,
      name: rename(i.name),
      typeRef: rewriteTypeRef(i.typeRef),
    });
  }
  for (const ds of imported.decisionServices) {
    host.decisionServices.push({
      ...ds,
      name: rename(ds.name),
      typeRef: rewriteTypeRef(ds.typeRef),
      outputDecisions: ds.outputDecisions.map(rename),
      inputDecisions: ds.inputDecisions.map(rename),
      inputData: ds.inputData.map(rename),
    });
  }
}
