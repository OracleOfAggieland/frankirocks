/**
 * The visit's shell (brief 027; machine `ui.visit` in `ui/visit/visit-machine.ts`). One per signed-in user. It keeps
 * the stored visit in storage, calls the seed routes, ends a call before a reset, and runs the one wait timer. All
 * decisions are the machine's: this file runs its commands in order and sends the answers back as events.
 */
import { msFromTs, type Proactive, tsFromMs } from "@franki/core";
import { INITIAL_VISIT, type StoredVisit, type VisitCommand, type VisitEvent, type VisitState, visitStep } from "../ui/visit/visit-machine";
import { type ApiClient, advanceVisit, resetVisit } from "./api";
import { PERSONA_FIXTURE_ID, VISIT_STORAGE_PREFIX } from "./seed-guesses";

/** How long a reset waits for an open call to end before it goes out anyway; the reset closes calls itself. */
export const CALL_END_LIMIT_MS = 5_000;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The open call, if any: enough to end it and see that it ended. */
export interface CallLike {
  inCall(): boolean;
  hangUp(): void;
  subscribe(listener: () => void): () => void;
}

export interface VisitModelDeps {
  api: ApiClient;
  uid: string;
  storage: StorageLike | null;
  newId: () => string;
  call: CallLike | null;
  /**
   * Brief 054: the fixture every reset of this visit asks for. A demo visit (an anonymous user) sends the demo
   * persona's; absent, the first persona's, as before. It is fixed for the user, so a reload and Start over keep it.
   */
  fixtureId?: string;
  /** Brief 038 finding 3: the browser's zone, sent with every reset so the clone is laid out in it. */
  zone: () => string;
  /** The Session a reset should close: the call's, else the typed one's, else null. */
  sessionId: () => string | null;
  /** Shows a proactive line and its cards the way a typed reply shows. */
  onShow: (proactive: Proactive) => void;
  /** A reset answered: drop the typed Session, the shown lines and the memory surfaces, then read them again. */
  onAfterReset: () => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/** Reads a stored visit; anything that is not one reads as nothing stored. */
export function parseStoredVisit(raw: string | null): StoredVisit | null {
  if (raw === null) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  const o = v as { visitId?: unknown; fixtureNamespace?: unknown; worldClockMs?: unknown } | null;
  if (o === null || typeof o !== "object" || typeof o.visitId !== "string" || o.visitId === "") return null;
  const ns = typeof o.fixtureNamespace === "string" ? o.fixtureNamespace : null;
  const world = typeof o.worldClockMs === "number" && Number.isFinite(o.worldClockMs) ? o.worldClockMs : null;
  // Brief 038 finding 1: a stored LIVE answer. Anything else reads as a visit that is not live.
  if ((o as { live?: unknown }).live === true) return { visitId: o.visitId, fixtureNamespace: null, worldClockMs: null, live: true };
  return { visitId: o.visitId, fixtureNamespace: ns, worldClockMs: world };
}

export class VisitModel {
  private state: VisitState = INITIAL_VISIT;
  private listeners = new Set<() => void>();
  private stopped = false;
  private timer: unknown = null;
  private callWait: { off: () => void; timer: unknown } | null = null;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(private readonly deps: VisitModelDeps) {
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): VisitState => this.state;

  private get key(): string {
    return `${VISIT_STORAGE_PREFIX}${this.deps.uid}`;
  }

  private readStored(): StoredVisit | null {
    let raw: string | null = null;
    try {
      raw = this.deps.storage?.getItem(this.key) ?? null;
    } catch {
      raw = null;
    }
    return parseStoredVisit(raw);
  }

  /** The lab opened. */
  enter(): void {
    this.dispatch({ kind: "entered", stored: this.readStored(), newVisitId: this.deps.newId() });
  }

  /**
   * Brief 038 finding 4: a visit call (an open naming this visit, a reset or a bolt) was answered STALE. The tab reads
   * the stored visit again: another tab's newer clone is taken up; with nothing newer, the visit shows "Try again".
   */
  reloadVisit(seq: number | null = null): void {
    this.dispatch({ kind: "staleVisit", seq, stored: this.readStored() });
  }

  retry(): void {
    this.dispatch({ kind: "retry", newVisitId: this.deps.newId() });
  }

  askStartOver(): void {
    this.dispatch({ kind: "startOverAsked" });
  }

  cancelStartOver(): void {
    this.dispatch({ kind: "startOverCancelled" });
  }

  confirmStartOver(): void {
    this.dispatch({ kind: "startOverConfirmed", inCall: this.deps.call?.inCall() ?? false, newVisitId: this.deps.newId() });
  }

  press(toMs: number): void {
    this.dispatch({ kind: "boltPressed", toMs });
  }

  /** Signed out: no answer, timer or call wait reaches the machine again. */
  stop(): void {
    this.stopped = true;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    this.endCallWait();
  }

  private dispatch(e: VisitEvent): void {
    if (this.stopped) return;
    const out = visitStep(this.state, e);
    if (out.state !== this.state) {
      this.state = out.state;
      for (const l of this.listeners) l();
    }
    for (const c of out.commands) this.run(c);
  }

  private run(c: VisitCommand): void {
    switch (c.kind) {
      case "store":
        try {
          this.deps.storage?.setItem(this.key, JSON.stringify(c.visit));
        } catch {
          // Storage refused: the visit still runs; a reload starts a new one.
        }
        return;
      case "reset":
        void this.reset(c.seq, c.visitId);
        return;
      case "advance":
        void this.advance(c.seq, c.fixtureNamespace, c.toMs);
        return;
      case "endCall":
        this.endCall();
        return;
      case "show":
        this.deps.onShow(c.proactive);
        return;
      case "wait":
        if (this.timer !== null) this.clearTimer(this.timer);
        this.timer = this.setTimer(() => {
          this.timer = null;
          this.dispatch({ kind: "waitOver" });
        }, c.ms);
        return;
      case "afterReset":
        this.deps.onAfterReset();
        return;
    }
  }

  private async reset(seq: number, visitId: string): Promise<void> {
    const r = await resetVisit(this.deps.api, { requestId: this.deps.newId(), sessionId: this.deps.sessionId(), fixtureId: this.deps.fixtureId ?? PERSONA_FIXTURE_ID, visitId, clientZone: this.deps.zone() });
    if (r.ok) this.dispatch({ kind: "resetAnswered", seq, fixtureNamespace: r.body.fixtureNamespace, worldMs: msFromTs(r.body.worldClock) });
    else if (r.why === "stale") this.reloadVisit(seq);
    else this.dispatch({ kind: "resetFailed", seq, why: r.why });
  }

  private async advance(seq: number, fixtureNamespace: string, toMs: number): Promise<void> {
    const r = await advanceVisit(this.deps.api, { requestId: this.deps.newId(), fixtureNamespace, to: tsFromMs(toMs) });
    if (r.ok) this.dispatch({ kind: "advanceAnswered", seq, worldMs: msFromTs(r.body.worldClock), proactive: r.body.proactive });
    else if (r.why === "stale") this.reloadVisit(seq);
    else this.dispatch({ kind: "advanceFailed", seq, why: r.why, retryAfterMs: r.ok === false && r.why === "barrier" ? r.retryAfterMs : 0 });
  }

  /** Hangs up, then sends `callEnded` once the call is closed or the limit passes. */
  private endCall(): void {
    const call = this.deps.call;
    if (call === null || !call.inCall()) return void this.dispatch({ kind: "callEnded" });
    this.endCallWait();
    const done = () => {
      if (this.callWait === null) return;
      this.endCallWait();
      this.dispatch({ kind: "callEnded" });
    };
    const off = call.subscribe(() => {
      if (!call.inCall()) done();
    });
    this.callWait = { off, timer: this.setTimer(done, CALL_END_LIMIT_MS) };
    call.hangUp();
    if (!call.inCall()) done();
  }

  private endCallWait(): void {
    if (this.callWait === null) return;
    this.callWait.off();
    this.clearTimer(this.callWait.timer);
    this.callWait = null;
  }
}
