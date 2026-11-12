/**
 * The recall tool's `inspect` purpose (brief 020; contracts §5 Recall readers "Inspect/overview=snapshot()"; spec
 * §15 "What do you know about me?" reads snapshot() and adds two recent told lines). No model call: the first
 * snapshot page goes back as the result's `snapshot`, and its two recent told lines as the notes. The tool route
 * limits both to S0 when the turn's admission allows S0 notes only.
 */
import { type Infer, type RecallResult, type ViewContext, type ViewRow, recallResult, snapshot } from "@franki/core";

export function inspectRecall(rows: readonly { id: string; memory: ViewRow["memory"] }[], ctx: ViewContext): Infer<typeof RecallResult> {
  const view = snapshot(rows.map((r) => ({ id: r.id as ViewRow["id"], memory: r.memory })), ctx, null);
  if (view === null) return recallResult([], "unknown", false);
  const notes = view.overview.recentTold.map((w) => ({ ...w, kind: "result" as const }));
  return { ...recallResult(notes, view.truncated ? "partial" : "complete", view.truncated), snapshot: view };
}
