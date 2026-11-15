/**
 * The browser half of the live test recorder (brief 050 part B, item 1). Development only: App.tsx loads this
 * folder by dynamic import behind NEXT_PUBLIC_FRANKI_LIVE_TEST, so a production bundle never holds it.
 *
 * A queue of flat events. Each is stamped with `t` (epoch ms, from the browser clock port with the server offset
 * taken back out), `m` (ms since page load), `page` (one random ID per page load) and `seq` (a counter per page
 * load), then posted to `/api/dev/live-test` every second, or at once when 200 are waiting. A failed post keeps its
 * events (at most 5,000, oldest dropped first) and is tried again on the next tick. Nothing here ever throws into
 * the app.
 */

export const LIVE_TEST_PATH = "/api/dev/live-test";
export const FLUSH_MS = 1_000;
/** A post goes at once when this many events wait. */
export const BATCH_EVENTS = 200;
/** The route takes at most 500 events and 256 KB per post; stay well under both. */
export const POST_MAX_EVENTS = 200;
export const POST_MAX_BYTES = 200_000;
/** fetch with keepalive caps the body at 64 KB. */
export const EXIT_MAX_BYTES = 60_000;
/** Events kept while the route cannot be reached. */
export const MAX_QUEUE = 5_000;
/** A words line longer than this is cut (a transcript is short; this only bounds a runaway). */
export const MAX_WORDS = 8_000;
/** Any other string field is cut to this. */
export const MAX_FIELD = 300;

export type EventValue = string | number | boolean | string[];
export type LiveEvent = Record<string, EventValue>;
export type Fields = Record<string, unknown>;

export interface RecorderClock {
  /** Local monotonic ms since the page's time origin. */
  mono(): number;
  /** Epoch ms of the page's local clock (no server offset). */
  epoch(): number;
}

export interface RecorderTimers {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

/** What a post came to: `inactive` when the route answered that the recorder is off. */
export type PostResult = "ok" | "failed" | "inactive";

export interface RecorderDeps {
  clock: RecorderClock;
  pageId: string;
  /** One POST of `{"events":[…]}`. Must not throw; a throw counts as a failure. */
  post(body: string): Promise<PostResult>;
  /** A last post at page hide (fetch keepalive or sendBeacon). Must not throw. */
  postOnExit?(body: string): void;
  timers?: RecorderTimers;
  /** The runner's current step, if one is known in this browser, put on words lines. */
  step?: () => string | null;
  /** `client` for the app's window, `runner` for the /live-test page. */
  src?: "client" | "runner";
}

const isWordsKind = (kind: string) => kind.startsWith("words.") || kind === "note";

/** Keeps only the values the event line allows: strings (capped), finite numbers, booleans, string arrays. */
export function cleanFields(fields: Fields, cap = MAX_FIELD): LiveEvent {
  const out: LiveEvent = {};
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === "string") out[k] = v.length > cap ? v.slice(0, cap) : v;
    else if (typeof v === "number") {
      if (Number.isFinite(v)) out[k] = v;
    } else if (typeof v === "boolean") out[k] = v;
    else if (Array.isArray(v) && v.every((x) => typeof x === "string")) out[k] = (v as string[]).slice(0, 50).map((x) => (x.length > cap ? x.slice(0, cap) : x));
  }
  return out;
}

/** ms with one decimal. */
export const oneDecimal = (ms: number): number => Math.round(ms * 10) / 10;

/** Splits events into posts that fit the route's limits. */
export function chunks(events: readonly LiveEvent[], maxEvents = POST_MAX_EVENTS, maxBytes = POST_MAX_BYTES): LiveEvent[][] {
  const out: LiveEvent[][] = [];
  let cur: LiveEvent[] = [];
  let bytes = 0;
  for (const e of events) {
    const size = JSON.stringify(e).length + 1;
    if (cur.length > 0 && (cur.length >= maxEvents || bytes + size > maxBytes)) {
      out.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(e);
    bytes += size;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

const liveTimers: RecorderTimers = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};

export class Recorder {
  private queue: LiveEvent[] = [];
  private seq = 0;
  private sending = false;
  private inactive = false;
  private dropped = 0;
  private timer: unknown = null;
  private readonly timers: RecorderTimers;

  constructor(private readonly deps: RecorderDeps) {
    this.timers = deps.timers ?? liveTimers;
  }

  /** Starts the one-second flush. */
  start(): void {
    if (this.timer !== null) return;
    this.guard(() => {
      this.timer = this.timers.setInterval(() => void this.flush(), FLUSH_MS);
    });
  }

  stop(): void {
    if (this.timer === null) return;
    this.guard(() => this.timers.clearInterval(this.timer));
    this.timer = null;
  }

  /** Whether the route has said the recorder is off; then nothing more is queued. */
  get off(): boolean {
    return this.inactive;
  }

  get waiting(): number {
    return this.queue.length;
  }

  /** One event line. IDs, times, counts and enums only: callers never pass words here. */
  emit(kind: string, fields: Fields = {}): void {
    if (isWordsKind(kind)) return;
    this.guard(() => this.push(kind, cleanFields(fields)));
  }

  /** The runner's note on a step: a words line of kind `note`. */
  note(step: string, text: string): void {
    this.guard(() => this.push("note", { step, text: text.length > MAX_WORDS ? text.slice(0, MAX_WORDS) : text }));
  }

  /** One words line (`words.owner`, `words.franki`, `words.typed`). The only place text goes. */
  words(kind: "words.owner" | "words.franki" | "words.typed", text: string, fields: Fields = {}): void {
    this.guard(() => {
      const step = this.deps.step?.() ?? null;
      const clean = cleanFields(fields);
      this.push(kind, { ...clean, text: text.length > MAX_WORDS ? text.slice(0, MAX_WORDS) : text, ...(step === null ? {} : { step }) });
    });
  }

  private push(kind: string, fields: LiveEvent): void {
    if (this.inactive) return;
    const m = this.deps.clock.mono();
    const e: LiveEvent = { ...fields, t: Math.round(this.deps.clock.epoch()), src: this.deps.src ?? "client", kind, m: oneDecimal(m), page: this.deps.pageId, seq: this.seq++ };
    this.queue.push(e);
    if (this.queue.length > MAX_QUEUE) {
      const over = this.queue.length - MAX_QUEUE;
      this.queue.splice(0, over);
      this.dropped += over;
    }
    if (this.queue.length >= BATCH_EVENTS) void this.flush();
  }

  /** Posts what waits, one post at a time. A failed post puts its events back at the front. */
  async flush(): Promise<void> {
    if (this.sending || this.inactive || this.queue.length === 0) return;
    this.sending = true;
    try {
      while (this.queue.length > 0 && !this.inactive) {
        this.noteDropped();
        const batch = chunks(this.queue)[0]!;
        this.queue.splice(0, batch.length);
        let result: PostResult;
        try {
          result = await this.deps.post(JSON.stringify({ events: batch }));
        } catch {
          result = "failed";
        }
        if (result === "inactive") {
          this.inactive = true;
          this.queue = [];
          this.stop();
          return;
        }
        if (result === "failed") {
          this.queue = [...batch, ...this.queue];
          if (this.queue.length > MAX_QUEUE) {
            const over = this.queue.length - MAX_QUEUE;
            this.queue.splice(0, over);
            this.dropped += over;
          }
          return;
        }
      }
    } catch {
      // never into the app
    } finally {
      this.sending = false;
    }
  }

  /** Page hide: one last post of what fits, by keepalive. What does not fit is lost. */
  flushOnExit(): void {
    this.guard(() => {
      if (this.inactive || this.queue.length === 0 || this.deps.postOnExit === undefined) return;
      this.noteDropped();
      const batch = chunks(this.queue, POST_MAX_EVENTS, EXIT_MAX_BYTES)[0]!;
      this.queue.splice(0, batch.length);
      this.deps.postOnExit(JSON.stringify({ events: batch }));
    });
  }

  /** A count of events lost to the queue cap goes out as its own event, once per loss. */
  private noteDropped(): void {
    if (this.dropped === 0) return;
    const n = this.dropped;
    this.dropped = 0;
    const m = this.deps.clock.mono();
    this.queue.push({ t: Math.round(this.deps.clock.epoch()), src: this.deps.src ?? "client", kind: "recorder.dropped", n, m: oneDecimal(m), page: this.deps.pageId, seq: this.seq++ });
  }

  private guard(f: () => void): void {
    try {
      f();
    } catch {
      // never into the app
    }
  }
}

/** The live post: plain fetch to the dev route (no ApiClient, so it is never observed or authorized). */
export function fetchPost(fetchFn: typeof fetch): (body: string) => Promise<PostResult> {
  return async (body) => {
    try {
      const r = await fetchFn(LIVE_TEST_PATH, { method: "POST", headers: { "content-type": "application/json" }, body, cache: "no-store", credentials: "same-origin" });
      if (!r.ok) return "failed";
      let answer: unknown = null;
      try {
        answer = await r.json();
      } catch {
        return "failed";
      }
      const a = answer as { ok?: unknown; active?: unknown } | null;
      if (a?.ok === true) return "ok";
      if (a?.ok === false && a.active === false) return "inactive";
      return "failed";
    } catch {
      return "failed";
    }
  };
}

/** The page-hide post: fetch with keepalive, falling back to sendBeacon. */
export function exitPost(fetchFn: typeof fetch, beacon: ((url: string, data: Blob) => boolean) | null): (body: string) => void {
  return (body) => {
    try {
      void fetchFn(LIVE_TEST_PATH, { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true, credentials: "same-origin" }).catch(() => {});
    } catch {
      try {
        beacon?.(LIVE_TEST_PATH, new Blob([body], { type: "application/json" }));
      } catch {
        // lost
      }
    }
  };
}
