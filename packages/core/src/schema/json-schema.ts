/**
 * Strict JSON Schema from a closed validator (contracts §5 Execution: strict json_schema, required/null keys,
 * closed objects, nested anyOf, no if/then). Built from each schema's `meta`, so the schema sent to the model and
 * the validator that checks its output share one definition. String patterns are left to the validator.
 * A `plainObject` or custom schema has no strict form; callers substitute one through `overrides`.
 */
import type { Schema } from "./v";

export type JsonSchema = Record<string, unknown>;

export function jsonSchemaOf(schema: Schema<unknown>, overrides: ReadonlyMap<Schema<unknown>, JsonSchema> = new Map()): JsonSchema {
  const go = (s: Schema<unknown>): JsonSchema => {
    const o = overrides.get(s);
    if (o !== undefined) return o;
    const m = s.meta;
    switch (m.t) {
      case "str":
        return { type: "string", maxLength: m.max, ...(m.min > 0 ? { minLength: m.min } : {}) };
      case "literal":
        return { type: typeof m.value, enum: [m.value] };
      case "oneOf":
        return { type: "string", enum: [...m.values] };
      case "bool":
        return { type: "boolean" };
      case "num":
        return { type: "number", ...(Number.isFinite(m.min) ? { minimum: m.min } : {}), ...(Number.isFinite(m.max) ? { maximum: m.max } : {}) };
      case "int":
        return { type: "integer", minimum: m.min, maximum: m.max };
      case "nullable":
        return { anyOf: [go(m.inner), { type: "null" }] };
      case "arr":
        return { type: "array", items: go(m.item), maxItems: m.max, ...(m.min > 0 ? { minItems: m.min } : {}) };
      case "obj":
        return {
          type: "object",
          additionalProperties: false,
          required: Object.keys(m.shape),
          properties: Object.fromEntries(Object.entries(m.shape).map(([k, v]) => [k, go(v)])),
        };
      case "union":
        return { anyOf: m.variants.map(go) };
      case "tagged":
        return { anyOf: Object.values(m.variants).map(go) };
      case "refine":
        return go(m.base);
      case "lazy":
        return go(m.get());
      case "plainObject":
      case "custom":
        throw new TypeError("jsonSchemaOf: open or custom schema needs an override");
    }
  };
  return go(schema);
}
