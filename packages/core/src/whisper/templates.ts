/**
 * Whisper templates (spec §9 "Words": "Templates serve T renders, S2 renders, controlled acknowledgments and
 * clarifications"). Each is a fixed string with numbered slots `{0}` to `{3}`, or `{*}` for all of a note's tokens
 * joined by ", ". Nothing else is ever put in.
 */
import type { W } from "../schema/wire";
import type { GateCarveOut, GateForm, GateRender } from "../gate/reasons";

export interface WhisperTemplate {
  kind: W["kind"];
  text: string;
  /** Exact token count; `{*}` templates take 1 to 4. */
  slots: number | "1-4";
  /** Slots that hold a name and pass `safeName`. */
  names: readonly number[];
}

export const WHISPER_TEMPLATES = {
  item: { kind: "truth", text: "{*}. One line, no recap.", slots: "1-4", names: [] },
  offer: { kind: "truth", text: "One offer: {*}. Ask, don't tell.", slots: "1-4", names: [] },
  hedged: { kind: "truth", text: "Possibly {*}. Hedge it, not as fact.", slots: "1-4", names: [] },
  thirdParty: { kind: "truth", text: "{0}'s {1} mentions {2}. Say it's on the card.", slots: 3, names: [0] },
  checkIn: { kind: "moment", text: "How's {0} doing?", slots: 1, names: [0] },
  door: { kind: "moment", text: "How's this week been?", slots: 0, names: [] },
  s2Appointment: { kind: "moment", text: "Personal appointment at {0}.", slots: 1, names: [] },
  ackNoted: { kind: "ack", text: "Got it.", slots: 0, names: [] },
  ackQuiet: { kind: "ack", text: "Okay, I won't bring it up.", slots: 0, names: [] },
  clarifyWhich: { kind: "clarification", text: "Did you mean {0} or {1}?", slots: 2, names: [] },
  clarifyDelete: { kind: "clarification", text: "Did you want that deleted?", slots: 0, names: [] },
} as const satisfies Record<string, WhisperTemplate>;

export type WhisperTemplateId = keyof typeof WHISPER_TEMPLATES;

/** Templates that need no Gate result: controlled acknowledgments and clarifications. */
export const FIXED_TEMPLATE_IDS = ["ackNoted", "ackQuiet", "clarifyWhich", "clarifyDelete"] as const satisfies readonly WhisperTemplateId[];

/** The template a Gate `say` must use, from its form, render and carve-out; null when none fits. */
export function templateFor(r: { form: GateForm | null; render: GateRender | null; carveOut: GateCarveOut | null }): WhisperTemplateId | null {
  if (r.form === "checkIn") return "checkIn";
  if (r.form === "door") return "door";
  if (r.form !== "item") return null;
  if (r.carveOut === "oLogistics") return "s2Appointment";
  switch (r.render) {
    case "free":
    case "template":
      return "item";
    case "attributed":
      return "thirdParty";
    case "offer":
      return "offer";
    case "hedged":
      return "hedged";
    case null:
      return null;
    default:
      r.render satisfies never;
      return null;
  }
}

/** The template's own words, without slots: what a whisper may hold besides its note's tokens. */
export function templateWords(id: WhisperTemplateId): string {
  return WHISPER_TEMPLATES[id].text.replace(/\{(?:\d|\*)\}/g, " ");
}
