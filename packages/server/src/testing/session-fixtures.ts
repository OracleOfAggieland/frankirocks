/** Route-level fixtures: open a Session through the open route and build TurnRequest bodies. */
import type { CoreState, Deck, SS } from "@franki/core";
import { testId } from "@franki/core/testing";
import { openRoute } from "../routes/open";
import { paths } from "../store/paths";
import { type TestRig, callRoute } from "./fakes";

/**
 * The visit a browser on this tenant holds: the one its last reset stored, or none on a live account. On a clone an
 * open that names no visit is STALE (brief 045, finding 11), so a fixture opens as the browser does.
 */
export async function currentVisit(rig: TestRig, uid = "owner-1"): Promise<string | null> {
  return (await rig.store.get<CoreState>(uid, paths.core(uid, "state")))?.data.visitId ?? null;
}

export interface OpenedSession {
  sessionId: string;
  stamp: SS;
  deck: Deck;
}

export async function openTestSession(rig: TestRig, label = "open1", token?: string): Promise<OpenedSession> {
  const visitId = await currentVisit(rig, token === undefined ? "owner-1" : token.replace(/^token:/, ""));
  const res = await callRoute(
    rig,
    openRoute,
    { requestId: testId(label), initiator: "user", previousSessionId: null, clientZone: "UTC", visitId },
    token === undefined ? {} : { token },
  );
  if (res.status !== 200) throw new Error(`open failed: ${JSON.stringify(res.body)}`);
  const deck: Deck = res.body.deck;
  return {
    sessionId: res.body.sessionId,
    deck,
    stamp: { sessionId: res.body.sessionId, epoch: deck.epoch, policyRev: deck.policyRev, bundleRev: deck.bundleRev, rulesRev: deck.rulesRev, generation: 1 },
  };
}

export function typedTurn(stamp: SS, clientSeq: number, transcript: string, label: string | number = clientSeq) {
  return {
    ...stamp,
    turnId: testId(`turn-${label}`),
    requestId: testId(`req-${label}`),
    clientSeq,
    source: "typed",
    items: [],
    utteredWorldAt: "2026-11-03T12:00:00.000Z",
    transcript,
    transcriptState: "final",
    judge: "typed",
    pendingId: null,
    choiceId: null,
    supersedesRequestId: null,
    uiControl: null,
  };
}

export function asrTurn(
  stamp: SS,
  clientSeq: number,
  transcript: string,
  items: { itemId: string; commitSeq: number }[],
  transcriptState: "final" | "missing" | "failed" = "final",
  label: string | number = clientSeq,
) {
  return {
    ...typedTurn(stamp, clientSeq, transcript, label),
    source: "asr",
    judge: "timeout",
    transcriptState,
    items: items.map((i) => ({ ...i, final: true, audioEndOpsAt: "2026-11-03T12:00:00.000Z", audioDurationMs: 800 })),
  };
}
