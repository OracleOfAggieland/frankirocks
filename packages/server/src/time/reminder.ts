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
 *                            Brief 036 finding 9: the pending ID is recomputed from the offer's source, note and
 *                            time, so a different time or note under the same ID is refused; a "no" writes a
 *                            declined row and any later yes is refused; the yes turn must be later than the render.
 */
import {
  type ID,
  type Ledger,
  type Time,
  type Turn,
  type Evidence,
  type Hasher as CoreHasher,
  type Memory,
  type Slice,
  rootKey,
  sourceVerdict,
  msFromTs,
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
import type { StoredDoc, Tx } from "../store/port";

type Hasher = { id(parts: unknown): string };

export interface ReminderOffer {
  pendingId: ID;
  /** The row the offer was made from (brief 036 findings 9 and 10): part of the pending ID, reread at the yes. */
  sourceId: string;
  yesId: ID;
  noId: ID;
  time: Time;
  note: string;
  /** The question, worded by code. */
  line: string;
}

const NOTE_MAX = 256;

/** The pending ID binds the offer's source, its exact note and its whole time row. */
const reminderPendingId = (hasher: Hasher, sourceId: string, note: string, time: Time): ID => hasher.id(["reminderOffer", sourceId, note, time]) as ID;
const choiceId = (hasher: Hasher, pendingId: string, choice: "yes" | "no"): ID => hasher.id(["reminderChoice", pendingId, choice]) as ID;
/** The ledger row a "no" writes; a later yes to the same pending ID is refused. */
export const declinedEntryId = (hasher: Hasher, pendingId: string): ID => hasher.id(["reminderDeclined", pendingId]) as ID;

export function offerReminder(hasher: Hasher, input: { sourceId: string; note: string; spoken: string; worldNow: number; zone: string }): ReminderOffer | null {
  const resolved = resolveSpoken(input.spoken, input.worldNow, input.zone);
  if (resolved === null) return null;
  const note = input.note.trim().slice(0, NOTE_MAX);
  if (note.length === 0) return null;
  const time = timeRow(resolved);
  const pendingId = reminderPendingId(hasher, input.sourceId, note, time);
  return {
    pendingId,
    sourceId: input.sourceId,
    yesId: choiceId(hasher, pendingId, "yes"),
    noId: choiceId(hasher, pendingId, "no"),
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

/**
 * Brief 042 item 1 (finding 3): every showing of an offer, per session, in order, beside the first showing's row
 * (`recordPendingRendered`, kept as it is for the ledger). A yes binds to the latest showing in its own session, so an
 * offer shown again after the owner comes back can be answered. Showings past the cap are not recorded: the binding
 * then reads the last one recorded, and a yes after other turns is `clarify` (fails closed).
 */
export const SHOWINGS_PER_SESSION_MAX = 16;
export const showingEntryId = (hasher: Hasher, pendingId: string, sessionId: string, n: number): ID => hasher.id(["pendingShown", pendingId, sessionId, n]) as ID;

/** Brief 045 finding 6: a cancel revokes the latest showing; the row says so beside it (ledger rows never change). */
export const showingRevokedId = (hasher: Hasher, pendingId: string, sessionId: string, n: number): ID => hasher.id(["pendingShownRevoked", pendingId, sessionId, n]) as ID;
/** One showing per response: a played-to-the-end line and its matching transcript are one showing, not two. */
export const showingResponseId = (hasher: Hasher, pendingId: string, sessionId: string, responseId: string): ID => hasher.id(["pendingShownResponse", pendingId, sessionId, responseId]) as ID;

type LedgerGet = (path: string) => Promise<StoredDoc<Ledger> | null>;

/** The latest showing of this offer in this session: none, revoked by a cancel, or shown (with its row). */
export type Showing = { kind: "none" } | { kind: "revoked"; n: number } | { kind: "shown"; n: number; row: StoredDoc<Ledger> };

export async function sessionShowing(get: LedgerGet, uid: string, pendingId: string, sessionId: string, hasher: Hasher): Promise<Showing> {
  let last: { n: number; row: StoredDoc<Ledger> } | null = null;
  for (let n = 0; n < SHOWINGS_PER_SESSION_MAX; n++) {
    const row = await get(paths.ledger(uid, showingEntryId(hasher, pendingId, sessionId, n)));
    if (row === null) break;
    last = { n, row };
  }
  if (last === null) return { kind: "none" };
  if ((await get(paths.ledger(uid, showingRevokedId(hasher, pendingId, sessionId, last.n)))) !== null) return { kind: "revoked", n: last.n };
  return { kind: "shown", ...last };
}

/** The latest recorded showing of this offer in this session, or null (null too when a cancel revoked it). */
export async function latestShowing(get: LedgerGet, uid: string, pendingId: string, sessionId: string, hasher: Hasher): Promise<StoredDoc<Ledger> | null> {
  const s = await sessionShowing(get, uid, pendingId, sessionId, hasher);
  return s.kind === "shown" ? s.row : null;
}

/** A cancel: the latest showing of this offer in this session, if any and not yet revoked, is revoked. */
export async function revokeShowing(tx: Tx, uid: string, pendingId: ID, sessionId: string, opsNow: number, hasher: Hasher): Promise<void> {
  const s = await sessionShowing((p) => tx.get<Ledger>(p), uid, pendingId, sessionId, hasher);
  if (s.kind !== "shown") return;
  tx.create(paths.ledger(uid, showingRevokedId(hasher, pendingId, sessionId, s.n)), await decisionRow(tx, uid, pendingId, opsNow, "held"));
}

async function decisionRow(tx: Tx, uid: string, pendingId: ID, opsNow: number, as: "accepted" | "held"): Promise<Extract<Ledger, { kind: "decision" }>> {
  const core = await readCoreDocs(tx, uid);
  const now = tsFromMs(opsNow);
  const ref = [{ type: "pending" as const, id: pendingId, rev: 1 }];
  return {
    ...cFields(uid, now, core.epoch.data.epoch, core.epoch.data.policyRev),
    kind: "decision",
    state: "complete",
    at: now,
    retainUntil: null,
    payload: { purpose: "proactive", acceptedRefs: as === "accepted" ? ref : [], heldRefs: as === "held" ? ref : [], reasonCodes: [], audience: core.state.data.audience },
  };
}

/**
 * Records one showing of this offer in this session (and the first showing's row, if there is none yet). Call it at
 * most once per offer per transaction: reads are not buffered, so a second call would pick the same slot.
 */
export async function recordShowing(tx: Tx, uid: string, pendingId: ID, sessionId: string, opsNow: number, hasher: Hasher, responseId: string | null = null): Promise<void> {
  if (responseId !== null) {
    const once = paths.ledger(uid, showingResponseId(hasher, pendingId, sessionId, responseId));
    if ((await tx.get(once)) !== null) return;
    tx.create(once, await decisionRow(tx, uid, pendingId, opsNow, "accepted"));
  }
  await recordPendingRendered(tx, uid, pendingId, opsNow, hasher);
  let n = 0;
  while (n < SHOWINGS_PER_SESSION_MAX && (await tx.get(paths.ledger(uid, showingEntryId(hasher, pendingId, sessionId, n)))) !== null) n++;
  if (n >= SHOWINGS_PER_SESSION_MAX) return;
  tx.create(paths.ledger(uid, showingEntryId(hasher, pendingId, sessionId, n)), await decisionRow(tx, uid, pendingId, opsNow, "accepted"));
}

export type ReminderAnswer = { state: "applied"; actionId: ID; momentId: ID } | { state: "declined" | "clarify" | "stale" };

export async function confirmReminder(ctx: RouteContext, offer: ReminderOffer, choice: ID, turn: Turn): Promise<ReminderAnswer> {
  const { uid, deps } = ctx;
  // A "no" is recorded for the pending ID it names, whatever else the offer says (fails closed).
  if (choice === choiceId(deps.hasher, offer.pendingId, "no")) return declineReminder(ctx, offer.pendingId);
  if (choice !== choiceId(deps.hasher, offer.pendingId, "yes") || turn.role !== "user" || turn.sourceClass !== "U" || !turn.final || !isPlainYes(turn.text)) return { state: "clarify" };
  // The exact offer: its pending ID is recomputed from what it says now.
  if (reminderPendingId(deps.hasher, offer.sourceId, offer.note, offer.time) !== offer.pendingId) return { state: "stale" };
  const actionId = reminderActionId(deps.hasher, offer.pendingId);
  return deps.store.transaction(uid, async (tx): Promise<ReminderAnswer> => {
    const core = await readCoreDocs(tx, uid);
    if (core.epoch.data.barrier !== null) return { state: "stale" };
    const ops = deps.clock.read().opsClock.now;
    const now = tsFromMs(ops);
    const { epoch, policyRev } = core.epoch.data;
    // Brief 036 finding 10: the reminder keeps its source's ID and lineage; a source that no longer stands refuses.
    const source = await reminderSource(tx, uid, offer.sourceId, deps.hasher);
    if (source === null) return { state: "stale" };
    const action: Extract<Ledger, { kind: "action" }> = {
      ...cFields(uid, now, epoch, policyRev),
      ...source,
      kind: "action",
      state: "complete",
      at: now,
      retainUntil: null,
      payload: { pendingId: offer.pendingId, executor: "makeReminder", time: offer.time, note: offer.note, items: [], externalReceipt: null, loopId: null },
    };
    const plan = deriveReminder(actionId, action, deps.hasher).plans[0];
    if (plan === undefined) return { state: "stale" };
    // A retry of an applied yes answers the same and writes nothing.
    if ((await tx.get(paths.ledger(uid, actionId))) !== null) return { state: "applied", actionId, momentId: plan.momentId as ID };
    const rendered = await tx.get<Ledger>(paths.ledger(uid, renderedEntryId(deps.hasher, offer.pendingId)));
    if (rendered === null) return { state: "stale" };
    if ((await tx.get(paths.ledger(uid, declinedEntryId(deps.hasher, offer.pendingId)))) !== null) return { state: "stale" };
    // The yes must come after the render.
    if (turn.committedAt === null || msFromTs(turn.committedAt) <= msFromTs(rendered.data.at)) return { state: "stale" };
    tx.create(paths.ledger(uid, actionId), action);
    tx.create(paths.moment(uid, plan.momentId), momentRow(plan, { uid, opsNow: ops, epoch, policyRev, clockMode: core.state.data.clockMode }, deps.hasher));
    return { state: "applied", actionId, momentId: plan.momentId as ID };
  });
}

/** A "no": one declined decision row for the pending ID, idempotent. Any later yes to it is refused. */
async function declineReminder(ctx: RouteContext, pendingId: ID): Promise<ReminderAnswer> {
  const { uid, deps } = ctx;
  return deps.store.transaction(uid, async (tx): Promise<ReminderAnswer> => {
    const id = declinedEntryId(deps.hasher, pendingId);
    if ((await tx.get(paths.ledger(uid, id))) !== null) return { state: "declined" };
    const core = await readCoreDocs(tx, uid);
    const now = tsFromMs(deps.clock.read().opsClock.now);
    const entry: Extract<Ledger, { kind: "decision" }> = {
      ...cFields(uid, now, core.epoch.data.epoch, core.epoch.data.policyRev),
      kind: "decision",
      state: "complete",
      at: now,
      retainUntil: null,
      payload: { purpose: "proactive", acceptedRefs: [], heldRefs: [{ type: "pending", id: pendingId, rev: 1 }], reasonCodes: [], audience: core.state.data.audience },
    };
    tx.create(paths.ledger(uid, id), entry);
    return { state: "declined" };
  });
}

/**
 * The lineage a reminder keeps (brief 036 finding 10): its source Memory, which must still stand, or its source
 * Evidence, which must not be purged. Anything else, or a missing row, is null (fails closed).
 */
async function reminderSource(tx: Tx, uid: string, sourceId: string, hasher: CoreHasher): Promise<{ rootKeys: string[]; rootSlices: Slice[]; dependsOn: string[] } | null> {
  const m = await tx.get<Memory>(paths.memory(uid, sourceId));
  if (m !== null) {
    if (sourceVerdict(m.data) !== "ok") return null;
    return { rootKeys: m.data.rootKeys.slice(0, 128), rootSlices: m.data.rootSlices.slice(0, 128), dependsOn: [`m:${m.data.logicalId}@${m.data.rev}`] };
  }
  const e = await tx.get<Evidence>(paths.evidence(uid, sourceId));
  if (e === null || e.data.purgedAt !== null) return null;
  const slices = e.data.fieldSlices.slice(0, 128);
  return { rootKeys: slices.map((s) => rootKey(s, hasher)), rootSlices: slices, dependsOn: [`e:${e.id}`] };
}
