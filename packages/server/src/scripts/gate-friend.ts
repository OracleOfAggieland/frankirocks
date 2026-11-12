/**
 * The Friend Tests of spec §12 (brief 034 part 4): one script per test the 200 h plan counts as working or partly
 * working, under its number. 5, 7, 19, 26 and 27 are Later and have none. Where brief 029's beats or this brief's
 * other gates already cover a test, `FRIEND_POINTERS` names them and nothing is repeated.
 *
 * A partly working test asserts the part that works and marks the rest as waiting, with what it waits for. Every
 * model answer is declared beside its step; the model's own wording is never what a check reads, except where code
 * builds the words (templates, cards, the Head).
 */
import { type Memory } from "@franki/core";
import { ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { type MailLine, at, q } from "../seed/fixture";
import { type Step, type World, allMemories, extract, item, memoryText, parse, reply, rulesOf, slots, spanOf } from "../testing/script-runner";
import { type GateScript, W, foodSafe, fsEmpty, suggestCall } from "./gate-kit";

// ---------------------------------------------------------------------------------------------
// Helpers.

type Items = (w: World) => unknown[];

/** A typed line, then its extraction with these items. */
function tell(text: string, why: string, items: Items, more: Step["answers"] = []): Step[] {
  return [
    { label: `type: ${text}`, do: "type", text, answers: [reply("Okay."), parse(), ...(more ?? [])] },
    { label: `extraction of: ${text}`, do: "work", answers: [extract(why, items)] },
  ];
}

/**
 * A life change typed with an RX7 cue opens the transition route at arrival (brief 025, wave D), so FastSlots answers
 * for the line: what a careful model returns for it.
 */
const lifeChange = (text: string, why: string, transition: string, whenSpoken: string | null, who: { subject?: string; counterpart?: string }) =>
  slots(why, (eid) => {
    const span = (q: string) => ({ eid, fieldPath: "text", start: text.indexOf(q), end: text.indexOf(q) + q.length, quote: q });
    const of = (words: string | undefined, self: boolean) => (words === undefined ? (self ? { entityId: null, mention: null, isSelf: true } : null) : { entityId: null, mention: span(words), isSelf: false });
    const quote = text.replace(/[.!?]$/, "").split(". ")[0]!;
    return [{ kind: "transition", transition, subject: of(who.subject, true), counterpart: of(who.counterpart, false), whenSpoken, polarity: "affirmed", act: "direct", span: span(quote) }];
  });

const mention = (w: World, localId: string, type: string, name: string, existingId: string | null = null) => ({ localId, type, observedName: name, span: spanOf(w, name), existingId });

const factItem = (w: World, quote: string, text: string, topic: string, sens: "S0" | "S1" | "S2", extra: Record<string, unknown> = {}) =>
  item({ act: "statement", kind: "fact", predicate: "fact", value: { kind: "text", text }, args: { topic, label: null }, spans: [spanOf(w, quote)], sens, ...extra });

const memoriesWhere = async (w: World, pick: (m: Memory) => boolean) => (await allMemories(w)).filter((m) => pick(m.data));

function storeHas(what: string, pick: (m: Memory) => boolean, want: (ms: Memory[]) => true | string = (ms) => (ms.length > 0 ? true : "none")) {
  return {
    store: what,
    check: async (w: World): Promise<true | string> => {
      const ms = (await memoriesWhere(w, pick)).map((m) => m.data);
      const r = want(ms);
      if (r === true) return true;
      const all = (await allMemories(w)).map((m) => `${m.data.predicate}/${m.data.status}/${m.data.sens} "${memoryText(m.data).slice(0, 60)}"`);
      return `${r}; stored: ${all.join("; ") || "nothing"}`;
    },
  };
}

const head = (label: string, has: string[]) => ({ mustSay: { has, channel: "head" as const } });
const recallArgs = (query: string, purpose: "answer" | "plan" | "why" | "inspect" = "answer") => ({
  name: "recall",
  args: { purpose, query, entityRefs: [], roleTuple: null, predicate: null, asOf: null, anchorId: null, sourceMode: "canonical" },
});

function friend(id: string, test: number, title: string, steps: Step[], extra: Partial<GateScript> = {}): GateScript {
  return { gate: "friend", id, name: `Friend Test ${test}: ${title}`, scores: `spec §12 Friend Test ${test}`, meta: { test: String(test), title }, steps, ...extra };
}

/** The recall reader's answer is unparsable, so code-ranked excerpts answer (tool.ts readRecall). */
const readerFails = () => ok(completed("not json"));

const MEAT = ["chicken_thigh", "chicken_breast", "ground_beef", "pork_chop", "salmon_fillet", "cod_fillet", "shrimp", "mixed_seafood", "fish_sauce"];

// ---------------------------------------------------------------------------------------------
// The scripts.

const VEG = "I'm vegetarian this month.";
const FT02 = friend("FT02", 2, "Vegetarian this month", [
  { label: "open", do: "open" },
  ...tell(VEG, "a vegetarian diet until the month ends", (w) => [
    item({
      act: "soft_pref",
      kind: "preference",
      predicate: "preference.food",
      value: { kind: "enum", code: "vegetarian" },
      args: { dimension: "diet", targetRef: null },
      spans: [spanOf(w, "I'm vegetarian this month")],
      when: { kind: "spoken", spoken: "this month", appliesTo: "valid_to", anchorHint: null },
    }),
  ]),
  {
    label: "a diet with an end is stored",
    do: "check",
    of: "open",
    expect: [storeHas("an active vegetarian preference.food with validTo set", (m) => m.predicate === "preference.food" && m.status === "active", (ms) => (ms.some((m) => m.validTo !== null) ? true : `validTo ${ms.map((m) => m.validTo).join(", ") || "none"}`))],
  },
  { label: "ask about dinner this month", do: "say", text: "What should I make for dinner?", answers: [parse()] },
  {
    ...suggestCall("suggest this month", [foodSafe("suggest this month", MEAT)]),
  },
  { label: "the month ends", do: "advance", to: at(33, "18:00"), called: "December 2, after the month" },
  { label: "ask about dinner after the month", do: "say", text: "What's for dinner tonight?", answers: [parse()] },
  {
    ...suggestCall("suggest after the month", [{ mustSay: { has: ["vegetarian"], channel: "tool" } }]),
  },
]);

const MOM = "My mom's in the hospital.";
const MOM_DIED = "My mom passed away last night.";
const FT03 = friend("FT03", 3, "Mom in hospital, later dies", [
  { label: "open", do: "open" },
  ...tell(MOM, "the mom is hospitalized: S2, gravity 3", (w) => [
    item({
      act: "statement",
      kind: "fact",
      predicate: "person.life",
      subject: "m1",
      value: { kind: "enum", code: "hospitalized" },
      args: { detail: null },
      mentions: [mention(w, "m1", "person", "mom")],
      spans: [spanOf(w, "My mom's in the hospital")],
      sens: "S2",
      gravity: 3,
    }),
  ]),
  { label: "the situation is stored S2, gravity 3", do: "check", of: "open", expect: [storeHas("an active person.life hospitalized, S2, gravity 3", (m) => m.predicate === "person.life" && m.status === "active" && m.sens === "S2" && m.gravity === 3)] },
  { label: "close", do: "close" },
  { label: "the next day", do: "advance", to: at(5, "18:00"), called: "the next evening" },
  { label: "open the next day", do: "open" },
  { label: "Franki asks how the mom is doing", do: "check", of: "open the next day", waits: W.GATE_WIRE, expect: [{ mustSay: { template: "occasion.checkin", has: ["mom"], channel: "proactive" } }] },
  ...tell(MOM_DIED, "a transition: the mom died", (w) => {
    const target = (w.vars.get("momLife") as string | undefined) ?? null;
    return [
      item({
        act: "transition",
        kind: "fact",
        predicate: "person.life",
        subject: "m1",
        value: { kind: "enum", code: "deceased" },
        args: { detail: null },
        mentions: [mention(w, "m1", "person", "mom")],
        spans: [spanOf(w, "My mom passed away")],
        sens: "S2",
        gravity: 3,
        changes: target === null ? [] : [{ verb: "transition", targetMid: target }],
      }),
    ];
  }, [lifeChange(MOM_DIED, "a death: the owner's mom, last night", "death", "last night", { subject: "My mom" })]),
  {
    label: "the death is stored; the hospital stay is history",
    do: "check",
    of: "open the next day",
    expect: [storeHas("person.life deceased active, and hospitalized no longer active", (m) => m.predicate === "person.life", (ms) => (ms.some((m) => m.status === "active" && (m.value as { code?: string }).code === "deceased") && !ms.some((m) => m.status === "active" && (m.value as { code?: string }).code === "hospitalized") ? true : ms.map((m) => `${(m.value as { code?: string }).code}:${m.status}`).join(", ")))],
  },
  { label: "close after the death", do: "close" },
  { label: "a week later", do: "advance", to: at(12, "18:00"), called: "a week later" },
  { label: "open a week later", do: "open" },
  { label: "one griefAsk, no advice", do: "check", of: "open a week later", waits: `${W.GATE_WIRE}; the griefAsk template has no server wording yet`, expect: [{ mustSay: { has: ["mom"], channel: "proactive", times: 1 } }] },
]);

/** Before the death line: the hospital Memory's ID, so the extractor can name it (as `open` would list it). */
const rememberMom: Step = {
  label: "setup: the extractor sees the hospital Memory in open",
  do: "setup",
  what: "the person.life Memory's ID, which extraction's `open` lists",
  run: async (w) => void w.vars.set("momLife", (await memoriesWhere(w, (m) => m.predicate === "person.life"))[0]?.id ?? null),
};
FT03.steps.splice(FT03.steps.findIndex((s) => s.label === `type: ${MOM_DIED}`), 0, rememberMom);

const DALLAS = "I live in Dallas.";
const AUSTIN = "We moved to Austin last month.";
const FT04 = friend("FT04", 4, "Moved Dallas to Austin", [
  { label: "open", do: "open" },
  ...tell(DALLAS, "residence: Dallas", (w) => [
    item({ act: "statement", kind: "fact", predicate: "place.residence", value: { kind: "entity", mention: "m1" }, args: {}, mentions: [mention(w, "m1", "place", "Dallas")], spans: [spanOf(w, "I live in Dallas")], sens: "S1" }),
  ]),
  {
    label: "setup: the extractor sees the Dallas Memory in open",
    do: "setup",
    what: "the residence Memory's ID, which extraction's `open` lists",
    run: async (w) => void w.vars.set("dallas", (await memoriesWhere(w, (m) => m.predicate === "place.residence"))[0]?.id ?? null),
  },
  ...tell(AUSTIN, "a transition: residence Austin", (w) => [
    item({
      act: "transition",
      kind: "fact",
      predicate: "place.residence",
      value: { kind: "entity", mention: "m1" },
      args: {},
      mentions: [mention(w, "m1", "place", "Austin")],
      spans: [spanOf(w, "We moved to Austin last month")],
      sens: "S1",
      changes: w.vars.get("dallas") === null ? [] : [{ verb: "transition", targetMid: w.vars.get("dallas") }],
    }),
  ]),
  {
    label: "one slot, two intervals",
    do: "check",
    of: "open",
    expect: [storeHas("two residence Memories: Austin active, Dallas closed with a validTo", (m) => m.predicate === "place.residence", (ms) => (ms.length === 2 && ms.filter((m) => m.status === "active").length === 1 && ms.some((m) => m.status !== "active" && m.validTo !== null) ? true : ms.map((m) => `${m.status} validTo=${m.validTo}`).join(", ")))],
  },
  { label: "close", do: "close" },
  { label: "the next Head plans from Austin", do: "open", expect: [head("the next Head plans from Austin", ["Austin"]), { neverSay: ["lives in Dallas", "live in Dallas"], channels: ["head"] }] },
  { label: "ask where they lived", do: "type", text: "Where was I living in the summer?", answers: [reply("Let me check."), parse()] },
  {
    label: "recall as of the summer says Dallas",
    do: "tool",
    tool: () => ({ ...recallArgs("where was I living"), args: { ...recallArgs("where was I living").args, asOf: "in the summer" } }),
    answers: [{ endpoint: "responses.create", why: "recall reader: unparsable, so code-ranked excerpts answer", result: readerFails() }],
    waits: "recall's asOf (spec §11: an implied time resolves first, then the interval): no route reads args.asOf, and this recall returns no notes at all",
    expect: [{ mustSay: { has: ["Dallas"], channel: "tool" } }],
  },
]);

const DENTIST = "Book the dentist for next Friday.";
const FT06 = friend("FT06", 6, "\"Next Friday\" at 1 AM", [
  { label: "the clock is 1 AM on a Thursday", do: "advance", to: at(6, "01:00"), called: "Thursday 1 AM" },
  { label: "open", do: "open" },
  ...tell(DENTIST, "an event with the spoken time \"next Friday\"", (w) => [
    item({
      act: "intention",
      kind: "event",
      predicate: "event",
      value: { kind: "text", text: "Dentist appointment" },
      args: { occasion: "appointment", anchorRef: null, important: false },
      spans: [spanOf(w, "Book the dentist for next Friday")],
      when: { kind: "spoken", spoken: "next Friday", appliesTo: "occurrence", anchorHint: null },
    }),
  ]),
  {
    label: "the time is held as candidates, not one date",
    do: "check",
    of: "open",
    expect: [storeHas("the dentist event's time is not one resolved date", (m) => m.predicate === "event", (ms) => {
      const t = ms[0]?.time as { kind?: string; candidates?: unknown[] } | null | undefined;
      return ms.length === 1 && (t === null || t === undefined || t.kind !== "resolved" || (t.candidates?.length ?? 0) > 1) ? true : `time ${JSON.stringify(t)}`;
    })],
  },
  {
    label: "Franki asks \"the 6th or the 13th?\"",
    do: "check",
    of: `type: ${DENTIST}`,
    waits: "the resolver's ask (spec §5): an ambiguous date leaves no question on the turn (no card or pending clarification is built for it)",
    expect: [{ mustSay: { has: ["or"], channel: "card" } }],
  },
]);

const FT08 = friend("FT08", 8, "Breakup, restaurants", [
  { label: "open", do: "open" },
  ...tell("Sam and I broke up. We used to go to Lupa every Friday.", "the breakup, and the place they used to go", (w) => [
    item({ act: "statement", kind: "fact", predicate: "person.relation", value: { kind: "enum", code: "ex_partner" }, args: { otherRef: "m1", label: "ex", employerRef: null }, mentions: [mention(w, "m1", "person", "Sam")], spans: [spanOf(w, "Sam and I broke up")], sens: "S1" }),
    factItem(w, "We used to go to Lupa every Friday", "the owner and Sam used to go to Lupa every Friday", "food", "S1"),
  ], [lifeChange("Sam and I broke up. We used to go to Lupa every Friday.", "a breakup: the owner and Sam", "breakup", null, { counterpart: "Sam" })]),
  { label: "ask for dinner out", do: "say", text: "Where should I eat tonight?", answers: [parse()] },
  suggestCall("suggest dinner", [{ neverSay: ["Lupa"], channels: ["tool", "card", "note"] }], "somewhere to eat tonight"),
], { silentGreen: "suggest(food) offers recipes only (places are always removed for unknown allergen status, brief 022 'Not built: venues'), so Lupa can't be offered; the relation-to-history effect is not tested" });

const FT09 = friend("FT09", 9, "\"That place\"", [
  { label: "open", do: "open" },
  ...tell("Ana told me about a ramen spot called Tatsu.", "a recommendation: Tatsu, from Ana", (w) => [factItem(w, "Ana told me about a ramen spot called Tatsu", "Ana recommended the ramen spot Tatsu", "food", "S0")]),
  ...tell("I love Kogetsu, the ramen place on 5th.", "a liked place: Kogetsu", (w) => [factItem(w, "I love Kogetsu, the ramen place on 5th", "the owner loves Kogetsu, the ramen place on 5th", "food", "S0")]),
  { label: "refer to that place", do: "type", text: "Let's go to that ramen place again.", answers: [reply("Which one?"), parse()] },
  {
    label: "recall asks one discriminating question",
    do: "tool",
    tool: () => recallArgs("that ramen place"),
    answers: [{ endpoint: "responses.create", why: "recall reader: unparsable, so code-ranked excerpts answer", result: readerFails() }],
    waits: "spec §11 'If nothing identifies a unique answer, ask one discriminating question' and `referents`: readRecall returns notes only, never a pendingId or a question",
    expect: [{ store: "the recall result carries a question (a pendingId)", check: async (w) => (w.answers.get("recall asks one discriminating question")?.body.result?.pendingId ? true : `result ${JSON.stringify(w.answers.get("recall asks one discriminating question")?.body.result ?? null).slice(0, 300)}`) }],
  },
]);

const FT10 = friend("FT10", 10, "Coffee 200 times vs one diagnosis", [
  { label: "open", do: "open" },
  ...tell("I had my third coffee already.", "a coffee habit, S0", (w) => [factItem(w, "I had my third coffee already", "the owner drinks a lot of coffee", "food", "S0")]),
  ...tell("I was diagnosed with cancer last week.", "a diagnosis: S2, gravity 3", (w) => [factItem(w, "I was diagnosed with cancer last week", "the owner was diagnosed with cancer", "health", "S2", { gravity: 3 })], [lifeChange("I was diagnosed with cancer last week.", "an illness: the owner, last week", "illness", "last week", {})]),
  { label: "close", do: "close" },
  { label: "the next Head: coffee freely, the diagnosis waits", do: "open", expect: [head("the next Head: coffee freely, the diagnosis waits", ["coffee"]), { neverSay: ["cancer", "diagnosed"], channels: ["head"] }] },
  { label: "small talk", do: "type", text: "Morning! Long day ahead.", answers: [reply("Morning! Want a quick rundown?"), parse()], expect: [{ neverSay: ["cancer", "diagnosed"], channels: ["head", "model", "note"] }] },
]);

const FT11 = friend("FT11", 11, "Dinner with twenty relevant memories", [
  { label: "open", do: "open" },
  ...tell("I love Thai food, and I hate mushrooms.", "two food preferences", (w) => [
    item({ act: "soft_pref", kind: "preference", predicate: "preference.food", value: { kind: "enum", code: "like" }, args: { dimension: "cuisine", targetRef: null }, spans: [spanOf(w, "I love Thai food")] }),
    item({ act: "soft_pref", kind: "preference", predicate: "preference.food", value: { kind: "enum", code: "dislike" }, args: { dimension: "ingredient", targetRef: null }, spans: [spanOf(w, "I hate mushrooms")] }),
  ]),
  { label: "ask about dinner", do: "say", text: "What should I make tonight?", answers: [parse()] },
  suggestCall("code picks three", [
    foodSafe("code picks three", [], "offered"),
    { neverSay: ["I remember", "you told me"], channels: ["tool", "card"] },
    { store: "three candidates and one selected", check: async (w) => { const r = w.answers.get("code picks three")?.body.result; return r?.candidateIds?.length === 3 && r.selectedId === r.candidateIds[0] ? true : JSON.stringify(r).slice(0, 300); } },
  ]),
  { label: "ask again", do: "say", text: "Anything else for dinner?", answers: [parse()] },
  {
    ...suggestCall("the disliked ingredient is left off", [foodSafe("the disliked ingredient is left off", ["mushroom"])]),
  },
]);

const FT12 = friend("FT12", 12, "Job search, pregnancy, debt guesses (the door)", [
  { label: "load the seed for a visit", do: "seed", visit: "ft12" },
  { label: "open", do: "open" },
  { label: "the owner raises the topic", do: "type", text: "I've been thinking about leaving my job.", answers: [reply("Want to talk it through?"), parse()] },
  {
    label: "the door opens: recall uses the guess, hedged",
    do: "tool",
    tool: () => recallArgs("leaving my job"),
    answers: [{ endpoint: "responses.create", why: "recall reader: unparsable, so code-ranked excerpts answer", result: readerFails() }],
    waits: "doors on a guess (spec §6): the asked recall returns stated facts only, and the seed's guesses (alleged, proposed only) never come back, even once the owner raises the topic",
    // The seed's job-search guess (beat 4's words); the recall's other notes are stated facts.
    expect: [{ mustSay: { has: ["ready to leave Corvel"], channel: "tool" } }],
  },
]);

const FT13 = friend("FT13", 13, "Rushed (the walked-in half is the exposure gate)", [
  { label: "open", do: "open" },
  ...tell("I'm two months behind on rent.", "an S1 money fact", (w) => [factItem(w, "I'm two months behind on rent", "the owner is two months behind on rent", "money", "S1")]),
  { label: "a rushed line", do: "type", text: "I've only got two minutes, what's on today?", answers: [reply("Want the short version?"), parse({ rushed: 0.9 }, "parse: rushed")] },
  {
    label: "rushed: one note, no doors or patterns",
    do: "check",
    of: "a rushed line",
    waits: "the rushed modifier (spec §6 'Rushed: one note, no doors or patterns'): no route stores or applies it; the Head is unchanged",
    expect: [{ store: "the session's rushed modifier is set", check: async (w) => { const s = await w.rig.store.get<{ modifiers?: { rushed?: unknown } }>(w.uid, `users/${w.uid}/sessions/${w.sessionId}`); return (s?.data.modifiers?.rushed ?? null) !== null ? true : `modifiers ${JSON.stringify(s?.data.modifiers ?? null)}`; } }],
  },
  { label: "never 'you sound stressed'", do: "check", of: "a rushed line", expect: [{ neverSay: ["sound stressed", "you seem stressed"], channels: ["note", "head"] }] },
]);

const FT14 = friend("FT14", 14, "Joke, rule, allergy, soft taste", [
  { label: "open", do: "open" },
  {
    label: "allergic to Mondays",
    do: "type",
    text: "I'm allergic to Mondays.",
    answers: [reply("Ha, same."), parse({ hardRule: 0.6 }, "parse: a weak hardRule candidate"), fsEmpty("Mondays is no allergy: no items")],
  },
  { label: "extraction of Mondays", do: "work", answers: [extract("a joke: no items", () => [])] },
  { label: "no rule and no filter for Mondays", do: "check", of: "open", expect: [{ store: "core/rules holds no allergy", check: async (w) => ((await rulesOf(w)).allergies.length === 0 ? true : JSON.stringify((await rulesOf(w)).allergies)) }] },
  { label: "a soft taste", do: "type", text: "I'm not big on olives.", answers: [reply("Noted."), parse()] },
  { label: "extraction of the soft taste", do: "work", answers: [extract("a dislike, not a rule", (w) => [item({ act: "soft_pref", kind: "preference", predicate: "preference.food", value: { kind: "enum", code: "dislike" }, args: { dimension: "ingredient", targetRef: null }, spans: [spanOf(w, "I'm not big on olives")] })])] },
  { label: "still no rule", do: "check", of: "open", expect: [{ store: "core/rules still holds no allergy", check: async (w) => ((await rulesOf(w)).allergies.length === 0 ? true : JSON.stringify((await rulesOf(w)).allergies)) }] },
  { label: "ask about dinner", do: "say", text: "What should I make tonight?", answers: [parse()] },
  suggestCall("food is not over-filtered", [foodSafe("food is not over-filtered", [], "offered")]),
]);

const FT15 = friend("FT15", 15, "\"She's my sister-in-law, not my sister\"", [
  { label: "open", do: "open" },
  ...tell("Ana is my sister.", "a relation: Ana, sister", (w) => [
    item({ act: "statement", kind: "fact", predicate: "person.relation", value: { kind: "enum", code: "sister" }, args: { otherRef: "m1", label: "sister", employerRef: null }, mentions: [mention(w, "m1", "person", "Ana")], spans: [spanOf(w, "Ana is my sister")], sens: "S1" }),
  ]),
  {
    label: "setup: the extractor sees Ana's relation in open",
    do: "setup",
    what: "the relation Memory's ID and Ana's entity, which extraction's `open` and roster list",
    run: async (w) => {
      const rel = (await memoriesWhere(w, (m) => m.predicate === "person.relation"))[0];
      w.vars.set("rel", rel?.id ?? null);
      w.vars.set("ana", (rel?.data.args as { otherRef?: string } | undefined)?.otherRef ?? null);
    },
  },
  ...tell("She's my sister-in-law, not my sister.", "a correction: sister-in-law", (w) => [
    item({
      act: "correction",
      kind: "fact",
      predicate: "person.relation",
      value: { kind: "enum", code: "sister_in_law" },
      args: { otherRef: "m1", label: "sister-in-law", employerRef: null },
      mentions: [{ ...mention(w, "m1", "person", "She"), existingId: w.vars.get("ana") }],
      spans: [spanOf(w, "She's my sister-in-law, not my sister")],
      sens: "S1",
      changes: [{ verb: "correct", targetMid: w.vars.get("rel") }],
    }),
  ]),
  {
    label: "the old value is wrong, the new one active",
    do: "check",
    of: "open",
    expect: [storeHas("sister marked wrong, sister_in_law active", (m) => m.predicate === "person.relation", (ms) => (ms.some((m) => m.status === "wrong" && (m.value as { code?: string }).code === "sister") && ms.some((m) => m.status === "active" && (m.value as { code?: string }).code === "sister_in_law") ? true : ms.map((m) => `${(m.value as { code?: string }).code}:${m.status}`).join(", ")))],
  },
  { label: "close", do: "close" },
  { label: "the next Head never repeats it", do: "open", expect: [head("the next Head never repeats it", ["sister-in-law"]), { neverSay: ["Ana is the owner's sister", "Ana is your sister"], channels: ["head"] }] },
]);

const FT16 = friend("FT16", 16, "Two Alexes", [
  { label: "open", do: "open" },
  ...tell("Alex from work is presenting on Monday.", "a colleague named Alex", (w) => [
    item({ act: "statement", kind: "fact", predicate: "person.relation", value: { kind: "enum", code: "colleague" }, args: { otherRef: "m1", label: "colleague", employerRef: null }, mentions: [mention(w, "m1", "person", "Alex")], spans: [spanOf(w, "Alex from work")], sens: "S0" }),
  ]),
  ...tell("My neighbor Alex lent me a ladder.", "a neighbor named Alex", (w) => [
    item({ act: "statement", kind: "fact", predicate: "person.relation", value: { kind: "enum", code: "other" }, args: { otherRef: "m1", label: "neighbor", employerRef: null }, mentions: [mention(w, "m1", "person", "Alex")], spans: [spanOf(w, "My neighbor Alex")], sens: "S0" }),
  ]),
  {
    label: "two separate people",
    do: "check",
    of: "open",
    expect: [storeHas("two person.relation Memories naming different entities", (m) => m.predicate === "person.relation", (ms) => (new Set(ms.map((m) => (m.args as { otherRef?: string }).otherRef)).size === 2 ? true : `${ms.length} relation(s), refs ${ms.map((m) => (m.args as { otherRef?: string }).otherRef).join(", ")}`))],
  },
  { label: "an action that depends on which", do: "type", text: "Remind me to text Alex tonight.", answers: [reply("Alex from work, or your neighbor?"), parse({ action: 0.9 }, "parse: an action")] },
  {
    label: "Franki asks which Alex",
    do: "check",
    of: "an action that depends on which",
    waits: "entity disambiguation on an action (spec §12 test 16): no route asks which person when two entities share a name; the reminder action itself is not built",
    expect: [{ mustSay: { has: ["Alex"], channel: "card" } }],
  },
]);

const ME = "riley@corvel-freight.example";
const danaMail: MailLine = {
  kind: "mail",
  id: "ft17-dana",
  at: at(0, "08:30"),
  bulk: false,
  fromSelf: false,
  from: { name: "Dana Whitlow", address: "dana@tessellate.example" },
  to: [ME],
  subject: "Following up",
  body: "Thanks for agreeing to cover the Thursday demo for me.",
  thread: "ft17-dana",
  claims: { claimsAboutUser: [{ type: "obligation", claim: "agreed to cover the Thursday demo", spans: [q("agreeing to cover the Thursday demo", "body")] }] },
};
const FT17 = friend("FT17", 17, "A colleague's claim (the attributed card)", [
  { label: "load the seed for a visit", do: "seed", visit: "ft17" },
  { label: "the email arrives", do: "mail", lines: [danaMail] },
  { label: "run the worker", do: "work" },
  { label: "open", do: "open" },
  { label: "nothing about it is believed", do: "check", of: "open", expect: [storeHas("no Memory from the email", (m) => m.sourceClass === "T", (ms) => (ms.length === 0 ? true : `${ms.length} T Memories`))] },
  {
    label: "\"Dana's email says you agreed to something. It's on your card.\"",
    do: "read",
    view: "overview",
    waits: W.MAIL_READ,
    expect: [{ mustSay: { has: ["Dana"], channel: "card" } }],
  },
]);

const FT18 = friend("FT18", 18, "\"How do you know?\"", [
  { label: "open", do: "open" },
  ...tell("My locker code is 4417.", "a fact: the locker code", (w) => [factItem(w, "My locker code is 4417", "the owner's locker code is 4417", "work", "S0")]),
  {
    label: "setup: the Memory's ID",
    do: "setup",
    what: "the fact's ID, as the screen's item carries it",
    run: async (w) => void w.vars.set("locker", (await memoriesWhere(w, (m) => m.predicate === "fact"))[0]?.id ?? null),
  },
  { label: "the why view walks the roots", do: "read", view: "why", id: (w) => String(w.vars.get("locker")), expect: [{ mustSay: { has: ["My locker code is 4417"], channel: "read" } }] },
]);

const FT21 = friend("FT21", 21, "Promises in voice and sent mail (spoken, dated)", [
  { label: "open", do: "open" },
  ...tell("I'll send Sam the deck on Thursday.", "a promise: the deck to Sam, due Thursday", (w) => [
    item({
      act: "promise_mine",
      kind: "commitment",
      predicate: "commitment",
      value: { kind: "text", text: "send Sam the deck" },
      args: { actorRef: "self", recipientRef: "m1", objectRef: null, artifactVersion: null },
      mentions: [mention(w, "m1", "person", "Sam")],
      spans: [spanOf(w, "I'll send Sam the deck on Thursday")],
      when: { kind: "spoken", spoken: "on Thursday", appliesTo: "due", anchorHint: null },
      sens: "S0",
    }),
  ]),
  { label: "a dated commitment is stored", do: "check", of: "open", expect: [storeHas("an active commitment with a due time", (m) => m.predicate === "commitment" && m.status === "active", (ms) => (ms.some((m) => m.time !== null) ? true : `time ${ms.map((m) => JSON.stringify(m.time)).join(", ") || "none"}`))] },
  { label: "close", do: "close" },
  { label: "Wednesday evening", do: "advance", to: at(5, "18:00"), called: "the evening before (Wednesday)" },
  { label: "run the worker", do: "work" },
  { label: "open the evening before", do: "open" },
  { label: "\"Sam's deck, Thursday, right?\"", do: "check", of: "open the evening before", waits: `${W.GATE_WIRE}; a commitment due within 24 hours (mustSay floor) has no delivery yet`, expect: [{ mustSay: { has: ["Sam"], channel: "proactive" } }] },
]);

const SECRET = "Don't tell anyone, but Mara is pregnant.";
const FT22 = friend("FT22", 22, "A friend's secret", [
  { label: "open", do: "open" },
  ...tell(SECRET, "someone else's secret: S2, never outbound", (w) => [
    factItem(w, "Mara is pregnant", "Mara is pregnant", "health", "S2", { subject: "m1", mentions: [mention(w, "m1", "person", "Mara")], flow: "never_outbound" }),
  ]),
  { label: "stored S2, never outbound", do: "check", of: "open", expect: [storeHas("an S2 never_outbound Memory", (m) => m.sens === "S2" && m.flow === "never_outbound")] },
  { label: "close", do: "close" },
  { label: "the next Head never holds it", do: "open", expect: [{ neverSay: ["pregnant"], channels: ["head"] }] },
  { label: "ask about Mara", do: "type", text: "What's new with Mara?", answers: [reply("Nothing I can share right now."), parse()], expect: [{ neverSay: ["pregnant"], channels: ["head", "model", "note"] }] },
]);

const FT23 = friend("FT23", 23, "Style, teasing (stated only)", [
  { label: "open", do: "open" },
  ...tell("You can tease me about my coffee habit.", "a style line: teasing is fine", (w) => [
    item({ act: "soft_pref", kind: "preference", predicate: "preference.style", value: { kind: "enum", code: "teasing_ok" }, args: { context: "global", dimension: "humor" }, spans: [spanOf(w, "You can tease me about my coffee habit")] }),
  ]),
  { label: "the style line is stored", do: "check", of: "open", expect: [storeHas("an active preference.style teasing_ok", (m) => m.predicate === "preference.style" && m.status === "active")] },
  { label: "close", do: "close" },
  { label: "the next Head carries the style", do: "open", waits: "a stated style line reaching the Head's Style line (spec §9; the Head's Style line is fixed text today)", expect: [head("the next Head carries the style", ["tease"])] },
]);

const FT24 = friend("FT24", 24, "\"Don't bring it up\" (forget is beat 5)", [
  { label: "open", do: "open" },
  ...tell("I'm two months behind on rent.", "an S1 money fact", (w) => [factItem(w, "I'm two months behind on rent", "the owner is two months behind on rent", "money", "S1")]),
  { label: "don't bring it up", do: "type", text: "Don't bring up the rent thing again.", answers: [reply("Okay, I'll leave it."), parse({ quiet: 0.9 }, "parse: quiet")] },
  { label: "extraction of the request", do: "work", answers: [extract("a request to Franki: no items", () => []), extract("the same job again after the quiet parse raised policyRev: no items", () => [])] },
  { label: "kept: the fact is still stored", do: "check", of: "open", expect: [storeHas("the rent fact still active", (m) => m.status === "active" && /rent/.test(memoryText(m)))] },
  { label: "close", do: "close" },
  {
    label: "stays quiet: the next Head leaves it out",
    do: "open",
    waits: "\"don't bring it up\" (spec §8, Friend Test 24): no route records a per-topic quiet; a quiet parse narrows the audience of a live call only",
    expect: [{ neverSay: ["behind on rent"], channels: ["head"] }],
  },
]);

const FT25 = friend("FT25", 25, "\"What do you know about me?\"", [
  { label: "open", do: "open" },
  ...tell("My dog is called Pip.", "a pet", (w) => [
    item({ act: "statement", kind: "fact", predicate: "person.relation", value: { kind: "enum", code: "other" }, args: { otherRef: "m1", label: "dog", employerRef: null }, mentions: [mention(w, "m1", "pet", "Pip")], spans: [spanOf(w, "My dog is called Pip")], sens: "S0" }),
  ]),
  { label: "ask", do: "type", text: "What do you know about me?", answers: [reply("Let me check."), parse()] },
  {
    label: "one snapshot backs voice",
    do: "tool",
    tool: () => recallArgs("what do you know about me", "inspect"),
    expect: [{ store: "the recall result carries a snapshot", check: async (w) => (w.answers.get("one snapshot backs voice")?.body.result?.snapshot ? true : JSON.stringify(w.answers.get("one snapshot backs voice")?.body ?? null).slice(0, 300)) }],
  },
  {
    label: "and the jar",
    do: "read",
    view: "overview",
    expect: [
      {
        store: "the jar's snapshot counts match the voice snapshot's",
        check: async (w) => {
          const voice = w.answers.get("one snapshot backs voice")?.body.result?.snapshot;
          const jar = w.answers.get("and the jar")?.body.snapshot;
          const counts = (s: unknown) => JSON.stringify((s as { counts?: unknown } | undefined)?.counts ?? null);
          return voice !== undefined && jar !== undefined && counts(voice) === counts(jar) ? true : `voice ${counts(voice)} jar ${counts(jar)}`;
        },
      },
    ],
  },
]);

export const FRIEND: GateScript[] = [FT02, FT03, FT04, FT06, FT08, FT09, FT10, FT11, FT12, FT13, FT14, FT15, FT16, FT17, FT18, FT21, FT22, FT23, FT24, FT25];

/** Friend Tests covered by scripts elsewhere, so nothing is repeated here. */
export const FRIEND_POINTERS: { test: number; where: string }[] = [
  { test: 1, where: "beat1-speaks-first.test.ts (the interview moved, the wish at 2, the card, once)" },
  { test: 12, where: "beat4-leave-job.test.ts (silence: no guess in any output or Head; the Lab counts); the door half is FT12 here" },
  { test: 13, where: "gate-exposure.ts E01 to E12 (someone walked in, company and quiet); the rushed half is FT13 here" },
  { test: 14, where: "gate-food.ts F01 to F40 and beat5-shellfish-brother.test.ts (the allergy); Mondays and a soft taste are FT14 here" },
  { test: 17, where: "poison.test.ts a to e and gate-poison.ts P06 to P15 (nothing believed); the attributed card is FT17 here" },
  { test: 20, where: "beat3-hero.test.ts (the hero, three variants, and the memory-off control)" },
  { test: 24, where: "beat5-shellfish-brother.test.ts (forget: \"Gone\", the receipt, the rule kept); \"don't bring it up\" is FT24 here" },
  { test: 28, where: "beats 1 to 5 (a judge in three minutes on the cloned seed)" },
];
