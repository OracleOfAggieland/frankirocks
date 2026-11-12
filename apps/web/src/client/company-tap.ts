/**
 * The company toggle's tap (brief 044, item 3; spec line 211: company is set by the owner's words or a tap).
 *
 * A press posts one trusted tap to `/api/turn`: `source: "trustedTap"`, `uiControl: { verb, targetIds: [] }`, no
 * words and no audio, on the call's Session while a call is open, else on the typed Session (opened if none is).
 * A tap is not a Turn, so it takes no clientSeq: the route ignores it, and the next one is sent as 1.
 *
 * The toggle shows the audience the server last confirmed, never its own guess: `company` changes only when a tap's
 * answer comes back, and stays as it was while one is in flight or after one fails.
 */
import { type SS, TurnResponse, type Infer, tsFromMs, validate } from "@franki/core";
import { COPY } from "../ui/copy";
import type { ApiClient } from "./api";

export const TAP_TIMEOUT_MS = 10_000;
/** A tap names no clientSeq of its own: the route reads none, and the wire needs one of at least 1. */
export const TAP_CLIENT_SEQ = 1;

export interface CompanyTapState {
  /** What the server last confirmed: true after a company tap's answer, false before any and after an alone one. */
  company: boolean;
  sending: boolean;
  error: string | null;
}

export interface CompanyTapDeps {
  api: ApiClient;
  newId: () => string;
  /** The world clock now, in ms, through the clock port: the tap's `utteredWorldAt`. */
  worldNow: () => number;
  /**
   * The Stamp to tap on: the call's (its Session and the held Deck's revisions) while a call is open, `typed: false`;
   * else the typed Session's, opening one if none is open, `typed: true`. A string says why there is none (a call
   * between Sessions, or an open that failed): the tap is not sent.
   */
  stampFor: () => Promise<{ stamp: SS; typed: boolean } | string>;
  /** Told the typed Session's Stamp after a tap answered on it, so the next typed line is not stale. */
  adoptTypedStamp: (stamp: SS) => void;
}

type TurnRes = Infer<typeof TurnResponse>;

export class CompanyTap {
  private state: CompanyTapState = { company: false, sending: false, error: null };
  private listeners = new Set<() => void>();

  constructor(private readonly deps: CompanyTapDeps) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): CompanyTapState => this.state;

  /** One press. Returns false when nothing was confirmed. */
  async tap(verb: "company" | "alone"): Promise<boolean> {
    if (this.state.sending) return false;
    this.set({ sending: true, error: null });
    const target = await this.deps.stampFor();
    if (typeof target === "string") return this.fail(target);
    const turnId = this.deps.newId();
    let current = target.stamp;
    for (let attempt = 0; attempt < 2; attempt++) {
      // A stale answer recorded nothing, so the second send is a new request.
      const res = await this.post(current, verb, this.deps.newId(), turnId);
      if (res === null) return this.fail(COPY.company.noAnswer);
      const next: SS = { sessionId: res.stamp.sessionId, epoch: res.stamp.epoch, policyRev: res.stamp.policyRev, bundleRev: res.stamp.bundleRev, rulesRev: res.stamp.rulesRev, generation: res.stamp.generation };
      if (target.typed) this.deps.adoptTypedStamp(next);
      if (res.status === "stale") {
        current = next;
        continue;
      }
      this.set({ company: verb === "company", sending: false, error: null });
      return true;
    }
    return this.fail(COPY.company.movedOn);
  }

  /** Signed out, a reset or a forget: nothing the server said about the last visit stays. */
  clear(): void {
    this.set({ company: false, sending: false, error: null });
  }

  private async post(stamp: SS, verb: "company" | "alone", requestId: string, turnId: string): Promise<TurnRes | null> {
    const body = {
      ...stamp,
      turnId,
      requestId,
      clientSeq: TAP_CLIENT_SEQ,
      source: "trustedTap",
      items: [],
      utteredWorldAt: tsFromMs(this.deps.worldNow()),
      transcript: "",
      transcriptState: "final",
      judge: "typed",
      pendingId: null,
      choiceId: null,
      supersedesRequestId: null,
      uiControl: { verb, targetIds: [] },
    };
    const r = await this.deps.api.call<unknown>("/api/turn", { body, timeoutMs: TAP_TIMEOUT_MS });
    if (!r.ok) return null;
    const v = validate(TurnResponse, r.body);
    if (!v.ok) return null;
    const res = v.value as TurnRes;
    return res.error === null ? res : null;
  }

  private fail(message: string): false {
    this.set({ sending: false, error: message });
    return false;
  }

  private set(patch: Partial<CompanyTapState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }
}
