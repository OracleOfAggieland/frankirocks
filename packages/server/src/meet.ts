/**
 * The first meeting (brief 052 rulings 5 and 6). On an owner's first call, before they speak, the open says one
 * Fixed_Line asking what to call them; it is offered at most twice and only while the Head has no name the owner gave.
 *
 *   - Offers are counted by two delivery rows, `decision` ledger rows with fixed IDs (`meetRowId(1)` and `(2)`), read by
 *     ID beside the core documents in the open's first round of reads and created in the same transaction as the Permit
 *     that says the line, as the forget's acknowledgment does (`forget/ack.ts`).
 *   - A said row names the turn the line was said as, under its Session (`meetSaidIn`), and the Permit's decision. A
 *     `met` row (the Head already had an owner name) names neither: knowing a name closes the meeting, so after
 *     "forget my name" Franki does not ask again. The closed `decision` row has no `met` state; the two are told apart
 *     by that turn ref (see the report).
 *   - "Start over" clears the rows with the rest of the ledger; account delete removes them; a forget does not touch them.
 *
 * The rows carry IDs and states only, never words.
 */
import { type AckText, type Hasher, type ID, type Ledger, MEET_AGAIN_LINE, MEET_LINE, type OpenSurface, type Ref, type RuleInput, tsFromMs, turnRef } from "@franki/core";
import { cFields } from "./records";
import { paths } from "./store/paths";
import type { Tx } from "./store/port";

type Decision = Extract<Ledger, { kind: "decision" }>;

/** Ruling 6: at most two offers, ever. */
export const MEET_OFFERS = [1, 2] as const;
export type MeetOffer = (typeof MEET_OFFERS)[number];

/** The delivery row of one offer: `H("ledger", "meet", n)`. */
export const meetRowId = (n: MeetOffer, hasher: Pick<Hasher, "id">): ID => hasher.id(["ledger", "meet", n]) as ID;

/** The turn a meet line is said as: one per Session. */
export const meetTurnId = (hasher: Pick<Hasher, "id">, sessionId: string): ID => hasher.id(["meet", sessionId]) as ID;

/** The two rows as read: null where the offer has not been made or closed. */
export type MeetRows = readonly [Decision | null, Decision | null];

/** Both rows by ID: one batch of reads, for the open's first round. */
export async function readMeetRows(tx: Pick<Tx, "get">, uid: string, hasher: Pick<Hasher, "id">): Promise<MeetRows> {
  const [a, b] = await Promise.all(MEET_OFFERS.map((n) => tx.get<Ledger>(paths.ledger(uid, meetRowId(n, hasher)))));
  const decision = (d: { data: Ledger } | null): Decision | null => (d !== null && d.data.kind === "decision" ? d.data : null);
  return [decision(a ?? null), decision(b ?? null)];
}

/** The line of each offer (ruling 4). */
export const meetLineOf = (n: MeetOffer): AckText => (n === 1 ? MEET_LINE : MEET_AGAIN_LINE);

export interface MeetConditions {
  /** The open's surface (`openSurface`): a typed open is never offered the line (contract question M-5). */
  surface: OpenSurface;
  /** A forget acknowledgment was taken on this open. */
  acked: boolean;
  /** The open inherited a Session (a narrowed audience or a swap). */
  inherited: boolean;
  audience: string;
  /** The new Session's crisis modifier is set. */
  crisis: boolean;
  /** The owner's hold runs (`holdCarried`). */
  held: boolean;
  /** The Head's `ownerName`. */
  ownerName: string | null;
}

/**
 * Ruling 5: the offer this open makes, or null. All must hold: the open is a call's, not the typed box's (M-5: the typed
 * screen drops the line, so an offer would be used up unheard); no acknowledgment was taken; nothing was inherited and
 * the audience is private; no crisis modifier and no owner hold; no owner name in the Head; fewer than two offers made.
 * A sample visit (`clockMode: "fixture"`) is asked like any other account (contract question M-1, owner's ruling Nov 18:
 * "Intro first, demo line after"); its scripted opening Moment waits, as any opening Moment does behind a line of the
 * open's own. Offers go in order, so the first missing row is the one made.
 */
export function meetOffer(rows: MeetRows, c: MeetConditions): MeetOffer | null {
  if (c.surface !== "call" || c.acked || c.inherited || c.audience !== "private" || c.crisis || c.held || c.ownerName !== null) return null;
  if (rows[0] === null) return 1;
  if (rows[1] === null) return 2;
  return null;
}

/** The Server_Rule input of the meet line: a typed shape with no call, carrying the words (ruling 5). */
export const meetRule = (line: AckText): RuleInput => ({
  source: "typed",
  transcript: "final",
  judge: "typed",
  parse: { kind: "none" },
  regexMatch: false,
  audience: "private",
  narrowedHere: false,
  callLive: false,
  parseGap: false,
  noteSens: "none",
  wordsPer2s: true,
  allFinal: true,
  toolParseCommitted: false,
  wave: "B",
  meetLine: line,
});

interface RowContext {
  opsNow: number;
  core: { epoch: number; policyRev: number };
}

function meetRow(uid: string, x: RowContext, acceptedRefs: Ref[]): Decision {
  const now = tsFromMs(x.opsNow);
  return {
    ...cFields(uid, now, x.core.epoch, x.core.policyRev),
    kind: "decision",
    state: "complete",
    at: now,
    retainUntil: null,
    // A delivery record, like the forget acknowledgment's: only the Admission_Seam writes answer decisions.
    payload: { purpose: "proactive", acceptedRefs, heldRefs: [], reasonCodes: ["ok"], audience: "private" },
  };
}

/**
 * Records one offer as said, in the transaction that admitted its Permit: the turn it was said as (under its
 * Session, ruling 6) and the Permit's decision.
 */
export function recordMeetSaid(tx: Tx, uid: string, n: MeetOffer, x: RowContext & { sessionId: ID; turnId: ID; permitId: string }, hasher: Pick<Hasher, "id">): void {
  tx.create(paths.ledger(uid, meetRowId(n, hasher)), meetRow(uid, x, [turnRef(x.turnId, x.sessionId, 1), { type: "ledger", id: x.permitId as ID, rev: 1 }]));
}

/** Ruling 6, "knowing a name closes the meeting": every missing row is created `met`, naming no turn. */
export function closeMeet(tx: Tx, uid: string, rows: MeetRows, x: RowContext, hasher: Pick<Hasher, "id">): void {
  MEET_OFFERS.forEach((n, i) => {
    if (rows[i] === null) tx.create(paths.ledger(uid, meetRowId(n, hasher)), meetRow(uid, x, []));
  });
}

/** The Session a meet row's line was said in, or null for a `met` row (or any other row). Part C reads it. */
export function meetSaidIn(row: Ledger | null): ID | null {
  if (row === null || row.kind !== "decision") return null;
  const turn = row.payload.acceptedRefs.find((r) => r.type === "turn");
  return turn !== undefined && "parentId" in turn && typeof turn.parentId === "string" ? (turn.parentId as ID) : null;
}
