/**
 * Extract drain (design "Extraction worker", "Draining"). Task 18 hook: a no-op until the extractor exists
 * (task 22 fills it in). Callers bound it: session open races it against 3,000 ms; close and /api/turn schedule it.
 */
import type { RouteDeps } from "../routes/runtime";

export async function drainExtractJobs(_uid: string, _deps: RouteDeps): Promise<void> {}
