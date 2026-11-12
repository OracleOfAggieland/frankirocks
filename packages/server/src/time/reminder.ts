/**
 * The reminder executor (brief 023 task 8; contracts "Executors: answer CAS resolves rendered pending+ledger action
 * once. makeReminder writes event(due/text)+derive"; KJ02; design note 023 §7).
 *
 *   `offerReminder`          "Want a reminder Thursday?": resolves the day with the pure resolver; unresolved words
 *                            offer nothing. The pending ID is a hash of the source, the words and the resolved time.
 *   `recordPendingRendered`  the receipt seam for `kind:"pendingRendered"`: a ledger `decision` row keyed by the
 *                            pending ID says the browser showed this exact offer.
 *   `confirmReminder`        "yes": only for the offer's yes choice, the owner's own final plain yes, and a rendered
 *                            offer. One transaction writes the `makeReminder` action (the audit entry) and its
 *                            `commitmentDue` moment; both IDs come from the pending ID, so a retry writes nothing.
 */
import {
  type ID,
  type Ledger,
  type Time,
  type Turn,
  deriveReminder,
  isPlainYes,
  momentRow,
  resolveSpoken,
  timeRow,
  tsFromMs,
} from "@franki/core";
import { readCoreDocs } from "../core-docs";
import { cFields } from "../records";
import type { RouteContext } from "../routes/runtime";
import { paths } from "../store/paths";
import type { Tx } from "../store/port";

type Hasher = { id(parts: unknown): string };

export interface ReminderOffer {
  pendingId: ID;
  yesId: ID;
  noId: ID;
  time: Time;
  note: string;
  /** The question, worded by code. */
  line: string;
}

const NOTE_MAX = 256;

export function offerReminder(hasher: Hasher, input: { sourceId: string; note: string; spoken: string; worldNow: number; zone: string }): ReminderOffer | null {
  const resolved = resolveSpoken(input.spoken, input.worldNow, input.zone);
  if (resolved === null) return null;
  const note = input.note.trim().slice(0, NOTE_MAX);
  if (note.length === 0) return null;
  const time = timeRow(resolved);
  const pendingId = hasher.id(["reminderOffer", input.sourceId, note, time.civilStart, time.zone]) as ID;
  return {
    pendingId,
    yesId: hasher.id(["reminderChoice", pendingId, "yes"]) as ID,
    noId: hasher.id(["reminderChoice", pendingId, "no"]) as ID,
    time,
    note,
    line: `Want a reminder ${resolved.precision === "day" ? "on " : ""}${resolved.label}?`,
  };
}

export const renderedEntryId = (hasher: Hasher, pendingId: string): ID => hasher.id(["pendingRendered", pendingId]) as ID;
export const reminderActionId = (hasher: Hasher, pendingId: string): ID => hasher.id(["reminderAction", pendingId]) as ID;

/** Records that the browser rendered this pending offer. Idempotent. */
export async function recordPendingRendered(tx: Tx, uid: string, pendingId: ID, opsNow: number, hasher: Hasher): Promise<void> {
  const id = renderedEntryId(hasher, pendingId);
  if ((await tx.get(paths.ledger(uid, id))) !== null) return;
  const core = await readCoreDocs(tx, uid);
  const now = tsFromMs(opsNow);
  const entry: Extract<Ledger, { kind: "decision" }> = {
    ...cFields(uid, now, core.epoch.data.epoch, core.epoch.data.policyRev),
    kind: "decision",
    state: "complete",
    at: now,
    retainUntil: null,
    payload: { purpose: "proactive", acceptedRefs: [{ type: "pending", id: pendingId, rev: 1 }], heldRefs: [], reasonCodes: [], audience: core.state.data.audience },
  };
  tx.create(paths.ledger(uid, id), entry);
}

export type ReminderAnswer = { state: "applied"; actionId: ID; momentId: ID } | { state: "declined" | "clarify" | "stale" };

export async function confirmReminder(ctx: RouteContext, offer: ReminderOffer, choiceId: ID, turn: Turn): Promise<ReminderAnswer> {
  const { uid, deps } = ctx;
  if (choiceId === offer.noId) return { state: "declined" };
  if (choiceId !== offer.yesId || turn.role !== "user" || turn.sourceClass !== "U" || !turn.final || !isPlainYes(turn.text)) return { state: "clarify" };
  const actionId = reminderActionId(deps.hasher, offer.pendingId);
  return deps.store.transaction(uid, async (tx): Promise<ReminderAnswer> => {
    if ((await tx.get(paths.ledger(uid, renderedEntryId(deps.hasher, offer.pendingId)))) === null) return { state: "stale" };
    const core = await readCoreDocs(tx, uid);
    if (core.epoch.data.barrier !== null) return { state: "stale" };
    const ops = deps.clock.read().opsClock.now;
    const now = tsFromMs(ops);
    const { epoch, policyRev } = core.epoch.data;
    const action: Extract<Ledger, { kind: "action" }> = {
      ...cFields(uid, now, epoch, policyRev),
      kind: "action",
      state: "complete",
      at: now,
      retainUntil: null,
      payload: { pendingId: offer.pendingId, executor: "makeReminder", time: offer.time, note: offer.note, items: [], externalReceipt: null, loopId: null },
    };
    const plan = deriveReminder(actionId, action, deps.hasher).plans[0];
    if (plan === undefined) return { state: "stale" };
    const existing = await tx.get(paths.ledger(uid, actionId));
    if (existing !== null) return { state: "applied", actionId, momentId: plan.momentId as ID };
    tx.create(paths.ledger(uid, actionId), action);
    tx.create(paths.moment(uid, plan.momentId), momentRow(plan, { uid, opsNow: ops, epoch, policyRev, clockMode: core.state.data.clockMode }, deps.hasher));
    return { state: "applied", actionId, momentId: plan.momentId as ID };
  });
}
