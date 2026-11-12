/**
 * The doors a company or quiet hit comes in by, and the probes that read what each route answers afterwards, for the
 * audience properties of brief 035 (`routes/audience-*.property.test.ts`). Plain module.
 *
 * Every door starts from a rig with one S0 and one S1 Memory (`two-memories.ts`), so a Head that still holds
 * `PERSONAL_FACT` is a private Head. A door narrows Session A; `answers` holds every answer from the narrowing on.
 */
import { type CoreEpoch, type CoreRules, type Session } from "@franki/core";
import { testId } from "@franki/core/testing";
import fc from "fast-check";
import { ensureCoreDocs } from "../core-docs";
import { never, ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { closeRoute } from "../routes/close";
import { openRoute } from "../routes/open";
import { stateRoute } from "../routes/state";
import { turnRoute } from "../routes/turn";
import { paths } from "../store/paths";
import { decisionAnswer } from "./decisions";
import { type TestRig, callRoute, patchRecord, settle, testRig } from "./fakes";
import { asrTurn, openTestSession, typedTurn } from "./session-fixtures";
import { PERSONAL_FACT, seedTwoMemories } from "./two-memories";

export const UID = "owner-1";

export const DOOR_KINDS = ["onTurn", "repair", "supersede", "typedNoCall", "crisisLive", "crisisTyped", "forgetLive", "forgetTyped", "replaced"] as const;
export type DoorKind = (typeof DOOR_KINDS)[number];

export interface Door {
  kind: DoorKind;
  /** Company or quiet. */
  cls: "company" | "quiet";
  p: number;
  judge: "H" | "U" | "timeout" | "error";
}

export const doorArb: fc.Arbitrary<Door> = fc.record({
  kind: fc.constantFrom(...DOOR_KINDS),
  cls: fc.constantFrom<"company" | "quiet">("company", "quiet"),
  p: fc.constantFrom(0.3, 0.6, 0.9),
  judge: fc.constantFrom<Door["judge"]>("H", "U", "timeout", "error"),
});

type Stamp = Awaited<ReturnType<typeof openTestSession>>["stamp"];

export interface Narrowed {
  rig: TestRig;
  /** The Session the hit narrowed. */
  id: string;
  /** The stamp the browser holds after the narrowing answer. */
  stamp: Stamp;
  typed: boolean;
  /** The next clientSeq on A. */
  seq: number;
  /** Every answer from the narrowing on: the route, the Session it named, the HTTP status and the body. */
  answers: Answer[];
  policyRevBefore: number;
}

export interface Answer {
  route: string;
  sessionId: string;
  status: number;
  body: any;
}

const epochOf = async (rig: TestRig) => (await rig.store.get<CoreEpoch>(UID, paths.core(UID, "epoch")))!.data;
export const sessionOf = async (rig: TestRig, id: string) => (await rig.store.get<Session>(UID, paths.session(UID, id)))!.data;
export const rulesOf = async (rig: TestRig) => (await rig.store.get<CoreRules>(UID, paths.core(UID, "rules")))!.data;

export const postTurn = (rig: TestRig, body: unknown) => settle(callRoute(rig, turnRoute, body), rig.clock, rig.timers).then((r) => r.value);
export const runAll = (rig: TestRig) => settle(rig.sched.runAll(), rig.clock, rig.timers);

/** The stamp in an answer, or the old one. */
export function stampAfter(old: Stamp, body: any): Stamp {
  const s = body?.stamp ?? body?.deck;
  if (s === undefined || s === null) return old;
  return { ...old, epoch: s.epoch, policyRev: s.policyRev, bundleRev: s.bundleRev, rulesRev: s.rulesRev };
}

/** A fresh rig with the two Memories and an open Session; with `live`, the Session has a registered call. */
export async function doorRig(live: boolean, seed?: (rig: TestRig) => Promise<void>) {
  const rig = testRig();
  rig.openai.always("responses.create", ok(completed("All right.")));
  rig.openai.always("realtime.calls.hangup", ok(null));
  await seedTwoMemories(rig);
  if (seed !== undefined) {
    await ensureCoreDocs(UID, rig.deps);
    await seed(rig);
  }
  const s = await openTestSession(rig);
  if (live) await patchRecord<Session>(rig.store, UID, paths.session(UID, s.sessionId), { status: "active", registeredCallIds: ["rtc_a"], callId: "rtc_a" });
  return { rig, s };
}

const items = (n: number, tag = "a") => [{ itemId: `item_${tag}${n}`, commitSeq: n }];

/** Runs one door on a fresh rig and returns the narrowed Session with every answer from the narrowing on. */
export async function runDoor(d: Door, seed?: (rig: TestRig) => Promise<void>): Promise<Narrowed> {
  const typed = d.kind === "typedNoCall" || d.kind === "crisisTyped" || d.kind === "forgetTyped";
  const { rig, s } = await doorRig(!typed, seed);
  const policyRevBefore = (await epochOf(rig)).policyRev;
  const hit: Record<string, number> = { [d.cls]: d.p };
  if (d.kind === "crisisLive" || d.kind === "crisisTyped") hit.crisis = 0.6;
  if (d.kind === "forgetLive" || d.kind === "forgetTyped") hit.forget = 0.9;
  const text = "My boss just walked in.";
  const answers: Answer[] = [];
  const voice = (stamp: Stamp, n: number, label: string) => ({ ...asrTurn(stamp, n, text, items(n), "final", label), judge: d.judge });
  let stamp = s.stamp;
  switch (d.kind) {
    case "repair": {
      // The first Decisions call misses its deadline; the Parse_Repair answers the hit.
      rig.openai.script("decisions.create", never(), ok(decisionAnswer(hit)));
      const first = await postTurn(rig, voice(stamp, 1, "1"));
      stamp = stampAfter(stamp, first.body);
      await runAll(rig);
      break;
    }
    case "supersede": {
      const first = await postTurn(rig, { ...asrTurn(stamp, 1, "", items(1), "missing", "1"), judge: d.judge });
      stamp = stampAfter(stamp, first.body);
      rig.openai.script("decisions.create", ok(decisionAnswer(hit)));
      const late = await postTurn(rig, { ...asrTurn(stamp, 1, text, items(1), "final", "1"), judge: d.judge, requestId: testId("req-1-late"), supersedesRequestId: testId("req-1") });
      answers.push({ route: "turn", sessionId: s.sessionId, status: late.status, body: late.body });
      stamp = stampAfter(stamp, late.body);
      await runAll(rig);
      break;
    }
    case "replaced": {
      // An open naming A lands before the company turn on A does.
      const b = await callRoute(rig, openRoute, { requestId: testId("open-b"), initiator: "user", previousSessionId: s.sessionId, clientZone: "UTC", visitId: null });
      answers.push({ route: "open", sessionId: b.body.sessionId, status: b.status, body: b.body });
      rig.openai.script("decisions.create", ok(decisionAnswer(hit)));
      const res = await postTurn(rig, voice(stamp, 1, "1"));
      answers.push({ route: "turn", sessionId: s.sessionId, status: res.status, body: res.body });
      stamp = stampAfter(stamp, res.body);
      await runAll(rig);
      break;
    }
    default: {
      rig.openai.script("decisions.create", ok(decisionAnswer(hit)));
      const body = typed ? typedTurn(stamp, 1, text, "1") : voice(stamp, 1, "1");
      const res = await postTurn(rig, body);
      answers.push({ route: "turn", sessionId: s.sessionId, status: res.status, body: res.body });
      stamp = stampAfter(stamp, res.body);
      await runAll(rig);
    }
  }
  return { rig, id: s.sessionId, stamp, typed, seq: 2, answers, policyRevBefore };
}

// ---------------------------------------------------------------------------------------------
// Probes: what each route answers after the narrowing.

export const PROBE_KINDS = ["turnHere", "stateHere", "openNaming", "turnOnOpened", "stateOnOpened", "stateActive"] as const;
export type ProbeKind = (typeof PROBE_KINDS)[number];

export interface ProbeRun {
  n: Narrowed;
  /** The Session the last open created, if any. */
  opened: { id: string; stamp: Stamp; seq: number } | null;
}

/** Runs one probe and records its answer. */
export async function probe(run: ProbeRun, kind: ProbeKind, i: number): Promise<void> {
  const { n } = run;
  const { rig } = n;
  const state = (id: string, stamp: Stamp) =>
    callRoute(rig, stateRoute, { sessionId: id, generation: 1, seen: { epoch: stamp.epoch, policyRev: stamp.policyRev, bundleRev: stamp.bundleRev, rulesRev: stamp.rulesRev }, ackStamp: null, speechStartedOpsAt: null });
  const ordinary = (stamp: Stamp, seq: number, typed: boolean, label: string) =>
    typed ? typedTurn(stamp, seq, "What's on for tonight?", label) : { ...asrTurn(stamp, seq, "What's on for tonight?", items(seq, label), "final", label), judge: "O" };
  const record = (route: string, sessionId: string, res: { status: number; body: any }) => n.answers.push({ route, sessionId, status: res.status, body: res.body });
  switch (kind) {
    case "turnHere": {
      rig.openai.script("decisions.create", ok(decisionAnswer()));
      const res = await postTurn(rig, ordinary(n.stamp, n.seq, n.typed, `p${i}`));
      record("turn", n.id, res);
      if (res.status === 200) {
        n.seq++;
        n.stamp = stampAfter(n.stamp, res.body);
      }
      await runAll(rig);
      return;
    }
    case "stateHere": {
      const res = await state(n.id, n.stamp);
      record("state", n.id, res);
      if (res.status === 200) n.stamp = stampAfter(n.stamp, res.body);
      return;
    }
    case "openNaming": {
      const res = await callRoute(rig, openRoute, { requestId: testId(`open-p${i}`), initiator: "user", previousSessionId: n.id, clientZone: "UTC", visitId: null });
      record("open", res.body?.sessionId ?? "", res);
      if (res.status === 200 && res.body.deck !== null) {
        const d = res.body.deck;
        run.opened = { id: res.body.sessionId, stamp: { sessionId: res.body.sessionId, epoch: d.epoch, policyRev: d.policyRev, bundleRev: d.bundleRev, rulesRev: d.rulesRev, generation: 1 }, seq: 1 };
        await patchRecord<Session>(rig.store, UID, paths.session(UID, res.body.sessionId), { status: "active", registeredCallIds: [`rtc_p${i}`], callId: `rtc_p${i}` });
      }
      await runAll(rig);
      return;
    }
    case "turnOnOpened": {
      const o = run.opened;
      if (o === null) return;
      rig.openai.script("decisions.create", ok(decisionAnswer()));
      const res = await postTurn(rig, ordinary(o.stamp, o.seq, false, `q${i}`));
      record("turn", o.id, res);
      if (res.status === 200) {
        o.seq++;
        o.stamp = stampAfter(o.stamp, res.body);
      }
      await runAll(rig);
      return;
    }
    case "stateOnOpened": {
      const o = run.opened;
      if (o === null) return;
      const res = await state(o.id, o.stamp);
      record("state", o.id, res);
      if (res.status === 200) o.stamp = stampAfter(o.stamp, res.body);
      return;
    }
    case "stateActive": {
      const active = (await epochOf(rig)).activeSessionId;
      if (active === null) return;
      const res = await state(active, { ...n.stamp, sessionId: active } as Stamp);
      record("state", active, res);
      return;
    }
  }
}

/** Closes a Session with a reason, as the browser would. */
export const closeWith = (rig: TestRig, id: string, reason: "user" | "error" | "expired", label: string) =>
  callRoute(rig, closeRoute, { requestId: testId(label), sessionId: id, generation: 1, reason });

/** What an answer lets through above S0: a Head line, a note, a proactive whisper. Empty when nothing. */
export function leaks(a: Answer): string[] {
  const out: string[] = [];
  const b = a.body;
  if (b === null || typeof b !== "object") return out;
  const heads = [b.deck?.head, b.result?.deck?.head].filter((h) => h !== undefined && h !== null);
  for (const h of heads) if (typeof h.text === "string" && h.text.includes(PERSONAL_FACT)) out.push(`${a.route} ${a.sessionId}: a Head with the S1 line`);
  const notes = [...(Array.isArray(b.notes) ? b.notes : []), ...(Array.isArray(b.result?.notes) ? b.result.notes : []), ...(b.proactive?.whisper ? [b.proactive.whisper] : [])];
  for (const w of notes) if (w.sens !== "S0") out.push(`${a.route} ${a.sessionId}: a ${w.sens} note`);
  return out;
}

/** The narrowing's own effects: A is not private and policyRev rose. */
export async function narrowedState(n: Narrowed): Promise<{ audience: string; policyRose: boolean }> {
  const s = await sessionOf(n.rig, n.id);
  return { audience: s.audience, policyRose: (await epochOf(n.rig)).policyRev > n.policyRevBefore };
}
