/**
 * A simulated sheet offers no way out, bank half (brief 054 design, correctness property 21; R17.3, R17.4).
 * 1,000 runs.
 *   FOR ALL sequences of bank sheet events, among them status answers with and without `simulated`: the state's
 *   `simulated` is the mark of the last status answer the machine took (one that named the read in flight), absent
 *   before any and after a reset; while it is set, `canStartLink` is false and neither a Connect nor a Disconnect
 *   press sends anything; and a later answer without it clears it.
 */
import type { BankView } from "@franki/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type BankEvent, type BankState, INITIAL_BANK, bankStep, canStartLink } from "./bank-machine";

const RUNS = { numRuns: 1000 };

const bankView = (id: string, importing: boolean): BankView => ({
  connectorId: id,
  institutionName: "Lantern Vault Savings",
  state: importing ? "syncing" : "connected",
  importing,
  accounts: [{ name: "Everyday checking", mask: "0001", type: "depository", subtype: "checking" }],
  lastSyncedAt: null,
  coveredFrom: null,
  coveredTo: null,
  needsReconnect: false,
});

const IDS = ["bankAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "bankBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"] as const;
const banks = fc.array(fc.record({ id: fc.constantFrom(...IDS), importing: fc.boolean() }), { maxLength: 2 }).map((bs) => bs.map((b) => bankView(b.id, b.importing)));
const seq = fc.integer({ min: 0, max: 12 });
const at = fc.integer({ min: 0, max: 30 * 60_000 });

const statusAnswer = fc.oneof(
  fc.record({ banks, canConnect: fc.boolean(), simulated: fc.boolean() }).map(({ banks: b, canConnect, simulated }) => (simulated ? { ok: true as const, banks: b, canConnect, simulated: true as const } : { ok: true as const, banks: b, canConnect })),
  fc.constant({ ok: false as const }),
);

const event: fc.Arbitrary<BankEvent> = fc.oneof(
  { weight: 3, arbitrary: at.map((t) => ({ kind: "opened", at: t }) as const) },
  at.map((t) => ({ kind: "closed", at: t }) as const),
  at.map((t) => ({ kind: "retry", at: t }) as const),
  { weight: 5, arbitrary: fc.record({ seq, answer: statusAnswer, at }).map((r) => ({ kind: "statusAnswered", ...r }) as const) },
  { weight: 3, arbitrary: at.map((t) => ({ kind: "connectPressed", at: t }) as const) },
  fc.record({ seq, at, linkToken: fc.constantFrom("link-1", "link-2") }).map(({ seq: q, at: t, linkToken }) => ({ kind: "tokenAnswered", seq: q, answer: { ok: true, linkToken }, at: t }) as const),
  fc.record({ seq, at }).map(({ seq: q, at: t }) => ({ kind: "linkSuccess", session: q, success: { publicToken: "public-1", institutionId: null, institutionName: null }, requestId: "req-link", at: t }) as const),
  fc.record({ seq, at, id: fc.constantFrom(...IDS) }).map(({ seq: q, at: t, id }) => ({ kind: "syncAnswered", seq: q, connectorId: id, answer: { ok: true, bank: bankView(id, false) }, at: t }) as const),
  { weight: 3, arbitrary: fc.record({ at, id: fc.constantFrom(...IDS) }).map(({ at: t, id }) => ({ kind: "disconnectPressed", connectorId: id, at: t }) as const) },
  at.map((t) => ({ kind: "disconnectNotNow", at: t }) as const),
  { weight: 2, arbitrary: at.map((t) => ({ kind: "disconnectYes", requestId: "req-off", at: t }) as const) },
  at.map((t) => ({ kind: "tick", at: t }) as const),
  fc.constant({ kind: "reset" } as const),
);

describe("Property 21 (bank): a simulated sheet offers no way out", () => {
  it("follows the last taken status answer's mark, and offers neither Connect nor Disconnect while it is set", () => {
    fc.assert(
      fc.property(fc.array(event, { maxLength: 40 }), (events) => {
        let s: BankState = INITIAL_BANK;
        let expected = false;
        for (const e of events) {
          const before = s;
          const out = bankStep(s, e);
          s = out.state;
          if (e.kind === "reset") expected = false;
          else if (e.kind === "statusAnswered" && e.seq === before.statusAsk && e.answer.ok) expected = e.answer.simulated === true;
          expect(s.simulated === true).toBe(expected);
          // Present only when true: never a stored false.
          if (!expected) expect("simulated" in s).toBe(false);
          if (expected) expect(canStartLink(s)).toBe(false);
          if (before.simulated === true && (e.kind === "connectPressed" || e.kind === "disconnectPressed")) {
            expect(out.commands.filter((c) => c.kind === "requestLinkToken" || c.kind === "disconnect")).toEqual([]);
            expect(s.phase).toBe(before.phase);
          }
          // An ask can't stay open over a simulated bank, so a Yes has nothing to send.
          if (s.simulated === true) expect(s.phase).not.toBe("confirming");
        }
      }),
      RUNS,
    );
  });
});
