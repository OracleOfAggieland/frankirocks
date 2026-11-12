/**
 * The extraction backstop for allergies (brief 012 G18, G39, section 5; task B8). Pure. An allergy item extraction
 * found, on the owner's own words (every span verified and on a U slice), whose (subject, code) the on-turn route
 * didn't handle, becomes a pending rule in a proposal: never active, since extraction has no speaker check. T, M, O
 * and C text proposes nothing (P1). The next turn transaction or `open` applies the proposal (`applyProposals`).
 */
import type { Hasher } from "../ids";
import type { ID, Span } from "../schema/primitives";
import type { CoreRules } from "../schema/records";
import { lookupAllergen, scanAliases } from "./gazetteer";
import { spanClass, verifyTurnSpan } from "./spans";
import type { TurnEvidence } from "./types";

type AllergyRule = CoreRules["allergies"][number];

/** An allergy item as the extraction worker hands it over: its subject, its code and its spans. */
export interface BackstopItem {
  act: string;
  /** "self", or a mention localId. */
  subject: string;
  allergenCode: string;
  spans: readonly Span[];
}

export interface BackstopProposal {
  id: ID;
  origin: "backstop";
  turnId: ID | null;
  eid: ID;
  install: AllergyRule[];
}

/** Acts that never write: the owner wasn't stating it (extraction's NO_MEMORY_ACTS). */
const NO_RULE_ACTS: ReadonlySet<string> = new Set(["joke", "venting", "hypothetical", "quote", "none", "promise_theirs", "outcome"]);
/** At most this many rules in one proposal (the record's bound, a ruling of task B2). */
export const PROPOSAL_INSTALL_MAX = 8;

/** The item's gazetteer code: its own code if the table knows it, else an alias in its spans, else `unresolved`. */
function codeOf(item: BackstopItem, spans: readonly Span[]): string {
  const own = lookupAllergen(item.allergenCode.replace(/_/g, " "));
  if (own.length > 0) return own[0]!;
  for (const s of spans) {
    const hit = scanAliases(s.quote)[0];
    if (hit !== undefined) return hit.code;
  }
  return "unresolved";
}

const names = (quote: string, code: string) => new Set([...lookupAllergen(quote), ...scanAliases(quote).map((h) => h.code)]).has(code);

export function backstopProposal(ev: TurnEvidence, items: readonly BackstopItem[], handled: readonly { subjectId: string | null; code: string }[], turnId: ID | null, hasher: Hasher): BackstopProposal | null {
  const install: AllergyRule[] = [];
  const slots = new Set<string>();
  for (const item of items) {
    if (NO_RULE_ACTS.has(item.act) || item.spans.length === 0) continue;
    const verified = item.spans.map((s) => verifyTurnSpan(s, ev));
    // Every span the owner's own words, on a U slice of this Evidence (P1).
    if (verified.some((v) => v === null || spanClass(v, ev) !== "U")) continue;
    const spans = verified as Span[];
    const code = codeOf(item, spans);
    // A subject other than the owner is anonymous here: the backstop resolves no one (G7 is the route's).
    const subject = item.subject === "self" ? "self" : null;
    if (handled.some((h) => h.subjectId === subject && h.code === code)) continue;
    const key = `${subject ?? ""}|${code}`;
    if (slots.has(key)) continue;
    slots.add(key);
    const proof = spans.find((s) => code !== "unresolved" && names(s.quote, code)) ?? null;
    const rootKeys = proof === null ? [] : ev.slices.flatMap((sl, i) => (sl.start !== null && sl.end !== null && sl.start < proof.end && proof.start < sl.end && ev.rootKeys[i] !== undefined ? [ev.rootKeys[i]!] : [])).slice(0, 16);
    install.push({
      id: hasher.id(["allergyPending", subject ?? "anyone", code, ev.eid]),
      subjectId: subject,
      code,
      state: "pending",
      anonymous: subject === null,
      proof,
      proofRev: proof === null ? null : ev.rev,
      rootKeys,
      dependsOn: proof === null ? [] : [`e:${ev.eid}`],
    });
  }
  if (install.length === 0) return null;
  // Past the bound, the anonymous `unresolved` rule stands in for the rest, which still fails closed (G25).
  const kept = install.length <= PROPOSAL_INSTALL_MAX ? install : [...install.slice(0, PROPOSAL_INSTALL_MAX - 1), { ...install[0]!, id: hasher.id(["allergyPending", "anyone", "unresolved", ev.eid]), subjectId: null, anonymous: true, code: "unresolved", proof: null, proofRev: null, rootKeys: [], dependsOn: [] }];
  return { id: hasher.id(["proposal", "backstop", ev.eid]), origin: "backstop", turnId, eid: ev.eid, install: kept };
}
