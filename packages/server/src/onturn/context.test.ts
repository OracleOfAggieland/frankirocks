// Brief 025 task C2: the correct route's targets, the entities' names, and one mention name for "my dad" and "Dad".
import { type ExtractItem, type HeadMemory, type Memory, mentionEid, mentionName, resolveMention } from "@franki/core";
import { sampleMemory, testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { testRig } from "../testing/fakes";
import { pickOpen } from "../worker/extract";
import { correctionTargets, packetTargets, subjectIndex } from "./context";

const H = testRig().deps.hasher;
const say = (text: string) => ({ text, entityRefs: [], timeFields: [] });
const MAYA = mentionEid("person", "maya", H);
const row = (n: string, o: Partial<Memory>): HeadMemory => ({ id: testId(n), memory: sampleMemory({ key: testId(`k${n}`), updatedAt: `2026-11-03T12:00:0${n.length % 10}.000Z`, ...o }) });

const MEMORIES: HeadMemory[] = [
  row("rel", { subjectId: "self", predicate: "person.relation", value: { kind: "enum", code: "sister" }, args: { otherRef: MAYA, label: "sister", employerRef: null }, entityIds: [MAYA], sayAs: say("Maya is the owner's sister.") }),
  row("name", { subjectId: "self", predicate: "identity.name", value: { kind: "text", text: "Alec" }, args: {}, sayAs: say("The owner's name is Alec.") }),
  row("allergy", { subjectId: "self", predicate: "allergy", kind: "rule", value: { kind: "boolean", bool: true }, args: { allergenCode: "peanut" }, sayAs: say("Maya's peanut allergy.") }),
  row("film", { subjectId: "self", predicate: "fact", value: { kind: "text", text: "films" }, args: { topic: "other", label: null }, sayAs: say("The owner likes films about trains.") }),
];

describe("correctionTargets (task C2)", () => {
  for (const said of [["No, her name is Mara, not Maya."], ["No, my name is Alex, not Alec."], ["We watched a film about trains."], ["Maya and Alec both like trains."]]) {
    it(`gives extraction's open for the same snapshot and words, minus protected rows: "${said[0]}"`, () => {
      const open = pickOpen(MEMORIES, said).list.map((o) => o.id).filter((id) => id !== testId("allergy"));
      const targets = correctionTargets({ memories: MEMORIES }, said);
      expect([...targets.keys()]).toEqual(open);
      for (const t of targets.values()) expect(t.memory.predicate).not.toBe("allergy");
      expect(packetTargets(targets).map((t) => t.line)).toEqual(pickOpen(MEMORIES, said).list.filter((o) => o.id !== testId("allergy")).map((o) => o.rendered));
    });
  }
});

describe("the entity's label (G7, G33)", () => {
  it("is the name in the relation row's line, with the owner's word and the code as aliases", () => {
    const e = subjectIndex(MEMORIES, null, H).entries.find((x) => x.id === MAYA)!;
    expect(e.label).toBe("Maya");
    expect(e.aliases).toEqual(["Maya", "sister"]);
  });

  it("is the current name once a name row exists", () => {
    const named = [...MEMORIES, row("maraname", { subjectId: MAYA, predicate: "identity.name", value: { kind: "text", text: "Mara" }, args: {}, entityIds: [MAYA] })];
    expect(subjectIndex(named, null, H).entries.find((x) => x.id === MAYA)!.label).toBe("Mara");
  });

  it("falls back to the owner's word without a hasher", () => {
    expect(subjectIndex(MEMORIES, null).entries.find((x) => x.id === MAYA)!.label).toBe("sister");
  });
});

describe("resolveMention uses mentionName (task C2)", () => {
  it("\"my dad\" and \"Dad\" are one entity, the one validation derives", () => {
    const item = (name: string) => ({ mentions: [{ localId: "m1", type: "person", observedName: name, span: null, existingId: null }] }) as unknown as ExtractItem;
    expect(resolveMention("m1", item("my dad"), H)).toBe(resolveMention("m1", item("Dad"), H));
    expect(resolveMention("m1", item("My Dad"), H)).toBe(mentionEid("person", mentionName("my dad"), H));
  });
});
