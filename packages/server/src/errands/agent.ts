/**
 * Brief 049 part A, ruling 6: the agent registry. The framework knows nothing about Google or any provider: an agent
 * is an ID, what it is about, a fixed instruction text, a set of tools and a check of whether it can run for this
 * owner now. The `about` set of a `start_errand` call picks the agents, and the helper gets the union of their tools.
 *
 * Live, the registry holds the Google mail and calendar agents of part C when Google is configured (`errandAgentsOf`),
 * and is empty otherwise (`PRODUCTION_ERRAND_AGENTS`): with no agent for what was asked, `start_errand` answers
 * `unavailable`. Tests pass their own through `RouteDeps.errandAgents`.
 */
import { ERRAND_ABOUT, type SpecialistCatalog } from "@franki/core";
import { dialConfig } from "../phone/twilio";
import type { Class, ErrandAbout, ErrandSender, ErrandSource, ID, Sens } from "@franki/core";
import type { RouteContext } from "../routes/runtime";
import { googleConfigured } from "../google/config";
import { demoEnabled } from "../demo/switch";
import { liveGoogleAgents } from "./google-registry";

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
  /**
   * Review fix R5: aborted once the tool has answered or the run has stopped (owner ruling, Nov 19: a tool has no
   * deadline of its own). A tool passes it to its own requests; after it aborts, `read` registers nothing and
   * answers null, since the tool's output no longer reaches the planner.
   */
  signal: AbortSignal;
  read(r: ErrandReadInput): string | null;
  /** The forget epoch the Errand was claimed under. */
  epoch: number;
  /**
   * Review fix T11: this claim's own scratch, made by the runner when the claim starts and discarded when it ends.
   * An agent keeps its per-run state here (search refs, a read context, access tokens), never in module state.
   */
  scratch: Map<string, unknown>;
  /** How many more reads `read` registers in this run (`ERRAND_READS_MAX` in all). */
  readsLeft(): number;
  /** Review fix T8: tells the runner what a tool met, so code (not the planner) words an outcome with no line. */
  flag(f: ErrandToolFlag): void;
}

/**
 * Review fix T8: what a tool tells the runner. `read`: a read that answered (it found something or nothing);
 * `failed`: the provider couldn't be read; `expired`: the grant needs connecting again; `unresolved`: a time phrase
 * code couldn't place; `partial`: part of what was asked couldn't be read (a message that didn't load, a list cut
 * short); `unmailed`: a search found mail only shown to the runner, from someone the owner hasn't written to (owner
 * ruling, Nov 19: the mail agent no longer raises it, since such mail is now shown and may be said with its sender
 * named; `noticeOf` still words it for an agent that does).
 */
export const ERRAND_TOOL_FLAGS = ["read", "failed", "expired", "unresolved", "partial", "unmailed"] as const;
export type ErrandToolFlag = (typeof ERRAND_TOOL_FLAGS)[number];

export interface ErrandTool {
  name: string;
  description: string;
  /** A strict JSON Schema object for the tool's arguments. */
  parameters: Record<string, unknown>;
  /** Takes the model's parsed arguments and answers with bounded JSON. Throws on a failure it can't word. */
  run(ctx: ErrandToolContext, args: unknown): Promise<unknown>;
}

/** Review fix E11: `expired`: connected once, and the grant needs connecting again. */
export type ErrandAvailability = "ready" | "notConnected" | "expired" | "unavailable";

export interface ErrandAgent {
  id: string;
  about: ErrandAbout;
  /** Fixed text for the developer message. Never built from data. */
  instructions: string;
  tools: readonly ErrandTool[];
  available(ctx: RouteContext): Promise<ErrandAvailability>;
}

/** The registry with Google not configured (ruling 6): empty. With Google configured, `errandAgentsOf` adds part C's. */
export const PRODUCTION_ERRAND_AGENTS: readonly ErrandAgent[] = [];

/**
 * Brief 049 part C: live (deps unset), the Google mail and calendar agents are registered only when Google is
 * configured; each is still offered only while that owner's connector for it is readable (`available`).
 *
 * Brief 054: also when the demo may serve this request (the switch on, and not a verified real user), so a demo visit
 * on a deployment with no Google settings still reads its simulated mail and calendar. A real user's registry is
 * unchanged.
 */
export const errandAgentsOf = (ctx: RouteContext): readonly ErrandAgent[] =>
  ctx.deps.errandAgents ?? (googleConfigured(ctx.deps.env) || (demoEnabled(ctx.deps.env) && ctx.anonymous !== false) ? liveGoogleAgents() : PRODUCTION_ERRAND_AGENTS);

/**
 * Review fix R2: whether any agent is ready for this owner, so the call offers `start_errand`. False with an empty
 * registry (no read at all) and for an agent whose `available` throws. Agents keep `available` cheap: it runs on
 * every state poll, inside the poll's budget.
 */
export async function errandsReady(ctx: RouteContext): Promise<boolean> {
  const catalog = await specialistCatalog(ctx);
  return catalog.mail === "ready" || catalog.calendar === "ready";
}

export async function specialistCatalog(ctx: RouteContext): Promise<SpecialistCatalog> {
  const catalog: SpecialistCatalog = { phone: "unavailable", mail: "unavailable", calendar: "unavailable" };
  // Brief 054 (R14.1): a demo visit is never offered the phone, whatever the deployment's settings.
  if (ctx.anonymous !== true) {
    try {
      dialConfig(ctx.deps.env, ctx.origin);
      catalog.phone = "ready";
    } catch { /* Calling is unavailable until the dial and answering legs are configured. */ }
  }
  await Promise.all(agentsFor(errandAgentsOf(ctx), ERRAND_ABOUT).map(async (agent) => {
    catalog[agent.about] = await agent.available(ctx).catch(() => "unavailable" as const);
  }));
  return catalog;
}

/** The agents for an `about` set, one per value at most, in the set's order. */
export function agentsFor(all: readonly ErrandAgent[], about: readonly ErrandAbout[]): ErrandAgent[] {
  const out: ErrandAgent[] = [];
  for (const a of about) {
    const agent = all.find((x) => x.about === a);
    if (agent !== undefined) out.push(agent);
  }
  return out;
}
