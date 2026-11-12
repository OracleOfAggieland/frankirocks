/**
 * A pasted allergy line (brief 041 part 1, finding G-A2). Pure. Pasted text is third-party (T): it writes no rule,
 * preference, identity or `life` (spec §4). It can only subtract: when the allergy cues wave B reads (RX4 and the
 * gazetteer's aliases) match a pasted line, each named allergen becomes one anonymous pending filter, the shape the
 * hard-rule route writes for an unclear statement, so every food path that reads pending rules filters it unchanged.
 *
 * Nothing of the pasted words is kept: the filter has no proof Span (a proof quotes the paste), only the Evidence's
 * root keys and `e:<eid>` as its source. The one question is a code template that names the allergen by its label
 * from the code list. The owner's own answer goes through the hard-rule route as any answer does.
 */
import type { Hasher } from "../ids";
import { REGEX_TABLE, normalizeForRegex } from "../intents/regex";
import type { ID } from "../schema/primitives";
import type { CoreRules } from "../schema/records";
import { allergenLabel, scanAliases } from "./gazetteer";
import { pendingNext } from "./pending";
import type { TurnEvidence } from "./types";

/** At most this many filters from one paste. */
export const PASTE_FILTERS_MAX = 3;
/** At most this many paste filters open at once for an owner. */
export const PASTE_FILTERS_OPEN_MAX = 6;

type AllergyRule = CoreRules["allergies"][number];

const RX4 = REGEX_TABLE.find((r) => r.id === "RX4")!.pattern;

/**
 * Whether a pending rule came from a paste: no proof Span, yet a source in the Evidence's root keys. Rules from the
 * hard-rule route or the backstop either carry a proof or have no root keys at all.
 */
export const fromPaste = (r: AllergyRule): boolean => r.state === "pending" && r.proof === null && r.rootKeys.length > 0;

/** The one question for a paste, by code template. */
export function pasteQuestion(code: string): string {
  const label = (allergenLabel(code) ?? code).toLowerCase();
  return `You pasted something about an allergy to ${label}. Is that you, or someone you eat with?`;
}

/** The allergen codes a pasted line's cues name, in order, once each; none when RX4 doesn't match. */
export function pastedAllergens(text: string): string[] {
  if (!RX4.test(normalizeForRegex(text))) return [];
  return [...new Set(scanAliases(text).map((m) => m.code))];
}

export interface PasteResult {
  rules: CoreRules;
  /** The filters written this turn. */
  installed: AllergyRule[];
  /** The allergen the question names, or null when the cues matched nothing. */
  asked: string | null;
}

/**
 * The filters and the question for one pasted turn. `sessionId` and `seq` place the question as the route does
 * (6.4). Past either cap no further filter is written, and the question still goes out.
 */
export function pastedFilters(rules: CoreRules, ev: TurnEvidence, at: { sessionId: ID; seq: number }, hasher: Hasher): PasteResult | null {
  const codes = pastedAllergens(ev.text);
  if (codes.length === 0) return null;
  const open = rules.allergies.filter(fromPaste).length;
  const installed: AllergyRule[] = [];
  for (const code of codes) {
    if (installed.length >= PASTE_FILTERS_MAX || open + installed.length >= PASTE_FILTERS_OPEN_MAX) break;
    // A slot already filtered for everyone stays as it is.
    if (rules.allergies.some((r) => r.code === code && (r.subjectId === null || r.anonymous))) continue;
    const rootKeys = ev.slices.flatMap((s, i) => (s.class === "T" && ev.rootKeys[i] !== undefined ? [ev.rootKeys[i]!] : [])).slice(0, 16);
    if (rootKeys.length === 0) continue;
    installed.push({
      id: hasher.id(["allergyPaste", code, ev.eid]),
      subjectId: null,
      code,
      state: "pending",
      anonymous: true,
      proof: null,
      proofRev: null,
      rootKeys,
      dependsOn: [`e:${ev.eid}`],
    });
  }
  const askedCode = installed[0]?.code ?? codes[0]!;
  const askedRule = installed[0] ?? rules.allergies.find((r) => r.code === askedCode && r.state === "pending") ?? null;
  const prior = rules.ask ?? { sessionId: null, q: { kind: "none" as const } };
  const q0 = prior.sessionId === at.sessionId ? prior.q : { kind: "none" as const };
  const q = askedRule === null ? q0 : pendingNext(q0, { kind: "ask", ruleId: askedRule.id, seq: at.seq });
  const next: CoreRules = {
    ...rules,
    allergies: [...rules.allergies, ...installed],
    rulesRev: installed.length > 0 ? rules.rulesRev + 1 : rules.rulesRev,
    ask: q.kind === "none" ? prior : { sessionId: at.sessionId, q },
  };
  return { rules: next, installed, asked: askedRule === null ? null : askedCode };
}
