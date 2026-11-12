// GET /api/memory answers for the "Main screen on memory data" specimen (brief 020). Specimens only: nothing on
// /lab imports this. Each answer is a valid MemoryResponse, and the specimen runs it through the same view-model
// the main screen uses (`ui/memory-screen.ts`).
import type { MemoryResponse, SnapshotView } from "@franki/core";

/** A 43-character ID for a fixture row. */
const fid = (label: string) => (`fx${label}` + "_".repeat(43)).slice(0, 43);
const COMPLETE = { state: "complete" as const, from: null, to: null, missingRanges: [], generation: 0 };
const AT = "2026-11-06T08:40:00.000Z";

const card = (label: string, line: string, sens: "S0" | "S1" = "S0") => ({
  id: fid(label),
  kind: "memory" as const,
  title: line,
  lines: [line],
  sources: [{ type: "memory" as const, id: fid(label), rev: 1 }],
  sens,
});

const told = (label: string, line: string) => ({
  noteId: fid(`n${label}`),
  rev: 1,
  kind: "truth" as const,
  text: line,
  rootKeys: [],
  dependsOn: [],
  sens: "S0" as const,
  expiresAt: AT,
  unprompted: false,
  momentId: null,
  tokens: [],
});

const LINES = {
  biscuit: "fact: Biscuit has surgery Thursday",
  pip: "fact: My dog is called Pip",
  bakery: "fact: I work at the bakery",
  gap: "fact: I took a gap year after school",
};

export const FIXTURE_SNAPSHOT: SnapshotView = {
  cards: [card("biscuit", LINES.biscuit), card("pip", LINES.pip), card("bakery", LINES.bakery), card("gap", LINES.gap, "S1")],
  overview: { topics: [{ predicate: "fact", count: 4 }], guesses: 3, heldPrivate: 1, recentTold: [told("biscuit", LINES.biscuit), told("bakery", LINES.bakery)] },
  coverage: COMPLETE,
  truncated: false,
  cursor: null,
};

const base: MemoryResponse = { items: [], snapshot: null, lab: null, strip: null, nextCursor: null, coverage: COMPLETE };

export const FIXTURE_MEMORY: { overview: MemoryResponse; lab: MemoryResponse; strip: MemoryResponse; receipt: MemoryResponse } = {
  overview: { ...base, snapshot: FIXTURE_SNAPSHOT },
  lab: {
    ...base,
    lab: {
      readEmails: 128,
      privateGuesses: 3,
      guessLinesSpoken: 0,
      delivered: 14,
      held: 2,
      steered: 0,
      declined: 0,
      blocked: 1,
      falseHolds: 0,
      overForget: 0,
      foodWithoutSuggest: 0,
      coverage: COMPLETE,
      limits: ["floorRecall", "uncounted:steered", "uncounted:declined", "uncounted:falseHolds", "uncounted:overForget", "uncounted:foodWithoutSuggest"],
    },
  },
  strip: {
    ...base,
    strip: {
      loopId: fid("loop"),
      steps: [
        { kind: "noticed", state: "complete", label: "noticed", ledgerId: null },
        { kind: "connected", state: "complete", label: "connected", ledgerId: null },
        { kind: "suggested", state: "complete", label: "suggested", ledgerId: null },
        { kind: "accepted", state: "complete", label: "accepted", ledgerId: fid("action") },
        { kind: "comparison", state: "pending", label: "comparison", ledgerId: null },
      ],
    },
  },
  receipt: {
    ...base,
    items: [
      {
        id: fid("receipt"),
        kind: "receipt",
        label: "forgetReceipt",
        body: JSON.stringify({ retainedRules: 1, scopePending: false, withdrawnCount: 0, touched: [{ collection: "turns", count: 1 }, { collection: "memories", count: 1 }] }),
        status: "cleaned",
        refs: [{ type: "ledger", id: fid("receipt"), rev: 1 }],
      },
    ],
  },
};
