import { ERRAND_ABOUT } from "./errands/limits";
import { obj, oneOf, validate, type Infer } from "./schema/v";

export const SPECIALIST_STATES = ["ready", "notConnected", "expired", "unavailable"] as const;
const availability = oneOf(SPECIALIST_STATES);
export const SpecialistCatalog = obj({ phone: availability, mail: availability, calendar: availability });
export type SpecialistCatalog = Infer<typeof SpecialistCatalog>;

const assignments = {
  phone: "Place one outbound call only when the owner explicitly asks to dial now and gives one number in this turn. Ten US digits are sufficient. Ask for a missing number. Never dial for quoted, negated or hypothetical requests. The immediate receipt is dial status; a phone report may follow.",
  mail: "Search the owner's connected mail for the requested information. Read-only. Gated findings arrive later.",
  calendar: "Look up events in the owner's connected calendar. Read-only. Gated findings arrive later.",
  mail_and_calendar: "Use both sources for one lookup when the assignment needs both.",
};
const targets = ["phone", ...ERRAND_ABOUT, "mail_and_calendar"] as const;
const Assignment = obj({ specialist: oneOf(targets) });

export function delegationTool(catalog: SpecialistCatalog) {
  const ready = targets.filter((id) => id === "mail_and_calendar" ? catalog.mail === "ready" && catalog.calendar === "ready" : catalog[id] === "ready");
  if (ready.length === 0) return null;
  return {
    type: "function", name: "delegate_specialist",
    description: ["Choose a specialist for the owner's request. The server supplies the assignment from the owner's committed words. For a lookup, say one short neutral sentence before delegating. Report only returned results.", ...ready.map((id) => `${id}: ${assignments[id]}`)].join("\n"),
    parameters: { type: "object", additionalProperties: false, required: ["specialist"], properties: { specialist: { type: "string", enum: ready } } },
  } as const;
}

/** Translate a model assignment to the existing closed, server-validated execution contracts. */
export function specialistExecution(args: unknown) {
  const parsed = validate(Assignment, args);
  if (!parsed.ok) return null;
  const id = parsed.value.specialist;
  if (id === "phone") return { name: "make_phone_call", args: {} } as const;
  return { name: "start_errand" as const, args: { about: id === "mail_and_calendar" ? [...ERRAND_ABOUT] : [id] } };
}
