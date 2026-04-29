// Type definitions for the parsed DMN model. The shape produced by
// `parseDmn` and consumed by `emitTs` — neither side depends on XML or
// TypeScript-emit concerns directly, this file is the contract between
// them.

export interface DmnInputData {
  id?: string;
  name: string;
  typeRef?: string;
}

export interface DmnDecisionTableInput {
  text: string;
  // Optional `<inputValues>` constraint — same syntax as a unary-test list
  // (`"foo", "bar"`, `[1..10]`, etc.). At evaluation time the input value
  // is checked against the constraint; any non-conforming value is
  // coerced to null before the rules see it.
  inputValues?: string[];
}

export interface DmnDecisionTableOutput {
  name?: string;
  typeRef?: string;
  outputValues?: string[];
  // FEEL expression to use when no rule matches (`<defaultOutputEntry>`).
  defaultText?: string;
}

export interface DmnDecisionTableRule {
  inputEntries: string[];
  // Each output cell carries its FEEL text plus an optional cell-level
  // typeRef. The `<outputEntry typeRef="...">` form constrains the cell
  // value to the named type — non-conforming text resolves to null.
  outputEntries: { text: string; typeRef?: string }[];
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
  context?: DmnContext;
  invocation?: DmnInvocation;
  relation?: DmnRelation;
  // Boxed `<dmn:list>` body — list of literal expressions whose values
  // form the list elements at runtime. Each item carries optional
  // cell-level typeRef.
  listItems?: { text: string; typeRef?: string }[];
}

export interface DmnBkmParameter {
  name: string;
  typeRef?: string;
}

export interface DmnBkm {
  id?: string;
  name: string;
  typeRef?: string;
  // Optional `<literalExpression typeRef="...">` typeRef on the body —
  // distinct from the BKM variable's typeRef; constrains the return value
  // (with the FEEL singleton-list unwrap rule applied).
  bodyTypeRef?: string;
  parameters: DmnBkmParameter[];
  bodyText?: string;
  decisionTable?: DmnDecisionTable;
  context?: DmnContext;
  invocation?: DmnInvocation;
}

export interface DmnInvocationBinding {
  name: string;
  // Optional `<parameter typeRef="...">` constrains what flows into the
  // bound formal parameter; the bound expression is validated against it.
  typeRef?: string;
  bodyText?: string;
}

export interface DmnInvocation {
  fnText?: string;
  bindings: DmnInvocationBinding[];
}

export interface DmnRelationRow {
  // One cell per column, in column order. Each cell carries its FEEL text
  // plus an optional cell-level typeRef. Missing cells become null.
  cells: { text: string; typeRef?: string }[];
}

export interface DmnRelationColumn {
  name: string;
  // Optional `<column typeRef="...">` — applies to every cell in the
  // column unless the cell itself overrides with its own typeRef.
  typeRef?: string;
}

export interface DmnRelation {
  columns: DmnRelationColumn[];
  rows: DmnRelationRow[];
}

export interface DmnContextEntry {
  name?: string;
  typeRef?: string;
  bodyText?: string;
  // When the entry is a function definition, the JS we emit is an arrow
  // function with these parameters and the bodyText as its body.
  functionParameters?: DmnBkmParameter[];
  // Alternative entry-body forms.
  decisionTable?: DmnDecisionTable;
  invocation?: DmnInvocation;
  context?: DmnContext;
}

export interface DmnContext {
  entries: DmnContextEntry[];
}

export interface DmnItemDefinition {
  name: string;
  typeRef?: string;
  isCollection: boolean;
  allowedValues?: string[];
  components?: { name: string; typeRef?: string; isCollection?: boolean }[];
  // `<functionItem outputTypeRef="...">` declares this type as a callable
  // returning that type. A non-function value being validated against such
  // a typeRef is rejected (returns null).
  isFunction?: boolean;
  functionOutputTypeRef?: string;
  // `<parameters name="..." typeRef="...">` on a functionItem declares the
  // parameter shape. Used at decision-service entry to validate each input
  // against its declared type when the service's typeRef is a functionItem.
  functionParameters?: { name: string; typeRef?: string }[];
}

export interface DmnDecisionService {
  id?: string;
  name: string;
  // Optional return-value type from `<variable typeRef="...">`. When set,
  // the service result is validated against this type at the boundary.
  typeRef?: string;
  outputDecisions: string[];
  inputDecisions: string[];
  inputData: string[];
}

export type DmnVersion = '1.1' | '1.2' | '1.3' | '1.4' | '1.5' | 'unknown';

export interface DmnImport {
  // Local alias used to qualify references (`<alias>.<name>`).
  name: string;
  // Namespace URL of the imported model — matched against the imported
  // file's `<definitions namespace="...">` to find the right sibling.
  namespace: string;
}

export interface DmnModel {
  name: string;
  // Optional namespace URL — used to resolve local-href references and
  // to match against sibling models' import declarations.
  namespace?: string;
  inputData: DmnInputData[];
  decisions: DmnDecision[];
  bkms: DmnBkm[];
  decisionServices: DmnDecisionService[];
  itemDefinitions: DmnItemDefinition[];
  imports: DmnImport[];
  // ID → name map collected during parse. Cross-namespace href resolution
  // (when `<import>` brings in another model) consults the imported
  // model's idMap to translate `<requiredDecision href="…#_id">` into
  // the imported decision's name.
  idMap: Map<string, string>;
  // DMN spec version detected from the model's `xmlns` (e.g. '1.2', '1.3').
  // Some semantics differ across versions — most notably DMN13-163 which
  // changed how single-output decision services unwrap.
  dmnVersion: DmnVersion;
}
