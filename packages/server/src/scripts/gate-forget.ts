/**
 * The forget gates (brief 048 stage 5; spec §13 release gates "old speech after forget" and "a forget leak"). Each
 * script asks for the forget on /api/turn, as the owner does, and then checks what a person would hear or see: the
 * notes, the fresh call's first line and Head, the idle line, the tool results and what their models were given, and
 * the memory reads; and the store where it matters.
 *
 *   FG01  a forget in the middle of a reply (spoken, in a call)
 *   FG02  a forget with a whisper pending
 *   FG03  a forget, then the moment that was due about the forgotten thing
 *   FG04  a forget, then a recall that asks about it
 *   FG05  a forget, then "why did you bring that up?" about a line that named it
 *   FG06  a forget of a guess read from mail, then the same mail synced again
 *   FG07  "Don't let me forget to call my brother", which is not a forget
 *
 * The brother line is S0 here, so a leak would be said and not held back by the Gate for its sensitivity.
 */
import { type CoreEpoch, type CoreState, type Job, type Memory, type MomentPlan, type Moment, type Turn, momentRow } from "@franki/core";
import { ownerClock } from "../core-docs";
import { ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { receiptRoute } from "../routes/receipt";
import { memoryTick } from "../time/tick";
import { listTenantRows } from "../seed/clear";
import { type MailLine, at, q } from "../seed/fixture";
import { paths } from "../store/paths";
import { callRoute, patchRecord } from "../testing/fakes";
import { type Answer, type Expectation, type Never, type Step, type World, TEMPLATES, allLedger, allMemories, extract, item, memoryText, parse, reply, resolveForget, spanOf } from "../testing/script-runner";
import { turnEvidenceId } from "../turns";
import { type GateScript, W } from "./gate-kit";

// ---------------------------------------------------------------------------------------------
// Helpers.

function forget(id: string, title: string, steps: Step[], extra: Partial<GateScript> = {}): GateScript {
  return { gate: "forget", id, name: `Forget gate ${id}: ${title}`, scores: "spec §13 old speech after forget, a forget leak; brief 048 stage 5", meta: { title }, steps, ...extra };
}

const BROTHER = "My brother's in trouble again.";
const FORGET_BROTHER = "Forget what I said about my brother.";
/** The brother line, by its Memory ID, and its one word no other line uses. */
const brotherLine: Never = { memory: "the brother line", pick: (m: Memory) => /brother/i.test(memoryText(m)) };
const GONE_WORDS: Never[] = [brotherLine, "trouble"];

/** The brother line, filed as an S0 fact (as beat 5 files it, at S0). */
const brotherItems = (w: World) => [
  item({
    act: "statement",
    kind: "fact",
    predicate: "fact",
    subject: "m1",
    value: { kind: "text", text: "the owner's brother is in trouble again" },
    args: { topic: "relationship", label: "brother" },
    mentions: [{ localId: "m1", type: "person", observedName: "brother", span: spanOf(w, "brother"), existingId: null }],
    spans: [spanOf(w, "My brother's in trouble again")],
    sens: "S0",
  }),
];

async function brotherStored(w: World): Promise<true | string> {
  const found = (await allMemories(w)).filter((m) => /brother/i.test(memoryText(m.data)));
  if (found.length === 1) {
    w.vars.set("brotherId", found[0]!.id);
    if (w.lastTurn !== null) w.vars.set("brotherEid", turnEvidenceId(w.lastTurn.turnId as never, w.rig.deps.hasher));
  }
  return found.length === 1 && found[0]!.data.status === "active" ? true : `found ${found.map((m) => `${m.data.status} "${memoryText(m.data)}"`).join("; ") || "nothing"}`;
}

/** Load the seed, open, say the brother line, and let extraction file it; then a minute passes. */
function tellBrother(visit: string): Step[] {
  return [
    { label: "load the seed for a visit", do: "seed", visit },
    { label: "open a session", do: "open" },
    { label: "say the brother line", do: "type", text: BROTHER, answers: [reply("I'm sorry to hear that."), parse()], expect: [{ mustSay: { note: true } }] },
    { label: "extraction files the brother line", do: "work", answers: [extract("a fact about the brother", brotherItems)], expect: [{ store: "the brother line stored once, active", check: brotherStored }] },
    // As in beat 5: the forget comes a minute later, so the resolve does not take it for a fragment of the line before.
    { label: "a minute later", do: "setup", what: "the clock moves on a minute", run: async (w) => w.rig.clock.advance(60_000) },
  ];
}

/** The forget's resolve finds nothing to forget. */
const resolveNone = (why: string): Answer => ({ endpoint: "responses.create", why: `forget resolve: ${why}`, result: ok(completed(JSON.stringify({ resolution: "none", remove: [], candidateIds: [], entityIds: [], topicKeys: [], needsMore: false, clarification: null }))) });

const resolveBrother = (): Answer => resolveForget("the brother line", (w) => [String(w.vars.get("brotherId"))]);

/** The typed forget of the brother line; its answer says Gone. */
function forgetBrother(label = "ask to forget the brother"): Step {
  return { label, do: "type", text: FORGET_BROTHER, answers: [reply("Okay."), parse({ forget: 0.95 }, "parse: a forget"), resolveBrother()], expect: [{ mustSay: { template: "forget.gone", channel: "note" } }] };
}

/**
 * The worker after a forget: the job runs out, and every model call it makes (an extraction of a line said before
 * the forget, or of what the forget left sanitized) is given nothing of the brother. `reads` extraction calls answer
 * with nothing new.
 */
function afterForget(reads = 0): Step {
  return {
    label: "run the worker until idle",
    do: "work",
    answers: Array.from({ length: reads }, () => extract("a line read again: nothing new", () => [])),
    expect: [forgetDone, { neverSay: GONE_WORDS, channels: ["model"] }],
  };
}

const forgetDone: Expectation = {
  store: "the forget job is done and the barrier is down",
  check: async (w) => {
    const jobs = (await listTenantRows(w.rig.store, w.uid)).filter((r) => r.path.includes("/jobs/")).map((r) => r.data as Job);
    const job = jobs.find((j) => j.kind === "forget");
    const epoch = (await w.rig.store.get<CoreEpoch>(w.uid, paths.core(w.uid, "epoch")))!.data;
    if (job === undefined) return "no forget job";
    const phase = job.payload.kind === "forget" ? job.payload.phase : "?";
    return phase === "done" && epoch.barrier === null ? true : `job at ${phase} (${job.status}), barrier ${JSON.stringify(epoch.barrier)}`;
  },
};

/** No stored assistant turn holds `word`. */
function noAssistantSays(word: string): Expectation {
  return {
    store: `no stored assistant turn holds "${word}"`,
    check: async (w) => {
      const turns = (await listTenantRows(w.rig.store, w.uid)).filter((r) => r.path.includes("/turns/")).map((r) => r.data as Turn);
      const hit = turns.find((t) => t.role === "assistant" && t.text !== null && new RegExp(word, "i").test(t.text));
      return hit === undefined ? true : `assistant turn: "${hit.text}"`;
    },
  };
}

/** A check-in moment on the brother line, due `dueInMs` from now (negative: already due). */
async function brotherMoment(w: World, dueInMs: number): Promise<void> {
  const { hasher, clock, store } = w.rig.deps;
  const id = String(w.vars.get("brotherId"));
  const ops = clock.read().opsClock.now;
  const epoch = (await store.get<CoreEpoch>(w.uid, paths.core(w.uid, "epoch")))!.data;
  // Moments fall due on the owner's world clock (the clone's fixture clock), not the ops clock.
  const world = ownerClock((await store.get<CoreState>(w.uid, paths.core(w.uid, "state")))!.data, clock).worldClock.now;
  const momentId = hasher.id(["fg-moment", id]);
  const plan: MomentPlan = {
    momentId,
    source: { kind: "memory", id: id as never },
    kind: "checkIn",
    occurrenceKey: "2026-11-13",
    scheduleRev: 0,
    dueAt: world + dueInMs,
    closeAt: world + 86_400_000,
    domain: "relationship",
    subjectIds: ["self"],
    payload: { kind: "cue", noteRef: { type: "memory", id: id as never, rev: 1 }, template: null },
    noteRef: null,
    lineage: { rootKeys: [], rootSlices: [], dependsOn: [`m:${id}`] },
  };
  const row = momentRow(plan, { uid: w.uid, opsNow: ops, epoch: epoch.epoch, policyRev: epoch.policyRev, clockMode: "fixture" }, hasher);
  await store.transaction(w.uid, async (tx) => tx.create(paths.moment(w.uid, momentId), row));
  w.vars.set("momentId", momentId);
}

/** The whisper is pending: the tick leased the brother's moment for delivery. */
const momentLeased: Expectation = {
  store: "the brother's moment is leased for delivery",
  check: async (w) => {
    const m = (await w.rig.store.get<Moment>(w.uid, paths.moment(w.uid, String(w.vars.get("momentId")))))?.data;
    return m?.status === "leased" ? true : `the moment is ${m?.status ?? "missing"}`;
  },
};

const momentNotSaid: Expectation = {
  store: "the brother's moment was never delivered and holds no words",
  check: async (w) => {
    const m = (await w.rig.store.get<Moment>(w.uid, paths.moment(w.uid, String(w.vars.get("momentId")))))?.data;
    if (m === undefined) return true;
    if (m.status === "delivered" || m.status === "admitted") return `the moment is ${m.status}: ${JSON.stringify(m.rendered)}`;
    return m.rendered !== null && /brother|trouble/i.test(m.rendered.text) ? `rendered: ${m.rendered.text}` : true;
  },
};

const recallArgs = (query: string, purpose: "answer" | "why" = "answer") => ({ purpose, query, entityRefs: [], roleTuple: null, predicate: null, asOf: null, anchorId: null, sourceMode: "both" });
const recallStep = (label: string, query: string, purpose: "answer" | "why", expect: Expectation[], answers: Answer[] = []): Step => ({
  label,
  do: "tool",
  tool: () => ({ name: "recall", args: recallArgs(query, purpose) }),
  answers,
  expect,
});

/** The recall reader's answer: the brother line, cited. */
const readerSaysBrother = (): Answer => ({
  endpoint: "responses.create",
  why: "recall reader: the brother line, cited",
  result: (w) => ok(completed(JSON.stringify({ kind: "supported", statements: [{ text: "Your brother's in trouble again.", citations: [{ type: "memory", id: String(w.vars.get("brotherId")), rev: 1 }], memoryIds: [] }], alternatives: [] }))),
});

/** What the fresh call opens with, after the forget: the acknowledgment once, and no brother. */
const freshOpen = (label = "the fresh call", reads = 0): Step => ({
  label,
  do: "open",
  answers: Array.from({ length: reads }, () => extract("a line read again on the open: nothing new", () => [])),
  expect: [{ neverSay: GONE_WORDS, channels: ["head", "proactive", "model"] }],
});

// ---------------------------------------------------------------------------------------------
// FG01: a forget in the middle of a reply.

/** The old reply's last words, which the client would report after the forget: they must not land. */
const OLD_REPLY = "I'm sorry about your brother, that sounds like real trouble.";

const FG01 = forget("FG01", "A forget in the middle of a reply", [
  ...tellBrother("fg01"),
  {
    label: "a call is live on this Session",
    do: "setup",
    what: "the Session's call is registered, as a live call's open registers it",
    run: async (w) => patchRecord(w.rig.store, w.uid, paths.session(w.uid, w.sessionId!), { callId: "rtc_fg01", registeredCallIds: ["rtc_fg01"] }),
  },
  { label: "the owner asks about it, spoken", do: "say", text: "What do you think I should do?", judge: "O", answers: [parse()] },
  {
    label: "Franki starts the reply",
    do: "setup",
    what: "the reply's stamp, as the voice client holds it while the reply plays; four seconds of it play",
    run: async (w) => {
      w.vars.set("replyStamp", { ...w.stamp!, turnId: w.lastTurn!.turnId });
      w.rig.clock.advance(4_000);
    },
  },
  {
    label: "mid-reply, the owner asks to forget the brother",
    do: "say",
    text: FORGET_BROTHER,
    judge: "H",
    answers: [parse({ forget: 0.95 }, "parse: a forget"), resolveBrother(), { endpoint: "realtime.calls.hangup", why: "the call is hung up", result: ok({}) }],
    expect: [
      { store: "the answer is blocked, with no Permit and no notes", check: async (w) => blockedAnswer(w, "mid-reply, the owner asks to forget the brother") },
      { neverSay: ["brother", "trouble"], channels: ["note", "card", "head"] },
    ],
  },
  {
    label: "the rest of the old reply comes in",
    do: "probe",
    name: "oldReply",
    run: async (w) => {
      const res = await callRoute(w.rig, receiptRoute, { requestId: "fg01-old-reply", stamp: w.vars.get("replyStamp"), responseId: "resp_fg01", kind: "transcript", momentIds: [], noteIds: [], pendingId: null, permitKind: null, text: OLD_REPLY });
      return { status: res.status, accepted: (res.body as { accepted?: boolean }).accepted ?? null };
    },
    expect: [{ store: "the old reply's words are refused, and stored nowhere", check: async (w) => oldReplyRefused(w) }, noAssistantSays("brother")],
  },
  afterForget(1),
  { ...freshOpen(), expect: [saysGone("the fresh call"), { neverSay: GONE_WORDS, channels: ["head", "proactive", "model"] }] },
]);

/** The step's open carried the acknowledgment as its first line (the Proactive's whisper), said exactly. */
function saysGone(label: string): Expectation {
  return {
    store: "the fresh call's first line is the forget.gone acknowledgment",
    check: async (w) => {
      const text = (w.answers.get(label)?.body as { proactive?: { whisper?: { text?: string } } | null } | undefined)?.proactive?.whisper?.text ?? null;
      return text !== null && TEMPLATES["forget.gone"].test(text) ? true : `first line: ${JSON.stringify(text)}`;
    },
  };
}

async function blockedAnswer(w: World, label: string): Promise<true | string> {
  const a = w.answers.get(label)?.body as { status?: string; permit?: unknown; notes?: unknown[] } | undefined;
  return a?.status === "blocked" && a.permit === null && (a.notes ?? []).length === 0 ? true : `answer: ${JSON.stringify(a)}`;
}

async function oldReplyRefused(w: World): Promise<true | string> {
  const r = w.vars.get("oldReply") as { status: number; accepted: boolean | null };
  return r.status !== 200 || r.accepted === false ? true : `the old reply landed: ${JSON.stringify(r)}`;
}

// ---------------------------------------------------------------------------------------------
// FG02: a forget with a whisper pending.

const FG02 = forget("FG02", "A forget with a whisper pending", [
  ...tellBrother("fg02"),
  { label: "a check-in on the brother is due", do: "setup", what: "a moment on the brother line, due now (no planner writes one for a fact)", run: async (w) => brotherMoment(w, -60_000) },
  { label: "the tick takes up the check-in", do: "setup", what: "the memory tick runs, as the state and open routes schedule it", run: async (w) => void (await memoryTick(w.ctx)), expect: [momentLeased] },
  forgetBrother(),
  afterForget(),
  { label: "the owner goes quiet", do: "idle", expect: [{ neverSay: GONE_WORDS, channels: ["proactive"] }, momentNotSaid] },
  freshOpen(),
  { label: "quiet on the fresh call", do: "idle", expect: [{ neverSay: GONE_WORDS, channels: ["proactive"] }, momentNotSaid] },
]);

// ---------------------------------------------------------------------------------------------
// FG03: a forget, then the moment that was due about the forgotten thing.

const FG03 = forget("FG03", "A forget, then the moment that was due about it", [
  ...tellBrother("fg03"),
  { label: "a check-in on the brother is due in half an hour", do: "setup", what: "a moment on the brother line, due in 30 minutes", run: async (w) => brotherMoment(w, 30 * 60_000) },
  forgetBrother(),
  afterForget(),
  { label: "the world clock moves past the moment's due time", do: "advance", to: at(0, "10:30"), called: "10:30 AM" },
  { label: "run the worker when the moment is due", do: "work" },
  freshOpen(),
  { label: "quiet on the fresh call", do: "idle", expect: [{ neverSay: GONE_WORDS, channels: ["proactive"] }, momentNotSaid] },
]);

// ---------------------------------------------------------------------------------------------
// FG04: a forget, then a recall that asks about it.

const ASK_BROTHER = "What did I tell you about my brother?";

const FG04 = forget("FG04", "A forget, then a recall that asks about it", [
  ...tellBrother("fg04"),
  forgetBrother(),
  afterForget(),
  { label: "the owner asks about the brother", do: "type", text: ASK_BROTHER, answers: [reply("Let me check."), parse()], expect: [{ neverSay: GONE_WORDS, channels: ["note", "card", "model"] }] },
  recallStep("recall about the brother", "brother", "answer", [{ neverSay: GONE_WORDS, channels: ["tool", "note", "card", "model"] }]),
  { label: "the overview", do: "read", view: "overview", expect: [{ neverSay: GONE_WORDS, channels: ["read", "card", "note"] }] },
]);

// ---------------------------------------------------------------------------------------------
// FG05: a forget, then "why did you bring that up?" about a line that named it.

const FG05 = forget("FG05", "A forget, then \"why did you bring that up?\"", [
  ...tellBrother("fg05"),
  { label: "the owner asks how things are", do: "type", text: "What's going on with my brother?", answers: [reply("Let me check."), parse()] },
  recallStep("Franki names the brother line", "brother", "answer", [{ mustSay: { has: ["trouble"], channel: "tool" } }], [readerSaysBrother()]),
  { label: "a minute later, again", do: "setup", what: "the clock moves on a minute", run: async (w) => w.rig.clock.advance(60_000) },
  forgetBrother(),
  afterForget(1),
  { label: "why did you bring that up?", do: "type", text: "Why did you bring that up?", answers: [reply("Let me look."), parse()], expect: [{ neverSay: GONE_WORDS, channels: ["note", "card", "model"] }] },
  recallStep("the why recall", "brother", "why", [{ neverSay: GONE_WORDS, channels: ["tool", "note", "card", "model"] }]),
  { label: "the why read of the brother line", do: "read", view: "why", id: (w) => String(w.vars.get("brotherId")), expect: [{ neverSay: GONE_WORDS, channels: ["read", "card"] }] },
  { label: "the why read of the turn that said it", do: "read", view: "why", id: (w) => String(w.vars.get("brotherEid")), expect: [{ neverSay: GONE_WORDS, channels: ["read", "card"] }] },
  { label: "the item read of the brother line", do: "read", view: "item", id: (w) => String(w.vars.get("brotherId")), expect: [{ neverSay: GONE_WORDS, channels: ["read", "card"] }] },
]);

// ---------------------------------------------------------------------------------------------
// FG06: a forget of a guess read from mail, then the same mail synced again.

const ME = "riley@corvel-freight.example";
const marcoMail: MailLine = {
  kind: "mail",
  id: "fg06-marco",
  at: at(0, "08:20"),
  bulk: false,
  fromSelf: false,
  from: { name: "Marco Bellini", address: "marco@quillon.example" },
  to: [ME],
  subject: "Congrats",
  body: "Congrats on the new job at Quillon! The team can't wait.",
  thread: "fg06-marco",
  claims: { claimsAboutUser: [{ type: "job_change", claim: "has a new job at Quillon", spans: [q("the new job at Quillon", "body")] }] },
};
const MAIL_GUESS = `${W.MAIL_READ}; so no guess about the owner is ever made from a mail's claims, and there is none to forget or to come back on a re-sync`;
const quillon: Never = { memory: "the Quillon guess", pick: (m: Memory) => /quillon/i.test(memoryText(m)) };

const FG06 = forget(
  "FG06",
  "A forget of a guess read from mail, then the same mail synced again",
  [
    { label: "load the seed for a visit", do: "seed", visit: "fg06" },
    { label: "the email arrives", do: "mail", lines: [marcoMail] },
    { label: "run the worker", do: "work" },
    { label: "open a session", do: "open" },
    {
      label: "the guess from the mail is stored",
      do: "check",
      of: "open a session",
      waits: MAIL_GUESS,
      expect: [{ store: "a guessed Memory about the new job, from the mail", check: async (w) => ((await allMemories(w)).some((m) => quillon.pick(m.data, m.id)) ? true : "no Memory from the mail") }],
    },
    { label: "a minute later", do: "setup", what: "the clock moves on a minute", run: async (w) => w.rig.clock.advance(60_000) },
    {
      label: "ask to forget the guess",
      do: "type",
      text: "Forget what you guessed about my job from that email.",
      answers: [reply("Okay."), parse({ forget: 0.95 }, "parse: a forget"), resolveNone("nothing stored matches the guess")],
    },
    afterForget(),
    { label: "the same email is synced again", do: "mail", lines: [marcoMail] },
    { label: "run the worker after the sync", do: "work" },
    { label: "the fresh call", do: "open", expect: [{ neverSay: [quillon, "Quillon"], channels: ["head", "proactive"] }] },
    { label: "the overview after the sync", do: "read", view: "overview", expect: [{ neverSay: [quillon], channels: ["read", "card", "note"] }] },
  ],
  { silentGreen: "no mail claim becomes a guess on this branch (MAIL_READ), so the steps after the forget are green with nothing to hide" },
);

// ---------------------------------------------------------------------------------------------
// FG07: "Don't let me forget to call my brother" is not a forget.

const REMIND = "Don't let me forget to call my brother.";

const FG07 = forget("FG07", "\"Don't let me forget to call my brother\" is not a forget", [
  { label: "load the seed for a visit", do: "seed", visit: "fg07" },
  { label: "open a session", do: "open" },
  {
    label: "note the epoch",
    do: "setup",
    what: "core/epoch before the line, to see it does not rise",
    run: async (w) => void w.vars.set("epochBefore", (await w.rig.store.get<CoreEpoch>(w.uid, paths.core(w.uid, "epoch")))!.data.epoch),
  },
  {
    label: "say the reminder",
    do: "type",
    text: REMIND,
    answers: [reply("I'll help you remember to call him."), parse({}, "parse: an ordinary line, not a forget")],
    expect: [
      { mustSay: { has: ["call him"], channel: "note" } },
      {
        store: "nothing is fenced: no forget job, no receipt, no barrier, the epoch unchanged",
        check: async (w) => {
          const jobs = (await listTenantRows(w.rig.store, w.uid)).filter((r) => r.path.includes("/jobs/") && (r.data as Job).kind === "forget");
          const receipts = (await allLedger(w)).filter((l) => l.data.kind === "forgetReceipt");
          const epoch = (await w.rig.store.get<CoreEpoch>(w.uid, paths.core(w.uid, "epoch")))!.data;
          const ok2 = jobs.length === 0 && receipts.length === 0 && epoch.barrier === null && epoch.epoch === w.vars.get("epochBefore");
          return ok2 ? true : `jobs ${jobs.length}, receipts ${receipts.length}, barrier ${JSON.stringify(epoch.barrier)}, epoch ${epoch.epoch} (was ${String(w.vars.get("epochBefore"))})`;
        },
      },
      { neverSay: ["Gone"], channels: ["note"] },
    ],
  },
  {
    label: "extraction files it as any line",
    do: "work",
    answers: [
      extract("a fact: the owner means to call their brother", (w) => [
        item({
          act: "statement",
          kind: "fact",
          predicate: "fact",
          subject: "m1",
          value: { kind: "text", text: "the owner means to call their brother" },
          args: { topic: "relationship", label: "brother" },
          mentions: [{ localId: "m1", type: "person", observedName: "brother", span: spanOf(w, "brother"), existingId: null }],
          spans: [spanOf(w, "call my brother")],
          sens: "S0",
        }),
      ]),
    ],
    expect: [{ store: "the line is stored, active", check: async (w) => ((await allMemories(w)).some((m) => /call their brother/.test(memoryText(m.data)) && m.data.status === "active") ? true : "not stored") }],
  },
  { label: "close the session", do: "close" },
  { label: "the next Head has it", do: "open", expect: [{ mustSay: { has: ["call their brother"], channel: "head" } }] },
]);

export const FORGET: GateScript[] = [FG01, FG02, FG03, FG04, FG05, FG06, FG07];
