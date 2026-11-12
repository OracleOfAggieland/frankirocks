/**
 * Brief 045 finding 10: a seeded owner with a diet Memory, an open Session, and `suggest` after a spoken turn with
 * the Session's audience set as the room would leave it. Plain module, for tests and properties.
 */
import { type CoreState, type Memory, type Session, buildSlice, rootKey, tsFromMs } from "@franki/core";
import { HERO_ZONE, instantAt, sampleEvidence, sampleMemory, testId } from "@franki/core/testing";
import { ensureCoreDocs } from "../core-docs";
import { toolRoute } from "../routes/tool";
import { turnRoute } from "../routes/turn";
import { paths } from "../store/paths";
import { callRoute, patchRecord, testRig } from "./fakes";
import { asrTurn, openTestSession } from "./session-fixtures";

const UID = "owner-1";
const SUGGEST = { domain: "food", query: "quick dinner", attendeeIds: [], when: null, contextId: null };
export const SEP_30_END = instantAt("2026-10-01", 0, HERO_ZONE); // the first instant after September, in Chicago

type Rig = ReturnType<typeof testRig>;

/** A Memory resting on its own Evidence, whose text is `said`. */
export async function remember(rig: Rig, name: string, said: string, m: Partial<Memory>) {
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

export const vegetarian = (validTo: number | null, subjectId = "self"): Partial<Memory> => ({
  subjectId,
  value: { kind: "enum", code: "vegetarian" },
  args: { dimension: "diet", targetRef: null },
  validTo: validTo === null ? null : tsFromMs(validTo),
  when: { kind: "spoken", spoken: "this month" },
});

export async function suggestSetup(store: (rig: Rig) => Promise<void>) {
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
  /** The turn, then the Session's audience set as the room would leave it, then suggest. */
  const suggest = async (text: string, audience: "private" | "company" | "unknown") => {
    const stamp = await say(text);
    await patchRecord<Session>(rig.store, UID, paths.session(UID, s.sessionId), { audience });
    return tool(stamp, { name: "suggest", args: SUGGEST });
  };
  return { rig, suggest };
}

