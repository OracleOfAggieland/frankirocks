/**
 * Stored record schemas (contracts §1; R4.1, R4.3–R4.5, R4.8, R4.11; KC01).
 * Every tenant row carries the Common_Fields C. Document IDs (eid, mid, sessionId, ...) are path segments,
 * not fields, as in contracts §1.
 */
import { PHONE_CARRIER_STATUSES, PhoneReport } from "../phone";
import { checkPredicateFit } from "./predicates";
import {
  Au,
  Binding,
  C_SHAPE,
  Class,
  ClosureProof,
  Content,
  Cov,
  CivilDate,
  Currency,
  Dep,
  EID,
  EndWhen,
  ErrorCode,
  FP,
  Hash,
  Head,
  ID,
  L_SHAPE,
  MemoryKind,
  Observation,
  Pred,
  Purpose,
  ReasonCode,
  RecallArgs,
  Ref,
  RouteName,
  SC,
  Sens,
  Slice,
  Source,
  Span,
  StateAck,
  TS,
  Time,
  Tpl,
  Value,
  Vector512,
  When,
  Zone,
  BrowserState,
} from "./primitives";
import {
  type Infer,
  type Schema,
  arr,
  bool,
  int,
  issue,
  literal,
  nat,
  nullable,
  num,
  obj,
  oneOf,
  plainObject,
  refine,
  signed,
  str,
  tagged,
  union,
} from "./v";
// Brief 049 part A: an Errand's closed sets and bounds.
import { ERRAND_ABOUT, ERRAND_LABEL_CHARS, ERRAND_LINES_MAX, ERRAND_LINE_CHARS, ERRAND_LINE_REFS_MAX, ERRAND_NOTICES, ERRAND_OUTCOMES, ERRAND_READS_MAX } from "../errands/limits";
// Brief 024: the Gate's closed codes, for its ledger rows.
import {
  DECISION_ISSUERS,
  DECISION_JUDGES,
  GATE_CARVE_OUTS,
  GATE_FORMS,
  GATE_OUTCOMES,
  GATE_REASONS,
  GATE_RENDERS,
  GATE_VERDICTS,
} from "../gate/reasons";

const s128 = str(128);

export const PERMIT_KINDS = ["fastO", "slowOrdinary", "proactive", "postCommitControl", "recoveryOnly"] as const;
export const PermitKind = oneOf(PERMIT_KINDS);
export type PermitKind = Infer<typeof PermitKind>;

// ---------------------------------------------------------------------------------------------
// evidence/{eid}

export const EVIDENCE_CONTENT_FIELDS = [
  "body",
  "bodyOwn",
  "bodyQuoted",
  "subject",
  "title",
  "description",
  "text",
  "sender",
  "recipient",
  "observation",
  "fieldSlices",
] as const;

export const EvidenceShape = {
  ...C_SHAPE,
  logicalId: ID,
  revisionOf: nullable(ID),
  sanitizedFrom: nullable(ID),
  source: Source,
  providerKey: nullable(ID),
  providerRevision: nullable(s128),
  connectorId: nullable(ID),
  generation: nat(),
  threadKey: nullable(ID),
  inReplyToProviderKey: nullable(ID),
  closureProofs: arr(ClosureProof, 32),
  kind: oneOf(["turn", "message", "calendar", "transaction", "receipt", "note", "task", "food"]),
  status: oneOf(["retained", "blocked", "purged"]),
  isCurrentProvider: bool,
  occurredAt: TS,
  assertedAt: TS,
  receivedAt: TS,
  zone: nullable(Zone),
  fieldSlices: arr(Slice, 128, 1),
  body: nullable(Content),
  bodyOwn: nullable(Content),
  bodyQuoted: nullable(Content),
  subject: nullable(str(1024)),
  title: nullable(str(1024)),
  description: nullable(Content),
  text: nullable(Content),
  sender: nullable(str(320)),
  recipient: arr(str(320), 64),
  observation: Observation,
  authorId: nullable(EID),
  senderAddressKey: nullable(ID),
  recipientAddressKeys: arr(ID, 64),
  authorship: oneOf(["self", "delegated", "imported", "unknown"]),
  delivery: oneOf(["sent", "inserted", "unknown"]),
  senderAuth: oneOf(["aligned", "failed", "unknown"]),
  identityBinding: oneOf(["confirmed", "candidate", "none"]),
  route: oneOf(["direct", "forwarded", "list", "imported", "unknown"]),
  sessionId: nullable(ID),
  turnId: nullable(ID),
  itemIds: arr(s128, 16),
  transcriptState: oneOf(["pending", "complete", "failed", "transcriptMissing"]),
  transcriptDeadline: nullable(TS),
  controlTurn: bool,
  extractPacketMode: oneOf(["singleTurn", "pronounContext", "source"]),
  parserVersion: str(32),
  copyRootKey: nullable(ID),
  replacedProviderKey: nullable(ID),
  sanitizeMap: arr(
    obj({ oldField: FP, oldStart: nat(), oldEnd: nat(), newField: FP, newStart: nat(), newEnd: nat() }),
    128,
  ),
  purgedAt: nullable(TS),
};
export const Evidence = obj(EvidenceShape);
export type Evidence = Infer<typeof Evidence>;

// ---------------------------------------------------------------------------------------------
// memories/{mid}

const Window = obj({
  fromCivil: CivilDate,
  toCivil: CivilDate,
  zone: Zone,
  currency: Currency,
  coverage: Cov,
  purchaseIds: arr(ID, 128),
  valueCents: nullable(signed),
  weekdayCounts: arr(nat(), 7, 7),
});

export const Loop = obj({
  acceptedActionId: ID,
  metric: oneOf(["takeoutSpend", "totalFoodSpend", "userAppraisal"]),
  baseline: Window,
  comparison: Window,
  checkAt: TS,
  predicateVersion: oneOf(["takeout_late_meeting_v1", "food_net_v1", "appraisal_v1"]),
  state: oneOf(["waiting", "incomplete", "noChange", "eligible", "celebrated", "cancelled"]),
  appraisalRef: nullable(Ref),
});

export const MemoryShape = {
  ...C_SHAPE,
  logicalId: ID,
  kind: MemoryKind,
  subjectId: EID,
  predicate: Pred,
  scopeId: union(EID, literal("global")),
  key: ID,
  value: Value,
  /** Args<predicate>; checked against the predicate by the Memory refinement. */
  args: plainObject,
  bindings: arr(Binding, 16),
  status: oneOf(["active", "scheduled", "history", "alleged", "wrong", "retracted", "blocked"]),
  sourceClass: Class,
  sens: Sens,
  closeReason: nullable(oneOf(["outcome", "expired", "refuted", "lapsed"])),
  lastSupportAt: nullable(TS),
  flow: oneOf(["open", "never_outbound"]),
  assertedAt: TS,
  validFrom: nullable(TS),
  validTo: nullable(TS),
  validFromKey: TS,
  validFromKnown: bool,
  when: When,
  time: nullable(Time),
  endWhen: EndWhen,
  nextReviewAt: TS,
  replacesIds: arr(ID, 16),
  supportingIds: arr(Ref, 16),
  entityIds: arr(EID, 32),
  topicIds: arr(ID, 16),
  roleKeys: arr(ID, 16),
  watchTokens: arr(str(96), 32),
  watches: arr(obj({ token: str(96), polarity: oneOf(["supports", "contradicts", "changes"]) }), 32),
  anchorId: nullable(ID),
  unboundStart: nullable(TS),
  scheduleRev: nat(),
  sayAs: nullable(Tpl),
  texture: arr(obj({ kind: oneOf(["worry", "hope", "detail"]), text: str(256), ...L_SHAPE }), 3),
  gravity: int(0, 3),
  closesId: nullable(ID),
  possibleClosureSourceId: nullable(ID),
  expectedArtifactId: nullable(EID),
  embedding: nullable(Vector512),
  vectorVersion: nullable(str(32)),
  hypothesis: nullable(
    obj({
      premiseIds: arr(Ref, 16, 1),
      alternatives: arr(str(256), 3),
      counterIds: arr(Ref, 16),
      ownRooted: bool,
      independentCount: nat(),
      observedFrom: nullable(TS),
      observedTo: nullable(TS),
    }),
  ),
  loop: nullable(Loop),
};

export const Memory = refine(obj(MemoryShape), (m, path) => checkPredicateFit(m, path));
export type Memory = Omit<Infer<typeof Memory>, "args"> & { args: Record<string, unknown> };

// ---------------------------------------------------------------------------------------------
// sessions/{sessionId} and turns

const OpenedTopic = obj({ topicId: ID, itemId: s128, expiresAt: TS, ...L_SHAPE });
const Granted = obj({ topicId: ID, itemId: s128, confirmRef: Ref, expiresAt: TS, ...L_SHAPE });

export const SessionShape = {
  ...C_SHAPE,
  status: oneOf(["minting", "active", "quarantined", "closing", "closed", "failed"]),
  browserState: BrowserState,
  generation: nat(),
  startedBy: oneOf(["user", "franki"]),
  callId: nullable(s128),
  registeredCallIds: arr(s128, 4),
  activeLeaseToken: nullable(ID),
  startedAt: TS,
  lastTurnAt: TS,
  expiresAt: TS,
  closedAt: nullable(TS),
  waitDeadline: nullable(TS),
  retainUntil: nullable(TS),
  audience: Au,
  openedTopics: arr(OpenedTopic, 16),
  hiddenDisclosureGranted: arr(Granted, 16),
  committedItemIds: arr(s128, 64),
  deadItemIds: arr(s128, 64),
  lastClientSeq: nat(),
  lastAdmittedSeq: nat(),
  nextClientSeq: nat(1),
  committedParseSeq: nat(),
  parseLease: nullable(obj({ clientSeq: nat(), token: ID, until: TS })),
  lastSpeechStartedOpsAt: nullable(TS),
  lastUserTurnOpsAt: nullable(TS),
  stateAck: nullable(StateAck),
  modifiers: obj({ rushed: nullable(TS), crisis: nullable(TS) }),
  transitionCandidateSeq: nullable(nat()),
  lastCheckInAnswerSeq: nullable(nat()),
  headMode: oneOf(["full", "fastHead"]),
  responseIds: arr(obj({ id: s128, kind: oneOf(["judge", "reply", "ack"]), generation: nat() }), 8),
  outstandingTools: arr(obj({ callId: s128, generation: nat(), deadline: TS }), 4),
  update: nullable(obj({ instructionsHash: Hash, deadline: TS })),
  activePlanId: nullable(ID),
  pendingId: nullable(ID),
  warmthLeaseId: nullable(ID),
  referenceCount: nat(),
};
export const Session = obj(SessionShape);
export type Session = Infer<typeof Session>;

export const SAID_MATCH = ["none", "idTagged", "exactTemplate", "candidateAndReason"] as const;

export const TurnShape = {
  ...C_SHAPE,
  sessionId: ID,
  seq: nat(),
  role: oneOf(["user", "assistant"]),
  itemIds: arr(s128, 16),
  evidenceId: nullable(ID),
  state: oneOf(["committed", "transcribed", "failed", "transcriptMissing", "dead"]),
  text: nullable(str(8192)),
  committedAt: TS,
  audibleEndAt: nullable(TS),
  transcriptDeadline: TS,
  judge: nullable(oneOf(["O", "H", "U"])),
  judgeResponseId: nullable(s128),
  spokenResponseId: nullable(s128),
  parseState: oneOf(["pending", "committed", "failed"]),
  final: bool,
  audioDurationMs: nat(),
  lastFragmentOpsAt: nullable(TS),
  sourceClass: Class,
  uncertainSpeaker: num(0, 1),
  noteIds: arr(ID, 4),
  noteTokens: arr(obj({ noteId: ID, tokens: arr(str(64), 4) }), 4),
  pendingId: nullable(ID),
  momentIds: arr(ID, 4),
  admittedAt: nullable(TS),
  playbackAt: nullable(TS),
  saidMatch: oneOf(SAID_MATCH),
  retainUntil: nullable(TS),
};
export const Turn = obj(TurnShape);
export type Turn = Infer<typeof Turn>;

// ---------------------------------------------------------------------------------------------
// ledger/{entryId}

const LEDGER_KINDS = ["request", "decision", "action", "delivery", "usage", "forgetReceipt", "phoneCall", "phoneReport", "gate", "rule", "bank", "google", "errand"] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

/**
 * `request.response` is `WireResult?`. The closed response schema depends on `route`, so the Ledger refinement
 * checks it with the schema ./wire installs here. ./wire is imported by the package index, so it is always set
 * before any validation runs; until then every non-null response fails closed.
 */
let wireResultFor: ((route: RouteName) => Schema<unknown>) | null = null;
/** Installs the route → response schema map (called once by ./wire). */
export function setWireResultFor(lookup: (route: RouteName) => Schema<unknown>): void {
  wireResultFor = lookup;
}

const phoneCallFields = {
  sessionId: ID,
  turnId: ID,
  twilioSid: nullable(str(34)),
  realtimeCallId: nullable(s128),
  accepted: bool,
};
const phoneTrackingFields = {
  carrier: nullable(obj({ status: oneOf(PHONE_CARRIER_STATUSES), observedAt: TS })),
  nextCarrierCheckAt: nullable(TS),
};

// Brief 024: what the Gate said, held, steered, declined or blocked, as IDs and codes, never words.
const GatePayload = obj({
  outcome: oneOf(GATE_OUTCOMES),
  candidateId: ID,
  refs: arr(Ref, 8),
  noteIds: arr(ID, 4),
  momentId: nullable(ID),
  sessionId: nullable(ID),
  turnId: nullable(ID),
  verdict: oneOf(GATE_VERDICTS),
  form: nullable(oneOf(GATE_FORMS)),
  render: nullable(oneOf(GATE_RENDERS)),
  carveOut: nullable(oneOf(GATE_CARVE_OUTS)),
  reasonCodes: arr(oneOf(GATE_REASONS), 16),
  audience: Au,
  permitKind: nullable(PermitKind),
  match: nullable(oneOf(SAID_MATCH)),
});

// Brief 024 (first-spoken-call questions 16 and 17, voice-control question 57): who issued the admission, its
// Permit kind, the judge's answer and whether it was a false hold. Decisions written before these fields have none
// of them; `decisionFields` reads either shape, filling nulls.
const DECISION_SHAPE = {
  purpose: Purpose,
  acceptedRefs: arr(Ref, 8),
  heldRefs: arr(Ref, 32),
  reasonCodes: arr(ReasonCode, 32),
  audience: Au,
};
const DECISION_ADMISSION_FIELDS = {
  issuer: nullable(oneOf(DECISION_ISSUERS)),
  permitKind: nullable(PermitKind),
  judge: nullable(oneOf(DECISION_JUDGES)),
  falseHold: nullable(bool),
};
export const DecisionPayload = union(obj({ ...DECISION_SHAPE, ...DECISION_ADMISSION_FIELDS }), obj(DECISION_SHAPE));

// Brief 042 item 6 (question W-166, brief 032's "Outcome"): one row per decision of the hard-rule route, as IDs,
// gazetteer codes and span offsets, never the owner's words. Each row cites the Evidence the decision was made on
// (a proposal's own Evidence when it is installed) and `rulesRev` after the write.
export const RULE_DECISIONS = ["ruleWritten", "pendingWritten", "pendingResolved", "ruleKept", "noneConfirmed", "proposalWritten", "proposalInstalled", "denialRecorded", "notAllergy"] as const;
/** Where a pending rule came from (brief 032 W-166 row 2), plus a pasted line's filter (brief 041 G-A2). */
export const PENDING_ORIGINS = ["verdict", "coverage", "fallback", "bound", "pasted"] as const;
/** Which writer made the decision. */
export const RULE_ROW_SOURCES = ["turn", "late", "pasted", "proposals", "open", "backstop", "repair"] as const;
/** At most this many rules, codes or subjects on one row; more go on further rows (`part`). */
export const RULE_ROW_ITEMS_MAX = 32;
export const RuleRowPayload = obj({
  decision: oneOf(RULE_DECISIONS),
  source: oneOf(RULE_ROW_SOURCES),
  eid: ID,
  sessionId: nullable(ID),
  turnId: nullable(ID),
  proposalId: nullable(ID),
  /** `pendingResolved`: whether a rule answered it or a denial removed it. */
  by: nullable(oneOf(["rule", "denial"])),
  /** `ruleKept`: why it was kept; only `denied` needs a row. */
  why: nullable(oneOf(["denied"])),
  rules: arr(
    obj({
      ruleId: ID,
      subjectId: nullable(EID),
      code: str(64, { min: 1 }),
      state: oneOf(["active", "pending"]),
      anonymous: bool,
      /** Offsets only: the quote is the owner's words. */
      proof: nullable(obj({ eid: ID, start: nat(), end: nat() })),
      origin: nullable(oneOf(PENDING_ORIGINS)),
      /** `pendingResolved` by a rule: the rule that answered it. */
      answeredBy: nullable(ID),
    }),
    RULE_ROW_ITEMS_MAX,
  ),
  codes: arr(str(64, { min: 1 }), RULE_ROW_ITEMS_MAX),
  /** `noneConfirmed`: each subject added or removed; `cleared` when an anonymous pending rule emptied the list. */
  subjects: arr(obj({ subjectId: EID, change: oneOf(["added", "removed"]) }), RULE_ROW_ITEMS_MAX),
  cleared: bool,
  rulesRev: nat(),
  part: nat(),
});
export type RuleRowPayload = Infer<typeof RuleRowPayload>;

// Brief 046 (lane plaid): one row per bank connect or disconnect, the audit entry for that side effect. IDs and
// closed codes only: never a token, a Plaid ID or a bank's words.
export const BANK_LEDGER_OPS = ["connect", "disconnect"] as const;
export const BANK_LEDGER_OUTCOMES = ["connected", "existing", "disconnected", "rejected", "unconfirmed", "notRemoved", "failed"] as const;
export const BankLedgerPayload = obj({
  op: oneOf(BANK_LEDGER_OPS),
  requestId: ID,
  connectorId: ID,
  outcome: nullable(oneOf(BANK_LEDGER_OUTCOMES)),
});
export type BankLedgerPayload = Infer<typeof BankLedgerPayload>;

// Brief 049 (lane google): one row per Google connect or disconnect, the audit entry for that side effect. Closed
// codes and what was granted only: never a token, a code, a state, a verifier or an address.
export const GOOGLE_LEDGER_OPS = ["connect", "disconnect"] as const;
export const GOOGLE_LEDGER_OUTCOMES = [
  "connected",
  "badState",
  "rejected",
  "unconfirmed",
  "noRefreshToken",
  "nothingGranted",
  "unexpectedScope",
  "badIdentity",
  "otherAccount",
  "disconnected",
  "notRevoked",
  /** Review S7: the stored token couldn't be opened (the sealing key changed), so it was erased without telling Google. */
  "disconnectedUntold",
  "failed",
] as const;
export const GoogleLedgerPayload = obj({
  op: oneOf(GOOGLE_LEDGER_OPS),
  requestId: ID,
  outcome: nullable(oneOf(GOOGLE_LEDGER_OUTCOMES)),
  mail: bool,
  calendar: bool,
});
export type GoogleLedgerPayload = Infer<typeof GoogleLedgerPayload>;
// Brief 049 part A (lane errands): one row per Errand started, the audit entry for that background job. IDs and
// closed codes only: never the assignment's words or anything the Errand found.
export const ErrandLedgerPayload = obj({
  errandId: ID,
  sessionId: ID,
  turnId: ID,
  about: arr(oneOf(ERRAND_ABOUT), 2, 1),
  agentIds: arr(str(64, { min: 1 }), 4),
});
export type ErrandLedgerPayload = Infer<typeof ErrandLedgerPayload>;

export const LEDGER_PAYLOADS = {
  phoneReport: obj({ sessionId: ID, turnId: ID, report: nullable(PhoneReport) }),
  // Tracking can be added to an older call, including one created before the indexed dial ID existed.
  phoneCall: union(
    obj({ ...phoneCallFields, phoneCallId: ID, ...phoneTrackingFields }),
    obj({ ...phoneCallFields, ...phoneTrackingFields }),
    obj({ ...phoneCallFields, phoneCallId: ID }),
    obj(phoneCallFields),
  ),
  request: obj({
    route: RouteName,
    keyHash: ID,
    requestHash: Hash,
    response: nullable(plainObject),
    error: nullable(ErrorCode),
  }),
  decision: DecisionPayload,
  action: obj({
    pendingId: ID,
    executor: oneOf(["makeReminder", "draftNote", "makeList", "holdTime"]),
    time: nullable(Time),
    note: nullable(str(2048)),
    items: arr(obj({ id: ID, label: str(256), state: oneOf(["open", "done"]) }), 128),
    externalReceipt: nullable(ID),
    loopId: nullable(ID),
  }),
  delivery: obj({
    momentId: ID,
    responseId: s128,
    admittedAt: TS,
    playbackAt: nullable(TS),
    permitKind: PermitKind,
    match: oneOf(SAID_MATCH),
  }),
  usage: obj({ jobId: nullable(ID), model: str(64), inputTokens: nat(), outputTokens: nat(), costMicros: nat() }),
  forgetReceipt: obj({
    opId: ID,
    blockedAt: nullable(TS),
    cleanupCompleteAt: nullable(TS),
    retainedRuleIds: arr(ID, 32),
    scopePending: bool,
    touched: arr(obj({ collection: SC, count: nat() }), 32),
    withdrawnCount: nat(),
  }),
  gate: GatePayload,
  rule: RuleRowPayload,
  // Brief 046.
  bank: BankLedgerPayload,
  // Brief 049 (lane google).
  google: GoogleLedgerPayload,
  // Brief 049 part A.
  errand: ErrandLedgerPayload,
} satisfies Record<LedgerKind, Schema<unknown>>;

const LedgerBase = obj({
  ...C_SHAPE,
  kind: oneOf(LEDGER_KINDS),
  state: oneOf(["pending", "complete", "failed", "blocked"]),
  at: TS,
  retainUntil: nullable(TS),
  payload: plainObject,
});

/** The payload union is discriminated by the entry's `kind`. */
export const Ledger = refine(LedgerBase, (e, path) => {
  const found = LEDGER_PAYLOADS[e.kind].check(e.payload, `${path}.payload`);
  if (found !== null || e.kind !== "request") return found;
  const p = e.payload as Infer<(typeof LEDGER_PAYLOADS)["request"]>;
  if (p.response === null) return null;
  const at = `${path}.payload.response`;
  if (wireResultFor === null) return issue(at, "wire schemas are not loaded");
  return wireResultFor(p.route).check(p.response, at);
});
type LedgerPayloads = { [K in LedgerKind]: Infer<(typeof LEDGER_PAYLOADS)[K]> };
export type Ledger = {
  [K in LedgerKind]: Omit<Infer<typeof LedgerBase>, "kind" | "payload"> & { kind: K; payload: LedgerPayloads[K] };
}[LedgerKind];

// ---------------------------------------------------------------------------------------------
// jobs/{jobId}

export const JOB_KINDS = [
  "extract",
  "ruleSalvage",
  "claims",
  "privateReadOwn",
  "privateReadInbound",
  "embed",
  "derive",
  "consolidate",
  "nightly",
  "sync",
  "forget",
  "purge",
  "rebuild",
  "hangup",
  "readPage",
  // Brief 049 part A: an Errand's run.
  "errand",
] as const;
export const JobKind = oneOf(JOB_KINDS);

const WorkJob = obj({
  kind: literal("work"),
  task: oneOf([
    "extract",
    "ruleSalvage",
    "claims",
    "privateReadOwn",
    "privateReadInbound",
    "embed",
    "derive",
    "consolidate",
    "nightly",
    "sync",
    "rebuild",
    "hangup",
    "readPage",
    // Brief 049 part A.
    "errand",
  ]),
  targets: arr(Ref, 32),
  class: nullable(Class),
  fields: arr(obj({ eid: ID, fieldPath: FP, base: nat(), end: nat() }), 32),
  cursor: obj({
    fieldIndex: nat(),
    offset: nat(),
    afterId: nullable(ID),
    leg: oneOf(["exact", "lex", "vector", "body", "inspect"]),
  }),
  query: nullable(RecallArgs),
});

const ForgetJob = obj({
  kind: literal("forget"),
  phase: oneOf(["fence", "close", "resolve", "install", "closure", "resume", "purge", "done"]),
  opId: ID,
  manifestComplete: bool,
  scopePending: bool,
  scopePendingId: nullable(ID),
  requestTurnIds: arr(ID, 8),
  candidateRefs: arr(Ref, 128),
  deadItems: arr(obj({ sessionId: ID, itemId: s128 }), 64),
  blockedKeys: arr(ID, 128),
  stagedSanitizedEids: arr(ID, 128),
  cursor: obj({ collection: SC, lastId: nullable(ID) }),
  closeCalls: arr(obj({ sessionId: ID, state: oneOf(["pending", "closed", "failed"]) }), 16),
  trustedRuleDeletes: arr(ID, 32),
  // Brief 047 (forget, part two). Jobs written before it read these as null and empty (`withForgetJobDefaults`).
  /** The queued op this one promoted when its closure ended, so the barrier passed to it rather than clearing. */
  handedTo: nullable(ID),
  /** What a fresh call owes the owner, as data (ruling 8); set by resume. */
  ack: nullable(
    tagged("kind", {
      gone: obj({ kind: literal("gone"), askAllergies: bool }),
      goneExceptRule: obj({ kind: literal("goneExceptRule"), ruleIds: arr(ID, 32, 1), askAllergies: bool }),
      ask: obj({ kind: literal("ask"), reason: oneOf(["ambiguous", "vague"]) }),
      offerRetell: obj({ kind: literal("offerRetell"), withdrawnCount: nat(1), askAllergies: bool }),
    }),
  ),
  /** At most four eligible sanitized turns of the request's Session a fresh call carries (spec §8 step 7). */
  carryTurnIds: arr(ID, 4),
  /** The request turns' own Evidence, kept from closure's first step: closure unlinks the turns, purge still needs it. */
  requestEids: arr(ID, 8),
});

/** A forget job's payload with the fields brief 047 added filled for jobs written before it. */
export function withForgetJobDefaults<P extends { kind: "forget" }>(p: P & { handedTo?: unknown; ack?: unknown; carryTurnIds?: unknown; requestEids?: unknown }) {
  return { ...p, handedTo: p.handedTo ?? null, ack: p.ack ?? null, carryTurnIds: p.carryTurnIds ?? [], requestEids: p.requestEids ?? [] };
}

export const JobShape = {
  ...C_SHAPE,
  kind: JobKind,
  status: oneOf(["queued", "leased", "retry", "complete", "failed", "blocked"]),
  priority: oneOf(["control", "interactive", "current", "bulk", "history"]),
  nextAttemptAt: TS,
  leaseUntil: nullable(TS),
  leaseToken: nullable(ID),
  generation: nat(),
  attempts: nat(),
  sourceIds: arr(ID, 8),
  inputRevs: arr(obj({ id: ID, rev: nat() }), 32),
  connectorId: nullable(ID),
  syncGeneration: nullable(nat()),
  payload: tagged("kind", { work: WorkJob, forget: ForgetJob }),
  resultRefs: arr(Ref, 32),
  error: nullable(ErrorCode),
  retainUntil: nullable(TS),
};
export const Job = obj(JobShape);
export type Job = Infer<typeof Job>;

// ---------------------------------------------------------------------------------------------
// core/{epoch,state,counters,rules,bundle}

export const QueuedControl = obj({
  opId: ID,
  kind: oneOf(["forget", "reset"]),
  requestRef: nullable(Ref),
  requestTurnIds: arr(ID, 8),
  capturedEpoch: nat(),
  capturedPolicyRev: nat(),
  queuedOpsAt: TS,
});

export const CoreEpoch = obj({
  ...C_SHAPE,
  barrier: nullable(
    obj({
      opId: ID,
      phase: oneOf(["fence", "close", "resolve", "install", "closure", "resume"]),
      startedAt: TS,
      deadline: TS,
      queuedOps: arr(QueuedControl, 32),
    }),
  ),
  activeSessionId: nullable(ID),
  activeCallId: nullable(s128),
  activeLeaseToken: nullable(ID),
  leaseUntil: nullable(TS),
});
export type CoreEpoch = Infer<typeof CoreEpoch>;

export const CoreState = refine(
  obj({
    ...C_SHAPE,
    audience: Au,
    audienceSessionId: nullable(ID),
    currentZone: Zone,
    homeZone: Zone,
    holidayLocale: str(16),
    memoryOn: bool,
    isolatedInputProven: bool,
    careSubjectIds: arr(EID, 32),
    lastInteractionAt: nullable(TS),
    modifiers: obj({ rushed: nullable(TS), crisis: nullable(TS) }),
    clockMode: oneOf(["live", "fixture"]),
    worldClock: nullable(TS),
    nextNightAt: TS,
    projectionDirty: bool,
    coverage: Cov,
    fixtureNamespace: nullable(ID),
    visitId: nullable(ID),
  }),
  (s, path) =>
    (s.worldClock !== null) !== (s.clockMode === "fixture")
      ? issue(`${path}.worldClock`, "worldClock is non-null exactly when clockMode is fixture")
      : null,
);
export type CoreState = Infer<typeof CoreState>;

export const CoreCounters = obj({
  ...C_SHAPE,
  day: CivilDate,
  reservedMicros: nat(),
  settledMicros: nat(),
  optionalCeilingMicros: nat(),
  heavy: nat(),
  senderAsks: arr(obj({ senderKey: ID, count: nat() }), 128),
  counts: arr(obj({ kind: oneOf(["ask", "offer", "speech", "connection", "decline"]), count: nat() }), 8),
  connectorOffers: arr(obj({ day: CivilDate, offered: nat(), accepted: nat() }), 31),
  warmth: obj({ sessionId: nullable(ID), turnsWithoutReference: nat() }),
});
export type CoreCounters = Infer<typeof CoreCounters>;

export const AllergyRule = obj({
  id: ID,
  subjectId: nullable(EID),
  code: str(64, { min: 1 }),
  state: oneOf(["active", "pending"]),
  anonymous: bool,
  proof: nullable(Span),
  proofRev: nullable(nat()),
  rootKeys: arr(ID, 16),
  dependsOn: arr(Dep, 32),
});

// ---------------------------------------------------------------------------------------------
// Wave B of brief 012 (brief 018 task B2). The on-turn hard-rule route keeps its state on `core/rules`, the one
// document it already writes, rather than on the Session or the Extract_Job (rulings in docs/briefs/018-report.md):
// subject labels (CQ 103), late proposals (G39, CQ 125), what the route handled per turn (section 5, CQ 108) and
// the open allergy question (6.4, CQ 106). Documents written before this read with defaults (`withRulesDefaults`).

/** What the on-turn route handled for one route of one turn (design section 5). */
export const OnTurnHandledRecord = obj({
  route: oneOf(["hardRule", "correct", "transition"]),
  outcome: oneOf(["ruleWritten", "ruleKept", "pendingWritten", "pendingKept", "pendingResolved", "denialRecorded", "notAllergy", "applied", "renamed", "retracted", "same", "careOnly", "deferred", "proposed"]),
  keys: arr(ID, 8),
  refs: arr(Ref, 16),
  ruleKeys: arr(obj({ subjectId: nullable(EID), code: str(64, { min: 1 }) }), 32),
});
/** The `handled` ring: the most recent turns' entries, by Evidence. */
export const HANDLED_RING_MAX = 16;
export const HandledEntry = obj({ eid: ID, turnId: ID, entries: arr(OnTurnHandledRecord, 3) });
/** A late hardRule result (a Parse_Repair's or the extraction backstop's), applied by the next turn or open (G39). */
export const PROPOSALS_MAX = 16;
export const RuleProposal = obj({ id: ID, origin: oneOf(["repair", "backstop"]), turnId: nullable(ID), eid: ID, install: arr(AllergyRule, 8) });
/** The open allergy question (design 6.4), for the Session it was asked in. */
export const AllergyAskRecord = tagged("kind", {
  none: obj({ kind: literal("none") }),
  planned: obj({ kind: literal("planned"), ruleId: ID, seq: nat() }),
  asked: obj({ kind: literal("asked"), ruleId: nullable(ID), askedSeq: nat(), attempts: nat() }),
});
export const RulesAsk = obj({ sessionId: nullable(ID), q: AllergyAskRecord });

export const CoreRules = obj({
  ...C_SHAPE,
  rulesRev: nat(),
  allergies: arr(AllergyRule, 256),
  standing: arr(obj({ id: ID, subjectId: EID, memoryRef: Ref, predicate: Pred, value: Value, ...L_SHAPE }), 128),
  rulePages: nat(0, 256),
  gazetteerVersion: str(32),
  noneConfirmed: arr(EID, 256),
  // Brief 018 task B2.
  subjectLabels: arr(obj({ subjectId: EID, label: str(80, { min: 1 }) }), 256),
  proposals: arr(RuleProposal, PROPOSALS_MAX),
  handled: arr(HandledEntry, HANDLED_RING_MAX),
  ask: RulesAsk,
});
export type CoreRules = Infer<typeof CoreRules>;

export const CoreBundle = obj({
  ...C_SHAPE,
  state: oneOf(["clean", "dirty", "blocked"]),
  bundleRev: nat(),
  rulesRev: nat(),
  head: nullable(Head),
  headHash: nullable(Hash),
  selectedRefs: arr(Ref, 128),
  compiledAt: nullable(TS),
  expiresAt: nullable(TS),
});
export type CoreBundle = Infer<typeof CoreBundle>;

export const CORE_DOC_IDS = ["epoch", "state", "counters", "rules", "bundle"] as const;
export type CoreDocId = (typeof CORE_DOC_IDS)[number];
export const CORE_DOCS = {
  epoch: CoreEpoch,
  state: CoreState,
  counters: CoreCounters,
  rules: CoreRules,
  bundle: CoreBundle,
} satisfies Record<CoreDocId, Schema<unknown>>;
export type CoreDocs = { epoch: CoreEpoch; state: CoreState; counters: CoreCounters; rules: CoreRules; bundle: CoreBundle };

// ---------------------------------------------------------------------------------------------
// effects/{effectId}, blocks/{blockId}, overlays/{overlayId} (contracts §1; forget, brief 021)

export const EFFECT_KINDS = ["exclude", "quiet", "careHold", "celebrationHold", "softPreference", "attentionBoost", "withdrawnHold"] as const;
export const HOLD_KINDS = ["exclude", "quiet", "careHold"] as const;

export const Effect = refine(
  obj({
    ...C_SHAPE,
    premiseIds: arr(Ref, 16),
    target: Ref,
    kind: oneOf(EFFECT_KINDS),
    scope: obj({
      domain: oneOf(["all", "food", "calendar", "care", "travel", "work"]),
      topicId: nullable(ID),
      subjectId: nullable(EID),
    }),
    state: oneOf(["active", "retracted", "expired", "blocked"]),
    createdBy: oneOf(["direct", "guess", "habit", "transition", "boundary"]),
    expiresAt: nullable(TS),
    nextReviewAt: TS,
    boundaryMode: nullable(oneOf(["unsolicited", "all_output"])),
    holdKind: nullable(oneOf(HOLD_KINDS)),
    contentFree: bool,
    minSens: Sens,
  }),
  (e, path) => {
    if (e.kind === "withdrawnHold") {
      if (!e.contentFree) return issue(`${path}.contentFree`, "a withdrawnHold is content-free");
      if (e.holdKind === null) return issue(`${path}.holdKind`, "a withdrawnHold names its hold kind");
      if (e.premiseIds.length > 0 || e.rootKeys.length > 0 || e.rootSlices.length > 0 || e.dependsOn.length > 0) {
        return issue(`${path}.premiseIds`, "a withdrawnHold has no premises, roots or dependencies");
      }
      return null;
    }
    if (e.contentFree) return issue(`${path}.contentFree`, "only a withdrawnHold is content-free");
    if (e.premiseIds.length === 0) return issue(`${path}.premiseIds`, "an effect names its premises");
    return null;
  },
);
export type Effect = Infer<typeof Effect>;

export const BLOCK_KINDS = ["root", "provider", "semantic", "topic", "negativeAssertion"] as const;

export const Block = obj({
  ...C_SHAPE,
  kind: oneOf(BLOCK_KINDS),
  state: oneOf(["active", "review"]),
  opId: ID,
  key: ID,
  boundaryMode: nullable(oneOf(["unsolicited", "all_output"])),
  rootKey: nullable(ID),
  providerKey: nullable(ID),
  entityId: nullable(EID),
  predicate: nullable(Pred),
  topicId: nullable(ID),
  claimSimHash: nullable(str(16)),
  allowedEvidenceId: nullable(ID),
  createdFrom: nullable(Ref),
  reviewAt: nullable(TS),
});
export type Block = Infer<typeof Block>;

export const Overlay = refine(
  obj({
    ...C_SHAPE,
    opId: ID,
    verb: oneOf(["redact", "replaceRole", "replaceTime", "withhold"]),
    targetRef: Ref,
    fieldPath: nullable(FP),
    start: nullable(nat()),
    end: nullable(nat()),
    replacementRef: nullable(Ref),
    sanitizedEid: nullable(ID),
    state: oneOf(["active", "materialized"]),
    minSens: Sens,
  }),
  (o, path) => {
    if ((o.start === null) !== (o.end === null)) return issue(`${path}.end`, "start and end must both be null or both set");
    if (o.start !== null && o.end !== null && o.start > o.end) return issue(`${path}.end`, "end is before start");
    if (o.verb === "redact" && (o.fieldPath === null || o.start === null)) return issue(`${path}.fieldPath`, "a redact names its range");
    return null;
  },
);
export type Overlay = Infer<typeof Overlay>;

// Brief 022 (lane hero): the loop's window, exported for the money patterns.

export const LoopWindow = Window;
export type LoopWindow = Infer<typeof Window>;
export type LoopRecord = Infer<typeof Loop>;

// ---------------------------------------------------------------------------------------------
// Brief 023 (lane seed, F6): moments/{momentId} (contracts §1 `moments`; design note 023).

import { Civil, Domain as MomentDomain } from "./primitives";

export const MOMENT_KINDS = [
  "wish",
  "checkIn",
  "expiryAsk",
  "ask",
  "commitmentDue",
  "review",
  "gap",
  "prepare",
  "connection",
  "celebrate",
  "griefAsk",
  "transition",
  "goalWake",
  "warmth",
  "insight",
  "door",
] as const;
export type MomentKind = (typeof MOMENT_KINDS)[number];
export const MOMENT_STATUSES = ["pending", "leased", "admitted", "delivered", "expired", "skipped", "cancelled"] as const;
export type MomentStatus = (typeof MOMENT_STATUSES)[number];
export const CANCEL_REASONS = ["revised", "closed", "expired", "policy", "forgotten", "declined"] as const;

/** contracts §1 CueTiming. */
export const CueTiming = tagged("basis", {
  fixed: obj({ basis: literal("fixed"), at: TS }),
  anchorDay: obj({ basis: literal("anchorDay"), anchorId: ID, dayOffset: signed, minute: int(0, 1439), zone: Zone }),
  anchorStart: obj({ basis: literal("anchorStart"), anchorId: ID, offsetMinutes: signed }),
  anchorEnd: obj({ basis: literal("anchorEnd"), anchorId: ID, offsetMinutes: signed }),
});

/** contracts §1 Auth. No floor writer; the field stays null there. */
export const MomentAuth = obj({
  subjectId: EID,
  topicId: ID,
  momentId: ID,
  wording: str(256),
  audience: Au,
  worldWindow: obj({ from: TS, to: TS }),
  expiresAt: TS,
  consumedOpsAt: nullable(TS),
  confirmRef: Ref,
  ...L_SHAPE,
});

export const MomentPayload = tagged("kind", {
  cue: obj({ kind: literal("cue"), noteRef: Ref, template: nullable(Tpl) }),
  ask: obj({ kind: literal("ask"), pendingId: ID }),
  offer: obj({ kind: literal("offer"), pendingId: ID, offer: oneOf(["makeReminder", "draftNote", "makeList", "holdTime"]) }),
  pattern: obj({ kind: literal("pattern"), rollupId: ID }),
  celebrate: obj({
    kind: literal("celebrate"),
    loopId: ID,
    before: nullable(signed),
    after: nullable(signed),
    delta: nullable(signed),
    unit: oneOf(["money", "count", "appraisal"]),
    currency: nullable(Currency),
  }),
});
export type MomentPayload = Infer<typeof MomentPayload>;

export const Moment = refine(
  obj({
    ...C_SHAPE,
    memoryId: nullable(ID),
    rollupId: nullable(ID),
    /** Design note 023 gap 3: a reminder's source is its ledger `makeReminder` action. */
    actionId: nullable(ID),
    kind: oneOf(MOMENT_KINDS),
    /** Design note 023 gap 2: the original civil start (or civil date) of the occurrence. */
    occurrenceKey: Civil,
    scheduleRev: nat(),
    domain: nullable(MomentDomain),
    clockMode: oneOf(["live", "fixture"]),
    backoffDays: nat(),
    uptakeEid: nullable(ID),
    cueTiming: nullable(CueTiming),
    cueTokens: arr(str(64), 8),
    status: oneOf(MOMENT_STATUSES),
    dueAt: TS,
    closeAt: TS,
    nextReviewAt: TS,
    anchorId: nullable(ID),
    subjectIds: arr(EID, 16, 1),
    topicIds: arr(ID, 16),
    authorized: nullable(MomentAuth),
    deliveryOverride: nullable(obj({ quietHours: bool, caps: bool, ...L_SHAPE })),
    payload: MomentPayload,
    leaseToken: nullable(ID),
    leaseUntil: nullable(TS),
    generation: nat(),
    attempts: nat(),
    admittedAt: nullable(TS),
    saidAt: nullable(TS),
    playbackAt: nullable(TS),
    responseId: nullable(s128),
    deliveryKey: ID,
    saidMatch: oneOf(SAID_MATCH),
    cancelReason: nullable(oneOf(CANCEL_REASONS)),
    /**
     * Brief 036 finding 6: the line this moment was put on the wire as, under its current lease (`noteId` binds the
     * lease and generation), and the tokens an `idTagged` match needs. The `said` match targets it. Null until
     * rendered; cleared by a re-plan or a new lease. Rows written before it read as null (`withMomentDefaults`).
     */
    // Brief 045 finding 12: a render records the Session and the pending ID it was sent with; a receipt counts only
    // for what was sent to its Session. Rows rendered before have neither, and no receipt counts for them.
    rendered: nullable(union(obj({ noteId: ID, text: str(1024), tokens: arr(str(64), 8), at: TS, sessionId: ID, pendingId: nullable(ID) }), obj({ noteId: ID, text: str(1024), tokens: arr(str(64), 8), at: TS }))),
  }),
  (m, path) => {
    const sources = [m.memoryId, m.rollupId, m.actionId].filter((s) => s !== null).length;
    if (sources !== 1) return issue(`${path}.memoryId`, "exactly one of memoryId, rollupId and actionId");
    if (m.closeAt < m.dueAt) return issue(`${path}.closeAt`, "closeAt is before dueAt");
    if ((m.status === "leased") !== (m.leaseToken !== null && m.leaseUntil !== null)) return issue(`${path}.leaseToken`, "a lease is set exactly while leased");
    if (m.saidAt !== null && (m.admittedAt === null || m.saidMatch === "none")) return issue(`${path}.saidAt`, "saidAt needs an admission and a match");
    if ((m.status === "cancelled") !== (m.cancelReason !== null)) return issue(`${path}.cancelReason`, "a cancel reason is set exactly when cancelled");
    return null;
  },
);
export type Moment = Infer<typeof Moment>;

/** A stored moment with the fields added after brief 023 filled: rows written before brief 036 have no `rendered`. */
export function withMomentDefaults(m: Omit<Moment, "rendered"> & { rendered?: Moment["rendered"] }): Moment {
  return { ...m, rendered: m.rendered ?? null };
}

// ---------------------------------------------------------------------------------------------
// Brief 046 (lane plaid): connectors/{connectorId} (contracts §1 `connectors`). The contract's fields, plus one
// nullable `bank` sub-object for a bank connection (ruling 3). `syncPages` is not built (contract: deferred); a pull
// is all or nothing instead (ruling 6).

export const CONNECTOR_PROVIDERS = ["gmail", "calendar", "plaid", "tasks"] as const;
export const CONNECTOR_STATES = ["connected", "syncing", "expired", "error", "disconnected"] as const;
export type ConnectorState = (typeof CONNECTOR_STATES)[number];
/** The closed set a bank's error maps to (brief 046 Part A). */
export const BANK_PROBLEMS = ["needsReconnect", "revoked", "transient"] as const;
export type BankProblem = (typeof BANK_PROBLEMS)[number];

/** An access token sealed with AES-256-GCM (ruling 2): base64url IV (12 bytes) and base64url ciphertext plus tag. */
export const SealedToken = obj({
  v: literal(1),
  iv: str(16, { min: 16, pattern: /^[A-Za-z0-9_-]{16}$/, label: "a base64url 12-byte IV" }),
  body: str(4096, { min: 22, pattern: /^[A-Za-z0-9_-]+$/, label: "base64url ciphertext and tag" }),
});
export type SealedToken = Infer<typeof SealedToken>;

export const BankAccount = obj({
  accountId: str(128, { min: 1 }),
  name: str(128),
  mask: nullable(str(8)),
  type: str(32),
  subtype: nullable(str(64)),
});
export type BankAccount = Infer<typeof BankAccount>;
export const BANK_ACCOUNTS_MAX = 32;

export const BankConnection = obj({
  itemId: str(128, { min: 1 }),
  institutionId: nullable(str(64)),
  institutionName: nullable(str(128)),
  accounts: arr(BankAccount, BANK_ACCOUNTS_MAX),
  /** Null once disconnected or revoked: the token is erased. */
  token: nullable(SealedToken),
  connectedAt: TS,
  /** Plaid reported the historical import complete; until then the connector is `syncing`. */
  historicalComplete: bool,
  problem: nullable(oneOf(BANK_PROBLEMS)),
  /** Rows the last completed pull skipped: no ISO currency, an amount not a whole number of cents, or no usable date. */
  lastPullSkipped: obj({ noCurrency: nat(), badAmount: nat(), badDate: nat() }),
});
export type BankConnection = Infer<typeof BankConnection>;

// Brief 049 (lane google) rulings 15 to 18. One Google account per owner, two documents (`gmail`, `calendar`). The
// refresh token is sealed per document (AAD label `franki-google-token`, bound to the owner and the connector). The
// one pending authorization lives on the `gmail` document only: the state's SHA-256 (never the state), the PKCE
// verifier sealed (AAD label `franki-google-verifier`), the redirect URI fixed at start, and its end.
export const GooglePending = obj({
  stateHash: Hash,
  verifier: SealedToken,
  redirectUri: str(256, { min: 1, pattern: /^https?:\/\/[A-Za-z0-9.:-]+\/google\/callback$/, label: "an origin and /google/callback" }),
  issuedAt: TS,
  expiresAt: TS,
});
export type GooglePending = Infer<typeof GooglePending>;

export const GoogleConnection = obj({
  /**
   * H(Google's `sub`) of the last account connected on this document, so a second account is recognised without
   * storing the raw ID. Null until a first connect; kept after disconnect and expiry, so a different account later
   * moves `activeGeneration` on and never reads the first one's rows (review S3).
   */
  accountKey: nullable(ID),
  /** The account's address from the ID token, shown on the sheet. Null until connected and after disconnect. */
  email: nullable(str(320)),
  /** This document's scope was granted on the last connect. */
  granted: bool,
  /** The refresh token, sealed for this document. Null when not granted, expired, revoked or disconnected. */
  token: nullable(SealedToken),
  connectedAt: nullable(TS),
  /** Only on the `gmail` document. */
  pending: nullable(GooglePending),
});
export type GoogleConnection = Infer<typeof GoogleConnection>;

export const Connector = obj({
  ...C_SHAPE,
  provider: oneOf(CONNECTOR_PROVIDERS),
  state: oneOf(CONNECTOR_STATES),
  activeGeneration: nat(),
  stagingGeneration: nullable(nat()),
  cursor: nullable(Content),
  coverage: Cov,
  nextPollAt: TS,
  watchExpiresAt: nullable(TS),
  quota: obj({ nextAllowedAt: TS, leaseUntil: nullable(TS), leaseToken: nullable(ID) }),
  lastSuccessAt: nullable(TS),
  lastError: nullable(ErrorCode),
  retainUntil: nullable(TS),
  bank: nullable(BankConnection),
  // Brief 049 (lane google) ruling 18: the Google part, beside `bank`.
  google: nullable(GoogleConnection),
});
export type Connector = Infer<typeof Connector>;

/**
 * A stored connector with brief 046's fields filled (the record-shape rule): a connector written with only the
 * contract's fields has no `bank` and reads as `bank: null`; a bank written before `lastPullSkipped` reads zeros.
 */
export function withConnectorDefaults(
  c: Omit<Connector, "bank" | "google"> & {
    bank?: (Omit<BankConnection, "lastPullSkipped"> & { lastPullSkipped?: BankConnection["lastPullSkipped"] }) | null;
    google?: GoogleConnection | null;
  },
): Connector {
  const bank = c.bank ?? null;
  return {
    ...c,
    bank: bank === null ? null : { ...bank, lastPullSkipped: bank.lastPullSkipped ?? { noCurrency: 0, badAmount: 0, badDate: 0 } },
    // Brief 049 (lane google): a connector written before the Google part has none.
    google: c.google ?? null,
  };
}

// ---------------------------------------------------------------------------------------------
// Brief 049 part A (lane errands): errands/{errandId}. One per Turn that asked (the ID is the Turn's), run by the Job
// of the same ID. The assignment is stored as Turn IDs, never words, so a forgotten Turn takes its words with it
// (ruling 2). `reads` is the Evidence this Errand's tools actually read; a result line rests only on these (ruling 8).

/** Review fix T10: connectors one Errand's reads may come from. */
export const ERRAND_CONNECTORS_MAX = 4;

export const ERRAND_STATUSES = ["running", "ready", "failed", "delivered", "cardOnly", "dropped"] as const;
export type ErrandStatus = (typeof ERRAND_STATUSES)[number];

/** What a card shows of one source (ruling 11): sender, subject and date for mail; title and time for an event. */
export const ErrandSource = tagged("kind", {
  mail: obj({ kind: literal("mail"), from: str(ERRAND_LABEL_CHARS), subject: str(ERRAND_LABEL_CHARS), at: TS, mailedByOwner: bool }),
  event: obj({ kind: literal("event"), title: str(ERRAND_LABEL_CHARS), startsAt: TS, allDay: bool }),
});
export type ErrandSource = Infer<typeof ErrandSource>;

/** Review fix V1: the sender of a mail read, as the agent knows it. `mailed`: the owner has mailed this address. */
export const ErrandSender = obj({ name: str(ERRAND_LABEL_CHARS), address: str(320), mailed: bool });
export type ErrandSender = Infer<typeof ErrandSender>;

export const ErrandRead = obj({
  ref: str(3, { min: 2, pattern: /^r[1-9]\d?$/, label: "an errand ref" }),
  evidenceId: ID,
  rev: nat(),
  /**
   * Review fix V1: what the agent read, as it stored it: its class and sensitivity, whether any of its text went to
   * the planner (`shown`), and for mail its sender. A run is tainted by every shown read, cited or not.
   */
  cls: Class,
  sens: Sens,
  shown: bool,
  sender: nullable(ErrandSender),
  source: ErrandSource,
});
export type ErrandRead = Infer<typeof ErrandRead>;

export const ErrandLine = obj({
  text: str(ERRAND_LINE_CHARS, { min: 1 }),
  refs: arr(str(3, { min: 2 }), ERRAND_LINE_REFS_MAX, 1),
  /**
   * After the run's taint (review fix V1): the lowest-trust class among its refs and the run's shown reads, and the
   * highest sensitivity over every shown read of the run.
   */
  cls: Class,
  sens: Sens,
  /** Code's attribution for a line that rests on third-party text ("From Dana Park, Tuesday:"); else null. */
  attribution: nullable(str(ERRAND_LABEL_CHARS + 32)),
  /** Review fix V1: whether the run's taint lets this line be spoken at all. False: card only. */
  speak: bool,
});
export type ErrandLine = Infer<typeof ErrandLine>;

/**
 * Review fix V2: the one offer of a waiting result that is out now. A result is `delivered` only on the `admitted`
 * receipt for this offer; offered again (attempt + 1) only once `expiresAt` has passed with no receipt.
 */
export const ErrandOffer = obj({
  attempt: nat(1),
  noteId: ID,
  turnId: ID,
  expiresAt: TS,
  /** What the offered line was, for the assistant Turn its transcript writes and its said row (review fix V11). */
  cls: Class,
  sens: Sens,
  text: str(1024, { min: 1 }),
});
export type ErrandOffer = Infer<typeof ErrandOffer>;

/** Review fix R1: the Gate's inputs, stored at `finish` so a poll rereads nothing to gate. Erased with the lines. */
export const ErrandGateInputs = obj({ certain: bool, aliases: arr(str(64, { min: 1 }), 64) });
export type ErrandGateInputs = Infer<typeof ErrandGateInputs>;

export const Errand = obj({
  ...C_SHAPE,
  sessionId: ID,
  turnId: ID,
  generation: nat(1),
  about: arr(oneOf(ERRAND_ABOUT), 2, 1),
  agentIds: arr(str(64, { min: 1 }), 4, 1),
  assignmentTurnIds: arr(ID, 4, 1),
  status: oneOf(ERRAND_STATUSES),
  /** The epoch when it was claimed. A forget moves the epoch, and nothing of an earlier epoch is said or shown. */
  claimedEpoch: nat(),
  startedAt: TS,
  readyAt: nullable(TS),
  endedAt: nullable(TS),
  reads: arr(ErrandRead, ERRAND_READS_MAX),
  outcome: nullable(oneOf(ERRAND_OUTCOMES)),
  /** Review fix T8: what code says for an outcome with no line; null otherwise. */
  notice: nullable(oneOf(ERRAND_NOTICES)),
  lines: arr(ErrandLine, ERRAND_LINES_MAX),
  /** Review fix V2: the offer out now, or null. */
  offer: nullable(ErrandOffer),
  /** Review fix V11: the response that admitted the line, for its transcript receipt. */
  saidResponseId: nullable(str(128, { min: 1 })),
  /** Review fix R1: the Gate's inputs, set at `finish`. */
  gate: nullable(ErrandGateInputs),
  /**
   * Review fix T10: the connectors (and their account generation) the rows it read came from, set at `finish`.
   * Delivery and cards recheck each is still connected on that generation; one that isn't drops the Errand.
   */
  connectors: arr(obj({ id: ID, generation: nat() }), ERRAND_CONNECTORS_MAX),
  /**
   * Review fix R12: until when this row may hold what the Errand found (its lines, reads and Gate inputs). Past it the
   * row is stripped bare and this is null; a bare row holds nothing a forget has to drop.
   */
  retainUntil: nullable(TS),
});
export type Errand = Infer<typeof Errand>;

/** Review fix R1: the most recent Errands one Session's mark names. */
export const ERRAND_MARK_IDS_MAX = 12;
/**
 * Review fix R1: errandMarks/{sessionId}. Written when an Errand of that Session starts, so the once-a-second state
 * poll reads one document it can name, and nothing at all for a Session that never started one. IDs and times only.
 */
export const ErrandMark = obj({
  ...C_SHAPE,
  sessionId: ID,
  errandIds: arr(ID, ERRAND_MARK_IDS_MAX, 1),
  /** Past this, no Errand of the Session has anything to run, say or show. */
  openUntil: TS,
});
export type ErrandMark = Infer<typeof ErrandMark>;
