/**
 * Fixtures for brief 043 (the review of corrections and life changes): the reviewer's sequences on `/api/turn`, with
 * a call open or typed with no call. Plain module. An earlier turn (its job done) is seeded with the Memories
 * extraction wrote from it; one turn follows with Fake_FastSlots scripted to return the given items.
 */
import { type CoreBundle, type CoreRules, type FastItem, type Job, type Memory, type Session, type Span, type Value, idParts, keyOf, rootKey, turnTextSlice } from "@franki/core";
import { sampleMemory, testId } from "@franki/core/testing";
import { ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { turnRoute } from "../routes/turn";
import { paths } from "../store/paths";
import { UID, changedIds, memoriesOf } from "./arb-corrections";
import { decisionAnswer } from "./decisions";
import { commitUserTurnForTest } from "./extract-fixtures";
import { type TestRig, callRoute, patchRecord, testRig } from "./fakes";
import { type OpenedSession, asrTurn, openTestSession, typedTurn } from "./session-fixtures";

export { UID };

type Pred = Parameters<typeof keyOf>[1];
export interface RowIn {
  subjectId: string;
  predicate: Pred;
  value: Value;
  args: Record<string, unknown>;
  status?: Memory["status"];
  line: string;
  entityIds?: string[];
}

const say = (text: string) => ({ text, entityRefs: [], timeFields: [] });

/** An earlier turn (its job done) and the Memories extraction wrote from it. Returns their IDs in order. */
export async function seed(rig: TestRig, text: string, rows: RowIn[], label = "prior"): Promise<string[]> {
  const H = rig.deps.hasher;
  const prior = await commitUserTurnForTest(rig.store, UID, testId(label), text, rig.clock, H);
  await patchRecord<Job>(rig.store, UID, paths.job(UID, prior.jobId), { status: "complete" } as Partial<Job>);
  const slice = turnTextSlice(prior.eid, prior.text, "U", H);
  const at = "2026-11-03T12:00:00.000Z";
  const ids = rows.map((_, i) => H.id(idParts.memory(prior.jobId, i)));
  await rig.store.transaction(UID, async (tx) => {
    rows.forEach((r, i) => {
      const k = keyOf(r.subjectId, r.predicate, r.args, r.value, H);
      tx.create(
        paths.memory(UID, ids[i]!),
        sampleMemory({
          uid: UID,
          logicalId: ids[i]!,
          rootSlices: [slice],
          rootKeys: [rootKey(slice, H)],
          packetEids: [prior.eid],
          dependsOn: [`e:${prior.eid}`],
          supportingIds: [{ type: "evidence", id: prior.eid, rev: 1 }],
          subjectId: r.subjectId,
          predicate: r.predicate,
          kind: r.predicate === "care" ? "care" : "fact",
          value: r.value,
          args: r.args,
          scopeId: k.scopeId,
          key: k.key,
          status: r.status ?? "active",
          validTo: r.status === "history" ? at : null,
          entityIds: r.entityIds ?? (r.subjectId === "self" ? [] : [r.subjectId]),
          sayAs: say(r.line),
          assertedAt: at,
          validFrom: at,
          validFromKey: at,
        } as Partial<Memory>),
      );
    });
  });
  return ids;
}

export interface Rig {
  rig: TestRig;
  s: OpenedSession;
  call: boolean;
}

/** A rig with a Session open, a call registered on it or not, and a reply from the brain. */
export async function setup(o: { call?: boolean; reply?: string; decision?: Parameters<typeof decisionAnswer>[0] } = {}): Promise<Rig> {
  const rig = testRig();
  const s = await openTestSession(rig);
  const call = o.call ?? true;
  if (call) await patchRecord<Session>(rig.store, UID, paths.session(UID, s.sessionId), { status: "active", registeredCallIds: ["rtc_a"], callId: "rtc_a" });
  rig.openai.always("decisions.create", ok(decisionAnswer(o.decision ?? { transition: 0.9 })));
  rig.openai.always("responses.create", ok(completed(o.reply ?? "I'm so sorry.")));
  return { rig, s, call };
}

/** The turn's whole text less its final stop, as one span. */
export const whole = (eid: string, text: string): Span => {
  const end = /[.!?]$/.test(text) ? text.length - 1 : text.length;
  return { eid, fieldPath: "text", start: 0, end, quote: text.slice(0, end) };
};
/** The first occurrence of `word` in `text`, as a span. */
export const at = (eid: string, text: string, word: string, from = 0): Span => {
  const i = text.indexOf(word, from);
  if (i < 0) throw new Error(`"${word}" is not in "${text}"`);
  return { eid, fieldPath: "text", start: i, end: i + word.length, quote: word };
};
export const SELF = { entityId: null, mention: null, isSelf: true } as const;
export const byId = (entityId: string) => ({ entityId, mention: null, isSelf: false });
export const byMention = (mention: Span) => ({ entityId: null, mention, isSelf: false });

type TItem = Partial<Extract<FastItem, { kind: "transition" }>>;
/** A transition item over the whole turn, death by default. */
export function transition(text: string, o: TItem | ((eid: string) => TItem)) {
  return (eid: string): FastItem => ({ kind: "transition", transition: "death", subject: SELF, counterpart: null, whenSpoken: null, polarity: "affirmed", act: "direct", span: whole(eid, text), ...(typeof o === "function" ? o(eid) : o) }) as FastItem;
}
type CItem = Partial<Extract<FastItem, { kind: "correction" }>>;
/** A correction item over the whole turn. */
export function correction(text: string, o: CItem | ((eid: string) => CItem)) {
  return (eid: string): FastItem => ({ kind: "correction", targetIds: [], predicate: "identity.name", replacementValue: null, args: null, act: "direct", span: whole(eid, text), ...(typeof o === "function" ? o(eid) : o) }) as FastItem;
}

export interface Posted {
  res: Awaited<ReturnType<typeof callRoute>>;
  before: Map<string, Memory>;
  after: Map<string, Memory>;
  changed: string[];
  rules: CoreRules;
  bundle: CoreBundle;
  notes: string[];
  entries: CoreRules["handled"][number]["entries"];
  replies: number;
}

/** One turn, typed by default, with FastSlots returning `items` and `need: none`. */
export async function post(a: Rig, text: string, items: ((eid: string) => FastItem)[], o: { asr?: boolean; seq?: number; stamp?: OpenedSession["stamp"] } = {}): Promise<Posted> {
  a.rig.fastSlots.script((input) => ({ kind: "valid", out: { items: items.map((f) => f(input.turn.eid)), need: "none" }, ms: 100 }));
  const before = await memoriesOf(a.rig.store);
  const repliesBefore = a.rig.openai.requests.filter((c) => c.endpoint === "responses.create").length;
  const seq = o.seq ?? 1;
  const stamp = o.stamp ?? a.s.stamp;
  const body = o.asr === true ? asrTurn(stamp, seq, text, [{ itemId: `item_${seq}`, commitSeq: seq }]) : typedTurn(stamp, seq, text);
  const res = await callRoute(a.rig, turnRoute, body);
  if (res.status !== 200) throw new Error(`turn failed: ${res.status} ${JSON.stringify(res.body)}`);
  const after = await memoriesOf(a.rig.store);
  const rules = (await a.rig.store.get<CoreRules>(UID, paths.core(UID, "rules")))!.data;
  const bundle = (await a.rig.store.get<CoreBundle>(UID, paths.core(UID, "bundle")))!.data;
  const notes: string[] = (res.body?.notes ?? []).map((n: { text: string }) => n.text);
  const replies = a.rig.openai.requests.filter((c) => c.endpoint === "responses.create").length - repliesBefore;
  return { res, before, after, changed: changedIds(before, after), rules, bundle, notes, entries: rules.handled.flatMap((h) => h.entries), replies };
}

export const codeOf = (m: Memory | undefined) => (m === undefined ? null : m.value.kind === "enum" ? m.value.code : m.value.kind === "text" ? m.value.text : m.value.kind);
/** Each row about `subject` (as subject, care subject or other), as [predicate, code, status]. */
export const rowsAbout = (m: Map<string, Memory>, subject: string) =>
  [...m.values()]
    .filter((x) => x.subjectId === subject || x.args.careSubjectRef === subject || x.args.otherRef === subject)
    .map((x) => [x.predicate, codeOf(x), x.status])
    .sort();
