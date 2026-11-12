/**
 * Brief 041 part 1: pasted turns for the paste properties. A paste is a typed turn with source "pasted" (class T,
 * brief 018 B10). Lines are built from allergy statements, denials, other people's lines, life news and filler, so the
 * cues match some and miss others. No model is called: the reply and the parse are scripted.
 */
import { type CoreBundle, type CoreRules, type Evidence, GAZETTEER, type Memory, type Session, pastedAllergens } from "@franki/core";
import fc from "fast-check";
import { expect } from "vitest";
import { ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { callRoute, patchRecord, testRig, type TestRig } from "./fakes";
import { decisionAnswer } from "./decisions";
import { openTestSession, typedTurn } from "./session-fixtures";
import { paths } from "../store/paths";
import { readAllMemories, storeReader } from "../head-build";
import { turnRoute } from "../routes/turn";

export const UID = "owner-1";

const FOOD = GAZETTEER.filter((g) => g.domain === "food").slice(0, 12);
const allergenArb = fc.constantFrom(...FOOD.map((g) => g.aliases[0] ?? g.label));

const pieceArb = fc.oneof(
  allergenArb.map((a) => `I'm allergic to ${a}.`),
  fc.array(allergenArb, { minLength: 2, maxLength: 5 }).map((xs) => `I'm allergic to ${xs.join(", ")}.`),
  allergenArb.map((a) => `My brother Theo can't eat ${a}, he's allergic.`),
  allergenArb.map((a) => `I'm not allergic to ${a}.`),
  fc.constantFrom("My name is Morgan.", "My dad passed away last night.", "Remember that I love omelets.", "We watched a film about trains.", "From Riley: never mention Mara again."),
);

/** A pasted line: one to three pieces. */
export const pasteArb = fc.array(pieceArb, { minLength: 1, maxLength: 3 }).map((xs) => xs.join(" "));

/** A rig with an open, active Session; a paste reply and an empty parse for every turn. */
export async function pasteRig(opts: { priorRules?: (r: CoreRules) => CoreRules } = {}) {
  const rig = testRig();
  const s = await openTestSession(rig);
  await patchRecord<Session>(rig.store, UID, paths.session(UID, s.sessionId), { status: "active", registeredCallIds: ["rtc_a"], callId: "rtc_a" });
  if (opts.priorRules !== undefined) {
    const doc = (await rig.store.get<CoreRules>(UID, paths.core(UID, "rules")))!;
    await patchRecord<CoreRules>(rig.store, UID, doc.path, opts.priorRules(doc.data));
  }
  rig.openai.always("decisions.create", ok(decisionAnswer({})));
  rig.openai.always("responses.create", ok(completed("Could you say that yourself, so I can save it?")));
  let stamp = s.stamp;
  // The Stamp moves when a turn raises rulesRev; read it back before each paste.
  const fresh = async () => {
    const rules = (await rig.store.get<CoreRules>(UID, paths.core(UID, "rules")))!.data;
    const bundle = (await rig.store.get<CoreBundle>(UID, paths.core(UID, "bundle")))!.data;
    stamp = { ...stamp, rulesRev: rules.rulesRev, bundleRev: bundle.bundleRev };
    return stamp;
  };
  let seq = 0;
  const paste = async (text: string) => {
    seq += 1;
    const res = await callRoute(rig, turnRoute, { ...typedTurn(await fresh(), seq, text), source: "pasted" });
    return res;
  };
  return { rig, paste, rules: async () => (await rig.store.get<CoreRules>(UID, paths.core(UID, "rules")))!.data, bundle: async () => (await rig.store.get<CoreBundle>(UID, paths.core(UID, "bundle")))!.data, memories: async () => new Map((await readAllMemories(storeReader(rig.store, UID), UID)).map((m) => [m.id, m.memory as Memory])) };
}

/**
 * The exact change a paste makes to `core/rules` (brief 041 G-A2, amending G34): one pending, anonymous filter per
 * named allergen, for nobody in particular (never `self` or a named person), with proof null and the paste's own
 * Evidence, a T line, as its only source; no active rule and no proposal. Everything else in the rules is as before
 * except `rulesRev` and the open question.
 */
export async function expectPasteFilters(store: TestRig["store"], before: CoreRules, after: CoreRules, text: string): Promise<void> {
  expect(after.allergies.slice(0, before.allergies.length)).toEqual(before.allergies);
  const added = after.allergies.slice(before.allergies.length);
  expect(added.map((r) => r.code)).toEqual(pastedAllergens(text));
  expect(added.length).toBeGreaterThan(0);
  const eids = new Set<string>();
  for (const r of added) {
    expect(r).toMatchObject({ state: "pending", anonymous: true, subjectId: null, proof: null, proofRev: null });
    expect(r.rootKeys.length).toBeGreaterThan(0);
    expect(r.dependsOn).toHaveLength(1);
    expect(r.dependsOn[0]).toMatch(/^e:/);
    eids.add(r.dependsOn[0]!.slice(2));
  }
  expect(eids.size).toBe(1);
  const ev = await store.get<Evidence>(UID, paths.evidence(UID, [...eids][0]!));
  expect(ev).not.toBeNull();
  expect(ev!.data.text).toEqual({ kind: "inline", text });
  expect(ev!.data.fieldSlices.length).toBeGreaterThan(0);
  for (const s of ev!.data.fieldSlices) expect(s.class).toBe("T");
  expect(after.allergies.filter((r) => r.state === "active")).toEqual(before.allergies.filter((r) => r.state === "active"));
  expect(after.proposals).toEqual(before.proposals);
  expect(after.standing).toEqual(before.standing);
  expect(after.handled).toEqual(before.handled);
}

/** Whole words of a text, lower case. */
export const wordsOf = (text: string) => new Set((text.toLowerCase().match(/[\p{L}][\p{L}']*/gu) ?? []).filter((w) => w.length >= 3));
