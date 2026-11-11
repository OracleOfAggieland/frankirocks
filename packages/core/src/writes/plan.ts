/**
 * Plans: the closed Command subset the on-turn planners return (contracts §7, narrowed). Pure: a planner writes
 * nothing; the executor commits a Plan's Commands in the turn's transaction. The types live in `types.ts`.
 */
export type { Command, Plan, PlanEnv, PlanError } from "./types";
