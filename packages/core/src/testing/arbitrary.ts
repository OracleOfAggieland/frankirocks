/**
 * fast-check arbitraries derived from the closed schemas (test support for R31.4).
 * Generators follow the schema's own description (`Schema.meta`), so a field added to a schema is generated
 * automatically. Shapes whose validity depends on sibling fields get explicit overrides:
 *   - TS, Civil, CivilDate and Zone (format plus calendar/IANA checks)
 *   - Memory (args, value and kind depend on predicate)
 *   - Ledger (payload depends on kind; a request's response depends on route)
 * Every other refinement is met by filtering at the refined node, never at the root.
 */
import fc from "fast-check";
import { PREDICATE_SPECS } from "../schema/predicates";
import { Civil, CivilDate, PREDICATES, TS, Value, Zone, tsFromMs } from "../schema/primitives";
import { LEDGER_PAYLOADS, Ledger, Memory, MemoryShape } from "../schema/records";
import { RESPONSE_BY_ROUTE } from "../schema/wire";
import { WebCitationUrl } from "../web-citation";
import { type ObjSchema, type Schema, type Shape, obj } from "../schema/v";

type Overrides = Map<Schema<unknown>, () => fc.Arbitrary<unknown>>;

/** Bounds generated sizes so properties stay fast; lower bounds are always met. */
const MAX_EXTRA_ITEMS = 3;
const MAX_STRING_UNITS = 24;

const MIN_MS = Date.UTC(1990, 0, 1);
const MAX_MS = Date.UTC(2100, 0, 1);
const ZONES = ["UTC", "America/Chicago", "America/New_York", "Europe/London", "Asia/Kolkata", "Australia/Lord_Howe", "Pacific/Chatham"];

const tsArb = fc.integer({ min: MIN_MS, max: MAX_MS }).map(tsFromMs);
const civilDateArb = tsArb.map((ts) => ts.slice(0, 10));
const civilArb = fc.oneof(civilDateArb, tsArb.map((ts) => ts.slice(0, 16)), tsArb.map((ts) => ts.slice(0, 19)));

function stringArb(max: number, min: number, pattern: RegExp | undefined): fc.Arbitrary<string> {
  if (pattern !== undefined) {
    return fc.stringMatching(pattern).filter((s) => s.length >= min && s.length <= max);
  }
  // Any code points, including astral ones and lone surrogates; JSON keeps both.
  const maxCodePoints = Math.max(min, Math.min(MAX_STRING_UNITS, Math.floor(max / 2)));
  return fc.string({ unit: "binary", minLength: min, maxLength: maxCodePoints }).filter((s) => s.length >= min && s.length <= max);
}

function memoryArb(get: (s: Schema<unknown>) => fc.Arbitrary<unknown>): fc.Arbitrary<unknown> {
  const { args: _a, value: _v, kind: _k, predicate: _p, ...rest } = MemoryShape;
  const base = get(obj(rest));
  return fc.constantFrom(...PREDICATES).chain((predicate) => {
    const spec = PREDICATE_SPECS[predicate];
    const valueArb = get(Value).filter((v) => {
      const value = v as { kind: string; code?: string };
      if (!spec.values.includes(value.kind as never)) return false;
      return value.kind !== "enum" || spec.codes === undefined || spec.codes.includes(value.code!);
    });
    const enumValue = spec.codes !== undefined ? fc.constantFrom(...spec.codes).map((code) => ({ kind: "enum", code })) : null;
    return fc.record({
      base,
      args: get(spec.args),
      value: enumValue ?? valueArb,
      kind: fc.constantFrom(...spec.kinds),
    }).map(({ base, args, value, kind }) => ({ ...(base as object), predicate, args, value, kind }));
  });
}

function ledgerArb(get: (s: Schema<unknown>) => fc.Arbitrary<unknown>): fc.Arbitrary<unknown> {
  const ledgerBase = (Ledger.meta as { t: "refine"; base: ObjSchema<Shape> }).base;
  const { kind: _k, payload: _p, ...rest } = ledgerBase.shape;
  const base = get(obj(rest));
  const kinds = Object.keys(LEDGER_PAYLOADS) as (keyof typeof LEDGER_PAYLOADS)[];
  const { response: _r, ...requestRest } = LEDGER_PAYLOADS.request.shape;
  const requestArb = get(obj(requestRest)).chain((p) => {
    const request = p as { route: keyof typeof RESPONSE_BY_ROUTE };
    return fc.option(get(RESPONSE_BY_ROUTE[request.route]), { nil: null }).map((response) => ({ ...request, response }));
  });
  return fc.constantFrom(...kinds).chain((kind) => {
    const payload = kind === "request" ? requestArb : get(LEDGER_PAYLOADS[kind]);
    return fc.record({ base, payload }).map(({ base, payload }) => ({ ...(base as object), kind, payload }));
  });
}

export function arbitraryFor<T>(root: Schema<T>, extra: Overrides = new Map()): fc.Arbitrary<T> {
  const cache = new Map<Schema<unknown>, fc.Arbitrary<unknown>>();
  const overrides: Overrides = new Map<Schema<unknown>, () => fc.Arbitrary<unknown>>([
    [TS, () => tsArb],
    [Civil, () => civilArb],
    [CivilDate, () => civilDateArb],
    [Zone, () => fc.constantFrom(...ZONES)],
    [WebCitationUrl, () => fc.webUrl()],
    [Memory, () => memoryArb(get)],
    [Ledger, () => ledgerArb(get)],
    ...extra,
  ]);

  function get(s: Schema<unknown>): fc.Arbitrary<unknown> {
    const hit = cache.get(s);
    if (hit !== undefined) return hit;
    const built = build(s);
    cache.set(s, built);
    return built;
  }

  function build(s: Schema<unknown>): fc.Arbitrary<unknown> {
    const override = overrides.get(s);
    if (override !== undefined) return override();
    const m = s.meta;
    switch (m.t) {
      case "str":
        return stringArb(m.max, m.min, m.pattern);
      case "literal":
        return fc.constant(m.value);
      case "oneOf":
        return fc.constantFrom(...m.values);
      case "bool":
        return fc.boolean();
      // Numbers go through the validator's own check, so the generator never yields what the schema rejects.
      case "num":
        return fc
          .double({ min: Number.isFinite(m.min) ? m.min : -1e12, max: Number.isFinite(m.max) ? m.max : 1e12, noNaN: true, noDefaultInfinity: true })
          .filter((v) => s.check(v, "$") === null);
      case "int":
        return fc
          .oneof(fc.constantFrom(m.min, m.max), fc.integer({ min: Math.max(m.min, Number.MIN_SAFE_INTEGER), max: m.max }))
          .filter((v) => s.check(v, "$") === null);
      case "nullable":
        return fc.option(get(m.inner), { nil: null });
      case "arr":
        return fc.array(get(m.item), { minLength: m.min, maxLength: Math.min(m.max, m.min + MAX_EXTRA_ITEMS) });
      case "obj": {
        const record: Record<string, fc.Arbitrary<unknown>> = {};
        for (const [k, v] of Object.entries(m.shape)) record[k] = get(v);
        // Stored and wire values come from JSON or Firestore, which never build null-prototype objects.
        return fc.record(record, { noNullPrototype: true });
      }
      case "union":
        return fc.oneof(...m.variants.map(get));
      case "tagged":
        return fc.oneof(...Object.values(m.variants).map(get));
      case "refine":
        return get(m.base).filter((v) => s.check(v, "$") === null);
      case "lazy":
        return get(m.get());
      case "plainObject":
      case "custom":
        throw new Error(`arbitraryFor: no generator for a ${m.t} schema; add an override`);
    }
  }

  return get(root) as fc.Arbitrary<T>;
}
