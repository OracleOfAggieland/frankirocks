/**
 * Wire schemas (contracts §6; R4.2; KC01) and the development DebugPage type (design "GET /api/debug/memory").
 * Wire TS is RFC3339 UTC. All objects are closed and every key is required (nullable keys hold null).
 */
import {
  Au,
  BrowserState,
  Cov,
  EID,
  ErrorCode,
  Head,
  ID,
  PREDICATES,
  Pred,
  ROLES,
  RecallArgs,
  Ref,
  type RouteName,
  SS,
  Sens,
  Slice,
  StateAck,
  TS,
  When,
  Zone,
} from "./primitives";
import { CoreBundle, CoreRules, Evidence, Job, Ledger, Memory, PermitKind, Session, Turn, setWireResultFor } from "./records";
import { type Infer, type Schema, arr, bool, literal, nat, nullable, obj, oneOf, str, tagged, union } from "./v";

const Oid = str(128, { min: 1 });
const RK = ID;
const s96 = str(96, { min: 1 });

// ---------------------------------------------------------------------------------------------
// Shared wire shapes

export const SS_SHAPE = SS.shape;
export const Stamp = obj({ ...SS_SHAPE, turnId: ID });
export type Stamp = Infer<typeof Stamp>;

export const SafeTurn = obj({
  turnId: ID,
  role: oneOf(["user", "assistant"]),
  text: str(2048),
  sens: Sens,
  rootKeys: arr(RK, 128),
  dependsOn: arr(s96, 256),
  policyRev: nat(),
});
export type SafeTurn = Infer<typeof SafeTurn>;

export const W = obj({
  noteId: ID,
  rev: nat(1),
  kind: oneOf(["truth", "moment", "result", "ack", "clarification"]),
  text: str(1024),
  rootKeys: arr(RK, 128),
  dependsOn: arr(s96, 256),
  sens: Sens,
  expiresAt: TS,
  unprompted: bool,
  momentId: nullable(ID),
  tokens: arr(str(64), 4),
});
export type W = Infer<typeof W>;

export const Card = obj({
  id: ID,
  kind: oneOf(["memory", "moment", "source", "why", "receipt", "rule", "ask", "food", "overview", "lab", "strip"]),
  title: str(160),
  lines: arr(str(512), 8),
  sources: arr(Ref, 32),
  sens: Sens,
});
export type Card = Infer<typeof Card>;

export const Deck = obj({
  epoch: nat(),
  policyRev: nat(),
  generation: nat(1),
  bundleRev: nat(),
  rulesRev: nat(),
  issuedAt: TS,
  expiresAt: TS,
  head: Head,
  whispers: arr(W, 4),
  noteWaiting: bool,
  turns: arr(SafeTurn, 4),
  cards: arr(Card, 2),
  activePlanId: nullable(ID),
});
export type Deck = Infer<typeof Deck>;

export const Permit = obj({
  permitId: ID,
  stamp: Stamp,
  kind: PermitKind,
  scope: oneOf(["reply", "food", "action", "ack"]),
  approvedPayloadHash: str(64, { min: 64, pattern: /^[0-9a-f]{64}$/, label: "64 lowercase hex characters" }),
  noteIds: arr(ID, 4),
  momentIds: arr(ID, 2),
  expiresAt: TS,
});
export type Permit = Infer<typeof Permit>;

export const ControlVerb = oneOf(["forget", "quiet", "correct", "company", "alone", "wrong", "deleteRule", "restore"]);

export const TurnRequest = obj({
  ...Stamp.shape,
  requestId: ID,
  clientSeq: nat(1),
  source: oneOf(["asr", "typed", "chip", "pasted", "trustedTap"]),
  items: arr(
    obj({ itemId: Oid, commitSeq: nat(1), final: bool, audioEndOpsAt: TS, audioDurationMs: nat(0, 60000) }),
    8,
  ),
  utteredWorldAt: TS,
  transcript: str(8192),
  transcriptState: oneOf(["final", "failed", "missing"]),
  judge: oneOf(["O", "H", "U", "timeout", "error", "typed"]),
  pendingId: nullable(ID),
  choiceId: nullable(ID),
  supersedesRequestId: nullable(ID),
  uiControl: nullable(obj({ verb: ControlVerb, targetIds: arr(ID, 32) })),
});
export type TurnRequest = Infer<typeof TurnRequest>;

export const TurnResponse = obj({
  requestId: ID,
  stamp: Stamp,
  status: oneOf(["ordinary", "ready", "hold", "blocked", "clarify", "stale"]),
  deck: nullable(Deck),
  permit: nullable(Permit),
  notes: arr(W, 4),
  cards: arr(Card, 2),
  pendingId: nullable(ID),
  question: nullable(str(512)),
  retryAfterMs: nat(0, 5000),
  receiptId: nullable(ID),
  error: nullable(ErrorCode),
});
export type TurnResponse = Infer<typeof TurnResponse>;

export const InspectItem = obj({
  id: ID,
  kind: oneOf(["evidence", "memory", "moment", "effect", "receipt", "rule"]),
  label: str(160),
  body: str(2048),
  status: oneOf(["active", "history", "wrong", "blocked", "pending", "cleaned"]),
  refs: arr(Ref, 32),
});
export type InspectItem = Infer<typeof InspectItem>;

export const WireError = obj({ error: ErrorCode, retryAfterMs: nat(0, 5000) });
export type WireError = Infer<typeof WireError>;

// Brief 045 finding 7: `asks` says the line asks for an answer (an offer or a question), so a typed screen, which has
// no way to answer it, neither shows nor admits it. Answers built before the field have none.
export const Proactive = union(obj({ turnId: ID, permit: Permit, whisper: W, cards: arr(Card, 2), asks: bool }), obj({ turnId: ID, permit: Permit, whisper: W, cards: arr(Card, 2) }));

export const SnapshotView = obj({
  cards: arr(Card, 50),
  overview: obj({
    topics: arr(obj({ predicate: Pred, count: nat() }), 24),
    guesses: nat(),
    heldPrivate: nat(),
    recentTold: arr(W, 2),
  }),
  coverage: Cov,
  truncated: bool,
  cursor: nullable(ID),
});

const LabView = obj({
  readEmails: nat(),
  privateGuesses: nat(),
  guessLinesSpoken: nat(),
  delivered: nat(),
  held: nat(),
  steered: nat(),
  declined: nat(),
  blocked: nat(),
  falseHolds: nat(),
  overForget: nat(),
  foodWithoutSuggest: nat(),
  coverage: Cov,
  limits: arr(str(256), 16),
});

const StripView = obj({
  loopId: nullable(ID),
  steps: arr(
    obj({
      kind: oneOf(["noticed", "connected", "suggested", "accepted", "comparison"]),
      state: oneOf(["pending", "complete"]),
      label: str(160),
      ledgerId: nullable(ID),
    }),
    5,
  ),
});

// ---------------------------------------------------------------------------------------------
// Agent tools

export const RecallCall = obj({ name: literal("recall"), args: RecallArgs });
export const PhoneCall = obj({ name: literal("make_phone_call"), args: obj({}) });
// Brief 022 (lane hero): `suggest` and `answer` (contracts §6 Tools). The server's food and hero-offer handlers are
// in packages/server/src/routes/tool-food.ts.
export const SuggestCall = obj({
  name: literal("suggest"),
  args: obj({
    domain: oneOf(["food", "time", "connection", "prepare"]),
    query: str(512),
    attendeeIds: arr(EID, 8),
    when: nullable(When),
    contextId: nullable(ID),
  }),
});
// Brief 040, item 2: a card's tap sends both IDs; a call sends both null, and code resolves the offer bound to the
// turn and reads the choice from the owner's own words (routes/tool-food.ts, answerTool). Contract question H-186.
export const AnswerCall = obj({ name: literal("answer"), args: obj({ pendingId: nullable(ID), choiceId: nullable(ID) }) });

export const ToolCall = tagged("name", { recall: RecallCall, make_phone_call: PhoneCall, suggest: SuggestCall, answer: AnswerCall });
export type ToolCall = Infer<typeof ToolCall>;

export const RecallResult = obj({
  name: literal("recall"),
  notes: arr(W, 4),
  coverage: Cov,
  truncated: bool,
  cursor: nullable(ID),
  pendingId: nullable(ID),
  snapshot: nullable(SnapshotView),
  cards: arr(Card, 2),
});
export const PhoneResult = obj({ name: literal("make_phone_call"), requestId: ID, message: str(512) });
export const SuggestResult = obj({
  name: literal("suggest"),
  candidateIds: arr(ID, 3),
  selectedId: nullable(ID),
  reason: str(160),
  pendingId: nullable(ID),
  question: nullable(str(512)),
  coverage: Cov,
  cards: arr(Card, 2),
});
export const AnswerResult = obj({
  name: literal("answer"),
  state: oneOf(["applied", "declined", "clarify", "stale"]),
  receiptId: nullable(ID),
  pendingId: nullable(ID),
  cards: arr(Card, 2),
});
export const ToolResult = tagged("name", { recall: RecallResult, make_phone_call: PhoneResult, suggest: SuggestResult, answer: AnswerResult });
export type ToolResult = Infer<typeof ToolResult>;

// The server reads the destination and assignment from the owner's turn.
export const PHONE_TOOL = {
  type: "function",
  name: "make_phone_call",
  description: "Place one outbound phone call for the signed-in user. Use only when the user explicitly asks you to dial now and gives one phone number in their current message. A ten-digit US number is complete as given: never ask for a country code or a +1. If no number was given, ask only for the number. Never guess a number or call for a hypothetical, future, quoted or negated request. Report the tool's actual result.",
  parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
} as const;

const nullableJson = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });
const EID_JSON = { type: "string", maxLength: 43 };

/**
 * The Realtime function definition for `recall` (contracts §6 Tools: description = name, parameters = exact args).
 * Strict JSON Schema: closed objects, every key required, nullable keys as `anyOf [T, null]`.
 */
export const RECALL_TOOL = {
  type: "function",
  name: "recall",
  description: "recall",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["purpose", "query", "entityRefs", "roleTuple", "predicate", "asOf", "anchorId", "sourceMode"],
    properties: {
      purpose: { type: "string", enum: ["answer", "plan", "why", "inspect"] },
      query: { type: "string", maxLength: 512 },
      entityRefs: {
        type: "array",
        maxItems: 8,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "label"],
          properties: { id: nullableJson(EID_JSON), label: nullableJson({ type: "string", maxLength: 120 }) },
        },
      },
      roleTuple: nullableJson({
        type: "object",
        additionalProperties: false,
        required: ["role", "entityId", "occasionId"],
        properties: {
          role: { type: "string", enum: [...ROLES] },
          entityId: EID_JSON,
          occasionId: nullableJson(EID_JSON),
        },
      }),
      predicate: nullableJson({ type: "string", enum: [...PREDICATES] }),
      asOf: nullableJson({ type: "string", maxLength: 80 }),
      anchorId: nullableJson({ type: "string", maxLength: 43 }),
      sourceMode: { type: "string", enum: ["canonical", "raw", "both"] },
    },
  },
} as const;

/**
 * Brief 022 (lane hero): the Realtime definitions for `suggest` and `answer`, strict JSON Schema like RECALL_TOOL.
 * In the voice machine's tool list since brief 040 (`CALL_TOOLS` in voice/machine.ts).
 */
export const SUGGEST_TOOL = {
  type: "function",
  name: "suggest",
  description: "suggest",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["domain", "query", "attendeeIds", "when", "contextId"],
    properties: {
      domain: { type: "string", enum: ["food", "time", "connection", "prepare"] },
      query: { type: "string", maxLength: 512 },
      attendeeIds: { type: "array", maxItems: 8, items: EID_JSON },
      when: { type: "null" },
      contextId: nullableJson({ type: "string", maxLength: 43 }),
    },
  },
} as const;

/**
 * Brief 040, item 2 (H-186): no parameters, as `make_phone_call` has none. The model never sees a pending ID or a
 * choice ID and is never asked for one; the call sends both null and code decides.
 */
export const ANSWER_TOOL = {
  type: "function",
  name: "answer",
  description: "answer",
  parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
} as const;

// ---------------------------------------------------------------------------------------------
// Routes (contracts §6 Routes). R=requestId, S=sessionId, G=generation.

const Seen = obj({ epoch: nat(), policyRev: nat(), bundleRev: nat(), rulesRev: nat() });

export const OpenRequest = obj({
  requestId: ID,
  initiator: oneOf(["user", "franki"]),
  previousSessionId: nullable(ID),
  clientZone: Zone,
  visitId: nullable(ID),
});
export const OpenResponse = obj({
  sessionId: ID,
  generation: nat(),
  deck: nullable(Deck),
  state: oneOf(["connecting", "blocked"]),
  ack: nullable(StateAck),
  proactive: nullable(Proactive),
  /** Brief 045 part S: the new Session's confirmed audience; null on a blocked open. */
  audience: nullable(Au),
});

export const SdpRequest = obj({ requestId: ID, sessionId: ID, generation: nat(), offerSdp: str(65536) });
export const SdpResponse = obj({ answerSdp: str(65536), sessionId: ID, generation: nat() });

export const StateRequest = obj({
  sessionId: ID,
  generation: nat(),
  seen: Seen,
  ackStamp: nullable(SS),
  speechStartedOpsAt: nullable(TS),
});
export const StateResponse = obj({
  stamp: SS,
  state: BrowserState,
  deck: nullable(Deck),
  ack: nullable(StateAck),
  barrierReceiptId: nullable(ID),
  proactive: nullable(Proactive),
  /** Brief 045 part S: the Session's confirmed audience, as the Gate reads it. */
  audience: nullable(Au),
});

export const CloseRequest = obj({
  requestId: ID,
  sessionId: ID,
  generation: nat(),
  reason: oneOf(["user", "replace", "expired", "error"]),
});
export const CloseResponse = obj({ state: oneOf(["closed", "closing"]) });

export const ToolRequest = obj({ requestId: ID, stamp: Stamp, callId: Oid, tool: ToolCall });
export const ToolResponse = obj({
  stamp: Stamp,
  callId: Oid,
  status: oneOf(["ready", "hold", "blocked", "stale"]),
  result: nullable(ToolResult),
  deck: nullable(Deck),
  permit: nullable(Permit),
});

export const ReceiptRequest = obj({
  requestId: ID,
  stamp: Stamp,
  responseId: Oid,
  kind: oneOf(["admitted", "playbackStarted", "playbackEnded", "cancelled", "transcript", "pendingRendered"]),
  momentIds: arr(ID, 2),
  noteIds: arr(ID, 4),
  pendingId: nullable(ID),
  permitKind: nullable(PermitKind),
  text: nullable(str(4096)),
});
export const ReceiptResponse = obj({ accepted: bool, controlCheck: oneOf(["pending", "none"]) });

/** Responses of routes outside this slice, so a stored request ledger entry is closed for every RouteName. */
const MemoryResponse = obj({
  items: arr(InspectItem, 50),
  snapshot: nullable(SnapshotView),
  lab: nullable(LabView),
  strip: nullable(StripView),
  nextCursor: nullable(ID),
  coverage: Cov,
  // Brief 030 P1-11: how many hard rules core/rules holds, as a count only (the jar's rule motes).
  hardRules: nat(),
});
const ResetResponse = obj({ fixtureNamespace: ID, worldClock: TS, sessionId: nullable(ID) });
// Brief 019: POST /api/seed/reset (contracts §6 Routes). Its response is the stored shape above; its request is
// `ResetRequest` below, the one wire type for it (brief 030).
export const SeedResetResponse = ResetResponse;
const AdvanceResponse = obj({ worldClock: TS, jobId: ID, proactive: nullable(Proactive), deck: nullable(Deck) });
const SeedEventResponse = obj({
  anchorId: ID,
  oldStart: TS,
  newStart: TS,
  scheduleRev: nat(),
  deck: nullable(Deck),
  cards: arr(Card, 2),
});

/** WireResult by route: the stored `request.response` must be that route's response type. */
export const RESPONSE_BY_ROUTE: Record<RouteName, Schema<unknown>> = {
  open: OpenResponse,
  sdp: SdpResponse,
  state: StateResponse,
  close: CloseResponse,
  turn: TurnResponse,
  tool: ToolResponse,
  receipt: ReceiptResponse,
  memory: MemoryResponse,
  control: TurnResponse,
  reset: ResetResponse,
  advance: AdvanceResponse,
  seedEvent: SeedEventResponse,
};
export const WireResult = union(...Object.values(RESPONSE_BY_ROUTE));

setWireResultFor((route) => RESPONSE_BY_ROUTE[route]);

// ---------------------------------------------------------------------------------------------
// Development debug route (design "GET /api/debug/memory"; R29). Not the contract's /api/memory.

export const DEBUG_SECTIONS = ["turns", "evidence", "memories", "jobs", "ledger", "head", "rules"] as const;
export const DebugSection = oneOf(DEBUG_SECTIONS);
export type DebugSection = Infer<typeof DebugSection>;

export const DebugRequest = obj({
  section: DebugSection,
  sessionId: nullable(ID),
  cursor: nullable(str(128, { min: 1 })),
});
export type DebugRequest = Infer<typeof DebugRequest>;

export const LINEAGE_FAILURES = [
  "missingEvidence",
  "sliceHashMismatch",
  "spanQuoteMismatch",
  "rootKeyMismatch",
  "missingDependsOn",
] as const;
export const LineageFailureKind = oneOf(LINEAGE_FAILURES);
export type LineageFailureKind = Infer<typeof LineageFailureKind>;

export const DebugLineage = obj({
  ok: bool,
  links: arr(obj({ slice: Slice, text: nullable(str(131072)) }), 128),
  failures: arr(obj({ kind: LineageFailureKind, index: nat(), eid: nullable(ID) }), 256),
});

// Brief 018 task B11 (brief 012 B11): the rules section. One item holds `core/rules` (rules, subject labels, open
// proposals, `noneConfirmed`, the open question) and the check of every proof span against its Evidence.
export const RULE_PROOF_STATES = ["verified", "none", "missingEvidence", "spanQuoteMismatch", "revMismatch"] as const;
export const DebugRuleProof = obj({
  ruleId: ID,
  /** A rule in `allergies`, or one an open proposal would install. */
  from: oneOf(["rule", "proposal"]),
  state: oneOf(RULE_PROOF_STATES),
});
export type DebugRuleProof = Infer<typeof DebugRuleProof>;

export const DebugItem = tagged("kind", {
  turn: obj({ kind: literal("turn"), id: ID, record: Turn }),
  evidence: obj({ kind: literal("evidence"), id: ID, record: Evidence }),
  memory: obj({ kind: literal("memory"), id: ID, record: Memory, lineage: DebugLineage }),
  job: obj({ kind: literal("job"), id: ID, record: Job }),
  ledger: obj({
    kind: literal("ledger"),
    id: ID,
    record: Ledger,
    /** "seam" for a server decision, "browser" for a recorded fastO (voice-control R13.4). */
    issuer: nullable(oneOf(["seam", "browser"])),
    /** From the cited request entry's response, or `fastO` from the decision's key; null for a hold. */
    permitKind: nullable(PermitKind),
    /** A slowOrdinary decision on a voice Turn whose stored judge is not O (R13.3). */
    falseHold: bool,
    /** The decision's turn Ref, for grouping by Turn (R13.4). */
    turnId: nullable(ID),
    /** The decision whose reply played: the fastO one when its Turn has one on this page. */
    played: bool,
  }),
  session: obj({ kind: literal("session"), id: ID, record: Session }),
  head: obj({ kind: literal("head"), id: literal("bundle"), record: CoreBundle }),
  // Brief 018 task B11.
  rules: obj({ kind: literal("rules"), id: literal("rules"), record: CoreRules, proofs: arr(DebugRuleProof, 384) }),
});
export type DebugItem = Infer<typeof DebugItem>;

/** The turns section's Session view (voice-control R13.5; design "Debug_Panel"). */
export const DebugSessionView = obj({
  sessionId: ID,
  /** The stored audience. */
  audience: Au,
  /** A `parseLease` holds: shown as "unknown (repair pending)". */
  repairPending: bool,
  /** User Turns of the Session with `parseState:"failed"`. */
  failedParses: nat(),
  /** While `committedParseSeq < lastClientSeq`: the user Turn at `committedParseSeq + 1` ("fastO off: parse gap"). */
  parseGapTurnId: nullable(ID),
});
export type DebugSessionView = Infer<typeof DebugSessionView>;

export const DebugPage = obj({
  section: DebugSection,
  items: arr(DebugItem, 50),
  nextCursor: nullable(str(128, { min: 1 })),
  coverage: Cov,
  /** Set on the turns section of a Session; null otherwise. */
  session: nullable(DebugSessionView),
});
export type DebugPage = Infer<typeof DebugPage>;

// ---------------------------------------------------------------------------------------------
// GET /api/memory (contracts §6 Routes; brief 020). The views the screen reads; the response shape above.

export const MEMORY_VIEWS = ["overview", "item", "why", "receipt", "lab", "strip"] as const;
export const MemoryView = oneOf(MEMORY_VIEWS);
export type MemoryView = Infer<typeof MemoryView>;
export const MemoryRequest = obj({ view: MemoryView, id: nullable(ID), cursor: nullable(ID) });
export type MemoryRequest = Infer<typeof MemoryRequest>;
export { LabView, MemoryResponse, StripView };
export type SnapshotView = Infer<typeof SnapshotView>;
export type LabView = Infer<typeof LabView>;
export type StripView = Infer<typeof StripView>;
export type MemoryResponse = Infer<typeof MemoryResponse>;

// ---------------------------------------------------------------------------------------------
// POST /api/seed/reset and /api/seed/advance (contracts §6 Routes; brief 027). The requests, and the responses
// declared above for the request ledger, exported for the browser's half.

// Brief 038 finding 3: the browser's zone travels with the reset, so a first clone (no open before it) is laid out in
// the visitor's zone. A missing or unknown zone is refused, never defaulted.
export const ResetRequest = obj({ requestId: ID, sessionId: nullable(ID), fixtureId: ID, visitId: ID, clientZone: Zone });
export type ResetRequest = Infer<typeof ResetRequest>;
export const AdvanceRequest = obj({ requestId: ID, fixtureNamespace: ID, to: TS });
export type AdvanceRequest = Infer<typeof AdvanceRequest>;
export { AdvanceResponse, ResetResponse };
export type ResetResponse = Infer<typeof ResetResponse>;
export type AdvanceResponse = Infer<typeof AdvanceResponse>;

// Brief 023: POST /api/seed/advance (contracts §6 Routes). Its response is the stored shape above.

// Its request is `AdvanceRequest` above, the one wire type for it (brief 030).
export const SeedAdvanceResponse = AdvanceResponse;
export type Proactive = Infer<typeof Proactive>;
