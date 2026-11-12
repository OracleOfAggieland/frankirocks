// Brief 039 on the server path: suggest(food) reads the owner's diets and dislikes (and a named person's), asks
// about an ended diet first, and the owner's answer, read by code, extends it or closes it.
import { type CoreState, type Memory, buildSlice, rootKey, tsFromMs } from "@franki/core";
import { HERO_ZONE, instantAt, sampleEvidence, sampleMemory, testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { ensureCoreDocs } from "../core-docs";
import { toolRoute } from "../routes/tool";
import { heroCardTitle } from "../routes/tool-food";
import { turnRoute } from "../routes/turn";
import { paths } from "../store/paths";
import { callRoute, testRig } from "../testing/fakes";
import { asrTurn, openTestSession } from "../testing/session-fixtures";
import { namedPeople } from "./prefs-read";

const UID = "owner-1";
const SUGGEST = { domain: "food", query: "quick dinner", attendeeIds: [], when: null, contextId: null };
const SISTER = testId("sister");
const SEP_30_END = instantAt("2026-10-01", 0, HERO_ZONE); // the first instant after September, in Chicago
const MEAT = ["chicken_thigh", "chicken_breast", "ground_beef", "pork_chop", "salmon_fillet", "cod_fillet", "shrimp", "mixed_seafood", "fish_sauce"];

type Rig = ReturnType<typeof testRig>;

/** A Memory resting on its own Evidence, whose text is `said`. */
async function remember(rig: Rig, name: string, said: string, m: Partial<Memory>) {
  const eid = testId(`ev-${name}`);
  const id = testId(`m-${name}`);
  const slice = buildSlice({ eid, fieldPath: "text", fieldText: said, start: 0, end: said.length, class: "U", sens: "S0" }, rig.deps.hasher);
  await rig.store.transaction(UID, async (tx) => {
    tx.create(paths.evidence(UID, eid), sampleEvidence({ logicalId: eid, text: { kind: "inline", text: said }, fieldSlices: [slice], rootKeys: [rootKey(slice, rig.deps.hasher)] }));
    tx.create(
      paths.memory(UID, id),
      sampleMemory({
        logicalId: id,
        kind: "preference",
        predicate: "preference.food",
        rootSlices: [slice],
        rootKeys: [rootKey(slice, rig.deps.hasher)],
        packetEids: [eid],
        dependsOn: [`e:${eid}`],
        supportingIds: [{ type: "evidence", id: eid, rev: 1 }],
        validFrom: tsFromMs(instantAt("2026-09-01", 9 * 60, HERO_ZONE)),
        assertedAt: tsFromMs(instantAt("2026-09-01", 9 * 60, HERO_ZONE)),
        ...m,
      }),
    );
  });
  return id;
}

const vegetarian = (validTo: number | null, subjectId = "self"): Partial<Memory> => ({
  subjectId,
  value: { kind: "enum", code: "vegetarian" },
  args: { dimension: "diet", targetRef: null },
  validTo: validTo === null ? null : tsFromMs(validTo),
  when: { kind: "spoken", spoken: "this month" },
});

async function setup(store: (rig: Rig) => Promise<void>) {
  const rig = testRig();
  rig.clock.setWorld(instantAt("2026-10-26", 18 * 60, HERO_ZONE));
  await ensureCoreDocs(UID, rig.deps);
  await rig.store.transaction(UID, async (tx) => {
    const state = await tx.get<CoreState>(paths.core(UID, "state"));
    tx.update(paths.core(UID, "state"), { ...state!.data, currentZone: HERO_ZONE });
  });
  await store(rig);
  const s = await openTestSession(rig);
  // Opening a session reads the zone from the clock; the owner is in Chicago.
  await rig.store.transaction(UID, async (tx) => {
    const state = await tx.get<CoreState>(paths.core(UID, "state"));
    tx.update(paths.core(UID, "state"), { ...state!.data, currentZone: HERO_ZONE });
  });
  let seq = 0;
  let n = 0;
  const say = async (text: string) => {
    seq += 1;
    const res = await callRoute(rig, turnRoute, asrTurn(s.stamp, seq, text, [{ itemId: `item_${seq}`, commitSeq: seq }]));
    if (res.status !== 200) throw new Error(JSON.stringify(res.body));
    return { ...s.stamp, turnId: testId(`turn-${seq}`) };
  };
  const tool = async (stamp: unknown, t: Record<string, unknown>) => (await callRoute(rig, toolRoute, { requestId: testId(`tool${++n}`), stamp, callId: "call_1", tool: t })).body;
  const suggest = async (text: string) => tool(await say(text), { name: "suggest", args: SUGGEST });
  const mem = async (id: string) => (await rig.store.get<Memory>(UID, paths.memory(UID, id)))!.data;
  return { rig, say, tool, suggest, mem };
}

const offered = (body: { result: { cards: { kind: string; lines: string[] }[] } }) => body.result.cards.filter((c) => c.kind === "food").flatMap((c) => c.lines);
const holdsAny = (lines: string[], ids: string[]) => lines.some((l) => ids.some((id) => l.toLowerCase().includes(id.replace(/_/g, " ").replace(/s$/, ""))));

describe("suggest reads the owner's diet (Friend Test 2)", () => {
  it("a vegetarian is offered no chicken quesadillas, and no question while the diet holds", async () => {
    const t = await setup(async (rig) => void (await remember(rig, "veg", "I'm vegetarian this month", vegetarian(null))));
    const body = await t.suggest("What should I make for dinner?");
    expect(body.result.question).toBeNull();
    const lines = offered(body);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l) => /chicken|beef|pork|salmon|cod|shrimp|seafood/i.test(l))).toBe(false);
  });
});

describe("a diet past its end asks first and stays neutral (brief 039, change 3)", () => {
  it("the question comes first, and the dinners still keep the diet", async () => {
    const t = await setup(async (rig) => void (await remember(rig, "veg", "I'm vegetarian this month", vegetarian(SEP_30_END))));
    const body = await t.suggest("What's for dinner tonight?");
    expect(body.result.question).toBe("Still vegetarian, or was September it?");
    expect(body.result.pendingId).not.toBeNull();
    expect(body.result.cards[0]).toMatchObject({ kind: "ask", lines: ["Still vegetarian, or was September it?"] });
    expect(offered(body).some((l) => /chicken|beef|pork|salmon|cod|shrimp|seafood/i.test(l))).toBe(false);
  });

  it("'Yes, still' extends the diet with no end, and the question is gone", async () => {
    let id = "";
    const t = await setup(async (rig) => void (id = await remember(rig, "veg", "I'm vegetarian this month", vegetarian(SEP_30_END))));
    const asked = await t.suggest("What's for dinner tonight?");
    const res = await t.tool(await t.say("Yes, still"), { name: "answer", args: { pendingId: asked.result.pendingId, choiceId: testId("yes") } });
    expect(res.result.state).toBe("applied");
    expect((await t.mem(id)).validTo).toBeNull();
    expect((await t.mem(id)).status).toBe("active");
    const again = await t.suggest("And tomorrow?");
    expect(again.result.question).toBeNull();
    expect(offered(again).some((l) => /chicken/i.test(l))).toBe(false);
  });

  it("'No, that was September' closes it as history, and meat comes back", async () => {
    let id = "";
    const t = await setup(async (rig) => void (id = await remember(rig, "veg", "I'm vegetarian this month", vegetarian(SEP_30_END))));
    const asked = await t.suggest("What's for dinner tonight?");
    const res = await t.tool(await t.say("No, that was September"), { name: "answer", args: { pendingId: asked.result.pendingId, choiceId: testId("no") } });
    expect(res.result.state).toBe("applied");
    expect((await t.mem(id)).status).toBe("history");
    const again = await t.suggest("What should I make?");
    expect(again.result.question).toBeNull();
    expect(offered(again).some((l) => /chicken|beef|pork|salmon|cod|shrimp/i.test(l))).toBe(true);
  });

  it("a bare 'yes' is not an answer: clarify, and nothing changes", async () => {
    let id = "";
    const t = await setup(async (rig) => void (id = await remember(rig, "veg", "I'm vegetarian this month", vegetarian(SEP_30_END))));
    const asked = await t.suggest("What's for dinner tonight?");
    const before = await t.mem(id);
    const res = await t.tool(await t.say("yes"), { name: "answer", args: { pendingId: asked.result.pendingId, choiceId: testId("yes") } });
    expect(res.result.state).toBe("clarify");
    expect(await t.mem(id)).toEqual(before);
  });

  it("the model's choice alone never answers: 'sounds good' is clarify", async () => {
    let id = "";
    const t = await setup(async (rig) => void (id = await remember(rig, "veg", "I'm vegetarian this month", vegetarian(SEP_30_END))));
    const asked = await t.suggest("What's for dinner tonight?");
    const res = await t.tool(await t.say("sounds good"), { name: "answer", args: { pendingId: asked.result.pendingId, choiceId: testId("still") } });
    expect(res.result.state).toBe("clarify");
    expect((await t.mem(id)).validTo).not.toBeNull();
  });
});

describe("dislikes (Friend Test 11)", () => {
  it("'I hate mushrooms' leaves the mushroom omelet off", async () => {
    const t = await setup(async (rig) => void (await remember(rig, "mush", "I hate mushrooms", { value: { kind: "enum", code: "dislike" }, args: { dimension: "ingredient", targetRef: null } })));
    const lines = offered(await t.suggest("What should I make tonight?"));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l) => /mushroom/i.test(l))).toBe(false);
  });
});

describe("whose diet: another person's applies only when the owner's words name them (ruling 5)", () => {
  const relation = (rig: Rig) =>
    remember(rig, "rel", "my sister", {
      kind: "fact",
      predicate: "person.relation",
      value: { kind: "enum", code: "sister" },
      args: { otherRef: SISTER, label: "sister", employerRef: null },
    });

  it("not named: the sister's diet doesn't apply", async () => {
    const t = await setup(async (rig) => {
      await relation(rig);
      await remember(rig, "sisveg", "my sister is vegetarian", vegetarian(null, SISTER));
    });
    expect(holdsAny(offered(await t.suggest("What should I make for dinner?")), MEAT)).toBe(true);
  });

  it("named in this turn: it applies, and the card never names her", async () => {
    const t = await setup(async (rig) => {
      await relation(rig);
      await remember(rig, "sisveg", "my sister is vegetarian", vegetarian(null, SISTER));
    });
    const body = await t.suggest("My sister is coming for dinner, what should I make?");
    expect(holdsAny(offered(body), MEAT)).toBe(false);
    expect(JSON.stringify(body.result.cards)).not.toMatch(/sister|vegetarian/i);
  });

  it("namedPeople matches whole words of a relation's label", async () => {
    const m = sampleMemory({ kind: "fact", predicate: "person.relation", value: { kind: "enum", code: "sister" }, args: { otherRef: SISTER, label: "sister", employerRef: null } });
    expect([...namedPeople([{ id: "r", memory: m }], "dinner with my sister")]).toEqual([SISTER]);
    expect([...namedPeople([{ id: "r", memory: m }], "dinner with my sisters-in-law's dog")]).toEqual([]);
  });
});

describe("the hero's card says how many dinners it holds", () => {
  it("three, two or one", () => {
    expect(heroCardTitle(3)).toBe("Three quick dinners for those nights");
    expect(heroCardTitle(2)).toBe("Two quick dinners for those nights");
    expect(heroCardTitle(1)).toBe("One quick dinner for those nights");
  });
});
