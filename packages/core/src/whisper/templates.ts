/**
 * Whisper templates (spec §9 "Words": "Templates serve T renders, S2 renders, controlled acknowledgments and
 * clarifications"). Each is a fixed string with numbered slots `{0}` to `{3}`, or `{*}` for all of a note's tokens
 * joined by ", ". Nothing else is ever put in.
 *
 * Brief 033 (finding 2): every slot of a code template is typed, as contracts `Tpl` gives it: a `name` passes
 * `safeName` and is framed in quotes as data, a `kind` is a member of a closed set, and a `time` fits `TIME_SLOT`.
 * A token that does not fit its type builds no whisper. Only the free renders (`item`, `offer`, `hedged`) and the
 * clarification's two choices carry a note's own words.
 */
import type { W } from "../schema/wire";
import type { GateCarveOut, GateForm, GateRender } from "../gate/reasons";

/** A slot's type. `free` is any one-line token; the rest are typed. */
export type WhisperSlot = "free" | "name" | "kind" | "time";

/** The kinds a third-party note may name (brief 033 finding 2). */
export const MAIL_KINDS = ["email", "invite", "text", "bank"] as const;
/** A clock time and nothing else: "10", "3:30", "10 AM", "3:30 PM". The Head's "personal appointment at 10". */
export const TIME_SLOT = /^(?:1[0-2]|[1-9])(?::[0-5][0-9])?(?: AM| PM)?$/;

export interface WhisperTemplate {
  kind: W["kind"];
  text: string;
  /** The type of each numbered slot, in order; `"1-4"` is `{*}`, one to four free tokens. */
  slots: readonly WhisperSlot[] | "1-4";
}

export const WHISPER_TEMPLATES = {
  item: { kind: "truth", text: "{*}. One line, no recap.", slots: "1-4" },
  offer: { kind: "truth", text: "One offer: {*}. Ask, don't tell.", slots: "1-4" },
  hedged: { kind: "truth", text: "Possibly {*}. Hedge it, not as fact.", slots: "1-4" },
  // "Third-party claims are spoken by type and sender only." The claim itself stays on the card.
  thirdParty: { kind: "truth", text: 'On the card: {1} from the sender "{0}". Say it\'s on the card, nothing more.', slots: ["name", "kind"] },
  // Spec §3: exactly `How's {e} doing?`.
  checkIn: { kind: "moment", text: "How's {0} doing?", slots: ["name"] },
  door: { kind: "moment", text: "How's this week been?", slots: [] },
  s2Appointment: { kind: "moment", text: "Personal appointment at {0}.", slots: ["time"] },
  ackNoted: { kind: "ack", text: "Got it.", slots: [] },
  ackQuiet: { kind: "ack", text: "Okay, I won't bring it up.", slots: [] },
  clarifyWhich: { kind: "clarification", text: "Did you mean {0} or {1}?", slots: ["free", "free"] },
  clarifyDelete: { kind: "clarification", text: "Did you want that deleted?", slots: [] },
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
