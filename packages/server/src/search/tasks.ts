import {
  type Card, type CoreEpoch, type Ledger, type Session, type Stamp, type ToolResult, type Turn, type WebSearchArgs,
  ERRAND_RESULT_TTL_MS, msFromTs, sensFloor, tsFromMs,
} from "@franki/core";
import { gateAudience } from "../audience";
import { narrowedHere } from "../audience-swap";
import { assignmentTurnIds, ownerWordsTurn } from "../errands/assignment";
// Owner, Nov 19: with company mode off the owner's own final voice line is certain without judge O.
import { ownerSpeakerCertain } from "../company-off";
import { cFields } from "../records";
import type { RouteContext } from "../routes/runtime";
import { retryStale } from "../store/errors";
import { paths } from "../store/paths";
import type { StoredDoc, Tx } from "../store/port";
import { runWebSearch, type WebSearchResult } from "./specialist";

export type WebSearchEntry = Extract<Ledger, { kind: "webSearch" }>;
type Receipt = Extract<ToolResult, { name: "search_web" }>;
type ReadResult = Extract<ToolResult, { name: "read_web_result" }>;
export const WEB_SEARCH_RETAIN_MS = 60 * 60_000;
const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 2;
export const webSearchId = (ctx: RouteContext, stamp: Stamp) => ctx.deps.hasher.id(["webSearch", ctx.uid, stamp.sessionId, stamp.generation, stamp.turnId]);

function readable(s: Session, now: number) {
  const { audience, modifiers } = gateAudience(s, now);
  return (s.status === "active" || s.status === "minting") && !narrowedHere(s) && audience === "private" && !modifiers.crisis;
}

/** Reuse the existing kind/sessionId/at ledger index. Results never cross a generation, epoch or audience change. */
export async function latestWebSearch(tx: Tx, ctx: RouteContext, sessionId: string, session: Session, epoch: number) {
  const now = ctx.deps.clock.read().opsClock.now;
  if (!readable(session, now)) return null;
  const [row] = await tx.query<WebSearchEntry>({
    collection: paths.collection(ctx.uid, "ledger"),
    where: [{ field: "kind", op: "==", value: "webSearch" }, { field: "payload.sessionId", op: "==", value: sessionId }],
    orderBy: { field: "at", dir: "desc" }, limit: 1,
  });
  return row && row.data.epoch === epoch && row.data.payload.generation === session.generation &&
    row.data.retainUntil && msFromTs(row.data.retainUntil) > now ? row : null;
}

export function webSearchCards(ctx: RouteContext, row: StoredDoc<WebSearchEntry>): Card[] {
  return row.data.payload.findings.map((finding, i) => ({
    id: ctx.deps.hasher.id(["webSearchCard", row.id, i]), kind: "source", title: "Web search",
    lines: [finding.text], sources: [], sens: "S2", citations: finding.sources,
  }));
}

export async function readWebSearchView(tx: Tx, ctx: RouteContext, sessionId: string, session: Session, epoch: number) {
  const row = await latestWebSearch(tx, ctx, sessionId, session, epoch);
  const p = row?.data.payload;
  return {
    status: p?.status ?? "none" as const,
    cards: row ? webSearchCards(ctx, row) : [],
    offerId: row && !row.data.payload.delivered && p?.status !== "searching" &&
      (!p?.offer || msFromTs(p.offer.expiresAt) <= ctx.deps.clock.read().opsClock.now) ? row.id : null,
    resumeId: row && p?.status === "searching" && (!p.leaseUntil || msFromTs(p.leaseUntil) <= ctx.deps.clock.read().opsClock.now) ? row.id : null,
  };
}

export async function readWebResult(tx: Tx, ctx: RouteContext, sessionId: string, session: Session, epoch: number, requestId: string): Promise<ReadResult> {
  const row = await latestWebSearch(tx, ctx, sessionId, session, epoch);
  return { name: "read_web_result", requestId, taskId: row?.id ?? null, status: row?.data.payload.status ?? "none", findings: row?.data.payload.findings ?? [] };
}

const words = (text: string) => (text.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(" ");
function contains(text: string, excerpt: string): boolean {
  const phrase = words(excerpt);
  const source = text.replace(/\b(st|ft|mt|dr|mr|ms|mrs|u\.s|d\.c)\./gi, "$1");
  return phrase.length > 0 && source.split(/[!?;\n]|\.\s+(?=\p{Lu})/u).some((clause) => (" " + words(clause) + " ").includes(" " + phrase + " "));
}
const nearby = /\b(near\s+(me|us|here)|nearby|around\s+(me|here)|walking\s+distance|my\s+(area|neighbou?rhood))\b/i;
const privateDetail = /[\w.+-]+@[\w.-]+\.\w+|\b\d{3}[- ]\d{2}[- ]\d{4}\b|(?:\+?\d[\s().-]*){10,}|\b\d+\s+(?:[\p{L}]+\s+){1,5}(?:street|avenue|boulevard|road|lane|drive|court|st|ave|rd|dr|ln|blvd)\b/iu;
const vagueLocation = /^(here|there|nearby|local|downtown|near (me|here|us)|around (me|here)|my (city|location|area|neighbou?rhood))$/i;
const coordinates = /-?\d{1,3}\.\d{2,}\s*[, ]\s*-?\d{1,3}\.\d{2,}/;
const refersBack = /\b(it|there|they|them|its|their|that|those|these|the (?:place|venue|restaurant|event))\b/i;
const firstPerson = /\b(I|my|our|we|mine|ours)\b/i;

/** A resolved follow-up is a short previous public subject followed by a contiguous excerpt of this question. */
function groundedFollowUp(query: string, current: string, earlier: string[]): boolean {
  if (!refersBack.test(current)) return false;
  const terms = query.trim().split(/\s+/u);
  for (let i = 1; i < terms.length && i <= 8; i++) {
    const subject = terms.slice(0, i).join(" ");
    const question = terms.slice(i).join(" ");
    if (firstPerson.test(subject) || sensFloor(subject) !== "S0" || !contains(current, question)) continue;
    if (earlier.some((line) => contains(line, subject))) return true;
  }
  return false;
}

/** The model selects excerpts. Only a recent owner's public question and explicitly supplied coarse location leave the app. */
async function authorizedQuestion(tx: Tx, ctx: RouteContext, stamp: Stamp, current: Turn, args: WebSearchArgs) {
  const query = args.query.trim();
  const location = args.location?.trim() || null;
  if (!query || privateDetail.test(query) || coordinates.test(query) || (firstPerson.test(query) && sensFloor(query) === "S2")) return { error: "needsQuestion" } as const;
  if (location && (privateDetail.test(location) || coordinates.test(location) || vagueLocation.test(location) || firstPerson.test(location) ||
      !/^[\p{L}\p{M}\p{N} .,'’()/-]+$/u.test(location))) return { error: "needsLocation" } as const;
  const text = current.text!;
  const currentQuestion = contains(text, query);
  if (currentQuestion && (args.local || nearby.test(text)) && !location) return { error: "needsLocation" } as const;
  if (currentQuestion && (!location || contains(text, location))) return { query, location };
  // A location clarification can refer to the preceding question, and a new question can reuse the city just given.
  const ids = await assignmentTurnIds(tx, ctx.uid, stamp.sessionId, current, stamp.turnId);
  const recent = await Promise.all((ids ?? []).filter((id) => id !== stamp.turnId).map((id) => tx.get<Turn>(paths.turn(ctx.uid, stamp.sessionId, id))));
  const earlier = recent.filter((r) => r && ownerSpeakerCertain(r.data, ctx.deps.env)).map((r) => r!.data.text!);
  const clarifiedQuestion = location && contains(text, location) && earlier.find((line) => contains(line, query));
  if (!currentQuestion && !clarifiedQuestion && !groundedFollowUp(query, text, earlier)) return { error: "needsQuestion" } as const;
  if (!location && (args.local || nearby.test(text))) return { error: "needsLocation" } as const;
  if (location && ![text, ...earlier].some((line) => contains(line, location))) return { error: "needsLocation" } as const;
  return { query, location };
}

export async function prepareWebSearch(tx: Tx, ctx: RouteContext, stamp: Stamp, s: Session, turn: Turn, args: WebSearchArgs, timezone: string, requestId: string) {
  const result = (state: Receipt["state"], entry: WebSearchEntry | null = null): { result: Receipt; entry: WebSearchEntry | null } =>
    ({ result: { name: "search_web", requestId, state }, entry });
  const now = ctx.deps.clock.read().opsClock.now;
  if (!readable(s, now) || !ownerWordsTurn(turn) || turn.seq !== s.lastClientSeq || !ownerSpeakerCertain(turn, ctx.deps.env)) return result("unavailable");
  const question = await authorizedQuestion(tx, ctx, stamp, turn, args);
  if ("error" in question) return result(question.error!);
  const questionKey = ctx.deps.hasher.id(["webQuestion", ctx.uid, stamp.sessionId, words(question.query), words(question.location ?? "")]);
  const prior = await latestWebSearch(tx, ctx, stamp.sessionId, s, stamp.epoch);
  if (prior) {
    const p = prior.data.payload;
    const sameQuestion = p.questionKey === questionKey;
    if (p.status === "searching") return result(sameQuestion ? "alreadyRunning" : "busy");
    if (p.turnId === stamp.turnId) return result(sameQuestion ? "ready" : "previousReady");
    if (sameQuestion && p.status === "found" && now - msFromTs(prior.data.updatedAt) < ERRAND_RESULT_TTL_MS) return result("ready");
    if (!p.delivered && now - msFromTs(prior.data.updatedAt) < ERRAND_RESULT_TTL_MS) return result(sameQuestion ? "ready" : "previousReady");
  }
  const at = tsFromMs(Math.max(now, prior ? msFromTs(prior.data.at) + 1 : now));
  return result("started", {
    ...cFields(ctx.uid, at, stamp.epoch, stamp.policyRev), kind: "webSearch", at, state: "pending", retainUntil: tsFromMs(now + WEB_SEARCH_RETAIN_MS),
    payload: { sessionId: stamp.sessionId, turnId: stamp.turnId, generation: stamp.generation, questionKey, ...question, timezone,
      status: "searching", attempts: 0, leaseUntil: null, findings: [], delivered: false, offer: null },
  });
}

function finish(entry: WebSearchEntry, result: WebSearchResult, now: number): WebSearchEntry {
  return { ...entry, updatedAt: tsFromMs(now), state: result.status === "unavailable" ? "failed" : "complete",
    payload: { ...entry.payload, query: null, location: null, leaseUntil: null, status: result.status, findings: result.status === "found" ? result.findings : [] } };
}

/** A worker may outlive the requesting turn. Check the original session and epoch at both network boundaries. */
async function validTask(tx: Tx, ctx: RouteContext, row: WebSearchEntry, now: number) {
  const { sessionId, turnId, generation } = row.payload;
  const [s, e, t] = await Promise.all([tx.get<Session>(paths.session(ctx.uid, sessionId)), tx.get<CoreEpoch>(paths.core(ctx.uid, "epoch")), tx.get<Turn>(paths.turn(ctx.uid, sessionId, turnId))]);
  // An unrelated turn may have a temporary parse gap while the external search finishes.
  // Visibility is checked independently in latestWebSearch on every read and playback offer.
  return s && s.data.generation === generation && (s.data.status === "minting" || s.data.status === "active") &&
    !narrowedHere(s.data) && e && e.data.epoch === row.epoch && !e.data.barrier && row.retainUntil &&
    msFromTs(row.retainUntil) > now && t && ownerWordsTurn(t.data);
}

/** After-response execution. Only a single worker owns a live attempt. A later state poll recovers a lost worker. */
export async function runWebSearchTask(ctx: RouteContext, taskId: string) {
  const { deps, uid } = ctx;
  const path = paths.ledger(uid, taskId);
  const transact = <T>(fn: (tx: Tx) => Promise<T>) => retryStale(() => deps.store.transaction(uid, fn));
  const work = await transact(async (tx) => {
    const row = (await tx.get<WebSearchEntry>(path))?.data;
    const now = deps.clock.read().opsClock.now;
    if (row?.kind !== "webSearch" || row.payload.status !== "searching" || !row.payload.query) return null;
    const p = row.payload;
    if (p.leaseUntil && msFromTs(p.leaseUntil) > now) return null;
    if (!(await validTask(tx, ctx, row, now))) { tx.delete(path); return null; }
    if (p.attempts >= MAX_ATTEMPTS) { tx.update(path, finish(row, { status: "unavailable" }, now)); return null; }
    const attempt = p.attempts + 1;
    tx.update(path, { ...row, updatedAt: tsFromMs(now), payload: { ...p, attempts: attempt, leaseUntil: tsFromMs(now + LEASE_MS) } });
    return { attempt, input: { query: row.payload.query, location: p.location, timezone: p.timezone, requestedAt: msFromTs(row.at) } };
  });
  if (!work) return;
  const outcome = await runWebSearch(deps, work.input).catch(() => ({ status: "unavailable" } as const));
  await transact(async (tx) => {
    const row = (await tx.get<WebSearchEntry>(path))?.data;
    const now = deps.clock.read().opsClock.now;
    if (row?.kind !== "webSearch" || row.payload.status !== "searching" || row.payload.attempts !== work.attempt) return;
    if (!(await validTask(tx, ctx, row, now))) { tx.delete(path); return; }
    tx.update(path, finish(row, outcome, now));
  });
}
