/**
 * Brief 038 finding 1: which accounts are real. A real account is never reset: "start over" would wipe the owner's
 * own data. The answer is the server's, with its own code (LIVE), so the browser can tell a real account from a
 * clone that failed, and take input as it does without a visit.
 *
 * Ruling (brief 019's `mayReset`, kept): an account that is not already a clone is real if it holds any Evidence. A
 * visitor's browser always clones before anything else (the input gate), so a visitor's fresh account holds none.
 */
import type { CoreDocs } from "@franki/core";
import { RouteError } from "../routes/errors";
import { paths } from "../store/paths";
import type { Tx } from "../store/port";

/** The answer for a real account: HTTP 409, `{error: "LIVE", retryAfterMs: 0}`. */
export const liveAccountError = () => new RouteError("LIVE", 409, 0, "liveAccount");

/** What `readLiveData` found of the account's own data. */
export interface LiveData {
  evidence: boolean;
}

/** Whether the account holds data of its own (pure). A clone never does: its rows are the visit's. */
export function isRealAccount(state: CoreDocs["state"], found: LiveData): boolean {
  if (state.clockMode === "fixture") return false;
  return found.evidence;
}

const any = async (tx: Pick<Tx, "query">, collection: string) =>
  (await tx.query({ collection, where: [], orderBy: { field: "__name__", dir: "asc" }, limit: 1 })).length > 0;

/** Reads, in the reset's fence transaction, whether the account holds data of its own. */
export async function readLiveData(tx: Pick<Tx, "query">, uid: string, _rules: CoreDocs["rules"]): Promise<LiveData> {
  return { evidence: await any(tx, paths.collection(uid, "evidence")) };
}
