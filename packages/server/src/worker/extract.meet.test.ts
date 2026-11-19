/**
 * Brief 052 ruling 7: a short answer to the first meeting's question is still saved. The owner's first turn in a
 * Session whose open said a meet line carries that question as the packet's `pending` (review F4: the first only);
 * every other turn carries null.
 * The hint is code's fixed words: it changes neither the span rule nor authority, and adds no dependency.
 */
import { EXTRACT_INSTRUCTIONS, type Evidence, type Memory, MEET_AGAIN_LINE, MEET_LINE, MEET_PENDING_RENDERED, type Session, idParts, knownNameLine, meetPending } from "@franki/core";
import { sampleSession, testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { readCoreDocs } from "../core-docs";
import { buildHead, storeReader } from "../head-build";
import { MEET_OFFERS, type MeetOffer, closeMeet, meetRowId, meetTurnId, recordMeetSaid } from "../meet";
import { type ScriptedResult, ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { paths } from "../store/paths";
import { type CommittedTurn, commitUserTurnForTest, extractOutput, factItem, insertTurnForTest } from "../testing/extract-fixtures";
import { patchRecord, settle, testRig } from "../testing/fakes";
import { runExtractJob } from "./extract";

const UID = "owner-1";
const SES = testId("ses");
type Rig = ReturnType<typeof testRig>;

const output = (...items: unknown[]): ScriptedResult => ok(completed(JSON.stringify(extractOutput(items))));
const span = (turn: CommittedTurn, start: number, end: number, quote = turn.text.slice(start, end)) => ({ eid: turn.eid, fieldPath: "text" as const, start, end, quote });
const nameItem = (turn: CommittedTurn, name: string, spans = [span(turn, turn.text.indexOf(name), turn.text.indexOf(name) + name.length)]) => ({
  ...factItem("statement", "new", name, spans),
  predicate: "identity.name",
  args: {},
});

/** The Session the turns are committed in; a call registered unless `typedOnly`. */
async function session(rig: Rig, id: string, typedOnly = false): Promise<void> {
  const s: Session = sampleSession({ uid: UID, ...(typedOnly ? {} : { callId: "rtc_1", registeredCallIds: ["rtc_1"] }) });
  await rig.store.transaction(UID, async (tx) => tx.create(paths.session(UID, id), s));
}

/** Offer `n` said in Session `sessionId`, as the open writes it (`recordMeetSaid`). */
async function meetSaid(rig: Rig, n: MeetOffer, sessionId: string): Promise<void> {
  await rig.store.transaction(UID, async (tx) =>
    recordMeetSaid(tx, UID, { n, replaces: null }, { opsNow: rig.clock.read().opsClock.now, core: { epoch: 1, policyRev: 1 }, sessionId: sessionId as never, turnId: meetTurnId(rig.deps.hasher, sessionId), permitId: testId(`permit-${n}`) }, rig.deps.hasher),
  );
}

/** One owner turn at `seq` in the test Session, with its Turn record, as /api/turn commits it. */
async function ownerTurn(rig: Rig, label: string, text: string, seq: number): Promise<CommittedTurn> {
  const t = await commitUserTurnForTest(rig.store, UID, testId(label), text, rig.clock, rig.deps.hasher);
  await insertTurnForTest(rig.store, UID, SES, testId(label), { seq, evidenceId: t.eid, text: t.text });
  return t;
}

async function extract(rig: Rig, t: CommittedTurn, ...script: ScriptedResult[]) {
  rig.openai.script("responses.create", ...(script.length > 0 ? script : [output()]));
  const calls = rig.openai.requestsTo("responses.create").length;
  const outcome = (await settle(runExtractJob(UID, t.jobId, rig.deps), rig.clock, rig.timers)).value;
  const packet = JSON.parse((rig.openai.requestsTo("responses.create")[calls]!.body as { input: string }).input);
  return { outcome, packet };
}

const memoryOf = async (rig: Rig, t: CommittedTurn, index = 0) => (await rig.store.get<Memory>(UID, paths.memory(UID, rig.deps.hasher.id(idParts.memory(t.jobId, index)))))?.data ?? null;

describe("Brief 052 ruling 7: the first meeting's question in the ExtractV1 packet", () => {
  it("the pending is code's fixed words: kind identity, the meet lines' question, the meet row's ID", () => {
    const rowId = meetRowId(1, testRig().deps.hasher);
    expect(meetPending(rowId)).toEqual({ id: rowId, rev: 1, kind: "identity", rendered: "What should I call you?", optionIds: [] });
    expect(MEET_LINE.endsWith(MEET_PENDING_RENDERED)).toBe(true);
    expect(MEET_AGAIN_LINE.endsWith(MEET_PENDING_RENDERED)).toBe(true);
  });

  it("the guide says how to read an identity pending, under the owner's name", () => {
    const name = EXTRACT_INSTRUCTIONS.indexOf("- The owner's name:");
    const hint = EXTRACT_INSTRUCTIONS.indexOf('- When pending.kind is "identity", Franki had just asked what to call the owner');
    expect(name).toBeGreaterThan(0);
    expect(hint).toBeGreaterThan(name);
    expect(EXTRACT_INSTRUCTIONS.slice(name, hint).split("\n").filter((l) => l.startsWith("- "))).toHaveLength(1);
    // Review F4: only a reply that is just a name, or says it is the owner's own, files a name from the hint.
    expect(EXTRACT_INSTRUCTIONS).toContain(`Only a reply that is just a name ("Matt", "It's Matt.", "Matt Avila") or that says it is the owner's own name`);
    expect(EXTRACT_INSTRUCTIONS).toContain("Any other reply gives no name item from this, including one that only mentions someone else by name.");
  });

  it("the owner's first turn after MEET_LINE carries the identity pending; the second (review F4) and third carry null", async () => {
    const rig = testRig();
    await session(rig, SES);
    await meetSaid(rig, 1, SES);
    const pending = meetPending(meetRowId(1, rig.deps.hasher));
    const first = await ownerTurn(rig, "t1", "Matt.", 1);
    expect((await extract(rig, first)).packet.pending).toEqual(pending);
    // A name in answer to a later question ("Who's coming?" "Sarah.") is never read as the owner's.
    const second = await ownerTurn(rig, "t2", "Sarah.", 2);
    expect((await extract(rig, second)).packet.pending).toBeNull();
    const third = await ownerTurn(rig, "t3", "It's Matt.", 3);
    expect((await extract(rig, third)).packet.pending).toBeNull();
  });

  it("after MEET_AGAIN_LINE the pending names the second row, whose Session it was said in", async () => {
    const rig = testRig();
    await session(rig, SES);
    await meetSaid(rig, 1, testId("ses-before"));
    await meetSaid(rig, 2, SES);
    const t = await ownerTurn(rig, "t1", "Matt.", 1);
    expect((await extract(rig, t)).packet.pending).toEqual(meetPending(meetRowId(2, rig.deps.hasher)));
  });

  it("a Session with no meet line carries null: none said, one said in another Session, or the meeting closed met", async () => {
    for (const rows of ["none", "elsewhere", "met"] as const) {
      const rig = testRig();
      await session(rig, SES);
      if (rows === "elsewhere") await meetSaid(rig, 1, testId("ses-before"));
      if (rows === "met") await rig.store.transaction(UID, async (tx) => closeMeet(tx, UID, [null, null], { opsNow: rig.clock.read().opsClock.now, core: { epoch: 1, policyRev: 1 } }, rig.deps.hasher));
      const t = await ownerTurn(rig, "t1", "Matt.", 1);
      expect((await extract(rig, t)).packet.pending, rows).toBeNull();
    }
  });

  it("a typed turn with no call carries null, even when the typed Session's open recorded a meet line", async () => {
    const rig = testRig();
    await session(rig, SES, true);
    await meetSaid(rig, 1, SES);
    const t = await ownerTurn(rig, "t1", "Matt.", 1);
    expect((await extract(rig, t)).packet.pending).toBeNull();
  });

  it("a seeded turn (no Session, no Turn) and a turn with no Turn record carry null", async () => {
    const rig = testRig();
    await session(rig, SES);
    await meetSaid(rig, 1, SES);
    const seeded = await commitUserTurnForTest(rig.store, UID, testId("seed"), "Matt.", rig.clock, rig.deps.hasher);
    await patchRecord<Evidence>(rig.store, UID, paths.evidence(UID, seeded.eid), { sessionId: null, turnId: null });
    expect((await extract(rig, seeded)).packet.pending).toBeNull();
    const unrecorded = await commitUserTurnForTest(rig.store, UID, testId("t1"), "Matt.", rig.clock, rig.deps.hasher);
    expect((await extract(rig, unrecorded)).packet.pending).toBeNull();
  });

  it("Franki's own turn and a T turn at seq 1 carry null", async () => {
    for (const extra of [{ role: "assistant" as const }, { sourceClass: "T" as const }]) {
      const rig = testRig();
      await session(rig, SES);
      await meetSaid(rig, 1, SES);
      const t = await commitUserTurnForTest(rig.store, UID, testId("t1"), "Matt.", rig.clock, rig.deps.hasher);
      await insertTurnForTest(rig.store, UID, SES, testId("t1"), { seq: 1, evidenceId: t.eid, text: t.text, ...extra });
      expect((await extract(rig, t)).packet.pending).toBeNull();
    }
  });

  it("a bare \"Matt.\" with a scripted answer is saved: identity.name, class U, active, its span in the owner's turn, no dependency on the hint", async () => {
    const rig = testRig();
    await session(rig, SES);
    await meetSaid(rig, 1, SES);
    const t = await ownerTurn(rig, "t1", "Matt.", 1);
    const { outcome, packet } = await extract(rig, t, output(nameItem(t, "Matt")));
    expect(outcome).toBe("complete");
    expect(packet.pending).toEqual(meetPending(meetRowId(1, rig.deps.hasher)));
    const m = (await memoryOf(rig, t))!;
    expect(m).toMatchObject({ predicate: "identity.name", status: "active", sourceClass: "U", value: { kind: "text", text: "Matt" } });
    expect(m.rootSlices).toEqual([expect.objectContaining({ eid: t.eid, start: 0, end: 4, class: "U" })]);
    expect(m.packetEids).toEqual([t.eid]);
    expect(m.dependsOn).toEqual([`e:${t.eid}`]);
    expect(m.contextIds).toEqual([]);
    const reader = storeReader(rig.store, UID);
    const core = await readCoreDocs(reader, UID);
    const head = await buildHead(reader, UID, { epoch: core.epoch.data, rules: core.rules.data }, rig.clock.read(), 1);
    if (!head.ok) throw new Error(head.error);
    expect(head.ownerName).toBe("Matt");
    expect(head.lines.map((l) => l.text)).toContain(knownNameLine("Matt"));
  });

  describe("the hint changes neither the span rule nor authority", () => {
    it.each([
      ["a span quoting the hint's words", (t: CommittedTurn, rowId: string) => ({ eid: rowId, fieldPath: "text" as const, start: 0, end: 4, quote: "What" })],
      ["a span on the turn whose quote is the hint's name, not the owner's words", (t: CommittedTurn) => span(t, 0, 4, "Matt")],
      ["a span past the owner's turn", (t: CommittedTurn) => span(t, 0, 23, MEET_PENDING_RENDERED)],
      ["a span on the meet line's turn", (t: CommittedTurn, _rowId: string, rig: Rig) => ({ eid: meetTurnId(rig.deps.hasher, SES), fieldPath: "text" as const, start: 0, end: 4, quote: "What" })],
    ])("with pending set, a name item with %s writes nothing", async (_label, bad) => {
      const rig = testRig();
      await session(rig, SES);
      await meetSaid(rig, 1, SES);
      // The owner's words hold no name: "Sure." The model answers a name anyway.
      const t = await ownerTurn(rig, "t1", "Sure.", 1);
      const rowId = meetRowId(1, rig.deps.hasher);
      const { outcome, packet } = await extract(rig, t, output(nameItem(t, "Matt", [bad(t, rowId, rig)])));
      expect(packet.pending).toEqual(meetPending(rowId));
      expect(outcome).toBe("complete");
      expect(await memoryOf(rig, t)).toBeNull();
      expect(rig.store.countUnder(paths.collection(UID, "memories"))).toBe(0);
    });

    it("the meeting's rows are unchanged by the extract", async () => {
      const rig = testRig();
      await session(rig, SES);
      await meetSaid(rig, 1, SES);
      const before = await Promise.all(MEET_OFFERS.map((n) => rig.store.get(UID, paths.ledger(UID, meetRowId(n, rig.deps.hasher)))));
      const t = await ownerTurn(rig, "t1", "Matt.", 1);
      await extract(rig, t, output(nameItem(t, "Matt")));
      const after = await Promise.all(MEET_OFFERS.map((n) => rig.store.get(UID, paths.ledger(UID, meetRowId(n, rig.deps.hasher)))));
      expect(after).toEqual(before);
    });
  });
});
