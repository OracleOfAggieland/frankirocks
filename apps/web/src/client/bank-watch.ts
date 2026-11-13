/**
 * The bank sheet's shell (brief 046 part B). It runs what `ui/bank/bank-machine` asks for: the five `/api/bank/*`
 * calls through `client/api.ts`, and its timers. It decides nothing itself: every change is `bankStep`, and every
 * answer goes back as an event naming its request.
 *
 * Nothing is sent before the sheet is first opened, and nothing at all once stopped (sign-out).
 */
import { type BankCommand, type BankEvent, type BankLinkSuccess, type BankState, INITIAL_BANK, bankStep } from "../ui/bank/bank-machine";
import { type ApiClient, connectBank, connectFields, disconnectBank, readBankStatus, requestBankLinkToken, syncBank } from "./api";

export interface BankWatchTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface BankWatchDeps {
  api: ApiClient;
  /** Local monotonic ms (the Browser_Client clock's `mono`). */
  now: () => number;
  /** A new request ID (contracts `ID`) for each connect and disconnect. */
  newId: () => string;
  timers?: BankWatchTimers;
}

const liveTimers: BankWatchTimers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

export class BankWatch {
  private state: BankState = INITIAL_BANK;
  private readonly listeners = new Set<() => void>();
  private readonly timers: BankWatchTimers;
  private readonly handles = new Set<unknown>();
  private stopped = false;
  /** Raised by every stop, so an answer to a call made before it is dropped (the machine's seqs start again). */
  private epoch = 0;

  constructor(private readonly deps: BankWatchDeps) {
    this.timers = deps.timers ?? liveTimers;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): BankState => this.state;

  /** Effect setup. Restartable: Strict Mode runs start, stop, start on one instance. */
  start(): void {
    this.stopped = false;
  }

  /** Sign-out or unmount: every timer goes, nothing more is sent, and nothing about any bank is kept. */
  stop(): void {
    this.stopped = true;
    this.epoch++;
    for (const h of this.handles) this.timers.clearTimeout(h);
    this.handles.clear();
    this.apply({ kind: "reset" });
  }

  open(): void {
    this.send({ kind: "opened", at: this.deps.now() });
  }

  close(): void {
    this.send({ kind: "closed", at: this.deps.now() });
  }

  toggle(): void {
    if (this.state.open) this.close();
    else this.open();
  }

  retry(): void {
    this.send({ kind: "retry", at: this.deps.now() });
  }

  connect(): void {
    this.send({ kind: "connectPressed", at: this.deps.now() });
  }

  linkOpened(session: number): void {
    this.send({ kind: "linkOpened", session, at: this.deps.now() });
  }

  linkSuccess(session: number, success: BankLinkSuccess): void {
    const fields = connectFields(success.institutionId, success.institutionName);
    this.send({ kind: "linkSuccess", session, success: { publicToken: success.publicToken, ...fields }, requestId: this.deps.newId(), at: this.deps.now() });
  }

  linkExit(session: number, error: boolean): void {
    this.send({ kind: "linkExit", session, error, at: this.deps.now() });
  }

  askDisconnect(connectorId: string): void {
    this.send({ kind: "disconnectPressed", connectorId, at: this.deps.now() });
  }

  notNow(): void {
    this.send({ kind: "disconnectNotNow", at: this.deps.now() });
  }

  confirmDisconnect(): void {
    this.send({ kind: "disconnectYes", requestId: this.deps.newId(), at: this.deps.now() });
  }

  private send(e: BankEvent): void {
    if (this.stopped) return;
    for (const c of this.apply(e)) this.run(c);
  }

  private apply(e: BankEvent): BankCommand[] {
    const before = this.state;
    const out = bankStep(before, e);
    this.state = out.state;
    if (this.state !== before) for (const l of this.listeners) l();
    return out.commands;
  }

  private run(c: BankCommand): void {
    const { api } = this.deps;
    switch (c.kind) {
      case "arm": {
        const epoch = this.epoch;
        const h = this.timers.setTimeout(() => {
          this.handles.delete(h);
          if (epoch === this.epoch) this.send({ kind: "tick", at: this.deps.now() });
        }, c.ms);
        this.handles.add(h);
        return;
      }
      case "readStatus":
        return void this.answer(readBankStatus(api), (answer, at) => ({ kind: "statusAnswered", seq: c.seq, answer, at }), { ok: false });
      case "requestLinkToken":
        return void this.answer(requestBankLinkToken(api), (answer, at) => ({ kind: "tokenAnswered", seq: c.seq, answer, at }), { ok: false, why: "failed" });
      case "connect": {
        const body = { requestId: c.requestId, publicToken: c.publicToken, institutionId: c.institutionId, institutionName: c.institutionName };
        return void this.answer(connectBank(api, body), (answer, at) => ({ kind: "connectAnswered", seq: c.seq, answer, at }), { ok: false, why: "unknown" });
      }
      case "sync":
        return void this.answer(syncBank(api, { connectorId: c.connectorId }), (answer, at) => ({ kind: "syncAnswered", seq: c.seq, connectorId: c.connectorId, answer, at }), { ok: false });
      case "disconnect":
        return void this.answer(disconnectBank(api, { requestId: c.requestId, connectorId: c.connectorId }), (answer, at) => ({ kind: "disconnectAnswered", seq: c.seq, answer, at }), {
          ok: false,
          why: "unknown",
        });
      default:
        c satisfies never;
    }
  }

  /** Awaits one call and sends its answer; a call that throws is answered with `onThrow`. */
  private async answer<A>(call: Promise<A>, event: (answer: A, at: number) => BankEvent, onThrow: A): Promise<void> {
    const epoch = this.epoch;
    let a: A;
    try {
      a = await call;
    } catch {
      a = onThrow;
    }
    if (epoch !== this.epoch) return;
    this.send(event(a, this.deps.now()));
  }
}
