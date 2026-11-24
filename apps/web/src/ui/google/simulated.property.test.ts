/**
 * A simulated sheet offers no way out, Google half (brief 054 design, correctness property 21; R17.3, R17.4).
 * 1,000 runs.
 *   FOR ALL sequences of Google sheet events, among them status answers with and without `simulated`: the state's
 *   `simulated` is the mark of the last status answer the machine took (one that named the read in flight), absent
 *   before any and after a reset; while it is set, `canConnectGoogle` is false and neither a Connect nor a Disconnect
 *   press sends anything to the server; and a later answer without it clears it.
 */
import type { GoogleView } from "@franki/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type GoogleEvent, type GoogleState, GOOGLE_CALLBACK_OUTCOMES, INITIAL_GOOGLE, canConnectGoogle, googleStep } from "./google-machine";

const RUNS = { numRuns: 1000 };

const part = fc.constantFrom("off", "connected", "expired") as fc.Arbitrary<GoogleView["mail"]>;
const view: fc.Arbitrary<GoogleView> = fc.record({ mail: part, calendar: part, needsReconnect: fc.boolean(), connected: fc.boolean() }).map(({ mail, calendar, needsReconnect, connected }) => ({
  email: mail === "off" && calendar === "off" ? null : "jeffrey@kisses.example",
  mail,
  calendar,
  needsReconnect,
  connectedAt: connected ? "2026-11-20T14:40:00.000Z" : null,
}));
const seq = fc.integer({ min: 0, max: 12 });
const at = fc.integer({ min: 0, max: 30 * 60_000 });

const statusAnswer = fc.oneof(
  fc.record({ google: view, simulated: fc.boolean() }).map(({ google, simulated }) => (simulated ? { ok: true as const, google, simulated: true as const } : { ok: true as const, google })),
  fc.constantFrom({ ok: false as const, why: "failed" as const }, { ok: false as const, why: "notConfigured" as const }),
);

const event: fc.Arbitrary<GoogleEvent> = fc.oneof(
  { weight: 3, arbitrary: at.map((t) => ({ kind: "opened", at: t }) as const) },
  at.map((t) => ({ kind: "closed", at: t }) as const),
  at.map((t) => ({ kind: "retry", at: t }) as const),
  { weight: 5, arbitrary: fc.record({ seq, answer: statusAnswer, at }).map((r) => ({ kind: "statusAnswered", ...r }) as const) },
  { weight: 3, arbitrary: fc.record({ popup: fc.boolean(), at }).map((r) => ({ kind: "connectPressed", ...r }) as const) },
  fc.record({ seq, at }).map(({ seq: q, at: t }) => ({ kind: "startAnswered", seq: q, answer: { ok: true, url: "https://accounts.google.com/o/oauth2/v2/auth?x=1" }, at: t }) as const),
  fc.record({ outcome: fc.constantFrom(...GOOGLE_CALLBACK_OUTCOMES), at }).map((r) => ({ kind: "callbackHeard", ...r }) as const),
  at.map((t) => ({ kind: "stopWaiting", at: t }) as const),
  { weight: 3, arbitrary: at.map((t) => ({ kind: "disconnectPressed", at: t }) as const) },
  at.map((t) => ({ kind: "disconnectNotNow", at: t }) as const),
  { weight: 2, arbitrary: at.map((t) => ({ kind: "disconnectYes", requestId: "req-off", at: t }) as const) },
  at.map((t) => ({ kind: "tick", at: t }) as const),
  fc.constant({ kind: "reset" } as const),
);

describe("Property 21 (Google): a simulated sheet offers no way out", () => {
  it("follows the last taken status answer's mark, and offers neither Connect nor Disconnect while it is set", () => {
    fc.assert(
      fc.property(fc.array(event, { maxLength: 40 }), (events) => {
        let s: GoogleState = INITIAL_GOOGLE;
        let expected = false;
        for (const e of events) {
          const before = s;
          const out = googleStep(s, e);
          s = out.state;
          if (e.kind === "reset") expected = false;
          else if (e.kind === "statusAnswered" && e.seq === before.statusAsk && e.answer.ok) expected = e.answer.simulated === true;
          expect(s.simulated === true).toBe(expected);
          // Present only when true: never a stored false.
          if (!expected) expect("simulated" in s).toBe(false);
          if (expected) expect(canConnectGoogle(s)).toBe(false);
          if (before.simulated === true && (e.kind === "connectPressed" || e.kind === "disconnectPressed")) {
            expect(out.commands.filter((c) => c.kind === "start" || c.kind === "disconnect" || c.kind === "navigate")).toEqual([]);
            expect(s.phase).toBe(before.phase);
          }
          // An ask can't stay open over a simulated connection, so a Yes has nothing to send.
          if (s.simulated === true) expect(s.phase).not.toBe("confirming");
        }
      }),
      RUNS,
    );
  });
});
