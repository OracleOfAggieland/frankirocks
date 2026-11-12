/**
 * The false "gone" check (spec §5 line 54; contracts §6 line 749: "Unreceipted gone/forgot/deleted/removed runs
 * control and asks Did you want that deleted?"). Pure. Franki saying something is gone, forgotten, deleted or
 * removed is only true with a forget receipt behind it in the same turn; without one, the control runs and the
 * owner is asked.
 */
import { tokenize } from "./text";

/**
 * The contract's claim words and their other past forms, matched as whole tokens in any letter case. Offers and
 * questions ("Want me to forget it?", "remove") are not claims, so present forms are left out.
 */
export const GONE_WORDS: ReadonlySet<string> = new Set(["gone", "forgot", "forgotten", "deleted", "removed", "erased", "wiped"]);

/** True when Franki's line claims something was gone, forgotten, deleted or removed. */
export function claimsGone(text: string): boolean {
  return tokenize(text).some((t) => GONE_WORDS.has(t));
}

/**
 * True when the turn needs the "Did you want that deleted?" ask: a line of Franki's claims gone and the turn has
 * no forget receipt.
 */
export function falseGone(lines: readonly string[], receiptId: string | null): boolean {
  if (receiptId !== null) return false;
  return lines.some(claimsGone);
}
