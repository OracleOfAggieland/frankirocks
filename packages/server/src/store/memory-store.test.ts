import { UID, sampleSession, testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { createHasher } from "../crypto";
import { storeConformance } from "./conformance";
import { StoreError } from "./errors";
import { MemoryStore } from "./memory-store";
import { paths } from "./paths";

const FAKE_KEY = "test-only-franki-id-hmac-key-0000000000000";

storeConformance("Memory_Store", async () => {
  const hasher = createHasher(FAKE_KEY);
  return { store: new MemoryStore(hasher), hasher };
});

describe("Memory_Store only", () => {
  it("a record changed by another transaction after this one read it aborts with staleRevision", async () => {
    const store = new MemoryStore(createHasher(FAKE_KEY));
    const path = paths.session(UID, testId("a"));
    await store.transaction(UID, async (tx) => tx.create(path, sampleSession()));
    const error = await store
      .transaction(UID, async (tx) => {
        const doc = await tx.get(path);
        // Another transaction commits in between.
        await store.transaction(UID, async (tx2) => tx2.update(path, sampleSession({ referenceCount: 1 }), 1));
        tx.update(path, { ...doc!.data, referenceCount: 7 });
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StoreError);
    expect((error as StoreError).code).toBe("staleRevision");
    expect((await store.get(UID, path))?.data).toMatchObject({ rev: 2, referenceCount: 1 });
  });

  it("returned data is a copy", async () => {
    const store = new MemoryStore(createHasher(FAKE_KEY));
    const path = paths.session(UID, testId("a"));
    await store.transaction(UID, async (tx) => tx.create(path, sampleSession()));
    const doc = await store.get<{ referenceCount: number }>(UID, path);
    doc!.data.referenceCount = 42;
    expect((await store.get<{ referenceCount: number }>(UID, path))?.data.referenceCount).toBe(0);
  });

  it("concurrent creates of the same path: exactly one wins", async () => {
    const store = new MemoryStore(createHasher(FAKE_KEY));
    const path = paths.session(UID, testId("a"));
    const results = await Promise.allSettled(
      [1, 2, 3].map((n) => store.transaction(UID, async (tx) => tx.create(path, sampleSession({ referenceCount: n })))),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});
