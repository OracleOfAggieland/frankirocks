/**
 * Resolve, the floor's version, pure (spec §8 step 4; contracts §5 ForgetResolveV1, §8 step 4). Code builds the
 * model's input, current-session turns first and then Memories of every status; the model (through a port with a
 * fake, `packages/server/src/forget/resolve-port.ts`) names the scope; code checks the answer. An exact match on
 * named candidates goes. Anything else (ambiguous, vague, a fragment under a second, an incomplete manifest, `none`,
 * an invalid answer) is held and asked, with neutral options, and removes nothing.
 */
import { evidenceFieldText } from "../evidence";
import { recallLineText } from "../recall";
import type { EID, ID, Ref, Span } from "../schema/primitives";
import { EID as EIDSchema, ID as IDSchema, Span as SpanSchema } from "../schema/primitives";
import type { CoreRules, Evidence, Memory } from "../schema/records";
import { type Infer, arr, bool, nullable, obj, oneOf, validate } from "../schema/v";
import { splitsSurrogate } from "../text";
import { SCOPE_OPTIONS_MAX, type ScopeCard, type ScopeReason } from "./receipt";

/** Contracts §5: 64 candidates a page; the floor scans at most 200 Memories; 32 committed turns. */
export const RESOLVE_PAGE = 64;
export const RESOLVE_FLOOR_MAX = 200;
export const RESOLVE_COMMITTED_MAX = 32;
export const RESOLVE_LABEL_MAX = 80;
/** Contracts §5: a fragment under one second before the request confirms first. */
export const FRAGMENT_CONFIRM_MS = 1_000;
/** A candidate is named when the request holds one of its label's words of this length or more (ruling F-5). */
export const NAMED_WORD_MIN = 3;
const STOP = new Set(["the", "and", "that", "this", "what", "about", "just", "said", "forget", "fact", "you", "your", "with", "from", "for", "was", "are", "have", "has", "had", "not", "but", "all", "any", "please"]);

export interface ResolveTurn {
  itemId: string;
  seq: number;
  eid: ID | null;
  text: string | null;
  state: "ready" | "pending" | "missing";
}

export interface ResolveCandidate {
  id: ID;
  entityIds: EID[];
  topicKey: ID;
  label: string;
  roots: Span[];
}

export interface ForgetResolveInputV1 {
  request: Span;
  committed: ResolveTurn[];
  candidates: ResolveCandidate[];
  protectedRuleIds: ID[];
}

export const ForgetResolveOutputV1 = obj({
  resolution: oneOf(["exact", "ambiguous", "none"]),
  remove: arr(SpanSchema, 64),
  candidateIds: arr(IDSchema, 64),
  entityIds: arr(EIDSchema, 16),
  topicKeys: arr(IDSchema, 16),
  needsMore: bool,
  clarification: nullable(obj({ reason: oneOf(["which_person", "which_topic", "which_time", "protected_rule"]), optionIds: arr(IDSchema, 4, 1) })),
});
export type ForgetResolveOutputV1 = Infer<typeof ForgetResolveOutputV1>;

export interface ResolveInputArgs {
  request: Span;
  requestText: string;
  /** This session's turns in committed order, the request turns left out (the request dies at the fence). */
  turns: readonly ResolveTurn[];
  /** Memories of every status, as read; at most RESOLVE_FLOOR_MAX + 1 to tell a complete scan. */
  memories: readonly { id: ID; memory: Memory }[];
  rules: CoreRules;
}

export interface ResolveManifest {
  input: ForgetResolveInputV1;
  /** Candidate ID to its Memory. */
  byId: ReadonlyMap<ID, { id: ID; memory: Memory }>;
  /** False when the scan did not exhaust the store: an exact answer is then not exact. */
  complete: boolean;
}

/** The first `max` UTF-16 units, cut at a character boundary. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = max;
  if (splitsSurrogate(text, end)) end--;
  return text.slice(0, end);
}

const words = (text: string) => (text.toLowerCase().replace(/’/g, "'").match(/[\p{L}\p{N}']+/gu) ?? []).filter((w) => w.length >= NAMED_WORD_MIN && !STOP.has(w));

function rootSpans(m: Memory): Span[] {
  return m.rootSlices.flatMap((s) => (s.start === null || s.end === null ? [] : [{ eid: s.eid, fieldPath: s.fieldPath, start: s.start, end: s.end, quote: "" }]));
}

export function resolveInput(a: ResolveInputArgs): ResolveManifest {
  const complete = a.memories.length <= RESOLVE_FLOOR_MAX;
  const scanned = a.memories.slice(0, RESOLVE_FLOOR_MAX);
  const committed = a.turns.slice(-RESOLVE_COMMITTED_MAX);
  const sessionEids = new Set(committed.flatMap((t) => (t.eid === null ? [] : [t.eid])));
  const requestWords = new Set(words(a.requestText));
  // Current-session segments first, then lexical overlap with the request, then ID: scores rank only.
  const ranked = scanned
    .map((m) => ({
      m,
      session: m.memory.rootSlices.some((s) => sessionEids.has(s.eid)) ? 1 : 0,
      lexical: words(recallLineText(m.memory)).filter((w) => requestWords.has(w)).length,
    }))
    .sort((x, y) => y.session - x.session || y.lexical - x.lexical || (x.m.id < y.m.id ? -1 : x.m.id > y.m.id ? 1 : 0))
    .slice(0, RESOLVE_PAGE)
    .map((r) => r.m);
  const byId = new Map(ranked.map((m) => [m.id, m]));
  return {
    input: {
      request: a.request,
      committed,
      candidates: ranked.map((m) => ({
        id: m.id,
        entityIds: m.memory.entityIds.slice(0, 8),
        topicKey: m.memory.topicIds[0] ?? m.memory.key,
        label: cut(recallLineText(m.memory), RESOLVE_LABEL_MAX),
        roots: rootSpans(m.memory).slice(0, 16),
      })),
      protectedRuleIds: a.rules.allergies.map((r) => r.id).slice(0, 64),
    },
    byId,
    complete,
  };
}

export type Resolution =
  | { kind: "exact"; targets: { id: ID; memory: Memory }[]; remove: Span[] }
  | { kind: "scopePending"; reason: ScopeReason; held: { id: ID; memory: Memory }[]; card: ScopeCard };

export interface CheckArgs {
  opId: ID;
  manifest: ResolveManifest;
  requestText: string;
  /** Milliseconds between the last fragment and the request, or null with no fragment. */
  fragmentGapMs: number | null;
  evidence: ReadonlyMap<ID, Evidence>;
  output: unknown;
}

function verifySpan(s: Span, evidence: ReadonlyMap<ID, Evidence>, allowed: ReadonlySet<ID>): boolean {
  if (!allowed.has(s.eid)) return false;
  const e = evidence.get(s.eid);
  if (e === undefined) return false;
  const text = evidenceFieldText(e, s.fieldPath);
  return text !== null && s.end > s.start && s.end <= text.length && text.slice(s.start, s.end) === s.quote;
}

const civil = (ts: string) => ts.slice(0, 10);

export function checkResolve(a: CheckArgs): Resolution {
  const pending = (reason: ScopeReason, held: { id: ID; memory: Memory }[]): Resolution => ({
    kind: "scopePending",
    reason,
    held,
    card: {
      opId: a.opId,
      reason,
      options: held.slice(0, SCOPE_OPTIONS_MAX).map((h, k) => ({ ordinal: k + 1, optionId: h.id, kind: h.memory.kind, saidOn: civil(h.memory.assertedAt) })),
    },
  });
  const v = validate(ForgetResolveOutputV1, a.output);
  if (!v.ok) return pending("invalid", []);
  const out = v.value;
  const protectedIds = new Set(a.manifest.input.protectedRuleIds);
  const named = out.candidateIds.filter((id) => !protectedIds.has(id)).flatMap((id) => {
    const m = a.manifest.byId.get(id);
    return m === undefined ? [] : [m];
  });
  const held = [...new Map(named.map((m) => [m.id, m])).values()];
  const allowed = new Set<ID>([
    ...a.manifest.input.committed.flatMap((t) => (t.eid === null ? [] : [t.eid])),
    ...a.manifest.input.candidates.flatMap((c) => c.roots.map((r) => r.eid)),
  ]);
  const remove = out.remove.filter((s) => verifySpan(s, a.evidence, allowed));
  if (a.fragmentGapMs !== null && a.fragmentGapMs < FRAGMENT_CONFIRM_MS) return pending("fragment", held);
  if (!a.manifest.complete || out.needsMore) return pending("incomplete", held);
  if (out.clarification !== null) return pending(out.clarification.reason === "protected_rule" ? "protectedRule" : "which", held);
  if (out.resolution === "ambiguous") return pending("which", held);
  if (held.length === 0 && remove.length === 0 && out.candidateIds.some((id) => protectedIds.has(id))) return pending("protectedRule", held);
  if (out.resolution === "none" || (held.length === 0 && remove.length === 0)) return pending("none", held);
  if (held.length > 1) {
    const request = new Set(words(a.requestText));
    const unnamed = held.some((h) => !words(recallLineText(h.memory)).some((w) => request.has(w)));
    if (unnamed) return pending("vague", held);
  }
  return { kind: "exact", targets: held, remove };
}

/** The Refs of a resolution's named targets, for the job's `candidateRefs`. */
export function targetRefs(r: Resolution): Ref[] {
  const rows = r.kind === "exact" ? r.targets : r.held;
  return rows.map((m) => ({ type: "memory" as const, id: m.id, rev: m.memory.rev }));
}
