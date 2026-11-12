/**
 * Wave B of voice-control on the server: company, quiet and alone (R14, R15.1; design "Wave B: company, quiet, the
 * swap and alone", "Audience effects in the transaction"; questions 68, 79, 81). Brief 026, tasks 48 to 51.
 *
 * The routes keep one call at each seam:
 *   - `/api/turn`: `narrowedHere` answers every turn on a narrowed Session `blocked` (row 1); `precompileAudienceHead`
 *     compiles the Head a parse may move to before the transaction; `audienceEffect` gives the Session, core/epoch and
 *     core/bundle writes of the rule's outcome inside it.
 *   - `/api/session/open`: `inheritedAudience` carries a narrowed audience into the fresh call; `swapLineInput` is the
 *     admission input of the swap line.
 *   - `/api/session/close`: `errorCloseCarry` keeps a narrowed audience across a reconnect.
 * Every deadline is a named constant at its designed value (question 54).
 */
import {
  type Au,
  COMPANY_LINE,
  ALONE_LINE,
  type CoreBundle,
  type CoreEpoch,
  type CoreRules,
  type CoreState,
  type Hasher,
  type Head,
  type ID,
  type RuleInput,
  type RuleOutcome,
  type Session,
  msFromTs,
  tsFromMs,
  utf8,
} from "@franki/core";
import { effectiveAudience, expireLease } from "./audience";
import { ownerClock } from "./core-docs";
import { buildHead } from "./head-build";
import { DECK_TTL_MS } from "./sessions";
import type { SlowParse } from "./intents/slow-parse";
import { paths } from "./store/paths";
import { readSnapshot } from "./store/port";
import type { RouteContext } from "./routes/runtime";

/** Row 8: how long the narrowed audience waits for the fresh call's open (question 81). */
export const SWAP_WAIT_MS = 10_000;
/** Row 6: the swap waits for the care reply, so the audience waits longer (R14.7; question 81). */
export const CARE_SWAP_WAIT_MS = 60_000;
/** An error close of a non-private Session: the reconnect's open inherits the audience (R14.6; question 81). */
export const RECONNECT_WAIT_MS = 60_000;

const LIVE: readonly Session["status"][] = ["minting", "active", "closing"];

/**
 * This Session narrowed during itself (row 1; R14.5): a company or quiet hit, or a crisis line with company, set its
 * `waitDeadline`. A Session opened by inheritance starts with a null `waitDeadline`, so its own turns are admitted
 * under its narrow Head. Fails closed: any live Session with a deadline and a non-private audience is narrowed.
 */
export function narrowedHere(s: Session): boolean {
  return s.waitDeadline !== null && s.audience !== "private" && LIVE.includes(s.status);
}

/** The audience a parse may move the Session to, whose Head is compiled before the transaction; null for none. */
export function audienceTarget(slow: SlowParse | null): Au | null {
  if (slow === null || slow.parse.kind !== "hit") return null;
  const c = slow.parse.chosen;
  return c === "alone" ? "private" : c === "company" || c === "quiet" ? "company" : null;
}

export interface AudienceHead {
  audience: Au;
  head: Head;
  /** The core revisions the Head was compiled from; the transaction uses it only if they still hold. */
  rulesRev: number;
  epoch: number;
}

/** Compiles the target audience's Head from a lock-free snapshot, as open does (design "Alone"). */
export async function precompileAudienceHead(ctx: RouteContext, slow: SlowParse | null, generation: number): Promise<AudienceHead | null> {
  const audience = audienceTarget(slow);
  if (audience === null) return null;
  const { uid, deps } = ctx;
  return readSnapshot(deps.store, uid, async (reader) => {
    const [epoch, rules, state] = await Promise.all([
      reader.get<CoreEpoch>(paths.core(uid, "epoch")),
      reader.get<CoreRules>(paths.core(uid, "rules")),
      reader.get<CoreState>(paths.core(uid, "state")),
    ]);
    if (epoch === null || rules === null || state === null) return null;
    const compiled = await buildHead(reader, uid, { epoch: epoch.data, rules: rules.data }, ownerClock(state.data, deps.clock), generation, audience);
    return compiled.ok ? { audience, head: compiled.head, rulesRev: rules.data.rulesRev, epoch: epoch.data.epoch } : null;
  });
}

/** core/bundle with a new Head and bundleRev + 1, as open writes it. */
export function headBundle(bundle: CoreBundle, head: Head, rulesRev: number, opsNow: number, hasher: Pick<Hasher, "sha256">): CoreBundle {
  const now = tsFromMs(opsNow);
  return {
    ...bundle,
    state: "clean",
    bundleRev: bundle.bundleRev + 1,
    rulesRev,
    head,
    headHash: hasher.sha256(utf8(head.text)),
    selectedRefs: head.selectedRefs,
    compiledAt: now,
    expiresAt: tsFromMs(opsNow + DECK_TTL_MS),
    updatedAt: now,
  };
}

export interface AudienceEffect {
  /** Merged into the turn's one Session update. */
  session: Partial<Session>;
  /** core/epoch with policyRev + 1. */
  epoch: CoreEpoch;
  /** core/bundle with the new Head, or null when the Deck keeps its Head. */
  bundle: CoreBundle | null;
  /** Row 8: write the hangup Job and hang up after the response. */
  hangup: boolean;
}

export interface AudienceInput {
  sessionId: string;
  /** The Session's modifiers before this turn; row 6 adds crisis and keeps the rest. */
  modifiers: Session["modifiers"];
  epoch: CoreEpoch;
  bundle: CoreBundle;
  rules: CoreRules;
  opsNow: number;
  /** The Head compiled before the transaction, if any. */
  head: AudienceHead | null;
  /** Another write of this transaction already wrote core/bundle (the hardRule route): the Deck keeps that Head. */
  bundleWritten: boolean;
  hasher: Pick<Hasher, "sha256">;
}

/**
 * The audience effects of a wave B outcome (design "Audience effects in the transaction"):
 *   row 8, company or quiet with a live call: `company`, policyRev + 1, waitDeadline + 10 s, the Session `closing`,
 *     core/epoch's active Session cleared as `/api/session/close` does, and the hangup Job;
 *   row 6, crisis with company: `company`, policyRev + 1, waitDeadline + 60 s, the crisis modifier set, no hang-up;
 *   row 9, company with no call: `company`, policyRev + 1, and the narrow Head when it was compiled;
 *   row 10, alone: `private`, policyRev + 1 and the full Head; waitDeadline unchanged; a gap stays a gap.
 * Quiet is recorded as company (question 79). Anything else changes nothing: null.
 */
export function audienceEffect(o: RuleOutcome, x: AudienceInput): AudienceEffect | null {
  const ts = tsFromMs(x.opsNow);
  const raised: CoreEpoch = { ...x.epoch, policyRev: x.epoch.policyRev + 1, updatedAt: ts };
  const bundleFor = (audience: Au): CoreBundle | null =>
    x.head !== null && x.head.audience === audience && !x.bundleWritten && x.head.rulesRev === x.rules.rulesRev && x.head.epoch === x.epoch.epoch
      ? headBundle(x.bundle, x.head.head, x.rules.rulesRev, x.opsNow, x.hasher)
      : null;
  if (o.kind === "hold") {
    if (o.swap !== "now") return null;
    const clears = x.epoch.activeSessionId === x.sessionId;
    return {
      session: { audience: "company", waitDeadline: tsFromMs(x.opsNow + SWAP_WAIT_MS), status: "closing", browserState: "CLOSED" },
      epoch: clears ? { ...raised, activeSessionId: null, activeCallId: null } : raised,
      bundle: null,
      hangup: true,
    };
  }
  if (o.swap === "afterReply") {
    return { session: { audience: "company", waitDeadline: tsFromMs(x.opsNow + CARE_SWAP_WAIT_MS), modifiers: { ...x.modifiers, crisis: ts } }, epoch: raised, bundle: null, hangup: false };
  }
  if (o.line === COMPANY_LINE) return { session: { audience: "company" }, epoch: raised, bundle: bundleFor("company"), hangup: false };
  if (o.line === ALONE_LINE) return { session: { audience: "private" }, epoch: raised, bundle: bundleFor("private"), hangup: false };
  return null;
}

/**
 * The audience an open inherits from the Session it replaces (R14.8; design "Open with inheritance"): that Session's
 * audience when it is the Owner's (it was read under the Owner's uid), not private, and its `waitDeadline` has not
 * passed; else `private`. An expired parse lease counts as the failed repair it is (`unknown`).
 */
export function inheritedAudience(prev: Session | null, opsNow: number): { audience: Au; crisis: boolean } | null {
  if (prev === null || prev.waitDeadline === null || msFromTs(prev.waitDeadline) < opsNow) return null;
  const audience = effectiveAudience(expireLease(prev, opsNow), opsNow);
  return audience === "private" ? null : { audience, crisis: prev.modifiers.crisis !== null };
}

/**
 * Whether the inheriting open speaks the swap line (R14.3; question 81): only for a company audience, and never after
 * a crisis (R14.7). An inherited `unknown` (a reconnect while a parse was failing) starts narrow but silent.
 */
export const speaksSwapLine = (i: { audience: Au; crisis: boolean }): boolean => i.audience === "company" && !i.crisis;

/** The Server_Rule input of the swap line: row 9's shape, a typed company hit with no call (design "The swap line"). */
export const swapLineRule: RuleInput = {
  source: "typed",
  transcript: "final",
  judge: "typed",
  parse: { kind: "hit", chosen: "company", candidates: ["company"], uncertain: false, candidateP: { company: 1 } },
  regexMatch: false,
  audience: "company",
  narrowedHere: false,
  callLive: false,
  parseGap: false,
  noteSens: "none",
  wordsPer2s: true,
  allFinal: true,
  toolParseCommitted: false,
  wave: "B",
};

/** The swap line's turn ID: `H("swapline", sessionId)`. */
export const swapLineTurnId = (hasher: Pick<Hasher, "id">, sessionId: string): ID => hasher.id(["swapline", sessionId]) as ID;

/** An error close of a non-private Session keeps its audience for the reconnect; any other close changes nothing. */
export function errorCloseCarry(s: Session, reason: "user" | "replace" | "expired" | "error", opsNow: number): Partial<Session> | null {
  if (reason !== "error" || effectiveAudience(expireLease(s, opsNow), opsNow) === "private") return null;
  return { waitDeadline: tsFromMs(opsNow + RECONNECT_WAIT_MS) };
}
