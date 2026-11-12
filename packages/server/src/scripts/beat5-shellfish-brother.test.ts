/**
 * Beat 5 (spec §15, 1:50–2:25): earlier, in one breath: "I'm allergic to shellfish, and my brother's in trouble
 * again." Franki answers both. Now: "Forget what I said about my brother." "Gone." The shellfish rule from that same
 * sentence stays. The receipt separates blocked from cleaned, and lists what it touched. The seed holds no other
 * brother fact, so the cue isn't vague.
 *
 * The forget parts ("Gone", the receipt, the brother gone from the next Head) need closure and resume, which brief
 * 021 reserved, and a route that calls the forget code. The rule comes from brief 018's hard-rule route in /api/turn.
 */
import type { Memory } from "@franki/core";
import { type Script, type World, allMemories, extract, item, memoryText, parse, reply, rulesOf, scriptSuite, slots, spanOf } from "../testing/script-runner";

const BREATH = "I'm allergic to shellfish, and my brother's in trouble again.";
const FORGET = "Forget what I said about my brother.";
const brother = { memory: "the brother line", pick: (m: Memory) => /brother|trouble/i.test(memoryText(m)) };

const FORGET_WAITS = "brief 021's reserved closure and resume (no forget can complete) and the brief that wires forget into /api/turn: no route calls fenceForget or advanceForget";

/** Both halves of the breath, as a careful extractor files them. */
const breathItems = (w: World) => [
  item({
    act: "hard_rule",
    kind: "rule",
    predicate: "allergy",
    value: { kind: "boolean", bool: true },
    args: { allergenCode: "shellfish" },
    spans: [spanOf(w, "I'm allergic to shellfish")],
    sens: "S1",
  }),
  item({
    act: "statement",
    kind: "fact",
    predicate: "fact",
    subject: "m1",
    value: { kind: "text", text: "the owner's brother is in trouble again" },
    args: { topic: "relationship", label: "brother" },
    mentions: [{ localId: "m1", type: "person", observedName: "brother", span: spanOf(w, "brother"), existingId: null }],
    spans: [spanOf(w, "my brother's in trouble again")],
    sens: "S1",
  }),
];

async function shellfishActive(w: World): Promise<true | string> {
  const rules = await rulesOf(w);
  const hits = rules.allergies.filter((r) => r.code === "shellfish" && r.state === "active");
  return hits.length === 1 ? true : `core/rules allergies: ${JSON.stringify(rules.allergies)}`;
}

async function brotherStored(w: World): Promise<true | string> {
  const found = (await allMemories(w)).filter((m) => brother.pick(m.data));
  return found.length === 1 && found[0]!.data.status === "active" ? true : `found ${found.map((m) => `${m.data.status} "${memoryText(m.data)}"`).join("; ") || "nothing"}`;
}

async function noOtherBrother(w: World): Promise<true | string> {
  const found = (await allMemories(w)).filter((m) => brother.pick(m.data) || (m.data.predicate === "person.relation" && /brother|sibling/.test(JSON.stringify(m.data.value))));
  return found.length === 0 ? true : `the seed already has ${found.map((m) => `"${memoryText(m.data)}"`).join("; ")}`;
}

const BEAT5: Script = {
  name: "beat 5: shellfish and the brother",
  scores: "spec §15 1:50–2:25, Friend Tests 14 and 24",
  steps: [
    { label: "load the seed for a visit", do: "seed", visit: "beat5", expect: [{ store: "no brother fact in the seed", check: noOtherBrother }] },
    { label: "open a session", do: "open" },
    {
      label: "say both in one breath",
      do: "type",
      text: BREATH,
      answers: [
        reply("Got it, no shellfish. And I'm sorry about your brother. Want to talk about it?"),
        parse({ hardRule: 0.9 }, "parse: a hard rule"),
        slots("an affirmed shellfish allergy for the owner", (eid) => [
          {
            kind: "allergy",
            subject: { entityId: null, mention: null, isSelf: true },
            item: "shellfish",
            severity: "allergy",
            polarity: "affirmed",
            act: "direct",
            span: { eid, fieldPath: "text", start: 0, end: "I'm allergic to shellfish".length, quote: "I'm allergic to shellfish" },
          },
        ]),
      ],
      expect: [{ mustSay: { note: true } }],
    },
    {
      label: "extraction files both",
      do: "work",
      answers: [extract("a shellfish hard rule, and a fact about the brother", breathItems)],
      expect: [{ store: "the brother line stored once, active", check: brotherStored }],
    },
    {
      label: "the shellfish rule is active",
      do: "check",
      of: "extraction files both",
      expect: [{ store: "core/rules holds an active shellfish allergy", check: shellfishActive }],
    },
    {
      label: "ask to forget the brother",
      do: "type",
      text: FORGET,
      answers: [reply("Okay."), parse({ forget: 0.95 }, "parse: a forget")],
    },
    {
      label: "Franki says Gone",
      do: "check",
      of: "ask to forget the brother",
      waits: FORGET_WAITS,
      expect: [{ mustSay: { template: "forget.gone", channel: "note" } }],
    },
    {
      label: "the receipt separates blocked from cleaned",
      do: "read",
      view: "receipt",
      waits: FORGET_WAITS,
      expect: [{ mustSay: { has: ["brother"], channel: "card" } }],
    },
    {
      label: "the rule from the same sentence stays",
      do: "check",
      of: "ask to forget the brother",
      expect: [{ store: "core/rules still holds the active shellfish allergy", check: shellfishActive }],
    },
    { label: "run the worker until idle", do: "work", answers: [extract("the forget request holds no fact: no items", () => [])] },
    { label: "close the session", do: "close" },
    {
      label: "the next Head has no brother",
      do: "open",
      waits: FORGET_WAITS,
      expect: [{ neverSay: [brother, "brother"], channels: ["head"] }],
    },
    {
      label: "the next Head has the shellfish rule",
      do: "check",
      of: "the next Head has no brother",
      expect: [{ mustSay: { has: ["shellfish"], channel: "head" } }],
    },
  ],
};

scriptSuite(BEAT5);
