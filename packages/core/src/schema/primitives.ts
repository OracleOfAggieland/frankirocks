/**
 * Contract primitives and shared nested types (contracts §1 Records header, §3, §6 shared shapes).
 *
 * TS representation: the contract allows "Firestore Timestamp/RFC3339UTC". This slice stores and sends the
 * fixed-width RFC3339 UTC form `YYYY-MM-DDTHH:mm:ss.sssZ`, so string order equals time order in both stores.
 */
import { type Infer, arr, bool, int, issue, literal, nat, nullable, num, obj, oneOf, refine, signed, str, tagged, union } from "./v";

// ---------------------------------------------------------------------------------------------
// Scalars

const BASE64URL_43 = /^[A-Za-z0-9_-]{43}$/;
/** `ID`: s43 HMAC-SHA256 base64url (43 characters, no padding). */
export const ID = str(43, { min: 43, pattern: BASE64URL_43, label: "a 43-character base64url ID" });
export type ID = Infer<typeof ID>;

/** `EID = ID | "self"`. */
export const EID = union(ID, literal("self"));
export type EID = Infer<typeof EID>;

/** `Hash`: s64 lowercase hex SHA-256. */
export const Hash = str(64, { min: 64, pattern: /^[0-9a-f]{64}$/, label: "64 lowercase hex characters" });
export type Hash = Infer<typeof Hash>;

const TS_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
/** `TS`: fixed-width RFC3339 UTC with milliseconds. */
export const TS = refine(str(24, { min: 24, pattern: TS_PATTERN, label: "RFC3339 UTC YYYY-MM-DDTHH:mm:ss.sssZ" }), (v, path) =>
  isRealInstant(v) ? null : issue(path, "not a real calendar instant"),
);
export type TS = Infer<typeof TS>;

function isRealInstant(ts: string): boolean {
  const ms = Date.parse(ts);
  return Number.isFinite(ms) && new Date(ms).toISOString() === ts;
}

/** Formats an integer-millisecond instant from the Clock_Port as a `TS`. */
export function tsFromMs(ms: number): TS {
  if (!Number.isSafeInteger(ms)) throw new RangeError("tsFromMs needs an integer millisecond instant");
  return new Date(ms).toISOString();
}

/** Parses a `TS` back to integer milliseconds. */
export function msFromTs(ts: TS): number {
  return Date.parse(ts);
}

/** `Civil`: s32 ISO local date or date-time. */
export const Civil = str(32, {
  pattern: /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?)?$/,
  label: "an ISO local date or date-time",
});
export type Civil = Infer<typeof Civil>;

const zoneCache = new Map<string, boolean>();
/** True when `zone` is an IANA zone name the runtime's ICU data knows. Pure: no clock or I/O. */
export function isZone(zone: string): boolean {
  const cached = zoneCache.get(zone);
  if (cached !== undefined) return cached;
  let valid = false;
  if (zone.length > 0 && zone.length <= 64 && /^[A-Za-z0-9_+\-/]+$/.test(zone)) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: zone });
      valid = true;
    } catch {
      valid = false;
    }
  }
  zoneCache.set(zone, valid);
  return valid;
}

/** `Zone`: s64 IANA zone. */
export const Zone = refine(str(64, { min: 1 }), (v, path) => (isZone(v) ? null : issue(path, "not an IANA zone")));
export type Zone = Infer<typeof Zone>;

/** ISO 4217-shaped currency code (contract s3; "validate code/currency"). */
export const Currency = str(3, { min: 3, pattern: /^[A-Z]{3}$/, label: "a 3-letter uppercase currency code" });

/** `s10` civil date `YYYY-MM-DD`. */
export const CivilDate = str(10, { min: 10, pattern: /^\d{4}-\d{2}-\d{2}$/, label: "a YYYY-MM-DD date" });

// ---------------------------------------------------------------------------------------------
// Enums

export const Class = oneOf(["U", "C", "O", "T", "M"]);
export type Class = Infer<typeof Class>;
export const Sens = oneOf(["S0", "S1", "S2"]);
export type Sens = Infer<typeof Sens>;
export const Au = oneOf(["private", "company", "unknown"]);
export type Au = Infer<typeof Au>;
export const Source = oneOf(["gmail", "calendar", "plaid", "voice", "notes", "tasks", "food", "fixture", "pasted"]);
export type Source = Infer<typeof Source>;
export const EK = oneOf(["person", "pet", "place", "organization", "artifact", "occasion", "topic"]);
export type EK = Infer<typeof EK>;
export const Purpose = oneOf(["extract", "commit", "answer", "proactive", "plan", "action", "inspect"]);
export type Purpose = Infer<typeof Purpose>;

export const FIELD_PATHS = [
  "body",
  "bodyOwn",
  "bodyQuoted",
  "subject",
  "title",
  "description",
  "text",
  "sender",
  "recipient",
  "calendar.time",
  "calendar.status",
  "calendar.attendance",
  "bank.amount",
  "bank.status",
  "bank.purchaseAt",
  "task.status",
  "food.amount",
] as const;
export const FP = oneOf(FIELD_PATHS);
export type FP = Infer<typeof FP>;

export const ERROR_CODES = ["STALE", "BARRIER", "PARSE", "AUTH", "SCOPE", "LIMIT", "DEPENDENCY", "CONFIG", "HASH"] as const;
export const ErrorCode = oneOf(ERROR_CODES);
export type ErrorCode = Infer<typeof ErrorCode>;

export const POLICY_REASONS = [
  "ok",
  "ineligible",
  "power",
  "audience",
  "closed_topic",
  "quiet",
  "confirmation",
  "approval",
  "promotion",
  "cap",
  "flow",
  "posture",
  "sensitivity",
  "stale",
] as const;
export const ELIGIBILITY_REASONS = [
  ...POLICY_REASONS,
  "tenant",
  "barrier",
  "dirty",
  "time",
  "authority",
  "freshness",
  "blocked",
] as const;
export const KERNEL_ERRORS = [
  "invalidInput",
  "ambiguous",
  "missingDependency",
  "blocked",
  "staleRevision",
  "staleEpoch",
  "incompleteCoverage",
  "budgetExceeded",
  "oversize",
  "unsupported",
] as const;
export type KernelError = (typeof KERNEL_ERRORS)[number];
/** ReasonCode = PolicyReason | EligibilityReason | KernelError | ErrorCode. */
export const ReasonCode = oneOf([...new Set<string>([...ELIGIBILITY_REASONS, ...KERNEL_ERRORS, ...ERROR_CODES])] as const);
export type ReasonCode = Infer<typeof ReasonCode>;

export const ROUTE_NAMES = ["open", "sdp", "state", "close", "turn", "tool", "receipt", "memory", "control", "reset", "advance", "seedEvent"] as const;
export const RouteName = oneOf(ROUTE_NAMES);
export type RouteName = Infer<typeof RouteName>;

/** SC: tenant collection names (contracts §1 closing notes). */
export const COLLECTIONS = [
  "evidence",
  "chunks",
  "lexDf",
  "memories",
  "entities",
  "moments",
  "anchors",
  "effects",
  "sessions",
  "turns",
  "ledger",
  "rollups",
  "pending",
  "jobs",
  "blocks",
  "overlays",
  "syncPages",
  "referents",
  "connectors",
  "candidates",
  "core",
] as const;
export const SC = oneOf(COLLECTIONS);
export type SC = Infer<typeof SC>;

export const MEMORY_KINDS = [
  "fact",
  "preference",
  "rule",
  "goal",
  "commitment",
  "event",
  "episode",
  "care",
  "habit",
  "hypothesis",
  "bit",
  "story",
  "loop",
] as const;
export const MemoryKind = oneOf(MEMORY_KINDS);
export type MemoryKind = Infer<typeof MemoryKind>;

export const PENDING_KINDS = [
  "time",
  "identity",
  "control",
  "closure",
  "offer",
  "audience",
  "expiry",
  "outcome",
  "restore",
  "binding",
  "safety",
] as const;
export const PendingKind = oneOf(PENDING_KINDS);

export const DOMAINS = ["time", "work", "food", "health", "money", "relationship", "home", "travel", "other"] as const;
export const Domain = oneOf(DOMAINS);

export const ROLES = [
  "subject",
  "object",
  "actor",
  "recipient",
  "beneficiary",
  "recommender",
  "place",
  "occasion",
  "attendee",
  "manager",
  "employer",
  "careSubject",
  "artifact",
] as const;
export const Role = oneOf(ROLES);

export const BROWSER_STATES = [
  "CLOSED",
  "CONNECTING",
  "CONFIGURING",
  "LISTENING",
  "WAIT_ITEM",
  "JUDGING",
  "SPECULATING",
  "HELD",
  "TOOL_WAIT",
  "SPEAKING",
  "QUARANTINED",
  "CLEAN_READY",
  "RECOVERY",
] as const;
export const BrowserState = oneOf(BROWSER_STATES);
export type BrowserState = Infer<typeof BrowserState>;

// ---------------------------------------------------------------------------------------------
// Slice, Span, Ref, L, C

/** Slice: `start`/`end` are both null for typed fields, or both set with start <= end. */
export const Slice = refine(
  obj({
    eid: ID,
    fieldPath: FP,
    start: nullable(nat()),
    end: nullable(nat()),
    contentHash: Hash,
    class: Class,
    sens: Sens,
  }),
  (v, path) => {
    if ((v.start === null) !== (v.end === null)) return issue(`${path}.end`, "start and end must both be null or both set");
    if (v.start !== null && v.end !== null && v.start > v.end) return issue(`${path}.end`, "end is before start");
    return null;
  },
);
export type Slice = Infer<typeof Slice>;

export const Span = refine(
  obj({ eid: ID, fieldPath: FP, start: nat(), end: nat(), quote: str(512) }),
  (v, path) => (v.start > v.end ? issue(`${path}.end`, "end is before start") : null),
);
export type Span = Infer<typeof Span>;

export const REF_TYPES = [
  "evidence",
  "memory",
  "entity",
  "moment",
  "anchor",
  "effect",
  "ledger",
  "rollup",
  "pending",
  "candidate",
  "session",
  "turn",
  "job",
  "connector",
] as const;

const RefPlain = refine(obj({ type: oneOf(REF_TYPES), id: EID, rev: nat() }), (v, path) =>
  v.id === "self" && v.type !== "entity" ? issue(`${path}.id`, `"self" is only valid for entity refs`) : null,
);
const RefChunk = obj({ type: literal("chunk"), id: str(6, { min: 6, pattern: /^\d{6}$/, label: "a 6-digit chunk id" }), parentId: ID, rev: nat() });
const RefTurn = obj({ type: literal("turn"), id: ID, parentId: ID, rev: nat() });
export const Ref = union(RefPlain, RefChunk, RefTurn);
export type Ref = Infer<typeof Ref>;

/** `dependsOn` entries: s96. */
export const Dep = str(96, { min: 1 });

/** L = {rootKeys, rootSlices, dependsOn}, sharing C bounds. */
export const L_SHAPE = {
  rootKeys: arr(ID, 128),
  rootSlices: arr(Slice, 128),
  dependsOn: arr(Dep, 1024),
};

/** Common_Fields (C) carried by every tenant row (KC01). */
export const C_SHAPE = {
  v: literal(1),
  uid: str(128, { min: 1 }),
  rev: nat(1),
  createdAt: TS,
  updatedAt: TS,
  epoch: nat(),
  policyRev: nat(),
  rootKeys: arr(ID, 128),
  rootSlices: arr(Slice, 128),
  contextIds: arr(Ref, 256),
  packetEids: arr(ID, 200),
  dependsOn: arr(Dep, 1024),
  dirty: bool,
  dependenciesComplete: bool,
};

// ---------------------------------------------------------------------------------------------
// Content, coverage, values

export const Content = tagged("kind", {
  inline: obj({ kind: literal("inline"), text: str(131072) }),
  object: obj({
    kind: literal("object"),
    path: str(512, { min: 1 }),
    sha256: Hash,
    utf16Length: nat(),
    bytes: nat(),
    mime: oneOf(["text/plain", "text/html", "application/pdf"]),
  }),
});
export type Content = Infer<typeof Content>;

export const Cov = obj({
  state: oneOf(["complete", "partial", "unknown"]),
  from: nullable(TS),
  to: nullable(TS),
  missingRanges: arr(obj({ from: TS, to: TS, reason: oneOf(["quota", "provider", "unconnected", "deleted"]) }), 32),
  generation: nat(),
});
export type Cov = Infer<typeof Cov>;

export const VALUE_UNITS = ["none", "count", "minute", "day", "gram", "kcal", "percent"] as const;
export const Value = tagged("kind", {
  none: obj({ kind: literal("none") }),
  entity: obj({ kind: literal("entity"), ref: EID }),
  text: obj({ kind: literal("text"), text: str(512) }),
  number: obj({ kind: literal("number"), num: num(), unit: oneOf(VALUE_UNITS) }),
  boolean: obj({ kind: literal("boolean"), bool }),
  enum: obj({ kind: literal("enum"), code: str(64, { min: 1 }) }),
  money: obj({ kind: literal("money"), amountMinor: signed, currency: Currency }),
});
export type Value = Infer<typeof Value>;

export const Binding = obj({ role: Role, entityId: EID });

// ---------------------------------------------------------------------------------------------
// Time shapes

const Days = arr(int(0, 6), 7, 1);

export const GapPolicy = tagged("kind", {
  requestedFree: obj({
    kind: literal("requestedFree"),
    minMinutes: int(1, 1440),
    localFromMinute: int(0, 1439),
    localToMinute: int(1, 1440),
    days: Days,
    zone: Zone,
    notBefore: nullable(TS),
  }),
  calm: obj({ kind: literal("calm"), minMinutes: literal(90), baselineDays: literal(56) }),
});

export const When = tagged("kind", {
  spoken: obj({ kind: literal("spoken"), spoken: str(256) }),
  provider: obj({ kind: literal("provider"), anchorId: ID }),
  calendarGap: obj({ kind: literal("calendarGap"), policy: GapPolicy }),
  none: obj({ kind: literal("none") }),
});
export type When = Infer<typeof When>;

export const RecurrencePolicy = obj({
  zone: Zone,
  fold: oneOf(["first", "second"]),
  gap: oneOf(["skip", "shiftForward"]),
  exceptions: arr(obj({ originalCivilStart: Civil, kind: oneOf(["cancel", "move"]), replacementStart: nullable(Civil) }), 128),
});

/** Time. "RRULE needs dtstart+recurrence". */
export const Time = refine(
  obj({
    start: TS,
    end: nullable(TS),
    zone: Zone,
    civilStart: Civil,
    civilEnd: nullable(Civil),
    precision: oneOf(["instant", "day", "month", "range"]),
    rrule: nullable(str(512)),
    dtstart: nullable(Civil),
    originalCivilStart: nullable(Civil),
    recurrence: nullable(RecurrencePolicy),
  }),
  (v, path) =>
    v.rrule !== null && (v.dtstart === null || v.recurrence === null)
      ? issue(`${path}.rrule`, "rrule needs dtstart and recurrence")
      : null,
);
export type Time = Infer<typeof Time>;

export const EndWhen = tagged("kind", {
  standing: obj({ kind: literal("standing") }),
  at: obj({ kind: literal("at"), at: TS }),
  anchorEnd: obj({ kind: literal("anchorEnd"), anchorId: ID }),
  onResolution: obj({ kind: literal("onResolution"), memoryId: ID }),
  reviewOnly: obj({ kind: literal("reviewOnly") }),
});
export type EndWhen = Infer<typeof EndWhen>;

export const Tpl = obj({
  text: str(512),
  entityRefs: arr(EID, 8),
  timeFields: arr(oneOf(["start", "end", "due", "originalStart"]), 4),
});

// ---------------------------------------------------------------------------------------------
// Observation and closure proofs (Evidence)

const Calendar = obj({
  kind: literal("calendar"),
  providerKey: ID,
  calendarKey: ID,
  seriesKey: nullable(ID),
  originalStart: nullable(Civil),
  start: TS,
  end: TS,
  zone: Zone,
  allDay: bool,
  status: oneOf(["confirmed", "tentative", "cancelled"]),
  selfResponse: oneOf(["accepted", "tentative", "declined", "needsAction", "none"]),
  transparency: oneOf(["opaque", "transparent"]),
  organizerSelf: bool,
  creatorSelf: bool,
  organizerId: nullable(EID),
  attendeeIds: arr(EID, 64),
  scheduleRev: nat(),
});

const Bank = obj({
  kind: literal("bank"),
  providerKey: ID,
  pending: bool,
  removed: bool,
  amountCents: signed,
  currency: Currency,
  pendingOfId: nullable(ID),
  refundOfId: nullable(ID),
  merchantKey: nullable(ID),
  category: oneOf(["takeout", "groceries", "restaurant", "other"]),
  purchaseAt: obj({
    instant: nullable(TS),
    civilDate: nullable(CivilDate),
    zone: nullable(Zone),
    basis: oneOf(["providerAuthorized", "providerDate", "receiptMatched", "unknown"]),
    precision: oneOf(["instant", "day", "unknown"]),
  }),
  postedAt: nullable(TS),
  accountKey: ID,
});

const Receipt = obj({
  kind: literal("receipt"),
  orderKey: nullable(ID),
  bankEvidenceId: nullable(ID),
  amountCents: nullable(signed),
  currency: nullable(Currency),
  orderAt: nullable(TS),
  merchantKey: nullable(ID),
  match: oneOf(["exact", "candidate", "none"]),
});

const Task = obj({
  kind: literal("task"),
  providerKey: ID,
  status: oneOf(["open", "completed", "deleted"]),
  title: str(256),
  due: nullable(TS),
});

const Food = obj({
  kind: literal("food"),
  itemId: nullable(ID),
  amount: num(),
  unit: oneOf(["gram", "serving", "kcal"]),
  loggedAt: TS,
});

export const Observation = tagged("kind", {
  none: obj({ kind: literal("none") }),
  calendar: Calendar,
  bank: Bank,
  receipt: Receipt,
  task: Task,
  food: Food,
});
export type Observation = Infer<typeof Observation>;

export const ClosureProof = obj({
  messageEvidenceId: ID,
  artifactId: EID,
  versionHash: Hash,
  recipientAddressKey: ID,
  delivery: oneOf(["sent", "failed", "unknown"]),
  sentAt: nullable(TS),
  draft: bool,
});

// ---------------------------------------------------------------------------------------------
// Shapes shared with the wire (contracts §6) that stored records embed

/** SS (session stamp). */
export const SS = obj({
  sessionId: ID,
  epoch: nat(),
  policyRev: nat(),
  bundleRev: nat(),
  rulesRev: nat(),
  generation: nat(1),
});
export type SS = Infer<typeof SS>;

export const StateAck = obj({ stamp: SS, issuedOpsAt: TS, expiresOpsAt: TS });
export type StateAck = Infer<typeof StateAck>;

export const HEAD_SECTIONS = ["persona", "policy", "rules", "now", "style", "people", "next72", "apply", "know", "openers"] as const;
export const HeadSectionId = oneOf(HEAD_SECTIONS);

/** Head. `sections` holds exactly the ten sections. */
export const Head = obj({
  text: str(14000),
  tokenCount: nat(0, 3500),
  selectedRefs: arr(Ref, 128),
  sections: arr(obj({ id: HeadSectionId, tokens: nat() }), 10, 10),
});
export type Head = Infer<typeof Head>;

export const EntityRef = obj({ id: nullable(EID), label: nullable(str(120)) });
export const RoleTuple = obj({ role: Role, entityId: EID, occasionId: nullable(EID) });

/** Pred (contracts §3), closed. */
export const PREDICATES = [
  "identity.name",
  "identity.alias",
  "person.relation",
  "person.life",
  "employment.status",
  "employment.role",
  "place.residence",
  "preference.food",
  "preference.schedule",
  "preference.style",
  "handling",
  "allergy",
  "fact",
  "goal",
  "commitment",
  "event",
  "episode",
  "recommendation",
  "care",
  "habit",
  "hypothesis",
  "bit",
  "story",
  "loop",
] as const;
export const Pred = oneOf(PREDICATES);
export type Pred = Infer<typeof Pred>;

/** RecallArgs = recall tool args (contracts §6 Tools). */
export const RecallArgs = obj({
  purpose: oneOf(["answer", "plan", "why", "inspect"]),
  query: str(512),
  entityRefs: arr(EntityRef, 8),
  roleTuple: nullable(RoleTuple),
  predicate: nullable(Pred),
  asOf: nullable(str(80)),
  anchorId: nullable(ID),
  sourceMode: oneOf(["canonical", "raw", "both"]),
});
export type RecallArgs = Infer<typeof RecallArgs>;

/** Vector512: 512 finite floats. */
export const Vector512 = arr(num(), 512, 512);
