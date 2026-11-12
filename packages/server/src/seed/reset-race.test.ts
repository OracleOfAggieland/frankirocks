// Brief 038 finding 2: a write of the old visit that lands inside a reset must not survive it.
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { receiptRoute } from "../routes/receipt";
import { callRoute, testRig } from "../testing/fakes";
import { openTestSession } from "../testing/session-fixtures";
import { evidenceOf, hookedStore, resetAs } from "../testing/seed";

const UID = "owner-1";

describe("a reset under a racing writer (brief 038 finding 2)", () => {
  it("a transcript receipt posted when the clear first queries /memories is refused and leaves nothing", async () => {
    const rig = testRig();
    expect((await resetAs(rig, UID, "v1", "r1")).status).toBe(200);
    const s = await openTestSession(rig);
    const inner = rig.deps.store;
    let receipt: { status: number; body: any } | null = null;
    rig.deps.store = hookedStore(
      inner,
      (op) => op.kind === "query" && op.collection.endsWith("/memories"),
      async () => {
        receipt = await callRoute(rig, receiptRoute, {
          requestId: testId("late-receipt"),
          stamp: { ...s.stamp, turnId: testId("turn-old") },
          responseId: "resp_old",
          kind: "transcript",
          momentIds: [],
          noteIds: [],
          pendingId: null,
          permitKind: null,
          text: "Old visit words.",
        });
      },
    );
    const reset = await resetAs(rig, UID, "v2", "r2");
    rig.deps.store = inner;
    expect(reset.status).toBe(200);
    expect(receipt).not.toBeNull();
    // Refused, and answered as refused: never accepted.
    expect(receipt!.body.accepted ?? false).toBe(false);
    const words = (await evidenceOf(rig.store, UID)).filter((e) => JSON.stringify(e.data).includes("Old visit words."));
    expect(words).toEqual([]);
  });
});
