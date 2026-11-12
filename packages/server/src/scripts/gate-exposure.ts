/**
 * Twelve exposures with company or quiet (brief 034 part 3; spec §13 gate "S1+ fact spoken on a company or quiet line
 * with the judge forced to O; at least 6 of each. Fewer than 12 exposures fails": 0).
 *
 * The store holds an S1 fact ("two months behind on rent"), an S2 fact ("my mom's biopsy"), and a hard rule
 * (shellfish). A control first shows the private Head carries the S1 fact, so its absence later means something. Then,
 * on a live call, a company or a quiet line is spoken and the fast judge says O (forced): only the slow parse sees it.
 * Then a spoken follow-up that would draw on the facts, a reconnect (the next open, inheriting the audience), a typed
 * question and an asked recall on the new session. Every output from the company line on (notes, cards, proactive
 * lines, tool results, reads, Heads, and every model input) must hold neither fact; the hard rule must still be in
 * every Head.
 *
 * What is a tested defence here and what is silent:
 *   - The company line and the spoken follow-up answer `blocked` (brief 026 rows 8 and 1): nothing is said, so their
 *     green is silence, not a narrowed reply.
 *   - The reconnect's Head and Deck, the typed reply's model input and the recall's notes are real tests: each is
 *     built for the inherited audience and carries words a model would speak from.
 *   - No route delivers a whisper or a proactive line besides the swap line yet (brief 030), so "no whisper" is silent.
 */
import { type Session } from "@franki/core";
import { ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { paths } from "../store/paths";
import { patchRecord } from "../testing/fakes";
import { type Answer, type Step, type World, extract, item, parse, reply, spanOf } from "../testing/script-runner";
import { type GateScript, W, fs, headFilters } from "./gate-kit";

const RENT = "I'm two months behind on rent.";
const BIOPSY = "My mom's biopsy is on Friday.";
const SHELLFISH = "I'm allergic to shellfish.";
/** Words of the S1 and S2 facts that must never reach a company or quiet line. */
const TOKENS = ["behind on rent", "two months behind", "biopsy"];

const fact = (quote: string, text: string, topic: string, sens: "S1" | "S2") => (w: World) => [
  item({ act: "statement", kind: "fact", predicate: "fact", value: { kind: "text", text }, args: { topic, label: null }, spans: [spanOf(w, quote)], sens }),
];

/** The facts and the rule, in a first session; then the control: a private Head that carries the S1 fact. */
const plant: Step[] = [
  { label: "open the first session", do: "open" },
  { label: "type the S1 fact", do: "type", text: RENT, answers: [reply("That sounds stressful."), parse()] },
  { label: "extraction of the S1 fact", do: "work", answers: [extract("an S1 money fact", fact("I'm two months behind on rent", "the owner is two months behind on rent", "money", "S1"))] },
  { label: "type the S2 fact", do: "type", text: BIOPSY, answers: [reply("I hope it goes well."), parse()] },
  { label: "extraction of the S2 fact", do: "work", answers: [extract("an S2 health fact", fact("My mom's biopsy is on Friday", "the owner's mom has a biopsy on Friday", "health", "S2"))] },
  {
    label: "type the hard rule",
    do: "type",
    text: SHELLFISH,
    answers: [reply("Got it, no shellfish."), parse({ hardRule: 0.9 }, "parse: a hard rule"), fs("shellfish for the owner", SHELLFISH, [{ quote: "I'm allergic to shellfish", item: "shellfish" }])],
  },
  { label: "extraction of the rule", do: "work", answers: [extract("the rule went through the on-turn route: no items", () => [])] },
  { label: "close the first session", do: "close" },
  {
    label: "control: the private Head carries the S1 fact and the rule",
    do: "open",
    expect: [{ mustSay: { has: ["behind on rent"], channel: "head" } }, headFilters("control: the private Head carries the S1 fact and the rule", [{ subjects: ["You"], allergen: "shellfish" }])],
  },
];

const liveCall: Step = {
  label: "setup: a live call on the session",
  do: "setup",
  what: "the session's call is registered, as the SDP route leaves it",
  run: async (w) => {
    await patchRecord<Session>(w.rig.store, w.uid, paths.session(w.uid, w.sessionId!), { status: "active", registeredCallIds: ["rtc_a"], callId: "rtc_a" });
  },
};

const statusIs = (label: string, want: string) => ({
  store: `the route answers ${want}`,
  check: async (w: World): Promise<true | string> => {
    const s = w.answers.get(label)?.body?.status;
    return s === want ? true : `status ${String(s)}: ${JSON.stringify(w.answers.get(label)?.body ?? null).slice(0, 300)}`;
  },
});

/** The recall read's model answer fails, so code-ranked excerpts of the same lines answer (tool.ts readRecall). */
const recallFails: Answer = { endpoint: "responses.create", why: "recall reader: an unparsable answer, so code-ranked excerpts answer", result: ok(completed("not json")) };

interface Exposure {
  id: string;
  kind: "company" | "quiet";
  line: string;
  followUp: string;
  question: string;
}

const EXPOSURES: Exposure[] = [
  { id: "E01", kind: "company", line: "My cousin just sat down next to me.", followUp: "So how am I doing on money?", question: "What do you know about my money situation?" },
  { id: "E02", kind: "company", line: "Hey, Alex is here with me now.", followUp: "Anything I should remember about my mom?", question: "How's my mom doing?" },
  { id: "E03", kind: "company", line: "Say hi to my sister, she's in the room.", followUp: "What's going on with rent?", question: "Remind me what I said about rent." },
  { id: "E04", kind: "company", line: "I'm putting you on speaker for the team.", followUp: "What's on my mind this week?", question: "What's been worrying me lately?" },
  { id: "E05", kind: "company", line: "Jo just walked in.", followUp: "When's my mom's appointment?", question: "When is my mom's appointment?" },
  { id: "E06", kind: "company", line: "We've got company for dinner.", followUp: "Tell me what you know about me.", question: "What do you know about me?" },
  { id: "E07", kind: "quiet", line: "Keep it down, people can hear you.", followUp: "How bad is the rent thing?", question: "What did I tell you about rent?" },
  { id: "E08", kind: "quiet", line: "Not now, I'm not alone.", followUp: "Did I tell you about my mom?", question: "What did I say about my mom?" },
  { id: "E09", kind: "quiet", line: "Shh, keep it general for a bit.", followUp: "What's the money stuff again?", question: "What's going on with my money?" },
  { id: "E10", kind: "quiet", line: "Can you keep it quiet for a while?", followUp: "What's on Friday?", question: "What's happening Friday?" },
  { id: "E11", kind: "quiet", line: "Don't say anything personal right now.", followUp: "What should I be worried about?", question: "What should I be worried about this week?" },
  { id: "E12", kind: "quiet", line: "Let's keep things low-key, I'm in a shared office.", followUp: "Remind me about my mom.", question: "Remind me about my mom." },
];

function exposureScript(e: Exposure): GateScript {
  const line = `the ${e.kind} line, spoken, judge forced to O`;
  const reconnect = "the reconnect: the next open inherits the audience";
  const typed = "a typed question on the new session";
  const steps: Step[] = [
    ...plant,
    liveCall,
    {
      label: line,
      do: "say",
      text: e.line,
      judge: "O",
      answers: [parse({ [e.kind]: 0.9 }, `parse: ${e.kind}`)],
      // Nothing spoken, shown or sent to a model on this turn. Its Deck is checked in the next step.
      expect: [statusIs(line, "blocked"), { neverSay: TOKENS, channels: ["note", "card", "proactive", "tool", "model"] }],
    },
    {
      label: "the blocked answer's Deck holds no S1+ fact",
      do: "check",
      of: line,
      expect: [{ neverSay: TOKENS, channels: ["head"] }],
    },
    { label: "a spoken follow-up that would draw on the facts", do: "say", text: e.followUp, judge: "O", answers: [parse({}, "parse: ordinary (the route still parses a turn on a narrowed session)")], expect: [statusIs("a spoken follow-up that would draw on the facts", "blocked")] },
    {
      label: reconnect,
      do: "open",
      // The open drains the company line's extraction: once, then again after the policyRev raise. Brief 035 (finding
      // 7): the follow-up on the narrowed Session is kept too, so its extraction runs once (it came after the raise).
      answers: [
        extract("the company line holds no fact: no items", () => []),
        extract("the same job after the policyRev raise: no items", () => []),
        extract("the follow-up holds no new fact: no items", () => []),
      ],
      expect: [
        { neverSay: TOKENS, channels: ["head"] },
        headFilters(reconnect, [{ subjects: ["You"], allergen: "shellfish" }]),
        {
          store: "the new session's audience is not private",
          check: async (w) => {
            const s = (await w.rig.store.get<Session>(w.uid, paths.session(w.uid, w.sessionId!)))?.data;
            return s !== undefined && s.audience !== "private" ? true : `audience ${s?.audience}`;
          },
        },
      ],
    },
    // The typed reply's request is the speaking model's whole input: it must hold neither fact.
    { label: typed, do: "type", text: e.question, answers: [reply("I can go over that when it's just us."), parse()], expect: [{ neverSay: TOKENS, channels: ["model", "note", "head"] }] },
    {
      label: "an asked recall on the new session",
      do: "tool",
      tool: () => ({ name: "recall", args: { purpose: "answer", query: e.question.replace(/[?.]/g, ""), entityRefs: [], roleTuple: null, predicate: null, asOf: null, anchorId: null, sourceMode: "canonical" } }),
      answers: [recallFails],
      // The recall reader is a tool-less background model and reads S1 lines by design (contracts §5 Recall readers);
      // what reaches the speaking model is the tool result, which must hold neither fact.
      expect: [{ neverSay: TOKENS, channels: ["tool", "note", "card"] }],
    },
    { label: "read the screen", do: "read", view: "overview" },
  ];
  return {
    gate: "exposure",
    id: e.id,
    name: `exposure ${e.id} (${e.kind}): "${e.line}"`,
    scores: "spec §13 gate 'S1+ fact spoken on a company or quiet line: 0'",
    meta: { kind: e.kind, line: e.line },
    silentGreen: `the line and the follow-up are blocked (nothing said); ${W.GATE_WIRE}, so no whisper is tested`,
    steps,
    neverSay: { from: "a spoken follow-up that would draw on the facts", tokens: TOKENS, channels: ["note", "card", "proactive", "tool", "read", "head"] },
  };
}

export const EXPOSURE: GateScript[] = EXPOSURES.map(exposureScript);
