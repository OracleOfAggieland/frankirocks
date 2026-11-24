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
 *   - Review F1: an offer counts only once its Session had a call. A said row whose Session never had one (the
 *     microphone was slow or denied, or a second open came first) is not a used offer: the next open that may ask
 *     says the same line again and rewrites the row to name its own Session and Permit. A `met` row is final.
 *
 * The rows carry IDs and states only, never words.
 */
import { type AckText, type Hasher, type ID, type Ledger, MEET_AGAIN_LINE, MEET_LINE, type OpenSurface, type Ref, type RuleInput, type Session, tsFromMs, turnRef } from "@franki/core";
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
  /** The Head's `ownerNamed` (review F2): the owner gave a name, promotable or not. */
  named: boolean;
  /**
   * Kiroween Demo (R7.2, contract question 97): a demo visit, from the verified token or the connector. The visitor
   * plays the persona, whose name is already theirs, so the line is never offered. Absent on every other visit, so
   * M-1 holds for a sample visit.
   */
  demo?: boolean;
}

/**
 * Whether a Session has had a call: the test Part C's worker uses too (`worker/extract.ts`). A Session the typed box
 * opened, or one whose call never connected, has neither a call ID nor a registered one.
 */
export const sessionHadCall = (s: Pick<Session, "callId" | "registeredCallIds">): boolean => s.callId !== null || s.registeredCallIds.length > 0;

/** A `met` row: complete and naming no turn (the meeting was closed by a known name). Final. */
const isMet = (row: Decision | null): boolean => row !== null && meetSaidIn(row) === null;

/** Whether this open could make an offer at all, the rows aside. */
const mayAsk = (c: MeetConditions): boolean => c.surface === "call" && !c.acked && !c.inherited && c.audience === "private" && !c.crisis && !c.held && !c.named && c.demo !== true;

/**
 * Review F1: the Sessions the said rows name, to read before the open's first write, only when the open could ask
 * (`mayAsk`, checked with every condition known by then) and no row is `met`. Empty otherwise, so an owner with a name
 * on file, or with no said row, reads nothing more.
 */
export function meetSessionsToRead(rows: MeetRows, c: MeetConditions): ID[] {
  if (!mayAsk(c) || rows.some(isMet)) return [];
  return [...new Set(rows.map(meetSaidIn).filter((id): id is ID => id !== null))];
}

/**
 * Whether each Session had a call, by ID, read in the open's transaction (one batch of point reads). A Session that
 * can't be found counts as having had one, so a lost record never asks again (fails toward not pressing).
 */
export async function readMeetSessions(tx: Pick<Tx, "get">, uid: string, ids: readonly ID[]): Promise<ReadonlyMap<string, boolean>> {
  const docs = await Promise.all(ids.map((id) => tx.get<Session>(paths.session(uid, id))));
  return new Map(ids.map((id, i) => [id, docs[i] == null ? true : sessionHadCall(docs[i]!.data)]));
}

/** The offer an open makes: which line, and the unheard row it rewrites (null when the row is new). */
export interface MeetOfferMade {
  n: MeetOffer;
  replaces: Decision | null;
}

/**
 * Ruling 5: the offer this open makes, or null. All must hold: the open is a call's, not the typed box's (M-5: the typed
 * screen drops the line, so an offer would be used up unheard); no acknowledgment was taken; nothing was inherited and
 * the audience is private; no crisis modifier and no owner hold; the owner has given no name (review F2: promotable or
 * not); no row is `met`; and an offer is left. A sample visit (`clockMode: "fixture"`) is asked like any other account
 * (contract question M-1, owner's ruling Nov 18: "Intro first, demo line after"); its scripted opening Moment waits, as
 * any opening Moment does behind a line of the open's own.
 *
 * Offers go in order. Review F1: an offer is used once its row is said in a Session that had a call (`hadCall`, from
 * `readMeetSessions`); the first offer not used is the one made, and a said row whose Session never had a call is made
 * again, in the same words, over that row.
 */
export function meetOffer(rows: MeetRows, c: MeetConditions, hadCall: ReadonlyMap<string, boolean> = new Map()): MeetOfferMade | null {
  if (!mayAsk(c) || rows.some(isMet)) return null;
  for (const [i, n] of MEET_OFFERS.entries()) {
    const row = rows[i]!;
    if (row === null) return { n, replaces: null };
    const sessionId = meetSaidIn(row)!;
    if (!(hadCall.get(sessionId) ?? true)) return { n, replaces: row };
  }
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
 * Session, ruling 6) and the Permit's decision. Review F1: an unheard row (`replaces`, read in this transaction) is
 * rewritten to name this Session and Permit, keeping its `createdAt`.
 */
export function recordMeetSaid(tx: Tx, uid: string, offer: MeetOfferMade, x: RowContext & { sessionId: ID; turnId: ID; permitId: string }, hasher: Pick<Hasher, "id">): void {
  const path = paths.ledger(uid, meetRowId(offer.n, hasher));
  const row = meetRow(uid, x, [turnRef(x.turnId, x.sessionId, 1), { type: "ledger", id: x.permitId as ID, rev: 1 }]);
  if (offer.replaces === null) tx.create(path, row);
  else tx.update(path, { ...row, createdAt: offer.replaces.createdAt });
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
