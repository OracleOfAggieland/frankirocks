/**
 * `applyTransition` (contracts §7; design 3.3's truth orders): returns a Plan and writes nothing. `rows` holds the
 * subject's rows on the kind's predicates as read in the transaction.
 *
 * Every value goes through `place` and `closesCurrent` (6.6): a current value moves the old current value to
 * `history`. Transcript order (G35): a change never closes a same-key row asserted after its own turn; it is written
 * `history` up to that row's start instead. A value a `wrong` row holds, said at or before it was refuted, writes
 * nothing (`negated`). Only U and C words carry subject truth (contracts §7); the route never writes `scheduled`.
 */
import { type EID, type ID, type TS, type Value, msFromTs, tsFromMs } from "../schema/primitives";
import type { Memory } from "../schema/records";
import { closesCurrent, place } from "./bitemporal";
import { type RoutePred, keyOf } from "./keys";
import { type RowSpec, moved, negated, newRow, nothing, provenProof, refused, sameValue, statusOfPlacement } from "./plan";
import { statusTransition } from "./status";
import type { Command, Plan, PlanEnv, TransitionVerdict } from "./types";

/** Words of the span a care topic may take (design 3.3: "from the span's words only, no diagnosis"). */
const CARE_WORDS = ["sick", "ill", "unwell", "poorly", "hospital", "injured", "hurt", "recovering"] as const;

const enumV = (code: string): Value => ({ kind: "enum", code });
const ms = (ts: TS | null) => (ts === null ? null : msFromTs(ts));

interface Write {
  subjectId: EID;
  predicate: RoutePred;
  value: Value;
  args: Record<string, unknown>;
  gravity: number;
  entityIds: EID[];
}

export function applyTransition(v: TransitionVerdict, rows: ReadonlyMap<ID, Memory>, env: PlanEnv): Plan {
  if (v.kind !== "change") return nothing();
  const proof = provenProof(env);
  if (proof === null || (proof.cls !== "U" && proof.cls !== "C")) return refused;
  const now = msFromTs(env.worldNow);
  if (v.when > now) return refused; // T6b defers before this; never `scheduled`
  const said = msFromTs(env.evidence.assertedAt);
  const all = [...rows.values()];
  const active = (pred: string, f: (m: Memory) => boolean = () => true) => all.filter((m) => m.predicate === pred && m.status === "active" && f(m));

  const closes = new Map<ID, Memory>();
  const writes: { spec: Omit<RowSpec, "closed">; replaces: ID[] }[] = [];
  const close = (m: Memory) => {
    // G35: an earlier turn never closes a later-asserted row; a refused status is left as it is.
    if (msFromTs(m.assertedAt) > said || statusTransition(m.status, "transition") === "refuse") return false;
    closes.set(m.logicalId, m);
    return true;
  };

  /** One value on its key: skipped when negated or already true, else placed and written, closing what it replaces. */
  const set = (w: Write) => {
    const { scopeId, key } = keyOf(w.subjectId, w.predicate, w.args, w.value, env.hasher);
    if (negated(rows, key, w.value, env)) return;
    const onKey = all.filter((m) => m.key === key && m.status === "active" && !closes.has(m.logicalId));
    if (onKey.some((m) => sameValue(m.value, w.value))) return;
    const later = onKey.filter((m) => msFromTs(m.assertedAt) > said);
    // Never past now: a later row is already true, so this value is history whatever that row's own start says.
    const to = later.length === 0 ? null : Math.min(now, ...later.map((m) => ms(m.validFrom) ?? msFromTs(m.assertedAt)));
    const from = to === null ? v.when : Math.min(v.when, to);
    const placement = place({ from, to, cls: proof.cls, change: "transition" }, now);
    const replaces: ID[] = [];
    if (closesCurrent(placement, "transition")) for (const m of onKey) if (close(m)) replaces.push(m.logicalId);
    writes.push({
      replaces,
      spec: {
        subjectId: w.subjectId,
        predicate: w.predicate,
        kind: w.predicate === "care" ? "care" : "fact",
        value: w.value,
        args: w.args,
        scopeId,
        key,
        status: statusOfPlacement(placement),
        validFrom: tsFromMs(from),
        validTo: to === null ? null : tsFromMs(to),
        validFromKnown: true,
        validFromKey: tsFromMs(from),
        closeReason: to === null ? null : "lapsed",
        entityIds: w.entityIds,
        replacesIds: replaces,
        names: new Map(),
        gravity: w.gravity,
      },
    });
  };

  const S = v.subject;
  const life = (code: string) => set({ subjectId: S, predicate: "person.life", value: enumV(code), args: { detail: null }, gravity: 0, entityIds: [S] });
  const careFor = (m: Memory) => m.args.careSubjectRef === S;
  const resolveCare = () => {
    for (const m of active("care", careFor)) set({ subjectId: m.subjectId, predicate: "care", value: enumV("resolved"), args: m.args, gravity: m.gravity, entityIds: m.entityIds });
  };

  switch (v.transition) {
    case "death":
      if (S === "self") return refused;
      life("deceased");
      resolveCare();
      break;
    case "illness": {
      life("ill");
      const words = env.proof.quote.normalize("NFKC").toLowerCase();
      const topic = CARE_WORDS.find((w) => new RegExp(`\\b${w}\\b`).test(words)) ?? "unwell";
      set({ subjectId: S, predicate: "care", value: enumV("open"), args: { careSubjectRef: S, topic }, gravity: 3, entityIds: [S] });
      break;
    }
    case "recovery":
      life("recovered");
      resolveCare();
      break;
    case "breakup":
      if (S !== "self" || v.counterpart === null) return refused;
      for (const m of active("person.relation", (r) => r.subjectId === "self" && r.args.otherRef === v.counterpart && r.value.kind === "enum" && ["partner", "spouse"].includes(r.value.code))) close(m);
      break;
    case "reunion": {
      if (S !== "self" || v.counterpart === null) return refused;
      const past = all
        .filter((m) => m.predicate === "person.relation" && m.subjectId === "self" && m.status === "history" && m.args.otherRef === v.counterpart)
        .sort((a, b) => (ms(b.validTo) ?? 0) - (ms(a.validTo) ?? 0))[0];
      if (past !== undefined) set({ subjectId: "self", predicate: "person.relation", value: past.value, args: past.args, gravity: past.gravity, entityIds: past.entityIds });
      break;
    }
    case "move": {
      const { key } = keyOf(S, "place.residence", {}, enumV("home"), env.hasher);
      if (v.counterpart !== null) set({ subjectId: S, predicate: "place.residence", value: { kind: "entity", ref: v.counterpart }, args: {}, gravity: 0, entityIds: [S, v.counterpart] });
      else for (const m of all.filter((r) => r.key === key && r.status === "active")) close(m);
      break;
    }
    case "jobChangeOwn":
    case "jobChangeOther": {
      if ((v.transition === "jobChangeOwn") !== (S === "self")) return refused;
      const roles = active("employment.role", (m) => m.subjectId === S && (v.counterpart === null || m.args.employerRef === v.counterpart));
      if (roles.length > 1) return refused; // T6a: more than one role and no employer named
      for (const role of roles) {
        if (!close(role)) continue;
        if (v.transition === "jobChangeOwn") {
          for (const boss of active("person.relation", (m) => m.subjectId === "self" && m.value.kind === "enum" && m.value.code === "boss" && m.args.employerRef === role.args.employerRef)) close(boss);
        }
      }
      break;
    }
  }

  const closed = new Set(closes.keys());
  const validTo = tsFromMs(v.when);
  const commands: Command[] = [...closes.values()].map((m) => moved(m, "history", m.validFrom !== null && msFromTs(m.validFrom) > v.when ? m.validFrom : validTo, m.closeReason, env));
  for (const w of writes) {
    const row = newRow(env, { ...w.spec, closed });
    if (row === null) return refused;
    commands.push({ op: "putMemory", id: row.logicalId, expectRev: null, row });
  }
  return { ok: true, commands };
}
