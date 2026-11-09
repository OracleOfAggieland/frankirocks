import { describe, expect, it } from "vitest";
import { receiptFrom } from "./receipt-from";

describe("receiptFrom", () => {
  it("maps statuses, kept rules and touched collections to kinds and counts", () => {
    expect(
      receiptFrom({
        blockedAt: "2026-11-06T18:00:00Z",
        cleanupCompleteAt: null,
        retainedRuleIds: ["r1"],
        scopePending: true,
        touched: [
          { collection: "turns", count: 2 },
          { collection: "memories", count: 1 },
          { collection: "evidence", count: 2 },
          { collection: "chunks", count: 3 },
          { collection: "jobs", count: 1 },
          { collection: "anchors", count: 0 },
        ],
      }),
    ).toEqual({
      blocked: true,
      cleaned: false,
      kept: [{ kind: "safety rule", count: 1 }],
      touched: [
        { kind: "conversation turns", count: 2 },
        { kind: "memories", count: 1 },
        { kind: "sources", count: 5 },
        { kind: "other records", count: 1 },
      ],
    });
  });

  it("adds no line for scopePending and nothing for empty input", () => {
    expect(receiptFrom({ blockedAt: null, cleanupCompleteAt: null, retainedRuleIds: [], scopePending: true, touched: [] })).toEqual({
      blocked: false,
      cleaned: false,
      kept: [],
      touched: [],
    });
  });

  it("treats an inherited key as an unknown collection", () => {
    expect(receiptFrom({ blockedAt: 1, cleanupCompleteAt: 1, retainedRuleIds: [], scopePending: false, touched: [{ collection: "constructor", count: 1 }] }).touched).toEqual([
      { kind: "other records", count: 1 },
    ]);
  });
});
