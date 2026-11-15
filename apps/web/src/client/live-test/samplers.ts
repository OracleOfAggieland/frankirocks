/**
 * Brief 050 part B, item 4: frames, long tasks, the call's WebRTC stats, errors and visibility. The pure parts
 * (the frame window and the stats reading) are separate from the browser hooks and tested on their own.
 */
import { type Fields, MAX_FIELD, oneDecimal } from "./recorder";
import type { Sink } from "./taps";

export const FPS_WINDOW_MS = 2_000;
/** A frame longer than this counts as long. */
export const LONG_FRAME_MS = 50;
export const STATS_MS = 1_000;

// ---------------------------------------------------------------------------------------------
// Frames

/** One window of frame times. `add` takes each frame's timestamp; `take` ends the window. */
export function createFrameWindow() {
  let first: number | null = null;
  let last: number | null = null;
  let n = 0;
  let longest = 0;
  let long = 0;
  return {
    add(at: number): void {
      if (last !== null) {
        const d = at - last;
        n++;
        if (d > longest) longest = d;
        if (d > LONG_FRAME_MS) long++;
      } else first = at;
      last = at;
    },
    /** ms the window covers so far. */
    span(): number {
      return first === null || last === null ? 0 : last - first;
    },
    /** The window's numbers, or null with too few frames; then starts a new window at the last frame. */
    take(): Fields | null {
      const windowMs = first === null || last === null ? 0 : last - first;
      const out = n === 0 || windowMs <= 0 ? null : { avg: oneDecimal((n * 1000) / windowMs), min: oneDecimal(1000 / longest), long, n, windowMs: Math.round(windowMs) };
      first = last;
      n = 0;
      longest = 0;
      long = 0;
      return out;
    },
    /** Drops the window (the page was hidden). */
    reset(): void {
      first = null;
      last = null;
      n = 0;
      longest = 0;
      long = 0;
    },
  };
}

export interface FrameHost {
  requestAnimationFrame(fn: (at: number) => void): number;
  cancelAnimationFrame(id: number): void;
  visible(): boolean;
}

/** One requestAnimationFrame loop, writing `fps` every 2 s while the page is visible. */
export function sampleFrames(sink: Sink, host: FrameHost): () => void {
  const w = createFrameWindow();
  let id = 0;
  let stopped = false;
  const tick = (at: number) => {
    if (stopped) return;
    if (!host.visible()) w.reset();
    else {
      w.add(at);
      if (w.span() >= FPS_WINDOW_MS) {
        const f = w.take();
        if (f !== null) sink.emit("fps", f);
      }
    }
    id = host.requestAnimationFrame(tick);
  };
  id = host.requestAnimationFrame(tick);
  return () => {
    stopped = true;
    host.cancelAnimationFrame(id);
  };
}

/** Long tasks, where the browser reports them. */
export function sampleLongTasks(sink: Sink): () => void {
  if (typeof PerformanceObserver === "undefined") return () => {};
  try {
    if (!(PerformanceObserver.supportedEntryTypes ?? []).includes("longtask")) return () => {};
    const obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) sink.emit("longtask", { ms: Math.round(e.duration) });
    });
    obs.observe({ type: "longtask", buffered: false });
    return () => obs.disconnect();
  } catch {
    return () => {};
  }
}

// ---------------------------------------------------------------------------------------------
// WebRTC stats

type Stat = Record<string, unknown>;
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** The call quality numbers from one getStats report. Fields the browser does not report are left out. */
export function readStats(stats: Iterable<Stat>): Fields {
  const out: Fields = {};
  let pairRtt: number | undefined;
  let remoteRtt: number | undefined;
  for (const s of stats) {
    const kind = s.kind ?? s.mediaType;
    if (s.type === "media-source" && kind === "audio") {
      const v = num(s.audioLevel);
      if (v !== undefined) out.micLevel = Math.round(v * 1000) / 1000;
    } else if (s.type === "inbound-rtp" && kind === "audio") {
      const level = num(s.audioLevel);
      if (level !== undefined) out.inLevel = Math.round(level * 1000) / 1000;
      const jitter = num(s.jitter);
      if (jitter !== undefined) out.jitterMs = oneDecimal(jitter * 1000);
      const lost = num(s.packetsLost);
      if (lost !== undefined) out.lost = lost;
      const concealed = num(s.concealedSamples);
      if (concealed !== undefined) out.concealed = concealed;
      const delay = num(s.jitterBufferDelay);
      const emitted = num(s.jitterBufferEmittedCount);
      if (delay !== undefined && emitted !== undefined && emitted > 0) out.jitterBufferMs = oneDecimal((delay / emitted) * 1000);
    } else if (s.type === "candidate-pair" && (s.nominated === true || s.selected === true) && s.state === "succeeded") {
      const rtt = num(s.currentRoundTripTime);
      if (rtt !== undefined) pairRtt = rtt;
    } else if (s.type === "remote-inbound-rtp") {
      const rtt = num(s.roundTripTime);
      if (rtt !== undefined) remoteRtt = rtt;
    }
  }
  const rtt = pairRtt ?? remoteRtt;
  if (rtt !== undefined) out.rttMs = oneDecimal(rtt * 1000);
  return out;
}

interface StatsPeer {
  getStats(): Promise<{ forEach(fn: (s: Stat) => void): void }>;
}
const hasStats = (p: unknown): p is StatsPeer => typeof (p as { getStats?: unknown } | null)?.getStats === "function";

interface Listenable {
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
}
const listenable = (x: unknown): x is Listenable => typeof (x as { addEventListener?: unknown } | null)?.addEventListener === "function";

/**
 * Follows the call's peer connection and data channel: `rt.state` on every change of the data channel, the
 * connection and ICE, and `rtc.stats` every second while the peer lives. `link(null, null)` stops it.
 */
export function createLinkWatch(sink: Sink, timers: { setInterval(fn: () => void, ms: number): unknown; clearInterval(h: unknown): void }) {
  let off: (() => void)[] = [];
  const stop = () => {
    for (const f of off) {
      try {
        f();
      } catch {
        // gone
      }
    }
    off = [];
  };
  const on = (target: unknown, type: string, fn: () => void) => {
    if (!listenable(target)) return;
    target.addEventListener(type, fn);
    off.push(() => target.removeEventListener(type, fn));
  };
  return {
    link(peer: unknown, channel: unknown): void {
      stop();
      if (peer === null) return;
      const p = peer as { connectionState?: unknown; iceConnectionState?: unknown };
      const state = (what: string, v: unknown) => {
        if (typeof v === "string") sink.emit("rt.state", { what, state: v });
      };
      state("pc", p.connectionState);
      state("ice", p.iceConnectionState);
      on(peer, "connectionstatechange", () => state("pc", p.connectionState));
      on(peer, "iceconnectionstatechange", () => state("ice", p.iceConnectionState));
      if (channel !== null) {
        const c = channel as { readyState?: unknown };
        state("dc", c.readyState);
        for (const type of ["open", "close", "closing", "error"]) on(channel, type, () => state("dc", c.readyState));
      }
      if (hasStats(peer)) {
        let reading = false;
        const h = timers.setInterval(() => {
          if (reading) return;
          reading = true;
          peer
            .getStats()
            .then((report) => {
              const list: Stat[] = [];
              report.forEach((s) => list.push(s));
              const f = readStats(list);
              if (Object.keys(f).length > 0) sink.emit("rtc.stats", f);
            })
            .catch(() => {})
            .finally(() => {
              reading = false;
            });
        }, STATS_MS);
        off.push(() => timers.clearInterval(h));
      }
    },
    stop,
  };
}

// ---------------------------------------------------------------------------------------------
// Errors and visibility

/** A message for an `error` line: a string, capped. */
export function errorMessage(v: unknown): string {
  let s: string;
  try {
    if (v instanceof Error) s = `${v.name}: ${v.message}`;
    else if (typeof v === "string") s = v;
    else s = String(v);
  } catch {
    s = "(unreadable)";
  }
  return s.length > MAX_FIELD ? s.slice(0, MAX_FIELD) : s;
}

/** window errors, unhandled rejections and console.error, and visibility changes. */
export function watchPage(sink: Sink, win: Window, doc: Document): () => void {
  const onError = (e: ErrorEvent) => sink.emit("error", { where: "window", message: errorMessage(e.error ?? e.message) });
  const onRejection = (e: PromiseRejectionEvent) => sink.emit("error", { where: "promise", message: errorMessage(e.reason) });
  const onVisibility = () => sink.emit("visibility", { state: doc.visibilityState });
  win.addEventListener("error", onError);
  win.addEventListener("unhandledrejection", onRejection);
  doc.addEventListener("visibilitychange", onVisibility);
  const original = console.error;
  let inside = false;
  const wrapped = (...args: unknown[]) => {
    if (!inside) {
      inside = true;
      try {
        sink.emit("error", { where: "console", message: errorMessage(args.map((a) => errorMessage(a)).join(" ")) });
      } catch {
        // never into the app
      } finally {
        inside = false;
      }
    }
    original.apply(console, args);
  };
  console.error = wrapped;
  return () => {
    win.removeEventListener("error", onError);
    win.removeEventListener("unhandledrejection", onRejection);
    doc.removeEventListener("visibilitychange", onVisibility);
    if (console.error === wrapped) console.error = original;
  };
}
