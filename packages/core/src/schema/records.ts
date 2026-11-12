/**
 * Stored record schemas (contracts §1; R4.1, R4.3–R4.5, R4.8, R4.11; KC01).
 * Every tenant row carries the Common_Fields C. Document IDs (eid, mid, sessionId, ...) are path segments,
 * not fields, as in contracts §1.
 */
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

const LEDGER_KINDS = ["request", "decision", "action", "delivery", "usage", "forgetReceipt", "phoneCall"] as const;
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

export const LEDGER_PAYLOADS = {
  // Earlier calls have no indexed call ID. Their receipts remain readable and replayable.
  phoneCall: union(obj({ ...phoneCallFields, phoneCallId: ID }), obj(phoneCallFields)),
  request: obj({
    route: RouteName,
    keyHash: ID,
    requestHash: Hash,
    response: nullable(plainObject),
    error: nullable(ErrorCode),
  }),
  decision: obj({
    purpose: Purpose,
    acceptedRefs: arr(Ref, 8),
    heldRefs: arr(Ref, 32),
    reasonCodes: arr(ReasonCode, 32),
    audience: Au,
  }),
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
});

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
