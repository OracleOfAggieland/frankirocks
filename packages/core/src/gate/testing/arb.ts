/**
 * Generators for the Gate's properties (brief 024). Small vocabularies, so owner words often hit a candidate's
 * terms and labels, and times near one world instant, so the 24-hour and 7-day windows are crossed both ways.
 */
import fc from "fast-check";
import { tsFromMs } from "../../schema/primitives";
import { testId } from "../../testing/samples";
import { MUST_SAY_KINDS } from "../reasons";
import type { GateAuthorization, GateCandidate, GateContext, GateTopic } from "../types";

export const WORLD_NOW_MS = Date.parse("2026-11-12T17:00:00.000Z");
const HOUR = 3_600_000;

export const WORDS = ["mom", "dad", "houston", "interview", "pip", "dana", "biopsy", "dinner", "a", "the", "is"] as const;
const word = fc.constantFrom(...WORDS);
const phrase = fc.array(word, { minLength: 0, maxLength: 5 }).map((w) => w.join(" "));
const near = (spanHours: number) => fc.integer({ min: -spanHours, max: spanHours }).map((h) => tsFromMs(WORLD_NOW_MS + h * HOUR));

export const cls = fc.constantFrom("U", "C", "O", "T", "M" as const);
export const sens = fc.constantFrom("S0", "S1", "S2" as const);
export const audience = fc.constantFrom("private", "company", "unknown" as const);

const topicIds = [testId("topic-a"), testId("topic-b")] as const;

export const topicArb: fc.Arbitrary<GateTopic> = fc.record({
  topicId: fc.constantFrom(...topicIds),
  label: phrase,
  labelClass: cls,
  terms: fc.array(word, { maxLength: 3 }),
  quiet: fc.constantFrom(null, "unsolicited", "all_output" as const),
});

export const candidateArb: fc.Arbitrary<GateCandidate> = fc.record({
  id: fc.constantFrom(testId("cand-1"), testId("cand-2")),
  kind: fc.constantFrom("memory", "moment" as const),
  subjectId: fc.constantFrom("e:mom", "e:dad"),
  sourceClass: cls,
  sens,
  allergy: fc.boolean(),
  eligibility: fc.oneof({ arbitrary: fc.constant({ allow: true, reason: "ok" }), weight: 4 }, { arbitrary: fc.constant({ allow: false, reason: "blocked" }), weight: 1 }),
  toldAt: fc.option(near(24 * 10), { nil: null }),
  topic: fc.option(topicArb, { nil: null }),
  queryTerms: fc.array(word, { maxLength: 3 }),
  purpose: fc.constantFrom("item", "wish", "ask", "insight", "celebrate", "suggest", "logistics" as const),
  gravity: fc.constantFrom(0, 1, 2, 3 as const),
  food: fc.oneof({ arbitrary: fc.constant(false), weight: 3 }, { arbitrary: fc.constant(true), weight: 1 }),
  mustSay: fc.option(fc.constantFrom(...MUST_SAY_KINDS), { nil: null }),
  dueAt: fc.option(near(48), { nil: null }),
  sender: fc.option(fc.record({ mailedByOwner: fc.boolean() }), { nil: null }),
  attestedPremises: fc.integer({ min: 0, max: 3 }),
  offerUsed: fc.boolean(),
  ownRooted: fc.boolean(),
  checkInUsed: fc.boolean(),
  act: fc.constantFrom("say", "say", "say", "use" as const),
});

export const authorizationArb: fc.Arbitrary<GateAuthorization> = fc.record({
  subjectId: fc.constantFrom("e:mom", "e:dad"),
  topicId: fc.option(fc.constantFrom(...topicIds), { nil: null }),
  momentId: fc.option(fc.constantFrom(testId("cand-1"), testId("cand-2")), { nil: null }),
  audience,
  expiresAt: near(48),
  used: fc.boolean(),
  sourceClass: cls,
});

export const contextArb: fc.Arbitrary<GateContext> = fc.record({
  // 17:00Z is 09:00 or 12:00 in these zones; an hour offset below moves some cases into quiet hours.
  worldNow: fc.integer({ min: -16, max: 8 }).map((h) => tsFromMs(WORLD_NOW_MS + h * HOUR)),
  zone: fc.constantFrom("America/Los_Angeles", "America/New_York"),
  build: fc.constantFrom("floor", "plus200" as const),
  audience,
  modifiers: fc.record({ rushed: fc.boolean(), crisis: fc.boolean() }),
  trigger: fc.constantFrom("unprompted", "recall", "jarTap" as const),
  // Mostly the owner's own certain words, so asked and doors are reached often.
  ownerTurn: fc.option(
    fc.record({
      text: phrase,
      sourceClass: fc.oneof({ arbitrary: fc.constant("U" as const), weight: 3 }, { arbitrary: cls, weight: 1 }),
      certain: fc.oneof({ arbitrary: fc.constant(true), weight: 3 }, { arbitrary: fc.constant(false), weight: 1 }),
    }),
    { nil: null, freq: 4 },
  ),
  openedTopics: fc.subarray([...topicIds]),
  recentTurns: fc.array(
    fc.record({ role: fc.constantFrom("user", "assistant" as const), checkInAnswer: fc.boolean(), transitionOrCrisis: fc.boolean() }),
    { maxLength: 4 },
  ),
  counts: fc.record({
    proactive: fc.integer({ min: 0, max: 4 }),
    heavy: fc.integer({ min: 0, max: 2 }),
    senderAsks: fc.integer({ min: 0, max: 2 }),
    notesThisReply: fc.integer({ min: 0, max: 2 }),
  }),
  rules: fc.constantFrom("ready", "ready", "missing", "unreadable" as const),
  authorization: fc.option(authorizationArb, { nil: null }),
});

/** A context and a narrower one: the audience leaves private, or a modifier turns on, never the reverse. */
export const narrowingArb = fc
  .tuple(contextArb, fc.boolean())
  // Half the pairs start private, so leaving private is tried often.
  .map(([x, priv]) => (priv ? { ...x, audience: "private" as const } : x))
  .chain((x) =>
  fc
    .record({
      audience: x.audience === "private" ? audience : fc.constant(x.audience),
      rushed: x.modifiers.rushed ? fc.constant(true) : fc.boolean(),
      crisis: x.modifiers.crisis ? fc.constant(true) : fc.boolean(),
    })
    .map((n) => ({ wide: x, narrow: { ...x, audience: n.audience, modifiers: { rushed: n.rushed, crisis: n.crisis } } as GateContext })),
);
