/**
 * The extraction worker reads world time through `ownerClock` (brief 019 task 6). In a seeded clone the world clock
 * is core/state.worldClock, so a judge's "Thursday" is read against the clone's Friday, not the real date.
 */
import { type CoreState, type Evidence, type Memory, idParts } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { paths } from "../store/paths";
import { commitUserTurnForTest, extractOutput, factItem } from "../testing/extract-fixtures";
import { patchRecord, settle, testRig } from "../testing/fakes";
import { runExtractJob } from "./extract";

const UID = "owner-1";
const WORLD = "2026-10-30T13:40:00.000Z";

describe("extraction in fixture clock mode", () => {
  it("reads core/state.worldClock, not the ops clock, for the review date; assertedAt is the Evidence's", async () => {
    const rig = testRig();
    const turn = await commitUserTurnForTest(rig.store, UID, testId("t1"), "My dog is called Pip", rig.clock, rig.deps.hasher);
    await patchRecord<CoreState>(rig.store, UID, paths.core(UID, "state"), { clockMode: "fixture", worldClock: WORLD });
    const span = { eid: turn.eid, fieldPath: "text" as const, start: 0, end: turn.text.length, quote: turn.text };
    rig.openai.script("responses.create", ok(completed(JSON.stringify(extractOutput([factItem("statement", "new", "has a dog called Pip", [span])])))));
    expect((await settle(runExtractJob(UID, turn.jobId, rig.deps), rig.clock, rig.timers)).value).toBe("complete");
    const memory = (await rig.store.get<Memory>(UID, paths.memory(UID, rig.deps.hasher.id(idParts.memory(turn.jobId, 0)))))!.data;
    // Brief 025 task C5 (G35): assertedAt and validFrom come from the root Evidence, in transcript order; the owner's
    // world clock still sets the review date.
    const said = (await rig.store.get<Evidence>(UID, paths.evidence(UID, turn.eid)))!.data.assertedAt;
    expect(memory).toMatchObject({ assertedAt: said, validFrom: said, nextReviewAt: "2027-10-30T13:40:00.000Z", createdAt: "2026-11-03T12:00:00.000Z" });
  });
});
