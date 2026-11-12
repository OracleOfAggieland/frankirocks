/**
 * Did a spoken line add a fact no note held? (brief 024; spec §9 "can add no facts"). Pure and token-based, for use
 * on assistant transcripts. A token carries a fact when it holds a digit or is not one of the closed
 * `FUNCTION_WORDS`. Every such token must appear in a note's text or tokens, or in a template's words. The answer
 * is the list of tokens that don't; empty means nothing was added. Tuning against a live voice is not done here.
 */
import type { W } from "../schema/wire";
import { tokenize } from "../text";
import { WHISPER_TEMPLATES, type WhisperTemplateId, templateWords } from "./templates";

/** Words that state no fact: function words, pronouns, light verbs and the friendly filler of a spoken line. */
export const FUNCTION_WORDS: ReadonlySet<string> = new Set(
  [
    "a an the and or but if so than then that this these those there here it its i me my mine you your yours we us our he him his she her",
    "they them their what which who whom whose when where why how is am are was were be been being do does did done have has had having",
    "will would can could should shall may might must to of in on at by for from with about as into onto over under up down out off again",
    "just really very too also still yet now not no yes yeah ok okay sure well oh hey hi hello thanks thank please sorry good great nice glad",
    "hope luck let lets s t ll re ve d m don didn doesn isn aren wasn won wouldn cannot get got go going come one some any all",
    "more most much many little bit way thing things like know think want need say said tell see look make take give keep mean right",
  ]
    .join(" ")
    .split(" "),
);

const HAS_DIGIT = /\p{N}/u;
const ALL_TEMPLATES = Object.keys(WHISPER_TEMPLATES) as WhisperTemplateId[];

/** Tokens of `spoken` that carry a fact found in no note and no template. */
export function addedFacts(spoken: string, notes: readonly Pick<W, "text" | "tokens">[], templates: readonly WhisperTemplateId[] = ALL_TEMPLATES): string[] {
  if (typeof spoken !== "string") return [];
  const known = new Set<string>();
  for (const n of notes) for (const k of tokenize([n.text, ...n.tokens].join(" "))) known.add(k);
  for (const t of templates) for (const k of tokenize(templateWords(t))) known.add(k);
  const extra: string[] = [];
  for (const k of tokenize(spoken)) {
    if (known.has(k) || extra.includes(k)) continue;
    if (HAS_DIGIT.test(k) || !FUNCTION_WORDS.has(k)) extra.push(k);
  }
  return extra;
}
