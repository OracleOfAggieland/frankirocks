/**
 * Beat 3 (spec §15, 0:50–1:30; spec §10, the hero): "$186 on takeout…", sources on the card. Its moment is due after
 * the bolt of beat 2, so it can't play first. "Yes." The comparison rows are written at that moment. Three weeks on,
 * Franki speaks first: "$71, down from $186 over the same three weeks." The strip fills: Noticed, Connected,
 * Suggested, You said yes, $115 less.
 *
 * The offer and the comparison are built (brief 022) and no route calls them: `heroOffer` and `compareLoop` run here
 * as probes, so the later steps can be reached. Each probe is a finding in the report.
 *
 * Two variants. "As merged" runs on the seed as brief 019 writes it: the detector finds no orders in it (purchases
 * are negative in the seed and positive in the detector), so everything from the offer on waits. "Past the seed
 * mismatches" rewrites the seeded bank rows the way the detector reads them, as test setup, to map what waits next.
 *
 * The memory-off control (spec §13 line 358): the same steps with an empty store; nothing about takeout is said.
 */
import type { Evidence, Ledger, Memory } from "@franki/core";
import { type BankLine, at } from "../seed/fixture";
import { type HeroOffer, type LoopComparison, compareLoop, heroOffer } from "../routes/tool-food";
import { type Script, type Step, type World, allLedger, allMemories, extract, parse, rewriteEvidence, reply, scriptSuite } from "../testing/script-runner";
import { BISCUIT_LINE } from "./lines";

const SIGN_WAITS =
  "a fit between briefs 019 and 022: the seed writes a purchase as a negative amountCents (seed/build.ts buildBank) and the detector counts only positive ones (core/patterns/spend.ts spendRows), so the seeded pattern is `insufficient` with 0 orders";
const HERO_WAITS = "brief 023 (the offer's moment, due after the bolt, and delivery) and a route calling brief 024's Gate; nothing calls heroOffer today";
const COMPARE_WAITS = "brief 023 (the comparison moment at checkAt, delivery) and a route calling brief 024's Gate; nothing calls compareLoop or markCelebrated today";
const LINEAGE_WAITS =
  "a fit between brief 022 and the lineage check: the loop Memory's root Slices are the rows' typed Slices (routes/tool-food.ts loopMemory prefers bank.amount and calendar.time), and W-LINEAGE (core/lineage.ts) fails every Slice with a null range as sliceHashMismatch, so the yes's write is refused and the route answers 400 PARSE";
const WINDOW_WAITS =
  "a fit between briefs 019 and 022: heroWindow ends the day before the world's today, so after the bolt to Thursday the window is no longer the seeded 21 dates";

/** The yes is on Thursday (day 6), so the comparison window is days 7 to 27. Takeout $25 + $22 + $24 = $71. */
const bank = (id: string, day: number, hhmm: string, merchant: string, amountCents: number, category: BankLine["category"]): BankLine => ({ kind: "bank", id, at: at(day, hhmm), merchant, amountCents, category });
const AFTER: BankLine[] = [
  bank("after-takeout-1", 10, "20:15", "Quillan Thai Kitchen", 2500, "takeout"),
  bank("after-takeout-2", 16, "19:50", "Marrowfield Pizza", 2200, "takeout"),
  bank("after-takeout-3", 23, "20:05", "Pellwick Noodles", 2400, "takeout"),
  bank("after-grocery-1", 8, "11:00", "Fennimore Market", 7480, "groceries"),
  bank("after-grocery-2", 15, "17:40", "Fennimore Market", 6120, "groceries"),
  bank("after-grocery-3", 22, "12:30", "Fennimore Market", 5890, "groceries"),
];

const offerOf = (w: World, name = "offer") => (w.vars.get(name) as HeroOffer | null | undefined) ?? null;
const loopIdOf = (w: World) => (w.vars.get("loopId") as string | undefined) ?? "";

async function probeOffer(w: World): Promise<unknown> {
  const offer = await heroOffer(w.ctx, w.stamp?.generation ?? 1);
  return offer === null ? null : { ...offer, text: offer.line };
}

async function listAndLoop(w: World): Promise<true | string> {
  const actions = (await allLedger(w)).filter((l) => l.data.kind === "action");
  const loops = (await allMemories(w)).filter((m) => m.data.kind === "loop");
  const action = actions[0]?.data as (Ledger & { payload: { executor: string; loopId: string; items: { label: string }[] } }) | undefined;
  const loop = loops[0]?.data as Memory | undefined;
  if (actions.length !== 1 || loops.length !== 1 || action === undefined || loop === undefined) return `found ${actions.length} action(s) and ${loops.length} loop(s)`;
  if (action.payload.executor !== "makeList" || action.payload.items.length === 0) return `action ${JSON.stringify(action.payload)}`;
  if (loop.loop?.state !== "waiting" || loop.loop.baseline.valueCents !== 18600) return `loop ${JSON.stringify(loop.loop)}`;
  w.vars.set("loopId", loops[0]!.id);
  return true;
}

type Bank = Evidence & { observation: { kind: "bank"; amountCents: number; pending: boolean } };
const isBank = (e: Evidence) => e.kind === "transaction" && e.observation.kind === "bank";

/** Test setup: purchases positive, as the detector counts them; the pending decoy left out (it makes the pattern `partial`). */
function asDetectorReads(label: string): Step {
  return {
    label,
    do: "setup",
    what: "purchases rewritten as positive amountCents, and the pending takeout decoy dropped (spendRows counts a pending in-window takeout row as unsettled, so the pattern is `partial`)",
    run: async (w) => {
      await rewriteEvidence(
        w,
        (e) => isBank(e) && (e as Bank).observation.amountCents < 0,
        (e) => {
          const b = e as Bank;
          return b.observation.pending ? null : ({ ...b, observation: { ...b.observation, amountCents: -b.observation.amountCents } } as Evidence);
        },
      );
    },
  };
}

const biscuitSteps: Step[] = [
  { label: "open a session", do: "open", expect: [{ neverSay: ["$186"] }] },
  { label: "type the Biscuit line", do: "type", text: BISCUIT_LINE, answers: [reply("Oh no, poor Biscuit."), parse()], expect: [{ neverSay: ["$186"] }] },
  { label: "extraction runs behind the reply", do: "work", answers: [extract("not needed by this beat: no items", () => [])] },
  { label: "close the session", do: "close" },
];

function stripIs(label: string, want: string) {
  return async (w: World): Promise<true | string> => {
    const steps = (w.answers.get(label)?.body.strip.steps ?? []) as { kind: string; state: string }[];
    const got = steps.map((s) => `${s.kind}:${s.state}`).join(" ");
    return got === want ? true : got || "no strip";
  };
}

function beat3(variant: "as merged" | "past the seed mismatches"): Script {
  const merged = variant === "as merged";
  /**
   * The sign fit (SIGN_WAITS) was fixed by brief 023, which stores a purchase as positive cents and moved the pending
   * decoy out of the window. So the merged variant no longer waits for it: a step waits only for its own reason.
   */
  const needsOffer = (otherwise?: string) => (otherwise === undefined ? {} : { waits: otherwise });
  const steps: Step[] = [
    { label: "load the seed for a visit", do: "seed", visit: "beat3" },
    ...(merged ? [] : [asDetectorReads("setup: the seeded bank rows the way the detector reads them")]),
    ...biscuitSteps,
    {
      label: "probe: the offer on the clone's Friday says $186",
      do: "probe",
      name: "offer",
      run: probeOffer,
      ...needsOffer(),
      expect: [
        { mustSay: { template: "hero.offer", has: ["$186"], channel: "probe" } },
        {
          store: "the card cites the six purchases and the four meetings",
          check: async (w) => {
            const o = offerOf(w);
            return o !== null && o.card.sources.length === 10 ? true : `sources ${o?.card.sources.length ?? "none"}`;
          },
        },
      ],
    },
    { label: "the bolt jumps to Thursday 18:00", do: "advance", to: at(6, "18:00"), called: "Thursday 18:00 (simulated)" },
    { label: "run the worker until idle", do: "work" },
    {
      label: "probe: the offer after the bolt still says $186",
      do: "probe",
      name: "offerAfterBolt",
      run: probeOffer,
      expect: [{ mustSay: { template: "hero.offer", has: ["$186"], channel: "probe" } }],
    },
    { label: "open after the bolt", do: "open" },
    {
      label: "the offer plays after the bolt, with $186",
      do: "check",
      of: "open after the bolt",
      ...needsOffer(HERO_WAITS),
      expect: [{ mustSay: { template: "hero.offer", has: ["$186"], channel: "proactive" } }],
    },
    {
      label: "the offer's card shows its sources",
      do: "check",
      of: "open after the bolt",
      ...needsOffer(HERO_WAITS),
      expect: [{ mustSay: { card: "Takeout and late meetings" } }],
    },
    { label: "the owner says yes", do: "say", text: "Yes, let's do it", answers: [parse()] },
    {
      label: "Franki writes the list and the loop",
      do: "tool",
      // The offer as it stands after the bolt; in the demo the moment would carry its IDs.
      tool: (w) => {
        const o = offerOf(w, "offerAfterBolt");
        return { name: "answer", args: { pendingId: o?.pendingId ?? "none", choiceId: o?.yesId ?? "none" } };
      },
      ...needsOffer(WINDOW_WAITS),
      expect: [
        { mustSay: { card: "Three quick dinners for those nights" } },
        { store: "one makeList action and one waiting loop with a $186 baseline", check: listAndLoop },
      ],
    },
    {
      label: "the strip after the yes",
      do: "read",
      view: "strip",
      ...needsOffer(WINDOW_WAITS),
      expect: [
        {
          store: "Noticed, Connected, Suggested, You said yes complete; the comparison pending",
          check: stripIs("the strip after the yes", "noticed:complete connected:complete suggested:complete accepted:complete comparison:pending"),
        },
      ],
    },
    { label: "three weeks of rows arrive", do: "bank", lines: AFTER },
    ...(merged ? [] : [asDetectorReads("setup: the new bank rows the way the detector reads them")]),
    { label: "three weeks on", do: "advance", to: at(28, "08:00"), called: "three weeks on (simulated)" },
    { label: "run the worker until idle, three weeks on", do: "work", answers: [extract("the yes holds no fact: no items", () => [])] },
    {
      label: "probe: the comparison three weeks on",
      do: "probe",
      name: "comparison",
      run: async (w) => {
        const c: LoopComparison | null = await compareLoop(w.ctx, loopIdOf(w), w.stamp?.generation ?? 1);
        return { text: (c?.lines ?? []).join(" "), takeout: c?.takeout ?? null };
      },
      ...needsOffer(WINDOW_WAITS),
      expect: [
        { mustSay: { template: "hero.comparison", has: ["$71", "$186", "three weeks"], channel: "probe" } },
        { mustSay: { template: "hero.less", has: ["$115"], channel: "probe" } },
      ],
    },
    { label: "open three weeks on", do: "open" },
    {
      label: "Franki speaks first: $71, down from $186",
      do: "check",
      of: "open three weeks on",
      ...needsOffer(COMPARE_WAITS),
      expect: [{ mustSay: { template: "hero.comparison", has: ["$71", "$186"], channel: "proactive" } }],
    },
    {
      label: "the strip fills: $115 less",
      do: "read",
      view: "strip",
      ...needsOffer("the comparison closing the loop (brief 023) and the strip's money figure from rollups (brief 020 'not built')"),
      expect: [
        {
          store: "every step complete",
          check: stripIs("the strip fills: $115 less", "noticed:complete connected:complete suggested:complete accepted:complete comparison:complete"),
        },
        { mustSay: { has: ["$115 less"], channel: "read" } },
      ],
    },
  ];
  return { name: `beat 3: the hero, ${variant}`, scores: "spec §15 0:50–1:30, spec §10, Friend Test 20", steps };
}

/**
 * A third variant, to map past the window misfit: the yes on the clone's Friday, before any bolt, so the offer's
 * window is the seeded one. The comparison window is then days 1 to 21, and three weeks on is day 22.
 */
function beat3YesOnFriday(): Script {
  const full = beat3("past the seed mismatches").steps;
  const pick = (label: string) => full.find((s) => s.label === label)!;
  const shifted = AFTER.map((l) => ({ ...l, at: { day: l.at.day - 6, minute: l.at.minute } }));
  const steps: Step[] = [
    pick("load the seed for a visit"),
    pick("setup: the seeded bank rows the way the detector reads them"),
    ...biscuitSteps,
    pick("probe: the offer on the clone's Friday says $186"),
    { label: "open on Friday", do: "open" },
    { label: "the owner says yes", do: "say", text: "Yes, let's do it", answers: [parse()] },
    {
      label: "Franki writes the list and the loop",
      do: "tool",
      tool: (w: World) => ({ name: "answer", args: { pendingId: offerOf(w)?.pendingId ?? "none", choiceId: offerOf(w)?.yesId ?? "none" } }),
      waits: LINEAGE_WAITS,
      expect: pick("Franki writes the list and the loop").expect!,
    },
    { ...pick("the strip after the yes"), waits: LINEAGE_WAITS },
    { label: "three weeks of rows arrive", do: "bank", lines: shifted },
    asDetectorReads("setup: the new bank rows the way the detector reads them"),
    { label: "three weeks on", do: "advance", to: at(22, "08:00"), called: "three weeks on (simulated)" },
    pick("run the worker until idle, three weeks on"),
    { ...pick("probe: the comparison three weeks on"), waits: LINEAGE_WAITS },
    pick("open three weeks on"),
    { ...pick("Franki speaks first: $71, down from $186"), waits: LINEAGE_WAITS },
    { ...pick("the strip fills: $115 less"), waits: LINEAGE_WAITS },
  ];
  return { name: "beat 3: the hero, yes on the clone's Friday (past the seed mismatches)", scores: "spec §15 0:50–1:30, spec §10", steps };
}

/** Memory off: no seed. The same turns; no offer, no comparison, nothing about takeout. */
const BEAT3_MEMORY_OFF: Script = {
  name: "beat 3, memory-off control",
  scores: "spec §13 line 358",
  steps: [
    ...biscuitSteps,
    { label: "probe: no offer from an empty store", do: "probe", name: "offer", run: probeOffer },
    { label: "the clock moves to Thursday 18:00", do: "advance", to: at(6, "18:00"), called: "Thursday 18:00" },
    { label: "open after the jump", do: "open" },
    { label: "three weeks on", do: "advance", to: at(28, "08:00"), called: "three weeks on" },
    { label: "open three weeks on", do: "open" },
    { label: "read the strip", do: "read", view: "strip" },
    { label: "read the screen", do: "read", view: "overview" },
  ],
  neverSay: { tokens: ["$186", "$71", "$115", "takeout"], channels: ["note", "card", "proactive", "tool", "read", "head", "probe"] },
};

scriptSuite(beat3("as merged"));
scriptSuite(beat3("past the seed mismatches"));
scriptSuite(beat3YesOnFriday());
scriptSuite(BEAT3_MEMORY_OFF);
