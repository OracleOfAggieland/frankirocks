/**
 * Brief 049 part A, ruling 2: an Errand's assignment is the owner's own words, read by the server, never the talking
 * model's and never text from mail.
 *
 *   - At start: the IDs of the owner's committed turns of this Session (role user, class U, final, parse committed,
 *     not dead, with words), ending with the turn that carries the current Stamp, at most the last
 *     `ERRAND_ASSIGNMENT_TURNS`, newest last. The Errand stores the IDs, not the words.
 *   - At run time: each turn is read again by ID, and only a turn that still qualifies and whose Evidence is still
 *     retained gives its words, so a forgotten turn takes its words with it.
 */
import { ERRAND_ASSIGNMENT_TURNS, type Evidence, type ID, type Turn } from "@franki/core";
import { paths } from "../store/paths";
import type { StorePort, Tx } from "../store/port";

/** A turn whose words may be an assignment: the owner's own, final, committed, alive and with words. */
export const ownerWordsTurn = (t: Turn): boolean =>
  t.role === "user" && t.sourceClass === "U" && t.final && t.parseState === "committed" && t.state !== "dead" && t.text !== null && t.text.trim().length > 0;

/** How many turns of the Session the start reads back to find the last few of the owner's own. */
const ASSIGNMENT_READ_TURNS = 16;

/**
 * The assignment's turn IDs, oldest first, ending with `turn` (which must itself qualify), or null when it does not.
 * Reads the Session's last turns up to and including `turn`.
 */
export async function assignmentTurnIds(reader: Pick<Tx, "query" | "get">, uid: string, sessionId: string, turn: Turn & { id?: string }, turnId: ID): Promise<ID[] | null> {
  if (!ownerWordsTurn(turn)) return null;
  const rows = await reader.query<Turn>({
    collection: paths.turns(uid, sessionId),
    // Q14's shape (turns by seq, ascending; no composite index): the window that ends at this turn.
    where: [{ field: "seq", op: ">=", value: Math.max(0, turn.seq - (ASSIGNMENT_READ_TURNS - 1)) }],
    orderBy: { field: "seq", dir: "asc" },
    limit: ASSIGNMENT_READ_TURNS,
  });
  const candidates = rows.filter((r) => r.id !== turnId && r.data.seq < turn.seq && ownerWordsTurn(r.data));
  // A turn whose Evidence is already forgotten takes no slot (property "Whose words", red seed -1987307272).
  const readable = await Promise.all(candidates.map((r) => retainedWords(reader, uid, r.data)));
  const earlier = candidates.filter((_, i) => readable[i]).map((r) => r.id as ID);
  return [...earlier.slice(-(ERRAND_ASSIGNMENT_TURNS - 1)), turnId];
}

/** True when a turn's words are still readable: no Evidence row, or one still retained. */
async function retainedWords(reader: Pick<Tx, "get">, uid: string, t: Turn): Promise<boolean> {
  if (t.evidenceId === null) return true;
  const e = (await reader.get<Evidence>(paths.evidence(uid, t.evidenceId)))?.data ?? null;
  return e !== null && e.status === "retained";
}

/** The owner's words now, oldest first: each stored turn that still qualifies and whose Evidence is retained. */
export async function assignmentWords(store: Pick<StorePort, "get">, uid: string, sessionId: string, turnIds: readonly ID[]): Promise<string[]> {
  const out: string[] = [];
  for (const id of turnIds.slice(-ERRAND_ASSIGNMENT_TURNS)) {
    const t = (await store.get<Turn>(uid, paths.turn(uid, sessionId, id)))?.data ?? null;
    if (t === null || !ownerWordsTurn(t) || !(await retainedWords({ get: (p) => store.get(uid, p) }, uid, t))) continue;
    out.push(t.text!);
  }
  return out;
}
