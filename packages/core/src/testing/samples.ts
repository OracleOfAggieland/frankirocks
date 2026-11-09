/**
 * Valid sample records for tests (pure). Each builder returns a fresh object that passes its schema.
 * Builders take overrides so tests can change one field at a time.
 */
import type { Evidence, Job, Ledger, Memory, Session, Turn, CoreDocs } from "../schema/records";
import type { Head, Slice } from "../schema/primitives";

/** A deterministic 43-character base64url ID for tests. */
export function testId(label: string | number): string {
  const base = `t${String(label)}`.replace(/[^A-Za-z0-9_-]/g, "_");
  return (base + "_".repeat(43)).slice(0, 43);
}

export const TEST_HASH = "0".repeat(64);
export const T0 = "2026-11-03T12:00:00.000Z";
export const UID = "owner-1";

export function commonFields(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    v: 1 as const,
    uid: UID,
    rev: 1,
    createdAt: T0,
    updatedAt: T0,
    epoch: 1,
    policyRev: 1,
    rootKeys: [] as string[],
    rootSlices: [] as Slice[],
    contextIds: [],
    packetEids: [] as string[],
    dependsOn: [] as string[],
    dirty: false,
    dependenciesComplete: true,
    ...overrides,
  };
}

export function sampleSlice(overrides: Partial<Slice> = {}): Slice {
  return {
    eid: testId("ev"),
    fieldPath: "text",
    start: 0,
    end: 5,
    contentHash: TEST_HASH,
    class: "U",
    sens: "S0",
    ...overrides,
  };
}

export function sampleEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    ...commonFields(),
    logicalId: testId("log"),
    revisionOf: null,
    sanitizedFrom: null,
    source: "voice",
    providerKey: null,
    providerRevision: null,
    connectorId: null,
    generation: 1,
    threadKey: null,
    inReplyToProviderKey: null,
    closureProofs: [],
    kind: "turn",
    status: "retained",
    isCurrentProvider: true,
    occurredAt: T0,
    assertedAt: T0,
    receivedAt: T0,
    zone: "America/Chicago",
    fieldSlices: [sampleSlice()],
    body: null,
    bodyOwn: null,
    bodyQuoted: null,
    subject: null,
    title: null,
    description: null,
    text: { kind: "inline", text: "hello" },
    sender: null,
    recipient: [],
    observation: { kind: "none" },
    authorId: "self",
    senderAddressKey: null,
    recipientAddressKeys: [],
    authorship: "self",
    delivery: "unknown",
    senderAuth: "unknown",
    identityBinding: "none",
    route: "direct",
    sessionId: testId("ses"),
    turnId: testId("turn"),
    itemIds: [],
    transcriptState: "complete",
    transcriptDeadline: null,
    controlTurn: false,
    extractPacketMode: "singleTurn",
    parserVersion: "turn-v1",
    copyRootKey: null,
    replacedProviderKey: null,
    sanitizeMap: [],
    purgedAt: null,
    ...overrides,
  };
}

export function sampleMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    ...commonFields({ rootKeys: [testId("root")], rootSlices: [sampleSlice()], packetEids: [testId("ev")], dependsOn: [`e:${testId("ev")}`] }),
    logicalId: testId("mem"),
    kind: "fact",
    subjectId: "self",
    predicate: "fact",
    scopeId: "global",
    key: testId("key"),
    value: { kind: "text", text: "My dog is called Pip" },
    args: { topic: "home", label: null },
    bindings: [],
    status: "active",
    sourceClass: "U",
    sens: "S0",
    closeReason: null,
    lastSupportAt: null,
    flow: "open",
    assertedAt: T0,
    validFrom: T0,
    validTo: null,
    validFromKey: T0,
    validFromKnown: true,
    when: { kind: "none" },
    time: null,
    endWhen: { kind: "standing" },
    nextReviewAt: "2027-11-03T12:00:00.000Z",
    replacesIds: [],
    supportingIds: [{ type: "evidence", id: testId("ev"), rev: 1 }],
    entityIds: [],
    topicIds: [],
    roleKeys: [],
    watchTokens: [],
    watches: [],
    anchorId: null,
    unboundStart: null,
    scheduleRev: 0,
    sayAs: null,
    texture: [],
    gravity: 0,
    closesId: null,
    possibleClosureSourceId: null,
    expectedArtifactId: null,
    embedding: null,
    vectorVersion: null,
    hypothesis: null,
    loop: null,
    ...overrides,
  };
}

export function sampleSession(overrides: Partial<Session> = {}): Session {
  return {
    ...commonFields(),
    status: "active",
    browserState: "LISTENING",
    generation: 1,
    startedBy: "user",
    callId: null,
    registeredCallIds: [],
    activeLeaseToken: null,
    startedAt: T0,
    lastTurnAt: T0,
    expiresAt: "2026-11-03T12:10:00.000Z",
    closedAt: null,
    waitDeadline: null,
    retainUntil: null,
    audience: "private",
    openedTopics: [],
    hiddenDisclosureGranted: [],
    committedItemIds: [],
    deadItemIds: [],
    lastClientSeq: 0,
    lastAdmittedSeq: 0,
    nextClientSeq: 1,
    committedParseSeq: 0,
    parseLease: null,
    lastSpeechStartedOpsAt: null,
    lastUserTurnOpsAt: null,
    stateAck: null,
    modifiers: { rushed: null, crisis: null },
    transitionCandidateSeq: null,
    lastCheckInAnswerSeq: null,
    headMode: "full",
    responseIds: [],
    outstandingTools: [],
    update: null,
    activePlanId: null,
    pendingId: null,
    warmthLeaseId: null,
    referenceCount: 0,
    ...overrides,
  };
}

export function sampleTurn(overrides: Partial<Turn> = {}): Turn {
  return {
    ...commonFields(),
    sessionId: testId("ses"),
    seq: 1,
    role: "user",
    itemIds: [],
    evidenceId: testId("ev"),
    state: "committed",
    text: "hello",
    committedAt: T0,
    audibleEndAt: null,
    transcriptDeadline: T0,
    judge: null,
    judgeResponseId: null,
    spokenResponseId: null,
    parseState: "committed",
    final: true,
    audioDurationMs: 0,
    lastFragmentOpsAt: null,
    sourceClass: "U",
    uncertainSpeaker: 0,
    noteIds: [],
    noteTokens: [],
    pendingId: null,
    momentIds: [],
    admittedAt: null,
    playbackAt: null,
    saidMatch: "none",
    retainUntil: null,
    ...overrides,
  };
}

export function sampleJob(overrides: Partial<Job> = {}): Job {
  return {
    ...commonFields(),
    kind: "extract",
    status: "queued",
    priority: "interactive",
    nextAttemptAt: T0,
    leaseUntil: null,
    leaseToken: null,
    generation: 0,
    attempts: 0,
    sourceIds: [testId("ev")],
    inputRevs: [{ id: testId("ev"), rev: 1 }],
    connectorId: null,
    syncGeneration: null,
    payload: {
      kind: "work",
      task: "extract",
      targets: [{ type: "evidence", id: testId("ev"), rev: 1 }],
      class: "U",
      fields: [],
      cursor: { fieldIndex: 0, offset: 0, afterId: null, leg: "exact" },
      query: null,
    },
    resultRefs: [],
    error: null,
    retainUntil: null,
    ...overrides,
  };
}

export function sampleLedgerDecision(): Ledger {
  return {
    ...commonFields(),
    kind: "decision",
    state: "complete",
    at: T0,
    retainUntil: null,
    payload: { purpose: "answer", acceptedRefs: [], heldRefs: [], reasonCodes: ["ok"], audience: "private" },
  };
}

export function sampleLedgerRequest(): Ledger {
  return {
    ...commonFields(),
    kind: "request",
    state: "complete",
    at: T0,
    retainUntil: "2026-11-04T12:00:00.000Z",
    payload: { route: "turn", keyHash: testId("key"), requestHash: TEST_HASH, response: null, error: null },
  };
}

export function sampleHead(): Head {
  const ids = ["persona", "policy", "rules", "now", "style", "people", "next72", "apply", "know", "openers"] as const;
  return { text: "You are Franki.", tokenCount: 4, selectedRefs: [], sections: ids.map((id) => ({ id, tokens: id === "persona" ? 4 : 0 })) };
}

/** The five core documents with the design's initial values. */
export function sampleCoreDocs(): CoreDocs {
  const c = commonFields();
  return {
    epoch: { ...c, barrier: null, activeSessionId: null, activeCallId: null, activeLeaseToken: null, leaseUntil: null },
    state: {
      ...c,
      audience: "private",
      audienceSessionId: null,
      currentZone: "UTC",
      homeZone: "UTC",
      holidayLocale: "US",
      memoryOn: true,
      isolatedInputProven: false,
      careSubjectIds: [],
      lastInteractionAt: null,
      modifiers: { rushed: null, crisis: null },
      clockMode: "live",
      worldClock: null,
      nextNightAt: "2026-11-04T12:00:00.000Z",
      projectionDirty: false,
      coverage: { state: "unknown", from: null, to: null, missingRanges: [], generation: 0 },
      fixtureNamespace: null,
      visitId: null,
    },
    counters: {
      ...c,
      day: "2026-11-03",
      reservedMicros: 0,
      settledMicros: 0,
      optionalCeilingMicros: 0,
      heavy: 0,
      senderAsks: [],
      counts: [],
      connectorOffers: [],
      warmth: { sessionId: null, turnsWithoutReference: 0 },
    },
    rules: { ...c, rulesRev: 1, allergies: [], standing: [], rulePages: 0, gazetteerVersion: "none", noneConfirmed: [] },
    bundle: {
      ...c,
      state: "dirty",
      bundleRev: 0,
      rulesRev: 1,
      head: null,
      headHash: null,
      selectedRefs: [],
      compiledAt: null,
      expiresAt: null,
    },
  };
}
