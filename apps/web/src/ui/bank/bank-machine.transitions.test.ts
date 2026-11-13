// The bank sheet's transitions (brief 046 part B, ui.bank): every state and every event, each exit titled
// `<FROM> + <event> -> <TO> (<why>)`.
import { describe, expect, it } from "vitest";
import { BANK_DISCONNECTED, BANK_EXPIRED, BANK_IMPORTING, BANK_READ, bankAfter, bankShowing } from "../../app/specimens/_fixtures/bank";
import {
  BANK_LINK_OPEN_MS,
  BANK_POLL_MAX_MS,
  BANK_POLL_MS,
  BANK_SYNC_FAILURE_LIMIT,
  type BankCommand,
  type BankEvent,
  type BankPhase,
  type BankState,
  INITIAL_BANK,
  bankBusy,
  bankPolls,
  bankStep,
  canStartLink,
  importingIds,
} from "./bank-machine";

const T = 1_000;

function run(events: BankEvent[], from: BankState = INITIAL_BANK) {
  let s = from;
  const commands: BankCommand[] = [];
  for (const e of events) {
    const out = bankStep(s, e);
    s = out.state;
    commands.push(...out.commands);
  }
  return { s, commands };
}

const none = () => bankShowing([]);
const read = () => bankShowing([BANK_READ]);
const preparing = () => bankAfter([{ kind: "connectPressed", at: T }], none());
const linking = () => bankAfter([{ kind: "tokenAnswered", seq: 2, answer: { ok: true, linkToken: "link-1" }, at: T }], preparing());
const success = { publicToken: "public-1", institutionId: "ins_1", institutionName: "Hollow Creek Bank" };
const connecting = () => bankAfter([{ kind: "linkSuccess", session: 2, success, requestId: "req-1", at: T }], linking());
const confirming = () => bankAfter([{ kind: "disconnectPressed", connectorId: BANK_READ.connectorId, at: T }], read());
const disconnecting = () => bankAfter([{ kind: "disconnectYes", requestId: "req-2", at: T }], confirming());

describe("ui.bank: opening and reading", () => {
  it("UNREAD + opened -> READING (the first open reads the list; nothing is sent before it)", () => {
    expect(INITIAL_BANK.phase).toBe("unread");
    const { s, commands } = run([{ kind: "opened", at: T }]);
    expect(s.phase).toBe("reading");
    expect(s.open).toBe(true);
    expect(commands).toEqual([{ kind: "readStatus", seq: 1 }]);
  });

  it("READING + statusAnswered -> IDLE (the list is what the server answered)", () => {
    const s = read();
    expect(s.phase).toBe("idle");
    expect(s.banks).toEqual([BANK_READ]);
    expect(s.canConnect).toBe(true);
    expect(canStartLink(s)).toBe(true);
  });

  it("READING + statusAnswered failed -> READ_FAILED (says so, shows no banks)", () => {
    const { s } = run([{ kind: "opened", at: T }, { kind: "statusAnswered", seq: 1, answer: { ok: false }, at: T }]);
    expect(s.phase).toBe("readFailed");
    expect(s.banks).toBeNull();
    expect(canStartLink(s)).toBe(false);
  });

  it("READING + statusAnswered with another seq -> READING (a stale answer changes nothing)", () => {
    const { s } = run([{ kind: "opened", at: T }, { kind: "statusAnswered", seq: 9, answer: { ok: true, banks: [BANK_READ], canConnect: true }, at: T }]);
    expect(s.phase).toBe("reading");
    expect(s.banks).toBeNull();
  });

  it("READ_FAILED + retry -> READING (Try again reads once more)", () => {
    const failed = bankAfter([{ kind: "opened", at: T }, { kind: "statusAnswered", seq: 1, answer: { ok: false }, at: T }]);
    const { s, commands } = run([{ kind: "retry", at: T }], failed);
    expect(s.phase).toBe("reading");
    expect(commands).toEqual([{ kind: "readStatus", seq: 2 }]);
  });

  it("READ_FAILED + opened -> READING (opening again reads again)", () => {
    const failed = bankAfter([{ kind: "opened", at: T }, { kind: "statusAnswered", seq: 1, answer: { ok: false }, at: T }, { kind: "closed", at: T }]);
    const { s, commands } = run([{ kind: "opened", at: T }], failed);
    expect(s.phase).toBe("reading");
    expect(commands).toEqual([{ kind: "readStatus", seq: 2 }]);
  });

  it("IDLE + retry -> IDLE (only a failed first read retries)", () => {
    expect(run([{ kind: "retry", at: T }], read()).commands).toEqual([]);
  });

  it("IDLE + opened -> IDLE (every open reads the list again, and drops the last note)", () => {
    const closed = { ...bankAfter([{ kind: "closed", at: T }], read()), note: "connected" as const };
    const { s, commands } = run([{ kind: "opened", at: T }], closed);
    expect(s.phase).toBe("idle");
    expect(s.note).toBeNull();
    expect(commands).toEqual([{ kind: "readStatus", seq: 2 }]);
  });

  it("IDLE + statusAnswered failed -> IDLE (a failed re-read keeps the last answer)", () => {
    const reopened = bankAfter([{ kind: "opened", at: T }], read());
    const { s } = run([{ kind: "statusAnswered", seq: 2, answer: { ok: false }, at: T }], reopened);
    expect(s.phase).toBe("idle");
    expect(s.banks).toEqual([BANK_READ]);
  });

  it("IDLE + closed -> IDLE (closing keeps what was answered, and sends nothing)", () => {
    const { s, commands } = run([{ kind: "closed", at: T }], read());
    expect(s.open).toBe(false);
    expect(s.phase).toBe("idle");
    expect(commands).toEqual([]);
  });

  it("READING + closed -> READING (the read still lands)", () => {
    const { s } = run([{ kind: "opened", at: T }, { kind: "closed", at: T }, { kind: "statusAnswered", seq: 1, answer: { ok: true, banks: [], canConnect: true }, at: T }]);
    expect(s.phase).toBe("idle");
    expect(s.open).toBe(false);
  });

  it("any + reset -> UNREAD (sign-out drops every bank this client holds)", () => {
    for (const from of [read(), linking(), connecting(), confirming(), disconnecting()]) {
      const { s, commands } = run([{ kind: "reset" }], from);
      expect(s).toEqual(INITIAL_BANK);
      expect(commands).toEqual([]);
    }
  });
});

describe("ui.bank: connecting", () => {
  it("IDLE + connectPressed -> PREPARING (asks for a Link token)", () => {
    const { s, commands } = run([{ kind: "connectPressed", at: T }], none());
    expect(s.phase).toBe("preparing");
    expect(bankBusy(s)).toBe(true);
    expect(commands).toEqual([{ kind: "requestLinkToken", seq: 2 }]);
  });

  it("IDLE + connectPressed at the limit -> IDLE (no Link when the server said no more fit)", () => {
    const full = bankShowing([BANK_READ], false);
    expect(run([{ kind: "connectPressed", at: T }], full)).toEqual({ s: full, commands: [] });
  });

  it("UNREAD + connectPressed -> UNREAD (nothing is offered before the list is known)", () => {
    expect(run([{ kind: "connectPressed", at: T }]).commands).toEqual([]);
  });

  it("PREPARING + tokenAnswered -> LINKING (Link opens with the token; its opening is timed)", () => {
    const { s, commands } = run([{ kind: "tokenAnswered", seq: 2, answer: { ok: true, linkToken: "link-1" }, at: T }], preparing());
    expect(s.phase).toBe("linking");
    expect(s.link).toEqual({ session: 2, linkToken: "link-1" });
    expect(s.linkAt).toBe(T + BANK_LINK_OPEN_MS);
    expect(commands).toEqual([{ kind: "arm", ms: BANK_LINK_OPEN_MS }]);
  });

  it("PREPARING + tokenAnswered limit -> IDLE (limit reached: a plain line, and no more Connect)", () => {
    const { s } = run([{ kind: "tokenAnswered", seq: 2, answer: { ok: false, why: "limit" }, at: T }], preparing());
    expect(s.phase).toBe("idle");
    expect(s.note).toBe("limit");
    expect(s.canConnect).toBe(false);
    expect(canStartLink(s)).toBe(false);
  });

  it("PREPARING + tokenAnswered failed -> IDLE (a plain line; Connect stays)", () => {
    const { s } = run([{ kind: "tokenAnswered", seq: 2, answer: { ok: false, why: "failed" }, at: T }], preparing());
    expect(s.phase).toBe("idle");
    expect(s.note).toBe("tokenFailed");
    expect(canStartLink(s)).toBe(true);
  });

  it("PREPARING + tokenAnswered with another seq -> PREPARING (stale)", () => {
    expect(run([{ kind: "tokenAnswered", seq: 7, answer: { ok: true, linkToken: "x" }, at: T }], preparing()).s.phase).toBe("preparing");
  });

  it("LINKING + linkOpened -> LINKING (Link said it is open; the open timer no longer ends it)", () => {
    const { s } = run([{ kind: "linkOpened", session: 2, at: T }, { kind: "tick", at: T + BANK_LINK_OPEN_MS }], linking());
    expect(s.phase).toBe("linking");
    expect(s.linkAt).toBeNull();
  });

  it("LINKING + tick past the open limit -> IDLE (Link never opened: a plain line)", () => {
    const { s } = run([{ kind: "tick", at: T + BANK_LINK_OPEN_MS - 1 }], linking());
    expect(s.phase).toBe("linking");
    const late = run([{ kind: "tick", at: T + BANK_LINK_OPEN_MS }], linking()).s;
    expect(late.phase).toBe("idle");
    expect(late.note).toBe("linkFailed");
    expect(late.link).toBeNull();
  });

  it("LINKING + linkExit -> IDLE (the owner closed Link: a calm line, Connect again)", () => {
    const { s, commands } = run([{ kind: "linkExit", session: 2, error: false, at: T }], linking());
    expect(s.phase).toBe("idle");
    expect(s.note).toBe("linkClosed");
    expect(s.link).toBeNull();
    expect(commands).toEqual([]);
    expect(canStartLink(s)).toBe(true);
  });

  it("LINKING + linkExit with an error -> IDLE (never Plaid's words, one plain line)", () => {
    expect(run([{ kind: "linkExit", session: 2, error: true, at: T }], linking()).s.note).toBe("linkFailed");
  });

  it("LINKING + linkExit from another session -> LINKING (a late exit changes nothing)", () => {
    expect(run([{ kind: "linkExit", session: 1, error: false, at: T }], linking()).s.phase).toBe("linking");
  });

  it("LINKING + linkSuccess -> CONNECTING (the public token goes to connect once, with the new requestId)", () => {
    const { s, commands } = run([{ kind: "linkSuccess", session: 2, success, requestId: "req-1", at: T }], linking());
    expect(s.phase).toBe("connecting");
    expect(s.link).toBeNull();
    expect(commands).toEqual([{ kind: "connect", seq: 3, requestId: "req-1", ...success }]);
    expect(JSON.stringify(s)).not.toContain("public-1");
  });

  it("CONNECTING + connectAnswered -> IDLE (the bank shows as answered, then the list is read again)", () => {
    const { s, commands } = run([{ kind: "connectAnswered", seq: 3, answer: { ok: true, bank: BANK_IMPORTING, existing: false }, at: T }], connecting());
    expect(s.phase).toBe("idle");
    expect(s.note).toBe("connected");
    expect(s.banks).toEqual([BANK_IMPORTING]);
    expect(commands).toEqual([{ kind: "arm", ms: BANK_POLL_MS }, { kind: "readStatus", seq: 4 }]);
  });

  it("CONNECTING + connectAnswered existing -> IDLE (the same bank twice says so)", () => {
    expect(run([{ kind: "connectAnswered", seq: 3, answer: { ok: true, bank: BANK_READ, existing: true }, at: T }], connecting()).s.note).toBe("alreadyConnected");
  });

  it("CONNECTING + connectAnswered refused -> IDLE (connect refused: never sent again; a new Link is the way)", () => {
    const { s, commands } = run([{ kind: "connectAnswered", seq: 3, answer: { ok: false, why: "refused" }, at: T }], connecting());
    expect(s.phase).toBe("idle");
    expect(s.note).toBe("connectRefused");
    expect(commands).toEqual([]);
    // Connect again starts from a new token, never the old public token.
    const again = run([{ kind: "connectPressed", at: T }], s).commands;
    expect(again).toEqual([{ kind: "requestLinkToken", seq: 4 }]);
  });

  it("CONNECTING + connectAnswered unknown -> IDLE (no answer: the list is read for what is true)", () => {
    const { s, commands } = run([{ kind: "connectAnswered", seq: 3, answer: { ok: false, why: "unknown" }, at: T }], connecting());
    expect(s.note).toBe("connectUnknown");
    expect(commands).toEqual([{ kind: "readStatus", seq: 4 }]);
  });

  it("CONNECTING + connectAnswered limit -> IDLE (limit reached between the token and the connect)", () => {
    const { s } = run([{ kind: "connectAnswered", seq: 3, answer: { ok: false, why: "limit" }, at: T }], connecting());
    expect(s.note).toBe("limit");
    expect(s.canConnect).toBe(false);
  });

  it("CONNECTING + connectAnswered with another seq -> CONNECTING (stale)", () => {
    expect(run([{ kind: "connectAnswered", seq: 99, answer: { ok: false, why: "refused" }, at: T }], connecting()).s.phase).toBe("connecting");
  });

  it("CONNECTING + closed -> CONNECTING (closing the sheet does not drop the call)", () => {
    const { s } = run([{ kind: "closed", at: T }], connecting());
    expect(s.phase).toBe("connecting");
    expect(s.open).toBe(false);
  });

  it("CONNECTING + statusAnswered -> CONNECTING (a list read during a call keeps the call)", () => {
    const c = bankAfter([{ kind: "opened", at: T }], connecting());
    const { s } = run([{ kind: "statusAnswered", seq: 4, answer: { ok: true, banks: [BANK_READ], canConnect: true }, at: T }], c);
    expect(s.phase).toBe("connecting");
    expect(s.banks).toEqual([BANK_READ]);
  });
});

describe("ui.bank: importing", () => {
  const importing = () => bankShowing([BANK_IMPORTING]);

  it("READING + statusAnswered with an importing bank -> IDLE (a sync is armed on the calm interval)", () => {
    const { s, commands } = run([{ kind: "opened", at: T }, { kind: "statusAnswered", seq: 1, answer: { ok: true, banks: [BANK_IMPORTING], canConnect: true }, at: T }]);
    expect(s.pollAt).toBe(T + BANK_POLL_MS);
    expect(commands).toContainEqual({ kind: "arm", ms: BANK_POLL_MS });
    expect(bankPolls(s)).toBe(true);
  });

  it("IDLE + tick at the poll -> IDLE (one sync per importing bank)", () => {
    const early = run([{ kind: "tick", at: T + BANK_POLL_MS - 1 }], importing());
    expect(early.commands).toEqual([]);
    const { s, commands } = run([{ kind: "tick", at: T + BANK_POLL_MS }], importing());
    expect(commands).toEqual([{ kind: "sync", seq: 2, connectorId: BANK_IMPORTING.connectorId }]);
    expect(s.syncAsk).toBe(2);
    expect(s.pollAt).toBeNull();
  });

  it("IDLE + syncAnswered still importing -> IDLE (the next sync is armed)", () => {
    const out = run([{ kind: "tick", at: T + BANK_POLL_MS }, { kind: "syncAnswered", seq: 2, connectorId: BANK_IMPORTING.connectorId, answer: { ok: true, bank: BANK_IMPORTING }, at: T + BANK_POLL_MS }], importing());
    expect(out.commands.at(-1)).toEqual({ kind: "arm", ms: BANK_POLL_MS });
    expect(out.s.pollAt).toBe(T + 2 * BANK_POLL_MS);
  });

  it("IDLE + syncAnswered imported -> IDLE (importing to connected: polling stops)", () => {
    const out = run([{ kind: "tick", at: T + BANK_POLL_MS }, { kind: "syncAnswered", seq: 2, connectorId: BANK_IMPORTING.connectorId, answer: { ok: true, bank: BANK_READ }, at: T + BANK_POLL_MS }], importing());
    expect(out.s.banks).toEqual([BANK_READ]);
    expect(out.s.pollAt).toBeNull();
    expect(bankPolls(out.s)).toBe(false);
    expect(out.commands.filter((c) => c.kind === "arm")).toEqual([]);
  });

  it("IDLE + syncAnswered with another seq or bank -> IDLE (stale)", () => {
    const polled = bankAfter([{ kind: "tick", at: T + BANK_POLL_MS }], importing());
    expect(run([{ kind: "syncAnswered", seq: 1, connectorId: BANK_IMPORTING.connectorId, answer: { ok: true, bank: BANK_READ }, at: T }], polled).s).toBe(polled);
    expect(run([{ kind: "syncAnswered", seq: 2, connectorId: "other", answer: { ok: true, bank: BANK_READ }, at: T }], polled).s).toBe(polled);
  });

  it("IDLE + syncAnswered disconnected -> IDLE (a bank the pull found revoked leaves the list)", () => {
    const out = run([{ kind: "tick", at: T + BANK_POLL_MS }, { kind: "syncAnswered", seq: 2, connectorId: BANK_IMPORTING.connectorId, answer: { ok: true, bank: BANK_DISCONNECTED }, at: T + BANK_POLL_MS }], importing());
    expect(out.s.banks).toEqual([]);
  });

  it(`IDLE + ${BANK_SYNC_FAILURE_LIMIT} failed syncs -> IDLE (polling stops after failures in a row)`, () => {
    let s = importing();
    let t = T;
    for (let i = 0; i < BANK_SYNC_FAILURE_LIMIT; i++) {
      t += BANK_POLL_MS;
      const tick = bankStep(s, { kind: "tick", at: t });
      const sync = tick.commands.find((c) => c.kind === "sync");
      expect(sync).toBeDefined();
      s = bankStep(tick.state, { kind: "syncAnswered", seq: (sync as { seq: number }).seq, connectorId: BANK_IMPORTING.connectorId, answer: { ok: false }, at: t }).state;
    }
    expect(s.pollAt).toBeNull();
    expect(bankPolls(s)).toBe(false);
    expect(s.banks).toEqual([BANK_IMPORTING]);
  });

  it("IDLE + syncs past the longest run -> IDLE (polling stops; opening the sheet starts it again)", () => {
    let s = importing();
    let t = T;
    while (s.pollAt !== null) {
      t = s.pollAt;
      const tick = bankStep(s, { kind: "tick", at: t });
      const seq = (tick.commands.find((c) => c.kind === "sync") as { seq: number }).seq;
      s = bankStep(tick.state, { kind: "syncAnswered", seq, connectorId: BANK_IMPORTING.connectorId, answer: { ok: true, bank: BANK_IMPORTING }, at: t }).state;
    }
    expect(t - T).toBeGreaterThanOrEqual(BANK_POLL_MAX_MS - BANK_POLL_MS);
    const reopened = run([{ kind: "opened", at: t }, { kind: "statusAnswered", seq: s.seq + 1, answer: { ok: true, banks: [BANK_IMPORTING], canConnect: true }, at: t }], s);
    expect(reopened.s.pollAt).toBe(t + BANK_POLL_MS);
  });

  it("an expired bank is never polled (needs reconnect is not importing)", () => {
    expect(importingIds([{ ...BANK_EXPIRED, importing: true }])).toEqual([]);
  });
});

describe("ui.bank: needs reconnect and disconnect", () => {
  it("READING + statusAnswered with an expired bank -> IDLE (needs reconnect shows as the server said)", () => {
    const s = bankShowing([BANK_EXPIRED]);
    expect(s.banks![0]!.needsReconnect).toBe(true);
    expect(s.pollAt).toBeNull();
  });

  it("IDLE + disconnectPressed -> CONFIRMING (asks first; nothing is sent)", () => {
    const { s, commands } = run([{ kind: "disconnectPressed", connectorId: BANK_READ.connectorId, at: T }], read());
    expect(s.phase).toBe("confirming");
    expect(s.confirmId).toBe(BANK_READ.connectorId);
    expect(commands).toEqual([]);
  });

  it("IDLE + disconnectPressed for an unknown bank -> IDLE", () => {
    expect(run([{ kind: "disconnectPressed", connectorId: "nope", at: T }], read()).s.phase).toBe("idle");
  });

  it("CONFIRMING + disconnectNotNow -> IDLE (Not now sends nothing)", () => {
    const { s, commands } = run([{ kind: "disconnectNotNow", at: T }], confirming());
    expect(s.phase).toBe("idle");
    expect(s.confirmId).toBeNull();
    expect(commands).toEqual([]);
  });

  it("CONFIRMING + closed -> IDLE (closing drops the ask)", () => {
    const { s, commands } = run([{ kind: "closed", at: T }], confirming());
    expect(s.phase).toBe("idle");
    expect(commands).toEqual([]);
  });

  it("CONFIRMING + disconnectYes -> DISCONNECTING (Yes sends one disconnect, with the new requestId)", () => {
    const { s, commands } = run([{ kind: "disconnectYes", requestId: "req-2", at: T }], confirming());
    expect(s.phase).toBe("disconnecting");
    expect(commands).toEqual([{ kind: "disconnect", seq: 2, requestId: "req-2", connectorId: BANK_READ.connectorId }]);
  });

  it("CONFIRMING + statusAnswered without that bank -> IDLE (the ask goes with the bank)", () => {
    const c = bankAfter([{ kind: "opened", at: T }], confirming());
    const { s } = run([{ kind: "statusAnswered", seq: 2, answer: { ok: true, banks: [], canConnect: true }, at: T }], c);
    expect(s.phase).toBe("idle");
    expect(s.confirmId).toBeNull();
  });

  it("IDLE + disconnectYes -> IDLE (Yes means nothing without the ask)", () => {
    expect(run([{ kind: "disconnectYes", requestId: "r", at: T }], read()).commands).toEqual([]);
  });

  it("DISCONNECTING + disconnectAnswered -> IDLE (gone from the list once the server says so, then read again)", () => {
    const { s, commands } = run([{ kind: "disconnectAnswered", seq: 2, answer: { ok: true, bank: BANK_DISCONNECTED }, at: T }], disconnecting());
    expect(s.phase).toBe("idle");
    expect(s.note).toBe("disconnected");
    expect(s.banks).toEqual([]);
    expect(commands).toEqual([{ kind: "readStatus", seq: 3 }]);
  });

  it("DISCONNECTING + disconnectAnswered failed -> IDLE (says so; the bank stays until a read says otherwise)", () => {
    const { s, commands } = run([{ kind: "disconnectAnswered", seq: 2, answer: { ok: false, why: "failed" }, at: T }], disconnecting());
    expect(s.note).toBe("disconnectFailed");
    expect(s.banks).toEqual([BANK_READ]);
    expect(commands).toEqual([{ kind: "readStatus", seq: 3 }]);
  });

  it("DISCONNECTING + disconnectAnswered unknown -> IDLE (no answer: the list is read again)", () => {
    const { s, commands } = run([{ kind: "disconnectAnswered", seq: 2, answer: { ok: false, why: "unknown" }, at: T }], disconnecting());
    expect(s.note).toBe("disconnectUnknown");
    expect(commands).toEqual([{ kind: "readStatus", seq: 3 }]);
  });

  it("DISCONNECTING + disconnectAnswered with another seq -> DISCONNECTING (stale)", () => {
    expect(run([{ kind: "disconnectAnswered", seq: 9, answer: { ok: true, bank: BANK_DISCONNECTED }, at: T }], disconnecting()).s.phase).toBe("disconnecting");
  });

  it("DISCONNECTING + disconnectNotNow -> DISCONNECTING (the answer is already out)", () => {
    expect(run([{ kind: "disconnectNotNow", at: T }], disconnecting()).s.phase).toBe("disconnecting");
  });
});

describe("ui.bank: totality", () => {
  const states: Record<BankPhase, () => BankState> = {
    unread: () => INITIAL_BANK,
    reading: () => bankAfter([{ kind: "opened", at: T }]),
    readFailed: () => bankAfter([{ kind: "opened", at: T }, { kind: "statusAnswered", seq: 1, answer: { ok: false }, at: T }]),
    idle: read,
    preparing,
    linking,
    connecting,
    confirming,
    disconnecting,
  };
  const events: BankEvent[] = [
    { kind: "opened", at: T },
    { kind: "closed", at: T },
    { kind: "retry", at: T },
    { kind: "statusAnswered", seq: 50, answer: { ok: true, banks: [], canConnect: true }, at: T },
    { kind: "connectPressed", at: T },
    { kind: "tokenAnswered", seq: 50, answer: { ok: true, linkToken: "x" }, at: T },
    { kind: "linkOpened", session: 50, at: T },
    { kind: "linkSuccess", session: 50, success, requestId: "r", at: T },
    { kind: "linkExit", session: 50, error: false, at: T },
    { kind: "connectAnswered", seq: 50, answer: { ok: false, why: "refused" }, at: T },
    { kind: "syncAnswered", seq: 50, connectorId: "x", answer: { ok: false }, at: T },
    { kind: "disconnectPressed", connectorId: "x", at: T },
    { kind: "disconnectNotNow", at: T },
    { kind: "disconnectYes", requestId: "r", at: T },
    { kind: "disconnectAnswered", seq: 50, answer: { ok: false, why: "failed" }, at: T },
    { kind: "tick", at: T },
    { kind: "reset" },
    { kind: "nonsense" } as unknown as BankEvent,
  ];

  it("every event is defined in every state, and never throws", () => {
    for (const [phase, make] of Object.entries(states)) {
      const from = make();
      expect(from.phase).toBe(phase);
      for (const e of events) expect(() => bankStep(from, e)).not.toThrow();
    }
  });

  it("an unknown event changes nothing", () => {
    for (const make of Object.values(states)) {
      const from = make();
      expect(bankStep(from, { kind: "nonsense" } as unknown as BankEvent)).toEqual({ state: from, commands: [] });
    }
  });
});
