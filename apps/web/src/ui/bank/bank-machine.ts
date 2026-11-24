/**
 * @machine ui.bank
 * The bank sheet (brief 046 part B): what the sheet shows about the owner's connected banks, when Plaid Link is
 * opened, and which `/api/bank/*` call goes out next. Pure: bankStep(state, event) -> { state, commands }. `at`
 * rides on every event, request IDs arrive on the event that needs one, and every wait is an `arm` command plus a
 * deadline in state.
 * Always: the banks shown are the last list the server answered, changed only by a later answer (status, connect,
 *         sync, disconnect); nothing is shown as connected, imported or gone before its answer. An answer that
 *         does not carry the seq of the request in flight changes nothing. A Plaid Link session's answers name the
 *         session, so a late exit from an earlier one changes nothing. A refused or unconfirmed connect is never
 *         sent again with the same public token: the next try starts a new Link session. Disconnect asks first,
 *         and only an explicit Yes sends it. While a bank is importing, a sync goes out every BANK_POLL_MS, one
 *         round at a time, and stops when none is importing, after BANK_SYNC_FAILURE_LIMIT failed rounds, or after
 *         BANK_POLL_MAX_MS. While the last status answer said `simulated` (brief 054), neither Connect nor
 *         Disconnect starts.
 * Never: read a clock, the network or the DOM; hold a bank password (Plaid's own window takes the sign-in); show
 *         Plaid's error text; throw.
 */
import type { BankView } from "@franki/core";

/** Where the sheet is. */
export type BankPhase =
  /** Nothing read yet: the sheet has not been opened since sign-in. */
  | "unread"
  /** The first status read is out. */
  | "reading"
  /** The first status read failed: the sheet says so and offers Try again. */
  | "readFailed"
  /** The banks are known and nothing is out. */
  | "idle"
  /** A Link token was asked for. */
  | "preparing"
  /** Plaid Link is loading or open with the token. */
  | "linking"
  /** Link handed back a public token, and the connect call is out. */
  | "connecting"
  /** Disconnect was pressed for one bank, and waits for Yes or Not now. */
  | "confirming"
  /** The disconnect call is out. */
  | "disconnecting";

/** One plain line after something finished. Never Plaid's words. */
export type BankNote =
  | "linkClosed"
  | "linkFailed"
  | "tokenFailed"
  | "limit"
  | "connected"
  | "alreadyConnected"
  | "connectRefused"
  | "connectUnknown"
  | "disconnected"
  | "disconnectFailed"
  | "disconnectUnknown";

export interface BankLinkSession {
  /** The seq that asked for this session's token; Link's answers name it. */
  session: number;
  linkToken: string;
}

export interface BankState {
  open: boolean;
  phase: BankPhase;
  note: BankNote | null;
  /** The last list the server answered; null before any answer. */
  banks: readonly BankView[] | null;
  /** The server's word on whether one more bank may be connected; false until it has said. */
  canConnect: boolean;
  /** The last seq handed out. */
  seq: number;
  /** The status read in flight. */
  statusAsk: number | null;
  /** The link-token, connect or disconnect call in flight. */
  actionAsk: number | null;
  /** The Link session while `linking`. */
  link: BankLinkSession | null;
  /** Link must say it opened before this, or the try ends as `linkFailed`. */
  linkAt: number | null;
  /** The bank whose disconnect is asked about or out. */
  confirmId: string | null;
  /** The next sync round is due at this time. */
  pollAt: number | null;
  /** The sync round in flight, and the banks it still waits on. */
  syncAsk: number | null;
  syncWaiting: readonly string[];
  /** Some answer of the round in flight failed. */
  syncRoundFailed: boolean;
  /** When the current run of syncs began. */
  pollSince: number | null;
  /** Failed sync rounds in a row. */
  syncFailures: number;
  /**
   * Brief 054 (R17.3, R17.4): the server's last status answer said these banks are simulated (a demo visit). Present
   * only when true, and absent in `INITIAL_BANK`, so a sample visit's states are as they were. While set, the sheet
   * offers neither Connect nor Disconnect. A later answer without it clears it.
   */
  simulated?: true;
}

export const INITIAL_BANK: Readonly<BankState> = Object.freeze({
  open: false,
  phase: "unread",
  note: null,
  banks: null,
  canConnect: false,
  seq: 0,
  statusAsk: null,
  actionAsk: null,
  link: null,
  linkAt: null,
  confirmId: null,
  pollAt: null,
  syncAsk: null,
  syncWaiting: [],
  syncRoundFailed: false,
  pollSince: null,
  syncFailures: 0,
});

/** How often an importing bank is pulled. A ruling: calm, one named constant. */
export const BANK_POLL_MS = 15_000;
/** No run of syncs lasts longer than this; reopening the sheet starts a new run. */
export const BANK_POLL_MAX_MS = 20 * 60_000;
/** This many failed sync rounds in a row stop the run. */
export const BANK_SYNC_FAILURE_LIMIT = 4;
/** Plaid Link must say it opened within this, or the try ends with a plain line. */
export const BANK_LINK_OPEN_MS = 20_000;

/** What Plaid Link handed back on success. Only the institution's id and name; no account data is kept here. */
export interface BankLinkSuccess {
  publicToken: string;
  institutionId: string | null;
  institutionName: string | null;
}

export type BankStatusAnswer = { ok: true; banks: readonly BankView[]; canConnect: boolean; simulated?: true } | { ok: false };
export type BankTokenAnswer = { ok: true; linkToken: string } | { ok: false; why: "limit" | "failed" };
export type BankConnectAnswer = { ok: true; bank: BankView; existing: boolean } | { ok: false; why: "limit" | "refused" | "unknown" };
export type BankSyncAnswer = { ok: true; bank: BankView } | { ok: false };
/** `failed`: the server answered that it did not disconnect. `unknown`: no answer reached the browser. */
export type BankDisconnectAnswer = { ok: true; bank: BankView } | { ok: false; why: "failed" | "unknown" };

export type BankEvent =
  /** The way in was pressed. */
  | { kind: "opened"; at: number }
  /** Close, Escape or the scrim. */
  | { kind: "closed"; at: number }
  /** Try again after a failed first read. */
  | { kind: "retry"; at: number }
  | { kind: "statusAnswered"; seq: number; answer: BankStatusAnswer; at: number }
  /** "Connect a bank" was pressed. */
  | { kind: "connectPressed"; at: number }
  | { kind: "tokenAnswered"; seq: number; answer: BankTokenAnswer; at: number }
  /** Plaid Link reported that it is open. */
  | { kind: "linkOpened"; session: number; at: number }
  /** Link handed back a public token. `requestId` is new for this connect. */
  | { kind: "linkSuccess"; session: number; success: BankLinkSuccess; requestId: string; at: number }
  /** Link closed without a bank: by the owner (`error` false) or with an error, or its script did not load. */
  | { kind: "linkExit"; session: number; error: boolean; at: number }
  | { kind: "connectAnswered"; seq: number; answer: BankConnectAnswer; at: number }
  | { kind: "syncAnswered"; seq: number; connectorId: string; answer: BankSyncAnswer; at: number }
  /** Disconnect was pressed on one bank. */
  | { kind: "disconnectPressed"; connectorId: string; at: number }
  | { kind: "disconnectNotNow"; at: number }
  /** Yes. `requestId` is new for this disconnect. */
  | { kind: "disconnectYes"; requestId: string; at: number }
  | { kind: "disconnectAnswered"; seq: number; answer: BankDisconnectAnswer; at: number }
  /** A timer the machine armed went off. */
  | { kind: "tick"; at: number }
  /** Signed out, or the page is going away. */
  | { kind: "reset" };

export type BankCommand =
  | { kind: "readStatus"; seq: number }
  | { kind: "requestLinkToken"; seq: number }
  | { kind: "connect"; seq: number; requestId: string; publicToken: string; institutionId: string | null; institutionName: string | null }
  | { kind: "sync"; seq: number; connectorId: string }
  | { kind: "disconnect"; seq: number; requestId: string; connectorId: string }
  /** Send `tick` after this many ms. */
  | { kind: "arm"; ms: number };

export interface BankStep {
  state: BankState;
  commands: BankCommand[];
}

const none = (state: BankState): BankStep => ({ state, commands: [] });

/** True while some call the owner started is out, so the sheet's own buttons wait. */
export function bankBusy(s: BankState): boolean {
  return s.phase === "preparing" || s.phase === "linking" || s.phase === "connecting" || s.phase === "disconnecting";
}

/** Whether "Connect a bank" is offered: the server said one more fits, nothing else is out, and it is not simulated. */
export function canStartLink(s: BankState): boolean {
  return s.phase === "idle" && s.banks !== null && s.canConnect && s.simulated !== true;
}

/** Brief 054: the state with the server's `simulated` mark as the answer gave it, absent when it did not. */
function markSimulated(s: BankState, simulated: boolean): BankState {
  if (simulated) return s.simulated === true ? s : { ...s, simulated: true };
  if (s.simulated === undefined) return s;
  const next = { ...s };
  delete next.simulated;
  return next;
}

/** The banks a sync round would pull: connected or syncing, and still importing. */
export function importingIds(banks: readonly BankView[] | null): string[] {
  return (banks ?? []).filter((b) => b.importing && b.state !== "disconnected" && b.state !== "expired").map((b) => b.connectorId);
}

/** True while the sheet would pull an importing bank on the next round. */
export function bankPolls(s: BankState): boolean {
  return s.pollAt !== null || s.syncAsk !== null;
}

function readStatus(s: BankState): BankStep {
  const seq = s.seq + 1;
  return { state: { ...s, seq, statusAsk: seq }, commands: [{ kind: "readStatus", seq }] };
}

/** A bank the server answered, put in the list in place, added at the end, or dropped when disconnected. */
function merge(banks: readonly BankView[] | null, bank: BankView): BankView[] {
  const list = (banks ?? []).filter((b) => b.connectorId !== bank.connectorId);
  if (bank.state === "disconnected") return list;
  const at = (banks ?? []).findIndex((b) => b.connectorId === bank.connectorId);
  if (at < 0) return [...list, bank];
  list.splice(Math.min(at, list.length), 0, bank);
  return list;
}

/** After the list changed: start, keep or stop the run of syncs. Never arms while a round is out. */
function schedulePoll(s: BankState, at: number): BankStep {
  if (s.syncAsk !== null) return none(s);
  const ids = importingIds(s.banks);
  if (ids.length === 0) return none({ ...s, pollAt: null, pollSince: null, syncFailures: 0 });
  if (s.pollAt !== null) return none(s);
  const since = s.pollSince ?? at;
  if (at - since >= BANK_POLL_MAX_MS || s.syncFailures >= BANK_SYNC_FAILURE_LIMIT) return none({ ...s, pollAt: null, pollSince: since });
  return { state: { ...s, pollAt: at + BANK_POLL_MS, pollSince: since }, commands: [{ kind: "arm", ms: BANK_POLL_MS }] };
}

/** Merges the step's commands after `first`'s. */
function then(first: BankStep, next: (s: BankState) => BankStep): BankStep {
  const second = next(first.state);
  return { state: second.state, commands: [...first.commands, ...second.commands] };
}

/** A sync round's answers are all in: count the round and arm the next one if anything still imports. */
function roundDone(s: BankState, failed: boolean, at: number): BankStep {
  const failures = failed ? s.syncFailures + 1 : 0;
  return schedulePoll({ ...s, syncAsk: null, syncWaiting: [], syncRoundFailed: false, syncFailures: failures }, at);
}

function onTick(s: BankState, at: number): BankStep {
  let state = s;
  const commands: BankCommand[] = [];
  // Link said nothing in time: the try ends calmly. A late answer from it names an old session and does nothing.
  if (s.phase === "linking" && s.linkAt !== null && at >= s.linkAt) {
    state = { ...state, phase: "idle", link: null, linkAt: null, note: "linkFailed" };
  }
  if (state.pollAt !== null && at >= state.pollAt) {
    const ids = importingIds(state.banks);
    if (ids.length === 0 || state.syncAsk !== null) {
      state = { ...state, pollAt: null };
    } else {
      const seq = state.seq + 1;
      state = { ...state, seq, pollAt: null, syncAsk: seq, syncWaiting: ids, syncRoundFailed: false };
      for (const connectorId of ids) commands.push({ kind: "sync", seq, connectorId });
    }
  }
  return { state, commands };
}

function onStatus(s: BankState, e: Extract<BankEvent, { kind: "statusAnswered" }>): BankStep {
  if (e.seq !== s.statusAsk) return none(s);
  if (!e.answer.ok) {
    // A failed re-read keeps what was last answered; only a first read that fails says so.
    if (s.banks !== null) return none({ ...s, statusAsk: null });
    return none({ ...s, statusAsk: null, phase: s.phase === "reading" ? "readFailed" : s.phase });
  }
  const state: BankState = markSimulated(
    {
      ...s,
      statusAsk: null,
      banks: e.answer.banks,
      canConnect: e.answer.canConnect,
      phase: s.phase === "reading" || s.phase === "readFailed" ? "idle" : s.phase,
    },
    e.answer.simulated === true,
  );
  // A bank asked about may have gone in the meantime: the ask goes with it. A simulated bank is never disconnected,
  // so an ask open when that answer lands goes too.
  const asked = state.phase === "confirming" && (state.simulated === true || !state.banks!.some((b) => b.connectorId === state.confirmId));
  return schedulePoll(asked ? { ...state, phase: "idle", confirmId: null } : state, e.at);
}

/** Total: every event is defined in every state. */
export function bankStep(s: BankState, e: BankEvent): BankStep {
  switch (e.kind) {
    case "reset":
      return none(INITIAL_BANK);
    case "opened": {
      // Every open reads the list again, and starts a fresh run of syncs if something still imports.
      const opened: BankState = { ...s, open: true, note: null, pollSince: s.syncAsk === null && s.pollAt === null ? null : s.pollSince, syncFailures: 0 };
      const phase = s.phase === "unread" || s.phase === "readFailed" ? "reading" : s.phase;
      if (s.statusAsk !== null) return none({ ...opened, phase });
      return readStatus({ ...opened, phase });
    }
    case "closed":
      // Closing drops an unanswered ask; a call already out still lands, and a run of syncs goes on.
      return none({ ...s, open: false, note: null, phase: s.phase === "confirming" ? "idle" : s.phase, confirmId: s.phase === "confirming" ? null : s.confirmId });
    case "retry":
      if (s.phase !== "readFailed" || s.statusAsk !== null) return none(s);
      return readStatus({ ...s, phase: "reading", note: null });
    case "statusAnswered":
      return onStatus(s, e);
    case "connectPressed": {
      if (!canStartLink(s)) return none(s);
      const seq = s.seq + 1;
      return { state: { ...s, seq, actionAsk: seq, phase: "preparing", note: null }, commands: [{ kind: "requestLinkToken", seq }] };
    }
    case "tokenAnswered": {
      if (s.phase !== "preparing" || e.seq !== s.actionAsk) return none(s);
      if (!e.answer.ok) {
        const limit = e.answer.why === "limit";
        return none({ ...s, actionAsk: null, phase: "idle", note: limit ? "limit" : "tokenFailed", canConnect: limit ? false : s.canConnect });
      }
      return {
        state: { ...s, actionAsk: null, phase: "linking", link: { session: e.seq, linkToken: e.answer.linkToken }, linkAt: e.at + BANK_LINK_OPEN_MS },
        commands: [{ kind: "arm", ms: BANK_LINK_OPEN_MS }],
      };
    }
    case "linkOpened":
      if (s.phase !== "linking" || s.link?.session !== e.session) return none(s);
      return none({ ...s, linkAt: null });
    case "linkSuccess": {
      if (s.phase !== "linking" || s.link?.session !== e.session) return none(s);
      const seq = s.seq + 1;
      const { publicToken, institutionId, institutionName } = e.success;
      return {
        state: { ...s, seq, actionAsk: seq, phase: "connecting", link: null, linkAt: null },
        commands: [{ kind: "connect", seq, requestId: e.requestId, publicToken, institutionId, institutionName }],
      };
    }
    case "linkExit":
      if (s.phase !== "linking" || s.link?.session !== e.session) return none(s);
      return none({ ...s, phase: "idle", link: null, linkAt: null, note: e.error ? "linkFailed" : "linkClosed" });
    case "connectAnswered": {
      if (s.phase !== "connecting" || e.seq !== s.actionAsk) return none(s);
      const base: BankState = { ...s, actionAsk: null, phase: "idle" };
      if (e.answer.ok) {
        const next = { ...base, banks: merge(s.banks, e.answer.bank), note: (e.answer.existing ? "alreadyConnected" : "connected") as BankNote };
        // The list is read again for the server's word on the limit; the answered bank shows at once.
        return then(schedulePoll(next, e.at), readStatus);
      }
      if (e.answer.why === "limit") return none({ ...base, canConnect: false, note: "limit" });
      // Refused or unknown: never sent again. An unknown answer reads the list, which says what is true.
      if (e.answer.why === "refused") return none({ ...base, note: "connectRefused" });
      return readStatus({ ...base, note: "connectUnknown" });
    }
    case "syncAnswered": {
      if (e.seq !== s.syncAsk || !s.syncWaiting.includes(e.connectorId)) return none(s);
      const waiting = s.syncWaiting.filter((id) => id !== e.connectorId);
      const banks = e.answer.ok ? merge(s.banks, e.answer.bank) : s.banks;
      // A bank asked about that the pull found revoked is gone from the list, and the ask with it.
      const gone = s.confirmId !== null && s.phase === "confirming" && !(banks ?? []).some((b) => b.connectorId === s.confirmId);
      // One failed answer marks the round failed; the round ends when the last answer is in.
      const roundFailed = s.syncRoundFailed || !e.answer.ok;
      const state: BankState = { ...s, banks, syncWaiting: waiting, syncRoundFailed: roundFailed, ...(gone ? { phase: "idle" as const, confirmId: null } : {}) };
      if (waiting.length > 0) return none(state);
      return roundDone(state, roundFailed, e.at);
    }
    case "disconnectPressed":
      // Brief 054 (R17.3): a simulated bank is never offered a disconnect, and the server refuses one.
      if (s.phase !== "idle" || s.simulated === true || !(s.banks ?? []).some((b) => b.connectorId === e.connectorId)) return none(s);
      return none({ ...s, phase: "confirming", confirmId: e.connectorId, note: null });
    case "disconnectNotNow":
      if (s.phase !== "confirming") return none(s);
      return none({ ...s, phase: "idle", confirmId: null });
    case "disconnectYes": {
      if (s.phase !== "confirming" || s.confirmId === null) return none(s);
      const seq = s.seq + 1;
      return {
        state: { ...s, seq, actionAsk: seq, phase: "disconnecting" },
        commands: [{ kind: "disconnect", seq, requestId: e.requestId, connectorId: s.confirmId }],
      };
    }
    case "disconnectAnswered": {
      if (s.phase !== "disconnecting" || e.seq !== s.actionAsk) return none(s);
      const base: BankState = { ...s, actionAsk: null, phase: "idle", confirmId: null };
      if (e.answer.ok) {
        // The list is read again for the server's word on the limit.
        return then(schedulePoll({ ...base, banks: merge(s.banks, e.answer.bank), note: "disconnected" }, e.at), readStatus);
      }
      if (e.answer.why === "failed") return readStatus({ ...base, note: "disconnectFailed" });
      return readStatus({ ...base, note: "disconnectUnknown" });
    }
    case "tick":
      return onTick(s, e.at);
    default:
      e satisfies never;
      return none(s);
  }
}
