/**
 * Two people with one name (brief 041 part 2, finding G-FT16; spec Friend Test 16). Pure. A mention joins a stored
 * person by name only when nothing stated about it conflicts with what is stored; a conflicting relation makes a new
 * person whose ID takes the stated role into the hash, and a bare name that fits two people attaches to neither.
 * The roster is read from the stored Memories: every entity an active Memory names, and its current relations to
 * the owner.
 */
import type { Hasher } from "../ids";
import type { Memory } from "../schema/records";
import { mentionName } from "./subject";

/** A relation to the owner, as stored: its code, and its label (the only part that tells two `other`s apart). */
export interface PersonRole {
  code: string;
  label: string | null;
}

export interface PeopleRoster {
  /** Every person entity an active Memory names, with its current relations to the owner (none known: empty). */
  roles: ReadonlyMap<string, readonly PersonRole[]>;
}

export const NO_PEOPLE: PeopleRoster = { roles: new Map() };

const norm = (s: string | null | undefined) => (s === null || s === undefined ? "" : mentionName(s));

/** One relation, or two that are not the same: `other` is told apart by its label, any other code by the code. */
export const sameRole = (a: PersonRole, b: PersonRole): boolean => a.code === b.code && (a.code !== "other" || norm(a.label) === norm(b.label));

/** The salt a person's ID takes when a stated role conflicts with a stored person of that name. */
export const roleSalt = (r: PersonRole): string[] => ["role", r.code, r.code === "other" ? norm(r.label) : ""];

/** The ID of a person of `name` with role `r`, beside a stored person of that name the role conflicts with. */
export const personWithRole = (name: string, r: PersonRole, hasher: Hasher): string => hasher.id(["mention", "person", name, ...roleSalt(r)]);

/** The roster over the stored rows: active Memories only, relations from the owner's current `person.relation`. */
export function peopleRoster(rows: readonly { memory: Memory }[]): PeopleRoster {
  const roles = new Map<string, PersonRole[]>();
  const add = (e: string) => {
    if (e !== "self" && !roles.has(e)) roles.set(e, []);
  };
  for (const { memory: m } of rows) {
    if (m.status !== "active") continue;
    for (const e of m.entityIds) add(e);
    add(m.subjectId);
    if (m.predicate !== "person.relation" || m.subjectId !== "self" || m.value.kind !== "enum") continue;
    const other = (m.args as { otherRef?: unknown }).otherRef;
    if (typeof other !== "string") continue;
    add(other);
    const label = (m.args as { label?: unknown }).label;
    const role = { code: m.value.code, label: typeof label === "string" ? label : null };
    const list = roles.get(other)!;
    if (!list.some((r) => sameRole(r, role))) list.push(role);
  }
  return { roles };
}

/** How a role is said in the "which one" question, by code; `other` by its stored label. */
function rolePhrase(r: PersonRole): string {
  if (r.code === "colleague") return "the one from work";
  if (r.code === "boss") return "your boss";
  if (r.code === "other") return r.label === null || norm(r.label) === "" ? "the other one" : `your ${norm(r.label)}`;
  return `your ${r.code.replace(/_/g, "-")}`;
}

/** "Which Alex, the one from work or your neighbor?": the name as said, and the two stored roles, by code. */
export function whichPersonQuestion(name: string, roles: readonly (readonly PersonRole[])[]): string {
  const phrases = roles.slice(0, 2).map((rs) => (rs[0] === undefined ? "the other one" : rolePhrase(rs[0])));
  return `Which ${name}, ${phrases[0] ?? "the one you mentioned"} or ${phrases[1] ?? "the other one"}?`;
}
