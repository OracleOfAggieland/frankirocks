/**
 * @machine voice.turn (view, test-side)
 * What the current voice Turn is doing, read from the reducer's live fields (`turn`, `heldBack`,
 * `admittedTurnId`, `active`, `phase`). Brief 014, A3. Never written by the reducer: it is a reading of state, and
 * the property `turn-mode-legal.property.test.ts` says no illegal mode is produced outside its allow-list.
 *
 * Legal modes:
 *   none              no current Turn and nothing held back
 *   heldBack          no current Turn; an admitted Turn waits in `heldBack` for its transcript
 *   collecting        unposted voice Turn, waiting for its item, judged or speculated, or held for the slow path
 *   kept              unposted voice Turn kept in LISTENING after a barge-in; the next commit grows it
 *   admittedUnposted  unposted voice Turn whose reply is admitted now
 *   posted            the Turn's TurnRequest went out (`final`, `missing` or `failed`)
 * Illegal modes (each breaks one invariant, named in the allow-list of the property):
 *   admittedWithoutReply  `admittedTurnId` names the current Turn, but no reply of it is admitted
 *   replyWithoutTurn      an admitted reply with no current Turn
 *   admittedWithoutTurn   `admittedTurnId` is set, there is no current Turn and no reply is admitted
 *   unpostedInRecovery    an unposted voice Turn on the recovery screen, which ends it unposted
 *   unpostedSpeaking      an unposted, unadmitted Turn while a reply plays or a recall waits
 *   typedUnposted         a typed Turn that was not posted at once
 *   postedInListening     a posted Turn still current in LISTENING
 *   turnOutsideCall       a Turn in CLOSED, CONNECTING, CONFIGURING or connection recovery
 */
import type { VoiceState } from "../machine";

export const LEGAL_TURN_MODES = ["none", "heldBack", "collecting", "kept", "admittedUnposted", "posted"] as const;
export const ILLEGAL_TURN_MODES = [
  "admittedWithoutReply",
  "replyWithoutTurn",
  "admittedWithoutTurn",
  "unpostedInRecovery",
  "unpostedSpeaking",
  "typedUnposted",
  "postedInListening",
  "turnOutsideCall",
] as const;
export type LegalTurnMode = (typeof LEGAL_TURN_MODES)[number];
export type IllegalTurnMode = (typeof ILLEGAL_TURN_MODES)[number];
export type TurnMode = LegalTurnMode | IllegalTurnMode;

export function turnMode(st: VoiceState): TurnMode {
  const turn = st.turn;
  const outside = st.phase === "CLOSED" || st.phase === "CONNECTING" || st.phase === "CONFIGURING" || (st.phase === "RECOVERY" && st.recovery?.kind === "connection");
  if (turn === null) {
    // A reply still admitted is read first: admission always sets admittedTurnId, so testing the id first would
    // hide a dropped Turn under a playing reply.
    if (st.active !== null) return "replyWithoutTurn";
    if (st.admittedTurnId !== null) return "admittedWithoutTurn";
    return st.heldBack !== null ? "heldBack" : "none";
  }
  if (outside) return "turnOutsideCall";
  if (turn.posted !== null) return st.phase === "LISTENING" ? "postedInListening" : "posted";
  if (turn.source === "typed") return "typedUnposted";
  if (st.admittedTurnId === turn.turnId) return st.active !== null ? "admittedUnposted" : "admittedWithoutReply";
  switch (st.phase) {
    case "LISTENING":
      return "kept";
    case "WAIT_ITEM":
    case "JUDGING":
    case "SPECULATING":
    case "HELD":
      return "collecting";
    case "RECOVERY":
      return "unpostedInRecovery";
    case "SPEAKING":
    case "TOOL_WAIT":
    case "SWAPPING":
      return "unpostedSpeaking";
    case "CLOSED":
    case "CONNECTING":
    case "CONFIGURING":
      return "turnOutsideCall";
    default:
      st.phase satisfies never;
      return "turnOutsideCall";
  }
}

/**
 * Illegal modes the machine produces today, by the invariant each breaks. The list only shrinks: `turn-mode.test.ts`
 * fails when an entry is no longer reached, so a fix that makes a mode unreachable removes its entry here.
 */
export const TURN_MODES_ALLOWED: Partial<Record<IllegalTurnMode, string>> = {
  admittedWithoutReply: "admittedTurnId names the Turn whose reply is admitted now (a higher Deck or an error cuts the reply and leaves the id)",
  admittedWithoutTurn: "admittedTurnId names the Turn whose reply is admitted now (the cut Turn is dropped and the id stays)",
  unpostedInRecovery: "a Turn still waiting for its words is never shown the recovery screen, which ends it unposted",
};

export const isIllegalTurnMode = (m: TurnMode): m is IllegalTurnMode => (ILLEGAL_TURN_MODES as readonly string[]).includes(m);
