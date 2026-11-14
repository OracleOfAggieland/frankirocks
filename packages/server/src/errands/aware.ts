/**
 * Brief 049 part A, ruling 12: what a later turn's reply is told while an Errand of this Session runs, so the model
 * neither starts a second one nor guesses what it will find. Read-only, code-worded, S0, like `phone/aware.ts`.
 */
import { type ErrandAbout, type W, errandRunningNote, tsFromMs } from "@franki/core";
import { outsideTx } from "../forget/ack";
import type { RouteContext } from "../routes/runtime";
import { runningErrands } from "./records";

const NOTE_TTL_MS = 60_000;

/** The line for this Session's running Errands, or null when none runs. */
export async function errandRunningLine(ctx: RouteContext, sessionId: string): Promise<string | null> {
  const rows = await runningErrands(outsideTx(ctx.deps.store, ctx.uid), ctx.uid);
  const about = new Set<ErrandAbout>();
  for (const r of rows) if (r.data.sessionId === sessionId) for (const a of r.data.about) about.add(a);
  return about.size === 0 ? null : errandRunningNote([...about]);
}

/** Never throws: a turn is never lost to the errand line. */
export function errandRunningLineSafe(ctx: RouteContext, sessionId: string): Promise<string | null> {
  return errandRunningLine(ctx, sessionId).catch(() => null);
}

export function errandAwareNote(ctx: RouteContext, sessionId: string, turnId: string, text: string, opsNow: number): W {
  return {
    noteId: ctx.deps.hasher.id(["errand-running", sessionId, turnId]), rev: 1, kind: "result", text,
    rootKeys: [], dependsOn: [], sens: "S0", expiresAt: tsFromMs(opsNow + NOTE_TTL_MS), unprompted: false, momentId: null, tokens: [],
  };
}
