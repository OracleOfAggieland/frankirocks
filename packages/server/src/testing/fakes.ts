/**
 * Test doubles for routes: a fake token verifier, a recording `schedule`, virtual-time timers on the fake
 * Clock_Port, and a deps bundle on the Memory_Store with Fake_OpenAI. No network, no wall clock.
 */
import { type FakeClock, createFakeClock } from "@franki/core";
import type { TokenVerifier } from "../auth/guard";
import type { Timers } from "../clock/timers";
import { createHasher } from "../crypto";
import { FakeOpenAI } from "../openai/fake";
import { type HttpInput, type Log, type RouteDeps, type RouteSpec, type Schedule, runRoute } from "../routes/runtime";
import { MemoryStore } from "../store/memory-store";
import type { StorePort } from "../store/port";

export const FAKE_HMAC_KEY = "test-only-franki-id-hmac-key-0000000000000";
export const T0_MS = Date.UTC(2026, 10, 3, 12);
export const TEST_ENV = {
  FRANKI_BRAIN_MODEL: "test-brain-model",
  FRANKI_BG_MODEL: "test-bg-model",
  FRANKI_VOICE_MODEL: "test-voice-model",
  FRANKI_TRANSCRIBE_MODEL: "test-transcribe-model",
  OPENAI_API_KEY: "test-not-a-key",
  NODE_ENV: "test",
};

/** Accepts tokens of the form `token:<uid>`; anything else (including `revoked:<uid>`) is rejected. */
export function fakeTokenVerifier(): TokenVerifier & { calls: number } {
  const v = {
    calls: 0,
    async verify(token: string) {
      v.calls++;
      const m = /^token:(.+)$/.exec(token);
      if (m === null) throw new Error("invalid token");
      return { uid: m[1]! };
    },
  };
  return v;
}

export interface RecordingSchedule {
  schedule: Schedule;
  /** Number of scheduled jobs not yet run. */
  readonly pending: number;
  /** Runs scheduled work in order, including work scheduled while running, until none is left. */
  runAll(): Promise<void>;
}

export function recordingSchedule(): RecordingSchedule {
  const queue: (() => Promise<unknown>)[] = [];
  return {
    schedule: (work) => {
      queue.push(work);
    },
    get pending() {
      return queue.length;
    },
    async runAll() {
      while (queue.length > 0) await queue.shift()!();
    },
  };
}

export interface FakeTimers extends Timers {
  /** Sleeps not yet resolved. */
  readonly pending: number;
  /** Advances the fake opsClock to the earliest pending sleep and resolves every sleep that is due. */
  fireNext(): boolean;
}

/** Virtual-time timers: a sleep resolves only when `fireNext` (or `settle`) moves the fake clock past it. */
export function fakeTimers(clock: FakeClock): FakeTimers {
  const sleepers: { due: number; resolve: () => void }[] = [];
  return {
    sleep(ms) {
      return new Promise<void>((resolve) => sleepers.push({ due: clock.read().opsClock.now + Math.max(0, ms), resolve }));
    },
    get pending() {
      return sleepers.length;
    },
    fireNext() {
      if (sleepers.length === 0) return false;
      const now = clock.read().opsClock.now;
      const next = Math.min(...sleepers.map((s) => s.due));
      if (next > now) clock.advance(next - now);
      for (let i = sleepers.length - 1; i >= 0; i--) {
        if (sleepers[i]!.due <= clock.read().opsClock.now) sleepers.splice(i, 1)[0]!.resolve();
      }
      return true;
    },
  };
}

const flush = () => new Promise<void>((r) => setImmediate(r));

/**
 * Runs `work` on virtual time: lets promises settle, and when nothing else can progress, fires the next timer.
 * Returns the result and the opsClock time that passed. Throws if `work` is stuck with no timer left.
 */
export async function settle<T>(work: Promise<T>, clock: FakeClock, timers: FakeTimers): Promise<{ value: T; elapsedMs: number }> {
  const start = clock.read().opsClock.now;
  let done = false;
  let value: T | undefined;
  let failure: { error: unknown } | null = null;
  work.then(
    (v) => {
      done = true;
      value = v;
    },
    (error: unknown) => {
      done = true;
      failure = { error };
    },
  );
  for (let i = 0; i < 100_000; i++) {
    for (let j = 0; j < 20 && !done; j++) await flush();
    if (done) break;
    if (!timers.fireNext()) {
      for (let j = 0; j < 200 && !done; j++) await flush();
      if (!done) throw new Error("settle: work is stuck with no pending timer");
    }
  }
  if (failure !== null) throw (failure as { error: unknown }).error;
  return { value: value as T, elapsedMs: clock.read().opsClock.now - start };
}

export interface TestRig {
  deps: RouteDeps;
  store: MemoryStore;
  clock: FakeClock;
  timers: FakeTimers;
  openai: FakeOpenAI;
  tokens: ReturnType<typeof fakeTokenVerifier>;
  logs: { event: string; fields: Record<string, unknown> }[];
  sched: RecordingSchedule;
}

export function testRig(env: Record<string, string> = TEST_ENV): TestRig {
  const hasher = createHasher(FAKE_HMAC_KEY);
  const store = new MemoryStore(hasher);
  const clock = createFakeClock({ world: T0_MS, ops: T0_MS, zone: "UTC" });
  const timers = fakeTimers(clock);
  const openai = new FakeOpenAI();
  const tokens = fakeTokenVerifier();
  const logs: TestRig["logs"] = [];
  const log: Log = (event, fields) => logs.push({ event, fields });
  return {
    deps: { store, clock, hasher, openai, env, timers, tokens, log },
    store,
    clock,
    timers,
    openai,
    tokens,
    logs,
    sched: recordingSchedule(),
  };
}

export interface FakeRequestInit {
  method?: string;
  url?: string;
  token?: string | null;
  origin?: string | null;
  body?: unknown;
  rawBody?: string;
}

/** An HttpInput for runRoute. Defaults: POST from localhost with a valid token for owner-1. */
export function fakeRequest(init: FakeRequestInit = {}): HttpInput {
  const headers = new Map<string, string>();
  const token = init.token === undefined ? "token:owner-1" : init.token;
  if (token !== null) headers.set("authorization", `Bearer ${token}`);
  const origin = init.origin === undefined ? "http://localhost:3000" : init.origin;
  if (origin !== null) headers.set("origin", origin);
  const text = init.rawBody ?? (init.body === undefined ? "" : JSON.stringify(init.body));
  return {
    method: init.method ?? "POST",
    url: init.url ?? "http://localhost:3000/api/test",
    header: (name) => headers.get(name.toLowerCase()) ?? null,
    text: async () => text,
  };
}

/** Calls a route through runRoute on virtual time. Returns status, body and the opsClock time it took. */
export async function callRoute<Req>(
  rig: TestRig,
  spec: RouteSpec<Req>,
  body: unknown,
  init: Omit<FakeRequestInit, "body"> = {},
): Promise<{ status: number; body: any; elapsedMs: number }> {
  const { value, elapsedMs } = await settle(runRoute(spec, fakeRequest({ ...init, body }), rig.deps, rig.sched.schedule), rig.clock, rig.timers);
  return { status: value.status, body: value.body, elapsedMs };
}

/** Runs every scheduled job on virtual time. */
export async function runScheduled(rig: TestRig): Promise<void> {
  await settle(rig.sched.runAll(), rig.clock, rig.timers);
}

/** Replaces a stored record with `patch` applied (test setup only). */
export async function patchRecord<T extends object>(store: StorePort, uid: string, path: string, patch: Partial<T>): Promise<void> {
  await store.transaction(uid, async (tx) => {
    const doc = await tx.get<T>(path);
    if (doc === null) throw new Error(`patchRecord: ${path} is missing`);
    tx.update(path, { ...doc.data, ...patch });
  });
}

/** A Store_Port whose transactions fail after running their body while `failing` returns true. */
export function failingStore(inner: StorePort, failing: (uid: string) => boolean): StorePort {
  return {
    get: (uid, path) => inner.get(uid, path),
    query: (uid, spec) => inner.query(uid, spec),
    transaction: (uid, fn) =>
      inner.transaction(uid, async (tx) => {
        const result = await fn(tx);
        if (failing(uid)) throw new Error("injected commit failure");
        return result;
      }),
  };
}
