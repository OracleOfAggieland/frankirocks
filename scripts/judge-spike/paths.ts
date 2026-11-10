/**
 * Where the judge spike keeps its files, relative to scripts/judge-spike. The audio folder is gitignored; the
 * results folder is committed. Paths take the spike folder as an argument, because the CLI runs from a bundle in
 * dist/ and `import.meta.url` would point there.
 */
import { join } from "node:path";

export type AudioSource = "synthetic" | "owner";
export const AUDIO_SOURCES: readonly AudioSource[] = ["synthetic", "owner"];

export const linesFile = (spikeDir: string): string => join(spikeDir, "lines.json");
export const resultsDir = (spikeDir: string): string => join(spikeDir, "results");
/** The folder for one audio source; takes are named `<lineId>.wav`. */
export const audioDir = (spikeDir: string, source: AudioSource): string => join(spikeDir, "audio", source);
export const wavPath = (spikeDir: string, source: AudioSource, lineId: string): string => join(audioDir(spikeDir, source), `${lineId}.wav`);
