/**
 * Closed-schema validator kit (R4.3–R4.5, R4.11; KC01).
 *
 * - Objects are closed: an unknown key at any depth fails with its path.
 * - Every key is required. `nullable(s)` is the contract's `T?`: the key must be present and may hold null.
 * - Validators never throw on bad input and never modify it. Success returns the input object itself.
 * - Errors carry the path of the first offending field, e.g. `$.fieldSlices[0].end`.
 *
 * Each schema also carries a `meta` description of its shape. Production code never reads it; the test-only
 * generator in `../testing/arbitrary.ts` derives fast-check arbitraries from it, so generators and validators
 * share one definition.
 */

export interface Issue {
  path: string;
  message: string;
}

export type Validation<T> =
  | { ok: true; value: T }
  | { ok: false; error: "invalidInput"; path: string; message: string };

export type Meta =
  | { t: "str"; max: number; min: number; pattern: RegExp | undefined }
  | { t: "literal"; value: string | number | boolean }
  | { t: "oneOf"; values: readonly string[] }
  | { t: "bool" }
  | { t: "num"; min: number; max: number }
  | { t: "int"; min: number; max: number }
  | { t: "nullable"; inner: Schema<unknown> }
  | { t: "arr"; item: Schema<unknown>; min: number; max: number }
  | { t: "obj"; shape: Record<string, Schema<unknown>> }
  | { t: "union"; variants: readonly Schema<unknown>[] }
  | { t: "tagged"; key: string; variants: Record<string, Schema<unknown>> }
  | { t: "refine"; base: Schema<unknown> }
  | { t: "plainObject" }
  | { t: "lazy"; get: () => Schema<unknown> }
  | { t: "custom" };

export interface Schema<T> {
  /** Phantom field for type inference only; never set. */
  readonly __type?: T;
  readonly meta: Meta;
  check(value: unknown, path: string): Issue | null;
}

export type Infer<S> = S extends Schema<infer T> ? T : never;

function schema<T>(meta: Meta, check: (value: unknown, path: string) => Issue | null): Schema<T> {
  return { meta, check };
}

const issue = (path: string, message: string): Issue => ({ path, message });

/** Runs a schema from the root path `$`. */
export function validate<T>(s: Schema<T>, value: unknown): Validation<T> {
  let found: Issue | null;
  try {
    found = s.check(value, "$");
  } catch (error) {
    // Defensive: a validator must never throw (R4.3). Report instead.
    found = issue("$", `validator error: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (found === null) return { ok: true, value: value as T };
  return { ok: false, error: "invalidInput", path: found.path, message: found.message };
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** A schema with a hand-written check (no generator metadata). */
export function custom<T>(check: (value: unknown, path: string) => Issue | null): Schema<T> {
  return schema({ t: "custom" }, check);
}

// ---------------------------------------------------------------------------------------------
// Scalars

export interface StrOptions {
  min?: number;
  pattern?: RegExp;
  /** Describes the pattern in error messages. */
  label?: string;
}

/** `sN`: a string of at most `max` UTF-16 code units. */
export function str(max: number, opts: StrOptions = {}): Schema<string> {
  const min = opts.min ?? 0;
  return schema({ t: "str", max, min, pattern: opts.pattern }, (v, path) => {
    if (typeof v !== "string") return issue(path, "expected a string");
    if (v.length > max) return issue(path, `string longer than ${max} UTF-16 code units`);
    if (v.length < min) return issue(path, `string shorter than ${min} UTF-16 code units`);
    if (opts.pattern !== undefined && !opts.pattern.test(v)) return issue(path, `expected ${opts.label ?? "a matching string"}`);
    return null;
  });
}

export function literal<const L extends string | number | boolean>(expected: L): Schema<L> {
  return schema({ t: "literal", value: expected }, (v, path) =>
    v === expected ? null : issue(path, `expected ${JSON.stringify(expected)}`),
  );
}

/** A closed string enum. */
export function oneOf<const L extends readonly string[]>(values: L): Schema<L[number]> {
  const set = new Set<string>(values);
  return schema({ t: "oneOf", values }, (v, path) =>
    typeof v === "string" && set.has(v) ? null : issue(path, `expected one of ${values.join("|")}`),
  );
}

export const bool: Schema<boolean> = schema({ t: "bool" }, (v, path) => (typeof v === "boolean" ? null : issue(path, "expected a boolean")));

/**
 * Negative zero has no JSON form (`JSON.stringify(-0)` is `"0"`), so a record holding it could not round-trip
 * (R31.4). Numbers reject it; writers store 0 instead.
 */
const isNegativeZero = (v: number) => Object.is(v, -0);

/** Any finite number (contract `number`; "finite only"), excluding -0. */
export function num(min = -Infinity, max = Infinity): Schema<number> {
  return schema({ t: "num", min, max }, (v, path) => {
    if (typeof v !== "number" || !Number.isFinite(v)) return issue(path, "expected a finite number");
    if (isNegativeZero(v)) return issue(path, "negative zero is not allowed (no JSON form); use 0");
    if (v < min || v > max) return issue(path, `number outside [${min}, ${max}]`);
    return null;
  });
}

/** `int[a,b]`: a safe integer from a to b inclusive. */
export function int(min: number, max: number): Schema<number> {
  return schema({ t: "int", min, max }, (v, path) => {
    if (typeof v !== "number" || !Number.isSafeInteger(v)) return issue(path, "expected a safe integer");
    if (isNegativeZero(v)) return issue(path, "negative zero is not allowed (no JSON form); use 0");
    if (v < min || v > max) return issue(path, `integer outside [${min}, ${max}]`);
    return null;
  });
}

/** `i`: a nonnegative safe integer, optionally with tighter bounds. */
export const nat = (min = 0, max = Number.MAX_SAFE_INTEGER): Schema<number> => int(min, max);

/** `Signed`: any safe integer. */
export const signed: Schema<number> = int(-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);

// ---------------------------------------------------------------------------------------------
// Composites

/** `T?`: the key is required and holds T or null. */
export function nullable<T>(inner: Schema<T>): Schema<T | null> {
  return schema({ t: "nullable", inner }, (v, path) => (v === null ? null : inner.check(v, path)));
}

/** `A<T,n>` / `T[min..max]`. */
export function arr<T>(item: Schema<T>, max: number, min = 0): Schema<T[]> {
  return schema({ t: "arr", item, min, max }, (v, path) => {
    if (!Array.isArray(v)) return issue(path, "expected an array");
    if (v.length > max) return issue(path, `array longer than ${max}`);
    if (v.length < min) return issue(path, `array shorter than ${min}`);
    for (let i = 0; i < v.length; i++) {
      if (!(i in v)) return issue(`${path}[${i}]`, "sparse array hole");
      const found = item.check(v[i], `${path}[${i}]`);
      if (found !== null) return found;
    }
    return null;
  });
}

export type Shape = Record<string, Schema<unknown>>;
export type InferShape<S extends Shape> = { [K in keyof S]: Infer<S[K]> };

export interface ObjSchema<S extends Shape> extends Schema<InferShape<S>> {
  readonly shape: S;
}

/** A closed object: every key in `shape` is required; any other key fails. */
export function obj<S extends Shape>(shape: S): ObjSchema<S> {
  const keys = Object.keys(shape);
  return {
    shape,
    meta: { t: "obj", shape },
    check(v, path) {
      if (!isPlainObject(v)) return issue(path, "expected an object");
      for (const k of Object.keys(v)) {
        if (!hasOwn(shape, k)) return issue(`${path}.${k}`, "unknown key");
      }
      for (const k of keys) {
        if (!hasOwn(v, k) || v[k] === undefined) return issue(`${path}.${k}`, "missing required key");
        const found = shape[k]!.check(v[k], `${path}.${k}`);
        if (found !== null) return found;
      }
      return null;
    },
  };
}

/** Untagged union. On failure, reports the issue that got deepest into the value. */
export function union<const S extends readonly Schema<unknown>[]>(...variants: S): Schema<Infer<S[number]>> {
  return schema({ t: "union", variants }, (v, path) => {
    let best: Issue | null = null;
    for (const variant of variants) {
      const found = variant.check(v, path);
      if (found === null) return null;
      if (best === null || depth(found.path) > depth(best.path)) best = found;
    }
    return best ?? issue(path, "no union variant matched");
  });
}

/** Number of path segments below the root (`$.a[0].b` is 3). */
function depth(path: string): number {
  let n = 0;
  for (const ch of path) if (ch === "." || ch === "[") n++;
  return n;
}

/** Discriminated union on a string key (usually `kind`). */
export function tagged<const K extends string, const M extends Record<string, Schema<unknown>>>(
  key: K,
  variants: M,
): Schema<Infer<M[keyof M]>> {
  return schema({ t: "tagged", key, variants }, (v, path) => {
    if (!isPlainObject(v)) return issue(path, "expected an object");
    const tag = v[key];
    if (typeof tag !== "string" || !hasOwn(variants, tag)) {
      return issue(`${path}.${key}`, `expected one of ${Object.keys(variants).join("|")}`);
    }
    return variants[tag]!.check(v, path);
  });
}

/** Adds a cross-field rule that runs after the base schema passes. */
export function refine<T>(base: Schema<T>, rule: (value: T, path: string) => Issue | null): Schema<T> {
  return schema({ t: "refine", base }, (v, path) => base.check(v, path) ?? rule(v as T, path));
}

/**
 * Any plain object. Only for a field whose closed shape depends on a sibling (Memory `args` on `predicate`,
 * Ledger `payload` on `kind`); the parent schema's `refine` then checks it closed.
 */
export const plainObject: Schema<Record<string, unknown>> = schema({ t: "plainObject" }, (v, path) =>
  isPlainObject(v) ? null : issue(path, "expected an object"),
);

/** Defers construction, for recursive or late-bound schemas. */
export function lazy<T>(build: () => Schema<T>): Schema<T> {
  let built: Schema<T> | undefined;
  const get = () => (built ??= build());
  return schema({ t: "lazy", get }, (v, path) => get().check(v, path));
}

export { issue };
