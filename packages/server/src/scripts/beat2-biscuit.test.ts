/**
 * Beat 2 (spec §15, 0:20–0:50): the judge types "Biscuit has surgery Thursday." Franki replies, and extraction runs
 * behind it. When it's done, a labeled bolt jumps to Thursday at 18:00: "How'd Biscuit do?" It's about their own
 * words, and it is said once.
 *
 * The memory-off control (spec §13 line 358) runs the same steps with an empty store and nothing remembered, and
 * asserts that Franki says none of the remembered lines.
 */
import type { Memory } from "@franki/core";
import { addDays } from "../seed/clock";
import { at } from "../seed/fixture";
import { BISCUIT_LINE } from "./lines";
import { type Script, type Step, type World, allMemories, extract, item, memoryText, parse, reply, scriptSuite, spanOf, spoken } from "../testing/script-runner";

const LINE = BISCUIT_LINE;
const biscuit = { what: "the owner's words about Biscuit", pick: (m: Memory) => memoryText(m).includes("Biscuit") };

const CHECKIN_WAITS = "brief 023 (derive the check-in, the tick, the jump and delivery) and 024 (the Gate words it); open answers proactive: null today";

/** What a careful extractor files for the line: Biscuit's surgery as an event, the time words left for code. */
const biscuitItems = (w: World) => [
  item({
    act: "statement",
    kind: "event",
    predicate: "event",
    subject: "m1",
    value: { kind: "text", text: "Biscuit's surgery" },
    args: { occasion: "surgery", anchorRef: null, important: true },
    mentions: [{ localId: "m1", type: "pet", observedName: "Biscuit", span: spanOf(w, "Biscuit"), existingId: null }],
    when: spoken("Thursday"),
    spans: [spanOf(w, "Biscuit has surgery Thursday")],
  }),
];

async function biscuitStored(w: World): Promise<true | string> {
  const found = (await allMemories(w)).filter((m) => biscuit.pick(m.data));
  // "Thursday", said on the clone's Friday, resolves to the Thursday six days on (spec §5, the pure resolver).
  const thursday = addDays(w.friday!, 6);
  const ok = found.filter((m) => m.data.status === "active" && m.data.sourceClass === "U" && m.data.kind === "event" && m.data.time?.civilStart === thursday);
  const seen = found.map((m) => `${m.data.kind} ${m.data.status} ${m.data.sourceClass} "${memoryText(m.data)}" on ${m.data.time?.civilStart ?? "no date"}`);
  return ok.length === 1 ? true : `found ${seen.join("; ") || "no Biscuit Memory"}; wanted one on ${thursday}`;
}

const typed: Step = {
  label: "type the line",
  do: "type",
  text: LINE,
  answers: [reply("Oh no, poor Biscuit. I hope Thursday goes smoothly."), parse()],
  expect: [{ mustSay: { note: true } }],
};

const BEAT2: Script = {
  name: "beat 2: Biscuit has surgery Thursday",
  scores: "spec §15 0:20–0:50, Friend Test 1 for a pet",
  steps: [
    { label: "load the seed for a visit", do: "seed", visit: "beat2" },
    { label: "open a session", do: "open" },
    typed,
    {
      label: "extraction runs behind the reply",
      do: "work",
      answers: [extract("Biscuit's surgery, an event on Thursday", biscuitItems)],
      expect: [{ store: "one active U event Memory about Biscuit, on Thursday", check: biscuitStored }],
    },
    { label: "close the session", do: "close" },
    { label: "the bolt jumps to Thursday 18:00", do: "advance", to: at(6, "18:00"), called: "Thursday 18:00 (simulated)" },
    { label: "run the worker until idle", do: "work" },
    {
      label: "Franki opens with the check-in about Biscuit",
      do: "open",
      waits: CHECKIN_WAITS,
      expect: [{ mustSay: { template: "occasion.checkin", has: ["Biscuit"], channel: "proactive", times: 1 } }],
    },
    {
      label: "the check-in is about their own words",
      do: "check",
      of: "Franki opens with the check-in about Biscuit",
      waits: CHECKIN_WAITS,
      expect: [{ mustUse: biscuit, channel: "proactive" }, { mayUse: { what: "the Biscuit line", pick: biscuit.pick } }],
    },
    { label: "close again", do: "close" },
    {
      label: "the next open does not ask again",
      do: "open",
      waits: "brief 023 (`said` from the transcript, once per occurrence); the check-in template has no wording to match yet",
      expect: [{ mustSay: { template: "occasion.checkin", channel: "proactive", times: 0 } }],
    },
  ],
};

/** Memory off: no seed, nothing extracted. After the jump nothing about Biscuit is said. */
const BEAT2_MEMORY_OFF: Script = {
  name: "beat 2, memory-off control",
  scores: "spec §13 line 358",
  steps: [
    { label: "open a session", do: "open" },
    typed,
    { label: "extraction keeps nothing", do: "work", answers: [extract("memory off: no items", () => [])] },
    { label: "close the session", do: "close" },
    { label: "the clock moves to Thursday 18:00", do: "advance", to: at(6, "18:00"), called: "Thursday 18:00" },
    { label: "run the worker until idle", do: "work" },
    { label: "open again", do: "open" },
    { label: "read the screen", do: "read", view: "overview" },
  ],
  neverSay: { from: "extraction keeps nothing", tokens: ["Biscuit", "surgery"] },
};

scriptSuite(BEAT2);
scriptSuite(BEAT2_MEMORY_OFF);
