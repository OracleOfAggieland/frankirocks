/**
 * The whisper builder (brief 024; spec §2 "Whisper", §9 "Words"). A whisper is made by code from one note's tokens
 * and one fixed template, and adds no fact. It is built only from a Gate `say` whose form, render and carve-out
 * name that template; anything else is null. Controlled acknowledgments and clarifications use `fixedWhisper`.
 */
import { tsFromMs, type Au, type ID, type Sens } from "../schema/primitives";
import { validate } from "../schema/v";
import { W } from "../schema/wire";
import type { GateResult, GateTrigger } from "../gate/types";
import { safeName } from "../safe-name";
import {
  FIXED_TEMPLATE_IDS,
  MAIL_KINDS,
  TEMPLATE_RESULTS,
  TIME_SLOT,
  WHISPER_TEMPLATES,
  type WhisperSlot,
  type WhisperTemplate,
  type WhisperTemplateId,
  templateFor,
} from "./templates";

/** A whisper lives as long as the Deck that carries it (contracts §6 "deck60s"). */
export const WHISPER_TTL_MS = 60_000;
export const WHISPER_MAX_TOKENS = 4;
export const WHISPER_TOKEN_CHARS = 64;

export interface WhisperNote {
  noteId: ID;
  momentId: ID | null;
  sens: Sens;
  rootKeys: readonly string[];
  dependsOn: readonly string[];
  /** The note's words: up to 4 tokens of up to 64 characters, each on one line. */
  tokens: readonly string[];
  /** The candidate the note speaks for; it must be the Gate result's (brief 033 finding 6). */
  candidateId?: ID;
}

export interface WhisperContext {
  /** opsClock now, in ms. */
  opsNow: number;
  trigger: GateTrigger;
}

const ONE_LINE = /^[^\p{Cc}\p{Zl}\p{Zp}]+$/u;

/** A token as its slot's type allows it, or null (brief 033 finding 2): a name through `safeName`, a kind or a result from its closed set, a time by `TIME_SLOT`. */
function slotValue(s: WhisperSlot, k: string): string | null {
  switch (s) {
    case "free":
      return k;
    case "name":
      return safeName(k);
    case "kind":
      return (MAIL_KINDS as readonly string[]).includes(k) ? k : null;
    case "result":
      return (TEMPLATE_RESULTS as readonly string[]).includes(k) ? k : null;
    case "time":
      return TIME_SLOT.test(k) ? k : null;
    default:
      s satisfies never;
      return null;
  }
}

/** The template filled with the note's tokens; null when the count or a token doesn't fit. */
function render(id: WhisperTemplateId, tokens: readonly string[]): { text: string; tokens: string[] } | null {
  const t: WhisperTemplate = WHISPER_TEMPLATES[id];
  if (!Array.isArray(tokens) || tokens.length > WHISPER_MAX_TOKENS) return null;
  if (t.slots === "1-4" ? tokens.length < 1 : tokens.length !== t.slots.length) return null;
  const used: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const k = tokens[i];
    // A token is carried exactly as the note holds it, so one with space around it is refused, not trimmed.
    if (typeof k !== "string" || k.trim() === "" || k !== k.trim() || k.length > WHISPER_TOKEN_CHARS || !ONE_LINE.test(k)) return null;
    const v = slotValue(t.slots === "1-4" ? "free" : t.slots[i]!, k);
    if (v === null) return null;
    used.push(v);
  }
  // One pass over the template only, so a token that looks like a slot is never filled in turn.
  const text = t.text.replace(/\{(\d|\*)\}/g, (_m, d: string) => (d === "*" ? used.join(", ") : (used[Number(d)] ?? "")));
  return { text, tokens: used };
}

function assemble(note: WhisperNote, id: WhisperTemplateId, ctx: WhisperContext): W | null {
  if (note === null || typeof note !== "object") return null;
  const r = render(id, note.tokens);
  if (r === null) return null;
  const t = WHISPER_TEMPLATES[id];
  const kind = t.kind === "truth" && note.momentId !== null ? "moment" : t.kind;
  const w: W = {
    noteId: note.noteId,
    rev: 1,
    kind,
    text: r.text,
    rootKeys: [...note.rootKeys],
    dependsOn: [...note.dependsOn],
    sens: note.sens,
    expiresAt: tsFromMs(ctx.opsNow + WHISPER_TTL_MS),
    unprompted: ctx.trigger !== "recall",
    momentId: note.momentId,
    tokens: r.tokens,
  };
  return validate(W, w).ok ? w : null;
}

/**
 * One Gate-approved note as the whisper the Deck or a Permit carries, or null. The note must name the candidate the
 * Gate decided on and carry its sensitivity (brief 033 finding 6).
 */
export function buildWhisper(note: WhisperNote, g: GateResult, id: WhisperTemplateId, ctx: WhisperContext): W | null {
  if (g === null || typeof g !== "object" || g.verdict !== "say") return null;
  if (note === null || typeof note !== "object") return null;
  if (typeof g.candidateId !== "string" || note.candidateId !== g.candidateId || note.sens !== g.sens) return null;
  if (templateFor(g) !== id) return null;
  return assemble(note, id, ctx);
}

/** A whisper with the template it was built from, which the Deck needs to re-gate it by audience (finding 6). */
export interface GatedWhisper {
  w: W;
  template: WhisperTemplateId;
}

/** `buildWhisper`, keeping the template class beside the whisper. */
export function buildGatedWhisper(note: WhisperNote, g: GateResult, id: WhisperTemplateId, ctx: WhisperContext): GatedWhisper | null {
  const w = buildWhisper(note, g, id, ctx);
  return w === null ? null : { w, template: id };
}

/** Templates that carry third-party or S2-rooted material, or open a door: never heard in company. */
const NOT_IN_COMPANY: ReadonlySet<WhisperTemplateId> = new Set(["thirdParty", "checkIn", "door", "s2Appointment"]);

/**
 * May this audience hear the whisper (spec §6 "Company: S1+ and third-party facts held, doors off, a narrower deck
 * issued"; "Unknown: S1 uses a code template; S2 stays off the wire")? Private hears all; company only S0 that is
 * neither third-party nor a door; unknown S0, or S1 through a typed code template, never S2.
 */
export function audienceMayHear(g: GatedWhisper, audience: Au): boolean {
  const s = g.w.sens;
  switch (audience) {
    case "private":
      return true;
    case "company":
      return s === "S0" && !NOT_IN_COMPANY.has(g.template);
    case "unknown":
      return s === "S0" || (s === "S1" && (g.template === "typed" || g.template === "thirdParty"));
    default:
      audience satisfies never;
      return false;
  }
}

/** A controlled acknowledgment or clarification: fixed text, and only the note's tokens in its slots. */
export function fixedWhisper(note: WhisperNote, id: (typeof FIXED_TEMPLATE_IDS)[number], ctx: WhisperContext): W | null {
  if (!(FIXED_TEMPLATE_IDS as readonly string[]).includes(id)) return null;
  return assemble(note, id, ctx);
}
