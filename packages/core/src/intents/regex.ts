/**
 * The Regex_Table (voice-control R10.2, R10.3; design "The Regex_Table", questions 70 and 90). General cue words,
 * closed. A match never selects a route and never overrules a parse that succeeded: it is logged with the Turn and
 * returned to the Harness. It decides only when the parse failed: then a match cuts a playing reply and answers
 * `clarify` with `recoveryOnly`.
 *
 * No probe sentence of scripts/judge-spike/lines.json, nor a close copy of one, may appear here; the
 * `scripts/regex-copy.test.ts` check enforces it.
 */

export interface RegexRow {
  id: string;
  family: "delete" | "quiet" | "company" | "hardRule" | "crisis" | "correction" | "lifeChange";
  pattern: RegExp;
}

export const REGEX_TABLE: readonly RegexRow[] = [
  { id: "RX1", family: "delete", pattern: /\b(forget|delete|erase|unsave)\b/ },
  { id: "RX2", family: "quiet", pattern: /\b(between us|off the record|keep (it|this|that) (private|quiet|to yourself)|stop (mentioning|bringing))\b/ },
  { id: "RX3", family: "company", pattern: /\b(on speaker|speakerphone|walked in|can hear (you|us|this|me))\b/ },
  { id: "RX4", family: "hardRule", pattern: /\b(allerg(y|ies|ic)|anaphyla\w*|epipen|celiac|coeliac|intoleran(t|ce))\b/ },
  { id: "RX5", family: "crisis", pattern: /\b(suicid\w*|kill myself|end it all|self[- ]harm|hopeless|panic attack|can'?t breathe)\b/ },
  { id: "RX6", family: "correction", pattern: /\b(that'?s (wrong|not right)|i meant|not what i said)\b/ },
  { id: "RX7", family: "lifeChange", pattern: /\b(passed away|died|diagnosed|broke up|divorc\w*|laid off|lost my job)\b/ },
];

/** NFKC, lower case, curly apostrophes made straight, whitespace collapsed. */
export function normalizeForRegex(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[\u2018\u2019\u02bc]/g, "'").replace(/\s+/g, " ").trim();
}

/** The IDs of every row that matches, in table order. Never a class. */
export function regexMatch(text: string): string[] {
  const t = normalizeForRegex(text);
  return REGEX_TABLE.filter((r) => r.pattern.test(t)).map((r) => r.id);
}
