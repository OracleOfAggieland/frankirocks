// Brief 043: the review of corrections and life changes. Each block runs the reviewer's own sequence on `/api/turn`.
import { type CoreBundle, type ID, ROUTE_NOTE_TEXT, mentionEid } from "@franki/core";
import { recordFastO } from "../admission/seam";
import { paths } from "../store/paths";
import { testId } from "@franki/core/testing";
import { ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { extractOutput, factItem } from "../testing/extract-fixtures";
import { settle } from "../testing/fakes";
import { turnEvidenceId } from "../turns";
import { runExtractJob } from "../worker/extract";
import { extractJobId } from "../worker/extract-jobs";
import { describe, expect, it } from "vitest";
import { UID as OWNER, memoriesOf, seedPrior } from "../testing/arb-corrections";
import { SELF, at, byId, byMention, correction, rowsAbout, seed, setup, post, transition } from "../testing/review-043";

describe("finding 1: the owner's words choose who died, never the model's subject", () => {
  const T = "My friend's mom passed away last night.";
  async function momSeeded() {
    const a = await setup();
    const mom = mentionEid("person", "mom", a.rig.deps.hasher);
    await seed(a.rig, "My mom lives in Leeds.", [
      { subjectId: "self", predicate: "person.relation", value: { kind: "enum", code: "parent" }, args: { otherRef: mom, label: "mom", employerRef: null }, line: "The owner's mom.", entityIds: [mom] },
    ]);
    return { a, mom };
  }

  it("(a) subject.entityId = the owner's mom: nothing about her changes, and the change is deferred", async () => {
    const { a, mom } = await momSeeded();
    const r = await post(a, T, [transition(T, { subject: byId(mom), whenSpoken: "last night" })]);
    expect(rowsAbout(r.after, mom)).toEqual(rowsAbout(r.before, mom));
    expect(r.changed).toEqual([]);
    expect(r.entries.map((e) => [e.route, e.outcome, e.refs.length])).toEqual([["transition", "deferred", 0]]);
  });

  it("(b) a mention span over just \"mom\" inside \"My friend's mom\": nothing about her changes", async () => {
    const { a, mom } = await momSeeded();
    const r = await post(a, T, [transition(T, (eid) => ({ subject: byMention(at(eid, T, "mom")), whenSpoken: "last night" }))]);
    expect(rowsAbout(r.after, mom)).toEqual(rowsAbout(r.before, mom));
    expect(r.changed).toEqual([]);
    expect(r.entries.map((e) => [e.route, e.outcome])).toEqual([["transition", "deferred"]]);
  });

  it("the owner's own mom, said so, still changes on the turn", async () => {
    const { a, mom } = await momSeeded();
    const t = "My mom passed away last night.";
    const r = await post(a, t, [transition(t, (eid) => ({ subject: byMention(at(eid, t, "My mom")), whenSpoken: "last night" }))]);
    expect(rowsAbout(r.after, mom)).toContainEqual(["person.life", "deceased", "active"]);
  });
});

describe("finding 2: a typed turn with no call always gets exactly one line from Franki", () => {
  const DEATH = "My dad passed away last night.";
  async function dadSeeded() {
    const a = await setup({ call: false });
    const dad = mentionEid("person", "dad", a.rig.deps.hasher);
    await seed(a.rig, "My dad has been really sick.", [
      { subjectId: dad, predicate: "person.life", value: { kind: "enum", code: "ill" }, args: { detail: null }, line: "The owner's dad is ill." },
    ]);
    return { a, dad };
  }

  it("a death with a valid item: written, and the reply is the one line", async () => {
    const { a, dad } = await dadSeeded();
    const r = await post(a, DEATH, [transition(DEATH, (eid) => ({ subject: byMention(at(eid, DEATH, "My dad")), whenSpoken: "last night" }))]);
    expect(rowsAbout(r.after, dad)).toContainEqual(["person.life", "deceased", "active"]);
    expect(r.notes).toEqual(["I'm so sorry."]);
  });

  it("\"I might leave my job.\" (care only): one line", async () => {
    const a = await setup({ call: false });
    const t = "I might leave my job.";
    const r = await post(a, t, [transition(t, { transition: "jobChangeOwn", polarity: "uncertain", act: "uncertain" })]);
    expect(r.notes).toHaveLength(1);
  });

  it("the same death with no items: one line", async () => {
    const { a } = await dadSeeded();
    const r = await post(a, DEATH, []);
    expect(r.notes).toEqual(["I'm so sorry."]);
  });

  it("a deferred correction: one line, the ordinary reply", async () => {
    const a = await setup({ call: false, reply: "All right.", decision: { correct: 0.9 } });
    const seeded = await seedPrior(a.rig, "Maya");
    // The new name isn't in the span, so R1 defers ("value").
    const t = "No, that's wrong about Maya, her name is different.";
    const r = await post(a, t, [correction(t, { targetIds: [seeded.relId], replacementValue: { kind: "text", text: "Mara" } })]);
    expect(r.changed).toEqual([]);
    expect(r.entries.map((e) => [e.route, e.outcome])).toEqual([["correct", "deferred"]]);
    expect(r.notes).toEqual(["All right."]);
  });
});

describe("finding 6: isSelf plus any \"I\" never records the owner ill", () => {
  it("\"I just found out my brother was diagnosed with cancer.\" with transition illness, subject isSelf", async () => {
    const a = await setup();
    const t = "I just found out my brother was diagnosed with cancer.";
    const r = await post(a, t, [transition(t, { transition: "illness", subject: SELF })]);
    expect(rowsAbout(r.after, "self").filter(([p]) => p === "person.life" || p === "care")).toEqual([]);
    expect(r.changed).toEqual([]);
  });
});

describe("finding 4: a rename goes the way the owner said", () => {
  it("stored Mara; \"No, that's wrong, her name is Mara, not Maya.\" with the model's rename to Maya: nothing changes", async () => {
    const a = await setup({ reply: "All right.", decision: { correct: 0.9 } });
    const seeded = await seedPrior(a.rig, "Mara");
    const t = "No, that's wrong, her name is Mara, not Maya.";
    const r = await post(a, t, [correction(t, { targetIds: [seeded.relId], replacementValue: { kind: "text", text: "Maya" } })]);
    expect(r.changed).toEqual([]);
    expect(r.notes).not.toContain(ROUTE_NOTE_TEXT.renamed);
  });
  it("stored Maya; the same words with the rename to Mara still rename", async () => {
    const a = await setup({ reply: "All right.", decision: { correct: 0.9 } });
    const seeded = await seedPrior(a.rig, "Maya");
    const t = "No, that's wrong, her name is Mara, not Maya.";
    const r = await post(a, t, [correction(t, { targetIds: [seeded.relId], replacementValue: { kind: "text", text: "Mara" } })]);
    expect(r.notes).toContain(ROUTE_NOTE_TEXT.renamed);
  });
});

describe("finding 5: a null replacement retracts only on the owner's negation", () => {
  it("\"That's wrong, I meant my sister Maya is coming Saturday.\" with a null person.relation correction: the sister stays", async () => {
    const a = await setup({ reply: "All right.", decision: { correct: 0.9 } });
    const seeded = await seedPrior(a.rig, "Maya");
    const t = "That's wrong, I meant my sister Maya is coming Saturday.";
    const r = await post(a, t, [correction(t, { targetIds: [seeded.relId], predicate: "person.relation", replacementValue: null })]);
    expect(r.after.get(seeded.relId)!.status).toBe("active");
    expect(r.notes).not.toContain(ROUTE_NOTE_TEXT.retracted);
  });
});

describe("finding 8: a transition that writes nothing is deferred with no refs, and extraction can still end the role", () => {
  it("one role at Acme; \"I left my job yesterday and I start at Brill on Monday.\" with counterpart Brill", async () => {
    const a = await setup();
    const H = a.rig.deps.hasher;
    const [role] = await seed(a.rig, "I work at Acme as an engineer.", [
      { subjectId: "self", predicate: "employment.role", value: { kind: "text", text: "engineer" }, args: { employerRef: mentionEid("organization", "acme", H), managerRef: null }, line: "The owner's job is engineer at Acme." },
    ]);
    // The stored line shares "job" with the turn, so extraction's `open` (relevantOpen) can offer the role.
    const t = "I left my job yesterday and I start at Brill on Monday.";
    const r = await post(a, t, [transition(t, (eid) => ({ transition: "jobChangeOwn", counterpart: byMention(at(eid, t, "Brill")), whenSpoken: "yesterday" }))]);
    expect(r.after.get(role!)!.status).toBe("active");
    expect(r.entries.map((e) => [e.route, e.outcome, e.refs.length])).toEqual([["transition", "deferred", 0]]);

    // The same turn's extraction ends the Acme role.
    const eid = turnEvidenceId(testId("turn-1") as ID, H);
    const span = (w: string) => ({ eid, fieldPath: "text" as const, start: t.indexOf(w), end: t.indexOf(w) + w.length, quote: w });
    const item = {
      ...factItem("transition", "new", "engineer", [span("I left my job yesterday")]),
      predicate: "employment.role",
      value: { kind: "text", text: "engineer" },
      args: { employerRef: "m1", managerRef: null },
      mentions: [{ localId: "m1", type: "organization", observedName: "Brill", span: span("Brill"), existingId: null }],
      changes: [{ verb: "transition", targetMid: role }],
    };
    a.rig.openai.script("responses.create", ok(completed(JSON.stringify(extractOutput([item])))));
    await settle(runExtractJob(OWNER, extractJobId(eid, H), a.rig.deps), a.rig.clock, a.rig.timers);
    expect((await memoriesOf(a.rig.store)).get(role!)!.status).toBe("history");
  });
});

describe("finding 9: on the fast path a death leaves no stale Head for the rest of the session", () => {
  it("the next turn's Head no longer has the dad ill, nor his care, in People", async () => {
    let dad = "";
    const a = await setup({
      before: async (rig) => {
        dad = mentionEid("person", "dad", rig.deps.hasher);
        await seed(rig, "My dad has been really sick.", [
          { subjectId: dad, predicate: "person.life", value: { kind: "enum", code: "ill" }, args: { detail: null }, line: "The owner's dad is ill." },
          { subjectId: "self", predicate: "care", value: { kind: "enum", code: "open" }, args: { careSubjectRef: dad, topic: "sick" }, line: "The owner is caring for their dad.", entityIds: [dad] },
        ]);
      },
    });
    const before = (await a.rig.store.get<CoreBundle>(OWNER, paths.core(OWNER, "bundle")))!.data;
    expect(before.head?.text ?? "").toContain("dad is ill");
    const stamp = { ...a.s.stamp, turnId: testId("turn-1") };
    await a.rig.store.transaction(OWNER, (tx) => recordFastO(tx, { uid: OWNER, stamp, responseId: "resp_s", opsNow: a.rig.clock.read().opsClock.now, core: { epoch: 1, policyRev: 1 }, audience: "private" }, a.rig.deps));
    const D = "My dad passed away last night.";
    const r1 = await post(a, D, [transition(D, (eid) => ({ subject: byMention(at(eid, D, "My dad")), whenSpoken: "last night" }))], { asr: true });
    expect(r1.bundle.bundleRev).toBe(before.bundleRev);
    const T2 = "Thanks for listening.";
    const r2 = await post(a, T2, [], { seq: 2, stamp: r1.res.body.stamp });
    expect(r2.bundle.head?.text ?? "").not.toContain("dad is ill");
    expect(r2.bundle.head?.text ?? "").not.toContain("caring for their dad");
  });
});
