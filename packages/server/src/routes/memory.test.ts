import { type CoreRules, type Ledger, MemoryResponse, tsFromMs, validate } from "@franki/core";
import { commonFields, testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { paths } from "../store/paths";
import { commitUserTurnForTest, insertMemoryForTest } from "../testing/extract-fixtures";
import { type TestRig, callRoute, testRig } from "../testing/fakes";
import { openTestSession } from "../testing/session-fixtures";
import { memoryRoute } from "./memory";

const UID = "owner-1";

async function get(rig: TestRig, query: Record<string, string>) {
  const url = `http://localhost:3000/api/memory?${new URLSearchParams(query).toString()}`;
  const res = await callRoute(rig, memoryRoute, undefined, { method: "GET", url, origin: null });
  if (res.status === 200) expect(validate(MemoryResponse, res.body).ok).toBe(true);
  return res;
}

/** Three told lines, one wrong, one blocked, one guess, one private (S2), one from an older epoch. */
async function seeded(): Promise<{ rig: TestRig; ids: Record<string, string> }> {
  const rig = testRig();
  const turn = await commitUserTurnForTest(rig.store, UID, testId("t1"), "Pip loves the park on Sundays", rig.clock, rig.deps.hasher);
  const at = (d: number) => tsFromMs(rig.clock.read().worldClock.now - d * 86_400_000);
  const ids: Record<string, string> = {};
  const add = async (label: string, o: Parameters<typeof insertMemoryForTest>[4]) => {
    ids[label] = await insertMemoryForTest(rig.store, UID, turn, rig.deps.hasher, { validFrom: at(30), assertedAt: at(1), key: testId(`k-${label}`), ...o }, label);
  };
  await add("dog", { value: { kind: "text", text: "My dog is called Pip" }, assertedAt: at(3) });
  await add("job", { value: { kind: "text", text: "I work at the bakery" }, assertedAt: at(2) });
  await add("biscuit", { value: { kind: "text", text: "Biscuit has surgery Thursday" }, assertedAt: at(1) });
  await add("wrong", { value: { kind: "text", text: "I live in Denver" }, status: "wrong" });
  await add("blocked", { value: { kind: "text", text: "My brother is in trouble" }, status: "blocked" });
  await add("guess", { value: { kind: "text", text: "You may be job hunting" }, sourceClass: "M", sens: "S1" });
  await add("private", { value: { kind: "text", text: "A private thing" }, sens: "S2" });
  await add("old", { value: { kind: "text", text: "An old forgotten line" }, epoch: 0 });
  return { rig, ids };
}

describe("GET /api/memory", () => {
  it("answers every view with zeros and empty lists before anything is stored, and writes nothing", async () => {
    const rig = testRig();
    for (const view of ["overview", "lab", "strip", "receipt"]) {
      const res = await get(rig, { view });
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([]);
    }
    const lab = (await get(rig, { view: "lab" })).body.lab;
    expect([lab.readEmails, lab.privateGuesses, lab.guessLinesSpoken, lab.delivered]).toEqual([0, 0, 0, 0]);
    expect((await get(rig, { view: "overview" })).body.snapshot.cards).toEqual([]);
    expect(await rig.store.get(UID, paths.core(UID, "epoch"))).toBeNull();
  });

  it("overview is snapshot(): told lines only, two recent told lines, guesses and private things as counts", async () => {
    const { rig, ids } = await seeded();
    const res = await get(rig, { view: "overview" });
    expect(res.status).toBe(200);
    const s = res.body.snapshot;
    expect(s.cards.map((c: { id: string }) => c.id).sort()).toEqual([ids.dog, ids.job, ids.biscuit].sort());
    expect(s.overview.recentTold.map((w: { text: string }) => w.text)).toEqual(["fact: Biscuit has surgery Thursday", "fact: I work at the bakery"]);
    expect(s.overview.guesses).toBe(1);
    expect(s.overview.heldPrivate).toBe(1);
    const text = JSON.stringify(res.body);
    for (const never of ["Denver", "brother", "job hunting", "A private thing", "forgotten line"]) expect(text).not.toContain(never);
  });

  it("overview counts the owner's hard rules from core/rules, as a count only (brief 030 P1-11)", async () => {
    const { rig } = await seeded();
    expect((await get(rig, { view: "overview" })).body.hardRules).toBe(0);
    await rig.store.transaction(UID, async (tx) => {
      const rules = (await tx.get<CoreRules>(paths.core(UID, "rules")))!;
      const rule = (code: string, state: "active" | "pending") => ({ id: testId(`rule-${code}`), subjectId: "self", code, state, anonymous: false, proof: null, proofRev: null, rootKeys: [], dependsOn: [] });
      tx.update(rules.path, { ...rules.data, allergies: [rule("shellfish", "active"), rule("peanut", "pending")] });
    });
    const res = await get(rig, { view: "overview" });
    expect(res.body.hardRules).toBe(2);
    expect(JSON.stringify(res.body)).not.toContain("shellfish");
  });

  it("item and why return only a shown row; why quotes its root", async () => {
    const { rig, ids } = await seeded();
    expect((await get(rig, { view: "item", id: ids.dog! })).body.items).toHaveLength(1);
    for (const hidden of ["wrong", "blocked", "guess", "private", "old"]) {
      expect((await get(rig, { view: "item", id: ids[hidden]! })).body.items).toEqual([]);
      expect((await get(rig, { view: "why", id: ids[hidden]! })).body.items).toEqual([]);
    }
    const why = (await get(rig, { view: "why", id: ids.biscuit! })).body.items;
    expect(why.map((i: { kind: string }) => i.kind)).toEqual(["memory", "evidence"]);
    expect(why[1].body).toBe("Pip loves the park on Sundays");
    expect((await get(rig, { view: "item" })).status).toBe(400);
  });

  it("the Lab counts real rows: the guess is counted, nothing is estimated", async () => {
    const { rig } = await seeded();
    const lab = (await get(rig, { view: "lab" })).body.lab;
    expect(lab.privateGuesses).toBe(1);
    expect(lab.readEmails).toBe(0);
    expect(lab.limits).toContain("uncounted:steered");
  });

  it("receipt reads the newest forget receipt, counts only", async () => {
    const { rig } = await seeded();
    const now = tsFromMs(rig.clock.read().opsClock.now);
    const entry: Ledger = {
      ...commonFields({ uid: UID, createdAt: now, updatedAt: now }),
      kind: "forgetReceipt",
      state: "complete",
      at: now,
      retainUntil: null,
      payload: { opId: testId("op"), blockedAt: now, cleanupCompleteAt: null, retainedRuleIds: [testId("rule")], scopePending: false, touched: [{ collection: "memories", count: 1 }], withdrawnCount: 0 },
    } as Ledger;
    await rig.store.transaction(UID, async (tx) => tx.create(paths.ledger(UID, testId("rcpt")), entry));
    const items = (await get(rig, { view: "receipt" })).body.items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "receipt", status: "blocked" });
    expect(JSON.parse(items[0].body)).toEqual({ retainedRules: 1, scopePending: false, withdrawnCount: 0, touched: [{ collection: "memories", count: 1 }] });
    expect((await get(rig, { view: "receipt", id: testId("nope") })).status).toBe(404);
  });

  it("in company only S0 rows show; S1 rows are held and counted", async () => {
    const { rig, ids } = await seeded();
    const turn = await commitUserTurnForTest(rig.store, UID, testId("t2"), "Pip loves the park on Sundays", rig.clock, rig.deps.hasher);
    const s1 = await insertMemoryForTest(rig.store, UID, turn, rig.deps.hasher, { sens: "S1", key: testId("k-s1"), validFrom: tsFromMs(0) }, "s1");
    const before = (await get(rig, { view: "overview" })).body.snapshot;
    expect(before.cards.map((c: { id: string }) => c.id)).toContain(s1);
    const s = await openTestSession(rig);
    const path = paths.session(UID, s.sessionId);
    await rig.store.transaction(UID, async (tx) => {
      const doc = await tx.get<Record<string, unknown>>(path);
      tx.update(path, { ...doc!.data, audience: "company" });
    });
    const after = (await get(rig, { view: "overview" })).body.snapshot;
    expect(after.cards.map((c: { id: string }) => c.id)).not.toContain(s1);
    expect(after.cards.map((c: { id: string }) => c.id)).toContain(ids.dog);
    expect(after.overview.heldPrivate).toBe(before.overview.heldPrivate + 1);
    expect((await get(rig, { view: "item", id: s1 })).body.items).toEqual([]);
  });

  it("refuses unknown parameters and an unknown cursor", async () => {
    const { rig } = await seeded();
    expect((await get(rig, { view: "overview", extra: "1" })).status).toBe(400);
    expect((await get(rig, { view: "overview", cursor: testId("nope") })).status).toBe(404);
    expect((await get(rig, { view: "nope" })).status).toBe(400);
  });
});
