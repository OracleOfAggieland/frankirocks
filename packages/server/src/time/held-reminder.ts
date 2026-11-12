/**
 * Brief 042 item 3 (finding 1): a reminder held under crisis is never lost without a trace. Lead's ruling, for the
 * owner to confirm:
 *
 *   - When delivery's Gate holds a confirmed reminder (`commitmentDue`) for a crisis at or after its due time, the
 *     route records it once (`recordReminderHeld`, a decision row keyed by the reminder's action).
 *   - The next line not under crisis says it late, by code template (`heldReminderLine`), once, as `mustSay` (a due
 *     reminder is mustSay already). Ruling needed: "the next opening" is read as the next delivery that is not
 *     under crisis, opening or idle whisper, whichever comes first (`HELD_LATE_ON_IDLE`).
 *   - If none comes before its close time, the tick closes it with a `held` Gate row naming `crisis`
 *     (`recordHeldAtClose`), so "why didn't you remind me?" has a row to read.
 */
import { type GateResult, type Hasher as CoreHasher, type ID, type Ledger, type Moment, heldReminderLine, localMinuteOf, msFromTs, tsFromMs } from "@franki/core";
import { readCoreDocs } from "../core-docs";
import { writeGateDecision } from "../ledger/said";
import { cFields } from "../records";
import type { RouteContext } from "../routes/runtime";
import { paths } from "../store/paths";
import type { Tx } from "../store/port";

type Hasher = { id(parts: unknown): string };

export const HELD_LATE_ON_IDLE = true;

export const reminderHeldId = (hasher: Hasher, actionId: string): ID => hasher.id(["reminderHeld", actionId]) as ID;

/** True for a reminder the Gate held for a crisis at or after its due time. */
export function heldPastDue(m: Moment, result: GateResult, worldNow: number): boolean {
  return m.kind === "commitmentDue" && m.actionId !== null && result.verdict === "hold" && result.reasons.includes("crisis") && worldNow >= msFromTs(m.dueAt);
}

/** Records, once, that this reminder was held past its due time. */
export async function recordReminderHeld(tx: Tx, uid: string, momentId: ID, m: Moment, opsNow: number, hasher: Hasher): Promise<void> {
  if (m.actionId === null) return;
  const path = paths.ledger(uid, reminderHeldId(hasher, m.actionId));
  if ((await tx.get(path)) !== null) return;
  const core = await readCoreDocs(tx, uid);
  const now = tsFromMs(opsNow);
  const entry: Extract<Ledger, { kind: "decision" }> = {
    ...cFields(uid, now, core.epoch.data.epoch, core.epoch.data.policyRev),
    kind: "decision",
    state: "complete",
    at: now,
    retainUntil: null,
    payload: { purpose: "proactive", acceptedRefs: [], heldRefs: [{ type: "moment", id: momentId, rev: m.rev }], reasonCodes: [], audience: core.state.data.audience },
  };
  tx.create(path, entry);
}

/** The late line for a held reminder, or null when it wasn't held (or its action can't be read). */
export async function heldReminderText(ctx: RouteContext, m: Moment): Promise<string | null> {
  if (m.kind !== "commitmentDue" || m.actionId === null) return null;
  const { uid, deps } = ctx;
  if ((await deps.store.get(uid, paths.ledger(uid, reminderHeldId(deps.hasher, m.actionId)))) === null) return null;
  const action = await deps.store.get<Ledger>(uid, paths.ledger(uid, m.actionId));
  if (action === null || action.data.kind !== "action" || action.data.payload.time === null) return null;
  const t = action.data.payload.time;
  return heldReminderLine(action.data.payload.note ?? "your reminder", localMinuteOf(msFromTs(t.start), t.zone));
}

/** At close, never said: a `held` Gate row naming `crisis`, scoped to the moment. */
export async function recordHeldAtClose(tx: Tx, uid: string, momentId: ID, m: Moment, opsNow: number, hasher: CoreHasher): Promise<void> {
  if (m.kind !== "commitmentDue" || m.actionId === null || m.saidAt !== null) return;
  if ((await tx.get(paths.ledger(uid, reminderHeldId(hasher, m.actionId)))) === null) return;
  const core = await readCoreDocs(tx, uid);
  const result: GateResult = { verdict: "hold", form: null, render: null, carveOut: null, mustSay: "commitmentDue", fixedLine: null, reasons: ["crisis"], candidateId: momentId, sens: "S0" };
  const at = { uid, now: tsFromMs(opsNow), epoch: core.epoch.data.epoch, policyRev: core.epoch.data.policyRev };
  await writeGateDecision(tx, hasher, at, result, { candidateId: momentId, refs: [{ type: "moment", id: momentId, rev: m.rev }], noteIds: [], momentId, sessionId: null, turnId: null, audience: core.state.data.audience, permitKind: "proactive" });
}
