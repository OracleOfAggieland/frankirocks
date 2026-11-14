/**
 * Brief 049 part A, ruling 6: the agent registry. The framework knows nothing about Google or any provider: an agent
 * is an ID, what it is about, a fixed instruction text, a set of tools and a check of whether it can run for this
 * owner now. The `about` set of a `start_errand` call picks the agents, and the helper gets the union of their tools.
 *
 * Production ships with the registry empty (`PRODUCTION_ERRAND_AGENTS`): with no agent for what was asked,
 * `start_errand` answers `unavailable`. Tests pass their own through `RouteDeps.errandAgents`.
 */
import type { Class, ErrandAbout, ErrandSender, ErrandSource, ID, Sens } from "@franki/core";
import type { RouteContext } from "../routes/runtime";

/**
 * What one read registers: the Evidence row it stored or found, what the agent knows of it, and what a card may show
 * of it. Review fix V1: the run's taint is decided from these, by code, over every read whose text went to the
 * planner, cited or not; so an agent registers every row whose text (a sender, a subject, a gist, a title) it puts
 * in a tool output, with `shown: true`, before it returns that output.
 */
export interface ErrandReadInput {
  evidenceId: ID;
  rev: number;
  /** The row's class as stored: `O` for the owner's own mail and events, `T` for anything from someone else. */
  cls: Class;
  sens: Sens;
  /** True when any of the row's text goes to the planner in this tool's output. */
  shown: boolean;
  /** For mail: who sent it, and whether the owner has mailed that address. Null for an event. */
  sender: ErrandSender | null;
  source: ErrandSource;
}

/** What a tool's executor gets. `read` registers Evidence the tool actually read and returns its ref for the model. */
export interface ErrandToolContext {
  route: RouteContext;
  errandId: ID;
  /** The assignment: the owner's own committed words, oldest first (ruling 2). */
  ownerWords: readonly string[];
  /** The ops time by which the tool must have answered. */
  deadlineAt: number;
  read(r: ErrandReadInput): string | null;
}

export interface ErrandTool {
  name: string;
  description: string;
  /** A strict JSON Schema object for the tool's arguments. */
  parameters: Record<string, unknown>;
  /** Takes the model's parsed arguments and answers with bounded JSON. Throws on a failure it can't word. */
  run(ctx: ErrandToolContext, args: unknown): Promise<unknown>;
}

export type ErrandAvailability = "ready" | "notConnected" | "unavailable";

export interface ErrandAgent {
  id: string;
  about: ErrandAbout;
  /** Fixed text for the developer message. Never built from data. */
  instructions: string;
  tools: readonly ErrandTool[];
  available(ctx: RouteContext): Promise<ErrandAvailability>;
}

/** The registry production ships with (ruling 6): empty until the agents of part C land. */
export const PRODUCTION_ERRAND_AGENTS: readonly ErrandAgent[] = [];

export const errandAgentsOf = (ctx: RouteContext): readonly ErrandAgent[] => ctx.deps.errandAgents ?? PRODUCTION_ERRAND_AGENTS;

/** The agents for an `about` set, one per value at most, in the set's order. */
export function agentsFor(all: readonly ErrandAgent[], about: readonly ErrandAbout[]): ErrandAgent[] {
  const out: ErrandAgent[] = [];
  for (const a of about) {
    const agent = all.find((x) => x.about === a);
    if (agent !== undefined) out.push(agent);
  }
  return out;
}
