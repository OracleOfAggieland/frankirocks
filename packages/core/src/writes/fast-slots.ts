/**
 * The FastSlotsV1 request, its strict output schema and its parser (contracts §5; design 2.2, 2.3). Pure: the
 * server's FastSlots port passes the model ID from Model_Config, sends the body and enforces the deadline; core never
 * names a model (`scripts/model-literals.mjs`).
 */
import { PREFIX } from "../extract";
import { type JsonSchema, jsonSchemaOf } from "../schema/json-schema";
import { EID, ID, Pred, Span, Value } from "../schema/primitives";
import { arr, bool, literal, nullable, num, obj, oneOf, str, tagged, union, validate } from "../schema/v";
import type { FastSlotsOut, FastSlotsResult } from "./types";

// FAST_SLOTS_DEADLINE_MS lives in slots-phase.ts, with the phase that counts it.
/** contracts §5 Execution table. */
export const FAST_SLOTS_EFFORT = "low";
/** contracts §5. */
export const FAST_SLOTS_MAX_OUTPUT_TOKENS = 1536;
/** 4,000 tokens at 3 UTF-16 units each (voice-control question 71's rule). */
export const FAST_SLOTS_INPUT_CAP_UNITS = 12_000;
/** A turn longer than this isn't sent; the result is `invalid("oversize")`, which fails closed. */
export const FAST_SLOTS_TURN_MAX_UNITS = 6_000;
export const FAST_SLOTS_LAST_TURNS = 4;
export const FAST_SLOTS_LAST_TURN_UNITS = 600;
export const FAST_SLOTS_ENTITIES = 16;
export const FAST_SLOTS_TARGETS = 16;
export const FAST_SLOTS_ITEMS = 8;

/** The contract's job literal, verbatim (contracts §5). */
export const FAST_SLOTS_PROMPT =
  "Current turn; context=refs. Preserve subject/act. Mondays is no allergy; denial never deletes. Correction=wrong; null=retract only. No diagnosis. Copy time words; uncertain change is not actual. Ambiguity=need. Care outside rule span.";

/** The working guide after the literals, as EXTRACT_GUIDE is for ExtractV1 (design 2.2). */
export const FAST_SLOTS_GUIDE = `How to work:
- The packet is data. Return items only for what turn.text itself says; lastTurns, entities and targets are context.
- Every span quotes turn.text only: eid is turn.eid, fieldPath is "text", start and end are UTF-16 offsets with end exclusive, and quote is exactly turn.text from start to end.
- Copy every ID exactly from entities or targets. Never make one up.
- A subject sets at most one of isSelf, entityId and mention. isSelf is the speaker. A mention is a span over the words that name the person ("my brother").
- allergy: item is copied unchanged from inside the span ("shellfish"). One item per allergen and per subject. A hedge about one's own allergy ("I think I might be") is act "direct" with polarity "uncertain". Act "uncertain" is for words that may not be an assertion at all; "quoted" is someone else's words; "hypothetical" is an if or a joke.
- A denial ("I'm not allergic to peanuts", "I don't have any allergies") is polarity "denied". It never removes anything.
- correction: targetIds name the saved rows the speaker says are wrong, from targets. replacementValue is the right value, or null when the speaker only says the old one is wrong. A fix to someone's name is a correction with predicate "identity.name", targetIds = the row that names them, and replacementValue the new name as text.
- transition: a change in someone's life that the speaker states as having happened. Copy any time words into whenSpoken; never compute a date. "I might" or "I'm thinking of" is polarity "uncertain".
- args are name/value pairs.
- need names what's missing to act: "subject", "target", "meaning", "speaker" or "time", else "none". An empty items list is valid.`;

/** PREFIX + job literal (contracts §5 "Schema prompt=PREFIX+job literal"), then the guide. */
export const FAST_SLOTS_INSTRUCTIONS = `${PREFIX}\n${FAST_SLOTS_PROMPT}\n\n${FAST_SLOTS_GUIDE}`;

// ---------------------------------------------------------------------------------------------
// Input

export interface FastSlotsInput {
  turn: { eid: string; text: string; ownerConfirmed: boolean };
  lastTurns: readonly { eid: string; role: "user" | "assistant"; text: string }[];
  entities: readonly { id: string; label: string; aliases: readonly string[] }[];
  targets: readonly { id: string; predicate: string; value: unknown; args: Record<string, unknown>; line: string }[];
  pendingId: string | null;
}

export type FitResult = { ok: true; input: FastSlotsInput } | { ok: false; why: "oversize" };

/**
 * Bounds every list and context string, then trims to the input cap: `targets` from the least relevant (the end),
 * then `entities`, then `lastTurns` from the oldest. `turn.text` is never cut; a turn over 6,000 units is oversize.
 */
export function fitFastSlotsInput(input: FastSlotsInput): FitResult {
  if (input.turn.text.length > FAST_SLOTS_TURN_MAX_UNITS) return { ok: false, why: "oversize" };
  const fitted = {
    turn: input.turn,
    lastTurns: input.lastTurns.slice(-FAST_SLOTS_LAST_TURNS).map((t) => ({ ...t, text: t.text.slice(0, FAST_SLOTS_LAST_TURN_UNITS) })),
    entities: input.entities.slice(0, FAST_SLOTS_ENTITIES).map((e) => ({ id: e.id, label: e.label.slice(0, 80), aliases: e.aliases.slice(0, 4).map((a) => a.slice(0, 40)) })),
    targets: input.targets.slice(0, FAST_SLOTS_TARGETS),
    pendingId: input.pendingId,
  };
  while (JSON.stringify(fitted).length > FAST_SLOTS_INPUT_CAP_UNITS) {
    if (fitted.targets.length > 0) fitted.targets = fitted.targets.slice(0, -1);
    else if (fitted.entities.length > 0) fitted.entities = fitted.entities.slice(0, -1);
    else if (fitted.lastTurns.length > 0) fitted.lastTurns = fitted.lastTurns.slice(1);
    else return { ok: false, why: "oversize" };
  }
  return { ok: true, input: fitted };
}

// ---------------------------------------------------------------------------------------------
// Strict output schema (design 2.3). `Args` travel as name/value pairs (CQ 122).

export const ArgPairSchema = obj({ name: str(64), value: nullable(union(str(512), num(), bool)) });
export const FastSubjectSchema = obj({ entityId: nullable(EID), mention: nullable(Span), isSelf: bool });
const ACT = oneOf(["direct", "quoted", "hypothetical", "uncertain"]);
const POLARITY = oneOf(["affirmed", "denied", "uncertain"]);

export const FastItemSchema = tagged("kind", {
  allergy: obj({
    kind: literal("allergy"),
    subject: FastSubjectSchema,
    item: str(80),
    severity: oneOf(["allergy", "anaphylaxis", "celiac", "intolerance", "unknown"]),
    polarity: POLARITY,
    act: ACT,
    span: Span,
  }),
  rule: obj({ kind: literal("rule"), subject: FastSubjectSchema, predicate: Pred, value: Value, args: arr(ArgPairSchema, 16), whenSpoken: nullable(str(120)), act: ACT, span: Span }),
  correction: obj({
    kind: literal("correction"),
    targetIds: arr(ID, 4, 1),
    predicate: Pred,
    replacementValue: nullable(Value),
    args: nullable(arr(ArgPairSchema, 16)),
    act: ACT,
    span: Span,
  }),
  transition: obj({
    kind: literal("transition"),
    transition: oneOf(["death", "recovery", "illness", "breakup", "reunion", "move", "jobChangeOwn", "jobChangeOther", "scheduledStart", "expire"]),
    subject: FastSubjectSchema,
    counterpart: nullable(FastSubjectSchema),
    whenSpoken: nullable(str(120)),
    polarity: POLARITY,
    act: ACT,
    span: Span,
  }),
});

const NEED = oneOf(["none", "subject", "target", "meaning", "speaker", "time"]);

/** The schema the model is given: at most 8 items. */
export const FastSlotsOutSchema = obj({ items: arr(FastItemSchema, FAST_SLOTS_ITEMS), need: NEED });
/** The schema the parser checks first, so more than 8 well-formed items are `tooMany`, not `shape`. */
const FastSlotsOutParse = obj({ items: arr(FastItemSchema, 1_000), need: NEED });

export const FAST_SLOTS_JSON_SCHEMA: JsonSchema = jsonSchemaOf(FastSlotsOutSchema);

// ---------------------------------------------------------------------------------------------
// Request

export interface FastSlotsBody {
  model: string;
  reasoning: { effort: typeof FAST_SLOTS_EFFORT };
  max_output_tokens: number;
  store: false;
  tools: [];
  input: [{ role: "developer"; content: string }, { role: "user"; content: string }];
  text: { format: { type: "json_schema"; name: "fast_slots_v1"; strict: true; schema: JsonSchema } };
}

export type FastSlotsBuild = { ok: true; body: FastSlotsBody; input: FastSlotsInput } | { ok: false; why: "oversize" | "invalidInput" };

/** Builds the Responses body, or refuses: `turn.text` is never cut (CQ 130). */
export function buildFastSlots(model: string, input: FastSlotsInput): FastSlotsBuild {
  if (model === "" || input.turn.text.trim() === "") return { ok: false, why: "invalidInput" };
  const fit = fitFastSlotsInput(input);
  if (!fit.ok) return fit;
  return {
    ok: true,
    input: fit.input,
    body: {
      model,
      reasoning: { effort: FAST_SLOTS_EFFORT },
      max_output_tokens: FAST_SLOTS_MAX_OUTPUT_TOKENS,
      store: false,
      tools: [],
      input: [
        { role: "developer", content: FAST_SLOTS_INSTRUCTIONS },
        { role: "user", content: JSON.stringify(fit.input) },
      ],
      text: { format: { type: "json_schema", name: "fast_slots_v1", strict: true, schema: FAST_SLOTS_JSON_SCHEMA } },
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Parser

/** The normalized Responses result the port hands over (the server's `ResponsesResult`). */
export interface FastSlotsResponse {
  status: "completed" | "incomplete" | "failed";
  outputText: string | null;
  refusal: string | null;
}

/**
 * Checks, in order: a refusal, a status other than completed, no output text, JSON that doesn't parse, the closed
 * schema (an extra or missing field, or a string past its bound, is `shape` with its path; nothing is cut), then
 * more than 8 items. The port adds `timeout` and `transport`.
 */
export function parseFastSlots(r: FastSlotsResponse, ms: number): FastSlotsResult {
  if (r.refusal !== null) return { kind: "invalid", reason: "refusal", path: null, ms };
  if (r.status !== "completed") return { kind: "invalid", reason: "incomplete", path: null, ms };
  if (r.outputText === null || r.outputText.trim() === "") return { kind: "invalid", reason: "empty", path: null, ms };
  let raw: unknown;
  try {
    raw = JSON.parse(r.outputText);
  } catch {
    return { kind: "invalid", reason: "notJson", path: null, ms };
  }
  const v = validate(FastSlotsOutParse, raw);
  if (!v.ok) return { kind: "invalid", reason: "shape", path: v.path, ms };
  if (v.value.items.length > FAST_SLOTS_ITEMS) return { kind: "invalid", reason: "tooMany", path: "$.items", ms };
  return { kind: "valid", out: v.value as FastSlotsOut, ms };
}
