/**
 * The Head's rules section (brief 012 design 2.8, G25, CQ 116). Pure. Fixed: never dropped. Rendered by subject,
 * active rules first, at most `RULES_RENDER_MAX` lines and `RULES_SECTION_MAX_TOKENS` tokens; past either bound,
 * whole subject lines are replaced by one tail line telling Franki to ask before suggesting any food, which still
 * fails closed. Outside a private audience the heading adds "don't read them aloud" and pending lines name no one.
 * No line quotes turn text: subjects are "You", a stored label, "Someone else" or "Someone", and allergens are
 * gazetteer labels.
 *
 * Lines (private):
 *   Hard rules (they always apply, for everyone named; never suggest anything they rule out):
 *   - You: shellfish, peanuts.
 *   - Your brother: shellfish.
 *   - Not yet clear, ask before suggesting food, for you: any food.
 *   - Not yet clear, ask before suggesting food, for someone: peanuts.
 *   No other allergies (confirmed): you.
 */
import type { Au } from "../schema/primitives";
import type { CoreRules } from "../schema/records";
import { allergenLabel } from "./gazetteer";

export const RULES_RENDER_MAX = 32;
export const RULES_SECTION_MAX_TOKENS = 600;

export const RULES_HEADING = "Hard rules (they always apply, for everyone named; never suggest anything they rule out):";
export const RULES_HEADING_NOT_PRIVATE = "Hard rules (they always apply, for everyone named; never suggest anything they rule out; don't read them aloud with others present):";
export const RULES_NONE = "Hard rules: none recorded. Allergies unknown: ask before suggesting food.";
export const PENDING_PREFIX = "- Not yet clear, ask before suggesting food, for ";
export const NONE_CONFIRMED_PREFIX = "No other allergies (confirmed): ";
/** The start of the fail-closed tail line that replaces whole subject lines past the bounds. */
export const RULES_TAIL_PREFIX = "…and ";
const tail = (n: number) => `${RULES_TAIL_PREFIX}${n} more rules: ask before suggesting any food.`;

export interface RulesTriple {
  subject: string;
  code: string;
  state: "active" | "pending";
}

const tokens = (text: string) => Math.ceil((text.length + 1) / 4);

/** A stored label as a line may hold it: no punctuation a reader splits on, one line, at most 80 units. */
export function cleanLabel(label: string): string {
  return label.replace(/[:;,.…\n\r]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

const capital = (s: string) => (s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1));
const codeLabel = (code: string) => (code === "unresolved" ? "any food" : (allergenLabel(code) ?? cleanLabel(code)));

/** The section's lines for a rules document and an audience. */
export function renderRulesSection(rules: CoreRules, audience: Au): string[] {
  const priv = audience === "private";
  const labels = new Map((rules.subjectLabels ?? []).map((l) => [l.subjectId, cleanLabel(l.label)]));
  const subjectName = (id: string | null, state: "active" | "pending"): string => {
    if (id === null || (state === "pending" && !priv)) return "someone";
    if (id === "self") return "you";
    const l = labels.get(id);
    return l === undefined || l === "" ? "someone else" : l;
  };
  if (rules.allergies.length === 0 && rules.noneConfirmed.length === 0) return [RULES_NONE];

  // Groups by (state, rendered subject), in order: active then pending; the owner first, then first appearance.
  const groups: { state: "active" | "pending"; subject: string; codes: string[] }[] = [];
  for (const state of ["active", "pending"] as const) {
    const of = rules.allergies.filter((r) => r.state === state);
    const ordered = [...of.filter((r) => r.subjectId === "self"), ...of.filter((r) => r.subjectId !== "self")];
    for (const r of ordered) {
      const subject = subjectName(r.subjectId, state);
      let g = groups.find((x) => x.state === state && x.subject === subject);
      if (g === undefined) {
        g = { state, subject, codes: [] };
        groups.push(g);
      }
      g.codes.push(codeLabel(r.code));
    }
  }
  const lineOf = (g: (typeof groups)[number]) => (g.state === "active" ? `- ${capital(g.subject)}: ${g.codes.join(", ")}.` : `${PENDING_PREFIX}${g.subject}: ${g.codes.join(", ")}.`);
  const confirmed = rules.noneConfirmed.map((id) => subjectName(id, "active"));
  const confirmedLine = confirmed.length === 0 ? null : `${NONE_CONFIRMED_PREFIX}${confirmed.join(", ")}.`.slice(0, 400);

  const heading = priv ? RULES_HEADING : RULES_HEADING_NOT_PRIVATE;
  const out = [heading];
  let used = tokens(heading) + (confirmedLine === null ? 0 : tokens(confirmedLine));
  // Room is always kept for the tail line.
  const tailReserve = tokens(tail(256));
  let left = rules.allergies.length;
  let cut = false;
  for (const g of groups) {
    const line = lineOf(g);
    // Heading, the lines so far, this one, the tail and the confirmed line.
    const lines = out.length + 1 + 1 + (confirmedLine === null ? 0 : 1);
    if (cut || lines > RULES_RENDER_MAX || used + tokens(line) + tailReserve > RULES_SECTION_MAX_TOKENS) {
      cut = true;
      continue;
    }
    out.push(line);
    used += tokens(line);
    left -= g.codes.length;
  }
  if (cut) out.push(tail(left));
  if (confirmedLine !== null) out.push(confirmedLine);
  return out;
}

/** Parses the rules section out of a Head's text, back into (subject, allergen label, state) triples (for P3). */
export function readRulesSection(text: string): RulesTriple[] {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l === RULES_HEADING || l === RULES_HEADING_NOT_PRIVATE);
  if (start < 0) return [];
  const out: RulesTriple[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith("- ")) break;
    const pending = line.startsWith(PENDING_PREFIX);
    const body = (pending ? line.slice(PENDING_PREFIX.length) : line.slice(2)).replace(/\.$/, "");
    const at = body.indexOf(": ");
    if (at < 0) continue;
    const subject = body.slice(0, at);
    for (const code of body.slice(at + 2).split(", ")) out.push({ subject, code, state: pending ? "pending" : "active" });
  }
  return out;
}
