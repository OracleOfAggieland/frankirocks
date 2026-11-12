/** Test setup for the audience tasks (brief 026): one S0 and one S1 Memory, so a full Head and a narrow one differ. */
import { testId } from "@franki/core/testing";
import { linkedEvidence, linkedMemory } from "../store/conformance";
import { paths } from "../store/paths";
import type { TestRig } from "./fakes";

export const PLAIN_FACT = "plain fact";
export const PERSONAL_FACT = "personal fact";

export async function seedTwoMemories(rig: TestRig, uid = "owner-1"): Promise<void> {
  const ev = linkedEvidence(rig.deps.hasher, "two-memories-ev", "I told Franki two things.");
  await rig.store.transaction(uid, async (tx) => {
    tx.create(paths.evidence(uid, ev.eid), { ...ev.record, uid });
    tx.create(paths.memory(uid, testId("m-plain")), { ...linkedMemory(rig.deps.hasher, ev, { key: testId("k-plain"), sens: "S0", value: { kind: "text", text: PLAIN_FACT } }), uid });
    tx.create(paths.memory(uid, testId("m-personal")), { ...linkedMemory(rig.deps.hasher, ev, { key: testId("k-personal"), sens: "S1", value: { kind: "text", text: PERSONAL_FACT } }), uid });
  });
}
