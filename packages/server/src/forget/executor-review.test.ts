// Review 028, findings 6 to 8: the forget executor in a long session, a rule written mid-install, and a retry
// after the evidence page.
import { type CoreRules, type Memory, type Session, buildSlice, rootKey, tsFromMs } from "@franki/core";
import { sampleSession, testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { paths } from "../store/paths";

import { commitUserTurnForTest, insertMemoryForTest, insertTurnForTest } from "../testing/extract-fixtures";
import { T0_MS, patchRecord, testRig } from "../testing/fakes";
import { advanceForget } from "./executor";
import { fenceForget } from "./fence";
import { fakeForgetResolve } from "./resolve-port";

const UID = "owner-1";
const SESSION = testId("session");
const T1 = testId("turn1");
const REQ = testId("turnReq");
const TEXT = "I'm allergic to shellfish. Danny relapsed.";
const RULE = testId("shellfish");
const exact = (ids: string[]) => ({ resolution: "exact", remove: [], candidateIds: ids, entityIds: [], topicKeys: [], needsMore: false, clarification: null });

async function setup(filler = 0) {
  const rig = testRig();
  const { store, deps, clock } = rig;
  const hasher = deps.hasher;
  const turn = await commitUserTurnForTest(store, UID, T1, TEXT, clock, hasher);
  const danny = buildSlice({ eid: turn.eid, fieldPath: "text", fieldText: TEXT, start: 27, end: 42, class: "U", sens: "S0" }, hasher);
  const dannyId = await insertMemoryForTest(store, UID, turn, hasher, { rootSlices: [danny], rootKeys: [rootKey(danny, hasher)], value: { kind: "text", text: "Danny relapsed" } }, "danny");
  const proof = buildSlice({ eid: turn.eid, fieldPath: "text", fieldText: TEXT, start: 0, end: 26, class: "U", sens: "S0" }, hasher);
  const rules = (await store.get<CoreRules>(UID, paths.core(UID, "rules")))!.data;
  await patchRecord<CoreRules>(store, UID, paths.core(UID, "rules"), {
    rulesRev: rules.rulesRev + 1,
    allergies: [
      {
        id: RULE,
        subjectId: "self",
        code: "shellfish",
        state: "active",
        anonymous: false,
        proof: { eid: turn.eid, fieldPath: "text", start: 0, end: 26, quote: "I'm allergic to shellfish." },
        proofRev: 1,
        rootKeys: [rootKey(proof, hasher)],
        dependsOn: [`e:${turn.eid}`],
      },
    ],
  });
  await store.transaction(UID, async (tx) => tx.create(paths.session(UID, SESSION), sampleSession({ uid: UID, status: "active", registeredCallIds: [], callId: null }) as Session));
  await insertTurnForTest(store, UID, SESSION, T1, { seq: 1, evidenceId: turn.eid, text: TEXT, parseState: "committed", itemIds: ["item_1"], committedAt: tsFromMs(T0_MS) });
  for (let i = 0; i < filler; i++) {
    await insertTurnForTest(store, UID, SESSION, testId(`fill${i}`), { seq: 2 + i, evidenceId: null, text: "Okay.", parseState: "committed", itemIds: [`item_f${i}`], committedAt: tsFromMs(T0_MS + 1_000 + i) });
  }
  await insertTurnForTest(store, UID, SESSION, REQ, { seq: 2 + filler, evidenceId: null, text: "Forget that Danny relapsed", parseState: "pending", itemIds: ["item_req"], committedAt: tsFromMs(T0_MS + 5_000 + filler) });
  const get = async <T>(path: string) => (await store.get<T>(UID, path))!.data;
  const fence = await fenceForget(store, UID, { sessionId: SESSION, requestId: "req-1", requestTurnIds: [REQ] }, T0_MS + 6_000 + filler, hasher);
  if (fence.kind === "refused") throw new Error("refused");
  return { rig, store, hasher, turn, dannyId, get, fence, at: T0_MS + 7_000 + filler };
}

describe("finding 6: resolve finds the request in a long session", () => {
  it("reads the request turn after 150 earlier turns", async () => {
    const { store, hasher, dannyId, get, fence, at } = await setup(150);
    const resolver = fakeForgetResolve(() => exact([dannyId]));
    expect(await advanceForget({ store, hasher, resolver }, UID, fence.jobId, at)).toEqual({ kind: "stopped", phase: "closure" });
    expect(resolver.calls[0]!.request.quote).toBe("Forget that Danny relapsed");
    expect((await get<Memory>(paths.memory(UID, dannyId))).status).toBe("blocked");
  });
});

