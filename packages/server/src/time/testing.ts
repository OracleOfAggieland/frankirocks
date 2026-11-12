/**
 * Test setup for the time lane (brief 036): a small tenant with core documents, a fixture world clock and occasions
 * written as a transition writes them, so the server-path properties stay cheap at 1,000 runs. Test code only.
 */
import { type CoreState, type Memory, type Moment, type Time, msFromTs, tsFromMs } from "@franki/core";
import { testId } from "@franki/core/testing";
import { ensureCoreDocs } from "../core-docs";
import type { RouteContext } from "../routes/runtime";
import { linkedEvidence, linkedMemory } from "../store/conformance";
import { paths } from "../store/paths";
import { type TestRig, patchRecord } from "../testing/fakes";
import { scanMoments } from "./tick";

const pad = (n: number) => String(n).padStart(2, "0");

/** The civil date-time of `ms` in `zone`, as the resolver writes it. */
export function civilAt(ms: number, zone: string): string {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${pad(Number(p.month))}-${pad(Number(p.day))}T${pad(Number(p.hour) % 24)}:${pad(Number(p.minute))}`;
}

/** An instant time row starting at `startMs`, with no end. */
export function instantTime(startMs: number, zone: string): Time {
  return { start: tsFromMs(startMs), end: null, zone, civilStart: civilAt(startMs, zone), civilEnd: null, precision: "instant", rrule: null, dtstart: null, originalCivilStart: null, recurrence: null };
}

/** Core documents in fixture clock mode at `worldMs`, for `uid`. */
export async function timeTenant(rig: TestRig, uid: string, zone: string, worldMs: number): Promise<RouteContext> {
  await ensureCoreDocs(uid, rig.deps, zone);
  await patchRecord<CoreState>(rig.store, uid, paths.core(uid, "state"), { clockMode: "fixture", worldClock: tsFromMs(worldMs) });
  return { uid, deps: rig.deps, schedule: () => undefined };
}

/** Moves the fixture world clock to `worldMs` (forward or not: test setup only). */
export async function setWorld(rig: TestRig, uid: string, worldMs: number): Promise<void> {
  await patchRecord<CoreState>(rig.store, uid, paths.core(uid, "state"), { worldClock: tsFromMs(worldMs) });
}

export async function worldOf(rig: TestRig, uid: string): Promise<number> {
  return msFromTs((await rig.store.get<CoreState>(uid, paths.core(uid, "state")))!.data.worldClock!);
}

/** Writes one occasion (an event Memory with its Evidence) and returns its logical ID. */
export async function writeOccasion(rig: TestRig, uid: string, label: string, startMs: number, zone: string, overrides: Partial<Memory> = {}): Promise<string> {
  const ev = linkedEvidence(rig.deps.hasher, `occasion-ev-${label}`, `I have the Tessellate Labs final interview (${label}).`);
  const id = testId(`occasion-${label}`);
  const m = linkedMemory(rig.deps.hasher, ev, {
    logicalId: id,
    key: testId(`occasion-key-${label}`),
    kind: "event",
    predicate: "event",
    sens: "S0",
    value: { kind: "text", text: "Tessellate Labs final interview" },
    args: { occasion: "interview", anchorRef: null, important: true },
    when: { kind: "spoken", spoken: "tomorrow at 2" },
    time: instantTime(startMs, zone),
    ...overrides,
  });
  await rig.store.transaction(uid, async (tx) => {
    if ((await tx.get(paths.evidence(uid, ev.eid))) === null) tx.create(paths.evidence(uid, ev.eid), { ...ev.record, uid });
    tx.create(paths.memory(uid, id), { ...m, uid });
  });
  return id;
}

/**
 * Moves an occasion the way a transition does: a new event row that replaces the current one, with the new start,
 * and the old row set to `history`, in one transaction. Returns the new row's ID.
 */
export async function moveOccasion(rig: TestRig, uid: string, currentId: string, newId: string, startMs: number): Promise<string> {
  await rig.store.transaction(uid, async (tx) => {
    const old = (await tx.get<Memory>(paths.memory(uid, currentId)))!.data;
    const time = instantTime(startMs, old.time!.zone);
    tx.create(paths.memory(uid, newId), { ...old, rev: 1, logicalId: newId, key: testId(`key-${newId}`), replacesIds: [currentId], time, status: "active" });
    tx.update(paths.memory(uid, currentId), { ...old, status: "history" });
  });
  return newId;
}

/** Every moment row of `uid`, by ID. */
export async function momentsOf(rig: TestRig, uid: string): Promise<Map<string, Moment>> {
  const rows = (await scanMoments({ get: (p) => rig.store.get(uid, p), query: (q) => rig.store.query(uid, q) }, uid)) ?? [];
  return new Map(rows.map((d) => [d.id, d.data]));
}

export const ofKind = (all: Map<string, Moment>, kind: Moment["kind"]): [string, Moment][] => [...all.entries()].filter(([, m]) => m.kind === kind);
