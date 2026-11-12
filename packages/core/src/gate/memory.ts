/**
 * A Gate candidate from a stored Memory (brief 024). Eligibility is computed here with `eligible` at stage
 * `project`, so a caller can't hand the Gate an unchecked row. Fields a Memory doesn't hold (its topic, the asked
 * terms, the moment's purpose and floor) come from the caller.
 */
import { type Dependent, type EC, type Snapshot, eligible } from "../eligible";
import type { Memory } from "../schema/records";
import type { GateCandidate } from "./types";

export type MemoryFacts = Omit<GateCandidate, "id" | "kind" | "subjectId" | "sourceClass" | "sens" | "allergy" | "eligibility" | "toldAt" | "gravity">;

export function memoryCandidate(x: Dependent, ec: EC, s: Snapshot, facts: MemoryFacts): GateCandidate {
  const e = eligible(x, { ...ec, stage: "project" }, s);
  const m = x.row as Memory;
  const isMemory = x.ref.collection === "memories";
  // Only an active Memory may be said; history, alleged, scheduled and the rest are denied here.
  const allow = e.allow && isMemory && m.status === "active";
  return {
    ...facts,
    id: x.ref.id,
    kind: "memory",
    subjectId: isMemory ? m.subjectId : "",
    sourceClass: isMemory ? m.sourceClass : "M",
    sens: isMemory ? m.sens : "S2",
    allergy: isMemory && m.predicate === "allergy",
    eligibility: { allow, reason: allow ? "ok" : e.allow ? "stale" : e.reason },
    toldAt: isMemory && (m.sourceClass === "U" || m.sourceClass === "C") ? m.assertedAt : null,
    gravity: isMemory ? (m.gravity as 0 | 1 | 2 | 3) : 3,
  };
}
