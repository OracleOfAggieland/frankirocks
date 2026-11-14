/**
 * Builds a seed (brief 019 tasks 3 and 4). Pure: a fixture, a namespace, a zone and a clock go in; every Evidence,
 * Memory and Job row the seed writes comes out, grouped by line, or a `SeedLoadError` naming the failed check.
 * Nothing is written here, so a bad packet fails the load before any row exists.
 *
 * The rows are the ones a live write would make. A turn's ExtractV1 Items go through `planItem`, the extraction
 * worker's own planner, against a packet holding that turn alone (`open: []`, no earlier turns). Every span is
 * checked exactly against its Evidence text with `verifySpan`, without the worker's few-character repair. Every
 * record is checked against its closed schema, and every Memory against W-LINEAGE, before the store checks them
 * again at commit. The namespace salts synthetic IDs only (logical Evidence IDs and provider keys); Memory and Job
 * IDs follow from the Evidence IDs as live ones do, and entity IDs come from `resolveMention`, unsalted.
 */
import {
  type ClaimsOutput as ClaimsOutputT,
  ClaimsOutput,
  type Evidence,
  Evidence as EvidenceSchema,
  ExtractEnvelope,
  type Hasher,
  type ID,
  type Job,
  Job as JobSchema,
  type Memory,
  Memory as MemorySchema,
  type PlanContext,
  PrivateReadInboundOutput,
  PrivateReadOwnOutput,
  type Schema,
  type Sens,
  type Slice,
  type Span,
  buildSlice,
  canonicalJSON,
  claimsSpans,
  idParts,
  maxSens,
  planItem,
  rootKey,
  sameClaim,
  scopeIdOf,
  sensFloor,
  topicDomain,
  tsFromMs,
  turnTextSlice,
  utf8,
  validate,
  verifySpan,
} from "@franki/core";
import { DAY_MS, cFields } from "../records";
import { lineageFailures } from "../store/checks";
import { evidenceId } from "../store/evidence";
import { paths } from "../store/paths";
import { extractJobId } from "../worker/extract-jobs";
import { workJob } from "../worker/jobs";
import { addDays, localDate, relInstant } from "./clock";
import type { AuthoredClaims, AuthoredItem, AuthoredSignal, AuthoredSpan, BankLine, CalendarLine, MailLine, RelTime, SeedFixture, SeedLine, TurnLine } from "./fixture";

/** Every seeded Evidence carries this parser version: its packet was written by hand, not by a model. */
export const SEED_PARSER_VERSION = "seed-authored-v1";

export type SeedCheck =
  | "spanNotInEvidence"
  | "packetInvalid"
  | "itemNotWritten"
  | "sameKey"
  | "recordInvalid"
  | "lineage"
  | "bulkNotLogistics"
  | "duplicateLine";

/** A seed that fails a check. Names the check and the line, never record content. */
export class SeedLoadError extends Error {
  constructor(
    readonly check: SeedCheck,
    readonly lineId: string,
    detail: string,
  ) {
    super(`seed load failed: ${check} on ${lineId}: ${detail}`);
    this.name = "SeedLoadError";
  }
}

export interface SeedInput {
  uid: string;
  namespace: ID;
  zone: string;
  /** The clone's world clock at load: a Friday 08:40 local (`cloneWorldStart`). */
  worldStart: number;
  /** opsClock now: createdAt and updatedAt. */
  opsNow: number;
  /** The epoch and policyRev the rows are written under. */
  core: { epoch: number; policyRev: number };
  hasher: Hasher;
}

export interface SeedWrite {
  path: string;
  record: object;
}

/** One line's rows, in write order: Evidence first, then the Memories that quote it, then Jobs. */
export interface SeedGroup {
  lineId: string;
  writes: SeedWrite[];
}

export interface SeedRows {
  /** The clone's Friday as a local date, and the hero window's first and last local dates. */
  friday: string;
  window: { from: string; to: string };
  groups: SeedGroup[];
}

/** The synthetic IDs of one namespace. */
export function seedIds(namespace: string, hasher: Hasher) {
  const logical = (lineId: string) => hasher.id(["seed", namespace, lineId]);
  return {
    logical,
    eid: (lineId: string, version = 1) => evidenceId(logical(lineId), version, hasher),
    key: (kind: string, name: string) => hasher.id(["seed-key", namespace, kind, name]),
  };
}

const fail = (check: SeedCheck, lineId: string, detail: string): never => {
  throw new SeedLoadError(check, lineId, detail);
};

function checked<T>(schema: Schema<T>, value: unknown, lineId: string, what: string): T {
  const r = validate(schema, value);
  if (!r.ok) fail("recordInvalid", lineId, `${what} ${r.path}: ${r.message}`);
  return (r as { ok: true; value: T }).value;
}

/** The text of a span's field on a line, as the Evidence will hold it. */
function fieldText(line: SeedLine, field: AuthoredSpan["field"]): string | null {
  if (line.kind === "turn") return field === "text" ? line.text : null;
  if (line.kind === "mail") return field === "subject" ? line.subject : field === "body" ? line.body : null;
  return null;
}

/** An authored span as offsets against the line's text. A quote that is not there fails the load. */
export function resolveSpan(line: SeedLine, eid: string, a: AuthoredSpan): Span {
  const text = fieldText(line, a.field);
  if (text === null || a.quote === "") return fail("spanNotInEvidence", line.id, `no ${a.field} text to quote`);
  let at = -1;
  for (let n = 0, from = 0; n <= (a.nth ?? 0); n++) {
    at = text.indexOf(a.quote, from);
    if (at < 0) return fail("spanNotInEvidence", line.id, `quote not in ${a.field}`);
    from = at + 1;
  }
  return { eid, fieldPath: a.field, start: at, end: at + a.quote.length, quote: a.quote };
}

/** The exact check the load runs on every span (no anchoring repair). */
function requireExact(span: Span, ctx: Pick<PlanContext, "packet">, lineId: string): void {
  if (verifySpan(span, ctx as PlanContext) === null) fail("spanNotInEvidence", lineId, `span ${span.fieldPath}[${span.start},${span.end})`);
}

const whenNone = { kind: "none", spoken: null, appliesTo: "occurrence", anchorHint: null } as const;
const spokenWhen = (spoken: string | undefined, appliesTo = "occurrence") =>
  spoken === undefined ? whenNone : { kind: "spoken", spoken, appliesTo, anchorHint: null };

function evidenceBase(input: SeedInput, ids: ReturnType<typeof seedIds>, lineId: string, version: number, init: Partial<Evidence> & Pick<Evidence, "kind" | "occurredAt" | "assertedAt" | "fieldSlices">): Evidence {
  const ops = tsFromMs(input.opsNow);
  return {
    ...cFields(input.uid, ops, input.core.epoch, input.core.policyRev),
    logicalId: ids.logical(lineId),
    revisionOf: version > 1 ? ids.eid(lineId, version - 1) : null,
    sanitizedFrom: null,
    source: "fixture",
    providerKey: null,
    providerRevision: null,
    connectorId: null,
    generation: 0,
    threadKey: null,
    inReplyToProviderKey: null,
    closureProofs: [],
    status: "retained",
    isCurrentProvider: true,
    receivedAt: ops,
    zone: input.zone,
    body: null,
    bodyOwn: null,
    bodyQuoted: null,
    subject: null,
    title: null,
    description: null,
    text: null,
    sender: null,
    recipient: [],
    observation: { kind: "none" },
    authorId: null,
    senderAddressKey: null,
    recipientAddressKeys: [],
    authorship: "unknown",
    delivery: "unknown",
    senderAuth: "unknown",
    identityBinding: "none",
    route: "unknown",
    sessionId: null,
    turnId: null,
    itemIds: [],
    transcriptState: "complete",
    transcriptDeadline: null,
    controlTurn: false,
    extractPacketMode: "source",
    parserVersion: SEED_PARSER_VERSION,
    copyRootKey: null,
    replacedProviderKey: null,
    sanitizeMap: [],
    purgedAt: null,
    ...init,
  };
}

/** A typed field's Slice: no range, the hash of its canonical value (contracts §1 Slice). */
function typedSlice(eid: string, fieldPath: Slice["fieldPath"], value: unknown, hasher: Hasher): Slice {
  return { eid, fieldPath, start: null, end: null, contentHash: hasher.sha256(utf8(canonicalJSON(value))), class: "O", sens: "S0" };
}

/** A text field's Slice. `sensMin` raises the lexicon's floor (review D2: connected-Google rows are at least S1). */
function textSlice(eid: string, fieldPath: "subject" | "body" | "bodyOwn" | "bodyQuoted" | "sender" | "title", text: string, cls: "O" | "T", hasher: Hasher, sensMin: Sens = "S0"): Slice {
  return buildSlice({ eid, fieldPath, fieldText: text, start: 0, end: text.length, class: cls, sens: maxSens(sensFloor(text), sensMin) }, hasher);
}

// ---------------------------------------------------------------------------------------------
// Turns

/** An authored Item as the full contract Item, with offsets resolved against the turn. */
function contractItem(line: TurnLine, eid: string, item: AuthoredItem) {
  return {
    act: item.act,
    target: "new",
    memoryId: null,
    kind: item.kind,
    predicate: item.predicate,
    subject: item.subject,
    scope: item.scope ?? null,
    value: item.value,
    args: item.args,
    mentions: (item.mentions ?? []).map((m) => ({ localId: m.localId, type: m.type, observedName: m.observedName, span: resolveSpan(line, eid, m.span), existingId: null })),
    bindings: [],
    contextIds: [],
    when: item.when === undefined ? whenNone : spokenWhen(item.when.spoken, item.when.appliesTo),
    endHint: null,
    changes: [],
    texture: [],
    spans: item.spans.map((s) => resolveSpan(line, eid, s)),
    sens: item.sens ?? "S0",
    gravity: item.gravity ?? 0,
    authorize: null,
    flow: item.flow ?? "open",
    deliveryRequest: null,
  };
}

interface Planned {
  lineId: string;
  id: string;
  memory: Memory;
  single: boolean;
}

function buildTurn(line: TurnLine, input: SeedInput, ids: ReturnType<typeof seedIds>, friday: string, planned: Planned[]): SeedGroup {
  const { hasher, uid } = input;
  const eid = ids.eid(line.id);
  const atMs = relInstant(friday, line.at, input.zone);
  const ts = tsFromMs(atMs);
  const evidence = evidenceBase(input, ids, line.id, 1, {
    kind: "turn",
    occurredAt: ts,
    assertedAt: ts,
    text: { kind: "inline", text: line.text },
    fieldSlices: [turnTextSlice(eid, line.text, "U", hasher)],
    authorId: "self",
    authorship: "self",
    route: "direct",
    extractPacketMode: "singleTurn",
  });
  checked(EvidenceSchema, evidence, line.id, "evidence");
  const jobId = extractJobId(eid, hasher);
  const ctx: PlanContext = {
    uid,
    jobId,
    packet: new Map([[eid, { evidence, fields: ["text"] }]]),
    hasher,
    worldNow: ts,
    opsNow: tsFromMs(input.opsNow),
    nextReviewAt: tsFromMs(atMs + 365 * DAY_MS),
    epoch: input.core.epoch,
    policyRev: input.core.policyRev,
    open: new Map(),
    context: [],
    zone: input.zone,
  };

  // The ExtractV1 packet: closed envelope, every span exact, every Item planned to an active U Memory.
  const items = line.extract.map((item) => contractItem(line, eid, item));
  const envelope = validate(ExtractEnvelope, { version: "ExtractV1", items, clarifications: [], continuation: null });
  if (!envelope.ok) fail("packetInvalid", line.id, `ExtractV1 ${envelope.path}: ${envelope.message}`);
  const memories: SeedWrite[] = [];
  const results: { type: "memory"; id: string; rev: number }[] = [];
  items.forEach((item, index) => {
    for (const s of [...item.spans, ...item.mentions.map((m) => m.span)]) requireExact(s, ctx, line.id);
    const plan = planItem(item, index, ctx);
    if (plan.kind !== "memory") return fail("itemNotWritten", line.id, `item ${index}: ${plan.kind}${"detail" in plan ? ` ${plan.detail}` : "reason" in plan ? ` ${plan.reason}` : ""}`);
    if (plan.memory.status !== "active" || plan.memory.sourceClass !== "U") fail("itemNotWritten", line.id, `item ${index}: not an active U Memory`);
    // Nothing in the seed supersedes: a same-key row the worker would close fails the load instead.
    const clash = planned.find((p) => p.memory.key === plan.memory.key && (plan.single || p.single || sameClaim(p.memory, plan.memory)));
    if (clash !== undefined) fail("sameKey", line.id, `item ${index} shares a key with ${clash.lineId}`);
    planned.push({ lineId: line.id, id: plan.id, memory: plan.memory, single: plan.single });
    memories.push({ path: paths.memory(uid, plan.id), record: checked(MemorySchema, plan.memory, line.id, `memory ${index}`) });
    results.push({ type: "memory", id: plan.id, rev: 1 });
  });

  const jobs: SeedWrite[] = [{ path: paths.job(uid, jobId), record: completeJob(extractJobBase(input, eid, evidence), results, line.id) }];

  // The PrivateReadOwnV1 packet: guesses from this turn's own words, proposed only.
  if (line.privateRead !== undefined && line.privateRead.length > 0) {
    const out = {
      version: "PrivateReadOwnV1",
      missed: [],
      hypotheses: line.privateRead.map((g) => ({
        topic: g.topic,
        claim: g.claim,
        support: g.support.map((s) => resolveSpan(line, eid, s)),
        counter: (g.counter ?? []).map((s) => resolveSpan(line, eid, s)),
        contextIds: [],
        subtract: [],
      })),
      continuation: null,
    };
    const v = validate(PrivateReadOwnOutput, out);
    if (!v.ok) fail("packetInvalid", line.id, `PrivateReadOwnV1 ${v.path}: ${v.message}`);
    const readJobId = hasher.id(["job", "privateReadOwn", eid]);
    const guessRefs: { type: "memory"; id: string; rev: number }[] = [];
    out.hypotheses.forEach((h, index) => {
      for (const s of [...h.support, ...h.counter]) requireExact(s, ctx, line.id);
      const id = hasher.id(idParts.memory(readJobId, index));
      memories.push({ path: paths.memory(uid, id), record: checked(MemorySchema, guessMemory(input, evidence, eid, atMs, h), line.id, `guess ${index}`) });
      guessRefs.push({ type: "memory", id, rev: 1 });
    });
    const base = extractJobBase(input, eid, evidence);
    const readJob: Job = { ...base, kind: "privateReadOwn", priority: "bulk", payload: { ...base.payload, task: "privateReadOwn" } as Job["payload"] };
    jobs.push({ path: paths.job(uid, readJobId), record: completeJob(readJob, guessRefs, line.id) });
  }

  return { lineId: line.id, writes: [{ path: paths.evidence(uid, eid), record: evidence }, ...memories, ...jobs] };
}

function extractJobBase(input: SeedInput, eid: string, evidence: Evidence): Job {
  const text = evidence.text?.kind === "inline" ? evidence.text.text : "";
  return workJob({
    uid: input.uid,
    kind: "extract",
    now: input.opsNow,
    epoch: input.core.epoch,
    policyRev: input.core.policyRev,
    sourceIds: [eid],
    inputRevs: [{ id: eid, rev: 1 }],
    targets: [{ type: "evidence", id: eid, rev: 1 }],
    class: "U",
    fields: [{ eid, fieldPath: "text", base: 0, end: text.length }],
    priority: "interactive",
  });
}

function completeJob(job: Job, resultRefs: { type: "memory"; id: string; rev: number }[], lineId: string): Job {
  return checked(JobSchema, { ...job, status: "complete", attempts: 1, resultRefs: resultRefs.slice(0, 32) }, lineId, "job");
}

/**
 * A PrivateReadOwnV1 guess as a `hypothesis` Memory: class M, `alleged` (never current truth), S2 (never in the
 * Head) and `never_outbound`. Its lineage is the support spans in the Owner's own turn.
 */
function guessMemory(input: SeedInput, evidence: Evidence, eid: string, atMs: number, h: { topic: Parameters<typeof topicDomain>[0]; claim: string; support: Span[] }): Memory {
  const { hasher } = input;
  const ts = tsFromMs(atMs);
  const ops = tsFromMs(input.opsNow);
  const floor = evidence.fieldSlices[0]!.sens;
  const rootSlices: Slice[] = h.support.map((s) => ({
    eid,
    fieldPath: s.fieldPath,
    start: s.start,
    end: s.end,
    contentHash: hasher.sha256(utf8(s.quote)),
    class: "U",
    sens: maxSens(floor, sensFloor(s.quote)),
  }));
  const value = { kind: "text" as const, text: h.claim };
  const args = { topic: topicDomain(h.topic) };
  const scopeId = scopeIdOf("hypothesis", null, args, value, hasher);
  return {
    v: 1,
    uid: input.uid,
    rev: 1,
    createdAt: ops,
    updatedAt: ops,
    epoch: input.core.epoch,
    policyRev: input.core.policyRev,
    rootKeys: rootSlices.map((s) => rootKey(s, hasher)),
    rootSlices,
    contextIds: [],
    packetEids: [eid],
    dependsOn: [`e:${eid}`],
    dirty: false,
    dependenciesComplete: true,
    logicalId: hasher.id(["guess", eid, h.claim]),
    kind: "hypothesis",
    subjectId: "self",
    predicate: "hypothesis",
    scopeId,
    key: hasher.id(idParts.memoryKey("self", "hypothesis", scopeId)),
    value,
    args,
    bindings: [],
    status: "alleged",
    sourceClass: "M",
    sens: "S2",
    closeReason: null,
    lastSupportAt: ts,
    flow: "never_outbound",
    assertedAt: ts,
    validFrom: ts,
    validTo: null,
    validFromKey: ts,
    validFromKnown: true,
    when: { kind: "none" },
    time: null,
    endWhen: { kind: "reviewOnly" },
    nextReviewAt: tsFromMs(atMs + 365 * DAY_MS),
    replacesIds: [],
    supportingIds: [{ type: "evidence", id: eid, rev: 1 }],
    entityIds: [],
    topicIds: [],
    roleKeys: [],
    watchTokens: [],
    watches: [],
    anchorId: null,
    unboundStart: null,
    scheduleRev: 0,
    sayAs: null,
    texture: [],
    gravity: 0,
    closesId: null,
    possibleClosureSourceId: null,
    expectedArtifactId: null,
    embedding: null,
    vectorVersion: null,
    hypothesis: {
      premiseIds: [{ type: "evidence", id: eid, rev: 1 }],
      alternatives: [],
      counterIds: [],
      ownRooted: true,
      independentCount: 1,
      observedFrom: ts,
      observedTo: ts,
    },
    loop: null,
  };
}

// ---------------------------------------------------------------------------------------------
// Mail

function signals(line: MailLine, eid: string, list: AuthoredSignal[] | undefined) {
  return (list ?? []).map((s) => ({ topic: s.topic, subjectName: s.subjectName, spans: s.spans.map((a) => resolveSpan(line, eid, a)) }));
}

function claimsOutput(line: MailLine, eid: string, c: AuthoredClaims) {
  return {
    version: "ClaimsV1",
    logistics: (c.logistics ?? []).map((l) => ({
      type: l.type,
      when: spokenWhen(l.spoken),
      where: l.where ?? null,
      participants: l.participants ?? [],
      spans: l.spans.map((a) => resolveSpan(line, eid, a)),
    })),
    senderPromises: (c.senderPromises ?? []).map((p) => ({ object: p.object, beneficiary: p.beneficiary ?? null, when: spokenWhen(p.spoken), spans: p.spans.map((a) => resolveSpan(line, eid, a)) })),
    claimsAboutUser: (c.claimsAboutUser ?? []).map((x) => ({ type: x.type, claim: x.claim, when: spokenWhen(x.spoken), spans: x.spans.map((a) => resolveSpan(line, eid, a)) })),
    topicSignals: signals(line, eid, c.topicSignals),
    directiveCount: c.directiveCount ?? 0,
    continuation: null,
  };
}

const addressOf = (a: string) => a.trim().toLowerCase();

/**
 * Brief 049 ruling 20: the fields of one message row, shared by the seed and a Google read, so a fixture's mail and a
 * real message enter through the same choices. Own mail's slices are O; everything else's are T. An empty field has
 * no slice.
 */
export interface MailRowInput {
  eid: string;
  at: string;
  providerKey: string;
  threadKey: string | null;
  inReplyToProviderKey: string | null;
  subject: string | null;
  body: string | null;
  sender: string | null;
  recipient: string[];
  fromSelf: boolean;
  senderAddressKey: string | null;
  recipientAddressKeys: string[];
  bulk: boolean;
  senderAuth: Evidence["senderAuth"];
}

/**
 * How a live read's row differs from a fixture's (fixtures leave both unset, so their rows are unchanged):
 * - `sensMin`: review D2, every text slice at least this sensitive;
 * - `splitQuoted`: review D4, the owner's sent body cut at the first quote or forward marker into `bodyOwn` (O) and
 *   `bodyQuoted` (T), with no whole-body field.
 */
export interface RowOptions {
  sensMin?: Sens;
  splitQuoted?: (body: string) => { own: string | null; quoted: string | null };
}

export function mailRowFields(m: MailRowInput, hasher: Hasher, opts: RowOptions = {}) {
  const cls = m.fromSelf ? "O" : "T";
  const split = m.fromSelf && m.body !== null && opts.splitQuoted !== undefined ? opts.splitQuoted(m.body) : null;
  const quoted = split !== null && split.quoted !== null ? split : null;
  type TextField = "subject" | "body" | "bodyOwn" | "bodyQuoted" | "sender";
  const bodies: [TextField, string | null, "O" | "T"][] =
    quoted === null
      ? [["body", m.body, cls]]
      : [
          ["bodyOwn", quoted.own, "O"],
          ["bodyQuoted", quoted.quoted, "T"],
        ];
  const fields: [TextField, string | null, "O" | "T"][] = [["subject", m.subject, cls], ...bodies, ["sender", m.sender, cls]];
  const slices = fields.flatMap(([field, text, c]) => (text === null || text === "" ? [] : [textSlice(m.eid, field, text, c, hasher, opts.sensMin)]));
  const inline = (t: string | null) => (t === null ? null : { kind: "inline" as const, text: t });
  return {
    kind: "message" as const,
    occurredAt: m.at,
    assertedAt: m.at,
    providerKey: m.providerKey,
    threadKey: m.threadKey,
    inReplyToProviderKey: m.inReplyToProviderKey,
    subject: m.subject,
    body: quoted === null ? inline(m.body) : null,
    bodyOwn: quoted === null ? null : inline(quoted.own),
    bodyQuoted: quoted === null ? null : inline(quoted.quoted),
    sender: m.sender,
    recipient: m.recipient,
    fieldSlices: slices,
    authorId: m.fromSelf ? ("self" as const) : null,
    senderAddressKey: m.senderAddressKey,
    recipientAddressKeys: m.recipientAddressKeys,
    authorship: m.fromSelf ? ("self" as const) : ("unknown" as const),
    delivery: m.fromSelf ? ("sent" as const) : ("unknown" as const),
    senderAuth: m.senderAuth,
    identityBinding: "none" as const,
    route: m.bulk ? ("list" as const) : ("direct" as const),
  };
}

function buildMail(line: MailLine, input: SeedInput, ids: ReturnType<typeof seedIds>, friday: string): SeedGroup {
  const { hasher, uid } = input;
  const eid = ids.eid(line.id);
  const ts = tsFromMs(relInstant(friday, line.at, input.zone));
  const sender = `${line.from.name} <${line.from.address}>`;
  const evidence = evidenceBase(
    input,
    ids,
    line.id,
    1,
    mailRowFields(
      {
        eid,
        at: ts,
        providerKey: ids.key("mail", line.id),
        threadKey: ids.key("thread", line.thread),
        inReplyToProviderKey: line.inReplyTo === undefined ? null : ids.key("mail", line.inReplyTo),
        subject: line.subject,
        body: line.body,
        sender,
        recipient: line.to,
        fromSelf: line.fromSelf,
        senderAddressKey: ids.key("address", addressOf(line.from.address)),
        recipientAddressKeys: line.to.map((a) => ids.key("address", addressOf(a))),
        bulk: line.bulk === true,
        senderAuth: "aligned",
      },
      hasher,
    ),
  );
  checked(EvidenceSchema, evidence, line.id, "evidence");
  const ctx = { packet: new Map([[eid, { evidence, fields: ["subject", "body"] }]]) };

  // Own mail has no ClaimsV1 packet (ClaimsV1 reads T only). Inbound mail's packet: closed schema, spans exact, bulk
  // logistics-only. Nothing is written from it: no T-record collection exists yet (design note, gap 2).
  if (line.fromSelf) {
    if (line.claims !== undefined || line.inbound !== undefined) fail("packetInvalid", line.id, "own mail carries no ClaimsV1 packet");
  } else {
    const out = validate(ClaimsOutput, claimsOutput(line, eid, line.claims ?? {}));
    if (!out.ok) return fail("packetInvalid", line.id, `ClaimsV1 ${out.path}: ${out.message}`);
    const claims: ClaimsOutputT = out.value;
    for (const s of claimsSpans(claims)) requireExact(s, ctx, line.id);
    if (line.bulk && (claims.senderPromises.length > 0 || claims.claimsAboutUser.length > 0 || claims.topicSignals.length > 0 || claims.directiveCount > 0)) {
      fail("bulkNotLogistics", line.id, "bulk mail is logistics-only");
    }
    if (line.inbound !== undefined) {
      const inbound = validate(PrivateReadInboundOutput, { version: "PrivateReadInboundV1", topicSignals: signals(line, eid, line.inbound), continuation: null });
      if (!inbound.ok) return fail("packetInvalid", line.id, `PrivateReadInboundV1 ${inbound.path}: ${inbound.message}`);
      for (const s of inbound.value.topicSignals.flatMap((x) => x.spans)) requireExact(s, ctx, line.id);
    }
  }
  return { lineId: line.id, writes: [{ path: paths.evidence(uid, eid), record: evidence }] };
}

// ---------------------------------------------------------------------------------------------
// Calendar and bank: code reads them, so the packet is the typed Observation.

/** Brief 049 ruling 20: the fields of one calendar row, shared by the seed and a Google read. */
export interface CalendarRowInput {
  eid: string;
  providerKey: string;
  calendarKey: string;
  start: string;
  end: string;
  zone: string;
  allDay: boolean;
  status: "confirmed" | "tentative" | "cancelled";
  selfResponse: "accepted" | "tentative" | "declined" | "needsAction" | "none";
  transparency: "opaque" | "transparent";
  organizerSelf: boolean;
  scheduleRev: number;
  assertedAt: string;
  providerRevision: string;
  isCurrentProvider: boolean;
  title: string | null;
  /** Review D4: Google's `creator.self`. Fixtures leave it unset: it is then the organizer's. */
  creatorSelf?: boolean;
}

export function calendarRowFields(c: CalendarRowInput, hasher: Hasher, opts: RowOptions = {}) {
  const creatorSelf = c.creatorSelf ?? c.organizerSelf;
  // Review D4: the title is the owner's own words only when the owner both organizes and created the event.
  const own = c.organizerSelf && creatorSelf;
  const observation = {
    kind: "calendar" as const,
    providerKey: c.providerKey,
    calendarKey: c.calendarKey,
    seriesKey: null,
    originalStart: null,
    start: c.start,
    end: c.end,
    zone: c.zone,
    allDay: c.allDay,
    status: c.status,
    selfResponse: c.selfResponse,
    transparency: c.transparency,
    organizerSelf: c.organizerSelf,
    creatorSelf,
    organizerId: c.organizerSelf ? ("self" as const) : null,
    attendeeIds: [],
    scheduleRev: c.scheduleRev,
  };
  return {
    kind: "calendar" as const,
    occurredAt: c.start,
    assertedAt: c.assertedAt,
    providerKey: observation.providerKey,
    providerRevision: c.providerRevision,
    isCurrentProvider: c.isCurrentProvider,
    title: c.title,
    observation,
    fieldSlices: [
      ...(c.title === null || c.title === "" ? [] : [textSlice(c.eid, "title", c.title, own ? "O" : "T", hasher, opts.sensMin)]),
      typedSlice(c.eid, "calendar.time", { start: c.start, end: c.end, zone: c.zone, allDay: c.allDay }, hasher),
      typedSlice(c.eid, "calendar.status", { status: c.status, transparency: c.transparency }, hasher),
      typedSlice(c.eid, "calendar.attendance", { selfResponse: c.selfResponse }, hasher),
    ],
    authorship: own ? ("self" as const) : ("unknown" as const),
    authorId: own ? ("self" as const) : null,
  };
}

function buildCalendar(line: CalendarLine, input: SeedInput, ids: ReturnType<typeof seedIds>, friday: string): SeedGroup {
  const { hasher, uid } = input;
  const writes: SeedWrite[] = line.revisions.map((r, i) => {
    const version = i + 1;
    const eid = ids.eid(line.id, version);
    const startMs = relInstant(friday, r.start, input.zone);
    const fields = calendarRowFields(
      {
        eid,
        providerKey: ids.key("calendar-event", line.id),
        calendarKey: ids.key("calendar", "primary"),
        start: tsFromMs(startMs),
        end: tsFromMs(startMs + r.minutes * 60_000),
        zone: input.zone,
        allDay: false,
        status: r.status,
        selfResponse: r.selfResponse,
        transparency: r.transparency ?? "opaque",
        organizerSelf: line.organizerSelf,
        scheduleRev: version,
        assertedAt: tsFromMs(relInstant(friday, r.at, input.zone)),
        providerRevision: String(version),
        isCurrentProvider: version === line.revisions.length,
        title: line.title,
      },
      hasher,
    );
    const evidence = evidenceBase(input, ids, line.id, version, fields);
    return { path: paths.evidence(uid, eid), record: checked(EvidenceSchema, evidence, line.id, `revision ${version}`) };
  });
  return { lineId: line.id, writes };
}

function buildBank(line: BankLine, input: SeedInput, ids: ReturnType<typeof seedIds>, friday: string): SeedGroup {
  const { hasher, uid } = input;
  const eid = ids.eid(line.id);
  const atMs = relInstant(friday, line.at, input.zone);
  const purchase = tsFromMs(atMs);
  const pending = line.pending === true;
  // Posted the next local morning at 06:00; a pending row has no posted time yet.
  const posted = pending ? null : tsFromMs(relInstant(friday, { day: line.at.day + 1, minute: 6 * 60 } satisfies RelTime, input.zone));
  const observation = {
    kind: "bank" as const,
    providerKey: ids.key("bank-row", line.id),
    pending,
    removed: false,
    // A purchase is a positive amount, a refund a negative one: the hero detector's convention (brief 023, S-170).
    amountCents: line.amountCents,
    currency: "USD",
    pendingOfId: null,
    refundOfId: null,
    merchantKey: ids.key("merchant", line.merchant),
    category: line.category,
    purchaseAt: { instant: purchase, civilDate: localDate(atMs, input.zone), zone: input.zone, basis: "providerAuthorized" as const, precision: "instant" as const },
    postedAt: posted,
    accountKey: ids.key("account", "checking"),
  };
  const evidence = evidenceBase(input, ids, line.id, 1, {
    kind: "transaction",
    occurredAt: purchase,
    assertedAt: posted ?? purchase,
    providerKey: observation.providerKey,
    title: line.merchant,
    observation,
    fieldSlices: [
      textSlice(eid, "title", line.merchant, "O", hasher),
      typedSlice(eid, "bank.amount", { amountCents: observation.amountCents, currency: "USD" }, hasher),
      typedSlice(eid, "bank.status", { pending, removed: false, category: line.category }, hasher),
      typedSlice(eid, "bank.purchaseAt", observation.purchaseAt, hasher),
    ],
    authorship: "imported",
  });
  return { lineId: line.id, writes: [{ path: paths.evidence(uid, eid), record: checked(EvidenceSchema, evidence, line.id, "evidence") }] };
}

// ---------------------------------------------------------------------------------------------

/** Builds every row of a seed, or throws `SeedLoadError`. Deterministic in its inputs. */
export async function buildSeed(fixture: SeedFixture, input: SeedInput): Promise<SeedRows> {
  // Every row is stamped SEED_PARSER_VERSION, which says "written by hand". Model-made packets need a parser version
  // of their own first (a ruling), so the load fails closed on them.
  if (fixture.origin !== "authored") fail("packetInvalid", fixture.id, `origin ${fixture.origin} has no parser version`);
  const ids = seedIds(input.namespace, input.hasher);
  const friday = localDate(input.worldStart, input.zone);
  const seen = new Set<string>();
  const planned: Planned[] = [];
  const groups: SeedGroup[] = [];
  for (const line of fixture.lines) {
    if (seen.has(line.id)) fail("duplicateLine", line.id, "two lines share an ID");
    seen.add(line.id);
    switch (line.kind) {
      case "turn":
        groups.push(buildTurn(line, input, ids, friday, planned));
        break;
      case "mail":
        groups.push(buildMail(line, input, ids, friday));
        break;
      case "calendar":
        groups.push(buildCalendar(line, input, ids, friday));
        break;
      case "bank":
        groups.push(buildBank(line, input, ids, friday));
        break;
      default:
        line satisfies never;
    }
  }
  // W-LINEAGE before any write, against the Evidence the seed itself holds.
  const evidence = new Map<string, Evidence>();
  for (const g of groups) for (const w of g.writes) if (w.path.includes("/evidence/")) evidence.set(w.path.slice(w.path.lastIndexOf("/") + 1), w.record as Evidence);
  for (const g of groups) {
    for (const w of g.writes) {
      if (!w.path.includes("/memories/")) continue;
      const failures = await lineageFailures(w.record as Memory, async (eid) => evidence.get(eid) ?? null, input.hasher);
      if (failures.length > 0) fail("lineage", g.lineId, failures.join(","));
    }
  }
  return { friday, window: { from: addDays(friday, -fixture.windowDays), to: addDays(friday, -1) }, groups };
}
