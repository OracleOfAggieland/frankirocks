// Feature: voice-writes (brief 012 wave C, task C1), Property 11: a renamed name is never offered (design section 7,
// G14, G33). For Memories where an entity's name row is `wrong` with value V and its current name row has V′: no Head
// line and no recall line naming that entity contains V as a whole word, unless V is also the current name of another
// entity in that line; no line carries a name whose row fails Spoken_Grade or is S2; every line with a substituted
// name has the name row in its refs; a second person named V, in Evidence asserted after the rename, is not renamed.
// Names come from a pool with near neighbours (Maya, Mara, May). When V and V′ are the same name, the line may say it.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type HeadMemory, compileHead } from "./head";
import { recallLines } from "./recall";
import type { Ref } from "./schema/primitives";
import type { Memory } from "./schema/records";
import { sampleCoreDocs, sampleEC, sampleEvidence, sampleMemory, sampleSnapshot, testId } from "./testing";

const EID = testId("ev");
const DAY = Date.UTC(2026, 10, 3, 12);
const NAMES = ["Maya", "Mara", "May", "Sam", "Sami"] as const;
const E1 = testId("entity1");
const E2 = testId("entity2");
const E3 = testId("entity3");
const norm = (s: string) => s.normalize("NFKC").toLowerCase();
const wholeWord = (text: string, w: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "iu").test(text);

const caseArb = fc.record({
  oldName: fc.constantFrom(...NAMES),
  newName: fc.constantFrom(...NAMES),
  otherName: fc.constantFrom(...NAMES),
  currentSens: fc.constantFrom<"S0" | "S1" | "S2">("S0", "S1", "S2"),
  currentFails: fc.boolean(),
  template: fc.nat(2),
  withOther: fc.boolean(),
  withStranger: fc.boolean(),
});

const say = (text: string) => ({ text, entityRefs: [], timeFields: [] });

function build(c: { oldName: string; newName: string; otherName: string; currentSens: "S0" | "S1" | "S2"; currentFails: boolean; template: number; withOther: boolean; withStranger: boolean }): HeadMemory[] {
  const V = c.oldName;
  const row = (n: string, o: Partial<Memory>): HeadMemory => ({ id: testId(`m-${n}`), memory: sampleMemory({ key: testId(`k-${n}`), ...o }) });
  const lines = [`${V} is the owner's sister.`, `The owner's sister ${V} lives in Leeds.`, `${V} called about Friday.`];
  const out: HeadMemory[] = [
    row("e1-old", { subjectId: E1, predicate: "identity.name", value: { kind: "text", text: V }, args: {}, status: "wrong", closeReason: "refuted", entityIds: [E1], sayAs: say(`The owner's sister's name is ${V}.`) }),
    row("e1-new", {
      subjectId: E1,
      predicate: "identity.name",
      value: { kind: "text", text: c.newName },
      args: {},
      sens: c.currentSens,
      // A current name row that fails Spoken_Grade: pasted text (T) carries no subject truth.
      ...(c.currentFails ? { sourceClass: "T" as const } : {}),
      entityIds: [E1],
      sayAs: say(`The owner's sister's name is ${c.newName}.`),
    }),
    row("e1-rel", { subjectId: "self", predicate: "person.relation", value: { kind: "enum", code: "sister" }, args: { otherRef: E1, label: "sister", employerRef: null }, entityIds: [E1], sayAs: say(lines[c.template]!) }),
  ];
  if (c.withOther) {
    out.push(row("e2-name", { subjectId: E2, predicate: "identity.name", value: { kind: "text", text: c.otherName }, args: {}, entityIds: [E2], sayAs: say(`The owner's friend's name is ${c.otherName}.`) }));
    out.push(row("e1e2", { subjectId: "self", predicate: "fact", value: { kind: "text", text: "friends" }, args: { topic: "other", label: null }, entityIds: [E1, E2], sayAs: say(`${V} and ${c.otherName} are friends.`) }));
  }
  if (c.withStranger) {
    // A second person named V, said after the rename: a different entity, never renamed.
    out.push(row("e3", { subjectId: E3, predicate: "fact", value: { kind: "text", text: "from work" }, args: { topic: "other", label: null }, entityIds: [E3], sayAs: say(`${V} from work called.`), assertedAt: "2026-11-03T13:00:00.000Z" }));
  }
  return out;
}

describe("Property 11: a renamed name is never offered", () => {
  it("no Head or recall line naming the renamed entity carries the old name", () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const mems = build(c);
        const byId = new Map(mems.map((m) => [m.id, m.memory]));
        const snapshot = sampleSnapshot({ memories: mems.map((m) => [m.id, m.memory]), evidence: [[EID, sampleEvidence()]] });
        const head = compileHead({ memories: mems, ec: sampleEC(), snapshot, rules: sampleCoreDocs().rules, clock: { worldClock: { now: DAY, zone: "UTC" }, opsClock: { now: DAY } } });
        expect(head.ok).toBe(true);
        if (!head.ok) return;
        const recall = recallLines(mems, sampleEC(), snapshot, new Map([[EID, sampleEvidence()]]));
        const nameRow = mems.find((m) => m.id === testId("m-e1-new"))!;
        const currentOk = c.currentSens !== "S2" && !c.currentFails;
        const seen: { text: string; memory: Memory; refs: readonly Ref[] }[] = [
          ...head.lines.filter((l) => l.ref !== null && byId.has(l.ref.id)).map((l) => ({ text: l.text, memory: byId.get(l.ref!.id)!, refs: head.head.selectedRefs })),
          ...recall.lines.map((l) => ({ text: l.item.text, memory: byId.get(l.item.id)!, refs: l.item.refs })),
        ];
        for (const s of seen) {
          const what = `${JSON.stringify(c)}: "${s.text}"`;
          const ents = s.memory.entityIds ?? [];
          if (ents.includes(E1) && s.memory.predicate !== "identity.name") {
            const otherHasIt = ents.includes(E2) && c.withOther && norm(c.otherName) === norm(c.oldName);
            if (norm(c.oldName) !== norm(c.newName) && !otherHasIt) expect(wholeWord(s.text, c.oldName), `${what} still says ${c.oldName}`).toBe(false);
            const stored = s.memory.sayAs?.text ?? "";
            if (!currentOk && !wholeWord(stored, c.newName)) expect(wholeWord(s.text, c.newName), `${what} carries a name whose row can't be spoken`).toBe(false);
            if (s.text.replace(/^- /, "") !== stored && wholeWord(s.text, c.newName) && !wholeWord(stored, c.newName)) {
              expect(s.refs.some((r) => r.id === nameRow.id), `${what} has no ref to the name row`).toBe(true);
            }
          }
          if (ents.includes(E3)) expect(wholeWord(s.text, c.oldName), `${what}: the second ${c.oldName} was renamed`).toBe(true);
        }
      }),
      { numRuns: 1000 },
    );
  });
});
