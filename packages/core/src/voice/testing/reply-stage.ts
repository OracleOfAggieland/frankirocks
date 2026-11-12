/**
 * @machine voice.reply (view, test-side)
 * Where the current reply is, read from the reducer's four reply slots (`judge`, `spec`, `pending`, `active`), the
 * phase and the output mute. Brief 014, A3. Never written by the reducer: it is a reading of state, and the
 * property `reply-stage-legal.property.test.ts` says no illegal stage is produced outside its allow-list.
 *
 * Legal stages:
 *   offCall             CLOSED, CONNECTING, CONFIGURING or connection recovery, with every slot empty
 *   idle                in a call, every slot empty, not on the recovery screen
 *   judgeOnly           JUDGING: the judge runs and nothing speculates (the Deck has a note waiting)
 *   racing              SPECULATING: the judge has no verdict yet, the muted speculative reply runs
 *   oAwaitingHash       SPECULATING: the judge said O; the speculative payload's hash is not back
 *   fastOVerifying      a fastO Permit is being checked
 *   serverVerifying     a server Permit is being checked
 *   heldSlow            HELD with every slot empty: waiting for the server's answer
 *   admittedNotCreated  an admitted reply whose `response.create` has no response yet
 *   admittedMuted       an admitted reply, created, its audio not started
 *   speaking            SPEAKING, audio started and output unmuted
 *   toolWait            an admitted reply waits for its recall
 *   recoveryLine        the recovery screen (`kind: "line"`), with or without its neutral line
 * Illegal stages (each breaks one invariant, named in the allow-list of the property):
 *   audibleOutsideSpeaking  output is unmuted outside SPEAKING with started audio
 *   pendingAndActive        a Permit is being checked while another reply is admitted
 *   specOutsideSpeculating  a speculative reply outside SPECULATING
 *   judgeOutsideJudging     a judge outside JUDGING and SPECULATING
 *   slotsOffCall            a reply slot is filled outside a live call
 *   activeForOtherTurn      the admitted reply belongs to a Turn other than `admittedTurnId`
 *   pendingWithoutWait      a Permit is being checked with no wait armed to end the check
 *   audioUnheard            a reply's audio started while the phase is not SPEAKING or the output is muted
 *   speakingWithoutReply    SPEAKING or TOOL_WAIT with no admitted reply
 *   judgingWithoutJudge     JUDGING with no judge running
 *   speculatingWithoutSpec  SPECULATING with no speculative reply
 */
import type { VoiceState } from "../machine";

export const LEGAL_REPLY_STAGES = [
  "offCall",
  "idle",
  "judgeOnly",
  "racing",
  "oAwaitingHash",
  "fastOVerifying",
  "serverVerifying",
  "heldSlow",
  "admittedNotCreated",
  "admittedMuted",
  "speaking",
  "toolWait",
  "recoveryLine",
] as const;
export const ILLEGAL_REPLY_STAGES = [
  "audibleOutsideSpeaking",
  "pendingAndActive",
  "specOutsideSpeculating",
  "judgeOutsideJudging",
  "slotsOffCall",
  "activeForOtherTurn",
  "pendingWithoutWait",
  "audioUnheard",
  "speakingWithoutReply",
  "judgingWithoutJudge",
  "speculatingWithoutSpec",
] as const;
export type LegalReplyStage = (typeof LEGAL_REPLY_STAGES)[number];
export type IllegalReplyStage = (typeof ILLEGAL_REPLY_STAGES)[number];
export type ReplyStage = LegalReplyStage | IllegalReplyStage;

export function replyStage(st: VoiceState): ReplyStage {
  const { judge, spec, pending, active, phase } = st;
  const offCall = phase === "CLOSED" || phase === "CONNECTING" || phase === "CONFIGURING" || (phase === "RECOVERY" && st.recovery?.kind === "connection");
  if (!st.outputMuted && !(phase === "SPEAKING" && active?.audioStarted === true)) return "audibleOutsideSpeaking";
  if (offCall) return judge === null && spec === null && pending === null && active === null ? "offCall" : "slotsOffCall";
  // Each legal stage below is read from its slots alone, so the phase and the mute are tied to them here first.
  if (active?.audioStarted === true && !(phase === "SPEAKING" && !st.outputMuted)) return "audioUnheard";
  if ((phase === "SPEAKING" || phase === "TOOL_WAIT") && active === null) return "speakingWithoutReply";
  if (phase === "JUDGING" && judge === null) return "judgingWithoutJudge";
  if (phase === "SPECULATING" && spec === null) return "speculatingWithoutSpec";
  if (pending !== null && active !== null) return "pendingAndActive";
  if (spec !== null && phase !== "SPECULATING") return "specOutsideSpeculating";
  if (judge !== null && phase !== "JUDGING" && phase !== "SPECULATING") return "judgeOutsideJudging";
  if (active !== null && st.admittedTurnId !== active.permit.stamp.turnId) return "activeForOtherTurn";
  if (pending !== null) {
    const waits = st.deadlines.permit !== undefined || (phase === "RECOVERY" && st.deadlines.lineDone !== undefined);
    if (!waits) return "pendingWithoutWait";
    return pending.permit.kind === "fastO" ? "fastOVerifying" : "serverVerifying";
  }
  if (phase === "RECOVERY") return "recoveryLine";
  if (active !== null) {
    if (active.pendingTool !== null) return "toolWait";
    if (active.audioStarted) return "speaking";
    return active.responseId === null ? "admittedNotCreated" : "admittedMuted";
  }
  if (phase === "JUDGING") return "judgeOnly";
  if (phase === "SPECULATING") return judge !== null && judge.valid && judge.verdict === "O" ? "oAwaitingHash" : "racing";
  if (phase === "HELD") return "heldSlow";
  return "idle";
}

export const isIllegalReplyStage = (m: ReplyStage): m is IllegalReplyStage => (ILLEGAL_REPLY_STAGES as readonly string[]).includes(m);
