/**
 * The FastO_Rule: the browser half of admission (contracts §6 Admission `fastO`, "fastOlocal"; KV13; voice-control
 * R4; design "The FastO_Rule", question 61). Pure: time is an argument. The S2-among-the-last-four, parse-gap and
 * `unknown`-audience rules reach the browser as the server's `ack:null`, so they show here as `ack`.
 */
import { PERMIT_TTL_MS } from "../admission";
import { type StateAck, msFromTs, tsFromMs } from "../schema/primitives";
import type { Permit, Stamp } from "../schema/wire";
import type { FastORefusal } from "./latency";

/** KV13: the StateAck must be younger than this. */
export const FAST_O_ACK_AGE_MS = 2_500;

export interface FastOInput {
  now: number;
  /** The Turn's commit (t0). */
  t0: number;
  /** The judge's deadline from t0 (APP_JUDGE_SETTINGS.deadlineMs). */
  judgeDeadlineMs: number;
  turnId: string;
  generation: number;
  /** The verdict the judge gave, if any. */
  judge: { turnId: string; generation: number; valid: boolean; verdict: "O" | "H" | "U" } | null;
  ack: StateAck | null;
  /** True when the last ack seen was dropped because its request went out before the last `/api/turn` answer. */
  ackDroppedStale: boolean;
  deck: { epoch: number; policyRev: number; bundleRev: number; rulesRev: number; noteWaiting: boolean };
  /** Posted `/api/turn` requests with no answer yet. */
  outstanding: number;
}

/** The first condition that refuses `fastO`, by name, or null (R4.1, R18.6). `hash` is checked at `permitChecked`. */
export function fastOProblem(i: FastOInput): Exclude<FastORefusal, "hash"> | null {
  const j = i.judge;
  if (j === null || !j.valid || j.verdict !== "O" || j.turnId !== i.turnId || j.generation !== i.generation || i.now >= i.t0 + i.judgeDeadlineMs) return "verdict";
  const a = i.ack;
  if (a === null) return i.ackDroppedStale ? "staleAck" : "ack";
  const s = a.stamp;
  const d = i.deck;
  if (s.epoch !== d.epoch || s.policyRev !== d.policyRev || s.bundleRev !== d.bundleRev || s.rulesRev !== d.rulesRev) return "ack";
  if (s.generation > i.generation || i.now - msFromTs(a.issuedOpsAt) >= FAST_O_ACK_AGE_MS) return "ack";
  if (i.outstanding > 0) return "outstanding";
  if (d.noteWaiting) return "noteWaiting";
  return null;
}

/** The `fastO` Permit over the Speculative_Reply's payload hash (R4.6). */
export function issueFastO(p: { permitId: string; stamp: Stamp; hash: string; now: number }): Permit {
  return {
    permitId: p.permitId,
    stamp: p.stamp,
    kind: "fastO",
    scope: "reply",
    approvedPayloadHash: p.hash,
    noteIds: [],
    momentIds: [],
    expiresAt: tsFromMs(p.now + PERMIT_TTL_MS),
  };
}
