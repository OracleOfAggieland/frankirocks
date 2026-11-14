/**
 * Brief 049 part C: the live registry's Google agents, loaded lazily so `agent.ts` and `google-agents.ts` (which
 * imports `run.ts`, which imports `agent.ts`) don't form an import cycle at module load.
 */
import type { ErrandAgent } from "./agent";
import { GOOGLE_ERRAND_AGENTS } from "./google-agents";

export const liveGoogleAgents = (): readonly ErrandAgent[] => GOOGLE_ERRAND_AGENTS;
