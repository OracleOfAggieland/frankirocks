/**
 * `applyCorrection` (contracts §7; design 2.4 rows C and R1, G24, G33, G35, G36): the target `wrong`, the successor
 * and its edge, or a rename, or a retraction. Returns a Plan and writes nothing. `rows` holds the targets and every
 * row on their keys as read in the transaction.
 *
 * - A correction marks every target `wrong` (`closeReason: "refuted"`, `validTo` the correcting Evidence's
 *   `assertedAt`), never history (spec §4). Its successor keeps the target's interval (G24) and is placed by `place`,
 *   so a past row's successor is history and the current row is left alone (P6).
 * - The value the target already has writes nothing (`same`); a value a `wrong` row on the key holds, from a turn
 *   asserted at or before that row was refuted, writes nothing (`negated`, G35).
 * - A rename marks the entity's current `identity.name` row `wrong`, or writes the old name as a `wrong` row rooted
 *   where it was said; the new name is a new active row rooted in this turn. The relation row is unchanged (G33).
 * - Only U words correct (contracts §7); a proof on T, M, O or C text, or one that doesn't verify, is refused.
 */
import { canonicalJSON } from "../ids";
import { type ID, msFromTs } from "../schema/primitives";
import type { Memory } from "../schema/records";
import { place } from "./bitemporal";
import { keyOf } from "./keys";
import { type RowSpec, moved, negated, newRow, nothing, provenProof, refused, sameValue, statusOfPlacement } from "./plan";
import { statusTransition } from "./status";
import type { Command, CorrectionVerdict, Plan, PlanEnv } from "./types";

const protectedRow = (m: Memory) => m.kind === "rule" || m.predicate === "allergy";
const ms = (ts: string | null) => (ts === null ? null : msFromTs(ts));

export function applyCorrection(v: CorrectionVerdict, rows: ReadonlyMap<ID, Memory>, env: PlanEnv): Plan {
  if (v.kind === "same" || v.kind === "defer") return nothing();
  const proof = provenProof(env);
  if (proof === null || proof.cls !== "U") return refused;
  if (v.kind === "rename") return rename(v, rows, env);

  const targets: Memory[] = [];
  for (const id of v.targets) {
    const t = rows.get(id);
    if (t === undefined || protectedRow(t) || statusTransition(t.status, "correct") === "refuse") return refused;
    targets.push(t);
  }
  if (targets.length === 0 || new Set(targets.map((t) => t.key)).size !== 1) return refused;
  const first = targets[0]!;
  const refutedAt = env.evidence.assertedAt;
  const wrongs: Command[] = targets.map((t) => moved(t, "wrong", refutedAt, "refuted", env));
  if (v.kind === "retract") return { ok: true, commands: wrongs }; // C6: wrong, no successor (CQ 115)

  // C6b, said again; G35's negative.
  const args = v.args;
  if (targets.every((t) => sameValue(t.value, v.value) && canonicalJSON(t.args) === canonicalJSON(args))) return nothing();
  if (negated(rows, first.key, v.value, env)) return nothing();

  const closed = new Set(targets.map((t) => t.logicalId));
  const placement = place({ from: ms(first.validFrom), to: ms(first.validTo), cls: proof.cls, change: "correct" }, msFromTs(env.worldNow));
  const status = statusOfPlacement(placement);
  // A current value on the key the turn didn't name: the executor defers rather than leave two (G36).
  if (status === "active" && [...rows.values()].some((m) => m.key === first.key && m.status === "active" && !closed.has(m.logicalId))) return refused;
  const spec: RowSpec = {
    subjectId: first.subjectId,
    predicate: first.predicate,
    kind: first.kind,
    value: v.value,
    args,
    scopeId: first.scopeId,
    key: first.key,
    status,
    validFrom: first.validFrom,
    validTo: placement === "current" ? null : first.validTo,
    validFromKnown: first.validFromKnown,
    validFromKey: first.validFromKey,
    closeReason: placement === "history" ? (first.closeReason ?? "lapsed") : null,
    entityIds: first.entityIds,
    replacesIds: [...closed],
    names: new Map(),
    hints: first.sayAs === null ? [] : [first.sayAs.text],
    gravity: first.gravity,
    closed,
    when: first.when,
    time: first.time,
    endWhen: first.endWhen,
  };
  const successor = newRow(env, spec);
  if (successor === null) return refused;
  return { ok: true, commands: [...wrongs, { op: "putMemory", id: successor.logicalId, expectRev: null, row: successor }] };
}

/** Row R1 (G33): the old name `wrong`, the new name active on `identity.name` of the entity. */
function rename(v: Extract<CorrectionVerdict, { kind: "rename" }>, rows: ReadonlyMap<ID, Memory>, env: PlanEnv): Plan {
  const target = rows.get(v.target);
  if (target === undefined || (target.status !== "active" && target.status !== "history")) return refused;
  const to = { kind: "text" as const, text: v.to };
  const { scopeId, key } = keyOf(v.entity, "identity.name", {}, to, env.hasher);
  const current = [...rows.values()].filter((m) => m.key === key && m.status === "active");
  if (current.some((m) => sameValue(m.value, to))) return nothing(); // same
  if (current.length === 0 && sameValue({ kind: "text", text: v.from }, to)) return nothing();
  if (negated(rows, key, to, env)) return nothing();

  const refutedAt = env.evidence.assertedAt;
  const commands: Command[] = current.map((m) => moved(m, "wrong", refutedAt, "refuted", env));
  const closed = new Set(current.map((m) => m.logicalId));
  const label = typeof target.args.label === "string" && target.args.label.trim() !== "" ? target.args.label.trim() : target.value.kind === "enum" ? target.value.code.replace(/_/g, " ") : "contact";
  const names = new Map([[v.entity, target.subjectId === "self" ? `the owner's ${label}` : "someone"]]);
  const base = {
    subjectId: v.entity,
    predicate: "identity.name" as const,
    kind: "fact" as const,
    args: {},
    scopeId,
    key,
    validFromKnown: current[0]?.validFromKnown ?? target.validFromKnown,
    validFromKey: current[0]?.validFromKey ?? target.validFromKey,
    entityIds: [v.entity],
    names,
    gravity: 0,
  };
  if (current.length === 0) {
    // The old name was never a row: it is written `wrong`, rooted where it was said (the target's root slices).
    const old = newRow(env, {
      ...base,
      value: { kind: "text", text: v.from },
      status: "wrong",
      validFrom: target.validFrom,
      validTo: refutedAt,
      closeReason: "refuted",
      replacesIds: [],
      closed,
      rooted: { rootSlices: target.rootSlices, rootKeys: target.rootKeys, assertedAt: target.assertedAt },
    });
    if (old === null) return refused;
    commands.push({ op: "putMemory", id: old.logicalId, expectRev: null, row: old });
  }
  const next = newRow(env, {
    ...base,
    value: to,
    status: "active",
    validFrom: current[0]?.validFrom ?? target.validFrom,
    validTo: null,
    closeReason: null,
    replacesIds: [...closed],
    closed,
  });
  if (next === null) return refused;
  commands.push({ op: "putMemory", id: next.logicalId, expectRev: null, row: next });
  return { ok: true, commands };
}
