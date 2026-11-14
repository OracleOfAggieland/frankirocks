// The Google sheet's transitions (brief 049 part B, ui.google): every state and every event, each exit titled
// `<FROM> + <event> -> <TO> (<why>)`.
import { describe, expect, it } from "vitest";
import { GOOGLE_CONNECTED, GOOGLE_EXPIRED, GOOGLE_MAIL_ONLY, GOOGLE_OFF, GOOGLE_URL, googleAfter, googleShowing, googleSpecimens } from "../../app/specimens/_fixtures/google";
import {
  GOOGLE_AUTH_MAX_MS,
  GOOGLE_AUTH_POLL_MS,
  GOOGLE_CALLBACK_OUTCOMES,
  type GoogleCommand,
  type GoogleEvent,
  type GoogleState,
  INITIAL_GOOGLE,
  canConnectGoogle,
  googleBusy,
  googleStep,
} from "./google-machine";

const T = 1_000;

function run(events: GoogleEvent[], from: GoogleState = INITIAL_GOOGLE) {
  let s = from;
  const commands: GoogleCommand[] = [];
  for (const e of events) {
    const out = googleStep(s, e);
    s = out.state;
    commands.push(...out.commands);
  }
  return { s, commands };
}

const off = () => googleShowing(GOOGLE_OFF);
const connected = () => googleShowing(GOOGLE_CONNECTED);
const starting = () => googleAfter([{ kind: "connectPressed", popup: true, at: T }], off());
const authorizing = () => googleAfter([{ kind: "startAnswered", seq: 2, answer: { ok: true, url: GOOGLE_URL }, at: T }], starting());
const confirming = () => googleAfter([{ kind: "disconnectPressed", at: T }], connected());
const disconnecting = () => googleAfter([{ kind: "disconnectYes", requestId: "req-1", at: T }], confirming());

describe("ui.google: reading", () => {
  it("unread + opened -> reading (one status read, nothing before the first open)", () => {
    const { s, commands } = run([{ kind: "opened", at: T }]);
    expect(s.phase).toBe("reading");
    expect(s.open).toBe(true);
    expect(commands).toEqual([{ kind: "readStatus", seq: 1 }]);
  });

  it("reading + statusAnswered -> idle (shows the server's answer)", () => {
    expect(off().phase).toBe("idle");
    expect(connected().google).toEqual(GOOGLE_CONNECTED);
  });

  it("reading + status failed -> readFailed (says so; retry reads again)", () => {
    const failed = googleAfter([{ kind: "opened", at: T }, { kind: "statusAnswered", seq: 1, answer: { ok: false, why: "failed" }, at: T }]);
    expect(failed.phase).toBe("readFailed");
    const { s, commands } = run([{ kind: "retry", at: T }], failed);
    expect(s.phase).toBe("reading");
    expect(commands).toEqual([{ kind: "readStatus", seq: 2 }]);
  });

  it("reading + CONFIG -> notConfigured (no connect is offered; a later open reads again)", () => {
    const nc = googleAfter([{ kind: "opened", at: T }, { kind: "statusAnswered", seq: 1, answer: { ok: false, why: "notConfigured" }, at: T }]);
    expect(nc.phase).toBe("notConfigured");
    expect(canConnectGoogle(nc)).toBe(false);
    const again = run([{ kind: "closed", at: T }, { kind: "opened", at: T }], nc);
    expect(again.s.phase).toBe("reading");
    expect(again.commands).toEqual([{ kind: "readStatus", seq: 2 }]);
  });

  it("idle + a failed re-read -> idle (keeps the last answer)", () => {
    const s = googleAfter([{ kind: "opened", at: T }, { kind: "statusAnswered", seq: 2, answer: { ok: false, why: "failed" }, at: T }], connected());
    expect(s.phase).toBe("idle");
    expect(s.google).toEqual(GOOGLE_CONNECTED);
  });

  it("an answer with another seq changes nothing, and a second open while a read is out sends nothing", () => {
    const reading = googleAfter([{ kind: "opened", at: T }]);
    expect(googleStep(reading, { kind: "statusAnswered", seq: 9, answer: { ok: true, google: GOOGLE_CONNECTED }, at: T }).state).toBe(reading);
    expect(googleStep(reading, { kind: "opened", at: T }).commands).toEqual([]);
  });
});

describe("ui.google: connect", () => {
  it("idle + connectPressed with the window open -> starting (one start call)", () => {
    const { s, commands } = run([{ kind: "connectPressed", popup: true, at: T }], off());
    expect(s.phase).toBe("starting");
    expect(commands).toEqual([{ kind: "start", seq: 2 }]);
    expect(googleBusy(s)).toBe(true);
  });

  it("idle + connectPressed with the window blocked -> idle (popupBlocked; nothing sent)", () => {
    const { s, commands } = run([{ kind: "connectPressed", popup: false, at: T }], off());
    expect(s.phase).toBe("idle");
    expect(s.note).toBe("popupBlocked");
    expect(commands).toEqual([]);
  });

  it("connectPressed when nothing is missing closes the window it opened, and sends nothing", () => {
    const { s, commands } = run([{ kind: "connectPressed", popup: true, at: T }], connected());
    expect(s.phase).toBe("idle");
    expect(commands).toEqual([{ kind: "closePopup" }]);
  });

  it("is offered when off, when one part was not granted, and when a new sign-in is needed", () => {
    expect(canConnectGoogle(off())).toBe(true);
    expect(canConnectGoogle(googleShowing(GOOGLE_MAIL_ONLY))).toBe(true);
    expect(canConnectGoogle(googleShowing(GOOGLE_EXPIRED))).toBe(true);
    expect(canConnectGoogle(connected())).toBe(false);
  });

  it("starting + startAnswered -> authorizing (the URL rides on one navigate command and never in state)", () => {
    const { s, commands } = run([{ kind: "startAnswered", seq: 2, answer: { ok: true, url: GOOGLE_URL }, at: T }], starting());
    expect(s.phase).toBe("authorizing");
    expect(commands).toEqual([{ kind: "navigate", url: GOOGLE_URL }, { kind: "arm", ms: GOOGLE_AUTH_POLL_MS }, { kind: "arm", ms: GOOGLE_AUTH_MAX_MS }]);
    expect(JSON.stringify(s)).not.toContain("accounts.google.com");
  });

  it("starting + start failed -> idle (startFailed; the window closes)", () => {
    const { s, commands } = run([{ kind: "startAnswered", seq: 2, answer: { ok: false, why: "failed" }, at: T }], starting());
    expect(s.phase).toBe("idle");
    expect(s.note).toBe("startFailed");
    expect(commands).toEqual([{ kind: "closePopup" }]);
  });

  it("starting + start CONFIG -> notConfigured (the window closes)", () => {
    const { s, commands } = run([{ kind: "startAnswered", seq: 2, answer: { ok: false, why: "notConfigured" }, at: T }], starting());
    expect(s.phase).toBe("notConfigured");
    expect(commands).toEqual([{ kind: "closePopup" }]);
  });

  it("a start answer with another seq changes nothing", () => {
    const s = starting();
    expect(googleStep(s, { kind: "startAnswered", seq: 7, answer: { ok: true, url: GOOGLE_URL }, at: T }).state).toBe(s);
  });

  for (const outcome of GOOGLE_CALLBACK_OUTCOMES) {
    it(`authorizing + callbackHeard ${outcome} -> idle (closes the window, reads the status again)`, () => {
      const { s, commands } = run([{ kind: "callbackHeard", outcome, at: T }], authorizing());
      expect(s.phase).toBe("idle");
      expect(s.note).toBe(outcome === "unknown" ? "connectUnknown" : outcome);
      expect(commands).toEqual([{ kind: "closePopup" }, { kind: "readStatus", seq: 3 }]);
      expect(s.authUntil).toBeNull();
      expect(s.pollAt).toBeNull();
    });
  }

  it("the callback's word changes nothing outside authorizing", () => {
    for (const s of [off(), connected(), starting(), confirming()]) expect(googleStep(s, { kind: "callbackHeard", outcome: "connected", at: T }).state).toBe(s);
  });

  it("authorizing + tick at the poll -> authorizing (one backup status read, the next one armed)", () => {
    const { s, commands } = run([{ kind: "tick", at: T + GOOGLE_AUTH_POLL_MS }], authorizing());
    expect(s.phase).toBe("authorizing");
    expect(commands).toEqual([{ kind: "arm", ms: GOOGLE_AUTH_POLL_MS }, { kind: "readStatus", seq: 3 }]);
    // A second tick while that read is out arms again but sends no second read.
    const again = run([{ kind: "tick", at: T + 2 * GOOGLE_AUTH_POLL_MS }], s);
    expect(again.commands).toEqual([{ kind: "arm", ms: GOOGLE_AUTH_POLL_MS }]);
  });

  it("authorizing + a status read showing a newer connection -> idle (connected; the window closes)", () => {
    const polled = googleAfter([{ kind: "tick", at: T + GOOGLE_AUTH_POLL_MS }], authorizing());
    const { s, commands } = run([{ kind: "statusAnswered", seq: 3, answer: { ok: true, google: GOOGLE_CONNECTED }, at: T }], polled);
    expect(s.phase).toBe("idle");
    expect(s.note).toBe("connected");
    expect(commands).toEqual([{ kind: "closePopup" }, { kind: "readStatus", seq: 4 }]);
  });

  it("authorizing + a status read showing the same connection -> authorizing (still waiting)", () => {
    const from = googleAfter([{ kind: "connectPressed", popup: true, at: T }, { kind: "startAnswered", seq: 2, answer: { ok: true, url: GOOGLE_URL }, at: T }, { kind: "tick", at: T + GOOGLE_AUTH_POLL_MS }], googleShowing(GOOGLE_MAIL_ONLY));
    const { s } = run([{ kind: "statusAnswered", seq: 3, answer: { ok: true, google: GOOGLE_MAIL_ONLY }, at: T }], from);
    expect(s.phase).toBe("authorizing");
  });

  it("authorizing + tick at the deadline -> idle (timedOut; the window closes)", () => {
    const { s, commands } = run([{ kind: "tick", at: T + GOOGLE_AUTH_MAX_MS }], authorizing());
    expect(s.phase).toBe("idle");
    expect(s.note).toBe("timedOut");
    expect(commands[0]).toEqual({ kind: "closePopup" });
  });

  it("authorizing + stopWaiting -> idle (stopped; the window closes)", () => {
    const { s, commands } = run([{ kind: "stopWaiting", at: T }], authorizing());
    expect(s.phase).toBe("idle");
    expect(s.note).toBe("stopped");
    expect(commands[0]).toEqual({ kind: "closePopup" });
  });

  it("a tick before any deadline, or outside authorizing, does nothing", () => {
    const a = authorizing();
    expect(googleStep(a, { kind: "tick", at: T + 1 }).state).toBe(a);
    const o = off();
    expect(googleStep(o, { kind: "tick", at: T + GOOGLE_AUTH_MAX_MS }).state).toBe(o);
  });

  it("closing the sheet while authorizing keeps waiting", () => {
    const { s } = run([{ kind: "closed", at: T }], authorizing());
    expect(s.phase).toBe("authorizing");
    expect(s.open).toBe(false);
  });
});

describe("ui.google: disconnect", () => {
  it("idle + disconnectPressed -> confirming (asks; sends nothing)", () => {
    const { s, commands } = run([{ kind: "disconnectPressed", at: T }], connected());
    expect(s.phase).toBe("confirming");
    expect(commands).toEqual([]);
  });

  it("disconnect is asked only when something is held", () => {
    const o = off();
    expect(googleStep(o, { kind: "disconnectPressed", at: T }).state).toBe(o);
    expect(googleStep(googleShowing(GOOGLE_EXPIRED), { kind: "disconnectPressed", at: T }).state.phase).toBe("confirming");
  });

  it("confirming + Not now, or closed -> idle (nothing sent)", () => {
    expect(run([{ kind: "disconnectNotNow", at: T }], confirming())).toMatchObject({ s: { phase: "idle" }, commands: [] });
    expect(run([{ kind: "closed", at: T }], confirming())).toMatchObject({ s: { phase: "idle" }, commands: [] });
  });

  it("confirming + Yes -> disconnecting (one disconnect with the new request ID)", () => {
    const { s, commands } = run([{ kind: "disconnectYes", requestId: "req-1", at: T }], confirming());
    expect(s.phase).toBe("disconnecting");
    expect(commands).toEqual([{ kind: "disconnect", seq: 2, requestId: "req-1" }]);
  });

  it("disconnecting + answered -> idle (shows the server's answer)", () => {
    const { s, commands } = run([{ kind: "disconnectAnswered", seq: 2, answer: { ok: true, google: GOOGLE_OFF }, at: T }], disconnecting());
    expect(s.phase).toBe("idle");
    expect(s.note).toBe("disconnected");
    expect(s.google).toEqual(GOOGLE_OFF);
    expect(commands).toEqual([]);
  });

  it("disconnecting + failed or unknown -> idle (keeps the connection shown, reads again)", () => {
    for (const why of ["failed", "unknown"] as const) {
      const { s, commands } = run([{ kind: "disconnectAnswered", seq: 2, answer: { ok: false, why }, at: T }], disconnecting());
      expect(s.phase).toBe("idle");
      expect(s.google).toEqual(GOOGLE_CONNECTED);
      expect(s.note).toBe(why === "failed" ? "disconnectFailed" : "disconnectUnknown");
      expect(commands).toEqual([{ kind: "readStatus", seq: 3 }]);
    }
  });

  it("confirming + a status read showing nothing held -> idle (the ask goes)", () => {
    const c = googleAfter([{ kind: "opened", at: T }], confirming());
    const { s } = run([{ kind: "statusAnswered", seq: 2, answer: { ok: true, google: GOOGLE_OFF }, at: T }], c);
    expect(s.phase).toBe("idle");
  });
});

describe("ui.google: totality and reset", () => {
  const events: GoogleEvent[] = [
    { kind: "opened", at: T },
    { kind: "closed", at: T },
    { kind: "retry", at: T },
    { kind: "statusAnswered", seq: 1, answer: { ok: true, google: GOOGLE_CONNECTED }, at: T },
    { kind: "connectPressed", popup: true, at: T },
    { kind: "connectPressed", popup: false, at: T },
    { kind: "startAnswered", seq: 2, answer: { ok: true, url: GOOGLE_URL }, at: T },
    { kind: "callbackHeard", outcome: "connected", at: T },
    { kind: "stopWaiting", at: T },
    { kind: "disconnectPressed", at: T },
    { kind: "disconnectNotNow", at: T },
    { kind: "disconnectYes", requestId: "req-9", at: T },
    { kind: "disconnectAnswered", seq: 2, answer: { ok: false, why: "unknown" }, at: T },
    { kind: "tick", at: T + GOOGLE_AUTH_MAX_MS },
  ];

  it("every event is defined in every specimen state, and reset returns to the start from each", () => {
    for (const { state } of googleSpecimens()) {
      for (const e of events) expect(() => googleStep(state, e)).not.toThrow();
      expect(googleStep(state, { kind: "reset" })).toEqual({ state: INITIAL_GOOGLE, commands: [] });
    }
  });

  it("no state ever holds a URL, a code or a token", () => {
    for (const { state } of googleSpecimens()) expect(JSON.stringify(state)).not.toMatch(/https?:|code|token/i);
  });
});
