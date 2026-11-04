/**
 * User Turn records (R19.4, R19.8, R20.1–R20.4, R20.8; design "Turn evidence", "One typed turn").
 * One Evidence per committed user Turn with a final transcript: `kind:"turn"`, `source:"voice"` (also used for
 * ordinary typed turns, contract question 12) or `"pasted"`, the whole LF-normalized text, and one whole-text
 * Slice with class U (or T for pasted text) and the lexicon Sensitivity floor.
 */
import {
  type ClockPair,
  type Evidence,
  type Hasher,
  type ID,
  type SafeTurn,
  type Turn,
  type TurnRequest,
  classifyTyped,
  idParts,
  normalizeLF,
  rootKey,
  tsFromMs,
  turnTextSlice,
} from "@franki/core";
import { cFields } from "./records";
import { evidenceId } from "./store/evidence";

export type TurnClass = { source: "voice" | "pasted"; turnSource: "voice" | "typed" | "pasted"; cls: "U" | "T" };

/** Server classification (R18.2, R18.3): ASR is U; typed text is pasted/T or ordinary/U by `classifyTyped`. */
export function classifyTurn(req: TurnRequest): TurnClass {
  if (req.source === "asr") return { source: "voice", turnSource: "voice", cls: "U" };
  const c = classifyTyped(req.transcript);
  return c.kind === "pasted" ? { source: "pasted", turnSource: "pasted", cls: "T" } : { source: "voice", turnSource: "typed", cls: "U" };
}

export const turnEvidenceId = (turnId: ID, hasher: Hasher): ID => evidenceId(hasher.id(idParts.evidenceLogical(turnId)), 1, hasher);

export interface UserTurnInit {
  uid: string;
  sessionId: ID;
  req: TurnRequest;
  /** LF-normalized transcript; empty for missing or failed transcripts. */
  text: string;
  cls: TurnClass;
  clock: ClockPair;
  core: { epoch: number; policyRev: number };
  hasher: Hasher;
}

/** The Turn and, for a final transcript, its Evidence. */
export function userTurnRecords(init: UserTurnInit): { turn: Turn; evidence: { eid: ID; record: Evidence } | null } {
  const { uid, sessionId, req, text, cls, clock, core, hasher } = init;
  const ops = tsFromMs(clock.opsClock.now);
  const world = tsFromMs(clock.worldClock.now);
  const items = [...req.items].sort((a, b) => a.commitSeq - b.commitSeq);
  const itemIds = items.map((i) => i.itemId);
  const final = req.transcriptState === "final";

  let evidence: { eid: ID; record: Evidence } | null = null;
  if (final) {
    const logicalId = hasher.id(idParts.evidenceLogical(req.turnId));
    const eid = evidenceId(logicalId, 1, hasher);
    const slice = turnTextSlice(eid, text, cls.cls, hasher);
    evidence = {
      eid,
      record: {
        ...cFields(uid, ops, core.epoch, core.policyRev),
        logicalId,
        revisionOf: null,
        sanitizedFrom: null,
        source: cls.source,
        providerKey: null,
        providerRevision: null,
        connectorId: null,
        generation: req.generation,
        threadKey: null,
        inReplyToProviderKey: null,
        closureProofs: [],
        kind: "turn",
        status: "retained",
        isCurrentProvider: true,
        occurredAt: world,
        assertedAt: world,
        receivedAt: ops,
        zone: clock.worldClock.zone,
        fieldSlices: [slice],
        body: null,
        bodyOwn: null,
        bodyQuoted: null,
        subject: null,
        title: null,
        description: null,
        text: { kind: "inline", text },
        sender: null,
        recipient: [],
        observation: { kind: "none" },
        authorId: cls.cls === "U" ? "self" : null,
        senderAddressKey: null,
        recipientAddressKeys: [],
        authorship: cls.cls === "U" ? "self" : "unknown",
        delivery: "unknown",
        senderAuth: "unknown",
        identityBinding: "none",
        route: cls.cls === "U" ? "direct" : "unknown",
        sessionId,
        turnId: req.turnId,
        itemIds,
        transcriptState: "complete",
        transcriptDeadline: null,
        controlTurn: false,
        extractPacketMode: "singleTurn",
        parserVersion: "turn-v1",
        copyRootKey: null,
        replacedProviderKey: null,
        sanitizeMap: [],
        purgedAt: null,
      },
    };
  }

  const turn: Turn = {
    ...cFields(uid, ops, core.epoch, core.policyRev),
    sessionId,
    seq: req.clientSeq,
    role: "user",
    itemIds,
    evidenceId: evidence?.eid ?? null,
    state: final ? "committed" : req.transcriptState === "missing" ? "transcriptMissing" : "failed",
    text: final ? text : null,
    committedAt: ops,
    audibleEndAt: null,
    transcriptDeadline: ops,
    judge: null,
    judgeResponseId: null,
    spokenResponseId: null,
    parseState: final ? "committed" : "failed",
    final,
    audioDurationMs: items.reduce((n, i) => n + i.audioDurationMs, 0),
    lastFragmentOpsAt: items.length > 0 ? items[items.length - 1]!.audioEndOpsAt : null,
    sourceClass: cls.cls,
    uncertainSpeaker: 0,
    noteIds: [],
    noteTokens: [],
    pendingId: null,
    momentIds: [],
    admittedAt: null,
    playbackAt: null,
    saidMatch: "none",
    retainUntil: null,
  };
  return { turn, evidence };
}

/** A SafeTurn from a committed Turn and its Evidence, or null when its Sensitivity keeps it off the wire. */
export function safeTurn(turnId: ID, turn: Turn, evidence: Evidence, eid: ID, hasher: Hasher): SafeTurn | null {
  const slice = evidence.fieldSlices[0];
  if (turn.text === null || slice === undefined || slice.sens === "S2") return null;
  return {
    turnId,
    role: turn.role,
    text: turn.text.slice(0, 2048),
    sens: slice.sens,
    rootKeys: [rootKey(slice, hasher)],
    dependsOn: [`e:${eid}`],
    policyRev: turn.policyRev,
  };
}

/** Normalizes and bounds a final transcript (R18.8, R20.2): 1 to 8192 code units after LF normalization. */
export function normalizedTranscript(raw: string): string | null {
  const text = normalizeLF(raw);
  if (text.trim().length === 0 || text.length > 8192) return null;
  return text;
}
