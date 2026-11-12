// Brief 025 task C4: the rename index (G14, CQ 109) in recall, extraction's `resolveMention` and the worker's `open`.
import { type ExtractItem, type HeadMemory, type Memory, mentionEid, recallLines, renameIndex, renameLine, resolveMention } from "@franki/core";
import { sampleEC, sampleEvidence, sampleMemory, sampleSnapshot, testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { testRig } from "../testing/fakes";
import { pickOpen, workerRenames } from "./extract";

const H = testRig().deps.hasher;
const say = (text: string) => ({ text, entityRefs: [], timeFields: [] });
const SISTER = mentionEid("person", "maya", H);
const row = (n: string, o: Partial<Memory>): HeadMemory => ({ id: testId(n), memory: sampleMemory({ key: testId(`k${n}`), ...o }) });

const OLD = row("maya", { subjectId: SISTER, predicate: "identity.name", value: { kind: "text", text: "Maya" }, args: {}, status: "wrong", closeReason: "refuted", entityIds: [SISTER], sayAs: say("The owner's sister's name is Maya.") });
const NEW = row("mara", { subjectId: SISTER, predicate: "identity.name", value: { kind: "text", text: "Mara" }, args: {}, entityIds: [SISTER], assertedAt: "2026-11-03T12:05:00.000Z", sayAs: say("The owner's sister's name is Mara.") });
const REL = row("rel", { subjectId: "self", predicate: "person.relation", value: { kind: "enum", code: "sister" }, args: { otherRef: SISTER, label: "sister", employerRef: null }, entityIds: [SISTER], sayAs: say("Maya is the owner's sister.") });
const BDAY = row("bday", { subjectId: SISTER, predicate: "fact", value: { kind: "text", text: "June 3" }, args: { topic: "other", label: null }, entityIds: [SISTER], sayAs: say("Maya's birthday is June 3.") });

describe("renameLine (task C4)", () => {
  it("puts the current name in place of the old one, whole word, and names the name row", () => {
    const index = renameIndex([OLD, NEW, REL], [NEW, REL]);
    expect(renameLine("Maya is the owner's sister. Mayan ruins.", REL.memory, index)).toEqual({ text: "Mara is the owner's sister. Mayan ruins.", refs: [{ type: "memory", id: NEW.id, rev: NEW.memory.rev }] });
  });

  it("leaves a line out when no current name row may be spoken", () => {
    expect(renameLine("Maya is the owner's sister.", REL.memory, renameIndex([OLD, NEW, REL], [REL]))).toBeNull();
  });

  it("leaves lines of other entities, and the name rows themselves, alone", () => {
    const index = renameIndex([OLD, NEW, REL], [NEW, REL]);
    const stranger = sampleMemory({ entityIds: [testId("someone")] });
    expect(renameLine("Maya from work called.", stranger, index)).toEqual({ text: "Maya from work called.", refs: [] });
    expect(renameLine("The owner's sister's name is Maya.", OLD.memory, index)).toEqual({ text: "The owner's sister's name is Maya.", refs: [] });
  });
});

describe("recall lines (task C4)", () => {
  it("say the current name, carry the name row's ref, and never offer the old name", () => {
    const rows = [OLD, NEW, REL, BDAY];
    const snapshot = sampleSnapshot({ memories: rows.map((m) => [m.id, m.memory]), evidence: [[testId("ev"), sampleEvidence()]] });
    const { lines } = recallLines(rows, sampleEC(), snapshot, new Map());
    const texts = lines.map((l) => l.item.text);
    expect(texts).toEqual(expect.arrayContaining(["Mara is the owner's sister.", "Mara's birthday is June 3."]));
    expect(texts.some((t) => /\bMaya\b/.test(t))).toBe(false);
    for (const l of lines.filter((x) => x.item.id === REL.id || x.item.id === BDAY.id)) expect(l.item.refs.map((r) => r.id)).toContain(NEW.id);
  });
});

describe("resolveMention with renames (task C4)", () => {
  const item = (name: string) => ({ mentions: [{ localId: "m1", type: "person", observedName: name, span: null, existingId: null }] }) as unknown as ExtractItem;
  const index = renameIndex([OLD, NEW, REL], [NEW, REL]);

  it("maps the new name to the renamed entity", () => {
    expect(resolveMention("m1", item("Mara"), H, { index, at: "2026-11-03T13:00:00.000Z" })).toBe(SISTER);
  });

  it("maps the old name, said after the rename, to a new entity salted with the rename's Memory ID", () => {
    const later = resolveMention("m1", item("Maya"), H, { index, at: "2026-11-03T13:00:00.000Z" });
    expect(later).not.toBe(SISTER);
    expect(later).toBe(H.id(["mention", "person", "maya", OLD.id]));
  });

  it("keeps the old name's entity for Evidence said before the rename", () => {
    expect(resolveMention("m1", item("Maya"), H, { index, at: "2026-11-03T12:00:00.000Z" })).toBe(SISTER);
  });
});

describe("the worker's open list (task C4)", () => {
  it("renders lines with the current name", () => {
    const all = [OLD, NEW, REL, BDAY];
    const open = pickOpen(all, ["Is Mara's birthday in June? My sister."], workerRenames(all));
    expect(open.list.map((o) => o.rendered)).toEqual(expect.arrayContaining(["Mara is the owner's sister."]));
    expect(open.list.some((o) => /\bMaya\b/.test(o.rendered))).toBe(false);
  });
});
