/**
 * Plain-English text for a Memory: one short line a Head, a recall packet or the extractor's `open` list can show.
 * Pure. Code writes every word except names and labels; names come only from verified Spans of the Owner's own
 * words (see `planItem`), and labels and text values are trimmed and kept on one line.
 *
 * The line is stored on the Memory as `sayAs.text` when it is written, because entity IDs are one-way hashes:
 * once a Memory holds `otherRef: <ID>`, "Pip" cannot be read back from the ID.
 */
import type { Value } from "./schema/primitives";

/** Longest line kept (the recall line cap is 160; the Head allows more, the Tpl text field allows 512). */
export const MEMORY_TEXT_CHARS = 240;
const LABEL_CHARS = 60;

/** Display names by token: "self" is the Owner; a mention token maps to a verified name or a neutral stand-in. */
export type NameOf = (token: string | null | undefined) => string;

export interface ClaimText {
  predicate: string;
  subject: string;
  value: Value | { kind: "entity"; mention: string } | { kind: string; [k: string]: unknown };
  args: Record<string, unknown>;
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);
const words = (code: string) => code.replace(/_/g, " ");
const cap = (s: string) => (s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1));
const possessive = (name: string) => (name === "the owner" ? "the owner's" : /s$/i.test(name) ? `${name}'` : `${name}'s`);
const strArg = (args: Record<string, unknown>, k: string): string | null => {
  const v = args[k];
  return typeof v === "string" && oneLine(v) !== "" ? clip(oneLine(v), LABEL_CHARS) : null;
};

function valueWords(v: ClaimText["value"], nameOf: NameOf): string {
  switch (v.kind) {
    case "none":
      return "";
    case "text":
      return clip(oneLine(String((v as { text: unknown }).text ?? "")), MEMORY_TEXT_CHARS);
    case "entity": {
      const e = v as { ref?: string; mention?: string };
      return nameOf(e.mention ?? e.ref ?? null);
    }
    case "number": {
      const n = v as { num: number; unit: string };
      return n.unit === "none" || n.unit === "count" ? String(n.num) : `${n.num} ${n.unit}${n.num === 1 ? "" : "s"}`;
    }
    case "boolean":
      return (v as { bool: boolean }).bool ? "yes" : "no";
    case "enum":
      return words(String((v as { code: unknown }).code));
    case "money": {
      const m = v as { amountMinor: number; currency: string };
      return `${(m.amountMinor / 100).toFixed(2)} ${m.currency}`;
    }
    default:
      return "";
  }
}

const RELATION_WORDS: Record<string, string> = { ex_partner: "ex-partner", ex_spouse: "ex-spouse", sister_in_law: "sister-in-law", brother_in_law: "brother-in-law", other: "contact" };
const FOOD_VERBS: Record<string, string> = { like: "likes", dislike: "dislikes", prefer: "prefers", avoid: "avoids" };
const STYLE_WORDS: Record<string, string> = {
  concise: "keep answers short",
  detailed: "give detailed answers",
  teasing_ok: "teasing is welcome",
  no_teasing: "no teasing",
  gentle: "be gentle",
  neutral: "keep a neutral tone",
};
const HANDLING_WORDS: Record<string, string> = {
  answer_first: "give the answer first",
  context_first: "give context first",
  brief: "keep it brief",
  detailed: "give details",
  formal: "be formal",
  casual: "be casual",
  no_teasing: "no teasing",
};
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function clock(minute: unknown): string | null {
  if (typeof minute !== "number" || !Number.isInteger(minute) || minute < 0 || minute > 1439) return null;
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m === 0 ? "" : `:${String(m).padStart(2, "0")}`} ${h < 12 ? "AM" : "PM"}`;
}

/**
 * The text a saved Memory shows in a Head, a recall packet or the extractor's `open` list: its stored line, else
 * `predicate: value` for Memories written before lines were stored. An entity value without a stored line shows as
 * "someone": its ID is a one-way hash and says nothing to the voice model.
 */
export function renderedMemory(m: { predicate: string; value: Value; sayAs: { text: string } | null }): string {
  const said = m.sayAs?.text.replace(/\s+/g, " ").trim();
  if (said !== undefined && said !== "") return said;
  const v = m.value;
  const value = v.kind === "entity" ? (v.ref === "self" ? "the owner" : "someone") : v.kind === "none" ? "none" : valueWords(v, () => "someone");
  return oneLine(`${m.predicate}: ${value}`);
}

/** The line for one claim, or null when there is nothing sayable (a `loop`, an empty value). */
export function claimText(c: ClaimText, nameOf: NameOf): string | null {
  const a = c.args;
  const who = nameOf(c.subject);
  const val = valueWords(c.value, nameOf);
  const code = c.value.kind === "enum" ? String((c.value as { code: unknown }).code) : "";
  let line: string | null;
  switch (c.predicate) {
    case "identity.name":
      line = val === "" ? null : `${possessive(who)} name is ${val}.`;
      break;
    case "identity.alias":
      line = val === "" ? null : a.entityRef === "self" ? `The owner goes by ${val}.` : `${nameOf(a.entityRef as string)} is also called ${val}.`;
      break;
    case "person.relation": {
      const other = nameOf(a.otherRef as string);
      const label = strArg(a, "label") ?? RELATION_WORDS[code] ?? words(code);
      const employer = typeof a.employerRef === "string" ? ` at ${nameOf(a.employerRef)}` : "";
      line = `${other} is ${possessive(who)} ${label}${employer}.`;
      break;
    }
    case "person.life": {
      const detail = strArg(a, "detail");
      line = `${who} is ${words(code)}${detail === null ? "" : ` (${detail})`}.`;
      break;
    }
    case "employment.status":
      line = `${who} is ${code === "working" ? "working" : words(code)}.`;
      break;
    case "employment.role": {
      const employer = typeof a.employerRef === "string" ? ` at ${nameOf(a.employerRef)}` : "";
      line = val === "" ? null : `${who} works as ${val}${employer}.`;
      break;
    }
    case "place.residence":
      line = val === "" ? null : `${who} lives in ${val}.`;
      break;
    case "preference.food": {
      const target = typeof a.targetRef === "string" ? nameOf(a.targetRef) : null;
      const dimension = typeof a.dimension === "string" ? a.dimension : "food";
      if (code === "vegetarian" || code === "vegan") line = `${who} is ${code}.`;
      else if (code === "none") line = `${who} has no ${dimension} preference.`;
      else line = `${who} ${FOOD_VERBS[code] ?? words(code)} ${target ?? `that ${dimension}`}.`;
      break;
    }
    case "preference.schedule": {
      const at = clock(a.minute);
      const days = Array.isArray(a.days) ? (a.days as unknown[]).filter((d): d is number => typeof d === "number" && d >= 0 && d <= 6) : [];
      const on = days.length === 0 || days.length === 7 ? "" : ` on ${days.map((d) => DAYS[d]).join(", ")}`;
      if (code === "no_before") line = `Don't schedule ${who} before ${at ?? "the stated time"}${on}.`;
      else if (code === "no_after") line = `Don't schedule ${who} after ${at ?? "the stated time"}${on}.`;
      else line = `Avoid scheduling ${who}${on === "" ? " on the stated days" : on}.`;
      break;
    }
    case "preference.style": {
      const context = typeof a.context === "string" && a.context !== "global" ? ` (${a.context})` : "";
      line = `With ${who}: ${STYLE_WORDS[code] ?? words(code)}${context}.`;
      break;
    }
    case "handling": {
      const context = typeof a.context === "string" ? ` (${a.context})` : "";
      line = `With ${nameOf(a.personRef as string)}: ${HANDLING_WORDS[code] ?? words(code)}${context}.`;
      break;
    }
    case "allergy": {
      const allergen = strArg(a, "allergenCode") ?? "something";
      const yes = c.value.kind !== "boolean" || (c.value as { bool: boolean }).bool;
      line = yes ? `${who} is allergic to ${words(allergen)}.` : `${who} is not allergic to ${words(allergen)}.`;
      break;
    }
    case "fact": {
      const label = strArg(a, "label");
      if (val === "") line = null;
      else if (label === null) line = c.subject === "self" ? cap(`${val}`) : `${cap(possessive(who))} ${val}`;
      else line = c.subject === "self" ? `${cap(label)}: ${val}` : `${cap(possessive(who))} ${label}: ${val}`;
      break;
    }
    case "goal":
      line = val === "" ? null : `${cap(possessive(who))} goal: ${val}`;
      break;
    case "commitment": {
      const actor = nameOf(a.actorRef as string);
      const recipient = nameOf(a.recipientRef as string);
      line = val === "" ? null : `${actor} promised ${recipient}: ${val}`;
      break;
    }
    case "event": {
      const occasion = typeof a.occasion === "string" && a.occasion !== "other" ? `${cap(a.occasion)}: ` : "Coming up: ";
      line = val === "" ? null : `${occasion}${val}${a.important === true ? " (important)" : ""}`;
      break;
    }
    case "recommendation":
      line = val === "" ? null : `${nameOf(a.recommenderRef as string)} recommended ${val}.`;
      break;
    case "care": {
      const topic = strArg(a, "topic");
      line = `${nameOf(a.careSubjectRef as string)}${topic === null ? "" : ` (${topic})`}: ${words(code)}.`;
      break;
    }
    case "loop":
      line = null;
      break;
    default:
      // episode, habit, hypothesis, bit, story: the text value is the line.
      line = val === "" ? null : cap(val);
  }
  if (line === null) return null;
  return clip(cap(oneLine(line)), MEMORY_TEXT_CHARS);
}
