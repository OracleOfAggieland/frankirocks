/**
 * Beat 5 (spec §15, 1:50–2:25): earlier, in one breath: "I'm allergic to shellfish, and my brother's in trouble
 * again." Franki answers both. Now: "Forget what I said about my brother." "Gone." The shellfish rule from that same
 * sentence stays. The receipt separates blocked from cleaned, and lists what it touched. The seed holds no other
 * brother fact, so the cue isn't vague.
 *
 * Since brief 048 the forget runs on /api/turn, the typed answer says "Gone." once the receipt's blockedAt is set, and
 * the next Head has no brother. The receipt card gives counts and states only, never the forgotten words (ruling 10).
 * The rule comes from brief 018's hard-rule route in /api/turn.
 */
import type { Job, Memory } from "@franki/core";
import { paths } from "../store/paths";
import { type Script, type World, allMemories, extract, item, memoryText, parse, reply, resolveForget, rulesOf, scriptSuite, slots, spanOf } from "../testing/script-runner";

const BREATH = "I'm allergic to shellfish, and my brother's in trouble again.";
const FORGET = "Forget what I said about my brother.";
const brother = { memory: "the brother line", pick: (m: Memory) => /brother|trouble/i.test(memoryText(m)) };

const RECEIPT_STEP = "the receipt separates blocked from cleaned";

/**
 * Brief 048 ruling 10: the receipt card counts at least one blocked row, and says cleaned only once purge has ended
 * (until then it says blocked). Counts and states only; "brother" is checked by neverSay.
 */
async function receiptCounts(w: World): Promise<true | string> {
  const card = w.outputs.find((o) => o.step === RECEIPT_STEP && o.channel === "card");
  if (card === undefined) return "no receipt card";
  const c = JSON.parse(card.json) as { status: string; body: string };
  const counts = JSON.parse(c.body) as { touched: { collection: string; count: number }[] };
  const blocked = counts.touched.reduce((n, t) => n + t.count, 0);
  if (blocked < 1) return `blocked count ${blocked}: ${card.json}`;
  const jobs = await w.rig.store.query<Job>(w.uid, { collection: paths.collection(w.uid, "jobs"), where: [], orderBy: { field: "__name__", dir: "asc" }, limit: 100 });
  const job = jobs.find((j) => j.data.kind === "forget")?.data.payload;
  if (job === undefined || job.kind !== "forget") return "no forget job";
  const purged = job.phase === "done";
  const want = purged ? "cleaned" : "blocked";
  return c.status === want ? true : `the card says ${c.status} with the job at ${job.phase}: ${card.json}`;
}

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
  if (found.length === 1) w.vars.set("brotherId", found[0]!.id);
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
    // The beat's "Now:": the forget comes a minute after the breath, not in the same instant, so the resolve does
    // not take it for a fragment of the line before (FRAGMENT_CONFIRM_MS). Added in brief 048 stage 4; no expectation.
    { label: "a minute later", do: "setup", what: "the clock moves on a minute", run: async (w) => w.rig.clock.advance(60_000) },
    {
      label: "ask to forget the brother",
      do: "type",
      text: FORGET,
      // The typed reply runs beside the parse and is dropped once admission chooses forget; the resolve names the brother.
      answers: [reply("Okay."), parse({ forget: 0.95 }, "parse: a forget"), resolveForget("the brother line", (w) => [String(w.vars.get("brotherId"))])],
    },
    {
      label: "Franki says Gone",
      do: "check",
      of: "ask to forget the brother",
      expect: [{ mustSay: { template: "forget.gone", channel: "note" } }],
    },
    {
      label: RECEIPT_STEP,
      do: "read",
      view: "receipt",
      // Brief 048 ruling 10 changes this one expectation: it was `mustSay: { has: ["brother"], channel: "card" }`.
      expect: [{ store: "the card counts at least one blocked row, and says cleaned only after purge", check: receiptCounts }, { neverSay: ["brother"], channels: ["card", "read"] }],
    },
    {
      label: "the rule from the same sentence stays",
      do: "check",
      of: "ask to forget the brother",
      expect: [{ store: "core/rules still holds the active shellfish allergy", check: shellfishActive }],
    },
    // Brief 048 ruling 3: the forget request's turn is dead with no Evidence, so it is never extracted.
    { label: "run the worker until idle", do: "work" },
    { label: "close the session", do: "close" },
    {
      label: "the next Head has no brother",
      do: "open",
      // The forget left the breath's shellfish half as sanitized Evidence, and the open's drain reads it again (spec §8
      // step 6). Declared in brief 048 stage 4, once the forget really resolved: it files nothing new.
      answers: [extract("the sanitized breath read again: nothing new", () => [])],
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
