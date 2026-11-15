"use client";
// The live test runner (brief 050 part B, item 7). One step at a time, large type, keys for every action. Start
// posts `step.start`; Pass, Fail and Skip post `step.end` and move on; a note posts `note` with the step's ID.
// Results survive a reload (sessionStorage). Development only.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createBrowserClock } from "../../../client/clock";
import { randomId } from "../../../client/ids";
import { LIVE_TEST_PATH, Recorder, exitPost, fetchPost } from "../../../client/live-test/recorder";
import {
  BUILT_IN_SCRIPT,
  type RunnerAction,
  type RunnerState,
  type Script,
  type StepResult,
  ago,
  keyAction,
  parseScript,
  restoreRunner,
  applyRunnerAction,
  tally,
} from "../../../client/live-test/runner";
import { saveStepId } from "../../../client/live-test/step-key";

const STORE_KEY = "franki.liveTest.runner";
const STATUS_MS = 2_000;

interface Status {
  reached: boolean;
  active: boolean;
  run: string | null;
  events: number;
  words: number;
  lastAt: number | null;
}

const NO_STATUS: Status = { reached: false, active: false, run: null, events: 0, words: 0, lastAt: null };

function readStatus(body: unknown): { status: Status; script: Script | null } {
  const b = (body ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    status: {
      reached: true,
      active: b.active === true,
      run: typeof b.run === "string" ? b.run : null,
      events: n(b.events),
      words: n(b.words),
      lastAt: typeof b.lastAt === "number" ? b.lastAt : null,
    },
    script: parseScript(b.script),
  };
}

function loadStored(): unknown {
  try {
    const raw = window.sessionStorage.getItem(STORE_KEY);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveStored(s: RunnerState): void {
  try {
    window.sessionStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    // results last only this page load
  }
}

const RESULT_STYLE: Record<StepResult, string> = {
  pass: "bg-ecto text-night-0",
  fail: "bg-ember text-night-0",
  skip: "bg-stitch text-ink",
};
const RESULT_WORD: Record<StepResult, string> = { pass: "Pass", fail: "Fail", skip: "Skip" };

function clockTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function Runner() {
  const [clock] = useState(() => createBrowserClock());
  const epoch = useCallback(() => clock.read().opsClock.now - clock.offsetMs(), [clock]);
  const recorder = useRef<Recorder | null>(null);
  const [script, setScript] = useState<Script | null>(null);
  const [fromRun, setFromRun] = useState(false);
  const [state, setState] = useState<RunnerState | null>(null);
  const [status, setStatus] = useState<Status>(NO_STATUS);
  const [now, setNow] = useState(0);
  const [note, setNote] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const noteBox = useRef<HTMLTextAreaElement | null>(null);
  /** Epoch ms when the running step started, for its elapsed time; lost on reload. */
  const [startedAt, setStartedAt] = useState<{ step: string; at: number } | null>(null);
  const marks = useRef(0);

  // One recorder for the page, posting as the runner.
  useEffect(() => {
    const rec = new Recorder({
      clock: { mono: () => clock.mono(), epoch },
      pageId: randomId().slice(0, 12),
      src: "runner",
      post: fetchPost((input, init) => fetch(input, init)),
      postOnExit: exitPost((input, init) => fetch(input, init), null),
    });
    rec.start();
    recorder.current = rec;
    const onHide = () => rec.flushOnExit();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      rec.stop();
      void rec.flush();
      recorder.current = null;
    };
  }, [clock, epoch]);

  // The status line, every 2 s; the first answer also brings the script.
  useEffect(() => {
    let stopped = false;
    let first = true;
    const read = async () => {
      let next: Status = NO_STATUS;
      let found: Script | null = null;
      try {
        const r = await fetch(LIVE_TEST_PATH, { cache: "no-store" });
        if (r.ok) {
          const parsed = readStatus(await r.json());
          next = parsed.status;
          found = parsed.script;
        }
      } catch {
        // not reached
      }
      if (stopped) return;
      setStatus(next);
      setNow(epoch());
      if (first) {
        first = false;
        const chosen = found ?? BUILT_IN_SCRIPT;
        setScript(chosen);
        setFromRun(found !== null);
        setState(restoreRunner(chosen, loadStored()));
      }
    };
    void read();
    const timer = setInterval(() => void read(), STATUS_MS);
    const tick = setInterval(() => setNow(epoch()), 1_000);
    return () => {
      stopped = true;
      clearInterval(timer);
      clearInterval(tick);
    };
  }, [epoch]);

  useEffect(() => {
    if (state === null) return;
    saveStored(state);
    saveStepId(state.running);
  }, [state]);

  const act = useCallback(
    (a: RunnerAction) => {
      if (script === null || state === null) return;
      const r = applyRunnerAction(script, state, a);
      const rec = recorder.current;
      for (const p of r.posts) {
        if (p.kind === "step.start") {
          rec?.emit("step.start", { step: p.step, title: p.title });
          setStartedAt({ step: p.step, at: epoch() });
        } else {
          rec?.emit("step.end", { step: p.step, result: p.result });
          setStartedAt((s) => (s?.step === p.step ? null : s));
          setFlash(`${p.step} · ${RESULT_WORD[p.result]}`);
        }
      }
      if (r.posts.length > 0) void rec?.flush();
      setState(r.state);
    },
    [script, state, epoch],
  );

  const current = script !== null && state !== null ? script.steps[state.index] : undefined;
  const running = current !== undefined && state?.running === current.id;

  const sendNote = useCallback(() => {
    const text = note.trim();
    if (text === "" || current === undefined) return;
    recorder.current?.note(current.id, text);
    void recorder.current?.flush();
    setNote("");
    setFlash(`Note on ${current.id} saved`);
    act({ type: "noted" });
  }, [note, current, act]);

  const mark = useCallback(() => {
    marks.current += 1;
    const label = `${current?.id ?? "mark"} #${marks.current}`;
    recorder.current?.emit("mark", { label });
    void recorder.current?.flush();
    setFlash(`Mark ${label}`);
  }, [current]);

  // Keys, outside any text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const inText = el !== null && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.isContentEditable);
      const k = keyAction(e.key, { inText, modifier: e.ctrlKey || e.metaKey || e.altKey });
      if (k === null) return;
      // A focused button takes Enter as its own press; the page does not act twice.
      if (k === "startOrPass" && el?.tagName === "BUTTON") return;
      e.preventDefault();
      if (k === "startOrPass") act(running ? { type: "end", result: "pass" } : { type: "start" });
      else if (k === "fail") act({ type: "end", result: "fail" });
      else if (k === "skip") act({ type: "end", result: "skip" });
      else if (k === "back") act({ type: "back" });
      else if (k === "note") noteBox.current?.focus();
      else if (k === "mark") mark();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [act, running, mark]);

  useEffect(() => {
    if (flash === null) return;
    const t = setTimeout(() => setFlash(null), 2_500);
    return () => clearTimeout(t);
  }, [flash]);

  const counts = useMemo(() => (script !== null && state !== null ? tally(script, state) : null), [script, state]);
  const elapsed = running && startedAt !== null && startedAt.step === current?.id ? clockTime(now - startedAt.at) : null;
  // `now` re-renders the page every second so `elapsed` and the status line stay current.
  const lastAgo = status.lastAt === null ? "never" : ago(Math.max(0, now - status.lastAt));

  return (
    <main className="flex w-full flex-1 flex-col gap-6 px-6 py-6 text-left text-ink lg:px-10">
      <StatusLine status={status} lastAgo={lastAgo} title={script?.title ?? null} fromRun={fromRun} />

      {script === null || state === null || current === undefined ? (
        <p className="text-2xl text-ink-dim">Loading the script…</p>
      ) : (
        <div className="grid flex-1 gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <section aria-label="Current step" className="flex flex-col gap-6">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xl text-ink-dim">
              <span className="font-mono text-2xl text-brass-hi">{current.id}</span>
              {current.group === undefined ? null : <span>{current.group}</span>}
              <span>
                Step {state.index + 1} of {script.steps.length}
              </span>
              {current.account === undefined ? null : <span className="rounded border border-stitch px-2 py-0.5 text-lg text-ink">Account: {current.account}</span>}
              {state.results[current.id] === undefined ? null : (
                <span className={`rounded px-2 py-0.5 text-lg font-semibold ${RESULT_STYLE[state.results[current.id]!]}`}>{RESULT_WORD[state.results[current.id]!]}</span>
              )}
            </div>
            <h1 className="text-5xl leading-tight font-semibold text-ink">{current.title}</h1>

            <StepLines label="Do" items={current.do} />
            <StepLines label="Say" items={current.say} say />
            <StepLines label="Watch for" items={current.watch} />

            <div className="flex flex-wrap items-center gap-3 pt-2">
              {running ? (
                <Button tone="pass" keyHint="Enter" onClick={() => act({ type: "end", result: "pass" })}>
                  Pass
                </Button>
              ) : (
                <Button tone="start" keyHint="Enter" onClick={() => act({ type: "start" })}>
                  Start
                </Button>
              )}
              {running ? null : (
                <Button tone="plain" keyHint="" onClick={() => act({ type: "end", result: "pass" })}>
                  Pass
                </Button>
              )}
              <Button tone="fail" keyHint="F" onClick={() => act({ type: "end", result: "fail" })}>
                Fail
              </Button>
              <Button tone="plain" keyHint="S" onClick={() => act({ type: "end", result: "skip" })}>
                Skip
              </Button>
              <Button tone="plain" keyHint="B" onClick={() => act({ type: "back" })} disabled={state.index === 0}>
                Back
              </Button>
              <Button tone="plain" keyHint="M" onClick={mark}>
                Mark
              </Button>
              <span className="text-2xl text-ink-dim tabular-nums" aria-live="off">
                {running ? `Running ${elapsed ?? ""}` : "Not started"}
              </span>
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="live-test-note" className="text-xl text-ink-dim">
                Note on {current.id} <span className="text-base">(N to write, Enter to save, Esc to leave)</span>
                {(state.notes[current.id] ?? 0) > 0 ? <span className="text-base"> · {state.notes[current.id]} saved</span> : null}
              </label>
              <textarea
                id="live-test-note"
                ref={noteBox}
                value={note}
                rows={2}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendNote();
                  } else if (e.key === "Escape") {
                    e.currentTarget.blur();
                  }
                }}
                className="w-full rounded-lg border-2 border-stitch bg-night-1 px-4 py-3 text-2xl text-ink outline-none focus:border-brass"
              />
            </div>

            <p role="status" className="min-h-9 text-2xl font-semibold text-gold">
              {flash ?? ""}
            </p>
          </section>

          <nav aria-label="All steps" className="flex flex-col gap-3">
            {counts === null ? null : (
              <p className="text-lg text-ink-dim">
                {counts.pass} pass · {counts.fail} fail · {counts.skip} skip · {counts.open} open
              </p>
            )}
            <ol className="flex flex-col gap-1">
              {script.steps.map((s, i) => {
                const r = state.results[s.id];
                const here = i === state.index;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => act({ type: "go", index: i })}
                      aria-current={here ? "step" : undefined}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-lg ${here ? "bg-night-2 ring-2 ring-brass" : "hover:bg-night-1"}`}
                    >
                      <span className="w-12 shrink-0 font-mono text-brass-hi">{s.id}</span>
                      <span className="min-w-0 flex-1 truncate">{s.title}</span>
                      {state.running === s.id ? <span className="rounded bg-gold px-2 text-base font-semibold text-night-0">On</span> : null}
                      {r === undefined ? null : <span className={`rounded px-2 text-base font-semibold ${RESULT_STYLE[r]}`}>{RESULT_WORD[r]}</span>}
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>
        </div>
      )}
    </main>
  );
}

function StatusLine({ status, lastAgo, title, fromRun }: { status: Status; lastAgo: string; title: string | null; fromRun: boolean }) {
  const on = status.reached && status.active;
  return (
    <header className={`flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border-2 px-4 py-3 text-xl ${on ? "border-ecto/60" : "border-ember"}`}>
      <span className="flex items-center gap-2 font-semibold">
        <span aria-hidden className={`inline-block h-4 w-4 rounded-full ${on ? "bg-ecto" : "bg-ember"}`} />
        {on ? "Recording" : status.reached ? "Recorder off" : "Dev server not reached"}
      </span>
      {on ? (
        <>
          <span className="font-mono">{status.run ?? "(no run name)"}</span>
          <span className="tabular-nums">{status.events.toLocaleString()} events</span>
          <span className="tabular-nums">{status.words.toLocaleString()} words lines</span>
          <span>last event {lastAgo}</span>
        </>
      ) : (
        <span className="text-ink-dim">Start the app with node scripts/live-test/dev.mjs to record.</span>
      )}
      {title === null ? null : (
        <span className="ml-auto text-ink-dim">
          {title}
          {fromRun ? "" : " (built-in)"}
        </span>
      )}
    </header>
  );
}

function StepLines({ label, items, say = false }: { label: string; items: string[] | undefined; say?: boolean }) {
  if (items === undefined || items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-xl font-semibold tracking-wide text-ink-dim uppercase">{label}</h2>
      <ul className="flex flex-col gap-2">
        {items.map((line, i) => (
          <li key={i} className={say ? "border-l-4 border-brass pl-4 text-3xl leading-snug text-brass-hi" : "text-3xl leading-snug text-ink"}>
            {say ? `“${line}”` : line}
          </li>
        ))}
      </ul>
    </div>
  );
}

const TONES = {
  start: "bg-gold text-night-0 hover:bg-brass-hi",
  pass: "bg-ecto text-night-0 hover:bg-ghost",
  fail: "bg-ember text-night-0 hover:brightness-110",
  plain: "border-2 border-stitch bg-night-1 text-ink hover:border-ink-dim",
} as const;

function Button({ tone, keyHint, onClick, disabled = false, children }: { tone: keyof typeof TONES; keyHint: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-6 py-3 text-2xl font-semibold disabled:opacity-40 ${TONES[tone]}`}
    >
      {children}
      {keyHint === "" ? null : <span className="ml-2 text-base font-normal opacity-70">{keyHint}</span>}
    </button>
  );
}
