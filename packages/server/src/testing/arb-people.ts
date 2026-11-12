/**
 * Brief 041 part 2: two people with one name (Friend Test 16). Each line states one relation of a named person; the
 * worker runs on a scripted extraction (no model is called), and the properties read the stored relations back.
 */
import { type Memory, idParts, keyOf, mentionEid, mentionName, rootKey, turnTextSlice } from "@franki/core";
import { sampleMemory, testId } from "@franki/core/testing";
import fc from "fast-check";
import { ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { paths } from "../store/paths";
import { memoriesOf as memoriesIn } from "./arb-corrections";
import { runExtractJob } from "../worker/extract";
import { type CommittedTurn, commitUserTurnForTest, extractOutput } from "./extract-fixtures";
import { type TestRig, settle, testRig } from "./fakes";
import { item } from "./script-runner";

export const UID = "owner-1";

export interface Role {
  code: string;
  label: string;
  /** A line that states the role of `name`. */
  line: (name: string) => string;
}

/** Relations that conflict pairwise: no two share a code, or they are `other` with different labels. */
export const ROLES: readonly Role[] = [
  { code: "colleague", label: "colleague", line: (n) => `${n} from work is presenting on Monday.` },
  { code: "other", label: "neighbor", line: (n) => `My neighbor ${n} lent me a ladder.` },
  { code: "sister", label: "sister", line: (n) => `My sister ${n} is visiting this weekend.` },
  { code: "other", label: "gym buddy", line: (n) => `My gym buddy ${n} moved to Denver.` },
  { code: "friend", label: "friend", line: (n) => `My friend ${n} sent me a book.` },
];
export const NAMES = ["Alex", "Sam", "Mara", "Jordan"] as const;

export const nameArb = fc.constantFrom(...NAMES);
/** Two different roles, in either order. */
export const twoRolesArb = fc.tuple(fc.nat(ROLES.length - 1), fc.nat(ROLES.length - 2)).map(([a, b]) => [ROLES[a]!, ROLES[b >= a ? b + 1 : b]!] as const);

const spanIn = (t: CommittedTurn, quote: string) => {
  const at = t.text.indexOf(quote);
  if (at < 0) throw new Error(`"${quote}" is not in "${t.text}"`);
  return { eid: t.eid, fieldPath: "text" as const, start: at, end: at + quote.length, quote };
};

/** The item a careful model returns for a role line: one person.relation about the named person. */
export function relationItem(t: CommittedTurn, name: string, role: Role, at: number) {
  const span = spanIn(t, name);
  const localId = `m${at + 1}`;
  return item({
    act: "statement",
    kind: "fact",
    predicate: "person.relation",
    value: { kind: "enum", code: role.code },
    args: { otherRef: localId, label: role.label, employerRef: null },
    mentions: [{ localId, type: "person", observedName: name, span, existingId: null }],
    spans: [span],
    sens: "S0",
  });
}

/** The item for a bare mention: a fact about the named person and nothing about who they are. */
export function bareItem(t: CommittedTurn, name: string) {
  const span = spanIn(t, name);
  return item({
    act: "statement",
    kind: "fact",
    predicate: "fact",
    subject: "m1",
    value: { kind: "text", text: "is coming to dinner" },
    args: { topic: "other", label: null },
    mentions: [{ localId: "m1", type: "person", observedName: name, span, existingId: null }],
    spans: [spanIn(t, t.text.replace(/\.$/, ""))],
    sens: "S0",
  });
}

export function peopleRig() {
  const rig = testRig();
  let n = 0;
  const tick = () => {
    rig.clock.advance(60_000);
    rig.clock.setWorld(rig.clock.read().worldClock.now + 60_000);
  };
  /** Commits one owner turn and runs its extraction with the items `items(turn)` returns. */
  const say = async (text: string, items: (t: CommittedTurn) => unknown[]) => {
    n += 1;
    tick();
    const t = await commitUserTurnForTest(rig.store, UID, testId(`turn-${n}`), text, rig.clock, rig.deps.hasher);
    rig.openai.script("responses.create", ok(completed(JSON.stringify(extractOutput(items(t))))));
    await settle(runExtractJob(UID, t.jobId, rig.deps), rig.clock, rig.timers);
    return t;
  };
  return { rig, say, memories: () => memoriesOf(rig) };
}

export const memoriesOf = (rig: TestRig): Promise<Map<string, Memory>> => memoriesIn(rig.store);

/** The current relations to the owner, as [otherRef, code, label]. */
export const relations = (ms: Map<string, Memory>) =>
  [...ms.values()].filter((m) => m.predicate === "person.relation" && m.status === "active").map((m) => [(m.args as { otherRef: string }).otherRef, m.value.kind === "enum" ? m.value.code : null, (m.args as { label: string | null }).label] as const);

/**
 * Seeds a sister renamed from Maya to `name` (brief 025 task C4): the old name row is `wrong`, the new one current,
 * and her relation stored under the entity derived from the old name.
 */
export async function seedRenamedSister(rig: TestRig, name: string): Promise<string> {
  const H = rig.deps.hasher;
  const t = await commitUserTurnForTest(rig.store, UID, testId("sister"), `My sister Maya is visiting. No, her name is ${name}.`, rig.clock, H);
  const sister = mentionEid("person", mentionName("Maya"), H);
  const slice = turnTextSlice(t.eid, t.text, "U", H);
  const base = { uid: UID, rootSlices: [slice], rootKeys: [rootKey(slice, H)], packetEids: [t.eid], dependsOn: [`e:${t.eid}`], supportingIds: [{ type: "evidence" as const, id: t.eid, rev: 1 }], entityIds: [sister] };
  const say = (text: string) => ({ text, entityRefs: [], timeFields: [] });
  const relArgs = { otherRef: sister, label: "sister", employerRef: null };
  const relValue = { kind: "enum" as const, code: "sister" };
  const nameKey = keyOf(sister, "identity.name", {}, { kind: "text", text: name }, H);
  const rows: [string, Partial<Memory>][] = [
    ["rel", { ...base, subjectId: "self", predicate: "person.relation", value: relValue, args: relArgs, ...keyOf("self", "person.relation", relArgs, relValue, H), sayAs: say("Maya is the owner's sister.") }],
    ["old", { ...base, subjectId: sister, predicate: "identity.name", value: { kind: "text", text: "Maya" }, args: {}, ...nameKey, status: "wrong", closeReason: "refuted", sayAs: say("The owner's sister's name is Maya.") }],
    ["new", { ...base, subjectId: sister, predicate: "identity.name", value: { kind: "text", text: name }, args: {}, ...nameKey, sayAs: say(`The owner's sister's name is ${name}.`) }],
  ];
  await rig.store.transaction(UID, async (tx) => {
    for (const [label, o] of rows) tx.create(paths.memory(UID, H.id(idParts.memory(testId("seed"), label === "rel" ? 0 : label === "old" ? 1 : 2))), sampleMemory({ kind: "fact", ...o } as Partial<Memory>));
  });
  return sister;
}
