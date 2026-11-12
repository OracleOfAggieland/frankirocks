// The visit, as a pure machine (brief 027, spec §15). Each visit clones the seeded persona once, keyed to a stored
// visit ID, so a reload keeps the same month. The time bolt moves the visit's world clock forward only. Start over
// resets the visit, after one confirmation, and ends a call first. Pure: no storage, no network and no clock read;
// the shell (`client/visit-model.ts`) runs the commands in order and sends the answers back as events.
import type { Proactive } from "@franki/core";

/**
 * Where the visit is. `live` (brief 038 finding 1): the server said this is a real account, which is never reset;
 * the screen takes input as it does without a visit, shows the real clock, and offers no start over and no bolt.
 */
export type VisitPhase = "none" | "cloning" | "ready" | "resetting" | "failed" | "live";

/** The time bolt: free, waiting for its advance, or held by a barrier. */
export type BoltPhase = "idle" | "moving" | "waiting";

/** Why the visit is not ready. `interrupted`: a clone was asked for before a reload and never confirmed. */
export type VisitFailure = "clone" | "interrupted" | "barrier";

/** What the browser keeps between reloads, one per signed-in user. */
export interface StoredVisit {
  visitId: string;
  /** Null until a reset for this visit ID has answered. */
  fixtureNamespace: string | null;
  /** The world clock the last answer gave, or null before one. */
  worldClockMs: number | null;
  /** Brief 038 finding 1: the server answered that this account is real (LIVE), so it is never cloned. */
  live?: true;
}

export interface VisitState {
  phase: VisitPhase;
  visit: StoredVisit | null;
  /** The world clock of the last answer this machine accepted, or null before one. */
  worldMs: number | null;
  bolt: BoltPhase;
  /** The last bolt press did not move the clock (a timeout or a failure, not a barrier). */
  boltFailed: boolean;
  /** Start over was pressed and waits for its confirmation. */
  confirming: boolean;
  /** A reset waits for the call to end before it goes out. */
  endingCall: boolean;
  failure: VisitFailure | null;
  /** The number of the outstanding request; an answer with another number is stale and ignored. */
  seq: number;
}

export const INITIAL_VISIT: Readonly<VisitState> = Object.freeze({
  phase: "none",
  visit: null,
  worldMs: null,
  bolt: "idle",
  boltFailed: false,
  confirming: false,
  endingCall: false,
  failure: null,
  seq: 0,
});

/**
 * `live`: the server answered LIVE, a real account that is never reset (brief 038 finding 1). `stale`: the server
 * answered STALE, so this tab's visit is no longer the account's clone (brief 038 finding 4).
 */
export type SeedFailureWhy = "barrier" | "signedOut" | "timeout" | "failed" | "live" | "stale";

export type VisitEvent =
  /** The lab opened, with what storage holds and a fresh ID to use if it holds nothing. */
  | { kind: "entered"; stored: StoredVisit | null; newVisitId: string }
  | { kind: "resetAnswered"; seq: number; fixtureNamespace: string; worldMs: number }
  | { kind: "resetFailed"; seq: number; why: SeedFailureWhy }
  /** The visitor pressed "Try again" after a failed clone. Each reset has a new visit ID (brief 038 finding 4). */
  | { kind: "retry"; newVisitId: string }
  | { kind: "startOverAsked" }
  | { kind: "startOverCancelled" }
  /** The visitor confirmed start over; `inCall` says whether a call is open now. The new visit gets a new ID. */
  | { kind: "startOverConfirmed"; inCall: boolean; newVisitId: string }
  /**
   * Brief 038 finding 4: a visit call was answered STALE (another tab started over, or this tab's visit is gone), and
   * the shell read the stored visit again. `seq` is the request it answered, or null for a STALE open.
   */
  | { kind: "staleVisit"; seq: number | null; stored: StoredVisit | null }
  /** The call the reset waited for has ended (or its limit passed). */
  | { kind: "callEnded" }
  | { kind: "boltPressed"; toMs: number }
  | { kind: "advanceAnswered"; seq: number; worldMs: number; proactive: Proactive | null }
  | { kind: "advanceFailed"; seq: number; why: SeedFailureWhy; retryAfterMs: number }
  /** The wait after a barrier answer is over. */
  | { kind: "waitOver" };

export type VisitCommand =
  /** Write the visit to storage. Runs before any reset in the same step. */
  | { kind: "store"; visit: StoredVisit }
  | { kind: "reset"; seq: number; visitId: string }
  | { kind: "endCall" }
  | { kind: "advance"; seq: number; fixtureNamespace: string; toMs: number }
  /** Show a proactive line and its cards the way a typed reply shows. */
  | { kind: "show"; proactive: Proactive }
  /** Send `waitOver` after this many ms. */
  | { kind: "wait"; ms: number }
  /** A reset answered: drop the typed Session, the shown lines and the memory surfaces, then read them again. */
  | { kind: "afterReset" };

export interface VisitStep {
  state: VisitState;
  commands: VisitCommand[];
}

/** How long the bolt waits after a barrier answer that carries no `retryAfterMs`. A ruling: one named constant. */
export const BARRIER_WAIT_MS = 2_000;

const none = (state: VisitState): VisitStep => ({ state, commands: [] });
const unconfirmed = (visitId: string): StoredVisit => ({ visitId, fixtureNamespace: null, worldClockMs: null });
const known = (v: StoredVisit | null): v is StoredVisit & { fixtureNamespace: string; worldClockMs: number } =>
  v !== null && v.fixtureNamespace !== null && v.worldClockMs !== null && Number.isFinite(v.worldClockMs);

/**
 * The one step. Total: an event that does not fit the state changes nothing. Every request carries a new `seq`, and
 * only the answer with the current `seq` moves the state, so a late answer never undoes a later one.
 */
export function visitStep(s: VisitState, e: VisitEvent): VisitStep {
  switch (e.kind) {
    case "entered": {
      if (s.phase !== "none") return none(s);
      if (e.stored === null) {
        // First entry: the ID is stored before the reset goes out, so a reload finds it and never makes a second.
        const visit = unconfirmed(e.newVisitId);
        const seq = s.seq + 1;
        return { state: { ...s, phase: "cloning", visit, worldMs: null, seq }, commands: [{ kind: "store", visit }, { kind: "reset", seq, visitId: visit.visitId }] };
      }
      if (e.stored.live === true) return none({ ...s, phase: "live", visit: { ...e.stored }, worldMs: null });
      if (known(e.stored)) return none({ ...s, phase: "ready", visit: { ...e.stored }, worldMs: e.stored.worldClockMs });
      // A reset for this ID was asked for and never confirmed. Asking again is the visitor's call ("Try again").
      return none({ ...s, phase: "failed", failure: "interrupted", visit: { ...e.stored }, worldMs: null });
    }
    case "resetAnswered": {
      if ((s.phase !== "cloning" && s.phase !== "resetting") || s.endingCall || e.seq !== s.seq || s.visit === null || !Number.isFinite(e.worldMs)) return none(s);
      const visit: StoredVisit = { visitId: s.visit.visitId, fixtureNamespace: e.fixtureNamespace, worldClockMs: e.worldMs };
      return {
        state: { ...s, phase: "ready", visit, worldMs: e.worldMs, bolt: "idle", boltFailed: false, failure: null },
        commands: [{ kind: "store", visit }, { kind: "afterReset" }],
      };
    }
    case "resetFailed": {
      if ((s.phase !== "cloning" && s.phase !== "resetting") || s.endingCall || e.seq !== s.seq) return none(s);
      if (e.why === "live" && s.visit !== null) {
        // The server's word: a real account. Stored, so a reload is live at once and asks nothing.
        const visit: StoredVisit = { visitId: s.visit.visitId, fixtureNamespace: null, worldClockMs: null, live: true };
        return { state: { ...s, phase: "live", visit, worldMs: null, failure: null }, commands: [{ kind: "store", visit }] };
      }
      return none({ ...s, phase: "failed", failure: e.why === "barrier" ? "barrier" : "clone", worldMs: null });
    }
    case "retry": {
      if (s.phase !== "failed" || s.visit === null) return none(s);
      const seq = s.seq + 1;
      // Brief 038 finding 4: a new visit ID, so a tab still holding the old one is STALE against this clone.
      const visit = unconfirmed(e.newVisitId);
      return { state: { ...s, phase: "cloning", visit, failure: null, confirming: false, seq }, commands: [{ kind: "store", visit }, { kind: "reset", seq, visitId: visit.visitId }] };
    }
    case "startOverAsked":
      return s.phase === "ready" && s.bolt !== "moving" ? none({ ...s, confirming: true }) : none(s);
    case "startOverCancelled":
      return s.confirming ? none({ ...s, confirming: false }) : none(s);
    case "startOverConfirmed": {
      if (!s.confirming || s.phase !== "ready" || s.visit === null) return none(s);
      // Marked unconfirmed first: a reload in the middle shows "Try again", never the old month as if nothing happened.
      // A new visit ID (brief 038 finding 4): another tab of the old visit is STALE against the new clone.
      const visit = unconfirmed(e.newVisitId);
      const base: VisitState = { ...s, phase: "resetting", visit, confirming: false, bolt: "idle", boltFailed: false };
      if (e.inCall) return { state: { ...base, endingCall: true }, commands: [{ kind: "store", visit }, { kind: "endCall" }] };
      const seq = s.seq + 1;
      return { state: { ...base, seq }, commands: [{ kind: "store", visit }, { kind: "reset", seq, visitId: visit.visitId }] };
    }
    case "callEnded": {
      if (s.phase !== "resetting" || !s.endingCall || s.visit === null) return none(s);
      const seq = s.seq + 1;
      return { state: { ...s, endingCall: false, seq }, commands: [{ kind: "reset", seq, visitId: s.visit.visitId }] };
    }
    case "boltPressed": {
      const ns = s.visit?.fixtureNamespace ?? null;
      if (s.phase !== "ready" || s.bolt !== "idle" || s.confirming || ns === null || s.worldMs === null) return none(s);
      // Forward only: never at or before the world clock last seen, and never a time that is not a real instant.
      if (!Number.isFinite(e.toMs) || !(e.toMs > s.worldMs)) return none(s);
      const seq = s.seq + 1;
      return { state: { ...s, bolt: "moving", boltFailed: false, seq }, commands: [{ kind: "advance", seq, fixtureNamespace: ns, toMs: e.toMs }] };
    }
    case "advanceAnswered": {
      if (s.phase !== "ready" || s.bolt !== "moving" || e.seq !== s.seq || s.visit === null || s.worldMs === null || !Number.isFinite(e.worldMs)) return none(s);
      // The server's world clock is monotone; a lower answer never moves the shown clock back.
      const worldMs = Math.max(s.worldMs, e.worldMs);
      const visit: StoredVisit = { ...s.visit, worldClockMs: worldMs };
      const commands: VisitCommand[] = [{ kind: "store", visit }];
      if (e.proactive !== null) commands.push({ kind: "show", proactive: e.proactive });
      return { state: { ...s, visit, worldMs, bolt: "idle" }, commands };
    }
    case "advanceFailed": {
      if (s.bolt !== "moving" || e.seq !== s.seq) return none(s);
      if (e.why === "barrier") {
        const ms = Number.isFinite(e.retryAfterMs) && e.retryAfterMs > 0 ? e.retryAfterMs : BARRIER_WAIT_MS;
        return { state: { ...s, bolt: "waiting" }, commands: [{ kind: "wait", ms }] };
      }
      return none({ ...s, bolt: "idle", boltFailed: true });
    }
    case "waitOver":
      return s.bolt === "waiting" ? none({ ...s, bolt: "idle" }) : none(s);
    case "staleVisit": {
      if (s.phase === "none" || s.phase === "live" || s.endingCall) return none(s);
      if (e.seq !== null && e.seq !== s.seq) return none(s);
      const st = e.stored;
      const base: VisitState = { ...s, bolt: "idle", boltFailed: false, confirming: false };
      if (st !== null && st.live === true) return none({ ...base, phase: "live", visit: { ...st }, worldMs: null, failure: null });
      // Another tab made a newer clone: this tab takes it up, and drops everything it showed of the old one.
      if (known(st) && st.visitId !== s.visit?.visitId) {
        return { state: { ...base, phase: "ready", visit: { ...st }, worldMs: st.worldClockMs, failure: null }, commands: [{ kind: "afterReset" }] };
      }
      // Nothing newer is stored: this tab's visit is over, and "Try again" makes a new one.
      return none({ ...base, phase: "failed", failure: "interrupted", visit: st === null ? s.visit : { ...st }, worldMs: null });
    }
  }
}

/** The clock the screen shows: the visit's world clock once one is known, else the real one. */
export function shownClock(s: VisitState, realMs: number): number {
  return s.worldMs ?? realMs;
}

/** The Time_Badge's props: present whenever the shown clock differs from the real one (lab-ui-foundation question 8). */
export function visitBadge(s: VisitState, realMs: number, zone: string): { simulated: boolean; instantMs: number; zone: string } {
  const shown = shownClock(s, realMs);
  return { simulated: shown !== realMs, instantMs: shown, zone };
}

/**
 * Brief 038 finding 1, the input gate: whether the screen takes input (a chip, a typed line, a call). Only once the
 * server has said which account this is: a clone that is `ready`, or a real account (`live`). Never while the clone
 * is being made, reset or has failed, so nothing a visitor does can write to the fresh account before its clone.
 */
export function inputAllowed(s: VisitState): boolean {
  return s.phase === "ready" || s.phase === "live";
}

/** Whether the bolt can be pressed now. */
export function boltEnabled(s: VisitState): boolean {
  return s.phase === "ready" && s.bolt === "idle" && !s.confirming && s.worldMs !== null;
}
