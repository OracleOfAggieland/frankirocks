/**
 * Predicate taxonomy (contracts §3): closed Args<P>, allowed value kinds and codes, single-valued flag,
 * and the kind map. `?` in the contract means nullable (key required).
 */
import { DOMAINS, EID, ID, type MemoryKind, type Pred, type Value, Zone } from "./primitives";
import { type Issue, type Schema, arr, bool, int, issue, nullable, obj, oneOf, str } from "./v";

const E = EID;
const S = str(512);
const Domain = oneOf(DOMAINS);

type ValueKind = Value["kind"];

export interface PredicateSpec {
  args: Schema<unknown>;
  /** Allowed `Value.kind`s. */
  values: readonly ValueKind[];
  /** Allowed `enum` codes, when `values` includes "enum". */
  codes?: readonly string[];
  /** Y = single-valued key (supersede on new active), N = multi-valued. */
  single: boolean;
  /** Allowed Memory kinds (kind map). */
  kinds: readonly MemoryKind[];
}

export const PREDICATE_SPECS: Record<Pred, PredicateSpec> = {
  "identity.name": { args: obj({}), values: ["text"], single: true, kinds: ["fact"] },
  "identity.alias": { args: obj({ entityRef: E }), values: ["text"], single: true, kinds: ["fact"] },
  "person.relation": {
    args: obj({ otherRef: E, label: nullable(S), employerRef: nullable(E) }),
    values: ["enum"],
    codes: [
      "parent",
      "child",
      "sibling",
      "sister",
      "brother",
      "sister_in_law",
      "brother_in_law",
      "partner",
      "ex_partner",
      "spouse",
      "ex_spouse",
      "friend",
      "colleague",
      "boss",
      "other",
    ],
    single: true,
    kinds: ["fact"],
  },
  "person.life": {
    args: obj({ detail: nullable(S) }),
    values: ["enum"],
    codes: ["alive", "ill", "hospitalized", "recovering", "recovered", "deceased", "unknown"],
    single: true,
    kinds: ["fact"],
  },
  "employment.status": {
    args: obj({}),
    values: ["enum"],
    codes: ["working", "seeking", "between_jobs", "retired", "studying", "unknown"],
    single: true,
    kinds: ["fact"],
  },
  "employment.role": { args: obj({ employerRef: E, managerRef: nullable(E) }), values: ["text"], single: true, kinds: ["fact"] },
  "place.residence": { args: obj({}), values: ["entity"], single: true, kinds: ["fact"] },
  "preference.food": {
    args: obj({ dimension: oneOf(["diet", "cuisine", "ingredient", "dish", "place"]), targetRef: nullable(E) }),
    values: ["enum"],
    codes: ["like", "dislike", "prefer", "avoid", "vegetarian", "vegan", "none"],
    single: true,
    kinds: ["preference", "rule"],
  },
  "preference.schedule": {
    args: obj({ calendarRef: nullable(E), minute: nullable(int(0, 1439)), days: arr(int(0, 6), 7, 1), zone: Zone }),
    values: ["enum"],
    codes: ["no_before", "no_after", "avoid_day"],
    single: true,
    kinds: ["preference", "rule"],
  },
  "preference.style": {
    args: obj({
      context: oneOf(["global", "morning", "evening", "work", "care"]),
      dimension: oneOf(["detail", "humor", "tone"]),
    }),
    values: ["enum"],
    codes: ["concise", "detailed", "teasing_ok", "no_teasing", "gentle", "neutral"],
    single: true,
    kinds: ["preference", "rule"],
  },
  handling: {
    args: obj({ personRef: E, context: oneOf(["work", "social", "care"]), dimension: oneOf(["order", "detail", "tone"]) }),
    values: ["enum"],
    codes: ["answer_first", "context_first", "brief", "detailed", "formal", "casual", "no_teasing"],
    single: true,
    kinds: ["fact"],
  },
  allergy: { args: obj({ allergenCode: str(64, { min: 1 }) }), values: ["boolean"], single: true, kinds: ["rule"] },
  fact: {
    args: obj({ topic: Domain, label: nullable(S) }),
    values: ["text", "entity", "number", "boolean", "money"],
    single: false,
    kinds: ["fact"],
  },
  goal: { args: obj({ domain: Domain }), values: ["text"], single: false, kinds: ["goal"] },
  commitment: {
    args: obj({ actorRef: E, recipientRef: E, objectRef: nullable(E), artifactVersion: nullable(S) }),
    values: ["text"],
    single: false,
    kinds: ["commitment"],
  },
  event: {
    args: obj({
      occasion: oneOf(["interview", "appointment", "surgery", "birthday", "anniversary", "travel", "deadline", "meeting", "other"]),
      anchorRef: nullable(ID),
      important: bool,
    }),
    values: ["text"],
    single: false,
    kinds: ["event"],
  },
  episode: { args: obj({ occasionRef: nullable(E), eventRef: nullable(E) }), values: ["text"], single: false, kinds: ["episode"] },
  recommendation: {
    args: obj({ recommenderRef: E, occasionRef: nullable(E), recipientRef: nullable(E) }),
    values: ["entity"],
    single: false,
    kinds: ["fact"],
  },
  care: {
    args: obj({ careSubjectRef: E, topic: S }),
    values: ["enum"],
    codes: ["open", "recovering", "resolved", "bereaved", "unknown"],
    single: true,
    kinds: ["care"],
  },
  habit: {
    args: obj({
      metric: oneOf(["coffee_count", "takeout_count", "calendar_load", "contact_frequency", "other"]),
      rollupRef: ID,
    }),
    values: ["text"],
    single: true,
    kinds: ["habit"],
  },
  hypothesis: { args: obj({ topic: Domain }), values: ["text"], single: false, kinds: ["hypothesis"] },
  bit: { args: obj({ uptakeEid: ID }), values: ["text"], single: false, kinds: ["bit"] },
  story: { args: obj({ uptakeEid: ID }), values: ["text"], single: false, kinds: ["story"] },
  loop: { args: obj({}), values: ["none"], single: true, kinds: ["loop"] },
};

/** Checks args, value and kind against the predicate (contracts §3 "Args<P> closed", kind map). */
export function checkPredicateFit(
  m: { predicate: Pred; kind: MemoryKind; value: Value; args: unknown },
  path: string,
): Issue | null {
  const spec = PREDICATE_SPECS[m.predicate];
  const argsIssue = spec.args.check(m.args, `${path}.args`);
  if (argsIssue !== null) return argsIssue;
  if (!spec.values.includes(m.value.kind)) {
    return issue(`${path}.value.kind`, `predicate ${m.predicate} takes ${spec.values.join("|")} values`);
  }
  if (m.value.kind === "enum" && spec.codes !== undefined && !spec.codes.includes(m.value.code)) {
    return issue(`${path}.value.code`, `not a ${m.predicate} code`);
  }
  if (!spec.kinds.includes(m.kind)) return issue(`${path}.kind`, `kind map: ${m.predicate} is ${spec.kinds.join("|")}`);
  return null;
}
