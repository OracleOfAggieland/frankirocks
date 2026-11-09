import { describe, expect, it } from "vitest";
import {
  T0,
  TEST_HASH,
  sampleCoreDocs,
  sampleHead,
  sampleLedgerRequest,
  sampleMemory,
  sampleSlice,
  sampleTurn,
  testId,
} from "../testing/samples";
import { Head, RecallArgs, SS, StateAck } from "./primitives";
import { Ledger } from "./records";
import {
  Card,
  CloseRequest,
  CloseResponse,
  DebugPage,
  DebugRequest,
  Deck,
  InspectItem,
  OpenRequest,
  OpenResponse,
  Permit,
  RECALL_TOOL,
  ReceiptRequest,
  ReceiptResponse,
  SafeTurn,
  SdpRequest,
  SdpResponse,
  Stamp,
  StateRequest,
  StateResponse,
  ToolCall,
  ToolRequest,
  ToolResponse,
  ToolResult,
  TurnRequest,
  TurnResponse,
  W,
  WireError,
} from "./wire";
import { type Schema, validate } from "./v";

const ss = { sessionId: testId("ses"), epoch: 1, policyRev: 1, bundleRev: 1, rulesRev: 1, generation: 1 };
const stamp = { ...ss, turnId: testId("turn") };
const ack = { stamp: ss, issuedOpsAt: T0, expiresOpsAt: "2026-11-03T12:00:02.500Z" };
const w = {
  noteId: testId("note"),
  rev: 1,
  kind: "result",
  text: "Your dog is called Pip.",
  rootKeys: [],
  dependsOn: [],
  sens: "S0",
  expiresAt: T0,
  unprompted: false,
  momentId: null,
  tokens: [],
};
const safeTurn = { turnId: testId("turn"), role: "user", text: "hi", sens: "S0", rootKeys: [], dependsOn: [], policyRev: 1 };
const card = { id: testId("card"), kind: "memory", title: "Pip", lines: ["dog"], sources: [], sens: "S0" };
const deck = {
  epoch: 1,
  policyRev: 1,
  generation: 1,
  bundleRev: 1,
  rulesRev: 1,
  issuedAt: T0,
  expiresAt: "2026-11-03T12:01:00.000Z",
  head: sampleHead(),
  whispers: [w],
  noteWaiting: false,
  turns: [safeTurn],
  cards: [card],
  activePlanId: null,
};
const permit = {
  permitId: testId("permit"),
  stamp,
  kind: "slowOrdinary",
  scope: "reply",
  approvedPayloadHash: TEST_HASH,
  noteIds: [],
  momentIds: [],
  expiresAt: "2026-11-03T12:00:10.000Z",
};
const turnRequest = {
  ...stamp,
  requestId: testId("req"),
  clientSeq: 1,
  source: "asr",
  items: [{ itemId: "item_1", commitSeq: 1, final: true, audioEndOpsAt: T0, audioDurationMs: 1200 }],
  utteredWorldAt: T0,
  transcript: "My dog is called Pip",
  transcriptState: "final",
  judge: "timeout",
  pendingId: null,
  choiceId: null,
  supersedesRequestId: null,
  uiControl: null,
};
const turnResponse = {
  requestId: testId("req"),
  stamp,
  status: "ordinary",
  deck,
  permit,
  notes: [],
  cards: [],
  pendingId: null,
  question: null,
  retryAfterMs: 0,
  receiptId: null,
  error: null,
};
const recallArgs = {
  purpose: "answer",
  query: "dog name",
  entityRefs: [{ id: null, label: "dog" }],
  roleTuple: null,
  predicate: null,
  asOf: null,
  anchorId: null,
  sourceMode: "canonical",
};
const coverage = { state: "complete", from: null, to: null, missingRanges: [], generation: 0 };
const toolResult = { name: "recall", notes: [w], coverage, truncated: false, cursor: null, pendingId: null, snapshot: null, cards: [] };

/** [name, schema, valid, invalid value, path of the invalid field] */
const CASES: [string, Schema<unknown>, unknown, unknown, string][] = [
  ["Head", Head, sampleHead(), { ...sampleHead(), text: "x".repeat(14001) }, "$.text"],
  ["SS", SS, ss, { ...ss, generation: 0 }, "$.generation"],
  ["Stamp", Stamp, stamp, { ...ss }, "$.turnId"],
  ["StateAck", StateAck, ack, { ...ack, issuedOpsAt: "now" }, "$.issuedOpsAt"],
  ["W", W, w, { ...w, kind: "rumor" }, "$.kind"],
  ["SafeTurn", SafeTurn, safeTurn, { ...safeTurn, text: "x".repeat(2049) }, "$.text"],
  ["Card", Card, card, { ...card, lines: Array(9).fill("l") }, "$.lines"],
  ["Deck", Deck, deck, { ...deck, turns: Array(5).fill(safeTurn) }, "$.turns"],
  ["Permit", Permit, permit, { ...permit, kind: "judgeO" }, "$.kind"],
  ["TurnRequest", TurnRequest, turnRequest, { ...turnRequest, clientSeq: 0 }, "$.clientSeq"],
  ["TurnRequest items", TurnRequest, { ...turnRequest, items: [] }, { ...turnRequest, items: [{ ...turnRequest.items[0], audioDurationMs: 60001 }] }, "$.items[0].audioDurationMs"],
  ["TurnResponse", TurnResponse, turnResponse, { ...turnResponse, retryAfterMs: 5001 }, "$.retryAfterMs"],
  [
    "InspectItem",
    InspectItem,
    { id: testId("m"), kind: "memory", label: "Pip", body: "dog", status: "active", refs: [] },
    { id: testId("m"), kind: "memory", label: "Pip", body: "dog", status: "active", refs: [], extra: 1 },
    "$.extra",
  ],
  ["Error", WireError, { error: "LIMIT", retryAfterMs: 1000 }, { error: "TEAPOT", retryAfterMs: 0 }, "$.error"],
  [
    "OpenRequest",
    OpenRequest,
    { requestId: testId("r"), initiator: "user", previousSessionId: null, clientZone: "America/Chicago", visitId: null },
    { requestId: testId("r"), initiator: "user", previousSessionId: null, clientZone: "Nowhere/Land", visitId: null },
    "$.clientZone",
  ],
  [
    "OpenResponse",
    OpenResponse,
    { sessionId: testId("s"), generation: 1, deck, state: "connecting", ack, proactive: null },
    { sessionId: testId("s"), generation: 1, deck, state: "open", ack, proactive: null },
    "$.state",
  ],
  [
    "SdpRequest",
    SdpRequest,
    { requestId: testId("r"), sessionId: testId("s"), generation: 1, offerSdp: "v=0" },
    { requestId: testId("r"), sessionId: testId("s"), generation: 1, offerSdp: "x".repeat(65537) },
    "$.offerSdp",
  ],
  ["SdpResponse", SdpResponse, { answerSdp: "v=0", sessionId: testId("s"), generation: 1 }, { answerSdp: 1, sessionId: testId("s"), generation: 1 }, "$.answerSdp"],
  [
    "StateRequest",
    StateRequest,
    { sessionId: testId("s"), generation: 1, seen: { epoch: 1, policyRev: 1, bundleRev: 1, rulesRev: 1 }, ackStamp: ss, speechStartedOpsAt: null },
    { sessionId: testId("s"), generation: 1, seen: { epoch: 1, policyRev: 1, bundleRev: 1 }, ackStamp: null, speechStartedOpsAt: null },
    "$.seen.rulesRev",
  ],
  [
    "StateResponse",
    StateResponse,
    { stamp: ss, state: "LISTENING", deck, ack, barrierReceiptId: null, proactive: null },
    { stamp: ss, state: "DREAMING", deck, ack, barrierReceiptId: null, proactive: null },
    "$.state",
  ],
  [
    "CloseRequest",
    CloseRequest,
    { requestId: testId("r"), sessionId: testId("s"), generation: 1, reason: "user" },
    { requestId: testId("r"), sessionId: testId("s"), generation: 1, reason: "bored" },
    "$.reason",
  ],
  ["CloseResponse", CloseResponse, { state: "closing" }, { state: "closing", extra: true }, "$.extra"],
  ["ToolCall (recall)", ToolCall, { name: "recall", args: recallArgs }, { name: "suggest", args: recallArgs }, "$.name"],
  ["RecallArgs", RecallArgs, recallArgs, { ...recallArgs, entityRefs: Array(9).fill({ id: null, label: null }) }, "$.entityRefs"],
  ["ToolResult (recall)", ToolResult, toolResult, { ...toolResult, notes: Array(5).fill(w) }, "$.notes"],
  [
    "ToolRequest",
    ToolRequest,
    { requestId: testId("r"), stamp, callId: "call_1", tool: { name: "recall", args: recallArgs } },
    { requestId: testId("r"), stamp, callId: "", tool: { name: "recall", args: recallArgs } },
    "$.callId",
  ],
  [
    "ToolResponse",
    ToolResponse,
    { stamp, callId: "call_1", status: "ready", result: toolResult, deck: null, permit },
    { stamp, callId: "call_1", status: "done", result: null, deck: null, permit: null },
    "$.status",
  ],
  [
    "ReceiptRequest",
    ReceiptRequest,
    { requestId: testId("r"), stamp, responseId: "resp_1", kind: "transcript", momentIds: [], noteIds: [], pendingId: null, permitKind: "slowOrdinary", text: "Pip." },
    { requestId: testId("r"), stamp, responseId: "resp_1", kind: "transcript", momentIds: [], noteIds: [], pendingId: null, permitKind: null, text: "x".repeat(4097) },
    "$.text",
  ],
  ["ReceiptResponse", ReceiptResponse, { accepted: true, controlCheck: "none" }, { accepted: "yes", controlCheck: "none" }, "$.accepted"],
  ["DebugRequest", DebugRequest, { section: "memories", sessionId: null, cursor: null }, { section: "secrets", sessionId: null, cursor: null }, "$.section"],
  [
    "DebugPage",
    DebugPage,
    {
      section: "memories",
      items: [
        {
          kind: "memory",
          id: testId("m"),
          record: sampleMemory(),
          lineage: { ok: true, links: [{ slice: sampleSlice(), text: "hello" }], failures: [] },
        },
        { kind: "turn", id: testId("t"), record: sampleTurn() },
        { kind: "head", id: "bundle", record: sampleCoreDocs().bundle },
      ],
      nextCursor: null,
      coverage,
    },
    {
      section: "memories",
      items: [{ kind: "memory", id: testId("m"), record: sampleMemory(), lineage: { ok: false, links: [], failures: [{ kind: "vibes", index: 0, eid: null }] } }],
      nextCursor: null,
      coverage,
    },
    "$.items[0].lineage.failures[0].kind",
  ],
];

describe.each(CASES)("%s", (_name, schema, valid, invalid, path) => {
  it("accepts a valid value unchanged", () => {
    const result = validate(schema, valid);
    expect(result).toEqual({ ok: true, value: valid });
  });
  it("rejects an invalid value with the field path", () => {
    const result = validate(schema, invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("invalidInput");
      expect(result.path).toBe(path);
    }
  });
});

describe("Ledger request response is the route's closed WireResult", () => {
  const entry = sampleLedgerRequest();
  const withResponse = (route: string, response: unknown) => ({ ...entry, payload: { ...entry.payload, route, response } });

  it("accepts a TurnResponse for route turn", () => expect(validate(Ledger, withResponse("turn", turnResponse)).ok).toBe(true));
  it("rejects a CloseResponse for route turn", () => {
    const result = validate(Ledger, withResponse("turn", { state: "closed" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.path.startsWith("$.payload.response")).toBe(true);
  });
  it("rejects an unknown key inside the stored response", () => {
    const result = validate(Ledger, withResponse("close", { state: "closed", note: "x" }));
    expect(result).toMatchObject({ ok: false, path: "$.payload.response.note" });
  });
});

describe("recall tool definition", () => {
  it("lists exactly the RecallArgs keys, all required, closed", () => {
    const keys = Object.keys(RecallArgs.shape).sort();
    expect(Object.keys(RECALL_TOOL.parameters.properties).sort()).toEqual(keys);
    expect([...RECALL_TOOL.parameters.required].sort()).toEqual(keys);
    expect(RECALL_TOOL.parameters.additionalProperties).toBe(false);
    expect(RECALL_TOOL.description).toBe(RECALL_TOOL.name);
  });
});
