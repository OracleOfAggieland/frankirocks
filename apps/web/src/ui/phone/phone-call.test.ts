import { PHONE_STATUSES, type PhoneStatus } from "@franki/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  INITIAL_PHONE,
  PHONE_DIAL_LIMIT_MS,
  PHONE_LINGER_MS,
  PHONE_MAX_MS,
  PHONE_UNKNOWN_LIMIT,
  type PhoneCallState,
  type PhoneEvent,
  phonePolls,
  phoneShows,
  phoneStep,
} from "./phone-call";

const A = { sessionId: "s1", turnId: "t1" };
const B = { sessionId: "s1", turnId: "t2" };

const run = (events: PhoneEvent[], from: PhoneCallState = INITIAL_PHONE) => events.reduce(phoneStep, from);
const status = (s: PhoneStatus, at: number, call = A): PhoneEvent => ({ kind: "status", call, status: s, at });

describe("phoneStep: a spoken request", () => {
  it("shows the phone dialing as soon as the tool call is out", () => {
    const s = run([{ kind: "requested", call: A, at: 100 }]);
    expect(s).toMatchObject({ phase: "dialing", call: A, toolPending: true, startedAt: 100, since: 100 });
    expect(phoneShows(s)).toBe(true);
    expect(phonePolls(s)).toBe(true);
  });

  it("walks dialing, ringing, talking, ended, then leaves after the linger", () => {
    let s = run([{ kind: "requested", call: A, at: 0 }, { kind: "settled", at: 500 }, status("dialing", 600)]);
    expect(s.phase).toBe("dialing");
    s = phoneStep(s, status("ringing", 2_000));
    expect(s).toMatchObject({ phase: "ringing", since: 2_000 });
    s = phoneStep(s, status("talking", 9_000));
    expect(s.phase).toBe("talking");
    s = phoneStep(s, status("ended", 40_000));
    expect(s).toMatchObject({ phase: "ended", since: 40_000 });
    expect(phonePolls(s)).toBe(false);
    expect(phoneStep(s, { kind: "tick", at: 40_000 + PHONE_LINGER_MS - 1 }).phase).toBe("ended");
    expect(phoneStep(s, { kind: "tick", at: 40_000 + PHONE_LINGER_MS })).toBe(INITIAL_PHONE);
  });

  it("keeps dialing on `none` while the tool call is out, and takes the phone down on `none` after it settles", () => {
    const out = run([{ kind: "requested", call: A, at: 0 }, status("none", 100)]);
    expect(out.phase).toBe("dialing");
    expect(run([{ kind: "settled", at: 200 }, status("none", 300)], out)).toBe(INITIAL_PHONE);
  });

  it("shows each way a call is missed, with its reason", () => {
    for (const reason of ["busy", "noAnswer", "failed"] as const) {
      const s = run([{ kind: "requested", call: A, at: 0 }, { kind: "settled", at: 1 }, status(reason, 2)]);
      expect(s).toMatchObject({ phase: "missed", reason });
      expect(phonePolls(s)).toBe(false);
    }
  });

  it("gives up as unconfirmed after enough unknown answers in a row, and an answer in between resets the count", () => {
    let s = run([{ kind: "requested", call: A, at: 0 }, { kind: "settled", at: 1 }]);
    for (let i = 0; i < PHONE_UNKNOWN_LIMIT - 1; i++) s = phoneStep(s, status("unknown", 10 + i));
    expect(s.phase).toBe("dialing");
    const reset = phoneStep(s, status("ringing", 50));
    expect(reset).toMatchObject({ phase: "ringing", unknowns: 0 });
    expect(phoneStep(s, status("unknown", 60))).toMatchObject({ phase: "missed", reason: "unconfirmed" });
  });

  it("never brings an ended call back for a late answer", () => {
    const ended = run([{ kind: "requested", call: A, at: 0 }, status("ended", 10)]);
    for (const late of PHONE_STATUSES) expect(phoneStep(ended, status(late, 20))).toBe(ended);
  });

  it("ignores an answer for another call, and the same request published again", () => {
    const s = run([{ kind: "requested", call: A, at: 0 }]);
    expect(phoneStep(s, status("talking", 5, B))).toBe(s);
    expect(phoneStep(s, { kind: "requested", call: A, at: 9 })).toBe(s);
  });

  it("a new request replaces the call on the screen", () => {
    const s = run([{ kind: "requested", call: A, at: 0 }, status("talking", 5), { kind: "requested", call: B, at: 100 }]);
    expect(s).toMatchObject({ phase: "dialing", call: B, startedAt: 100, toolPending: true });
  });

  it("stops showing a dial that never lands, and never follows a call past the limit", () => {
    const stuck = run([{ kind: "requested", call: A, at: 0 }]);
    expect(phoneStep(stuck, { kind: "tick", at: PHONE_DIAL_LIMIT_MS - 1 }).phase).toBe("dialing");
    expect(phoneStep(stuck, { kind: "tick", at: PHONE_DIAL_LIMIT_MS })).toMatchObject({ phase: "missed", reason: "unconfirmed" });
    const long = run([{ kind: "requested", call: A, at: 0 }, status("talking", 10)]);
    expect(phoneStep(long, { kind: "tick", at: PHONE_MAX_MS - 1 }).phase).toBe("talking");
    expect(phoneStep(long, { kind: "tick", at: PHONE_MAX_MS })).toBe(INITIAL_PHONE);
  });
});

describe("phoneStep: a typed turn", () => {
  it("stays off the screen until the server says there is a call", () => {
    const probe = run([{ kind: "probe", call: A, at: 0 }]);
    expect(phoneShows(probe)).toBe(false);
    expect(phonePolls(probe)).toBe(true);
    expect(phoneStep(probe, status("none", 10))).toBe(INITIAL_PHONE);
    expect(phoneStep(probe, status("dialing", 10))).toMatchObject({ phase: "dialing", call: A });
    expect(phoneStep(probe, status("ringing", 10)).phase).toBe("ringing");
  });

  it("shows nothing for a call that was already over, declined or unreadable when first read", () => {
    const probe = run([{ kind: "probe", call: A, at: 0 }]);
    for (const s of ["ended", "busy", "noAnswer", "failed"] as const) expect(phoneStep(probe, status(s, 10))).toBe(INITIAL_PHONE);
    let unread = probe;
    for (let i = 0; i < PHONE_UNKNOWN_LIMIT; i++) unread = phoneStep(unread, status("unknown", 10 + i));
    expect(unread).toBe(INITIAL_PHONE);
    expect(phoneStep(probe, { kind: "tick", at: PHONE_DIAL_LIMIT_MS })).toBe(INITIAL_PHONE);
  });

  it("never drops a live call for the next typed line", () => {
    const live = run([{ kind: "probe", call: A, at: 0 }, status("talking", 10)]);
    expect(phoneStep(live, { kind: "probe", call: B, at: 20 })).toBe(live);
    const over = phoneStep(live, status("ended", 30));
    expect(phoneStep(over, { kind: "probe", call: B, at: 40 })).toMatchObject({ phase: "absent", call: B });
  });
});

describe("phoneStep: every event in every state", () => {
  const arbCall = fc.constantFrom(A, B);
  const arbEvent: fc.Arbitrary<(at: number) => PhoneEvent> = fc.oneof(
    arbCall.map((call) => (at: number): PhoneEvent => ({ kind: "requested", call, at })),
    arbCall.map((call) => (at: number): PhoneEvent => ({ kind: "probe", call, at })),
    fc.constant((at: number): PhoneEvent => ({ kind: "settled", at })),
    fc.constant((at: number): PhoneEvent => ({ kind: "tick", at })),
    fc.constant((): PhoneEvent => ({ kind: "reset" })),
    fc.tuple(arbCall, fc.constantFrom(...PHONE_STATUSES)).map(([call, s]) => (at: number): PhoneEvent => ({ kind: "status", call, status: s, at })),
  );
  const arbWalk = fc.array(fc.tuple(arbEvent, fc.integer({ min: 0, max: 30_000 })), { maxLength: 60 });

  it("holds its invariants on any walk", () => {
    fc.assert(
      fc.property(arbWalk, (steps) => {
        let s: PhoneCallState = INITIAL_PHONE;
        let at = 0;
        for (const [make, dt] of steps) {
          at += dt;
          const before = s;
          s = phoneStep(s, make(at));
          // Nothing tracked is exactly the initial state, and only then is nothing read.
          if (s.call === null) expect(s).toBe(INITIAL_PHONE);
          expect(phoneShows(s) && s.call === null).toBe(false);
          // A reason goes with a missed call and nothing else.
          expect(s.reason !== null).toBe(s.phase === "missed");
          // An over call is never read again, and only a new request, a probe, a tick or a reset moves it.
          if (before.phase === "ended" || before.phase === "missed") {
            const e = make(at);
            if (e.kind === "status" || e.kind === "settled") expect(s).toBe(before);
          }
          expect(s.since).toBeLessThanOrEqual(at);
        }
      }),
      { numRuns: 500 },
    );
  });

  it("reset clears everything from any state", () => {
    fc.assert(
      fc.property(arbWalk, (steps) => {
        let s: PhoneCallState = INITIAL_PHONE;
        let at = 0;
        for (const [make, dt] of steps) s = phoneStep(s, make((at += dt)));
        expect(phoneStep(s, { kind: "reset" })).toBe(INITIAL_PHONE);
      }),
    );
  });
});
