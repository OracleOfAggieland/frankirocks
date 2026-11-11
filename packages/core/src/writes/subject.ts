/**
 * Subjects (design 2.4, rows SU1 to SU8; G7). Pure. Stub from wave A task A2; task A5 builds it.
 */
import type { Hasher } from "../ids";
import type { EID } from "../schema/primitives";
import type { EntityKind, Subject, SubjectIndex, TurnEvidence } from "./types";
import { NotBuilt } from "./types";

/** NFKC, lowercase, a leading "my", "our" or "the" dropped: the one function that turns words into a name. */
export function mentionName(_words: string): string {
  throw new NotBuilt("mentionName");
}

/** The code-derived EID of a mention, as extraction's `resolveMention` derives it. */
export function mentionEid(_kind: EntityKind, _name: string, _hasher: Hasher): EID {
  throw new NotBuilt("mentionEid");
}

export type SubjectResult = { kind: "resolved"; id: EID; label: string | null } | { kind: "ambiguous" } | { kind: "unresolved" };

/** The subject table: the first matching row decides. */
export function resolveSubject(_s: Subject, _span: TurnEvidence, _known: SubjectIndex, _kind: EntityKind, _hasher: Hasher): SubjectResult {
  throw new NotBuilt("resolveSubject");
}
