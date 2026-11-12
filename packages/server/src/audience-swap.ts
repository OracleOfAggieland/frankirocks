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
  type ClockPair,
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
  type RuleParse,
  OPEN_LIMIT_MS,
  SWAP_LIMIT_MS,
  type Session,
  crisisFires,
  msFromTs,
  narrowsAudience,
  tsFromMs,
  utf8,
} from "@franki/core";
import { effectiveAudience, expireLease } from "./audience";
import { ownerClock } from "./core-docs";
import { buildHead } from "./head-build";
import { DECK_TTL_MS } from "./sessions";
import type { SlowParse } from "./intents/slow-parse";
import { paths } from "./store/paths";
import { ensureHangupJob } from "./worker/hangup";
import { type Tx, readSnapshot } from "./store/port";
import type { RouteContext } from "./routes/runtime";

/**
 * Row 8: how long the narrowed audience waits for the fresh call's open (question 81). Brief 035 (finding 6): set from
 * the browser's own limits, its swap limit plus one open, so the open of a swap the browser still runs is never late.
 */
export const SWAP_WAIT_MS = SWAP_LIMIT_MS + OPEN_LIMIT_MS;
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
  // Brief 035 (finding 4): a retained company or quiet candidate may narrow whatever was chosen.
  if (slow.parse.candidates.includes("company") || slow.parse.candidates.includes("quiet")) return "company";
  return slow.parse.chosen === "alone" ? "private" : null;
}

export interface AudienceHead {
  audience: Au;
  head: Head;
  /** The core revisions the Head was compiled from; the transaction uses it only if they still hold. */
  rulesRev: number;
  epoch: number;
}

/** Compiles the target audience's Head from a lock-free snapshot, as open does (design "Alone"). */
export async function precompileAudienceHead(ctx: Pick<RouteContext, "uid" | "deps">, slow: SlowParse | null, generation: number): Promise<AudienceHead | null> {
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
  /** core/epoch with the raised policyRev the route passed in. */
  epoch: CoreEpoch;
  /** core/bundle with the new Head, or null when the Deck keeps its Head. */
  bundle: CoreBundle | null;
  /** Row 8: write the hangup Job and hang up after the response. */
  hangup: boolean;
  /**
   * Brief 035: the audience whose Head the Deck must now carry, or null when the Deck may keep its Head. When it is
   * set and `bundle` is null, `withNarrowHead` compiles that Head in the transaction, and if it can't, no Deck goes out.
   */
  wantsHead?: Au | null;
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

/** Which audience row an outcome is (rows 6 to 10, and row 7 with company or quiet), or null for none. */
export function audienceRow(o: RuleOutcome): "hangup" | "care" | "company" | "careNoCall" | "alone" | null {
  if (o.kind === "hold") return o.swap === "now" ? "hangup" : null;
  if (o.swap === "afterReply") return "care";
  if (o.line === COMPANY_LINE) return "company";
  if (o.line === ALONE_LINE) return "alone";
  return o.line === null && o.reasons.includes("audience") ? "careNoCall" : null;
}

/**
 * The audience effects of a wave B outcome (design "Audience effects in the transaction"):
 *   row 8, company or quiet with a live call: `company`, policyRev raised, waitDeadline + 10 s, the Session `closing`,
 *     core/epoch's active Session cleared as `/api/session/close` does, and the hangup Job;
 *   row 6, crisis with company: `company`, policyRev raised, waitDeadline + 60 s, the crisis modifier set, no hang-up;
 *   row 9, company with no call: `company`, policyRev raised, and the narrow Head when it was compiled;
 *   row 10, alone: `private`, policyRev raised and the full Head; waitDeadline unchanged; a gap stays a gap.
 * Quiet is recorded as company (question 79). Anything else changes nothing: null.
 * Brief 035: every audience outcome changes what is said, so this is where the turn raises policyRev; the rule
 * decides the outcome, and a company or quiet candidate that fires narrows whatever was chosen (finding 4).
 */
export function audienceEffect(o: RuleOutcome, x: AudienceInput): AudienceEffect | null {
  const ts = tsFromMs(x.opsNow);
  if (audienceRow(o) === null) return null;
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
  if (o.line === COMPANY_LINE) return { session: { audience: "company" }, epoch: raised, bundle: bundleFor("company"), hangup: false, wantsHead: "company" };
  // Brief 035 (finding 3): row 7 with company or quiet and no call (a typed crisis line): company, policyRev raised,
  // the crisis modifier and the narrow Head; no hang-up and no swap wait, since no call is open.
  if (o.line === null && o.reasons.includes("audience")) return { session: { audience: "company", modifiers: { ...x.modifiers, crisis: ts } }, epoch: raised, bundle: bundleFor("company"), hangup: false, wantsHead: "company" };
  if (o.line === ALONE_LINE) return { session: { audience: "private" }, epoch: raised, bundle: bundleFor("private"), hangup: false };
  return null;
}

/**
 * The audience an open inherits from the Session it replaces (R14.8; design "Open with inheritance"): that Session's
 * audience when it is the Owner's (it was read under the Owner's uid) and not private; else `private`. An expired
 * parse lease counts as the failed repair it is (`unknown`).
 * Brief 035 (finding 5): a Session opened, or narrowed, with a non-private audience and no `waitDeadline` passes it
 * on whether or not a close came first; only the Owner's own close makes it private (`userCloseCarry`). Finding 6:
 * once a set wait has expired, a non-private Session passes on `unknown`, never `private`.
 */
export function inheritedAudience(prev: Session | null, opsNow: number): { audience: Au; crisis: boolean; crisisAt: Session["modifiers"]["crisis"] } | null {
  if (prev === null) return null;
  const audience = effectiveAudience(expireLease(prev, opsNow), opsNow);
  if (audience === "private") return null;
  // Brief 035 (finding 6): an expired wait never yields private. It yields unknown, the S0 Head with no swap line.
  const expired = prev.waitDeadline !== null && msFromTs(prev.waitDeadline) < opsNow;
  return { audience: expired ? "unknown" : audience, crisis: prev.modifiers.crisis !== null, crisisAt: prev.modifiers.crisis };
}

/** The inheriting Session: the fresh one with the inherited audience and, brief 035 (finding 13), the crisis modifier. */
export const inheritedSession = (fresh: Session, i: NonNullable<ReturnType<typeof inheritedAudience>>): Session => ({
  ...fresh,
  audience: i.audience,
  modifiers: { ...fresh.modifiers, crisis: i.crisisAt },
});

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

/**
 * The Owner's own close (reason `user`) of a non-private Session ends what it passes on (finding 5): the Session
 * records `private`, so an open naming it starts private (R14.8). Any other close changes nothing here.
 */
export function userCloseCarry(s: Session, reason: "user" | "replace" | "expired" | "error"): Partial<Session> | null {
  return reason === "user" && s.audience !== "private" ? { audience: "private" } : null;
}

/** An error close of a non-private Session keeps its audience for the reconnect; any other close changes nothing. */
export function errorCloseCarry(s: Session, reason: "user" | "replace" | "expired" | "error", opsNow: number): Partial<Session> | null {
  if (reason !== "error" || effectiveAudience(expireLease(s, opsNow), opsNow) === "private") return null;
  return { waitDeadline: tsFromMs(opsNow + RECONNECT_WAIT_MS) };
}

// ---------------------------------------------------------------------------------------------
// Brief 035: the review of the audience wave. Every door a company or quiet hit comes in by narrows, and fails closed.

/** Row 8's Session fields: company, the swap wait, and the Session moved to `closing` as a close does. */
const closingFields = (opsNow: number): Partial<Session> => ({ audience: "company", waitDeadline: tsFromMs(opsNow + SWAP_WAIT_MS), status: "closing", browserState: "CLOSED" });

export interface LateNarrowingInput {
  sessionId: string;
  /** The Session as this transaction will write it, before the narrowing. */
  session: Session;
  parse: RuleParse;
  judge: RuleInput["judge"];
  epoch: CoreEpoch;
  bundle: CoreBundle;
  rules: CoreRules;
  opsNow: number;
  head: AudienceHead | null;
  hasher: Pick<Hasher, "sha256">;
}

/**
 * The narrowing of a hit that commits after its answer was sent: by the Parse_Repair (finding 1) or a
 * Superseding_Post (finding 2). Nothing is spoken late, so there is no care reply to wait for:
 *   a live call: row 8 (company, policyRev raised, the swap wait, `closing`, the hangup Job), and the crisis modifier
 *     when crisis fired too, so the next call opens with care;
 *   no call: company, policyRev raised, the crisis modifier, and the narrow Head in the Deck;
 *   a Session already narrowed here: only the crisis modifier.
 * A company or quiet candidate that fires narrows whatever was chosen (finding 4). Null when nothing narrows.
 */
export function lateNarrowing(x: LateNarrowingInput): AudienceEffect | null {
  if (x.parse.kind !== "hit" || !narrowsAudience(x.parse, x.judge)) return null;
  const s = x.session;
  const modifiers = crisisFires(x.parse, x.judge) ? { ...s.modifiers, crisis: tsFromMs(x.opsNow) } : s.modifiers;
  if (narrowedHere(s)) return { session: { modifiers }, epoch: x.epoch, bundle: null, hangup: false, wantsHead: null };
  // A narrowing changes what is said: policyRev + 1 cancels older speech and Decks (KV05).
  const raised: CoreEpoch = { ...x.epoch, policyRev: x.epoch.policyRev + 1, updatedAt: tsFromMs(x.opsNow) };
  if (s.registeredCallIds.length > 0 && LIVE.includes(s.status)) {
    const clears = x.epoch.activeSessionId === x.sessionId;
    return { session: { ...closingFields(x.opsNow), modifiers }, epoch: clears ? { ...raised, activeSessionId: null, activeCallId: null } : raised, bundle: null, hangup: true, wantsHead: null };
  }
  const open = s.status === "minting" || s.status === "active";
  const fits = x.head !== null && x.head.audience === "company" && x.head.rulesRev === x.rules.rulesRev && x.head.epoch === x.epoch.epoch;
  return {
    session: { audience: "company", modifiers },
    epoch: raised,
    bundle: open && fits ? headBundle(x.bundle, x.head!.head, x.rules.rulesRev, x.opsNow, x.hasher) : null,
    hangup: false,
    wantsHead: open ? "company" : null,
  };
}

/**
 * Fails closed when the Head compiled before the transaction no longer fits (the rules or the epoch moved): the
 * Head `wantsHead` names is compiled here, in the transaction. If even that fails, the effect keeps a null bundle
 * and `deckAllowed` sends no Deck.
 */
export async function withNarrowHead(
  tx: Pick<Tx, "get" | "query">,
  uid: string,
  eff: AudienceEffect | null,
  x: { epoch: CoreEpoch; rules: CoreRules; bundle: CoreBundle; clock: ClockPair; generation: number; opsNow: number; hasher: Pick<Hasher, "sha256">; bundleWritten?: boolean },
): Promise<AudienceEffect | null> {
  if (eff === null || eff.bundle !== null || (eff.wantsHead ?? null) === null || x.bundleWritten === true) return eff;
  const compiled = await buildHead(tx, uid, { epoch: x.epoch, rules: x.rules }, x.clock, x.generation, eff.wantsHead!);
  return compiled.ok ? { ...eff, bundle: headBundle(x.bundle, compiled.head, x.rules.rulesRev, x.opsNow, x.hasher) } : eff;
}

/** Whether an answer may carry a Deck after this effect: never when it hangs up (finding 11), nor when the Head it needs is missing. */
export const deckAllowed = (eff: AudienceEffect | null): boolean => eff === null || (!eff.hangup && ((eff.wantsHead ?? null) === null || eff.bundle !== null));

/**
 * A turn on a Session narrowed here (finding 7): it answers `blocked` and is kept, and a crisis line in it sets the
 * crisis modifier, so the next call opens with care; a company line there changes nothing more. Empty otherwise.
 */
export function swapWindowCare(s: Session, rule: RuleInput, opsNow: number): Partial<Session> {
  if (!narrowedHere(s) || rule.parse.kind !== "hit" || !crisisFires(rule.parse, rule.judge)) return {};
  return { modifiers: { ...s.modifiers, crisis: s.modifiers.crisis ?? tsFromMs(opsNow) } };
}

/**
 * A company or quiet turn on a Session an open already replaced (finding 8): the open closed it, so the turn would
 * answer stale and the hit would be lost. Such a turn is kept as one in the swap window is, and narrows.
 */
export const replacedNarrowing = (s: Session, activeSessionId: string | null, sessionId: string, parse: RuleParse | null, judge: RuleInput["judge"]): boolean =>
  (s.status === "closing" || s.status === "closed") && !narrowedHere(s) && activeSessionId !== sessionId && parse !== null && parse.kind === "hit" && narrowsAudience(parse, judge);

/**
 * The carry of a replaced Session's narrowing (finding 8), in the turn's transaction: policyRev + 1; the replaced
 * Session records company with the swap wait, so an open naming it inherits it; and the Owner's active Session,
 * if it is live and still private, gets row 8 (company, the swap wait, `closing`, the hangup Job), since its call
 * was opened on the private Head. Returns the replaced Session's fields and the active Session's hangup Job.
 */
export async function carryNarrowing(
  tx: Tx,
  uid: string,
  x: { sessionId: string; session: Session; parse: RuleParse; judge: RuleInput["judge"]; epoch: CoreEpoch; opsNow: number; hasher: Hasher },
): Promise<{ self: Partial<Session>; epoch: CoreEpoch; hangupJob: ID | null } | null> {
  if (x.parse.kind !== "hit" || !narrowsAudience(x.parse, x.judge)) return null;
  const crisis = crisisFires(x.parse, x.judge) ? tsFromMs(x.opsNow) : null;
  // A narrowing changes what is said: policyRev + 1 cancels older speech and Decks (KV05).
  let epoch: CoreEpoch = { ...x.epoch, policyRev: x.epoch.policyRev + 1, updatedAt: tsFromMs(x.opsNow) };
  const activeId = x.epoch.activeSessionId;
  let hangupJob: ID | null = null;
  const b = activeId === null || activeId === x.sessionId ? null : await tx.get<Session>(paths.session(uid, activeId));
  if (b !== null && LIVE.includes(b.data.status) && effectiveAudience(b.data, x.opsNow) === "private") {
    const modifiers = crisis === null ? b.data.modifiers : { ...b.data.modifiers, crisis };
    tx.update(b.path, { ...b.data, ...closingFields(x.opsNow), modifiers, updatedAt: tsFromMs(x.opsNow) });
    epoch = { ...epoch, activeSessionId: null, activeCallId: null };
    hangupJob = await ensureHangupJob(tx, uid, activeId as ID, b.data.rev, x.opsNow, x.hasher);
  }
  tx.update(paths.core(uid, "epoch"), epoch);
  const self: Partial<Session> = { audience: "company", waitDeadline: tsFromMs(x.opsNow + SWAP_WAIT_MS), ...(crisis === null ? {} : { modifiers: { ...x.session.modifiers, crisis } }) };
  return { self, epoch, hangupJob };
}
