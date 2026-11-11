/**
 * Plans: the closed Command subset the on-turn planners return (contracts §7, narrowed). Pure: a planner writes
 * nothing; the executor commits a Plan's Commands in the turn's transaction. The types live in `types.ts`.
 *
 * The helpers here are the one place `applyCorrection` and `applyTransition` build rows, so both carry the same
 * lineage (G37), transcript order (G35) and negatives (CQ 120).
 */
import { canonicalJSON, rootKey } from "../ids";
import { gravityFloor, maxSens, sensFloor } from "../lexicon";
import { claimText } from "../memory-text";
import { type Class, type EID, type ID, type Pred, type TS, type Value, msFromTs } from "../schema/primitives";
import { checkPredicateFit } from "../schema/predicates";
import type { Memory } from "../schema/records";
import { mentionEid, mentionName } from "./subject";
import { rootSliceOf, spanClass, verifyTurnSpan } from "./spans";
import type { Command, Plan, PlanEnv } from "./types";

export type { Command, Plan, PlanEnv, PlanError } from "./types";

export const refused: Plan = { ok: false, error: "refused" };
export const nothing = (): Plan => ({ ok: true, commands: [] });

/** Two values say the same thing: text by its normalized name, anything else by its canonical JSON. */
export const sameValue = (a: Value, b: Value): boolean =>
  a.kind === "text" && b.kind === "text" ? mentionName(a.text) === mentionName(b.text) : canonicalJSON(a) === canonicalJSON(b);

/**
 * The proof the planner may write from, with its class: the anchored, verified span on the turn, or null. A plan
 * from a proof that doesn't verify, or on another Evidence, writes nothing.
 */
export function provenProof(env: PlanEnv): { cls: Class } | null {
  if (env.proof.eid !== env.evidence.eid || verifyTurnSpan(env.proof, env.evidence) === null) return null;
  return { cls: spanClass(env.proof, env.evidence) };
}

const at = (ts: TS | null): number | null => (ts === null ? null : msFromTs(ts));

/**
 * G35 (2): the incoming value restates a `wrong` row's value on the key, and the turn was asserted at or before that
 * row was refuted. Such an item is skipped (`negated`) and closes nothing.
 */
export function negated(rows: ReadonlyMap<ID, Memory>, key: ID, value: Value, env: PlanEnv): boolean {
  const said = msFromTs(env.evidence.assertedAt);
  for (const m of rows.values()) {
    if (m.key !== key || m.status !== "wrong" || !sameValue(m.value, value)) continue;
    const refutedAt = at(m.validTo);
    if (refutedAt === null || said <= refutedAt) return true;
  }
  return false;
}

/** A row moved to `status`, at the next revision. */
export function moved(m: Memory, status: Memory["status"], validTo: TS | null, closeReason: Memory["closeReason"], env: PlanEnv): Command {
  return { op: "putMemory", id: m.logicalId, expectRev: m.rev, row: { ...m, status, validTo, closeReason, rev: m.rev + 1, updatedAt: env.opsNow } };
}

/** The packet's inputs (G37), minus the rows this plan closes, plus the turn itself. */
export function packetDeps(env: PlanEnv, closed: ReadonlySet<ID>): string[] {
  const keep = (d: string) => ![...closed].some((id) => d.startsWith(`m:${id}@`));
  return [...new Set([`e:${env.evidence.eid}`, ...env.lineage.dependsOn.filter(keep)])];
}

/** A display name for a line: the owner, a name the caller knows, the word in `hint` that derives the EID, or a stand-in. */
export function namer(names: ReadonlyMap<EID, string>, hints: readonly string[], hasher: PlanEnv["hasher"]) {
  return (token: string | null | undefined): string => {
    if (token === null || token === undefined) return "someone";
    if (token === "self") return "the owner";
    const known = names.get(token);
    if (known !== undefined) return known;
    for (const h of hints) {
      for (const w of h.match(/[\p{L}][\p{L}'-]*/gu) ?? []) {
        for (const kind of ["person", "pet", "place", "organization"] as const) if (mentionEid(kind, mentionName(w), hasher) === token) return w;
      }
    }
    return "someone";
  };
}

export interface RowSpec {
  subjectId: EID;
  predicate: Pred;
  kind: Memory["kind"];
  value: Value;
  args: Record<string, unknown>;
  scopeId: string;
  key: ID;
  status: Memory["status"];
  validFrom: TS | null;
  validTo: TS | null;
  validFromKnown: boolean;
  validFromKey: TS;
  closeReason: Memory["closeReason"];
  entityIds: EID[];
  replacesIds: ID[];
  /** The stored line's names (G33); others from the turn's words. */
  names: ReadonlyMap<EID, string>;
  gravity: number;
  closed: ReadonlySet<ID>;
  /** Kept from a corrected row: its spoken time and time row. */
  when?: Memory["when"];
  time?: Memory["time"];
  endWhen?: Memory["endWhen"];
  /** Copied from the row whose words said it (a rename's old name, G33), else the turn's span. */
  rooted?: Pick<Memory, "rootSlices" | "rootKeys" | "assertedAt">;
  /** Lines whose words may name the row's entities (a corrected row's stored line). */
  hints?: readonly string[];
}

/**
 * A new row the turn's words make, rooted in the proof span (KC03), with the packet's lineage (G37) and `assertedAt`
 * from its root Evidence (G35). Null when it doesn't fit its predicate (contracts §3): the planner then writes nothing.
 */
export function newRow(env: PlanEnv, s: RowSpec): Memory | null {
  const slice = rootSliceOf(env.proof, env.evidence, env.hasher);
  const quote = env.proof.quote;
  const nameOf = namer(s.names, [quote, ...(s.hints ?? [])], env.hasher);
  const claim = claimText({ predicate: s.predicate, subject: s.subjectId, value: s.value, args: s.args }, nameOf);
  const line = claim === null ? null : claim.slice(0, 240);
  const sens = maxSens(maxSens(slice.sens, sensFloor(quote)), sensFloor(`${line ?? ""}\n${s.value.kind === "text" ? s.value.text : ""}`));
  const rootSlices = s.rooted?.rootSlices ?? [slice];
  const rootKeys = s.rooted?.rootKeys ?? [rootKey(slice, env.hasher)];
  const id = env.hasher.id(["onTurn", env.evidence.eid, s.key, canonicalJSON(s.value)]);
  const m: Memory = {
    v: 1,
    uid: env.uid,
    rev: 1,
    createdAt: env.opsNow,
    updatedAt: env.opsNow,
    epoch: env.epoch,
    policyRev: env.policyRev,
    rootKeys,
    rootSlices,
    contextIds: env.lineage.contextIds,
    packetEids: [...new Set([env.evidence.eid, ...env.lineage.packetEids])],
    dependsOn: [...new Set([...packetDeps(env, s.closed), ...rootSlices.map((r) => `e:${r.eid}`)])],
    dirty: false,
    dependenciesComplete: true,
    logicalId: id,
    kind: s.kind,
    subjectId: s.subjectId,
    predicate: s.predicate,
    scopeId: s.scopeId,
    key: s.key,
    value: s.value,
    args: s.args,
    bindings: [],
    status: s.status,
    sourceClass: slice.class,
    sens,
    closeReason: s.closeReason,
    lastSupportAt: null,
    flow: "open",
    assertedAt: s.rooted?.assertedAt ?? env.evidence.assertedAt,
    validFrom: s.validFrom,
    validTo: s.validTo,
    validFromKey: s.validFromKey,
    validFromKnown: s.validFromKnown,
    when: s.when ?? { kind: "none" },
    time: s.time ?? null,
    endWhen: s.endWhen ?? { kind: "standing" },
    nextReviewAt: env.nextReviewAt,
    replacesIds: s.replacesIds.slice(0, 16),
    supportingIds: [{ type: "evidence", id: env.evidence.eid, rev: env.evidence.rev }],
    entityIds: [...new Set(s.entityIds.filter((e) => e !== "self"))].slice(0, 32),
    topicIds: [],
    roleKeys: [],
    watchTokens: [],
    watches: [],
    anchorId: null,
    unboundStart: null,
    scheduleRev: 0,
    sayAs: line === null ? null : { text: line, entityRefs: [...new Set(s.entityIds.filter((e) => e !== "self"))].slice(0, 8), timeFields: [] },
    texture: [],
    gravity: Math.max(0, Math.min(3, Math.max(s.gravity, gravityFloor(quote)))) as Memory["gravity"],
    closesId: null,
    possibleClosureSourceId: null,
    expectedArtifactId: null,
    embedding: null,
    vectorVersion: null,
    hypothesis: null,
    loop: null,
  };
  return checkPredicateFit(m, "$") === null ? m : null;
}

/** A Placement as the status a new row gets. */
export const statusOfPlacement = (p: "current" | "history" | "scheduled" | "alleged"): Memory["status"] => (p === "current" ? "active" : p);
