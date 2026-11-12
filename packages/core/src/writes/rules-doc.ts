/**
 * `core/rules` as wave B reads it (brief 018 task B2). Documents written before the wave lack `subjectLabels`,
 * `proposals`, `handled` and `ask`; `withRulesDefaults` fills them (empty, and no question asked), and every read
 * for update goes through it (`readCoreDocs`). Pure.
 */
import type { CoreRules } from "../schema/records";

export type RulesAskDoc = CoreRules["ask"];
export const NO_ASK: RulesAskDoc = { sessionId: null, q: { kind: "none" } };

/** The fields wave B added, empty. */
export function rulesWaveBDefaults(): Pick<CoreRules, "subjectLabels" | "proposals" | "handled" | "ask"> {
  return { subjectLabels: [], proposals: [], handled: [], ask: { sessionId: null, q: { kind: "none" } } };
}

/** A `core/rules` document with wave B's fields filled where a document written before them lacks them. */
export function withRulesDefaults(raw: CoreRules): CoreRules {
  const r = raw as Partial<CoreRules>;
  return {
    ...raw,
    subjectLabels: r.subjectLabels ?? [],
    proposals: r.proposals ?? [],
    handled: r.handled ?? [],
    ask: r.ask ?? { sessionId: null, q: { kind: "none" } },
  };
}
