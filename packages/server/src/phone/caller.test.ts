import type { Memory } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { commitUserTurnForTest, insertMemoryForTest } from "../testing/extract-fixtures";
import { type TestRig, testRig } from "../testing/fakes";
import { phoneLocalTime, readPhoneCaller } from "./caller";

const UID = "owner-1";

/** Saves the owner's own name the way an extract does: a Memory over the owner's committed turn (class U). */
async function saveName(r: TestRig, text: string, overrides: Partial<Memory> = {}): Promise<void> {
  const turn = await commitUserTurnForTest(r.store, UID, testId(`name-turn-${text}`), `Call me ${text}.`, r.clock, r.deps.hasher);
  await insertMemoryForTest(r.store, UID, turn, r.deps.hasher, {
    predicate: "identity.name", kind: "fact", subjectId: "self", args: {}, value: { kind: "text", text },
    key: r.deps.hasher.id(["test-key", "identity.name", text]), ...overrides,
  }, `name-${text}`);
}

describe("who the phone call is for", () => {
  it("words the owner's local date and time with the zone", () => {
    const words = phoneLocalTime(Date.UTC(2026, 10, 26, 21, 42), "America/Chicago");
    expect(words).toMatch(/^Thursday, November 26, 2026.* 3:42\sPM \(America\/Chicago\)$/);
  });

  it("carries the owner's own name once one is saved", async () => {
    const r = testRig();
    await commitUserTurnForTest(r.store, UID, testId("hello"), "Hello there.", r.clock, r.deps.hasher);
    expect(await readPhoneCaller(r.deps, UID)).toEqual({ name: null, localTime: expect.stringMatching(/\(UTC\)$/) });
    await saveName(r, "Matt");
    expect((await readPhoneCaller(r.deps, UID)).name).toBe("Matt");
  });

  it("leaves out a name that isn't everyday grade, since a stranger hears it", async () => {
    const r = testRig();
    await saveName(r, "Matt", { sens: "S1" });
    expect((await readPhoneCaller(r.deps, UID)).name).toBeNull();
  });
});
