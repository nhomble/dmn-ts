// Helpers for inspecting DMN/FEEL `typeRef` strings — used by the emitter
// to decide when a return value needs runtime validation, and what scalar
// FEEL type a reference resolves to.

// FEEL's built-in scalar / temporal types. The DMN spec uses both the
// camelCase `dateTime` and the spelled-out `date and time`; both refer to
// the same domain.
export const SCALAR_FEEL_TYPES: ReadonlySet<string> = new Set([
  'string',
  'number',
  'boolean',
  'date',
  'time',
  'dateTime',
  'date and time',
  'duration',
  'years and months duration',
  'days and time duration',
  'any',
]);

// Strip an optional namespace prefix (`feel:string` → `string`,
// `kie:tFlight` → `tFlight`). DMN models often namespace `typeRef` values
// against the FEEL namespace or the model's own.
export function typeRefLocal(typeRef: string): string {
  return typeRef.includes(':') ? typeRef.split(':').pop()! : typeRef;
}

// Whether the typeRef names a FEEL primitive — the only case where the
// emitter can validate without consulting the user's item-definition map.
export function isScalarTypeRef(typeRef?: string): boolean {
  if (!typeRef) return false;
  return SCALAR_FEEL_TYPES.has(typeRefLocal(typeRef));
}
