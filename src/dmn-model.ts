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
  context?: DmnContext;
  invocation?: DmnInvocation;
  relation?: DmnRelation;
  // Boxed `<dmn:list>` body — list of literal expressions whose values form
  // the list elements at runtime.
  listItems?: string[];
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
  // One literal-expression text per column, in column order. Empty rows
  // (or missing cells) become null in the emitted output.
  cells: string[];
}

export interface DmnRelation {
  columns: string[];
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

export interface DmnModel {
  name: string;
  inputData: DmnInputData[];
  decisions: DmnDecision[];
  bkms: DmnBkm[];
  decisionServices: DmnDecisionService[];
  itemDefinitions: DmnItemDefinition[];
  // DMN spec version detected from the model's `xmlns` (e.g. '1.2', '1.3').
  // Some semantics differ across versions — most notably DMN13-163 which
  // changed how single-output decision services unwrap.
  dmnVersion: DmnVersion;
}
