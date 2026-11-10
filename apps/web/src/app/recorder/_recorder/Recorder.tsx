"use client";
// The judge spike recorder (brief 006 item 3). Shows one probe line at a time with Record, Stop, Play back and
// Next. A take is recorded with MediaRecorder, decoded and resampled by an AudioContext at 24 kHz, mixed to mono,
// encoded as 16-bit WAV and saved through PUT /api/dev/takes, which overwrites a retake. Development only.
import { SPIKE_SAMPLE_RATE, encodeWav, floatToPcm16 } from "@franki/core";
import { useCallback, useEffect, useRef, useState } from "react";

/** The post-build check looks for this string; it must never appear in a production build. */
export const RECORDER_SENTINEL_5e2d = "RECORDER_SENTINEL_5e2d";

const ROUTE = "/api/dev/takes";
/** Stop on its own after this long; a probe line is one breath. */
const MAX_TAKE_MS = 15_000;

interface Line {
  id: string;
  text: string;
  recorded: boolean;
}

type Status = { kind: "idle" } | { kind: "recording" } | { kind: "saving" } | { kind: "saved"; seconds: number } | { kind: "error"; message: string };

async function toWav(blob: Blob): Promise<{ wav: Uint8Array; seconds: number }> {
  const ctx = new AudioContext({ sampleRate: SPIKE_SAMPLE_RATE });
  try {
    const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
    const mono = new Float32Array(audio.length);
    for (let c = 0; c < audio.numberOfChannels; c++) {
      const data = audio.getChannelData(c);
      for (let i = 0; i < data.length; i++) mono[i]! += data[i]! / audio.numberOfChannels;
    }
    return { wav: encodeWav(floatToPcm16(mono), SPIKE_SAMPLE_RATE), seconds: audio.duration };
  } finally {
    await ctx.close();
  }
}

const button = "min-h-11 min-w-11 rounded-control px-4 text-sm disabled:opacity-40";

export function Recorder() {
  const [lines, setLines] = useState<Line[] | null>(null);
  const [index, setIndex] = useState(0);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [playback, setPlayback] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stopTimer = useRef<number | null>(null);

  useEffect(() => {
    let live = true;
    fetch(ROUTE, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`GET ${ROUTE} answered ${res.status}`);
        const body = (await res.json()) as { lines: Line[] };
        if (live) setLines(body.lines);
      })
      .catch((e: unknown) => {
        if (live) setStatus({ kind: "error", message: String(e) });
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => () => void (playback && URL.revokeObjectURL(playback)), [playback]);

  const line = lines?.[index] ?? null;

  const save = useCallback(
    async (lineId: string, blob: Blob) => {
      setStatus({ kind: "saving" });
      try {
        const { wav, seconds } = await toWav(blob);
        const wavBlob = new Blob([wav.slice().buffer], { type: "audio/wav" });
        setPlayback(URL.createObjectURL(wavBlob));
        const res = await fetch(`${ROUTE}?line=${encodeURIComponent(lineId)}`, { method: "PUT", headers: { "content-type": "audio/wav" }, body: wavBlob });
        if (!res.ok) throw new Error(`save answered ${res.status}`);
        setLines((ls) => ls?.map((l) => (l.id === lineId ? { ...l, recorded: true } : l)) ?? ls);
        setStatus({ kind: "saved", seconds });
      } catch (e) {
        setStatus({ kind: "error", message: String(e) });
      }
    },
    [],
  );

  const stop = useCallback(() => {
    if (stopTimer.current !== null) window.clearTimeout(stopTimer.current);
    stopTimer.current = null;
    recorder.current?.stop();
  }, []);

  const record = useCallback(async () => {
    if (line === null) return;
    setPlayback(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => {
        for (const t of stream.getTracks()) t.stop();
        recorder.current = null;
        void save(line.id, new Blob(chunks, { type: rec.mimeType }));
      };
      recorder.current = rec;
      rec.start();
      stopTimer.current = window.setTimeout(stop, MAX_TAKE_MS);
      setStatus({ kind: "recording" });
    } catch (e) {
      setStatus({ kind: "error", message: String(e) });
    }
  }, [line, save, stop]);

  const go = (step: number) => {
    if (lines === null) return;
    setPlayback(null);
    setStatus({ kind: "idle" });
    setIndex((i) => (i + step + lines.length) % lines.length);
  };

  const recorded = lines?.filter((l) => l.recorded).length ?? 0;
  const busy = status.kind === "recording" || status.kind === "saving";

  return (
    <section data-recorder={RECORDER_SENTINEL_5e2d} className="flex w-full flex-col gap-6 rounded-card bg-night-1 p-6">
      <p className="font-mono text-sm text-ink-dim">
        {lines === null ? "Loading lines…" : `${recorded} of ${lines.length} lines recorded`}
      </p>
      {line !== null ? (
        <div className="flex flex-col gap-2">
          <p className="font-mono text-xs text-ink-dim">
            {line.id} · {index + 1} of {lines!.length} · {line.recorded ? "has a take" : "no take yet"}
          </p>
          <p className="text-2xl text-ink">{line.text}</p>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <button type="button" className={`${button} bg-brass text-night-0`} disabled={line === null || busy} onClick={() => void record()}>
          Record
        </button>
        <button type="button" className={`${button} bg-ember text-night-0`} disabled={status.kind !== "recording"} onClick={stop}>
          Stop
        </button>
        <button type="button" className={`${button} border border-brass text-brass`} disabled={playback === null || busy} onClick={() => void new Audio(playback!).play()}>
          Play back
        </button>
        <button type="button" className={`${button} border border-ink-dim text-ink`} disabled={lines === null || busy} onClick={() => go(-1)}>
          Previous
        </button>
        <button type="button" className={`${button} border border-ink-dim text-ink`} disabled={lines === null || busy} onClick={() => go(1)}>
          Next
        </button>
      </div>
      <p role="status" className="text-sm text-ink-dim">
        {status.kind === "recording"
          ? "Recording. Say the line once, then press Stop."
          : status.kind === "saving"
            ? "Saving…"
            : status.kind === "saved"
              ? `Saved, ${status.seconds.toFixed(1)} s. Record again to replace it.`
              : status.kind === "error"
                ? `Something went wrong: ${status.message}`
                : ""}
      </p>
    </section>
  );
}
